#!/usr/bin/env node
/* eslint-disable no-console */

import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import os from "node:os";
import crypto from "node:crypto";

import dotenv from "dotenv";
import pngjs from "pngjs";
import { evaluateContentValueGate } from "./lib/content-value-gate.mjs";
import {
  deriveRegulatoryRichFailure,
  deriveRegulatoryRichSignals,
  moduleKeyForRegulatoryReason,
  UL_COVERAGE_MISS_REASONS,
} from "./lib/regulatory-richness-gate.mjs";

const ROOT_DIR = process.cwd();
dotenv.config({ path: path.join(ROOT_DIR, "backend", ".env") });
dotenv.config({ path: path.join(ROOT_DIR, ".env") });

const DEFAULT_BARCODES = [
  { role: "killer", barcode: "00665553227870" },
  { role: "lnhpd", barcode: "00064642079992" },
  { role: "dsld", barcode: "00690290532093" },
  { role: "web_hint", barcode: "00666183000154" },
  { role: "not_found", barcode: "99999999999999" },
];

const args = process.argv.slice(2);
const arg = (name, fallback = "") => {
  const inline = args.find((entry) => entry.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const idx = args.indexOf(name);
  if (idx >= 0 && idx + 1 < args.length) return args[idx + 1];
  return fallback;
};
const hasArg = (name) => args.includes(name);

const nowTs = Date.now();
const outRootArg = arg("--out-dir", "");
const OUT_DIR = (() => {
  if (!outRootArg) return path.join(ROOT_DIR, "output", `mobile-soak-${nowTs}`);
  if (path.isAbsolute(outRootArg)) return outRootArg;
  return path.join(ROOT_DIR, outRootArg);
})();

const API_BASE_URL = arg("--api-base-url", process.env.API_BASE_URL || process.env.RENDER_BASE_URL || "http://127.0.0.1:3001").replace(/\/$/, "");
const SSE_TIMEOUT_MS = Number(arg("--sse-timeout-ms", process.env.MOBILE_SOAK_SSE_TIMEOUT_MS || "50000"));
const SERIAL_ROUNDS = Number(arg("--serial-rounds", "20"));
const CONCURRENT_ROUNDS = Number(arg("--concurrent-rounds", "50"));
const CONCURRENT_LEVEL = Number(arg("--concurrency-level", "3"));
const INCLUDE_COLD_HOT = !hasArg("--skip-cold-hot");
const CAPTURE_SCREENSHOTS = hasArg("--capture-screenshots") || arg("--capture-screenshots", "").toLowerCase() === "true";
const SIM_UDID = arg("--sim-udid", "booted");
const APP_SCHEME = arg("--app-scheme", process.env.MOBILE_SOAK_APP_SCHEME || "nutri");
const RESULT_ROUTE_PATH = arg("--result-route-path", process.env.MOBILE_SOAK_RESULT_PATH || "scan/result");
const OPEN_RESULT_SCREEN = !hasArg("--no-open-result-screen");
const OPEN_RESULT_PHASES_RAW = arg(
  "--open-result-phases",
  process.env.MOBILE_SOAK_OPEN_RESULT_PHASES || "cold_start,hot_start,serial",
);
const OPEN_RESULT_PHASES = new Set(
  String(OPEN_RESULT_PHASES_RAW || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
);
const DEEPLINK_WAIT_MS = Math.max(0, Number(arg("--deeplink-wait-ms", "1200")));
const FAIL_ON_PREFLIGHT_POPUP = !hasArg("--allow-popup-preflight");
const PREFLIGHT_JSON = arg("--preflight-json", "");
const BARCODES_JSON = arg("--barcodes-json", "");
const DRY_RUN = hasArg("--dry-run");
const RETRIES = Number(arg("--retries", "0"));
const KILLER_COLD_RUNS = Math.max(0, Number(arg("--killer-cold-runs", "0")));
const KILLER_HOT_RUNS = Math.max(0, Number(arg("--killer-hot-runs", "0")));
const SHOW_SCAN_DEBUG =
  String(process.env.EXPO_PUBLIC_SHOW_SCAN_DEBUG || "").toLowerCase() === "true"
  || String(process.env.EXPO_PUBLIC_SHOW_SCAN_DEBUG || "") === "1";
const CONTENT_VALUE_PASS_THRESHOLD = Number(arg("--content-pass-threshold", "0.95"));
const VERIFIED_CONTENT_PASS_THRESHOLD = Number(arg("--verified-content-threshold", "0.9"));
const WEB_HINT_CONTENT_PASS_THRESHOLD = Number(arg("--web-hint-content-threshold", "0.8"));
const UL_VISIBILITY_PASS_THRESHOLD = Number(arg("--ul-visibility-threshold", "0.95"));
const DEGRADED_CONTENT_PASS_THRESHOLD = Number(arg("--degraded-content-threshold", "0.95"));
const REGULATORY_RICH_RATE_THRESHOLD = Number(arg("--regulatory-rich-threshold", "0.3"));
const SCORE_VISIBLE_RATE_THRESHOLD = Number(arg("--score-visible-threshold", "0.9"));
const FIRST_FRAME_TRUSTED_REGULATORY_THRESHOLD = Number(arg("--first-frame-trusted-threshold", "0.6"));
const REQUIRE_FIRST_FRAME_PENDING = !["0", "false", "off"].includes(
  String(arg("--require-first-frame-pending", "true")).trim().toLowerCase(),
);
const REQUIRE_WEB_HINT_COVERAGE = !["0", "false", "off"].includes(
  String(arg("--require-web-hint-coverage", "true")).trim().toLowerCase(),
);
const ROLE_DEFINITION_VERSION = String(
  arg("--role-definition-version", process.env.STAGE_B_ROLE_DEFINITION_VERSION || "stage-b-role-v1"),
).trim();
const DECISION_SUPPORT_VIEW_MODE = String(
  arg("--decision-support-view-mode", process.env.STAGE_B_DECISION_SUPPORT_VIEW_MODE || "details"),
)
  .trim()
  .toLowerCase() === "details"
  ? "details"
  : "details";
const HEALTH_PREFLIGHT_ENABLED = !["0", "false", "off"].includes(
  String(arg("--health-preflight", process.env.MOBILE_SOAK_HEALTH_PREFLIGHT || "true")).trim().toLowerCase(),
);
const HEALTHCHECK_TIMEOUT_MS = Math.max(
  100,
  Number(arg("--health-timeout-ms", process.env.MOBILE_SOAK_HEALTH_TIMEOUT_MS || "1200")),
);
const HEALTHCHECK_URL = arg("--health-url", process.env.MOBILE_SOAK_HEALTH_URL || `${API_BASE_URL}/health`);

const { PNG } = pngjs;
const SCREENSHOT_NOISE_CHECKPOINTS = new Set(["result_rev0", "result_rev1", "final_done"]);
const REFRESHING_RECAPTURE_MAX_RETRIES = 2;
const REFRESHING_RECAPTURE_WAIT_MS = 900;
const REFRESHING_HSV_HUE_MIN = 185;
const REFRESHING_HSV_HUE_MAX = 220;
const REFRESHING_HSV_SAT_MIN = 0.4;
const REFRESHING_HSV_VAL_MIN = 0.4;
const REFRESHING_TOP_AREA_PX = 96;
const REFRESHING_BLUE_RATIO_THRESHOLD = 0.45;
const DEBUG_TOAST_OCR_PATTERNS = [
  "open debugger to view warnings",
  "[sse] error",
  "sse error",
  "sse] error",
  "\"type\":\"error\"",
  "scan failed",
  "connection issue",
  "could not connect to the server",
  "unable to connect while analyzing",
  "we lost connection while analyzing",
];
const DEBUG_TOAST_OCR_REGEX = [
  /\[\s*sse\s*\]\s*error/i,
  /\bsse\b.*\berror\b/i,
  /\bopen\s+debugger\b.*\bwarnings\b/i,
];
const DEBUG_TOAST_BOTTOM_CROP_RATIO = 0.4;
const DEBUG_TOAST_BOTTOM_MIN_HEIGHT_PX = 220;
const SCREENSHOT_CAPTURE_TIMEOUT_MS = 8000;
const OPEN_RESULT_TIMEOUT_MS = 5000;
const TESSERACT_AVAILABLE = (() => {
  const proc = spawnSync("bash", ["-lc", "command -v tesseract"], {
    cwd: ROOT_DIR,
    encoding: "utf8",
  });
  return proc.status === 0;
})();

const ensureDir = async (dirPath) => {
  await fs.mkdir(dirPath, { recursive: true });
};

const sleep = (ms) =>
  new Promise((resolve) => {
    setTimeout(resolve, Math.max(0, ms));
  });

const normalizeBarcode = (value) => {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length >= 14) return digits.slice(-14);
  return digits.padStart(14, "0");
};

const KILLER_BARCODE = normalizeBarcode(
  arg(
    "--killer-barcode",
    DEFAULT_BARCODES.find((entry) => entry.role === "killer")?.barcode || "00665553227870",
  ),
);

const normalizeText = (value) => (typeof value === "string" ? value.trim() : "");
const DECISION_SUPPORT_VERDICTS = [
  "strong_candidate",
  "reasonable_but_incomplete",
  "hard_to_recommend_until_label_verified",
];
const normalizeDecisionSupportVerdict = (value) => {
  const text = normalizeText(value);
  return DECISION_SUPPORT_VERDICTS.includes(text) ? text : null;
};
const hasVerifiedUnverifiedConflict = ({ sourceAttribution, moduleValue }) => {
  if (!(sourceAttribution === "verified_regulatory" || sourceAttribution === "label_record")) {
    return false;
  }
  if (!moduleValue || typeof moduleValue !== "object") return false;
  const sections = ["overview", "science", "usage", "safety"];
  for (const key of sections) {
    const lines = Array.isArray(moduleValue?.[key]?.lines) ? moduleValue[key].lines : [];
    for (const line of lines) {
      const text = normalizeText(line).toLowerCase();
      if (!text) continue;
      if (
        text.includes("unverified web hint")
        || text.includes("web evidence budget was reached")
        || (text.includes("shown in limited mode") && text.includes("unverified"))
      ) {
        return true;
      }
    }
  }
  return false;
};
const unwrapScoreBundle = (value) => {
  if (!value || typeof value !== "object") return null;
  if (value.bundle && typeof value.bundle === "object") return value.bundle;
  return value;
};
const resolveMetaProductIdentity = (meta) => {
  const row = meta?.productIdentity;
  if (!row || typeof row !== "object") return null;
  const sourceAttribution = normalizeText(row.sourceAttribution).toLowerCase();
  const normalizedAttribution =
    sourceAttribution === "verified_regulatory"
    || sourceAttribution === "label_record"
    || sourceAttribution === "web_hint_unverified"
      ? sourceAttribution
      : "unknown";
  const name = normalizeText(row.name);
  const brand = normalizeText(row.brand);
  const sourceId = normalizeText(row.sourceId);
  const identityStable = row.identityStable === true;
  if (!name && !brand && !sourceId && normalizedAttribution === "unknown") return null;
  return {
    name: name || null,
    brand: brand || null,
    sourceAttribution: normalizedAttribution,
    identityStable,
    sourceId: sourceId || null,
  };
};
const resolveSourceAttribution = (meta) => {
  const productIdentity = resolveMetaProductIdentity(meta);
  if (productIdentity?.sourceAttribution && productIdentity.sourceAttribution !== "unknown") {
    return productIdentity.sourceAttribution;
  }
  const winnerAttribution = normalizeStage0WinnerAttribution(meta?.stage0Winner);
  const replaceCountRaw = Number(meta?.stage0ReplaceCount);
  const replaceCount = Number.isFinite(replaceCountRaw) ? replaceCountRaw : null;
  if (
    (winnerAttribution === "verified_regulatory" || winnerAttribution === "label_record")
    && (replaceCount == null || replaceCount === 0)
  ) {
    return winnerAttribution;
  }
  const sourceType = normalizeText(meta?.sourceType).toLowerCase();
  if (sourceType === "lnhpd" || sourceType === "dsld") return "verified_regulatory";
  if (sourceType === "label" || sourceType === "label_scan") return "label_record";
  if (sourceType === "web") return "web_hint_unverified";
  return "unknown";
};
const resolveSourceTypeFinal = (meta) => {
  if (meta?.sourceTypeFinal === true) return true;
  if (meta?.sourceTypeFinal === false) return false;
  const revision = Number(meta?.revision);
  return Number.isFinite(revision) && revision >= 1;
};
const normalizeStage0WinnerAttribution = (winnerRaw) => {
  const winner = normalizeText(winnerRaw).toLowerCase();
  if (!winner) return "unknown";
  if (
    winner.includes("verified_regulatory")
    || winner.includes("lnhpd")
    || winner.includes("dsld")
    || winner.includes("regulatory")
  ) {
    return "verified_regulatory";
  }
  if (winner.includes("label")) return "label_record";
  if (winner.includes("web")) return "web_hint_unverified";
  return "unknown";
};
const isTrustedStableForAttempt = (meta, sourceAttribution) => {
  if (!(sourceAttribution === "verified_regulatory" || sourceAttribution === "label_record")) {
    return false;
  }
  const productIdentity = resolveMetaProductIdentity(meta);
  if (
    productIdentity
    && productIdentity.identityStable
    && productIdentity.sourceAttribution === sourceAttribution
  ) {
    return true;
  }
  if (resolveSourceTypeFinal(meta)) return true;
  const replaceCountRaw = Number(meta?.stage0ReplaceCount);
  const replaceCount = Number.isFinite(replaceCountRaw) ? replaceCountRaw : null;
  if (replaceCount !== null && replaceCount !== 0) return false;
  return normalizeStage0WinnerAttribution(meta?.stage0Winner) === sourceAttribution;
};
const resolveDisplayIdentityForAttempt = ({ meta, productName, barcode }) => {
  const productIdentity = resolveMetaProductIdentity(meta);
  const sourceAttribution = resolveSourceAttribution(meta);
  const sourceTypeFinal = resolveSourceTypeFinal(meta);
  const trusted = sourceAttribution === "verified_regulatory" || sourceAttribution === "label_record";
  const trustedStable = isTrustedStableForAttempt(meta, sourceAttribution);
  const safeName = normalizeText(productIdentity?.name || productName);
  const safeSubtitle = normalizeText(productIdentity?.brand);
  const explicitIdentityStable = productIdentity?.identityStable === true;
  const trustedRegulatoryEarly =
    sourceAttribution === "verified_regulatory"
    && Boolean(safeName)
    && (
      explicitIdentityStable
      || trustedStable
      || !productIdentity
      || productIdentity.sourceAttribution === "verified_regulatory"
    );
  const trustedLabelStable =
    sourceAttribution === "label_record"
    && Boolean(safeName)
    && (explicitIdentityStable || trustedStable);
  const trustedDisplayReady = trustedRegulatoryEarly || trustedLabelStable;
  const identityPending =
    sourceAttribution === "unknown"
    || (sourceAttribution === "web_hint_unverified" && !sourceTypeFinal)
    || (sourceAttribution === "label_record" && Boolean(safeName) && !trustedStable)
    || (trusted && !safeName);
  if (trustedDisplayReady) {
    return {
      title: safeName,
      subtitle: safeSubtitle || "",
      displayIdentityMode: "trusted",
      sourceAttributionUsed: sourceAttribution,
      titleSanitized: false,
      identityPending,
      trustedStable: trustedStable || explicitIdentityStable,
    };
  }
  if (identityPending) {
    const authoritativeBarcode = normalizeBarcode(barcode) || normalizeBarcode(meta?.authoritativeIdentity?.value);
    return {
      title: "Analyzing barcode...",
      subtitle: authoritativeBarcode ? `UPC: ${authoritativeBarcode}` : "Identifying product details.",
      displayIdentityMode: "pending",
      sourceAttributionUsed: sourceAttribution,
      titleSanitized: true,
      identityPending: true,
      trustedStable: false,
    };
  }
  if (normalizeBarcode(barcode) || normalizeBarcode(meta?.authoritativeIdentity?.value)) {
    const authoritativeBarcode = normalizeBarcode(barcode) || normalizeBarcode(meta?.authoritativeIdentity?.value);
    return {
      title: "Unverified barcode",
      subtitle: authoritativeBarcode ? `UPC: ${authoritativeBarcode} (unverified)` : "Unknown product (unverified)",
      displayIdentityMode: "unverified",
      sourceAttributionUsed: sourceAttribution,
      titleSanitized: true,
      identityPending,
      trustedStable: false,
    };
  }
  return {
    title: "Unknown product",
    subtitle: "Unknown product (unverified)",
    displayIdentityMode: "unverified",
    sourceAttributionUsed: sourceAttribution,
    titleSanitized: true,
    identityPending,
    trustedStable: false,
  };
};

const OCR_TEXT_CACHE = new Map();
const readOcrText = (targetPath) => {
  if (!TESSERACT_AVAILABLE) return "";
  if (OCR_TEXT_CACHE.has(targetPath)) return OCR_TEXT_CACHE.get(targetPath);
  try {
    const proc = spawnSync("tesseract", [targetPath, "stdout"], {
      cwd: ROOT_DIR,
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
    });
    if (proc.status !== 0) {
      OCR_TEXT_CACHE.set(targetPath, "");
      return "";
    }
    const text = String(proc.stdout || "").toLowerCase();
    OCR_TEXT_CACHE.set(targetPath, text);
    return text;
  } catch {
    OCR_TEXT_CACHE.set(targetPath, "");
    return "";
  }
};

const readBottomOcrText = (targetPath) => {
  if (!TESSERACT_AVAILABLE) return "";
  const cacheKey = `${targetPath}::bottom`;
  if (OCR_TEXT_CACHE.has(cacheKey)) return OCR_TEXT_CACHE.get(cacheKey);
  try {
    const raw = fsSync.readFileSync(targetPath);
    const png = PNG.sync.read(raw);
    const width = Number(png.width || 0);
    const height = Number(png.height || 0);
    if (width <= 0 || height <= 0) {
      OCR_TEXT_CACHE.set(cacheKey, "");
      return "";
    }
    const cropHeight = Math.max(DEBUG_TOAST_BOTTOM_MIN_HEIGHT_PX, Math.floor(height * DEBUG_TOAST_BOTTOM_CROP_RATIO));
    const startY = Math.max(0, height - cropHeight);
    const outPng = new PNG({ width, height: height - startY });
    for (let y = 0; y < outPng.height; y += 1) {
      const srcOffset = ((startY + y) * width) * 4;
      const destOffset = (y * width) * 4;
      png.data.copy(outPng.data, destOffset, srcOffset, srcOffset + width * 4);
    }
    const tempPath = path.join(
      os.tmpdir(),
      `mobile-soak-bottom-ocr-${crypto.createHash("sha1").update(targetPath).digest("hex")}.png`,
    );
    fsSync.writeFileSync(tempPath, PNG.sync.write(outPng));
    const proc = spawnSync("tesseract", [tempPath, "stdout"], {
      cwd: ROOT_DIR,
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
    });
    fsSync.unlinkSync(tempPath);
    if (proc.status !== 0) {
      OCR_TEXT_CACHE.set(cacheKey, "");
      return "";
    }
    const text = String(proc.stdout || "").toLowerCase();
    OCR_TEXT_CACHE.set(cacheKey, text);
    return text;
  } catch {
    OCR_TEXT_CACHE.set(cacheKey, "");
    return "";
  }
};

const rgbToHsv = (r, g, b) => {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const delta = max - min;
  let hue = 0;
  if (delta !== 0) {
    if (max === rn) hue = ((gn - bn) / delta) % 6;
    else if (max === gn) hue = (bn - rn) / delta + 2;
    else hue = (rn - gn) / delta + 4;
    hue *= 60;
    if (hue < 0) hue += 360;
  }
  const sat = max === 0 ? 0 : delta / max;
  const val = max;
  return { hue, sat, val };
};

const detectRefreshingBanner = async (targetPath) => {
  try {
    const raw = await fs.readFile(targetPath);
    const png = PNG.sync.read(raw);
    const width = Number(png.width || 0);
    const height = Number(png.height || 0);
    if (width <= 0 || height <= 0) return false;
    const scanRows = Math.min(REFRESHING_TOP_AREA_PX, height);
    let opaqueCount = 0;
    let blueCount = 0;
    for (let y = 0; y < scanRows; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const idx = (width * y + x) * 4;
        const r = png.data[idx];
        const g = png.data[idx + 1];
        const b = png.data[idx + 2];
        const a = png.data[idx + 3];
        if (a < 220) continue;
        opaqueCount += 1;
        const hsv = rgbToHsv(r, g, b);
        if (
          hsv.hue >= REFRESHING_HSV_HUE_MIN
          && hsv.hue <= REFRESHING_HSV_HUE_MAX
          && hsv.sat > REFRESHING_HSV_SAT_MIN
          && hsv.val > REFRESHING_HSV_VAL_MIN
        ) {
          blueCount += 1;
        }
      }
    }
    if (opaqueCount === 0) return false;
    return blueCount / opaqueCount >= REFRESHING_BLUE_RATIO_THRESHOLD;
  } catch {
    return false;
  }
};

