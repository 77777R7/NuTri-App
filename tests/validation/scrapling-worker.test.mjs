import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const ROOT = process.cwd();

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
