#!/usr/bin/env tsx
/* eslint-disable no-console */
import fs from "node:fs/promises";

import {
  backendSchemaPath,
  buildBackendSchemaMirror,
  sharedSchemaPath,
} from "./analysisBundleSchemaSync";

const checkOnly = process.argv.includes("--check");

async function main() {
  const sharedRaw = await fs.readFile(sharedSchemaPath, "utf8");
  const nextMirror = buildBackendSchemaMirror(sharedRaw);

  let currentMirror = "";
  try {
    currentMirror = await fs.readFile(backendSchemaPath, "utf8");
  } catch {
    currentMirror = "";
  }

  if (checkOnly) {
    if (currentMirror !== nextMirror) {
      throw new Error(
        `analysisBundle mirror drift detected at backend/src/analysisBundle.ts. Run: npx tsx scripts/ci/sync-analysis-bundle-schema.ts`,
      );
    }
    console.log("[sync-analysis-bundle-schema] mirror is up-to-date");
    return;
  }

  await fs.writeFile(backendSchemaPath, nextMirror, "utf8");
  console.log(`[sync-analysis-bundle-schema] wrote ${backendSchemaPath}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
