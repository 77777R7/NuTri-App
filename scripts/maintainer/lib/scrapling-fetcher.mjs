import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { applyHistoricalCarryForwardFallbacks } from "./historical-carry-forward-fallbacks.mjs";
import { applySupplementFactsFallbacks } from "./supplement-facts-fallbacks.mjs";

const ROOT = process.cwd();

const PROJECT_VENV_PYTHON = path.join(
  ROOT,
  "scripts",
  "maintainer",
  "python",
  ".venv_scrapling",
  "bin",
  "python",
);
const DEFAULT_PYTHON = process.env.SCRAPLING_PYTHON_BIN || (fs.existsSync(PROJECT_VENV_PYTHON) ? PROJECT_VENV_PYTHON : "python3");
const DEFAULT_WORKER_PATH = path.join(ROOT, "scripts", "maintainer", "python", "scrapling_worker.py");

const runWorker = (payload, { pythonBin = DEFAULT_PYTHON, workerPath = DEFAULT_WORKER_PATH } = {}) =>
  new Promise((resolve, reject) => {
    const child = execFile(
      pythonBin,
      [workerPath],
      {
        maxBuffer: 1024 * 1024 * 16,
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(
            new Error(
              `scrapling_worker_failed: ${error.message}${stderr ? `\n${stderr}` : ""}`,
            ),
          );
          return;
        }
        try {
          resolve(JSON.parse(stdout));
        } catch (parseError) {
          reject(
            new Error(
              `scrapling_worker_invalid_json: ${parseError instanceof Error ? parseError.message : String(parseError)}${stderr ? `\n${stderr}` : ""}`,
            ),
          );
        }
      },
    );
    child.stdin.write(JSON.stringify(payload));
    child.stdin.end();
  });

export const fetchViaScrapling = async ({
  url,
  productId = null,
  title = null,
  brandName = null,
  mode = "stealthy",
  headless = true,
  networkIdle = true,
  timeoutMs = 45000,
  allowGoogleSearch = false,
} = {}) => {
  if (!url) {
    throw new Error("fetchViaScrapling requires url");
  }
  const raw = await runWorker({
    url,
    mode,
    headless,
    networkIdle,
    timeoutMs,
    allowGoogleSearch,
  });
  const supplemented = await applySupplementFactsFallbacks(raw);
  return applyHistoricalCarryForwardFallbacks(supplemented, {
    url,
    productId,
    title,
    brandName,
  });
};