const detectExpoStaticHintByOcr = (targetPath) => {
  const text = readOcrText(targetPath);
  return text.includes("expo go static mode");
};

const detectDebugToastByOcr = (targetPath) => {
  const fullText = readOcrText(targetPath);
  const bottomText = readBottomOcrText(targetPath);
  const candidate = `${fullText}\n${bottomText}`;
  if (!candidate.trim()) return false;
  if (DEBUG_TOAST_OCR_PATTERNS.some((pattern) => candidate.includes(pattern))) return true;
  return DEBUG_TOAST_OCR_REGEX.some((pattern) => pattern.test(candidate));
};

const toPct = (value) => (Number.isFinite(value) ? Number(value * 100).toFixed(2) : "n/a");

const percentile = (values, p) => {
  if (!Array.isArray(values) || values.length === 0) return null;
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[idx];
};

const loadJsonSafe = async (filePath) => {
  if (!filePath) return null;
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

const resolveBarcodes = async () => {
  const sourceFile = BARCODES_JSON
    ? path.isAbsolute(BARCODES_JSON)
      ? BARCODES_JSON
      : path.join(ROOT_DIR, BARCODES_JSON)
    : "";
  const payload = await loadJsonSafe(sourceFile);
  if (Array.isArray(payload)) {
    return payload
      .map((entry) => {
        if (typeof entry === "string" || typeof entry === "number") {
          return { role: "unknown", barcode: normalizeBarcode(entry) };
        }
        return {
          role: String(entry?.role || "unknown"),
          barcode: normalizeBarcode(entry?.barcode),
        };
      })
      .filter((entry) => entry.barcode);
  }
  if (payload && Array.isArray(payload.barcodes)) {
    return payload.barcodes
      .map((entry) => ({
        role: String(entry.role || "unknown"),
        barcode: normalizeBarcode(entry.barcode),
      }))
      .filter((entry) => entry.barcode);
  }
  return DEFAULT_BARCODES.map((entry) => ({ ...entry, barcode: normalizeBarcode(entry.barcode) }));
};

const captureScreenshot = async ({ enabled, udid, targetPath }) => {
  if (!enabled) return false;
  try {
    await ensureDir(path.dirname(targetPath));
    const proc = spawnSync("xcrun", ["simctl", "io", udid, "screenshot", targetPath], {
      cwd: ROOT_DIR,
      encoding: "utf8",
      timeout: SCREENSHOT_CAPTURE_TIMEOUT_MS,
      killSignal: "SIGKILL",
    });
    return proc.status === 0;
  } catch {
    return false;
  }
};

const openResultScreen = async ({ udid, barcode, attemptTag }) => {
  const routePath = String(RESULT_ROUTE_PATH || "scan/result").replace(/^\/+/, "");
  const params = new URLSearchParams({
    devBarcode: barcode,
    sessionId: attemptTag,
  });
  const deepLink = `${APP_SCHEME}://${routePath}?${params.toString()}`;
  try {
    const proc = spawnSync("xcrun", ["simctl", "openurl", udid, deepLink], {
      cwd: ROOT_DIR,
      encoding: "utf8",
      timeout: OPEN_RESULT_TIMEOUT_MS,
      killSignal: "SIGKILL",
    });
    if (proc.status !== 0) {
      return {
        ok: false,
        deepLink,
        error: (proc.stderr || proc.stdout || "").trim() || `openurl_exit_${proc.status}`,
      };
    }
    return {
      ok: true,
      deepLink,
      error: null,
    };
  } catch (error) {
    return {
      ok: false,
      deepLink,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};

const rebootSimulator = ({ udid }) => {
  if (!udid) return { ok: false, step: "missing_udid" };
  const shutdown = spawnSync("xcrun", ["simctl", "shutdown", udid], {
    cwd: ROOT_DIR,
    encoding: "utf8",
  });
  const boot = spawnSync("xcrun", ["simctl", "boot", udid], {
    cwd: ROOT_DIR,
    encoding: "utf8",
  });
  const bootStatus = spawnSync("xcrun", ["simctl", "bootstatus", udid, "-b"], {
    cwd: ROOT_DIR,
    encoding: "utf8",
  });
  return {
    ok: (shutdown.status === 0 || shutdown.status === 149 || shutdown.status === 164)
      && (boot.status === 0 || boot.status === 149 || boot.status === 164)
      && bootStatus.status === 0,
    shutdownCode: shutdown.status,
    bootCode: boot.status,
    bootStatusCode: bootStatus.status,
  };
};

const buildHeaders = () => {
  const regressionToken = process.env.RENDER_REGRESSION_TOKEN || process.env.REGRESSION_AUTH_TOKEN || "";
  return {
    "Content-Type": "application/json",
    Accept: "text/event-stream",
    ...(regressionToken ? { "x-regression-token": regressionToken } : { "x-auth-disabled": "1" }),
  };
};

const buildJsonHeaders = () => {
  const regressionToken = process.env.RENDER_REGRESSION_TOKEN || process.env.REGRESSION_AUTH_TOKEN || "";
  return {
    Accept: "application/json",
    ...(regressionToken ? { "x-regression-token": regressionToken } : { "x-auth-disabled": "1" }),
  };
};

const parseNumericAmount = (value) => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return { value, unit: null, text: String(value) };
  }
  if (value && typeof value === "object") {
    const parsedValue = Number(value.value);
    const unit = normalizeText(value.unit).toLowerCase();
    const text = normalizeText(value.text) || (Number.isFinite(parsedValue) ? String(parsedValue) : "");
    return {
      value: Number.isFinite(parsedValue) ? parsedValue : null,
      unit: unit || null,
      text: text || null,
    };
  }
  const text = normalizeText(value);
  if (!text) return { value: null, unit: null, text: null };
  const match = text.match(/(-?\d+(?:\.\d+)?)\s*(mcg|μg|µg|ug|mg|g|iu|ml)?/i);
  const amount = match ? Number(match[1]) : Number.NaN;
  const unit = match?.[2] ? normalizeText(match[2]).toLowerCase() : null;
  return {
    value: Number.isFinite(amount) ? amount : null,
    unit,
    text,
  };
};

const normalizeUlRiskBand = (value) => {
  const normalized = normalizeText(value).toLowerCase();
  if (normalized === "low" || normalized === "moderate" || normalized === "high") return normalized;
  return "unknown";
};

const normalizeUlScope = (value) => {
  const normalized = normalizeText(value).toLowerCase();
  if (normalized === "total_intake") return "total_intake";
  if (normalized === "supplements_only") return "supplements_only";
  if (normalized === "supplements_or_fortified_only") return "supplements_or_fortified_only";
  return "unknown";
};

const normalizeUlEvidenceSource = (reasonCodeRaw) => {
  const reasonCode = normalizeText(reasonCodeRaw).toUpperCase();
  if (reasonCode === "ODS_UL_MATCHED") return "NIH_ODS_UL";
  if (reasonCode === "LEGACY_UL_META_MATCHED") return "LEGACY_UL_META";
  return "UNKNOWN";
};

const inferUlNutrientKey = (row) => {
  const raw =
    normalizeText(row?.ingredientCanonicalKey)
    || normalizeText(row?.nutrientKey)
    || normalizeText(row?.displayName)
    || normalizeText(row?.ingredient)
    || normalizeText(row?.ingredientName)
    || normalizeText(row?.name);
  if (!raw) return "unknown_nutrient";
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80) || "unknown_nutrient";
};

const extractScoreUlRows = (scoreInfo) => {
  const scoreBundle = unwrapScoreBundle(scoreInfo);
  if (!scoreBundle || typeof scoreBundle !== "object") return [];
  const explain = scoreBundle.explain;
  if (!explain || typeof explain !== "object") return [];
  const rootUl = explain.ulWarnings;
  if (Array.isArray(rootUl)) return rootUl;
  if (rootUl && typeof rootUl === "object" && Array.isArray(rootUl.entries)) {
    return rootUl.entries;
  }
  const nested = explain.safety?.ulWarnings;
  if (Array.isArray(nested)) return nested;
  if (nested && typeof nested === "object" && Array.isArray(nested.entries)) {
    return nested.entries;
  }
  return [];
};

