#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";

function parseArgs(argv) {
  const args = {
    manifest: "scripts/maintainer/fixtures/ocr_regression_set_v1.json",
    outDir: null,
    failOnMissing: true,
    allowEmpty: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const value = argv[i];
    if (value === "--manifest") {
      args.manifest = argv[++i];
      continue;
    }
    if (value === "--out-dir") {
      args.outDir = argv[++i];
      continue;
    }
    if (value === "--allow-missing") {
      args.failOnMissing = false;
      continue;
    }
    if (value === "--allow-empty") {
      args.allowEmpty = true;
      continue;
    }
  }

  return args;
}

function sha256Hex(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function normalizeSha(value) {
  return String(value ?? "").trim().toLowerCase();
}

function validateManifest(manifest, options = {}) {
  if (!manifest || typeof manifest !== "object") {
    throw new Error("invalid manifest payload");
  }
  if (!Array.isArray(manifest.samples)) {
    throw new Error("manifest.samples must be an array");
  }
  if (!manifest.samples.length) {
    if (options.allowEmpty) {
      return;
    }
    throw new Error("manifest.samples is empty (dataset not ready)");
  }

  const allowedPanelTypes = new Set([
    "supplement_facts",
    "ingredients_list",
    "nutrition_facts",
    "front_non_target",
  ]);
  const allowedExpectedBehaviors = new Set([
    "parse_supplement_facts",
    "parse_ingredients_list",
    "should_warn_or_abstain",
  ]);

  for (const sample of manifest.samples) {
    if (!sample?.image_id) throw new Error("sample.image_id is required");
    if (!sample?.bucket) throw new Error(`sample(${sample.image_id}) bucket is required`);
    if (!sample?.storage_uri) throw new Error(`sample(${sample.image_id}) storage_uri is required`);
    if (!sample?.sha256) throw new Error(`sample(${sample.image_id}) sha256 is required`);
    if (!sample?.panel_type) throw new Error(`sample(${sample.image_id}) panel_type is required`);
    if (!allowedPanelTypes.has(sample.panel_type)) {
      throw new Error(`sample(${sample.image_id}) has unsupported panel_type=${sample.panel_type}`);
    }
    if (typeof sample?.eval_target !== "boolean") {
      throw new Error(`sample(${sample.image_id}) eval_target must be boolean`);
    }
    if (!sample?.expected_behavior) {
      throw new Error(`sample(${sample.image_id}) expected_behavior is required`);
    }
    if (!allowedExpectedBehaviors.has(sample.expected_behavior)) {
      throw new Error(
        `sample(${sample.image_id}) has unsupported expected_behavior=${sample.expected_behavior}`,
      );
    }
    if (
      sample.panel_type === "supplement_facts"
      || sample.panel_type === "ingredients_list"
    ) {
      if (sample.eval_target !== true) {
        throw new Error(`sample(${sample.image_id}) panel_type=${sample.panel_type} requires eval_target=true`);
      }
    }
    if (
      sample.panel_type === "nutrition_facts"
      || sample.panel_type === "front_non_target"
    ) {
      if (sample.eval_target !== false) {
        throw new Error(`sample(${sample.image_id}) panel_type=${sample.panel_type} requires eval_target=false`);
      }
    }
    if (
      sample.has_table_evidence_gt != null
      && typeof sample.has_table_evidence_gt !== "boolean"
    ) {
      throw new Error(`sample(${sample.image_id}) has_table_evidence_gt must be boolean|null`);
    }
    const source = sample?.source ?? {};
    if (!source?.product_url) {
      throw new Error(`sample(${sample.image_id}) source.product_url is required`);
    }
    if (!source?.image_url) {
      throw new Error(`sample(${sample.image_id}) source.image_url is required`);
    }
    if (!source?.retrieved_at) {
      throw new Error(`sample(${sample.image_id}) source.retrieved_at is required`);
    }
    const retrievedAtTs = Date.parse(String(source.retrieved_at));
    if (Number.isNaN(retrievedAtTs)) {
      throw new Error(`sample(${sample.image_id}) source.retrieved_at must be ISO timestamp`);
    }
    if (!source?.license) {
      throw new Error(`sample(${sample.image_id}) source.license is required`);
    }
    if (!source?.attribution) {
      throw new Error(`sample(${sample.image_id}) source.attribution is required`);
    }
    const gtKeys = Array.isArray(sample?.key_ingredients_gt)
      ? sample.key_ingredients_gt.filter(Boolean)
      : [];
    const ingredientCount = Number.isFinite(Number(sample?.ingredient_count_gt))
      ? Number(sample.ingredient_count_gt)
      : null;
    if (sample.eval_target) {
      if (!gtKeys.length) {
        throw new Error(`sample(${sample.image_id}) target sample requires key_ingredients_gt`);
      }
      if (!(typeof ingredientCount === "number" && ingredientCount >= 1)) {
        throw new Error(`sample(${sample.image_id}) target sample requires ingredient_count_gt >= 1`);
      }
    } else {
      if (ingredientCount != null && ingredientCount < 0) {
        throw new Error(`sample(${sample.image_id}) non-target ingredient_count_gt must be null or >= 0`);
      }
    }
  }
}

async function downloadSupabaseObject({ supabase, bucket, objectPath }) {
  const { data, error } = await supabase.storage.from(bucket).download(objectPath);
  if (error || !data) {
    throw new Error(`supabase download failed for ${bucket}/${objectPath}: ${error?.message ?? "unknown"}`);
  }
  return Buffer.from(await data.arrayBuffer());
}

async function readSampleBytes(sample, supabase) {
  const uri = String(sample.storage_uri);
  if (uri.startsWith("supabase://")) {
    const raw = uri.slice("supabase://".length);
    const slash = raw.indexOf("/");
    if (slash <= 0) {
      throw new Error(`invalid supabase URI: ${uri}`);
    }
    const bucket = raw.slice(0, slash);
    const objectPath = raw.slice(slash + 1);
    return downloadSupabaseObject({ supabase, bucket, objectPath });
  }

  if (uri.startsWith("http://") || uri.startsWith("https://")) {
    const response = await fetch(uri);
    if (!response.ok) {
      throw new Error(`http download failed (${response.status}) for ${uri}`);
    }
    return Buffer.from(await response.arrayBuffer());
  }

  if (uri.startsWith("file://")) {
    return fs.readFile(new URL(uri));
  }

  if (uri.startsWith("/")) {
    return fs.readFile(uri);
  }

  throw new Error(`unsupported storage_uri protocol: ${uri}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const manifestPath = path.resolve(process.cwd(), args.manifest);
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  validateManifest(manifest, { allowEmpty: args.allowEmpty });

  const datasetVersion = String(manifest.datasetVersion ?? "ocr_regression_set");
  const outputRoot = args.outDir
    ? path.resolve(process.cwd(), args.outDir)
    : path.resolve(process.cwd(), "output", `ocr-regression-set-${datasetVersion}`);
  const imageDir = path.join(outputRoot, "images");
  await fs.mkdir(imageDir, { recursive: true });

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_READONLY_KEY;
  const supabase =
    supabaseUrl && supabaseKey
      ? createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } })
      : null;

  const results = [];
  let failed = 0;

  for (const sample of manifest.samples) {
    const imageId = String(sample.image_id);
    const ext = path.extname(String(sample.storage_uri)) || ".jpg";
    const outputFile = path.join(imageDir, `${imageId}${ext}`);

    try {
      if (String(sample.storage_uri).startsWith("supabase://") && !supabase) {
        throw new Error("supabase credentials are required for supabase:// storage_uri");
      }
      const bytes = await readSampleBytes(sample, supabase);
      const actualSha = sha256Hex(bytes);
      const expectedSha = normalizeSha(sample.sha256);
      const matched = actualSha === expectedSha;

      if (!matched) {
        throw new Error(`sha256 mismatch expected=${expectedSha} actual=${actualSha}`);
      }

      await fs.writeFile(outputFile, bytes);
      results.push({ imageId, ok: true, outputFile, sha256: actualSha, bucket: sample.bucket });
    } catch (error) {
      failed += 1;
      results.push({
        imageId,
        ok: false,
        bucket: sample.bucket,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const summary = {
    datasetVersion,
    manifestPath,
    outputRoot,
    total: manifest.samples.length,
    passed: manifest.samples.length - failed,
    failed,
    targetSamples: manifest.samples.filter((sample) => sample?.eval_target === true).length,
    nonTargetSamples: manifest.samples.filter((sample) => sample?.eval_target === false).length,
    generatedAt: new Date().toISOString(),
  };

  await fs.writeFile(path.join(outputRoot, "fetch_summary.json"), JSON.stringify(summary, null, 2));
  await fs.writeFile(path.join(outputRoot, "fetch_results.json"), JSON.stringify(results, null, 2));

  console.log(`[ocr-regression-fetch] output=${outputRoot} passed=${summary.passed}/${summary.total}`);
  if (summary.total === 0 && args.allowEmpty) {
    console.warn("[ocr-regression-fetch] manifest has no samples; skipping download in allow-empty mode");
    return;
  }
  if (failed > 0 && args.failOnMissing) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("[ocr-regression-fetch] failed", error);
  process.exit(1);
});
