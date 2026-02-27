import assert from "node:assert/strict";
import { test } from "node:test";

import { resolveAuthorityCandidate } from "../dist/authorityCandidate.js";

const MAP_MIN_CONFIDENCE = 0.75;
const STALE_WINDOW_MS = 72 * 60 * 60 * 1000;

test("known barcode fallback resolves to historical LNHPD candidate instead of web", () => {
  const knownBarcode = "00029537001069";
  const result = resolveAuthorityCandidate({
    regulatoryMap: null,
    snapshot: null,
    mapMinConfidence: MAP_MIN_CONFIDENCE,
    staleWindowMs: STALE_WINDOW_MS,
    historicalNpn: "80029183",
    nowMs: Date.parse("2026-02-16T00:00:00Z"),
  });

  assert.equal(knownBarcode.length, 14);
  assert.equal(result.mapStatus, "miss");
  assert.equal(result.candidate?.npn, "80029183");
  assert.equal(result.candidate?.source, "scan_history");
  assert.equal(result.candidate?.requiresGuardrail, false);
  assert.equal(result.candidate?.isStale, true);
});

test("known barcode with authoritative map must resolve to map source", () => {
  const knownBarcode = "00029537001069";
  const result = resolveAuthorityCandidate({
    regulatoryMap: {
      npn: "80029183",
      confidence: 0.95,
      source: "lnhpd",
      expires_at: "2026-03-01T00:00:00.000Z",
    },
    snapshot: null,
    mapMinConfidence: MAP_MIN_CONFIDENCE,
    staleWindowMs: STALE_WINDOW_MS,
    historicalNpn: "80029183",
    nowMs: Date.parse("2026-02-16T00:00:00Z"),
  });

  assert.equal(knownBarcode.length, 14);
  assert.equal(result.mapStatus, "hit");
  assert.equal(result.candidate?.source, "map");
  assert.equal(result.candidate?.npn, "80029183");
  assert.equal(result.candidate?.isStale, false);
});

test("fresh regulatory map candidate wins over historical scan fallback", () => {
  const result = resolveAuthorityCandidate({
    regulatoryMap: {
      npn: "12345678",
      confidence: 0.91,
      source: "lnhpd",
      expires_at: "2026-03-01T00:00:00.000Z",
    },
    snapshot: null,
    mapMinConfidence: MAP_MIN_CONFIDENCE,
    staleWindowMs: STALE_WINDOW_MS,
    historicalNpn: "80029183",
    nowMs: Date.parse("2026-02-16T00:00:00Z"),
  });

  assert.equal(result.mapStatus, "hit");
  assert.equal(result.candidate?.npn, "12345678");
  assert.equal(result.candidate?.source, "map");
  assert.equal(result.candidate?.requiresGuardrail, false);
  assert.equal(result.candidate?.isStale, false);
});

test("verified snapshot candidate wins over historical fallback when map is unavailable", () => {
  const result = resolveAuthorityCandidate({
    regulatoryMap: null,
    snapshot: {
      regulatory: {
        npn: "87654321",
        npnStatus: "verified",
        npnVerifiedBy: "lnhpd_fetch",
      },
    },
    mapMinConfidence: MAP_MIN_CONFIDENCE,
    staleWindowMs: STALE_WINDOW_MS,
    historicalNpn: "80029183",
    nowMs: Date.parse("2026-02-16T00:00:00Z"),
  });

  assert.equal(result.mapStatus, "miss");
  assert.equal(result.candidate?.npn, "87654321");
  assert.equal(result.candidate?.source, "snapshot");
  assert.equal(result.candidate?.requiresGuardrail, true);
  assert.equal(result.candidate?.isStale, true);
});

test("snapshot_verified does not override an existing authoritative map candidate", () => {
  const result = resolveAuthorityCandidate({
    regulatoryMap: {
      npn: "80029183",
      confidence: 0.95,
      source: "lnhpd",
      expires_at: "2026-03-01T00:00:00.000Z",
    },
    snapshot: {
      regulatory: {
        npn: "87654321",
        npnStatus: "verified",
        npnVerifiedBy: "lnhpd_fetch",
      },
    },
    mapMinConfidence: MAP_MIN_CONFIDENCE,
    staleWindowMs: STALE_WINDOW_MS,
    historicalNpn: "80029183",
    nowMs: Date.parse("2026-02-16T00:00:00Z"),
  });

  assert.equal(result.mapStatus, "hit");
  assert.equal(result.candidate?.source, "map");
  assert.equal(result.candidate?.npn, "80029183");
});

test("high-confidence stale map row within window remains stage0 authority candidate", () => {
  const nowMs = Date.parse("2026-02-19T00:00:00Z");
  const expiredAt = new Date(nowMs - 30 * 60 * 1000).toISOString();
  const result = resolveAuthorityCandidate({
    regulatoryMap: {
      npn: "80029183",
      confidence: 0.92,
      source: "lnhpd",
      expires_at: expiredAt,
    },
    snapshot: null,
    mapMinConfidence: MAP_MIN_CONFIDENCE,
    staleWindowMs: STALE_WINDOW_MS,
    historicalNpn: "70000001",
    nowMs,
  });

  assert.equal(result.mapStatus, "stale");
  assert.equal(result.candidate?.source, "map_stale");
  assert.equal(result.candidate?.npn, "80029183");
  assert.equal(result.candidate?.requiresGuardrail, true);
  assert.equal(result.candidate?.isStale, true);
});

test("stale low-confidence map miss still recovers historical LNHPD candidate", () => {
  const nowMs = Date.parse("2026-02-19T00:00:00Z");
  const expiredAt = new Date(nowMs - 60 * 60 * 1000).toISOString();
  const result = resolveAuthorityCandidate({
    regulatoryMap: {
      npn: "88888888",
      confidence: 0.6,
      source: "lnhpd",
      expires_at: expiredAt,
    },
    snapshot: null,
    mapMinConfidence: MAP_MIN_CONFIDENCE,
    staleWindowMs: STALE_WINDOW_MS,
    historicalNpn: "80029183",
    nowMs,
  });

  assert.equal(result.mapStatus, "stale");
  assert.equal(result.candidate?.source, "scan_history");
  assert.equal(result.candidate?.npn, "80029183");
  assert.equal(result.candidate?.requiresGuardrail, false);
});
