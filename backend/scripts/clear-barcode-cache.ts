import { supabase } from "../src/supabase.js";
import { normalizeBarcodeInput } from "../src/barcode.js";

type Identity = { type: "npn" | "dsldLabelId" | "gtin14" | "webCanonicalId"; value: string };

const argv = process.argv.slice(2);
const barcodeArg = argv.find((arg) => !arg.startsWith("--")) ?? null;
const includeMap = argv.includes("--map");
const includeNegative = argv.includes("--negative");
const includeIdentity = argv.includes("--identity") || true;

if (!barcodeArg) {
  console.error("Usage: tsx scripts/clear-barcode-cache.ts <barcode> [--identity] [--map] [--negative]");
  process.exit(2);
}

const normalized = normalizeBarcodeInput(barcodeArg);
if (!normalized) {
  console.error("Invalid barcode input.");
  process.exit(2);
}

const keys = normalized.variants;
const gtin14 = keys.find((k) => k.length === 14) ?? null;

const logCounts = (label: string, count: number | null | undefined) => {
  const value = typeof count === "number" ? count : 0;
  console.log(`[clear-cache] ${label} deleted=${value}`);
};

const main = async () => {
  console.log("[clear-cache] input:", { barcode: barcodeArg, keys, gtin14 });

  // Try to read one snapshot row before deleting, so we can clear related identity caches deterministically.
  const { data: snapshotRow } = await supabase
    .from("snapshots")
    .select("key,source,payload_json,analysis_json,expires_at,updated_at")
    .eq("source", "barcode")
    .in("key", keys)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const identities: Identity[] = [];
  if (snapshotRow && typeof snapshotRow === "object") {
    const payload = (snapshotRow as any).payload_json as any;
    const npn = payload?.regulatory?.npn ? String(payload.regulatory.npn) : null;
    const dsldLabelId = payload?.regulatory?.dsldLabelId ? String(payload.regulatory.dsldLabelId) : null;
    const normalizedBarcode = payload?.product?.barcode?.normalized
      ? String(payload.product.barcode.normalized)
      : null;
    const webCanonicalId = payload?.analysis?.webCanonicalId ? String(payload.analysis.webCanonicalId) : null;

    if (npn) identities.push({ type: "npn", value: npn });
    if (dsldLabelId) identities.push({ type: "dsldLabelId", value: dsldLabelId });
    if (normalizedBarcode && normalizedBarcode.length === 14) {
      identities.push({ type: "gtin14", value: normalizedBarcode });
    }
    if (gtin14) identities.push({ type: "gtin14", value: gtin14 });
    if (webCanonicalId) identities.push({ type: "webCanonicalId", value: webCanonicalId });
  } else if (gtin14) {
    identities.push({ type: "gtin14", value: gtin14 });
  }

  // 1) Snapshot cache
  {
    const { error, count } = await supabase
      .from("snapshots")
      .delete({ count: "exact" })
      .eq("source", "barcode")
      .in("key", keys);
    if (error) throw error;
    logCounts("snapshots(barcode)", count);
  }

  // 2) Identity cache (detail jobs)
  if (includeIdentity && identities.length > 0) {
    for (const identity of identities) {
      const { error, count } = await supabase
        .from("analysis_identity_cache")
        .delete({ count: "exact" })
        .eq("identity_type", identity.type)
        .eq("identity_value", identity.value);
      if (error) throw error;
      logCounts(`analysis_identity_cache(${identity.type}:${identity.value})`, count);
    }
  }

  // 3) Optional: resolution maps
  if (includeMap && gtin14) {
    const { error, count } = await supabase
      .from("barcode_regulatory_map")
      .delete({ count: "exact" })
      .eq("barcode_gtin14", gtin14);
    if (error) throw error;
    logCounts(`barcode_regulatory_map(${gtin14})`, count);
  }

  // 4) Optional: negative cache
  if (includeNegative && gtin14) {
    const { error, count } = await supabase
      .from("negative_cache")
      .delete({ count: "exact" })
      .eq("barcode_gtin14", gtin14);
    if (error) throw error;
    logCounts(`negative_cache(${gtin14})`, count);
  }

  console.log("[clear-cache] done");
};

main().catch((err) => {
  console.error("[clear-cache] failed:", err?.message ?? String(err));
  process.exit(1);
});

