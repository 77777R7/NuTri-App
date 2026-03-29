import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(scriptDir, "..");
const srcDir = path.join(backendRoot, "src");
const distDir = path.join(backendRoot, "dist");
const wrapperPath = path.join(distDir, "server.js");

const walkSourceFiles = (dir) => {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolutePath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkSourceFiles(absolutePath));
      continue;
    }
    if (!/\.(?:ts|mts|js)$/.test(entry.name)) continue;
    files.push(absolutePath);
  }
  return files;
};

const writeModuleWrapper = (sourcePath) => {
  const relativeSourcePath = path.relative(srcDir, sourcePath);
  if (relativeSourcePath === "server.ts") return;

  const distRelativePath = relativeSourcePath.replace(/\.(?:ts|mts|js)$/, ".js");
  const distPath = path.join(distDir, distRelativePath);
  const importSpecifier = path
    .relative(path.dirname(distPath), sourcePath)
    .split(path.sep)
    .join("/");
  const normalizedImportSpecifier = importSpecifier.startsWith(".")
    ? importSpecifier
    : `./${importSpecifier}`;

  const wrapperSource = `import * as sourceModule from ${JSON.stringify(normalizedImportSpecifier)};

export * from ${JSON.stringify(normalizedImportSpecifier)};
export default sourceModule.default;
`;

  fs.mkdirSync(path.dirname(distPath), { recursive: true });
  fs.writeFileSync(distPath, wrapperSource, "utf8");
};

const wrapperSource = `import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const distFile = fileURLToPath(import.meta.url);
const distDir = path.dirname(distFile);
const backendRoot = path.resolve(distDir, "..");
const tsxCli = path.resolve(backendRoot, "node_modules/tsx/dist/cli.mjs");
const tsconfigPath = path.resolve(backendRoot, "tsconfig.runtime.json");
const serverEntry = path.resolve(distDir, "../src/server.ts");

const child = spawn(process.execPath, [tsxCli, "--tsconfig", tsconfigPath, serverEntry], {
  stdio: "inherit",
  env: process.env,
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    if (!child.killed) {
      child.kill(signal);
    }
  });
}

child.on("exit", (code) => {
  process.exit(code ?? 0);
});
`;

fs.rmSync(distDir, { recursive: true, force: true });
fs.mkdirSync(distDir, { recursive: true });
fs.writeFileSync(wrapperPath, wrapperSource, "utf8");

let wrapperCount = 0;
for (const sourcePath of walkSourceFiles(srcDir)) {
  writeModuleWrapper(sourcePath);
  if (path.relative(srcDir, sourcePath) !== "server.ts") {
    wrapperCount += 1;
  }
}

console.log(`[build] wrote Render runtime wrapper to ${path.relative(backendRoot, wrapperPath)}`);
console.log(`[build] wrote ${wrapperCount} dist compatibility wrappers from ${path.relative(backendRoot, srcDir)}`);
