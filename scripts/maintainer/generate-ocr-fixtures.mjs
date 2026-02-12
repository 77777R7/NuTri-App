#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

function parseArgs(argv) {
  const args = {
    manifest: "scripts/maintainer/fixtures/ocr_regression_set_v1.json",
    imagesDir: null,
    fixturesDir: "scripts/maintainer/fixtures/ocr_outputs_v1",
    apiBase: process.env.LABEL_SCAN_REGRESSION_API_BASE ?? "http://127.0.0.1:3001",
    bearer: process.env.LABEL_SCAN_REGRESSION_BEARER ?? "",
    authBypass:
      process.env.LABEL_SCAN_REGRESSION_AUTH_BYPASS === "1"
      || process.env.LABEL_SCAN_REGRESSION_AUTH_BYPASS === "true",
    preprocessProfile: process.env.LABEL_SCAN_REGRESSION_PREPROCESS_PROFILE ?? "jpeg_1800_q82",
    overwrite: true,
    maxSamples: null,
    concurrency: Number.parseInt(process.env.OCR_FIXTURE_GEN_CONCURRENCY ?? "3", 10),
  };

  for (let i = 0; i < argv.length; i++) {
    const value = argv[i];
    if (value === "--manifest") args.manifest = argv[++i];
    else if (value === "--images-dir") args.imagesDir = argv[++i];
    else if (value === "--fixtures-dir") args.fixturesDir = argv[++i];
    else if (value === "--api-base") args.apiBase = argv[++i];
    else if (value === "--bearer") args.bearer = argv[++i];
    else if (value === "--auth-bypass") args.authBypass = true;
    else if (value === "--preprocess-profile") args.preprocessProfile = argv[++i];
    else if (value === "--max-samples") args.maxSamples = Number.parseInt(argv[++i], 10);
    else if (value === "--concurrency") args.concurrency = Number.parseInt(argv[++i], 10);
    else if (value === "--no-overwrite") args.overwrite = false;
  }

  if (!Number.isFinite(args.concurrency) || args.concurrency < 1) {
    throw new Error(`invalid concurrency: ${args.concurrency}`);
  }
  return args;
}

function sha256Hex(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function computeImageHash(base64) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < base64.length; i++) {
    hash ^= base64.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  const normalized = (hash >>> 0).toString(16).padStart(8, "0");
  return `${normalized}-${base64.length}`;
}

async function ensureApiReachable(args) {
  const response = await fetch(`${args.apiBase.replace(/\/$/, "")}/api/nutri-tips`, {
    headers: {
      ...(args.bearer ? { Authorization: `Bearer ${args.bearer}` } : {}),
      ...(args.authBypass ? { "x-auth-disabled": "1" } : {}),
    },
  }).catch((error) => {
    throw new Error(`failed to reach API (${args.apiBase}): ${error instanceof Error ? error.message : String(error)}`);
  });

  if (!response?.ok) {
    throw new Error(`API not ready: GET /api/nutri-tips status=${response?.status}`);
  }
}

async function readManifest(args) {
  const manifestPath = path.resolve(process.cwd(), args.manifest);
  const payload = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  const samples = Array.isArray(payload?.samples) ? payload.samples : [];
  if (!samples.length) {
    throw new Error("manifest has no samples");
  }
  const selected = Number.isFinite(args.maxSamples)
    ? samples.slice(0, Math.max(0, args.maxSamples))
    : samples;
  return {
    manifestPath,
    datasetVersion: payload.datasetVersion ?? "unknown",
    samples: selected,
  };
}

async function inferImagesDir(args, datasetVersion) {
  if (args.imagesDir) {
    return path.resolve(process.cwd(), args.imagesDir);
  }
  return path.resolve(process.cwd(), "output", `ocr-regression-set-${datasetVersion}`, "images");
}

