import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import { resolveDefaultScraplingPythonBin } from "../../scripts/maintainer/lib/scrapling-fetcher.mjs";

const execFileAsync = promisify(execFile);
const ROOT = process.cwd();

test("scrapling fetcher prefers the 0.4.7 sidecar venv over the legacy venv", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "scrapling-python-bin-"));
  const preferredPython = path.join(tempDir, "scripts", "maintainer", "python", ".venv_scrapling_047", "bin", "python");
  const legacyPython = path.join(tempDir, "scripts", "maintainer", "python", ".venv_scrapling", "bin", "python");

  await fs.mkdir(path.dirname(preferredPython), { recursive: true });
  await fs.mkdir(path.dirname(legacyPython), { recursive: true });
  await fs.writeFile(preferredPython, "");
  await fs.writeFile(legacyPython, "");

  assert.equal(
    resolveDefaultScraplingPythonBin({
      root: tempDir,
      env: {},
      existsSync: (candidate) => candidate === preferredPython || candidate === legacyPython,
    }),
    preferredPython,
  );
});

test("scrapling worker metadata parsing degrades when extruct raises", async () => {
  const workerPath = path.join(ROOT, "scripts", "maintainer", "python", "scrapling_worker.py");
  const python = process.env.SCRAPLING_PYTHON_BIN || "python3";
  const snippet = `
import importlib.util
import json
import pathlib

worker_path = pathlib.Path(${JSON.stringify(workerPath)})
spec = importlib.util.spec_from_file_location("scrapling_worker_under_test", worker_path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class BrokenExtruct:
    @staticmethod
    def extract(*args, **kwargs):
        raise ValueError("Expecting value: line 3 column 13 (char 30)")

module.extruct = BrokenExtruct
module.get_base_url = lambda html, base_url=None: base_url or "https://example.test/product"
result = module.parse_structured_metadata("<html><head></head><body>ok</body></html>", base_url="https://example.test/product")
print(json.dumps(result))
`;

  const { stdout } = await execFileAsync(python, ["-c", snippet], {
    cwd: ROOT,
    maxBuffer: 1024 * 1024,
  });
  const result = JSON.parse(stdout);
  assert.equal(result.available, false);
  assert.match(result.error, /Expecting value/);
  assert.deepEqual(result.detectedKinds, []);
});

test("scrapling worker honors dynamic and stealthy fetch modes before fallback", async () => {
  const workerPath = path.join(ROOT, "scripts", "maintainer", "python", "scrapling_worker.py");
  const python = process.env.SCRAPLING_PYTHON_BIN || "python3";
  const snippet = `
import importlib.util
import json
import pathlib
import sys
import types

worker_path = pathlib.Path(${JSON.stringify(workerPath)})
spec = importlib.util.spec_from_file_location("scrapling_worker_under_test", worker_path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class FakePage:
    html_content = "<html><head><title>Example</title></head><body>Suggested use Take one. Warnings Keep away.</body></html>"
    text = "Suggested use Take one. Warnings Keep away."
    title = "Example"
    url = "https://example.test/product"

class Fetcher:
    @staticmethod
    def get(*args, **kwargs):
        return FakePage()

class DynamicFetcher:
    @staticmethod
    def fetch(*args, **kwargs):
        return FakePage()

class StealthyFetcher:
    @staticmethod
    def fetch(*args, **kwargs):
        return FakePage()

fake_fetchers = types.ModuleType("scrapling.fetchers")
fake_fetchers.Fetcher = Fetcher
fake_fetchers.DynamicFetcher = DynamicFetcher
fake_fetchers.StealthyFetcher = StealthyFetcher
sys.modules["scrapling"] = types.ModuleType("scrapling")
sys.modules["scrapling.fetchers"] = fake_fetchers

print(json.dumps({
    "dynamic": module.scrape_with_scrapling("https://example.test/product", "fetch", True, True, False, 1000),
    "stealthy": module.scrape_with_scrapling("https://example.test/product", "stealthy", True, True, False, 1000),
}))
`;

  const { stdout } = await execFileAsync(python, ["-c", snippet], {
    cwd: ROOT,
    maxBuffer: 1024 * 1024,
  });
  const result = JSON.parse(stdout);
  assert.equal(result.dynamic.fetcher, "DynamicFetcher");
  assert.equal(result.dynamic.effectiveMode, "dynamic");
  assert.equal(result.stealthy.fetcher, "StealthyFetcher");
  assert.equal(result.stealthy.effectiveMode, "stealthy");
});

test("scrapling worker records browser-mode fallback when dynamic fetch fails", async () => {
  const workerPath = path.join(ROOT, "scripts", "maintainer", "python", "scrapling_worker.py");
  const python = process.env.SCRAPLING_PYTHON_BIN || "python3";
  const snippet = `
import importlib.util
import json
import pathlib
import sys
import types

worker_path = pathlib.Path(${JSON.stringify(workerPath)})
spec = importlib.util.spec_from_file_location("scrapling_worker_under_test", worker_path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class FakePage:
    html_content = "<html><head><title>Fallback</title></head><body>ok</body></html>"
    text = "ok"
    title = "Fallback"
    url = "https://example.test/product"

class Fetcher:
    @staticmethod
    def get(*args, **kwargs):
        return FakePage()

class StealthyFetcher:
    @staticmethod
    def fetch(*args, **kwargs):
        raise RuntimeError("browser missing")

fake_fetchers = types.ModuleType("scrapling.fetchers")
fake_fetchers.Fetcher = Fetcher
fake_fetchers.StealthyFetcher = StealthyFetcher
sys.modules["scrapling"] = types.ModuleType("scrapling")
sys.modules["scrapling.fetchers"] = fake_fetchers

print(json.dumps(module.scrape_with_scrapling("https://example.test/product", "stealthy", True, True, False, 1000)))
`;

  const { stdout } = await execFileAsync(python, ["-c", snippet], {
    cwd: ROOT,
    maxBuffer: 1024 * 1024,
  });
  const result = JSON.parse(stdout);
  assert.equal(result.fetcher, "Fetcher");
  assert.equal(result.effectiveMode, "plain");
  assert.match(result.modeFallbackError, /browser missing/);
});
