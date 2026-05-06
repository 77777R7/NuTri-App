import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "../..");
const HELPER_PATH = path.join(ROOT, "backend/src/guestScanSessions.ts");
const SERVER_PATH = path.join(ROOT, "backend/src/server.ts");
const ENRICH_STREAM_ROUTE_PATH = path.join(ROOT, "backend/src/routes/enrichStreamRoute.ts");
const MIGRATION_PATH = path.join(
  ROOT,
  "supabase/migrations/20260504130000_guest_scan_sessions.sql",
);

test("guest scan helper stores claim-token hashes instead of raw tokens", async () => {
  const source = await readFile(HELPER_PATH, "utf8");
  assert.match(source, /claim_token_hash/);
  assert.match(source, /createHash\("sha256"\)/);
  assert.match(source, /randomBytes\(32\)\.toString\("base64url"\)/);
  assert.doesNotMatch(source, /claim_token(?!_hash)/);
});

test("guest scan server exposes create and claim routes without auth bypass", async () => {
  const source = await readFile(SERVER_PATH, "utf8");
  const enrichStreamRouteSource = await readFile(ENRICH_STREAM_ROUTE_PATH, "utf8");
  assert.match(source, /\/api\/guest-scan\/session/);
  assert.match(source, /\/api\/guest-scan\/claim/);
  assert.match(source, /GUEST_SCAN_ENABLED/);
  assert.match(source, /guest_scan_unavailable/);
  assert.match(source, /verifySupabaseTokenOrGuestScanToken/);
  assert.match(source, /"x-guest-scan-session-id"/);
  assert.match(source, /"x-guest-scan-claim-token"/);
  assert.match(enrichStreamRouteSource, /app\.post\(\s*"\/api\/enrich-stream",\s*deps\.verifySupabaseToken/s);
  assert.match(source, /registerEnrichStreamRoute\(app,\s*\{[\s\S]{0,180}verifySupabaseToken:\s*verifySupabaseTokenOrGuestScanToken/s);
  assert.doesNotMatch(source, /X-Auth-Disabled.*guest/i);
});

test("guest scan stream locks the session to one barcode before reveal", async () => {
  const helperSource = await readFile(HELPER_PATH, "utf8");
  const enrichStreamRouteSource = await readFile(ENRICH_STREAM_ROUTE_PATH, "utf8");

  assert.match(helperSource, /guest_scan_already_used/);
  assert.match(helperSource, /existingBarcodeGtin14/);
  assert.match(helperSource, /existingBarcodeGtin14 !== nextBarcodeGtin14/);
  assert.match(enrichStreamRouteSource, /const guestProgress = await deps\.recordGuestScanSessionProgress/);
  assert.match(enrichStreamRouteSource, /status\(guestProgress\.status\)/);
});

test("guest scan table is service-role only and time-bound", async () => {
  const source = await readFile(MIGRATION_PATH, "utf8");
  assert.match(source, /create table if not exists public\.guest_scan_sessions/);
  assert.match(source, /claim_token_hash text not null/);
  assert.match(source, /product_name text/);
  assert.match(source, /brand_name text/);
  assert.match(source, /product_image_url text/);
  assert.match(source, /result_identity_type text/);
  assert.match(source, /result_identity_value text/);
  assert.match(source, /expires_at timestamptz not null/);
  assert.match(source, /alter table if exists public\.guest_scan_sessions enable row level security/);
  assert.match(source, /revoke all on table public\.guest_scan_sessions from anon, authenticated/);
  assert.match(source, /grant all on table public\.guest_scan_sessions to service_role/);
});
