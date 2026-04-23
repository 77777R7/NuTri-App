import assert from "node:assert/strict";
import test from "node:test";

import {
  createEventLoopLagWindowSampler,
  readEventLoopLagP95MsFromHistogram,
  resolveEventLoopLagStaleAfterMs,
  type EventLoopLagHistogramLike,
} from "../../backend/src/scanEventLoopLagWindow.js";

class FakeHistogram implements EventLoopLagHistogramLike {
  public resetCount = 0;
  private samplesNs: number[];

  constructor(samplesNs: number[]) {
    this.samplesNs = [...samplesNs];
  }

  percentile(): number {
    return this.samplesNs[0] ?? 0;
  }

  reset(): void {
    this.resetCount += 1;
    this.samplesNs.shift();
  }
}

test("event-loop lag histogram reads p95 milliseconds and resets the sampled window", () => {
  const histogram = new FakeHistogram([125_000_000, 0]);

  assert.equal(readEventLoopLagP95MsFromHistogram(histogram, { reset: true }), 125);
  assert.equal(histogram.resetCount, 1);
  assert.equal(readEventLoopLagP95MsFromHistogram(histogram, { reset: true }), 0);
  assert.equal(histogram.resetCount, 2);
});

test("event-loop lag histogram still resets invalid samples", () => {
  const histogram = new FakeHistogram([Number.NaN, 250_000_000]);

  assert.equal(readEventLoopLagP95MsFromHistogram(histogram, { reset: true }), 0);
  assert.equal(histogram.resetCount, 1);
  assert.equal(readEventLoopLagP95MsFromHistogram(histogram, { reset: true }), 250);
});

test("event-loop lag sampler exposes only a fresh resettable window", () => {
  let now = 1_000;
  const histogram = new FakeHistogram([250_000_000, 20_000_000]);
  const sampler = createEventLoopLagWindowSampler({
    histogram,
    nowMs: () => now,
    staleAfterMs: 500,
  });

  sampler.sampleAndReset();
  assert.equal(sampler.readFreshP95Ms(), 250);

  now += 250;
  sampler.sampleAndReset();
  assert.equal(sampler.readFreshP95Ms(), 20);
  assert.equal(histogram.resetCount, 2);

  now += 501;
  assert.equal(sampler.readFreshP95Ms(), 0);
});

test("event-loop lag sampler can clear a stale high window before a new request", () => {
  let now = 2_000;
  const histogram = new FakeHistogram([250_000_000, 20_000_000, 20_000_000]);
  const sampler = createEventLoopLagWindowSampler({
    histogram,
    nowMs: () => now,
    staleAfterMs: 500,
  });

  sampler.sampleAndReset();
  assert.equal(sampler.readFreshP95Ms(), 250);

  now += 10;
  sampler.resetWindow();
  assert.equal(sampler.readFreshP95Ms(), 0);
  assert.equal(histogram.resetCount, 2);
  assert.equal(sampler.sampleAndReset().lagP95Ms, 20);
});

test("event-loop lag stale window keeps a minimum reset horizon", () => {
  assert.equal(
    resolveEventLoopLagStaleAfterMs({ sampleMs: 250, rawValue: undefined }),
    1_000,
  );
  assert.equal(
    resolveEventLoopLagStaleAfterMs({ sampleMs: 250, rawValue: 100 }),
    250,
  );
  assert.equal(
    resolveEventLoopLagStaleAfterMs({ sampleMs: 250, rawValue: "1500" }),
    1_500,
  );
});
