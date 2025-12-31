import { supabase } from "./supabase.js";

export async function logBarcodeScan(input: {
  barcodeGtin14: string;
  barcodeRaw: string | null;
  checksumValid: boolean | null;

  catalogHit: boolean;
  servedFrom: string; // "override" | "dsld" | "snapshot_cache" | "google_ai" | "wait_inflight" | "error"
  dsldLabelId?: number | null;
  snapshotId?: string | null;

  deviceId?: string | null;
  requestId?: string | null;
  timingTotalMs?: number | null;

  meta?: Record<string, unknown> | null;
}): Promise<void> {
  try {
    const { error } = await supabase.from("barcode_scans").insert({
      barcode_gtin14: input.barcodeGtin14,
      barcode_raw: input.barcodeRaw,
      checksum_valid: input.checksumValid,
      catalog_hit: input.catalogHit,
      served_from: input.servedFrom,
      dsld_label_id: input.dsldLabelId ?? null,
      snapshot_id: input.snapshotId ?? null,
      device_id: input.deviceId ?? null,
      request_id: input.requestId ?? null,
      timing_total_ms: input.timingTotalMs ?? null,
      meta: input.meta ?? null,
    });

    if (error) {
      console.warn("[barcode_scans] insert failed:", error.message);
    }
  } catch (e) {
    console.warn("[barcode_scans] insert unexpected:", e);
  }
}