const buildObservedUlEntriesFromScore = (scoreInfo) => {
  const rows = extractScoreUlRows(scoreInfo);
  const out = [];
  const seen = new Set();
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const displayName = normalizeText(row.displayName || row.ingredient || row.ingredientName || row.name);
    const currentDailyAmount = parseNumericAmount(
      row.currentDailyAmount || row.currentDose || row.dailyAmount || row.dose,
    );
    const ulDailyAmount = parseNumericAmount(
      row.ulDailyAmount || row.ulLimit || row.upperLimit || row.limit,
    );
    if (currentDailyAmount.value == null || ulDailyAmount.value == null) continue;
    const nutrientKey = inferUlNutrientKey(row);
    const riskBand = normalizeUlRiskBand(row.riskBand || row.riskLevel || row.risk || row.severity);
    const scope = normalizeUlScope(row.scope);
    const reasonCode = normalizeText(row.reasonCode || row.reason);
    const sourceUrl = normalizeText(row.sourceUrl || row.sourceURL || row.url);
    const explainLine = [
      `${displayName || nutrientKey.replace(/_/g, " ")}: current ${currentDailyAmount.text}`,
      `UL ${ulDailyAmount.text}`,
      riskBand !== "unknown" ? `${riskBand} risk` : "",
    ]
      .filter(Boolean)
      .join(" | ");
    const dedupeKey = `${nutrientKey}|${explainLine.toLowerCase()}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    out.push({
      id: `ul-entry-${nutrientKey}-${out.length + 1}`,
      nutrientKey,
      displayName: displayName || nutrientKey.replace(/_/g, " "),
      currentDailyAmount,
      ulDailyAmount,
      riskBand,
      scope,
      evidenceSource: normalizeUlEvidenceSource(reasonCode),
      explainLine,
      ...(reasonCode ? { reasonCode } : {}),
      ...(sourceUrl ? { sourceUrl } : {}),
    });
    if (out.length >= 3) break;
  }
  return out;
};

const withObservedUlEntries = (analysisBundle, scoreInfo) => {
  if (!analysisBundle || typeof analysisBundle !== "object") return analysisBundle;
  const existingSignals = analysisBundle?.sections?.safety?.signals;
  const existingUlEntries = Array.isArray(existingSignals?.ulEntries) ? existingSignals.ulEntries : [];
  if (existingUlEntries.length > 0) return analysisBundle;

  const ulEntries = buildObservedUlEntriesFromScore(scoreInfo);
  if (!ulEntries.length) return analysisBundle;

  const baseSignals =
    existingSignals && typeof existingSignals === "object"
      ? existingSignals
      : {
        schemaVersion: 1,
        labelWarnings: [],
        ulSignals: [],
        odsInteractions: [],
        odsWatchouts: [],
        qualityNotes: [],
      };
  return {
    ...analysisBundle,
    sections: {
      ...analysisBundle.sections,
      safety: {
        ...analysisBundle.sections?.safety,
        signals: {
          ...baseSignals,
          ulEntries,
        },
      },
    },
  };
};

const classifyTimeoutClass = ({ terminalReason, requestError, sseConnected, sseEventCount, doneSeen }) => {
  if (doneSeen) return "NONE";
  const terminal = normalizeText(terminalReason).toUpperCase();
  if (terminal !== "CLIENT_TIMEOUT") return "NONE";
  const errorText = normalizeText(requestError).toLowerCase();
  const connectError =
    !sseConnected
    || Number(sseEventCount || 0) === 0
    || /fetch failed|failed to fetch|network|econn|enotfound|eai_again|could not connect|xhrstatus[:=]\\s*0|socket hang up|sse_body_missing|http_/.test(
      errorText,
    );
  return connectError ? "SSE_CONNECT_FAILED" : "SSE_CONNECTED_BUT_NO_DONE";
};

const runHealthPreflight = async () => {
  if (!HEALTH_PREFLIGHT_ENABLED) {
    return {
      ok: true,
      skipped: true,
      status: null,
      url: HEALTHCHECK_URL,
      elapsedMs: 0,
      error: null,
    };
  }
  const started = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error(`health_timeout_${HEALTHCHECK_TIMEOUT_MS}ms`)), HEALTHCHECK_TIMEOUT_MS);
  try {
    const res = await fetch(HEALTHCHECK_URL, {
      method: "GET",
      headers: buildJsonHeaders(),
      signal: controller.signal,
    });
    return {
      ok: res.ok,
      skipped: false,
      status: res.status,
      url: HEALTHCHECK_URL,
      elapsedMs: Date.now() - started,
      error: res.ok ? null : `http_${res.status}`,
    };
  } catch (error) {
    return {
      ok: false,
      skipped: false,
      status: null,
      url: HEALTHCHECK_URL,
      elapsedMs: Date.now() - started,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timeout);
  }
};

const resolveScoreQueryFromBundleMeta = (meta) => {
  if (!meta || typeof meta !== "object") return null;
  const revisionReady = typeof meta.revision !== "number" || meta.revision >= 1;
  if (!revisionReady) return null;

  const authoritative = meta.authoritativeIdentity;
  const authoritativeType = typeof authoritative?.type === "string" ? authoritative.type : null;
  const authoritativeValue =
    typeof authoritative?.value === "string" && authoritative.value.trim().length > 0
      ? authoritative.value.trim()
      : null;

  if (authoritativeType === "npn" && authoritativeValue) {
    return { source: "lnhpd", sourceId: authoritativeValue };
  }
  if (authoritativeType === "dsldLabelId" && authoritativeValue) {
    return { source: "dsld", sourceId: authoritativeValue };
  }

  const sourceTypeFinal = meta.sourceTypeFinal !== false;
  if (!sourceTypeFinal) return null;
  const fallbackReason = typeof meta.fallbackReason === "string" ? meta.fallbackReason.toLowerCase() : "";
  if (
    fallbackReason.includes("needs_js")
    || fallbackReason.includes("ownership_unverified")
    || fallbackReason.includes("web_text_unusable")
  ) {
    return null;
  }
  const sourceType = meta.sourceType;
  if (
    sourceType === "lnhpd"
    && authoritative?.type === "npn"
    && typeof authoritative.value === "string"
    && authoritative.value.trim()
  ) {
    return { source: "lnhpd", sourceId: authoritative.value.trim() };
  }
  if (
    sourceType === "dsld"
    && authoritative?.type === "dsldLabelId"
    && typeof authoritative.value === "string"
    && authoritative.value.trim()
  ) {
    return { source: "dsld", sourceId: authoritative.value.trim() };
  }
  return null;
};

const SCORE_FETCH_CACHE = new Map();
const fetchScoreInfo = async ({ meta }) => {
  const query = resolveScoreQueryFromBundleMeta(meta);
  if (!query) {
    return {
      scoreInfo: null,
      scoreQueryInitiated: false,
      scoreResponseStatus: "not_initiated",
      scoreResponseReasonCode: null,
      scoreQuerySource: null,
      scoreQuerySourceId: null,
    };
  }
  const cacheKey = `${query.source}:${query.sourceId}`;
  if (SCORE_FETCH_CACHE.has(cacheKey)) {
    return SCORE_FETCH_CACHE.get(cacheKey);
  }
  const run = (async () => {
    const baseResult = {
      scoreInfo: null,
      scoreQueryInitiated: true,
      scoreResponseStatus: "error",
      scoreResponseReasonCode: null,
      scoreQuerySource: query.source,
      scoreQuerySourceId: query.sourceId,
    };
    try {
      const res = await fetch(
        `${API_BASE_URL}/api/score/v4/${encodeURIComponent(query.source)}/${encodeURIComponent(query.sourceId)}`,
        {
          method: "GET",
          headers: buildJsonHeaders(),
        },
      );
      const payload = await res.json().catch(() => null);
      const payloadObject = payload && typeof payload === "object" ? payload : null;
      const payloadStatus = normalizeText(payloadObject?.status).toLowerCase();
      const payloadBundle = payloadObject?.bundle && typeof payloadObject.bundle === "object" ? payloadObject.bundle : null;
      const payloadScore = payloadObject?.score && typeof payloadObject.score === "object" ? payloadObject.score : null;
      const scoreInfo = payloadScore || payloadBundle || payloadObject;
      const responseReasonCode = normalizeText(
        payloadObject?.reasonCode
        || payloadScore?.reasonCode
        || payloadObject?.error?.reasonCode
        || payloadObject?.code,
      ) || null;

      if (!res.ok) {
        if (res.status === 404 || payloadStatus === "not_found") {
          return {
            ...baseResult,
            scoreInfo,
            scoreResponseStatus: "not_found",
            scoreResponseReasonCode: responseReasonCode,
          };
        }
        if (res.status === 202 || payloadStatus === "pending") {
          return {
            ...baseResult,
            scoreInfo,
            scoreResponseStatus: "pending",
            scoreResponseReasonCode: responseReasonCode,
          };
        }
        return {
          ...baseResult,
          scoreInfo,
          scoreResponseStatus: "error",
          scoreResponseReasonCode: responseReasonCode || `http_${res.status}`,
        };
      }

      if (payloadStatus === "pending") {
        return {
          ...baseResult,
          scoreInfo,
          scoreResponseStatus: "pending",
          scoreResponseReasonCode: responseReasonCode,
        };
      }
      if (payloadStatus === "not_found") {
        return {
          ...baseResult,
          scoreInfo,
          scoreResponseStatus: "not_found",
          scoreResponseReasonCode: responseReasonCode,
        };
      }

      const successScoreInfo = scoreInfo && typeof scoreInfo === "object" ? scoreInfo : null;
      if (payloadStatus === "ok" || successScoreInfo) {
        return {
          ...baseResult,
          scoreInfo: successScoreInfo,
          scoreResponseStatus: "ok",
          scoreResponseReasonCode: responseReasonCode,
        };
      }

      return {
        ...baseResult,
        scoreInfo: successScoreInfo,
        scoreResponseStatus: "error",
        scoreResponseReasonCode: responseReasonCode,
      };
    } catch {
      return baseResult;
    }
  })();
  SCORE_FETCH_CACHE.set(cacheKey, run);
  return run;
};

const DECISION_SUPPORT_FETCH_CACHE = new Map();
const fetchDecisionSupportInfo = async ({ barcode, meta }) => {
  const normalizedBarcode = normalizeBarcode(barcode) || normalizeBarcode(meta?.authoritativeIdentity?.value);
  if (!normalizedBarcode) {
    return {
      decisionSupportVerdict: null,
      decisionSupportTopBlockerCodes: [],
      decisionSupportDigest: null,
      decisionSupportFetchStatus: "not_requested",
      decisionSupportAutoRetryUsed: false,
    };
  }

  const digestHint = normalizeText(meta?.decisionSupportDigest) || null;
  const cacheKey = `${normalizedBarcode}:${DECISION_SUPPORT_VIEW_MODE}:${digestHint || "no_digest"}`;
  if (DECISION_SUPPORT_FETCH_CACHE.has(cacheKey)) {
    return DECISION_SUPPORT_FETCH_CACHE.get(cacheKey);
  }

  const run = (async () => {
    const doFetch = async (digest) => {
      const params = new URLSearchParams({
        barcode: normalizedBarcode,
        viewMode: DECISION_SUPPORT_VIEW_MODE,
      });
      if (digest) params.set("digest", digest);
      try {
        const res = await fetch(`${API_BASE_URL}/api/decision-support/v1?${params.toString()}`, {
          method: "GET",
          headers: buildJsonHeaders(),
        });
        const payload = await res.json().catch(() => null);
        return {
          ok: res.ok,
          status: res.status,
          payload: payload && typeof payload === "object" ? payload : null,
        };
      } catch (error) {
        return {
          ok: false,
          status: 0,
          payload: {
            error: error instanceof Error ? error.message : String(error),
          },
        };
      }
    };

    let autoRetryUsed = false;
    let response = await doFetch(digestHint);
    if (!response.ok && response.status === 409) {
      const latestDigest = normalizeText(response?.payload?.latestDigest) || null;
      if (latestDigest) {
        autoRetryUsed = true;
        response = await doFetch(latestDigest);
      }
    }

    if (!response.ok) {
      return {
        decisionSupportVerdict: null,
        decisionSupportTopBlockerCodes: [],
        decisionSupportDigest: null,
        decisionSupportFetchStatus: response.status === 409 ? "digest_mismatch" : "error",
        decisionSupportAutoRetryUsed: autoRetryUsed,
      };
    }

    const verdict = normalizeDecisionSupportVerdict(response?.payload?.verdict);
    const topBlockers = Array.isArray(response?.payload?.topBlockers)
      ? response.payload.topBlockers
      : [];
    const topBlockerCodes = topBlockers
      .map((row) => normalizeText(row?.code))
      .filter(Boolean)
      .slice(0, 5);

    return {
      decisionSupportVerdict: verdict,
      decisionSupportTopBlockerCodes: topBlockerCodes,
      decisionSupportDigest: normalizeText(response?.payload?.digest) || digestHint,
      decisionSupportFetchStatus: "ok",
      decisionSupportAutoRetryUsed: autoRetryUsed,
    };
  })();

  DECISION_SUPPORT_FETCH_CACHE.set(cacheKey, run);
  return run;
};

const FACTS_FETCH_CACHE = new Map();
const fetchFactsProbe = async ({ source, sourceId }) => {
  const normalizedSource = normalizeText(source).toLowerCase();
  const normalizedSourceId = normalizeText(sourceId);
  if (!normalizedSource || !normalizedSourceId) {
    return {
      factsStatus: "not_requested",
      factsReason: "missing_source_or_id",
      activeCountWithDose: 0,
      servingSizePresent: false,
      payload: null,
    };
  }
  const cacheKey = `${normalizedSource}:${normalizedSourceId}`;
  if (FACTS_FETCH_CACHE.has(cacheKey)) {
    return FACTS_FETCH_CACHE.get(cacheKey);
  }
  const run = (async () => {
    try {
      const res = await fetch(
        `${API_BASE_URL}/api/scan-facts/v1/${encodeURIComponent(normalizedSource)}/${encodeURIComponent(normalizedSourceId)}`,
        {
          method: "GET",
          headers: buildJsonHeaders(),
        },
      );
      const payload = await res.json().catch(() => null);
      const payloadObject = payload && typeof payload === "object" ? payload : null;
      const factsRoot = payloadObject?.facts && typeof payloadObject.facts === "object"
        ? payloadObject.facts
        : payloadObject;
      const activeRows = Array.isArray(factsRoot?.ingredients?.actives) ? factsRoot.ingredients.actives : [];
      const activeCountWithDose = activeRows.filter((row) => {
        if (!row || typeof row !== "object") return false;
        const amountText = normalizeText(row.amount || row.amountText || row.dose || row.quantity);
        const unitText = normalizeText(row.unit || row.amountUnit || row.doseUnit);
        return Boolean(amountText || unitText);
      }).length;
      const servingSizePresent = Boolean(
        normalizeText(
          factsRoot?.serving?.servingSizeText
          || factsRoot?.servingSizeText
          || factsRoot?.serving?.text
          || factsRoot?.serving?.amount,
        ),
      );
      if (!res.ok) {
        return {
          factsStatus: res.status === 404 ? "not_found" : "error",
          factsReason: `http_${res.status}`,
          activeCountWithDose,
          servingSizePresent,
          payload: payloadObject,
        };
      }
      return {
        factsStatus: "ok",
        factsReason: null,
        activeCountWithDose,
        servingSizePresent,
        payload: payloadObject,
      };
    } catch (error) {
      return {
        factsStatus: "error",
        factsReason: error instanceof Error ? error.message : String(error),
        activeCountWithDose: 0,
        servingSizePresent: false,
        payload: null,
      };
    }
  })();
  FACTS_FETCH_CACHE.set(cacheKey, run);
  return run;
};

const resolveAttemptRoute = ({ doneSeen, terminalReason, errorReasonCode, errorCode, requestError }) => {
  const reasons = [
    normalizeText(terminalReason).toUpperCase(),
    normalizeText(errorReasonCode).toUpperCase(),
    normalizeText(errorCode).toUpperCase(),
  ]
    .filter(Boolean)
    .join(" ");
  if (/\bNOT_FOUND\b/.test(reasons)) return "not_found";
  if (doneSeen) return "dashboard";
  if (requestError || reasons) return "recoverable_error";
  return "recoverable_error";
};

const isDegradedTerminalReason = (value) => normalizeText(value).toUpperCase().startsWith("DEGRADED_");

const parseSseStream = async ({ barcode, headers, timeoutMs, screenshotCtx }) => {
  const startedAt = Date.now();
  let requestStartedAt = null;
  const payload = {
    barcode,
    streamMode: "analysis_bundle_only",
    clientVersion: "mobile-soak-v1.6.3",
  };

  let rev0Seen = false;
  let rev1Seen = false;
  let doneSeen = false;
  let timedOut = false;
  let requestError = null;
  let donePayload = null;
  let errorPayload = null;
  let lastSseEventType = null;
  let sseConnected = false;
  let sseEventCount = 0;
  let tFirstBundleMs = null;
  let tRev1Ms = null;
  let tDoneMs = null;
  let latestBundleMeta = null;
  let latestAnalysisBundle = null;
  let latestProductName = null;
  let latestProductSubtitle = null;
  let firstFrameDisplayIdentityMode = null;
  let firstFrameSourceAttribution = null;
  let firstFrameTitleSanitized = null;
  let firstFrameTitle = null;
  let firstFrameTrustedStable = false;
  let finalDisplayIdentityMode = null;
  let finalDisplayIdentityTitle = null;
  let finalDisplayIdentitySourceAttribution = null;
  let firstFrameCaptured = false;
  let refreshingBannerDetected = false;
  let debugToastDetected = false;
  let screenshotRejected = false;
  let expoStaticHintDetected = false;
  const screenshotNoiseFlags = new Set();

  const checkpoints = {
    launch: null,
    result_rev0: null,
    result_rev1: null,
    final_done: null,
    failure_popup_or_stuck: null,
  };

  const checkpointPath = (checkpoint) =>
    path.join(
      screenshotCtx.root,
      screenshotCtx.phase,
      `round-${String(screenshotCtx.round).padStart(3, "0")}`,
      `${screenshotCtx.role}-${screenshotCtx.barcode}`,
      `${checkpoint}.png`,
    );

  const shot = async (checkpoint) => {
    const targetPath = checkpointPath(checkpoint);
    let ok = false;
    for (let attempt = 0; attempt <= REFRESHING_RECAPTURE_MAX_RETRIES; attempt += 1) {
      ok = await captureScreenshot({
        enabled: screenshotCtx.enabled,
        udid: screenshotCtx.udid,
        targetPath,
      });
      if (!ok) break;

      if (!SCREENSHOT_NOISE_CHECKPOINTS.has(checkpoint)) break;
      const hasRefreshingBanner = await detectRefreshingBanner(targetPath);
      const hasDebugToast = detectDebugToastByOcr(targetPath);
      if (!hasRefreshingBanner && !hasDebugToast) break;

      if (hasRefreshingBanner) {
        screenshotNoiseFlags.add("refreshing_banner");
      }
      if (hasDebugToast) {
        screenshotNoiseFlags.add("debug_toast");
      }
      if (attempt < REFRESHING_RECAPTURE_MAX_RETRIES) {
        // Avoid sampling the screenshot exactly when dev runtime overlay flashes.
        // This keeps accepted screenshots aligned with product-facing UI state.
        await sleep(REFRESHING_RECAPTURE_WAIT_MS);
        continue;
      }
      if (hasRefreshingBanner) refreshingBannerDetected = true;
      if (hasDebugToast) debugToastDetected = true;
      screenshotRejected = true;
    }

    if (ok && SCREENSHOT_NOISE_CHECKPOINTS.has(checkpoint)) {
      if (detectExpoStaticHintByOcr(targetPath)) {
        expoStaticHintDetected = true;
        screenshotNoiseFlags.add("expo_static_hint");
      }
    }
    if (ok) checkpoints[checkpoint] = targetPath;
  };

  let appOpenInfo = {
    ok: true,
    deepLink: null,
    error: null,
  };
  if (screenshotCtx.openResultScreen) {
    appOpenInfo = await openResultScreen({
      udid: screenshotCtx.udid,
      barcode,
      attemptTag: screenshotCtx.attemptTag,
    });
    if (appOpenInfo.ok && DEEPLINK_WAIT_MS > 0) {
      await sleep(DEEPLINK_WAIT_MS);
    }
  }

  await shot("launch");

  let timeout = null;
  let controller = null;
  try {
    controller = new AbortController();
    timeout = setTimeout(() => controller.abort(new Error(`timeout_${timeoutMs}ms`)), timeoutMs);

    requestStartedAt = Date.now();
    const response = await fetch(`${API_BASE_URL}/api/enrich-stream`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`http_${response.status}:${text.slice(0, 240)}`);
    }
    if (!response.body) {
      throw new Error("sse_body_missing");
    }
    sseConnected = true;

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let currentEvent = null;
    let currentData = "";
    const maybeCaptureFirstFrameIdentity = (meta, options = {}) => {
      if (!meta || typeof meta !== "object") return;
      const resolved = resolveDisplayIdentityForAttempt({
        meta,
        productName: latestProductName,
        barcode,
      });
      firstFrameDisplayIdentityMode = resolved.displayIdentityMode;
      firstFrameSourceAttribution = resolved.sourceAttributionUsed;
      firstFrameTitleSanitized = Boolean(resolved.titleSanitized);
      firstFrameTitle = resolved.title || null;
      firstFrameTrustedStable = Boolean(resolved.trustedStable);
      const forceCapture = options.force === true;
      if (forceCapture || resolved.displayIdentityMode !== "pending") {
        firstFrameCaptured = true;
      }
    };

    const flushEvent = async () => {
      if (!currentEvent) return;
      const raw = currentData.trim();
      if (!raw) {
        currentEvent = null;
        currentData = "";
        return;
      }

      const eventMs = Date.now() - (requestStartedAt || startedAt);
      lastSseEventType = currentEvent;
      sseEventCount += 1;

      let parsed = raw;
      try {
        parsed = JSON.parse(raw);
      } catch {
        // keep raw
      }

      if (currentEvent === "analysis_payload" && parsed && typeof parsed === "object") {
        const product = parsed?.productInfo && typeof parsed.productInfo === "object" ? parsed.productInfo : null;
        latestProductName = normalizeText(product?.name) || latestProductName;
        latestProductSubtitle = normalizeText(product?.brand) || latestProductSubtitle;
        maybeCaptureFirstFrameIdentity(latestBundleMeta);
      }

      if (currentEvent === "snapshot" && parsed && typeof parsed === "object") {
        const product = parsed?.product && typeof parsed.product === "object" ? parsed.product : null;
        latestProductName = normalizeText(product?.name) || latestProductName;
        latestProductSubtitle = normalizeText(product?.brand) || latestProductSubtitle;
        maybeCaptureFirstFrameIdentity(latestBundleMeta);
      }

      if (currentEvent === "product_info" && parsed && typeof parsed === "object") {
        const product = parsed?.productInfo && typeof parsed.productInfo === "object" ? parsed.productInfo : null;
        latestProductName = normalizeText(product?.name) || latestProductName;
        latestProductSubtitle = normalizeText(product?.brand) || latestProductSubtitle;
        maybeCaptureFirstFrameIdentity(latestBundleMeta);
      }

      if (currentEvent === "analysis_bundle" && parsed && typeof parsed === "object") {
        const revision = Number(parsed?.meta?.revision);
        latestAnalysisBundle = parsed;
        latestBundleMeta = parsed?.meta && typeof parsed.meta === "object" ? parsed.meta : latestBundleMeta;
        if (tFirstBundleMs == null) {
          tFirstBundleMs = eventMs;
        }
        if (revision === 0 && !rev0Seen) {
          maybeCaptureFirstFrameIdentity(latestBundleMeta);
          rev0Seen = true;
          await shot("result_rev0");
        }
        if (revision >= 1 && !rev1Seen) {
          maybeCaptureFirstFrameIdentity(latestBundleMeta);
          rev1Seen = true;
          tRev1Ms = eventMs;
          await shot("result_rev1");
        }
      }

      if (currentEvent === "error") {
        errorPayload = parsed && typeof parsed === "object" ? parsed : { message: String(parsed) };
      }

      if (currentEvent === "done") {
        doneSeen = true;
        donePayload = parsed && typeof parsed === "object" ? parsed : { message: String(parsed) };
        tDoneMs = eventMs;
        maybeCaptureFirstFrameIdentity(latestBundleMeta, { force: true });
        await shot("final_done");
      }

      currentEvent = null;
      currentData = "";
    };

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) {
          await flushEvent();
          if (doneSeen) break;
          continue;
        }
        if (line.startsWith("event:")) {
          currentEvent = line.slice(6).trim();
        } else if (line.startsWith("data:")) {
          currentData += line.slice(5).trim();
        }
      }
      if (doneSeen) {
        try {
          await reader.cancel();
        } catch {
          // ignore
        }
        break;
      }
    }

    await flushEvent();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    requestError = message;
    timedOut = /timeout_/i.test(message) || /abort/i.test(message);
  } finally {
    if (timeout) clearTimeout(timeout);
  }

  if (!doneSeen) {
    await shot("failure_popup_or_stuck");
  }
    if (!firstFrameCaptured && latestBundleMeta && typeof latestBundleMeta === "object") {
      const fallbackIdentity = resolveDisplayIdentityForAttempt({
        meta: latestBundleMeta,
        productName: latestProductName,
      barcode,
    });
    firstFrameDisplayIdentityMode = fallbackIdentity.displayIdentityMode;
    firstFrameSourceAttribution = fallbackIdentity.sourceAttributionUsed;
    firstFrameTitleSanitized = Boolean(fallbackIdentity.titleSanitized);
    firstFrameTitle = fallbackIdentity.title || null;
    firstFrameTrustedStable = Boolean(fallbackIdentity.trustedStable);
  }
  if (latestBundleMeta && typeof latestBundleMeta === "object") {
    const finalIdentity = resolveDisplayIdentityForAttempt({
      meta: latestBundleMeta,
      productName: latestProductName,
      barcode,
    });
    finalDisplayIdentityMode = finalIdentity.displayIdentityMode;
    finalDisplayIdentityTitle = finalIdentity.title || null;
    finalDisplayIdentitySourceAttribution = finalIdentity.sourceAttributionUsed;
  }

  return {
    startedAtIso: new Date(startedAt).toISOString(),
    elapsedMs: Date.now() - startedAt,
    rev0Seen,
    rev1Seen,
    doneSeen,
    timedOut,
    requestError,
    sseConnected,
    sseEventCount,
    donePayload,
    errorPayload,
    lastSseEventType,
    tFirstBundleMs,
    tRev1Ms,
    tDoneMs,
    latestBundleMeta,
    latestAnalysisBundle,
    firstFrameDisplayIdentityMode,
    firstFrameSourceAttribution,
    firstFrameTitleSanitized,
    firstFrameTitle,
    firstFrameTrustedStable,
    finalDisplayIdentityMode,
    finalDisplayIdentityTitle,
    finalDisplayIdentitySourceAttribution,
    refreshingBannerDetected,
    debugToastDetected,
    screenshotRejected,
    screenshotNoiseFlags: Array.from(screenshotNoiseFlags),
    expoStaticHintDetected,
    screenshots: checkpoints,
    appOpenInfo,
  };
};

const runOneAttempt = async ({ phase, round, role, barcode, preflight, screenshotRoot, attemptIndex }) => {
  const headers = buildHeaders();
  const popupBlocked = Boolean(preflight?.popupBlocked);

  if (DRY_RUN) {
    return {
      phase,
      round,
      role,
      barcode,
      attemptIndex,
      status: "dry_run",
      doneSeen: false,
      routeDecision: "recoverable_error",
      sourceAttribution: null,
      sourceTypeFinal: null,
      popupBlocked,
      infraUnavailable: false,
      timeoutClass: "NONE",
      lastSseEventType: null,
      terminalReason: "DRY_RUN",
      tFirstBundleMs: null,
      tDoneMs: null,
      stage0Winner: null,
      stage0StartCount: null,
      stage0ReplaceCount: null,
      degradedMode: false,
      eventLoopLagP95DuringRequest: null,
      webBytesReadTotal: null,
      webParseMsTotal: null,
      watchdogTriggered: false,
      firstFrameDisplayIdentityMode: null,
      firstFramePending: false,
      firstFrameSourceAttribution: null,
      firstFrameTitleSanitized: null,
      firstFrameTitle: null,
      firstFrameTrustedStable: false,
      firstFrameRename: false,
      finalDisplayIdentityMode: null,
      finalDisplayIdentityTitle: null,
      finalDisplayIdentitySourceAttribution: null,
      scoreQueryInitiated: false,
      scoreQuerySource: null,
      scoreQuerySourceId: null,
      scoreResponseStatus: "not_initiated",
      scoreResponseReasonCode: null,
      decisionSupportVerdict: null,
      decisionSupportTopBlockerCodes: [],
      decisionSupportDigest: null,
      decisionSupportFetchStatus: "not_requested",
      decisionSupportAutoRetryUsed: false,
      scoreNotFoundTargeted: false,
      scoreNotFoundTrace: null,
      ulDiagnosticsEligible: false,
      ulDiagnosticsEligibilityReason: "dry_run",
      ulCandidateCount: 0,
      ulCandidateSource: "none",
      ulNoCandidateClass: null,
      ulReferenceFromDeterministic: false,
      ulProducedCount: 0,
      ulReferenceCount: 0,
      ulComparableCount: 0,
      ulMissReasonTop: null,
      ulMissReasonCounts: {},
      ulMissReasonSubTop: null,
      ulMissReasonSubCounts: {},
      contentValueApplied: false,
      contentValuePass: null,
      contentValueFailReasons: [],
      moduleValue: null,
      regulatoryRichSignals: null,
      nutritionLabelLikeFilteredCount: 0,
      nutritionLabelLikeLeakCount: 0,
      nutritionLabelLikeFilteredSamples: [],
      esterCorePass: false,
      esterUlEligible: false,
      esterUlReferenceReady: null,
      esterUlComparableReady: null,
      esterUlReady: null,
      dataCeilingKind: null,
      fallbackRoutePass: null,
      fallbackRouteFailReasons: [],
      refreshingBannerDetected: false,
      debugToastDetected: false,
      screenshotRejected: false,
      screenshotNoiseFlags: [],
      expoStaticHintDetected: false,
      errorCode: null,
      errorReasonCode: null,
      retryable: null,
      retryAfterMs: null,
      screenshots: {},
      elapsedMs: 0,
      startedAtIso: new Date().toISOString(),
      healthcheck: null,
    };
  }

  let lastError = null;
  for (let attempt = 0; attempt <= RETRIES; attempt += 1) {
    // P1-A: separate infra availability from product/SSE timeout behavior.
    // If backend health is down, mark infra_unavailable directly instead of waiting for client timeout.
    // eslint-disable-next-line no-await-in-loop
    const healthPreflight = await runHealthPreflight();
    if (!healthPreflight.ok) {
      const healthReason = "INFRA_UNAVAILABLE_HEALTHCHECK";
      if (attempt < RETRIES) {
        lastError = `${healthReason}:${healthPreflight.error || "unknown"}`;
        continue;
      }
      return {
        phase,
        round,
        role,
        barcode,
        attemptIndex,
        retryAttempt: attempt,
        status: "fail",
        doneSeen: false,
        routeDecision: "recoverable_error",
        sourceAttribution: null,
        sourceTypeFinal: null,
        popupBlocked,
        infraUnavailable: true,
        timeoutClass: "NONE",
        lastSseEventType: null,
        terminalReason: healthReason,
        tFirstBundleMs: null,
        tDoneMs: null,
        stage0Winner: null,
        stage0StartCount: null,
        stage0ReplaceCount: null,
        degradedMode: false,
        eventLoopLagP95DuringRequest: null,
        webBytesReadTotal: null,
        webParseMsTotal: null,
        watchdogTriggered: false,
        firstFrameDisplayIdentityMode: null,
        firstFramePending: false,
        firstFrameSourceAttribution: null,
        firstFrameTitleSanitized: null,
        firstFrameTitle: null,
        firstFrameTrustedStable: false,
        firstFrameRename: false,
        finalDisplayIdentityMode: null,
        finalDisplayIdentityTitle: null,
        finalDisplayIdentitySourceAttribution: null,
        scoreQueryInitiated: false,
        scoreQuerySource: null,
        scoreQuerySourceId: null,
        scoreResponseStatus: "not_initiated",
        scoreResponseReasonCode: null,
        decisionSupportVerdict: null,
        decisionSupportTopBlockerCodes: [],
        decisionSupportDigest: null,
        decisionSupportFetchStatus: "not_requested",
        decisionSupportAutoRetryUsed: false,
        scoreNotFoundTargeted: false,
        scoreNotFoundTrace: null,
        ulDiagnosticsEligible: false,
        ulDiagnosticsEligibilityReason: "infra_unavailable_healthcheck",
        ulCandidateCount: 0,
        ulCandidateSource: "none",
        ulNoCandidateClass: null,
        ulReferenceFromDeterministic: false,
        ulProducedCount: 0,
        ulReferenceCount: 0,
        ulComparableCount: 0,
        ulMissReasonTop: null,
        ulMissReasonCounts: {},
        ulMissReasonSubTop: null,
        ulMissReasonSubCounts: {},
        contentValueApplied: false,
        contentValuePass: null,
        contentValueFailReasons: [],
        moduleValue: null,
        regulatoryRichSignals: null,
        nutritionLabelLikeFilteredCount: 0,
        nutritionLabelLikeLeakCount: 0,
        nutritionLabelLikeFilteredSamples: [],
        esterCorePass: false,
        esterUlEligible: false,
        esterUlReferenceReady: null,
        esterUlComparableReady: null,
        esterUlReady: null,
        dataCeilingKind: null,
        fallbackRoutePass: null,
        fallbackRouteFailReasons: [],
        refreshingBannerDetected: false,
        debugToastDetected: false,
        screenshotRejected: false,
        screenshotNoiseFlags: [],
        expoStaticHintDetected: false,
        errorCode: "INFRA_UNAVAILABLE_HEALTHCHECK",
        errorReasonCode: "INFRA_UNAVAILABLE_HEALTHCHECK",
        retryable: true,
        retryAfterMs: null,
        elapsedMs: healthPreflight.elapsedMs ?? null,
        startedAtIso: new Date().toISOString(),
        requestError: healthPreflight.error || null,
        healthcheck: healthPreflight,
        screenshots: {},
        appOpenOk: null,
        appOpenError: null,
        appOpenUrl: null,
      };
    }

    const stream = await parseSseStream({
      barcode,
      headers,
      timeoutMs: SSE_TIMEOUT_MS,
      screenshotCtx: {
        enabled: CAPTURE_SCREENSHOTS,
        udid: SIM_UDID,
        openResultScreen: OPEN_RESULT_SCREEN && OPEN_RESULT_PHASES.has(phase),
        attemptTag: `mobile-soak-${phase}-${String(round).padStart(3, "0")}-${role}-${attemptIndex}-r${attempt}`,
        root: screenshotRoot,
        phase,
        round,
        role,
        barcode,
      },
    });

    const meta = stream.latestBundleMeta && typeof stream.latestBundleMeta === "object" ? stream.latestBundleMeta : {};
    const errorPayload = stream.errorPayload && typeof stream.errorPayload === "object" ? stream.errorPayload : {};
    const donePayload = stream.donePayload && typeof stream.donePayload === "object" ? stream.donePayload : {};

    const terminalReason =
      String(meta.terminalReason || "").trim() ||
      String(errorPayload.reasonCode || "").trim() ||
      String(donePayload.reason || "").trim() ||
      (stream.doneSeen ? "DONE" : stream.timedOut ? "CLIENT_TIMEOUT" : "NO_TERMINAL");

    const watchdogReasonCandidates = [
      String(errorPayload.reasonCode || "").trim().toUpperCase(),
      String(meta.terminalReason || "").trim().toUpperCase(),
      String(terminalReason || "").trim().toUpperCase(),
    ];
    const watchdogTriggered = watchdogReasonCandidates.some(
      (code) => code === "REV1_WATCHDOG_TIMEOUT" || code === "DONE_MISSING_FALLBACK",
    );

    const doneSeen = Boolean(stream.doneSeen);
    const errorReasonCode = errorPayload.reasonCode ?? null;
    const errorCode = errorPayload.code ?? null;
    const routeDecision = resolveAttemptRoute({
      doneSeen,
      terminalReason,
      errorReasonCode,
      errorCode,
      requestError: stream.requestError,
    });
    const sourceAttributionFromMeta = resolveSourceAttribution(meta);
    const sourceTypeFinal = resolveSourceTypeFinal(meta);
    const sourceAttribution =
      sourceAttributionFromMeta === "unknown"
        ? stream.firstFrameSourceAttribution || sourceAttributionFromMeta
        : sourceAttributionFromMeta;
    const scoreProbe = await fetchScoreInfo({ meta });
    const decisionSupportProbe = await fetchDecisionSupportInfo({ barcode, meta });
    const scoreInfo = scoreProbe?.scoreInfo ?? null;
    const bundleForRichness = withObservedUlEntries(stream.latestAnalysisBundle, scoreInfo);
    const contentValue = evaluateContentValueGate({
      route: routeDecision,
      analysisBundle: stream.latestAnalysisBundle,
      sourceAttribution,
      terminalReason,
      reasonCode: errorReasonCode,
      degradedMode: Boolean(meta.degradedMode),
      scoreInfo,
      errorMessage: stream.requestError || errorPayload.message || null,
    });
    const regulatoryRichSignals =
      sourceAttribution === "verified_regulatory" || sourceAttribution === "label_record"
        ? deriveRegulatoryRichSignals({
          analysisBundle: bundleForRichness,
          scoreInfo,
          moduleValue: contentValue.moduleValue ?? null,
        })
        : null;
    const ulDiagnosticsEligible =
      (sourceAttribution === "verified_regulatory" || sourceAttribution === "label_record")
      && scoreProbe?.scoreResponseStatus === "ok";
    const ulDiagnosticsEligibilityReason = ulDiagnosticsEligible
      ? null
      : sourceAttribution !== "verified_regulatory" && sourceAttribution !== "label_record"
        ? "non_verified_source"
        : `score_${String(scoreProbe?.scoreResponseStatus || "not_initiated").toLowerCase()}`;
    const ulCandidateCount = Number(regulatoryRichSignals?.ulCandidateCount ?? 0) || 0;
    const ulCandidateSource = ulDiagnosticsEligible
      ? String(regulatoryRichSignals?.ulCandidateSource || "none").toLowerCase()
      : "none";
    const ulNoCandidateClass = ulDiagnosticsEligible
      ? (regulatoryRichSignals?.ulNoCandidateClass ?? null)
      : null;
    const ulReferenceFromDeterministic = ulDiagnosticsEligible
      ? Boolean(regulatoryRichSignals?.ulReferenceFromDeterministic)
      : false;
    const ulReferenceCount = Number(regulatoryRichSignals?.ulEntriesCount ?? regulatoryRichSignals?.ulProducedCount ?? 0) || 0;
    const ulComparableCount = Number(regulatoryRichSignals?.ulProducedCount ?? 0) || 0;
    const ulProducedCount = ulComparableCount;
    const ulMissReasonTop = ulDiagnosticsEligible ? (regulatoryRichSignals?.ulMissReasonTop ?? null) : null;
    const ulMissReasonSubTop = ulDiagnosticsEligible ? (regulatoryRichSignals?.ulMissReasonSubTop ?? null) : null;
    const ulMissReasonCounts =
      ulDiagnosticsEligible && regulatoryRichSignals?.ulMissReasonCounts && typeof regulatoryRichSignals.ulMissReasonCounts === "object"
        ? regulatoryRichSignals.ulMissReasonCounts
        : {};
    const ulMissReasonSubCounts =
      ulDiagnosticsEligible && regulatoryRichSignals?.ulMissReasonSubCounts && typeof regulatoryRichSignals.ulMissReasonSubCounts === "object"
        ? regulatoryRichSignals.ulMissReasonSubCounts
        : {};
    const ingredientCount = Number(regulatoryRichSignals?.ingredientCount ?? 0) || 0;
    const doseCount = Number(regulatoryRichSignals?.doseCount ?? 0) || 0;
    const scoreNotFoundTargeted =
      (sourceAttribution === "verified_regulatory" || sourceAttribution === "label_record")
      && String(scoreProbe?.scoreResponseStatus || "").toLowerCase() === "not_found"
      && ingredientCount >= 1
      && doseCount >= 1;
    const scoreResponseStatusNormalized = String(scoreProbe?.scoreResponseStatus || "not_initiated").toLowerCase();
    const scoreTerminalSeen =
      scoreResponseStatusNormalized === "ok"
      || scoreResponseStatusNormalized === "not_found"
      || (scoreProbe?.scoreQueryInitiated !== true && sourceTypeFinal === true);
    let scoreNotFoundTrace = null;
    if (scoreNotFoundTargeted) {
      const scoreQuerySource = scoreProbe?.scoreQuerySource ?? null;
      const scoreQuerySourceId = scoreProbe?.scoreQuerySourceId ?? null;
      const factsProbe = await fetchFactsProbe({
        source: scoreQuerySource,
        sourceId: scoreQuerySourceId,
      });
      let traceReason = "unknown";
      if (!scoreQuerySource || !scoreQuerySourceId) {
        traceReason = "score_query_not_resolved";
      } else if (factsProbe?.factsStatus === "not_found") {
        traceReason = "source_id_mapping_issue_or_missing_facts";
      } else if (factsProbe?.factsStatus === "ok" && Number(factsProbe?.activeCountWithDose || 0) > 0) {
        traceReason = "facts_present_score_index_missing";
      } else if (factsProbe?.factsStatus === "ok") {
        traceReason = "facts_sparse_or_missing_dose";
      } else if (factsProbe?.factsStatus === "error") {
        traceReason = "facts_probe_error";
      }
      scoreNotFoundTrace = {
        source: scoreQuerySource,
        sourceId: scoreQuerySourceId,
        factsStatus: factsProbe?.factsStatus ?? "unknown",
        factsReason: factsProbe?.factsReason ?? null,
        activeCountWithDose: Number(factsProbe?.activeCountWithDose ?? 0) || 0,
        servingSizePresent: Boolean(factsProbe?.servingSizePresent),
        reason: traceReason,
        terminalReason,
        stage0Winner: meta.stage0Winner ?? null,
        sourceTypeFinal,
        fallbackReason: normalizeText(meta.fallbackReason) || null,
      };
    }
    const sciencePass = regulatoryRichSignals?.sciencePass === true;
    const usagePass = regulatoryRichSignals?.usagePass === true;
    const safetyPass = regulatoryRichSignals?.safetyPass === true;
    const esterCorePass =
      (sourceAttribution === "verified_regulatory" || sourceAttribution === "label_record")
      && sourceTypeFinal === true
      && !isDegradedTerminalReason(terminalReason)
      && String(scoreProbe?.scoreResponseStatus || "").toLowerCase() === "ok"
      && sciencePass
      && usagePass
      && safetyPass;
    const esterUlEligible = ulCandidateCount > 0;
    const esterUlReferenceReady = regulatoryRichSignals
      ? (esterUlEligible ? ulReferenceCount > 0 : null)
      : null;
    const esterUlComparableReady = regulatoryRichSignals
      ? (esterUlEligible ? ulComparableCount > 0 : null)
      : null;
    const esterUlReady = regulatoryRichSignals
      ? esterUlReferenceReady
      : null;
    const dataCeilingKind =
      (role === "lnhpd" || role === "ceiling")
      && sourceTypeFinal === true
      && ingredientCount === 0
      && doseCount === 0
        ? "lnhpd_0_0_0"
        : null;
    const verifiedUnverifiedConflict = hasVerifiedUnverifiedConflict({
      sourceAttribution,
      moduleValue: contentValue?.moduleValue ?? null,
    });
    const timeoutClass = classifyTimeoutClass({
      terminalReason,
      requestError: stream.requestError,
      sseConnected: stream.sseConnected,
      sseEventCount: stream.sseEventCount,
      doneSeen,
    });
    const firstFrameTitle = normalizeText(stream.firstFrameTitle);
    const finalDisplayIdentityTitle = normalizeText(stream.finalDisplayIdentityTitle);
    const firstFrameRename =
      stream.firstFrameDisplayIdentityMode === "trusted"
      && (
        stream.finalDisplayIdentityMode !== "trusted"
        || (!firstFrameTitle || !finalDisplayIdentityTitle)
        || firstFrameTitle.toLowerCase() !== finalDisplayIdentityTitle.toLowerCase()
      );
    const passed = doneSeen && !popupBlocked;

    const record = {
      phase,
      round,
      role,
      barcode,
      attemptIndex,
      retryAttempt: attempt,
      status: passed ? "pass" : "fail",
      doneSeen,
      routeDecision,
      sourceAttribution,
      sourceTypeFinal,
      popupBlocked,
      infraUnavailable: false,
      timeoutClass,
      terminalReason,
      lastSseEventType: stream.lastSseEventType,
      stage0Winner: meta.stage0Winner ?? null,
      stage0StartCount: Number.isFinite(Number(meta.stage0StartCount)) ? Number(meta.stage0StartCount) : null,
      stage0ReplaceCount: Number.isFinite(Number(meta.stage0ReplaceCount)) ? Number(meta.stage0ReplaceCount) : null,
      degradedMode: Boolean(meta.degradedMode),
      eventLoopLagP95DuringRequest:
        Number.isFinite(Number(meta.eventLoopLagP95DuringRequest)) ? Number(meta.eventLoopLagP95DuringRequest) : null,
      webBytesReadTotal: Number.isFinite(Number(meta.webBytesReadTotal)) ? Number(meta.webBytesReadTotal) : null,
      webParseMsTotal: Number.isFinite(Number(meta.webParseMsTotal)) ? Number(meta.webParseMsTotal) : null,
      watchdogTriggered,
      firstFrameDisplayIdentityMode: stream.firstFrameDisplayIdentityMode ?? null,
      firstFramePending: stream.firstFrameDisplayIdentityMode === "pending",
      firstFrameSourceAttribution: stream.firstFrameSourceAttribution ?? sourceAttribution ?? null,
      firstFrameTitleSanitized:
        typeof stream.firstFrameTitleSanitized === "boolean" ? stream.firstFrameTitleSanitized : null,
      firstFrameTitle: stream.firstFrameTitle ?? null,
      firstFrameTrustedStable: Boolean(stream.firstFrameTrustedStable),
      firstFrameRename,
      finalDisplayIdentityMode: stream.finalDisplayIdentityMode ?? null,
      finalDisplayIdentityTitle: stream.finalDisplayIdentityTitle ?? null,
      finalDisplayIdentitySourceAttribution: stream.finalDisplayIdentitySourceAttribution ?? null,
      scoreQueryInitiated: scoreProbe?.scoreQueryInitiated === true,
      scoreQuerySource: scoreProbe?.scoreQuerySource ?? null,
      scoreQuerySourceId: scoreProbe?.scoreQuerySourceId ?? null,
      scoreResponseStatus: scoreProbe?.scoreResponseStatus ?? "not_initiated",
      scoreResponseReasonCode: scoreProbe?.scoreResponseReasonCode ?? null,
      decisionSupportVerdict: decisionSupportProbe?.decisionSupportVerdict ?? null,
      decisionSupportTopBlockerCodes: Array.isArray(decisionSupportProbe?.decisionSupportTopBlockerCodes)
        ? decisionSupportProbe.decisionSupportTopBlockerCodes
        : [],
      decisionSupportDigest: decisionSupportProbe?.decisionSupportDigest ?? null,
      decisionSupportFetchStatus: decisionSupportProbe?.decisionSupportFetchStatus ?? "not_requested",
      decisionSupportAutoRetryUsed: decisionSupportProbe?.decisionSupportAutoRetryUsed === true,
      scoreTerminalSeen,
      scoreNotFoundTargeted,
      scoreNotFoundTrace,
      ulDiagnosticsEligible,
      ulDiagnosticsEligibilityReason,
      ulCandidateCount,
      ulCandidateSource,
      ulNoCandidateClass,
      ulReferenceFromDeterministic,
      ulProducedCount,
      ulReferenceCount,
      ulComparableCount,
      ulMissReasonTop,
      ulMissReasonCounts,
      ulMissReasonSubTop,
      ulMissReasonSubCounts,
      contentValueApplied: Boolean(contentValue.applied),
      contentValuePass: typeof contentValue.pass === "boolean" ? contentValue.pass : null,
      contentValueFailReasons: Array.isArray(contentValue.failReasons) ? contentValue.failReasons : [],
      moduleValue: contentValue.moduleValue ?? null,
      regulatoryRichSignals,
      nutritionLabelLikeFilteredCount: Number(regulatoryRichSignals?.nutritionLabelLikeFilteredCount ?? 0) || 0,
      nutritionLabelLikeLeakCount: Number(regulatoryRichSignals?.nutritionLabelLikeLeakCount ?? 0) || 0,
      nutritionLabelLikeFilteredSamples:
        Array.isArray(regulatoryRichSignals?.nutritionLabelLikeFilteredSamples)
          ? regulatoryRichSignals.nutritionLabelLikeFilteredSamples
              .filter((value) => typeof value === "string")
              .slice(0, 3)
          : [],
      coverDetailConsistencyPass: regulatoryRichSignals?.coverDetailConsistencyPass === true,
      consistencyFailReason: regulatoryRichSignals?.consistencyFailReason ?? null,
      consistencyWarningReasons:
        Array.isArray(regulatoryRichSignals?.consistencyWarningReasons)
          ? regulatoryRichSignals.consistencyWarningReasons
              .filter((value) => typeof value === "string")
              .slice(0, 5)
          : [],
      deterministicSignalCounts:
        regulatoryRichSignals?.deterministicSignalCounts && typeof regulatoryRichSignals.deterministicSignalCounts === "object"
          ? regulatoryRichSignals.deterministicSignalCounts
          : null,
      esterCorePass,
      esterUlEligible,
      esterUlReferenceReady,
      esterUlComparableReady,
      esterUlReady,
      dataCeilingKind,
      verifiedUnverifiedConflict,
      fallbackRoutePass: typeof contentValue.fallbackRoutePass === "boolean" ? contentValue.fallbackRoutePass : null,
      fallbackRouteFailReasons: Array.isArray(contentValue.fallbackRouteFailReasons)
        ? contentValue.fallbackRouteFailReasons
        : [],
      refreshingBannerDetected: Boolean(stream.refreshingBannerDetected),
      debugToastDetected: Boolean(stream.debugToastDetected),
      screenshotRejected: Boolean(stream.screenshotRejected),
      screenshotNoiseFlags: Array.isArray(stream.screenshotNoiseFlags) ? stream.screenshotNoiseFlags : [],
      expoStaticHintDetected: Boolean(stream.expoStaticHintDetected),
      errorCode,
      errorReasonCode,
      retryable: typeof errorPayload.retryable === "boolean" ? errorPayload.retryable : null,
      retryAfterMs: Number.isFinite(Number(errorPayload.retryAfterMs)) ? Number(errorPayload.retryAfterMs) : null,
      tFirstBundleMs: Number.isFinite(stream.tFirstBundleMs) ? stream.tFirstBundleMs : null,
      tRev1Ms: Number.isFinite(stream.tRev1Ms) ? stream.tRev1Ms : null,
      tDoneMs: Number.isFinite(stream.tDoneMs) ? stream.tDoneMs : null,
      elapsedMs: stream.elapsedMs,
      startedAtIso: stream.startedAtIso,
      requestError: stream.requestError,
      healthcheck: healthPreflight,
      screenshots: stream.screenshots,
      appOpenOk: stream.appOpenInfo?.ok ?? null,
      appOpenError: stream.appOpenInfo?.error ?? null,
      appOpenUrl: stream.appOpenInfo?.deepLink ?? null,
    };

    if (passed || attempt >= RETRIES) {
      return record;
    }

    lastError = stream.requestError || terminalReason;
  }

  return {
    phase,
    round,
    role,
    barcode,
    attemptIndex,
    retryAttempt: RETRIES,
    status: "fail",
    doneSeen: false,
    popupBlocked: Boolean(preflight?.popupBlocked),
    terminalReason: lastError || "RETRY_EXHAUSTED",
    lastSseEventType: null,
    stage0Winner: null,
    stage0StartCount: null,
    stage0ReplaceCount: null,
    degradedMode: false,
    eventLoopLagP95DuringRequest: null,
    webBytesReadTotal: null,
    webParseMsTotal: null,
    watchdogTriggered: false,
    routeDecision: "recoverable_error",
    sourceAttribution: null,
    sourceTypeFinal: null,
    infraUnavailable: false,
    timeoutClass: "NONE",
    firstFrameDisplayIdentityMode: null,
    firstFramePending: false,
    firstFrameSourceAttribution: null,
    firstFrameTitleSanitized: null,
    firstFrameTitle: null,
    firstFrameTrustedStable: false,
    firstFrameRename: false,
    finalDisplayIdentityMode: null,
    finalDisplayIdentityTitle: null,
    finalDisplayIdentitySourceAttribution: null,
    scoreQueryInitiated: false,
    scoreQuerySource: null,
    scoreQuerySourceId: null,
    scoreResponseStatus: "not_initiated",
    scoreResponseReasonCode: null,
    decisionSupportVerdict: null,
    decisionSupportTopBlockerCodes: [],
    decisionSupportDigest: null,
    decisionSupportFetchStatus: "not_requested",
    decisionSupportAutoRetryUsed: false,
    scoreTerminalSeen: false,
    scoreNotFoundTargeted: false,
    scoreNotFoundTrace: null,
    ulDiagnosticsEligible: false,
    ulDiagnosticsEligibilityReason: "retry_exhausted",
    ulCandidateCount: 0,
    ulCandidateSource: "none",
    ulNoCandidateClass: null,
    ulReferenceFromDeterministic: false,
    ulProducedCount: 0,
    ulReferenceCount: 0,
    ulComparableCount: 0,
    ulMissReasonTop: null,
    ulMissReasonCounts: {},
    ulMissReasonSubTop: null,
    ulMissReasonSubCounts: {},
    contentValueApplied: false,
    contentValuePass: null,
    contentValueFailReasons: [],
    moduleValue: null,
    regulatoryRichSignals: null,
    nutritionLabelLikeFilteredCount: 0,
    nutritionLabelLikeLeakCount: 0,
    nutritionLabelLikeFilteredSamples: [],
    coverDetailConsistencyPass: false,
    consistencyFailReason: null,
    consistencyWarningReasons: [],
    deterministicSignalCounts: null,
    esterCorePass: false,
    esterUlEligible: false,
    esterUlReferenceReady: null,
    esterUlComparableReady: null,
    esterUlReady: null,
    dataCeilingKind: null,
    verifiedUnverifiedConflict: false,
    fallbackRoutePass: null,
    fallbackRouteFailReasons: [],
    refreshingBannerDetected: false,
    debugToastDetected: false,
    screenshotRejected: false,
    screenshotNoiseFlags: [],
    expoStaticHintDetected: false,
    errorCode: null,
    errorReasonCode: null,
    retryable: null,
    retryAfterMs: null,
    tFirstBundleMs: null,
    tRev1Ms: null,
    tDoneMs: null,
    elapsedMs: null,
    startedAtIso: new Date().toISOString(),
    requestError: lastError,
    healthcheck: null,
    screenshots: {},
  };
};

const summarizeKillerConfidence = (attempts) => {
  const rows = attempts.filter((row) => row.role === "killer" && (row.phase === "killer_cold" || row.phase === "killer_hot"));
  const buildPhase = (phase) => {
    const phaseRows = rows.filter((row) => row.phase === phase);
    const doneSeenRate = phaseRows.length
      ? phaseRows.filter((row) => row.doneSeen).length / phaseRows.length
      : 0;
    const tDoneValues = phaseRows.map((row) => row.tDoneMs).filter(Number.isFinite);
    return {
      total: phaseRows.length,
      doneSeenRate,
      degradedRate: phaseRows.length
        ? phaseRows.filter((row) => row.degradedMode).length / phaseRows.length
        : 0,
      timeoutClassCounts: phaseRows.reduce((acc, row) => {
        const key = String(row.timeoutClass || "NONE");
        acc[key] = (acc[key] || 0) + 1;
        return acc;
      }, {}),
      terminalReasonCounts: phaseRows.reduce((acc, row) => {
        const key = String(row.terminalReason || "UNKNOWN");
        acc[key] = (acc[key] || 0) + 1;
        return acc;
      }, {}),
      tDoneDistribution: {
        min: tDoneValues.length ? Math.min(...tDoneValues) : null,
        p50: percentile(tDoneValues, 0.5),
        p95: percentile(tDoneValues, 0.95),
        max: tDoneValues.length ? Math.max(...tDoneValues) : null,
      },
    };
  };

  return {
    total: rows.length,
    doneSeenRate: rows.length ? rows.filter((row) => row.doneSeen).length / rows.length : 0,
    degradedRate: rows.length ? rows.filter((row) => row.degradedMode).length / rows.length : 0,
    timeoutClassCounts: rows.reduce((acc, row) => {
      const key = String(row.timeoutClass || "NONE");
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {}),
    terminalReasonCounts: rows.reduce((acc, row) => {
      const key = String(row.terminalReason || "UNKNOWN");
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {}),
    tDoneDistribution: {
      min: (() => {
        const values = rows.map((row) => row.tDoneMs).filter(Number.isFinite);
        return values.length ? Math.min(...values) : null;
      })(),
      p50: percentile(rows.map((row) => row.tDoneMs).filter(Number.isFinite), 0.5),
      p95: percentile(rows.map((row) => row.tDoneMs).filter(Number.isFinite), 0.95),
      max: (() => {
        const values = rows.map((row) => row.tDoneMs).filter(Number.isFinite);
        return values.length ? Math.max(...values) : null;
      })(),
    },
    phases: {
      killer_cold: buildPhase("killer_cold"),
      killer_hot: buildPhase("killer_hot"),
    },
  };
};

const moduleKeyForFailReason = (reason) => {
  const normalized = String(reason || "").toUpperCase();
  if (normalized.startsWith("OVERVIEW_")) return "overview";
  if (normalized.startsWith("SCIENCE_")) return "science";
  if (normalized.startsWith("USAGE_")) return "usage";
  if (normalized.startsWith("SAFETY_")) return "safety";
  if (normalized.startsWith("UL_")) return "usage";
  if (normalized.startsWith("DEGRADED_")) return "overview";
  return "overview";
};

const moduleKeyForConsistencyReason = (reason) => {
  const normalized = String(reason || "").toUpperCase();
  if (normalized === "PARSER_GAP_VISIBLE") return "usage";
  if (normalized === "COVER_DETAIL_INCONSISTENT") return "science";
  return "overview";
};

const compactModuleSnippet = (row, moduleKey) => {
  if (moduleKey === "score") {
    const reasonCode = normalizeText(row?.moduleValue?.score?.reasonCode || row?.regulatoryRichSignals?.scoreReasonCode);
    const explanation = normalizeText(row?.moduleValue?.score?.explanation || row?.regulatoryRichSignals?.scoreExplanation);
    const hasScore = row?.regulatoryRichSignals?.scoreAvailable === true || row?.moduleValue?.score?.hasScore === true;
    const scoreParts = [
      `hasScore=${hasScore ? "true" : "false"}`,
      reasonCode ? `reason=${reasonCode}` : null,
      explanation ? `explain=${explanation}` : null,
    ].filter(Boolean);
    return scoreParts.length ? scoreParts.join(" | ").slice(0, 280) : "score_not_visible";
  }
  const lines = Array.isArray(row?.moduleValue?.[moduleKey]?.lines) ? row.moduleValue[moduleKey].lines : [];
  if (!lines.length) return "no_module_lines";
  return lines
    .slice(0, 3)
    .map((line) => String(line || "").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join(" | ")
    .slice(0, 280);
};

const buildContentFailReasonTop = (rows, limit = 10) => {
  const map = new Map();
  for (const row of rows) {
    const reasons = Array.isArray(row.contentValueFailReasons) ? row.contentValueFailReasons : [];
    for (const reason of reasons) {
      const key = String(reason || "UNKNOWN");
      const existing = map.get(key) || { reason: key, count: 0, samples: [], seenBarcodes: new Set() };
      existing.count += 1;
      if (existing.samples.length < 3) {
        const barcode = String(row.barcode || "");
        if (!existing.seenBarcodes.has(barcode)) {
          existing.seenBarcodes.add(barcode);
          const moduleKey = moduleKeyForFailReason(key);
          existing.samples.push({
            barcode,
            role: row.role || "unknown",
            phase: row.phase || "unknown",
            module: moduleKey,
            snippet: compactModuleSnippet(row, moduleKey),
          });
        }
      }
      map.set(key, existing);
    }
  }
  return Array.from(map.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, limit)
    .map((entry) => ({
      reason: entry.reason,
      count: entry.count,
      samples: entry.samples,
    }));
};

const buildRegulatoryRichFailReasonTop = (rows, limit = 10) => {
  const map = new Map();
  for (const row of rows) {
    const failure = deriveRegulatoryRichFailure({ signals: row?.regulatoryRichSignals ?? null });
    const primaryReason = failure.primaryReason;
    if (!primaryReason) continue;
    const key = String(primaryReason || "UNKNOWN");
    const existing = map.get(key) || { reason: key, count: 0, samples: [], seenBarcodes: new Set() };
    existing.count += 1;
    if (existing.samples.length < 3) {
      const barcode = String(row.barcode || "");
      if (!existing.seenBarcodes.has(barcode)) {
        existing.seenBarcodes.add(barcode);
        const moduleKey = moduleKeyForRegulatoryReason(key);
        const baseSnippet = compactModuleSnippet(row, moduleKey);
        const missingSafetyKinds = Array.isArray(row?.regulatoryRichSignals?.missingSafetyKinds)
          ? row.regulatoryRichSignals.missingSafetyKinds
            .map((value) => String(value || "").trim().toLowerCase())
            .filter((value) => value === "label" || value === "ods" || value === "ul")
          : [];
        const snippet =
          key === "MISSING_SAFETY_SIGNALS" && missingSafetyKinds.length
            ? `missingKinds=${missingSafetyKinds.join("+")} | ${baseSnippet}`
            : baseSnippet;
        existing.samples.push({
          barcode,
          role: row.role || "unknown",
          phase: row.phase || "unknown",
          module: moduleKey,
          snippet,
        });
      }
    }
    map.set(key, existing);
  }
  return Array.from(map.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, limit)
    .map((entry) => ({
      reason: entry.reason,
      count: entry.count,
      samples: entry.samples,
    }));
};

const buildConsistencyFailTop = (rows, limit = 10) => {
  const map = new Map();
  for (const row of rows) {
    const reason = String(row?.consistencyFailReason || row?.regulatoryRichSignals?.consistencyFailReason || "").trim();
    if (!reason) continue;
    const key = reason.toUpperCase();
    const existing = map.get(key) || { reason: key, count: 0, samples: [], seenBarcodes: new Set() };
    existing.count += 1;
    if (existing.samples.length < 3) {
      const barcode = String(row.barcode || "");
      if (!existing.seenBarcodes.has(barcode)) {
        existing.seenBarcodes.add(barcode);
        const moduleKey = moduleKeyForConsistencyReason(key);
        existing.samples.push({
          barcode,
          role: row.role || "unknown",
          phase: row.phase || "unknown",
          module: moduleKey,
          snippet: compactModuleSnippet(row, moduleKey),
        });
      }
    }
    map.set(key, existing);
  }
  return Array.from(map.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, limit)
    .map((entry) => ({
      reason: entry.reason,
      count: entry.count,
      samples: entry.samples,
    }));
};

const dedupeRowsByBarcodeKeepLast = (rows) => {
  const map = new Map();
  for (const row of rows) {
    const barcode = String(row?.barcode || "").trim();
    if (!barcode) continue;
    map.set(barcode, row);
  }
  return Array.from(map.values());
};

const isTrustedRegulatoryAttribution = (value) =>
  value === "verified_regulatory" || value === "label_record";

const isVerifiedFinalSerialAttempt = (row) => {
  if (!isTrustedRegulatoryAttribution(row?.sourceAttribution)) return false;
  const winner = normalizeStage0WinnerAttribution(row?.stage0Winner);
  const winnerTrusted = winner === "verified_regulatory" || winner === "label_record";
  return row?.sourceTypeFinal === true || winnerTrusted;
};

const buildUlCoverageDiagnostics = ({ attempts, stats, summaryPath }) => {
  const serialAttempts = Array.isArray(attempts) ? attempts.filter((row) => row?.phase === "serial") : [];
  const verifiedFinalRows = serialAttempts.filter((row) => isVerifiedFinalSerialAttempt(row));
  const rows = verifiedFinalRows.map((row) => {
    const ulCandidateCount =
      Number(row?.ulCandidateCount ?? row?.regulatoryRichSignals?.ulCandidateCount ?? 0) || 0;
    const ulReferenceCount =
      Number(
        row?.ulReferenceCount
        ?? row?.regulatoryRichSignals?.ulEntriesCount
        ?? row?.regulatoryRichSignals?.ulProducedCount
        ?? 0,
      ) || 0;
    const ulComparableCount =
      Number(
        row?.ulComparableCount
        ?? row?.ulProducedCount
        ?? row?.regulatoryRichSignals?.ulProducedCount
        ?? 0,
      ) || 0;
    const ulProducedCount =
      Number(
        row?.ulComparableCount
        ?? row?.ulProducedCount
        ?? row?.regulatoryRichSignals?.ulProducedCount
        ?? 0,
      ) || 0;
    const ulMissReasonTop =
      row?.ulMissReasonTop
      ?? row?.regulatoryRichSignals?.ulMissReasonTop
      ?? (ulProducedCount > 0 ? null : UL_COVERAGE_MISS_REASONS.NO_UL_CANDIDATE);
    const ulMissReasonCounts =
      row?.ulMissReasonCounts && typeof row.ulMissReasonCounts === "object"
        ? row.ulMissReasonCounts
        : row?.regulatoryRichSignals?.ulMissReasonCounts && typeof row.regulatoryRichSignals.ulMissReasonCounts === "object"
          ? row.regulatoryRichSignals.ulMissReasonCounts
          : {};
    return {
      barcode: row?.barcode ?? null,
      role: row?.role ?? null,
      phase: row?.phase ?? null,
      sourceAttribution: row?.sourceAttribution ?? null,
      sourceTypeFinal: row?.sourceTypeFinal === true,
      scoreResponseStatus: row?.scoreResponseStatus ?? "not_initiated",
      scoreResponseReasonCode: row?.scoreResponseReasonCode ?? null,
      ulDiagnosticsEligible: row?.ulDiagnosticsEligible === true,
      ulDiagnosticsEligibilityReason: row?.ulDiagnosticsEligibilityReason ?? null,
      ulCandidateCount,
      ulCandidateSource:
        String(row?.ulCandidateSource ?? row?.regulatoryRichSignals?.ulCandidateSource ?? "none").toLowerCase(),
      ulNoCandidateClass:
        row?.ulNoCandidateClass
        ?? row?.regulatoryRichSignals?.ulNoCandidateClass
        ?? null,
      ulReferenceFromDeterministic:
        row?.ulReferenceFromDeterministic === true
        || row?.regulatoryRichSignals?.ulReferenceFromDeterministic === true,
      ulReferenceCount,
      ulComparableCount,
      ulProducedCount,
      ulMissReasonTop,
      ulMissReasonSubTop: row?.ulMissReasonSubTop ?? row?.regulatoryRichSignals?.ulMissReasonSubTop ?? null,
      ulMissReasonCounts,
      ulMissReasonSubCounts:
        row?.ulMissReasonSubCounts && typeof row.ulMissReasonSubCounts === "object"
          ? row.ulMissReasonSubCounts
          : row?.regulatoryRichSignals?.ulMissReasonSubCounts && typeof row.regulatoryRichSignals.ulMissReasonSubCounts === "object"
            ? row.regulatoryRichSignals.ulMissReasonSubCounts
            : {},
    };
  });
  const eligibleRows = rows.filter((row) => row.ulDiagnosticsEligible === true);
  const skippedRows = rows.filter((row) => row.ulDiagnosticsEligible !== true);
  const missReasonCounts = eligibleRows.reduce((acc, row) => {
    if (row.ulProducedCount > 0) return acc;
    const reason = String(row.ulMissReasonTop || UL_COVERAGE_MISS_REASONS.NO_UL_CANDIDATE);
    acc[reason] = (acc[reason] || 0) + 1;
    return acc;
  }, {});
  const missReasonTop = Object.entries(missReasonCounts)
    .sort((a, b) => Number(b[1] || 0) - Number(a[1] || 0))
    .map(([reason, count]) => ({
      reason,
      count,
      samples: eligibleRows
        .filter((row) => (row.ulMissReasonTop || UL_COVERAGE_MISS_REASONS.NO_UL_CANDIDATE) === reason)
        .slice(0, 5)
        .map((row) => ({
          barcode: row.barcode,
          role: row.role,
          phase: row.phase,
          ulCandidateCount: row.ulCandidateCount,
          ulCandidateSource: row.ulCandidateSource,
          ulNoCandidateClass: row.ulNoCandidateClass,
          ulReferenceCount: row.ulReferenceCount,
          ulComparableCount: row.ulComparableCount,
          ulProducedCount: row.ulProducedCount,
          scoreResponseStatus: row.scoreResponseStatus,
        })),
    }));
  const missSubReasonCounts = eligibleRows.reduce((acc, row) => {
    if (row.ulProducedCount > 0) return acc;
    const reason = String(row.ulMissReasonSubTop || "NONE");
    if (!reason || reason === "NONE") return acc;
    acc[reason] = (acc[reason] || 0) + 1;
    return acc;
  }, {});
  const candidateSourceCounts = eligibleRows.reduce((acc, row) => {
    const key = String(row?.ulCandidateSource || "none").toLowerCase();
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const noCandidateClassCounts = eligibleRows.reduce((acc, row) => {
    const key = normalizeText(row?.ulNoCandidateClass).toLowerCase();
    if (!key) return acc;
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const ulReferenceFromDeterministicCount = eligibleRows.filter(
    (row) => row.ulReferenceFromDeterministic === true,
  ).length;

  return {
    generatedAt: new Date().toISOString(),
    summaryPath,
    stats: {
      ulEntriesCoverageVerified: Number(stats?.ulEntriesCoverageVerified ?? 0) || 0,
      ulReferenceCoverageVerified: Number(stats?.ulReferenceCoverageVerified ?? stats?.ulEntriesCoverageVerified ?? 0) || 0,
      ulComparableCoverageVerified: Number(stats?.ulComparableCoverageVerified ?? 0) || 0,
      ulEligibleRateVerified: Number(stats?.ulEligibleRateVerified ?? 0) || 0,
      ulCoverageDiagnosticsEligibleCount: eligibleRows.length,
      ulCoverageDiagnosticsSkippedCount: skippedRows.length,
      ulCoverageMissReasonCounts: missReasonCounts,
      ulCoverageMissReasonTop: missReasonTop,
      ulCoverageMissReasonSubCounts: missSubReasonCounts,
      ulCandidateSourceCounts: candidateSourceCounts,
      ulNoCandidateClassCounts: noCandidateClassCounts,
      ulReferenceFromDeterministicCount,
    },
    rows,
    skippedRows: skippedRows.map((row) => ({
      barcode: row.barcode,
      role: row.role,
      phase: row.phase,
      scoreResponseStatus: row.scoreResponseStatus,
      ulDiagnosticsEligibilityReason: row.ulDiagnosticsEligibilityReason,
    })),
  };
};

const renderUlCoverageDiagnosticsMarkdown = (payload) => {
  const stats = payload?.stats && typeof payload.stats === "object" ? payload.stats : {};
  const rows = Array.isArray(payload?.rows) ? payload.rows : [];
  const missReasonTop = Array.isArray(stats?.ulCoverageMissReasonTop) ? stats.ulCoverageMissReasonTop : [];
  const lines = [];
  lines.push("# UL Coverage Diagnostics");
  lines.push("");
  lines.push(`- generatedAt: ${payload?.generatedAt ?? new Date().toISOString()}`);
  lines.push(`- summaryPath: ${payload?.summaryPath ?? "n/a"}`);
  lines.push(`- verifiedFinalRows: ${rows.length}`);
  lines.push(`- eligible: ${Number(stats?.ulCoverageDiagnosticsEligibleCount ?? 0)}`);
  lines.push(`- skipped: ${Number(stats?.ulCoverageDiagnosticsSkippedCount ?? 0)}`);
  const ulEntriesCoverage = Number(stats?.ulEntriesCoverageVerified);
  const ulReferenceCoverage = Number(stats?.ulReferenceCoverageVerified);
  const ulComparableCoverage = Number(stats?.ulComparableCoverageVerified);
  const ulEligibleRateVerified = Number(stats?.ulEligibleRateVerified);
  lines.push(`- ulEntriesCoverageVerified (legacy): ${Number.isFinite(ulEntriesCoverage) ? `${toPct(ulEntriesCoverage)}%` : "n/a"}`);
  lines.push(`- ulReferenceCoverageVerified: ${Number.isFinite(ulReferenceCoverage) ? `${toPct(ulReferenceCoverage)}%` : "n/a"}`);
  lines.push(`- ulComparableCoverageVerified: ${Number.isFinite(ulComparableCoverage) ? `${toPct(ulComparableCoverage)}%` : "n/a"}`);
  lines.push(`- ulEligibleRateVerified: ${Number.isFinite(ulEligibleRateVerified) ? `${toPct(ulEligibleRateVerified)}%` : "n/a"}`);
  lines.push(`- ulCandidateSourceCounts: ${JSON.stringify(stats?.ulCandidateSourceCounts || {})}`);
  lines.push(`- ulNoCandidateClassCounts: ${JSON.stringify(stats?.ulNoCandidateClassCounts || {})}`);
  lines.push(`- ulReferenceFromDeterministicCount: ${Number(stats?.ulReferenceFromDeterministicCount ?? 0)}`);
  lines.push("");

  lines.push("## Miss Reason TopN");
  lines.push("");
  if (!missReasonTop.length) {
    lines.push("- no eligible miss reasons observed");
  } else {
    for (const entry of missReasonTop.slice(0, 10)) {
      lines.push(`- ${entry.reason}: ${entry.count}`);
    }
  }
  lines.push("");
  lines.push("## Miss SubReason TopN");
  lines.push("");
  const missSubReasonCounts = stats?.ulCoverageMissReasonSubCounts && typeof stats.ulCoverageMissReasonSubCounts === "object"
    ? stats.ulCoverageMissReasonSubCounts
    : {};
  const missSubReasonTop = Object.entries(missSubReasonCounts).sort((a, b) => Number(b[1] || 0) - Number(a[1] || 0));
  if (!missSubReasonTop.length) {
    lines.push("- no eligible miss sub-reasons observed");
  } else {
    for (const [reason, count] of missSubReasonTop.slice(0, 10)) {
      lines.push(`- ${reason}: ${count}`);
    }
  }
  lines.push("");

  lines.push("## Top Barcodes By Miss Reason");
  lines.push("");
  if (!missReasonTop.length) {
    lines.push("- none");
  } else {
    for (const entry of missReasonTop.slice(0, 10)) {
      lines.push(`### ${entry.reason}`);
      const samples = Array.isArray(entry.samples) ? entry.samples : [];
      if (!samples.length) {
        lines.push("- no samples");
        lines.push("");
        continue;
      }
      for (const sample of samples) {
        lines.push(
          `- barcode=${sample.barcode} role=${sample.role} phase=${sample.phase} ulCandidate=${sample.ulCandidateCount} ulSource=${sample.ulCandidateSource ?? "none"} ulNoCandidateClass=${sample.ulNoCandidateClass ?? "n/a"} ulReference=${sample.ulReferenceCount ?? "n/a"} ulComparable=${sample.ulComparableCount ?? sample.ulProducedCount} scoreStatus=${sample.scoreResponseStatus}`,
        );
      }
      lines.push("");
    }
  }

  lines.push("## Eligible vs Skipped");
  lines.push("");
  const skippedRows = Array.isArray(payload?.skippedRows) ? payload.skippedRows : [];
  if (!skippedRows.length) {
    lines.push("- skippedRows: none");
  } else {
    const grouped = skippedRows.reduce((acc, row) => {
      const key = String(row?.ulDiagnosticsEligibilityReason || "unknown");
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});
    for (const [reason, count] of Object.entries(grouped).sort((a, b) => Number(b[1] || 0) - Number(a[1] || 0))) {
      lines.push(`- ${reason}: ${count}`);
    }
  }
  lines.push("");

  return `${lines.join("\n")}\n`;
};

