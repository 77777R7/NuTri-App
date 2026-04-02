import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const supabaseDir = path.join(repoRoot, "supabase");
const linkedProjectRefPath = path.join(supabaseDir, ".temp", "project-ref");
const configTomlPath = path.join(supabaseDir, "config.toml");
const outPath = path.join(repoRoot, "types", "supabase.ts");

const readTrimmed = (filePath) => {
  try {
    const value = fs.readFileSync(filePath, "utf8").trim();
    return value || null;
  } catch {
    return null;
  }
};

const readProjectIdFromConfig = () => {
  const body = readTrimmed(configTomlPath);
  if (!body) return null;
  const match = body.match(/^\s*project_id\s*=\s*"([^"]+)"\s*$/m);
  return match?.[1]?.trim() || null;
};

const resolveProjectId = () =>
  process.env.PROJECT_ID?.trim() ||
  readTrimmed(linkedProjectRefPath) ||
  readProjectIdFromConfig();

const projectId = resolveProjectId();

if (!projectId) {
  console.error(
    "[supabase:types] Missing project id. Set PROJECT_ID, link the project, or add project_id to supabase/config.toml.",
  );
  process.exit(1);
}

const result = spawnSync(
  "supabase",
  ["gen", "types", "typescript", "--project-id", projectId],
  {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  },
);

if (result.error) {
  console.error("[supabase:types] Failed to run Supabase CLI.", result.error);
  process.exit(1);
}

if (result.status !== 0) {
  if (result.stderr) process.stderr.write(result.stderr);
  process.exit(result.status ?? 1);
}

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, result.stdout, "utf8");
console.log(`[supabase:types] Wrote ${path.relative(repoRoot, outPath)} using project ${projectId}`);
