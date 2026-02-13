import path from "node:path";
import { fileURLToPath } from "node:url";

export const AUTO_GENERATED_HEADER = `// AUTO-GENERATED. DO NOT EDIT.
// Source: shared/schema/analysisBundleV4.ts
// Run: npx tsx scripts/ci/sync-analysis-bundle-schema.ts
`;

const __filename = fileURLToPath(import.meta.url);
export const repoRoot = path.resolve(path.dirname(__filename), "..", "..");
export const sharedSchemaPath = path.join(repoRoot, "shared", "schema", "analysisBundleV4.ts");
export const backendSchemaPath = path.join(repoRoot, "backend", "src", "analysisBundle.ts");

export const buildBackendSchemaMirror = (sharedSchemaRaw: string): string => {
  const normalizedSource = sharedSchemaRaw.replace(/^\s+/, "");
  return `${AUTO_GENERATED_HEADER}\n${normalizedSource.replace(/\n?$/, "\n")}`;
};
