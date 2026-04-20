#!/usr/bin/env node
/* eslint-disable no-console */

import fs from "node:fs/promises";
import path from "node:path";

import {
  DEFAULT_CANADIAN_CANDIDATE_PATH,
  buildCanadianOfficialMergeWave,
  collectExcludedIdsFromStagingFiles,
  normalizeText,
  parseBrandTargets,
  writeCanadianOfficialMergeWave,
} from "./lib/canadian-official-merge-wave.mjs";

const ROOT = process.cwd();

const args = process.argv.slice(2);
const getArg = (name, fallback = null) => {
  const flag = `--${name}`;
  const index = args.indexOf(flag);
  if (index === -1 || index + 1 >= args.length) return fallback;
  return args[index + 1];
};

const splitCsv = (value) =>
  String(value ?? "")
    .split(",")
    .map((item) => normalizeText(item))
    .filter(Boolean);

const resolveRootPath = (value) => path.resolve(ROOT, value);

const main = async () => {
  const inputJson = getArg("input-json", DEFAULT_CANADIAN_CANDIDATE_PATH);
  const waveId = getArg("wave-id", "canadian_official_merge_wave_01");
  const outDir = getArg(
    "out-dir",
    path.join("output", "canadian_brand_full_coverage_wave_v0", "merge_waves", waveId),
  );
  const brands = splitCsv(getArg("brands", "Jamieson,Webber Naturals,Progressive"));
  const brandTargets = parseBrandTargets(getArg("brand-targets", "Jamieson:10,Webber Naturals:10,Progressive:5"));
  const limitRaw = getArg("limit", null);
  const limit = limitRaw == null ? null : Number(limitRaw);
  const excludeStagingJson = splitCsv(getArg("exclude-staging-json", ""));
  const fileStem = getArg("file-stem", `staging_products.${waveId}`);

  const inputPath = resolveRootPath(inputJson);
  const candidatePayload = JSON.parse(await fs.readFile(inputPath, "utf8"));
  const candidates = Array.isArray(candidatePayload?.products) ? candidatePayload.products : [];
  const { excludeGtins, excludeProductIds } = await collectExcludedIdsFromStagingFiles(
    excludeStagingJson.map(resolveRootPath),
  );

  const payload = buildCanadianOfficialMergeWave({
    candidates,
    waveId,
    sourceCandidatePath: inputJson,
    brands,
    brandTargets,
    excludeGtins,
    excludeProductIds,
    limit: Number.isFinite(limit) && limit > 0 ? limit : null,
  });

  const outputs = await writeCanadianOfficialMergeWave({
    payload,
    outDir: resolveRootPath(outDir),
    fileStem,
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        outputs,
        summary: payload.summary,
      },
      null,
      2,
    ),
  );
};

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