async function generateOne({ args, sample, imagesDir, fixturesDir }) {
  const imageId = String(sample.image_id ?? "").trim();
  if (!imageId) throw new Error("missing image_id");

  const fixturePath = path.join(fixturesDir, `${imageId}.json`);
  if (!args.overwrite) {
    try {
      await fs.access(fixturePath);
      return { imageId, ok: true, skipped: true, fixturePath };
    } catch {
      // continue
    }
  }

  const ext = path.extname(String(sample.storage_uri ?? "")) || ".jpg";
  const imagePath = path.join(imagesDir, `${imageId}${ext}`);
  const bytes = await fs.readFile(imagePath);
  const expectedSha = String(sample.sha256 ?? "").trim().toLowerCase();
  const actualSha = sha256Hex(bytes);
  if (expectedSha && actualSha !== expectedSha) {
    throw new Error(`sha_mismatch expected=${expectedSha} actual=${actualSha}`);
  }

  const base64 = bytes.toString("base64");
  const imageHash = computeImageHash(base64);
  const response = await fetch(`${args.apiBase.replace(/\/$/, "")}/api/analyze-label?includeAnalysis=0`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(args.bearer ? { Authorization: `Bearer ${args.bearer}` } : {}),
      ...(args.authBypass ? { "x-auth-disabled": "1" } : {}),
    },
    body: JSON.stringify({
      imageHash,
      imageBase64: base64,
      includeAnalysis: false,
      preprocessProfile: args.preprocessProfile,
      deviceId: `ocr-fixture-${imageId}`,
      debug: true,
    }),
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload) {
    throw new Error(`api_failed_${response.status}`);
  }
  if (payload.status === "failed") {
    throw new Error(`analysis_failed:${payload.message ?? "unknown"}`);
  }

  const fixturePayload = {
    fixtureMeta: {
      imageId,
      generatedAt: new Date().toISOString(),
      apiBase: args.apiBase,
      preprocessProfile: args.preprocessProfile,
      imageSha256: actualSha,
      sourceStorageUri: sample.storage_uri,
    },
    ...payload,
  };

  await fs.writeFile(fixturePath, `${JSON.stringify(fixturePayload, null, 2)}\n`);
  return { imageId, ok: true, skipped: false, fixturePath };
}

async function runQueue(items, concurrency, worker) {
  const results = [];
  let cursor = 0;
  async function next() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => next()));
  return results;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { manifestPath, datasetVersion, samples } = await readManifest(args);
  const imagesDir = await inferImagesDir(args, datasetVersion);
  const fixturesDir = path.resolve(process.cwd(), args.fixturesDir);

  await fs.mkdir(fixturesDir, { recursive: true });
  await ensureApiReachable(args);

  const results = await runQueue(samples, args.concurrency, async (sample) => {
    try {
      const result = await generateOne({ args, sample, imagesDir, fixturesDir });
      if (!result.skipped) {
        console.log(`[ocr-fixtures] generated ${result.imageId}`);
      } else {
        console.log(`[ocr-fixtures] skipped ${result.imageId}`);
      }
      return result;
    } catch (error) {
      const imageId = String(sample?.image_id ?? "unknown");
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[ocr-fixtures] failed ${imageId}: ${message}`);
      return { imageId, ok: false, error: message };
    }
  });

  const failed = results.filter((item) => !item.ok);
  const summary = {
    generatedAt: new Date().toISOString(),
    manifestPath,
    datasetVersion,
    apiBase: args.apiBase,
    imagesDir,
    fixturesDir,
    total: results.length,
    passed: results.length - failed.length,
    failed: failed.length,
  };
  const outputDir = path.resolve(process.cwd(), "output", `ocr-fixture-gen-${Date.now()}`);
  await fs.mkdir(outputDir, { recursive: true });
  await fs.writeFile(path.join(outputDir, "ocr_fixture_generation_summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
  await fs.writeFile(path.join(outputDir, "ocr_fixture_generation_results.json"), `${JSON.stringify(results, null, 2)}\n`);

  console.log(
    `[ocr-fixtures] done fixtures=${fixturesDir} passed=${summary.passed}/${summary.total} output=${outputDir}`,
  );
  if (failed.length) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("[ocr-fixtures] failed", error);
  process.exit(1);
});
