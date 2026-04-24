import assert from "node:assert/strict";
import { test } from "node:test";

import { registerOpsRoutes } from "../src/routes/opsRoutes.ts";

const createFakeApp = () => {
  const handlers = new Map();
  return {
    handlers,
    get(path, handler) {
      handlers.set(path, handler);
    },
    post(path, handler) {
      handlers.set(path, handler);
    },
  };
};

const createJsonResponse = () => {
  const calls = [];
  return {
    calls,
    statusCode: 200,
    ended: false,
    status(code) {
      this.statusCode = code;
      return this;
    },
    end() {
      this.ended = true;
      return this;
    },
    json(payload) {
      calls.push(payload);
      return this;
    },
  };
};

test("ops route module preserves health response shape", () => {
  const app = createFakeApp();
  registerOpsRoutes(app, {
    getMetricsSnapshot: () => ({}),
    env: {
      GOOGLE_CSE_API_KEY: "key",
      GOOGLE_CSE_CX: "cx",
      DEEPSEEK_API_KEY: "deepseek",
    },
    uptimeSec: () => 42,
  });

  const handler = app.handlers.get("/health");
  assert.equal(typeof handler, "function");

  const res = createJsonResponse();
  handler({}, res);

  assert.deepEqual(res.calls, [
    {
      status: "ok",
      uptimeSec: 42,
      configured: {
        googleCse: true,
        deepseek: true,
      },
    },
  ]);
});

test("ops route module preserves metrics response passthrough", () => {
  const snapshot = {
    counters: { request_count: 2 },
    timings: { time_to_done: { count: 1, avgMs: 900 } },
  };
  const app = createFakeApp();
  registerOpsRoutes(app, {
    getMetricsSnapshot: () => snapshot,
  });

  const handler = app.handlers.get("/internal/metrics");
  assert.equal(typeof handler, "function");

  const res = createJsonResponse();
  handler({}, res);

  assert.deepEqual(res.calls, [snapshot]);
});

test("ops route records scan UX metrics without changing response shape", () => {
  const recorded = [];
  const app = createFakeApp();
  registerOpsRoutes(app, {
    getMetricsSnapshot: () => ({}),
    recordScanUxMetric: (payload) => recorded.push(payload),
  });

  const handler = app.handlers.get("/api/scan-ux-metrics");
  assert.equal(typeof handler, "function");

  const res = createJsonResponse();
  handler({
    body: {
      event: "time_to_score_visible",
      payload: {
        elapsedMs: 987,
        count: 2,
      },
    },
  }, res);

  assert.equal(res.statusCode, 204);
  assert.equal(res.ended, true);
  assert.deepEqual(recorded, [
    {
      event: "time_to_score_visible",
      elapsedMs: 987,
      count: 2,
    },
  ]);
});
