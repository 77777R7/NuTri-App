import assert from "node:assert/strict";
import test from "node:test";

import packData from "./ods-factpack.json";

test("ods factpack: bundled payload stays within 500KB budget", () => {
  const packed = JSON.stringify(packData);
  const sizeBytes = Buffer.byteLength(packed, "utf8");
  const maxBytes = 500 * 1024;
  assert.ok(
    sizeBytes <= maxBytes,
    `ods-factpack.json is ${sizeBytes} bytes, above the ${maxBytes} bytes budget`,
  );
});

