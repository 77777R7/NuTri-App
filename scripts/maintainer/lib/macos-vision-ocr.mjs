import crypto from "node:crypto";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const ROOT = process.cwd();
const SWIFT_SOURCE_PATH = path.join(ROOT, "scripts", "maintainer", "ocr-image-text.swift");
const SWIFT_BINARY_PATH = path.join(ROOT, "output", ".cache", "macos-vision-ocr", "ocr-image-text");
const OCR_CACHE_DIR = path.join(ROOT, "output", ".cache", "official_image_ocr");

const stableHash = (value) =>
  crypto.createHash("sha256").update(String(value ?? "")).digest("hex");

const ensureDirectory = async (dirPath) => {
  await fs.mkdir(dirPath, { recursive: true });
};

const shouldCompileBinary = () => {
  if (!fsSync.existsSync(SWIFT_BINARY_PATH)) return true;
  const sourceStat = fsSync.statSync(SWIFT_SOURCE_PATH);
  const binaryStat = fsSync.statSync(SWIFT_BINARY_PATH);
  return sourceStat.mtimeMs > binaryStat.mtimeMs;
};

const ensureBinary = async () => {
  await ensureDirectory(path.dirname(SWIFT_BINARY_PATH));
  if (!shouldCompileBinary()) return SWIFT_BINARY_PATH;
  execFileSync("swiftc", [SWIFT_SOURCE_PATH, "-O", "-o", SWIFT_BINARY_PATH], {
    stdio: "inherit",
  });
  return SWIFT_BINARY_PATH;
};

export const runMacosVisionOcr = async (imageUrl) => {
  const normalizedUrl = String(imageUrl ?? "").trim();
  if (!normalizedUrl) return null;

  await ensureDirectory(OCR_CACHE_DIR);
  const cachePath = path.join(OCR_CACHE_DIR, `${stableHash(normalizedUrl)}.json`);
  if (fsSync.existsSync(cachePath)) {
    return JSON.parse(await fs.readFile(cachePath, "utf8"));
  }

  const binaryPath = await ensureBinary();
  const stdout = execFileSync(binaryPath, ["--url", normalizedUrl], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 8,
  });
  const payload = JSON.parse(stdout);
  await fs.writeFile(cachePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return payload;
};
