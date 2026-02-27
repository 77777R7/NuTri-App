import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

import { loadDatasetCache } from "../src/scoring/v4DatasetCache.js";

type Args = {
  outDir: string;
  gzip: boolean;
  includeCitations: boolean;
};

function parseArgs(argv: string[]): Args {
  const outDirDefault = path.resolve(process.cwd(), "..", "output", "v4-dataset-cache");
  const outDirFlag = argv.indexOf("--out");
  const outDir =
    outDirFlag >= 0 && typeof argv[outDirFlag + 1] === "string"
      ? path.resolve(argv[outDirFlag + 1]!)
      : outDirDefault;

  return {
    outDir,
    gzip: argv.includes("--gzip"),
    includeCitations: argv.includes("--include-citations"),
  };
}

function stableSort<T>(list: T[], keyFn: (row: T) => string) {
  return [...list].sort((a, b) => keyFn(a).localeCompare(keyFn(b)));
}

function mapToObjectOfArrays(map: Map<string, string[]>) {
  const out: Record<string, string[]> = {};
  Array.from(map.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .forEach(([id, refs]) => {
      out[id] = Array.isArray(refs) ? refs : [];
    });
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  fs.mkdirSync(args.outDir, { recursive: true });

  const cache = await loadDatasetCache();

  const ingredientMeta = stableSort(
    Array.from(cache.ingredientMetaById.values()),
    (row) => row.id,
  );

  const payload: any = {
    generatedAt: new Date().toISOString(),
    datasetVersion: cache.datasetVersion ?? null,
    counts: {
      ingredients: ingredientMeta.length,
      evidenceRows: cache.evidenceRows.length,
      formRows: cache.formRows.length,
      formAliases: cache.formAliases.length,
      globalFormAliases: cache.globalFormAliases.length,
    },
    ingredients: ingredientMeta,
    evidenceRows: stableSort(cache.evidenceRows, (row) => row.id),
    formRows: stableSort(cache.formRows, (row) => row.id),
    formAliases: stableSort(cache.formAliases, (row) => row.id),
  };

  if (args.includeCitations) {
    payload.citations = {
      evidenceCitationsById: mapToObjectOfArrays(cache.evidenceCitationsById),
      formCitationsById: mapToObjectOfArrays(cache.formCitationsById),
      evidenceReferenceIds: stableSort(Array.from(cache.evidenceCitationsById.values()).flat(), (v) => v),
      formReferenceIds: stableSort(Array.from(cache.formCitationsById.values()).flat(), (v) => v),
    };
  }

  const summary = {
    generatedAt: payload.generatedAt,
    datasetVersion: payload.datasetVersion,
    counts: payload.counts,
    notes: {
      includeCitations: args.includeCitations,
      gzip: args.gzip,
    },
  };

  const baseName = `v4_dataset_cache${args.includeCitations ? "_with_citations" : ""}.json`;
  const outJsonPath = path.join(args.outDir, args.gzip ? `${baseName}.gz` : baseName);
  const outSummaryPath = path.join(args.outDir, "v4_dataset_cache.summary.json");

  const json = JSON.stringify(payload, null, 2) + "\n";
  if (args.gzip) {
    fs.writeFileSync(outJsonPath, zlib.gzipSync(json, { level: 9 }));
  } else {
    fs.writeFileSync(outJsonPath, json);
  }
  fs.writeFileSync(outSummaryPath, JSON.stringify(summary, null, 2) + "\n");

  // Keep stdout short and non-sensitive.
  console.log(`[export-v4-dataset-cache] wrote ${outJsonPath}`);
  console.log(`[export-v4-dataset-cache] wrote ${outSummaryPath}`);
  console.log(`[export-v4-dataset-cache] counts=${JSON.stringify(summary.counts)}`);
}

main().catch((err) => {
  const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  console.error(`[export-v4-dataset-cache] failed: ${msg}`);
  process.exit(1);
});

