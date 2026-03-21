import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(scriptDir, "..");
const distDir = path.join(backendRoot, "dist");
const wrapperPath = path.join(distDir, "server.js");

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

fs.mkdirSync(distDir, { recursive: true });
fs.writeFileSync(wrapperPath, wrapperSource, "utf8");

console.log(`[build] wrote Render runtime wrapper to ${path.relative(backendRoot, wrapperPath)}`);