const buildScoreNotFoundTargetedDiagnostics = ({ attempts, summaryPath }) => {
  const serialAttempts = Array.isArray(attempts) ? attempts.filter((row) => row?.phase === "serial") : [];
  const rows = serialAttempts
    .filter((row) => row?.scoreNotFoundTargeted === true)
    .map((row) => ({
      barcode: row?.barcode ?? null,
      role: row?.role ?? null,
      phase: row?.phase ?? null,
      sourceAttribution: row?.sourceAttribution ?? null,
      sourceTypeFinal: row?.sourceTypeFinal === true,
      terminalReason: row?.terminalReason ?? null,
      stage0Winner: row?.stage0Winner ?? null,
      scoreResponseStatus: row?.scoreResponseStatus ?? "unknown",
      scoreResponseReasonCode: row?.scoreResponseReasonCode ?? null,
      ingredientCount: Number(row?.regulatoryRichSignals?.ingredientCount ?? 0) || 0,
      doseCount: Number(row?.regulatoryRichSignals?.doseCount ?? 0) || 0,
      trace: row?.scoreNotFoundTrace ?? null,
    }));
  const reasonCounts = rows.reduce((acc, row) => {
    const key = String(row?.trace?.reason || "unknown");
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  return {
    generatedAt: new Date().toISOString(),
    summaryPath,
    total: rows.length,
    byReason: reasonCounts,
    rows,
  };
};

const buildDecisionSupportDistribution = (rows) => {
  const counts = Object.fromEntries(DECISION_SUPPORT_VERDICTS.map((key) => [key, 0]));
  const byRoleCounts = {};
  const sourceRows = Array.isArray(rows) ? rows : [];
  for (const row of sourceRows) {
    const verdict = normalizeDecisionSupportVerdict(row?.decisionSupportVerdict);
    if (!verdict) continue;
    counts[verdict] += 1;
    const role = String(row?.role ?? "unknown");
    byRoleCounts[role] ||= Object.fromEntries(DECISION_SUPPORT_VERDICTS.map((key) => [key, 0]));
    byRoleCounts[role][verdict] += 1;
  }

  const total = DECISION_SUPPORT_VERDICTS.reduce((sum, key) => sum + Number(counts[key] || 0), 0);
  const rates = Object.fromEntries(
    DECISION_SUPPORT_VERDICTS.map((key) => [key, total > 0 ? Number((counts[key] / total).toFixed(6)) : 0]),
  );
  const byRole = {};
  for (const [role, roleCounts] of Object.entries(byRoleCounts)) {
    const roleTotal = DECISION_SUPPORT_VERDICTS.reduce((sum, key) => sum + Number(roleCounts[key] || 0), 0);
    byRole[role] = {
      ...roleCounts,
      total: roleTotal,
      rates: Object.fromEntries(
        DECISION_SUPPORT_VERDICTS.map((key) => [key, roleTotal > 0 ? Number((roleCounts[key] / roleTotal).toFixed(6)) : 0]),
      ),
    };
  }

  return {
    counts,
    rates,
    total,
    byRole,
  };
};

const summarize = ({ attempts, barcodes, preflight }) => {
  const serialAttempts = attempts.filter((row) => row.phase === "serial");
  const isKillerPhase = (phase) => phase === "killer_cold" || phase === "killer_hot";
  const nonKillerAttempts = attempts.filter((row) => !isKillerPhase(row.phase));
  const metricAttempts = serialAttempts.length > 0
    ? serialAttempts
    : nonKillerAttempts.length > 0
      ? nonKillerAttempts
      : attempts;
  const metricAttemptsScope = serialAttempts.length > 0 ? "serial" : nonKillerAttempts.length > 0 ? "non_killer_fallback" : "all_attempts";
  const doneSeenRate = metricAttempts.length
    ? metricAttempts.filter((row) => row.doneSeen).length / metricAttempts.length
    : 0;

  const perBarcodeEntries = serialAttempts.length > 0
    ? barcodes
    : Array.from(
      metricAttempts.reduce((acc, row) => {
        const barcode = normalizeBarcode(row?.barcode || "");
        if (!barcode) return acc;
        const key = `${String(row?.role || "unknown")}::${barcode}`;
        if (!acc.has(key)) {
          acc.set(key, { role: String(row?.role || "unknown"), barcode });
        }
        return acc;
      }, new Map()),
    ).map(([, value]) => value);

  const perBarcode = perBarcodeEntries.map((entry) => {
    const rows = metricAttempts.filter((row) => normalizeBarcode(row.barcode) === normalizeBarcode(entry.barcode));
    const passCount = rows.filter((row) => row.doneSeen).length;
    const passRate = rows.length ? passCount / rows.length : 0;
    return {
      role: entry.role,
      barcode: entry.barcode,
      total: rows.length,
      passCount,
      passRate,
    };
  });

  const deadEndRate = metricAttempts.length
    ? metricAttempts.filter((row) => !row.doneSeen && !row.errorCode && !row.requestError).length / metricAttempts.length
    : 0;

  const tFirstBundleP95 = percentile(
    metricAttempts.map((row) => row.tFirstBundleMs).filter(Number.isFinite),
    0.95,
  );
  const tDoneP95 = percentile(
    metricAttempts.map((row) => row.tDoneMs).filter(Number.isFinite),
    0.95,
  );
  const eventLoopLagP95 = percentile(
    metricAttempts.map((row) => row.eventLoopLagP95DuringRequest).filter(Number.isFinite),
    0.95,
  );

  const terminalReasonCounts = attempts.reduce((acc, row) => {
    const key = String(row.terminalReason || "UNKNOWN");
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const timeoutClassCounts = attempts.reduce((acc, row) => {
    const key = String(row.timeoutClass || "NONE");
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const killerRows = attempts.filter(
    (row) => row.role === "killer" && (row.phase === "killer_cold" || row.phase === "killer_hot"),
  );
  const killerTimeoutClassCounts = killerRows.reduce((acc, row) => {
    const key = String(row.timeoutClass || "NONE");
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const killerConfiguredAttempts = killerRows.length;
  const killerInfraRows = killerRows.filter(
    (row) => row.infraUnavailable === true || String(row.terminalReason || "").toUpperCase() === "INFRA_UNAVAILABLE_HEALTHCHECK",
  );
  const killerInfraUnavailableCount = killerInfraRows.length;
  const killerInfraUnavailableRate = killerConfiguredAttempts > 0 ? killerInfraUnavailableCount / killerConfiguredAttempts : 0;
  const killerProductRows = killerRows.filter(
    (row) => !(row.infraUnavailable === true || String(row.terminalReason || "").toUpperCase() === "INFRA_UNAVAILABLE_HEALTHCHECK"),
  );
  const killerProductAttempts = killerProductRows.length;
  const killerProductDoneSeenRate =
    killerProductAttempts > 0 ? killerProductRows.filter((row) => row.doneSeen === true).length / killerProductAttempts : 0;
  const killerInconclusive = killerConfiguredAttempts > 0 && killerProductAttempts === 0;
  const killerProductTimeoutClassCounts = killerProductRows.reduce((acc, row) => {
    const key = String(row.timeoutClass || "NONE");
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const killerProductTerminalReasonCounts = killerProductRows.reduce((acc, row) => {
    const key = String(row.terminalReason || "UNKNOWN");
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const killerProductClientTimeoutCount = Number(killerProductTerminalReasonCounts.CLIENT_TIMEOUT || 0);
  const killerProductClientTimeoutRate =
    killerProductAttempts > 0 ? killerProductClientTimeoutCount / killerProductAttempts : 0;
  const killerProductSseConnectedButNoDoneCount = Number(killerProductTimeoutClassCounts.SSE_CONNECTED_BUT_NO_DONE || 0);

  const popupBlockedCount = attempts.filter((row) => row.popupBlocked).length;
  const watchdogTriggeredCount = attempts.filter((row) => row.watchdogTriggered).length;
  const firstFrameRows = metricAttempts.filter((row) => typeof row.firstFrameDisplayIdentityMode === "string");
  const firstFramePollutionCount = firstFrameRows.filter(
    (row) =>
      (row.firstFrameSourceAttribution === "web_hint_unverified" || row.firstFrameSourceAttribution === "unknown")
      && row.firstFrameDisplayIdentityMode === "trusted",
  ).length;
  const firstFrameTrustedRate = firstFrameRows.length
    ? firstFrameRows.filter((row) => row.firstFrameDisplayIdentityMode === "trusted").length / firstFrameRows.length
    : 0;
  const firstFrameUnverifiedRate = firstFrameRows.length
    ? firstFrameRows.filter((row) => row.firstFrameDisplayIdentityMode === "unverified").length / firstFrameRows.length
    : 0;
  const firstFramePendingRate = firstFrameRows.length
    ? firstFrameRows.filter((row) => row.firstFrameDisplayIdentityMode === "pending").length / firstFrameRows.length
    : 0;
  const firstFrameRenameCount = firstFrameRows.filter((row) => row.firstFrameRename === true).length;
  const firstFrameRegulatoryRows = firstFrameRows.filter((row) => {
    const firstFrameSource = normalizeText(row.firstFrameSourceAttribution).toLowerCase();
    const finalSource = normalizeText(row.sourceAttribution).toLowerCase();
    const winnerSource = normalizeStage0WinnerAttribution(row.stage0Winner);
    const trustedSourceObserved =
      firstFrameSource === "verified_regulatory"
      || firstFrameSource === "label_record"
      || finalSource === "verified_regulatory"
      || finalSource === "label_record"
      || winnerSource === "verified_regulatory"
      || winnerSource === "label_record";
    return trustedSourceObserved;
  });
  const firstFrameTrustedRateRegulatory = firstFrameRegulatoryRows.length
    ? firstFrameRegulatoryRows.filter((row) => row.firstFrameDisplayIdentityMode === "trusted").length / firstFrameRegulatoryRows.length
    : 0;

  const contentAppliedRows = metricAttempts.filter((row) => row.contentValueApplied === true);
  const contentValuePassRows = contentAppliedRows.filter((row) => row.contentValuePass === true);
  const contentValuePassRate = contentAppliedRows.length ? contentValuePassRows.length / contentAppliedRows.length : 0;
  const verifiedContentRows = contentAppliedRows.filter(
    (row) => row.sourceAttribution === "verified_regulatory" || row.sourceAttribution === "label_record",
  );
  const verifiedContentPassRate = verifiedContentRows.length
    ? verifiedContentRows.filter((row) => row.contentValuePass === true).length / verifiedContentRows.length
    : 0;
  const webHintContentRows = contentAppliedRows.filter((row) => row.sourceAttribution === "web_hint_unverified");
  const webHintContentPassRate = webHintContentRows.length
    ? webHintContentRows.filter((row) => row.contentValuePass === true).length / webHintContentRows.length
    : 0;
  const degradedContentRows = contentAppliedRows.filter((row) => row.degradedMode);
  const degradedContentPassRate = degradedContentRows.length
    ? degradedContentRows.filter((row) => row.contentValuePass === true).length / degradedContentRows.length
    : 1;
  const ulVisibilityRows = contentAppliedRows.filter((row) => row?.moduleValue?.usage?.ulRequired === true);
  const ulVisibilityPassRate = ulVisibilityRows.length
    ? ulVisibilityRows.filter((row) => row?.moduleValue?.usage?.ulPass === true).length / ulVisibilityRows.length
    : 1;
  const contentValueFailReasonCounts = contentAppliedRows.reduce((acc, row) => {
    const reasons = Array.isArray(row.contentValueFailReasons) ? row.contentValueFailReasons : [];
    for (const reason of reasons) {
      const key = String(reason || "UNKNOWN");
      acc[key] = (acc[key] || 0) + 1;
    }
    return acc;
  }, {});
  const contentValueFailReasonTop = buildContentFailReasonTop(contentAppliedRows, 10);
  const verifiedFinalContentRows = verifiedContentRows.filter((row) => {
    const winner = normalizeStage0WinnerAttribution(row.stage0Winner);
    const winnerTrusted = winner === "verified_regulatory" || winner === "label_record";
    return row.sourceTypeFinal === true || winnerTrusted;
  });
  const verifiedFinalContentPassRate = verifiedFinalContentRows.length
    ? verifiedFinalContentRows.filter((row) => row.contentValuePass === true).length / verifiedFinalContentRows.length
    : 0;
  const regulatoryRichRows = verifiedFinalContentRows.filter((row) => row.regulatoryRichSignals && typeof row.regulatoryRichSignals === "object");
  const regulatoryRichRateAttemptWeighted = regulatoryRichRows.length
    ? regulatoryRichRows.filter((row) => row.regulatoryRichSignals?.pass === true).length / regulatoryRichRows.length
    : 0;
  const regulatoryRichUniqueRows = dedupeRowsByBarcodeKeepLast(regulatoryRichRows);
  const regulatoryRichRateUniqueBarcode = regulatoryRichUniqueRows.length
    ? regulatoryRichUniqueRows.filter((row) => row.regulatoryRichSignals?.pass === true).length / regulatoryRichUniqueRows.length
    : 0;
  const regulatoryRichRate = regulatoryRichRateAttemptWeighted;
  const scoreVisibleRate = regulatoryRichRows.length
    ? regulatoryRichRows.filter((row) => row.regulatoryRichSignals?.scorePass === true).length / regulatoryRichRows.length
    : 0;
  const scoreNumericVisibleRate = regulatoryRichRows.length
    ? regulatoryRichRows.filter((row) => row.regulatoryRichSignals?.scoreAvailable === true).length / regulatoryRichRows.length
    : 0;
  const decisionSupportDistribution = buildDecisionSupportDistribution(metricAttempts);
  const decisionSupportTopBlockerDistribution = (() => {
    const counts = {};
    for (const row of metricAttempts) {
      const codes = Array.isArray(row?.decisionSupportTopBlockerCodes)
        ? row.decisionSupportTopBlockerCodes
        : [];
      for (const code of codes) {
        const key = String(code || "").trim();
        if (!key) continue;
        counts[key] = (counts[key] || 0) + 1;
      }
    }
    return Object.entries(counts)
      .sort((a, b) => Number(b[1] || 0) - Number(a[1] || 0))
      .map(([code, count]) => ({ code, count }));
  })();
  const dsldAuthoritativeRows = regulatoryRichRows.filter(
    (row) => String(row?.scoreQuerySource || "").toLowerCase() === "dsld",
  );
  const nutritionLabelLikeFilteredCount = regulatoryRichRows.reduce(
    (sum, row) => sum + (Number(row?.nutritionLabelLikeFilteredCount ?? 0) || 0),
    0,
  );
  const nutritionLabelLikeLeakCount = regulatoryRichRows.reduce(
    (sum, row) => sum + (Number(row?.nutritionLabelLikeLeakCount ?? 0) || 0),
    0,
  );
  const nutritionLabelLikeLeakCountDsld = dsldAuthoritativeRows.reduce(
    (sum, row) => sum + (Number(row?.nutritionLabelLikeLeakCount ?? 0) || 0),
    0,
  );
  const nutritionLabelLikeLeakRowCountDsld = dsldAuthoritativeRows.filter(
    (row) => (Number(row?.nutritionLabelLikeLeakCount ?? 0) || 0) > 0,
  ).length;
  const nutritionLabelLikeSamplesTop = (() => {
    const counts = {};
    for (const row of regulatoryRichRows) {
      const samples = Array.isArray(row?.nutritionLabelLikeFilteredSamples)
        ? row.nutritionLabelLikeFilteredSamples
        : [];
      for (const sample of samples) {
        const key = String(sample || "").trim();
        if (!key) continue;
        counts[key] = (counts[key] || 0) + 1;
      }
    }
    return Object.entries(counts)
      .sort((a, b) => Number(b[1] || 0) - Number(a[1] || 0))
      .slice(0, 10)
      .map(([name, count]) => ({ name, count }));
  })();
  const ulEntriesCoverageVerified = regulatoryRichRows.length
    ? regulatoryRichRows.filter((row) => Number(row?.regulatoryRichSignals?.ulEntriesCount ?? 0) > 0).length / regulatoryRichRows.length
    : 0;
  const ulReferenceCoverageVerified = regulatoryRichRows.length
    ? regulatoryRichRows.filter(
      (row) =>
        Number(
          row?.ulReferenceCount
          ?? row?.regulatoryRichSignals?.ulEntriesCount
          ?? row?.regulatoryRichSignals?.ulProducedCount
          ?? 0,
        ) > 0,
    ).length / regulatoryRichRows.length
    : 0;
  const ulComparableCoverageVerified = regulatoryRichRows.length
    ? regulatoryRichRows.filter(
      (row) =>
        Number(
          row?.ulComparableCount
          ?? row?.ulProducedCount
          ?? row?.regulatoryRichSignals?.ulProducedCount
          ?? 0,
        ) > 0,
    ).length / regulatoryRichRows.length
    : 0;
  const ulEligibleRateVerified = regulatoryRichRows.length
    ? regulatoryRichRows.filter(
      (row) => Number(row?.ulCandidateCount ?? row?.regulatoryRichSignals?.ulCandidateCount ?? 0) > 0,
    ).length / regulatoryRichRows.length
    : 0;
  const ulCoverageDiagnosticsRows = regulatoryRichRows.map((row) => ({
    barcode: row.barcode,
    role: row.role,
    phase: row.phase,
    sourceAttribution: row.sourceAttribution,
    scoreResponseStatus: row.scoreResponseStatus,
    ulDiagnosticsEligible: row.ulDiagnosticsEligible === true,
    ulDiagnosticsEligibilityReason: row.ulDiagnosticsEligibilityReason ?? null,
    ulCandidateCount: Number(row.ulCandidateCount ?? row?.regulatoryRichSignals?.ulCandidateCount ?? 0) || 0,
    ulCandidateSource:
      String(row.ulCandidateSource ?? row?.regulatoryRichSignals?.ulCandidateSource ?? "none").toLowerCase(),
    ulNoCandidateClass:
      row.ulNoCandidateClass
      ?? row?.regulatoryRichSignals?.ulNoCandidateClass
      ?? null,
    ulReferenceFromDeterministic:
      row.ulReferenceFromDeterministic === true
      || row?.regulatoryRichSignals?.ulReferenceFromDeterministic === true,
    ulReferenceCount:
      Number(
        row.ulReferenceCount
        ?? row?.regulatoryRichSignals?.ulEntriesCount
        ?? row?.regulatoryRichSignals?.ulProducedCount
        ?? 0,
      ) || 0,
    ulComparableCount:
      Number(
        row.ulComparableCount
        ?? row.ulProducedCount
        ?? row?.regulatoryRichSignals?.ulProducedCount
        ?? 0,
      ) || 0,
    ulProducedCount:
      Number(
        row.ulComparableCount
        ?? row.ulProducedCount
        ?? row?.regulatoryRichSignals?.ulProducedCount
        ?? 0,
      ) || 0,
    ulMissReasonTop: row.ulMissReasonTop ?? row?.regulatoryRichSignals?.ulMissReasonTop ?? null,
    ulMissReasonSubTop: row.ulMissReasonSubTop ?? row?.regulatoryRichSignals?.ulMissReasonSubTop ?? null,
    ulMissReasonCounts:
      row.ulMissReasonCounts && typeof row.ulMissReasonCounts === "object"
        ? row.ulMissReasonCounts
        : row?.regulatoryRichSignals?.ulMissReasonCounts && typeof row.regulatoryRichSignals.ulMissReasonCounts === "object"
          ? row.regulatoryRichSignals.ulMissReasonCounts
          : {},
    ulMissReasonSubCounts:
      row.ulMissReasonSubCounts && typeof row.ulMissReasonSubCounts === "object"
        ? row.ulMissReasonSubCounts
        : row?.regulatoryRichSignals?.ulMissReasonSubCounts && typeof row.regulatoryRichSignals.ulMissReasonSubCounts === "object"
          ? row.regulatoryRichSignals.ulMissReasonSubCounts
          : {},
  }));
  const ulCoverageDiagnosticsEligibleRows = ulCoverageDiagnosticsRows.filter((row) => row.ulDiagnosticsEligible === true);
  const ulCoverageDiagnosticsEligibleCount = ulCoverageDiagnosticsEligibleRows.length;
  const ulCoverageDiagnosticsSkippedCount = ulCoverageDiagnosticsRows.length - ulCoverageDiagnosticsEligibleRows.length;
  const ulCoverageMissReasonCounts = ulCoverageDiagnosticsEligibleRows.reduce((acc, row) => {
    if (row.ulProducedCount > 0) return acc;
    const reason = String(row.ulMissReasonTop || UL_COVERAGE_MISS_REASONS.NO_UL_CANDIDATE);
    acc[reason] = (acc[reason] || 0) + 1;
    return acc;
  }, {});
  const ulCoverageMissReasonSubCounts = ulCoverageDiagnosticsEligibleRows.reduce((acc, row) => {
    if (row.ulProducedCount > 0) return acc;
    const reason = String(row.ulMissReasonSubTop || "NONE");
    if (!reason || reason === "NONE") return acc;
    acc[reason] = (acc[reason] || 0) + 1;
    return acc;
  }, {});
  const ulCandidateSourceCounts = ulCoverageDiagnosticsEligibleRows.reduce((acc, row) => {
    const key = String(row.ulCandidateSource || "none").toLowerCase();
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const ulNoCandidateClassCounts = ulCoverageDiagnosticsEligibleRows.reduce((acc, row) => {
    const key = normalizeText(row.ulNoCandidateClass).toLowerCase();
    if (!key) return acc;
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const ulReferenceFromDeterministicCount = ulCoverageDiagnosticsEligibleRows.filter(
    (row) => row.ulReferenceFromDeterministic === true,
  ).length;
  const ulCoverageMissReasonTop = Object.entries(ulCoverageMissReasonCounts)
    .sort((a, b) => Number(b[1] || 0) - Number(a[1] || 0))
    .slice(0, 10)
    .map(([reason, count]) => ({
      reason,
      count,
      samples: ulCoverageDiagnosticsEligibleRows
        .filter((row) => (row.ulMissReasonTop || UL_COVERAGE_MISS_REASONS.NO_UL_CANDIDATE) === reason)
        .slice(0, 3)
        .map((row) => ({
          barcode: row.barcode,
          role: row.role,
          phase: row.phase,
          ulCandidateCount: row.ulCandidateCount,
          ulCandidateSource: row.ulCandidateSource,
          ulNoCandidateClass: row.ulNoCandidateClass,
          ulReferenceCount: row.ulReferenceCount,
          ulComparableCount: row.ulComparableCount,
          ulProducedCount: row.ulProducedCount,
        })),
    }));
  const regulatoryRichFailRows = regulatoryRichRows.filter((row) => row.regulatoryRichSignals?.pass !== true);
  const regulatoryRichFailReasonCounts = regulatoryRichFailRows.reduce((acc, row) => {
    const failure = deriveRegulatoryRichFailure({ signals: row?.regulatoryRichSignals ?? null });
    const key = String(failure.primaryReason || "UNKNOWN");
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const regulatoryRichFailReasonTop = buildRegulatoryRichFailReasonTop(regulatoryRichFailRows, 10);
  const consistencyFailRows = regulatoryRichRows.filter(
    (row) =>
      row.coverDetailConsistencyPass === false
      || String(row.consistencyFailReason || row?.regulatoryRichSignals?.consistencyFailReason || "").trim().length > 0,
  );
  const coverDetailConsistencyFailCount = consistencyFailRows.length;
  const consistencyFailReasonCounts = consistencyFailRows.reduce((acc, row) => {
    const reason = String(
      row.consistencyFailReason
      || row?.regulatoryRichSignals?.consistencyFailReason
      || "UNKNOWN",
    )
      .trim()
      .toUpperCase();
    acc[reason] = (acc[reason] || 0) + 1;
    return acc;
  }, {});
  const consistencyFailTop = buildConsistencyFailTop(consistencyFailRows, 10);
  const ceilingSuiteRows = serialAttempts.filter((row) => row.role === "ceiling");
  const ceilingSuiteDoneSeenRate = ceilingSuiteRows.length
    ? ceilingSuiteRows.filter((row) => row.doneSeen === true).length / ceilingSuiteRows.length
    : 0;
  const ceilingSuiteConsistencyFailCount = ceilingSuiteRows.filter(
    (row) => row.coverDetailConsistencyPass === false,
  ).length;
  const ceilingSuiteScoreTerminalSeenRate = ceilingSuiteRows.length
    ? ceilingSuiteRows.filter((row) => row.scoreTerminalSeen === true).length / ceilingSuiteRows.length
    : 0;
  const ceilingSuiteVerifiedUnverifiedConflictCount = ceilingSuiteRows.filter(
    (row) => row.verifiedUnverifiedConflict === true,
  ).length;
  const ceilingSuite = {
    total: ceilingSuiteRows.length,
    doneSeenRate: ceilingSuiteDoneSeenRate,
    coverDetailConsistencyFailCount: ceilingSuiteConsistencyFailCount,
    scoreTerminalSeenRate: ceilingSuiteScoreTerminalSeenRate,
    verifiedUnverifiedConflictCount: ceilingSuiteVerifiedUnverifiedConflictCount,
    pass:
      ceilingSuiteRows.length === 0
        ? true
        : (
          ceilingSuiteDoneSeenRate >= 1
          && ceilingSuiteConsistencyFailCount === 0
          && ceilingSuiteScoreTerminalSeenRate >= 1
          && ceilingSuiteVerifiedUnverifiedConflictCount === 0
        ),
  };
  const scoreNotFoundTargetedRows = serialAttempts.filter((row) => row.scoreNotFoundTargeted === true);
  const scoreNotFoundTargetedCount = scoreNotFoundTargetedRows.length;
  const scoreNotFoundTargetedByReason = scoreNotFoundTargetedRows.reduce((acc, row) => {
    const key = String(row?.scoreNotFoundTrace?.reason || "unknown");
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const esterRows = regulatoryRichRows;
  const esterCorePassCount = esterRows.filter((row) => row.esterCorePass === true).length;
  const esterCoreRateAll = esterRows.length ? esterCorePassCount / esterRows.length : 0;
  const esterFixableRows = esterRows.filter((row) => !row.dataCeilingKind);
  const esterCoreRateFixable = esterFixableRows.length
    ? esterFixableRows.filter((row) => row.esterCorePass === true).length / esterFixableRows.length
    : 0;
  const esterCoreRateByRole = esterRows.reduce((acc, row) => {
    const key = String(row.role || "unknown");
    const bucket = acc[key] || { total: 0, passCount: 0, passRate: 0 };
    bucket.total += 1;
    if (row.esterCorePass === true) bucket.passCount += 1;
    bucket.passRate = bucket.total > 0 ? bucket.passCount / bucket.total : 0;
    acc[key] = bucket;
    return acc;
  }, {});
  const esterUlEligibleRows = esterRows.filter((row) => row.esterUlEligible === true);
  const esterUlReferenceReadyRateEligible = esterUlEligibleRows.length
    ? esterUlEligibleRows.filter((row) => row.esterUlReferenceReady === true || row.esterUlReady === true).length / esterUlEligibleRows.length
    : 0;
  const esterUlComparableReadyRateEligible = esterUlEligibleRows.length
    ? esterUlEligibleRows.filter((row) => row.esterUlComparableReady === true).length / esterUlEligibleRows.length
    : 0;
  const esterUlReadyRateEligible = esterUlReferenceReadyRateEligible;
  const dataCeilingRateByRole = esterRows.reduce((acc, row) => {
    const key = String(row.role || "unknown");
    const bucket = acc[key] || { total: 0, dataCeilingCount: 0, dataCeilingRate: 0 };
    bucket.total += 1;
    if (row.dataCeilingKind) bucket.dataCeilingCount += 1;
    bucket.dataCeilingRate = bucket.total > 0 ? bucket.dataCeilingCount / bucket.total : 0;
    acc[key] = bucket;
    return acc;
  }, {});
  const regulatoryRichRateByRole = regulatoryRichRows.reduce((acc, row) => {
    const roleKey = String(row.role || "unknown");
    const bucket = acc[roleKey] || {
      total: 0,
      passCount: 0,
      passRate: 0,
      scoreVisibleCount: 0,
      scoreVisibleRate: 0,
    };
    bucket.total += 1;
    if (row.regulatoryRichSignals?.pass === true) {
      bucket.passCount += 1;
    }
    if (row.regulatoryRichSignals?.scorePass === true) {
      bucket.scoreVisibleCount += 1;
    }
    bucket.passRate = bucket.total > 0 ? bucket.passCount / bucket.total : 0;
    bucket.scoreVisibleRate = bucket.total > 0 ? bucket.scoreVisibleCount / bucket.total : 0;
    acc[roleKey] = bucket;
    return acc;
  }, {});
  const regulatoryRichLnhpdThinRows = regulatoryRichRows.filter(
    (row) =>
      row.role === "lnhpd"
      && Number(row?.regulatoryRichSignals?.ingredientCount ?? 0) === 0
      && Number(row?.regulatoryRichSignals?.doseCount ?? 0) === 0,
  );
  const regulatoryRichLnhpdThinPassCount = regulatoryRichLnhpdThinRows.filter(
    (row) => row?.regulatoryRichSignals?.pass === true,
  ).length;
  const regulatoryRichLnhpdThinFailReasonCounts = regulatoryRichLnhpdThinRows.reduce((acc, row) => {
    const failure = deriveRegulatoryRichFailure({ signals: row?.regulatoryRichSignals ?? null });
    const key = String(failure.primaryReason || "UNKNOWN");
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const regulatoryRichLnhpdThin = {
    total: regulatoryRichLnhpdThinRows.length,
    passCount: regulatoryRichLnhpdThinPassCount,
    passRate: regulatoryRichLnhpdThinRows.length
      ? regulatoryRichLnhpdThinPassCount / regulatoryRichLnhpdThinRows.length
      : 0,
    failReasonCounts: regulatoryRichLnhpdThinFailReasonCounts,
  };
  const degradedRateByRole = metricAttempts.reduce((acc, row) => {
    const roleKey = String(row.role || "unknown");
    const bucket = acc[roleKey] || {
      total: 0,
      degradedCount: 0,
      degradedRate: 0,
      terminalReasonCounts: {},
    };
    bucket.total += 1;
    if (row.degradedMode === true) {
      bucket.degradedCount += 1;
    }
    const key = String(row.terminalReason || "UNKNOWN");
    bucket.terminalReasonCounts[key] = (bucket.terminalReasonCounts[key] || 0) + 1;
    bucket.degradedRate = bucket.total > 0 ? bucket.degradedCount / bucket.total : 0;
    acc[roleKey] = bucket;
    return acc;
  }, {});
  const refreshingBannerCount = attempts.filter(
    (row) => row.refreshingBannerDetected && !row.screenshotRejected,
  ).length;
  const debugToastCount = attempts.filter(
    (row) => row.debugToastDetected && !row.screenshotRejected,
  ).length;
  const screenshotNoiseBlockedCount = attempts.filter(
    (row) =>
      row.screenshotRejected
      && Array.isArray(row.screenshotNoiseFlags)
      && (row.screenshotNoiseFlags.includes("refreshing_banner") || row.screenshotNoiseFlags.includes("debug_toast")),
  ).length;
  const expoStaticHintCount = attempts.filter((row) => row.expoStaticHintDetected).length;

  const dod = {
    doneSeenRate: doneSeenRate >= 0.95,
    perBarcodePassRate: perBarcode.every((row) => row.passRate >= 0.9),
    deadEndRate: deadEndRate === 0,
    tFirstBundleP95: tFirstBundleP95 != null ? tFirstBundleP95 <= 1500 : false,
    tDoneP95: tDoneP95 != null ? tDoneP95 <= 12000 : false,
    eventLoopLagP95: eventLoopLagP95 != null ? eventLoopLagP95 <= 100 : false,
    popupBlocked: popupBlockedCount === 0,
    firstFramePollution: firstFramePollutionCount === 0,
    firstFrameRename: firstFrameRenameCount === 0,
    firstFramePending: REQUIRE_FIRST_FRAME_PENDING ? firstFramePendingRate > 0 : true,
    firstFrameTrustedRegulatory:
      firstFrameRegulatoryRows.length > 0
        ? firstFrameTrustedRateRegulatory >= FIRST_FRAME_TRUSTED_REGULATORY_THRESHOLD
        : false,
    contentValuePassRate:
      contentAppliedRows.length > 0
        ? contentValuePassRate >= CONTENT_VALUE_PASS_THRESHOLD
        : false,
    verifiedContentPassRate:
      verifiedContentRows.length > 0
        ? verifiedContentPassRate >= VERIFIED_CONTENT_PASS_THRESHOLD
        : false,
    verifiedFinalContentPassRate:
      verifiedFinalContentRows.length > 0
        ? verifiedFinalContentPassRate >= VERIFIED_CONTENT_PASS_THRESHOLD
        : false,
    webHintContentPassRate:
      webHintContentRows.length > 0
        ? webHintContentPassRate >= WEB_HINT_CONTENT_PASS_THRESHOLD
        : !REQUIRE_WEB_HINT_COVERAGE,
    degradedContentPassRate:
      degradedContentRows.length > 0
        ? degradedContentPassRate >= DEGRADED_CONTENT_PASS_THRESHOLD
        : true,
    ulVisibilityPassRate:
      ulVisibilityRows.length > 0
        ? ulVisibilityPassRate >= UL_VISIBILITY_PASS_THRESHOLD
        : true,
    regulatoryRichRate:
      regulatoryRichUniqueRows.length > 0
        ? regulatoryRichRateUniqueBarcode >= REGULATORY_RICH_RATE_THRESHOLD
        : false,
    scoreVisibleRate:
      regulatoryRichRows.length > 0
        ? scoreVisibleRate >= SCORE_VISIBLE_RATE_THRESHOLD
        : false,
    coverDetailConsistency: coverDetailConsistencyFailCount === 0,
    ceilingSuite: ceilingSuite.pass,
    refreshingBanner: !CAPTURE_SCREENSHOTS || refreshingBannerCount === 0,
    debugToast: !CAPTURE_SCREENSHOTS || debugToastCount === 0,
    screenshotNoiseBlocked: true,
    expoStaticHint: SHOW_SCAN_DEBUG || expoStaticHintCount === 0,
  };

  return {
    attemptsTotal: attempts.length,
    serialAttempts: serialAttempts.length,
    metricAttempts: metricAttempts.length,
    metricAttemptsScope,
    doneSeenRate,
    perBarcode,
    deadEndRate,
    tFirstBundleP95,
    tDoneP95,
    eventLoopLagP95,
    popupBlockedCount,
    watchdogTriggeredCount,
    firstFramePollutionCount,
    firstFrameRenameCount,
    firstFrameTrustedRate,
    firstFrameUnverifiedRate,
    firstFramePendingRate,
    firstFrameTrustedRateRegulatory,
    contentValuePassRate,
    verifiedContentPassRate,
    verifiedFinalContentPassRate,
    webHintContentPassRate,
    degradedContentPassRate,
    ulVisibilityPassRate,
    regulatoryRichRate,
    regulatoryRichRate_attemptWeighted: regulatoryRichRateAttemptWeighted,
    regulatoryRichRate_uniqueBarcode: regulatoryRichRateUniqueBarcode,
    scoreVisibleRate,
    scoreNumericVisibleRate,
    roleDefinitionVersion: ROLE_DEFINITION_VERSION,
    decisionSupportVerdictDistribution: decisionSupportDistribution.counts,
    decisionSupportVerdictDistributionRates: decisionSupportDistribution.rates,
    decisionSupportVerdictTotal: decisionSupportDistribution.total,
    decisionSupportVerdictDistributionByRole: decisionSupportDistribution.byRole,
    decisionSupportTopBlockerDistribution,
    nutritionLabelLikeFilteredCount,
    nutritionLabelLikeLeakCount,
    nutritionLabelLikeLeakCountDsld,
    nutritionLabelLikeLeakRowCountDsld,
    nutritionLabelLikeSamplesTop,
    ulEntriesCoverageVerified,
    ulReferenceCoverageVerified,
    ulComparableCoverageVerified,
    ulEligibleRateVerified,
    ulCoverageMissReasonCounts,
    ulCoverageMissReasonSubCounts,
    ulCandidateSourceCounts,
    ulNoCandidateClassCounts,
    ulReferenceFromDeterministicCount,
    ulCoverageMissReasonTop,
    ulCoverageDiagnosticsEligibleCount,
    ulCoverageDiagnosticsSkippedCount,
    scoreNotFoundTargetedCount,
    scoreNotFoundTargetedByReason,
    esterCoreRate_all: esterCoreRateAll,
    esterCoreRate_fixable: esterCoreRateFixable,
    esterCoreRateByRole,
    esterUlReferenceReadyRate_eligible: esterUlReferenceReadyRateEligible,
    esterUlComparableReadyRate_eligible: esterUlComparableReadyRateEligible,
    esterUlReadyRate_eligible: esterUlReadyRateEligible,
    dataCeilingRateByRole,
    degradedRateByRole,
    regulatoryRichRateByRole,
    regulatoryRichLnhpdThin,
    contentValueFailReasonCounts,
    contentValueFailReasonTop,
    regulatoryRichFailReasonCounts,
    regulatoryRichFailReasonTop,
    coverDetailConsistencyFailCount,
    consistencyFailReasonCounts,
    consistencyFailTop,
    ceilingSuite,
    refreshingBannerCount,
    debugToastCount,
    screenshotNoiseBlockedCount,
    expoStaticHintCount,
    terminalReasonCounts,
    timeoutClassCounts,
    killerTimeoutClassCounts,
    killerConfiguredAttempts,
    killerInfraUnavailableCount,
    killerInfraUnavailableRate,
    killerProductAttempts,
    killerProductDoneSeenRate,
    killerInconclusive,
    killerProductTimeoutClassCounts,
    killerProductTerminalReasonCounts,
    killerProductClientTimeoutCount,
    killerProductClientTimeoutRate,
    killerProductSseConnectedButNoDoneCount,
    killerConfidence: summarizeKillerConfidence(attempts),
    preflightPopupBlocked: Boolean(preflight?.popupBlocked),
    dod,
  };
};

const main = async () => {
  await ensureDir(OUT_DIR);
  const screenshotsDir = path.join(OUT_DIR, "screenshots");
  await ensureDir(screenshotsDir);

  const preflight = await loadJsonSafe(PREFLIGHT_JSON ? (path.isAbsolute(PREFLIGHT_JSON) ? PREFLIGHT_JSON : path.join(ROOT_DIR, PREFLIGHT_JSON)) : "");
  if (preflight?.popupBlocked && FAIL_ON_PREFLIGHT_POPUP) {
    const message = "preflight popupBlocked=true (use --allow-popup-preflight to continue)";
    console.error(`[mobile-soak-run] ${message}`);
    process.exit(2);
  }

  const barcodes = await resolveBarcodes();
  if (barcodes.length < 5) {
    console.warn(`[mobile-soak-run] expected at least 5 barcodes, got ${barcodes.length}`);
  }

  const attempts = [];
  let attemptIndex = 0;

  const runSequentialPhase = async (phase, rounds) => {
    for (let round = 1; round <= rounds; round += 1) {
      for (const entry of barcodes) {
        attemptIndex += 1;
        // eslint-disable-next-line no-await-in-loop
        const result = await runOneAttempt({
          phase,
          round,
          role: entry.role,
          barcode: entry.barcode,
          preflight,
          screenshotRoot: screenshotsDir,
          attemptIndex,
        });
        attempts.push(result);
        console.log(
          `[mobile-soak-run] ${phase} round=${round} role=${entry.role} barcode=${entry.barcode} status=${result.status} done=${result.doneSeen} terminal=${result.terminalReason}`,
        );
      }
    }
  };

  const runConcurrentPhase = async (phase, rounds, level) => {
    for (let round = 1; round <= rounds; round += 1) {
      const offset = (round - 1) * level;
      const batch = Array.from({ length: level }, (_, index) => {
        const entry = barcodes[(offset + index) % barcodes.length];
        attemptIndex += 1;
        return runOneAttempt({
          phase,
          round,
          role: entry.role,
          barcode: entry.barcode,
          preflight,
          screenshotRoot: screenshotsDir,
          attemptIndex,
        });
      });
      // eslint-disable-next-line no-await-in-loop
      const results = await Promise.all(batch);
      attempts.push(...results);
      const passCount = results.filter((row) => row.status === "pass").length;
      console.log(`[mobile-soak-run] ${phase} round=${round} pass=${passCount}/${results.length}`);
    }
  };
  const runKillerPhase = async (phase, rounds, coldBootEachRound) => {
    if (rounds <= 0) return;
    const killerEntry =
      barcodes.find((entry) => normalizeBarcode(entry.barcode) === KILLER_BARCODE)
      || barcodes.find((entry) => entry.role === "killer")
      || { role: "killer", barcode: KILLER_BARCODE };
    for (let round = 1; round <= rounds; round += 1) {
      if (coldBootEachRound && !DRY_RUN) {
        const rebootResult = rebootSimulator({ udid: SIM_UDID });
        if (!rebootResult.ok) {
          console.warn(
            `[mobile-soak-run] ${phase} round=${round} simulator reboot reported non-ideal status`,
            rebootResult,
          );
        }
      }
      attemptIndex += 1;
      // eslint-disable-next-line no-await-in-loop
      const result = await runOneAttempt({
        phase,
        round,
        role: killerEntry.role,
        barcode: killerEntry.barcode,
        preflight,
        screenshotRoot: screenshotsDir,
        attemptIndex,
      });
      attempts.push(result);
      console.log(
        `[mobile-soak-run] ${phase} round=${round} role=${killerEntry.role} barcode=${killerEntry.barcode} status=${result.status} done=${result.doneSeen} terminal=${result.terminalReason}`,
      );
    }
  };

  if (INCLUDE_COLD_HOT) {
    await runSequentialPhase("cold_start", 1);
    await runSequentialPhase("hot_start", 1);
  }

  await runSequentialPhase("serial", SERIAL_ROUNDS);
  await runConcurrentPhase("concurrent", CONCURRENT_ROUNDS, CONCURRENT_LEVEL);
  await runKillerPhase("killer_cold", KILLER_COLD_RUNS, true);
  await runKillerPhase("killer_hot", KILLER_HOT_RUNS, false);

  const stats = summarize({ attempts, barcodes, preflight });

  const summary = {
    generatedAt: new Date().toISOString(),
    runId: `mobile-soak-${nowTs}`,
    apiBaseUrl: API_BASE_URL,
    config: {
      serialRounds: SERIAL_ROUNDS,
      concurrentRounds: CONCURRENT_ROUNDS,
      concurrencyLevel: CONCURRENT_LEVEL,
      includeColdHot: INCLUDE_COLD_HOT,
      killerBarcode: KILLER_BARCODE,
      killerColdRuns: KILLER_COLD_RUNS,
      killerHotRuns: KILLER_HOT_RUNS,
      sseTimeoutMs: SSE_TIMEOUT_MS,
      retries: RETRIES,
      captureScreenshots: CAPTURE_SCREENSHOTS,
      simUdid: SIM_UDID,
      appScheme: APP_SCHEME,
      resultRoutePath: RESULT_ROUTE_PATH,
      openResultScreen: OPEN_RESULT_SCREEN,
      openResultPhases: Array.from(OPEN_RESULT_PHASES),
      deeplinkWaitMs: DEEPLINK_WAIT_MS,
      roleDefinitionVersion: ROLE_DEFINITION_VERSION,
      decisionSupportViewMode: DECISION_SUPPORT_VIEW_MODE,
      dryRun: DRY_RUN,
      healthPreflightEnabled: HEALTH_PREFLIGHT_ENABLED,
      healthcheckUrl: HEALTHCHECK_URL,
      healthcheckTimeoutMs: HEALTHCHECK_TIMEOUT_MS,
      thresholds: {
        contentValuePassRate: CONTENT_VALUE_PASS_THRESHOLD,
        verifiedContentPassRate: VERIFIED_CONTENT_PASS_THRESHOLD,
        webHintContentPassRate: WEB_HINT_CONTENT_PASS_THRESHOLD,
        ulVisibilityPassRate: UL_VISIBILITY_PASS_THRESHOLD,
        degradedContentPassRate: DEGRADED_CONTENT_PASS_THRESHOLD,
        firstFrameTrustedRegulatoryRate: FIRST_FRAME_TRUSTED_REGULATORY_THRESHOLD,
        requireFirstFramePending: REQUIRE_FIRST_FRAME_PENDING,
        requireWebHintCoverage: REQUIRE_WEB_HINT_COVERAGE,
      },
    },
    preflight,
    barcodes,
    stats,
    attempts,
    artifacts: {
      summary: "rounds_summary.json",
      report: "rounds_report.md",
      ulCoverageDiagnosticsJson: "ul_coverage_diagnostics.json",
      ulCoverageDiagnosticsMd: "ul_coverage_diagnostics.md",
      scoreNotFoundTargetedJson: "score_not_found_targeted.json",
    },
  };

  const summaryPath = path.join(OUT_DIR, "rounds_summary.json");
  await fs.writeFile(summaryPath, JSON.stringify(summary, null, 2));
  const ulCoverageDiagnostics = buildUlCoverageDiagnostics({ attempts, stats, summaryPath });
  const ulCoverageDiagnosticsJsonPath = path.join(OUT_DIR, "ul_coverage_diagnostics.json");
  const ulCoverageDiagnosticsMdPath = path.join(OUT_DIR, "ul_coverage_diagnostics.md");
  const scoreNotFoundTargetedPath = path.join(OUT_DIR, "score_not_found_targeted.json");
  await fs.writeFile(ulCoverageDiagnosticsJsonPath, JSON.stringify(ulCoverageDiagnostics, null, 2));
  await fs.writeFile(
    ulCoverageDiagnosticsMdPath,
    renderUlCoverageDiagnosticsMarkdown(ulCoverageDiagnostics),
    "utf8",
  );
  const scoreNotFoundTargeted = buildScoreNotFoundTargetedDiagnostics({ attempts, summaryPath });
  await fs.writeFile(scoreNotFoundTargetedPath, JSON.stringify(scoreNotFoundTargeted, null, 2));

  const reportScript = path.join(ROOT_DIR, "scripts", "maintainer", "mobile-soak-report.mjs");
  const reportProc = spawnSync("node", [reportScript, "--summary", summaryPath], {
    cwd: ROOT_DIR,
    encoding: "utf8",
  });
  if (reportProc.status !== 0) {
    console.warn("[mobile-soak-run] report generation failed", reportProc.stderr || reportProc.stdout);
  } else if (reportProc.stdout) {
    process.stdout.write(reportProc.stdout);
  }

  console.log("[mobile-soak-run] summary", summaryPath);
  console.log("[mobile-soak-run] ulCoverageDiagnosticsJson", ulCoverageDiagnosticsJsonPath);
  console.log("[mobile-soak-run] ulCoverageDiagnosticsMd", ulCoverageDiagnosticsMdPath);
  console.log("[mobile-soak-run] scoreNotFoundTargetedJson", scoreNotFoundTargetedPath);
  console.log(
    `[mobile-soak-run] DoD: doneSeenRate=${toPct(stats.doneSeenRate)} contentValue=${toPct(stats.contentValuePassRate)} verified=${toPct(stats.verifiedContentPassRate)} webHint=${toPct(stats.webHintContentPassRate)} richUnique=${toPct(stats.regulatoryRichRate_uniqueBarcode)} scoreVisible=${toPct(stats.scoreVisibleRate)}`,
  );

  if (DRY_RUN) {
    process.exit(0);
  }
  const killerGatePass =
    (KILLER_COLD_RUNS + KILLER_HOT_RUNS) === 0
      ? true
      : Number(stats?.killerProductAttempts ?? 0) === 0
        ? true
        : Number(stats?.killerProductDoneSeenRate ?? 0) === 1;
  const overallPass =
    stats.dod.doneSeenRate
    && stats.dod.perBarcodePassRate
    && stats.dod.deadEndRate
    && stats.dod.firstFramePollution
    && stats.dod.firstFramePending
    && stats.dod.firstFrameTrustedRegulatory
    && stats.dod.contentValuePassRate
    && stats.dod.verifiedContentPassRate
    && stats.dod.webHintContentPassRate
    && stats.dod.degradedContentPassRate
    && stats.dod.ulVisibilityPassRate
    && stats.dod.coverDetailConsistency
    && stats.dod.refreshingBanner
    && stats.dod.debugToast
    && stats.dod.expoStaticHint
    && killerGatePass;

  process.exit(overallPass ? 0 : 1);
};

main().catch((error) => {
  console.error("[mobile-soak-run] failed", error instanceof Error ? error.message : error);
  process.exit(1);
});
