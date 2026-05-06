import { createHash, randomBytes, randomUUID } from "node:crypto";

import { supabase } from "./supabase.js";

export type GuestScanSessionStatus =
  | "created"
  | "scanning"
  | "result_started"
  | "result_ready"
  | "claim_pending"
  | "claimed"
  | "claim_failed"
  | "expired";

export type GuestScanSessionRow = {
  id: string;
  claim_token_hash?: string | null;
  status: GuestScanSessionStatus;
  scan_session_id: string | null;
  barcode: string | null;
  barcode_gtin14: string | null;
  result_snapshot_id: string | null;
  product_name: string | null;
  brand_name: string | null;
  product_image_url: string | null;
  result_identity_type: string | null;
  result_identity_value: string | null;
  claimed_user_id: string | null;
  claimed_at: string | null;
  expires_at: string;
  last_seen_at: string | null;
  created_at: string;
  updated_at: string;
};

export type CreateGuestScanSessionResult = {
  guestScanSessionId: string;
  claimToken: string;
  status: GuestScanSessionStatus;
  expiresAt: string;
};

export type GuestScanValidationResult =
  | {
      ok: true;
      session: GuestScanSessionRow;
    }
  | {
      ok: false;
      status: 401 | 403 | 409 | 410 | 503;
      error:
        | "missing_guest_scan_token"
        | "invalid_guest_scan_token"
        | "guest_scan_already_used"
        | "guest_scan_expired"
        | "guest_scan_claimed"
        | "guest_scan_unavailable";
    };

export type GuestScanClaimResult =
  | {
      ok: true;
      session: GuestScanSessionRow;
    }
  | Exclude<GuestScanValidationResult, { ok: true }>
  | {
      ok: false;
      status: 409;
      error: "guest_scan_claim_conflict";
    };

const TABLE = "guest_scan_sessions";
const DEFAULT_GUEST_SCAN_TTL_MS = 30 * 60 * 1000;
const SESSION_SELECT_COLUMNS =
  "id, claim_token_hash, status, scan_session_id, barcode, barcode_gtin14, result_snapshot_id, product_name, brand_name, product_image_url, result_identity_type, result_identity_value, claimed_user_id, claimed_at, expires_at, last_seen_at, created_at, updated_at";

const parsePositiveInt = (value: string | undefined, fallback: number): number => {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const asGuestScanSessionRow = (value: unknown): GuestScanSessionRow | null => {
  if (!value || typeof value !== "object") return null;
  const row = value as Partial<GuestScanSessionRow>;
  if (typeof row.id !== "string") return null;
  if (typeof row.expires_at !== "string") return null;
  return {
    id: row.id,
    claim_token_hash:
      typeof row.claim_token_hash === "string" ? row.claim_token_hash : null,
    status: isGuestScanSessionStatus(row.status) ? row.status : "created",
    scan_session_id:
      typeof row.scan_session_id === "string" ? row.scan_session_id : null,
    barcode: typeof row.barcode === "string" ? row.barcode : null,
    barcode_gtin14:
      typeof row.barcode_gtin14 === "string" ? row.barcode_gtin14 : null,
    result_snapshot_id:
      typeof row.result_snapshot_id === "string" ? row.result_snapshot_id : null,
    product_name:
      typeof row.product_name === "string" ? row.product_name : null,
    brand_name: typeof row.brand_name === "string" ? row.brand_name : null,
    product_image_url:
      typeof row.product_image_url === "string" ? row.product_image_url : null,
    result_identity_type:
      typeof row.result_identity_type === "string" ? row.result_identity_type : null,
    result_identity_value:
      typeof row.result_identity_value === "string" ? row.result_identity_value : null,
    claimed_user_id:
      typeof row.claimed_user_id === "string" ? row.claimed_user_id : null,
    claimed_at: typeof row.claimed_at === "string" ? row.claimed_at : null,
    expires_at: row.expires_at,
    last_seen_at:
      typeof row.last_seen_at === "string" ? row.last_seen_at : null,
    created_at:
      typeof row.created_at === "string" ? row.created_at : new Date().toISOString(),
    updated_at:
      typeof row.updated_at === "string" ? row.updated_at : new Date().toISOString(),
  };
};

const GUEST_SCAN_STATUSES: readonly GuestScanSessionStatus[] = [
  "created",
  "scanning",
  "result_started",
  "result_ready",
  "claim_pending",
  "claimed",
  "claim_failed",
  "expired",
];

const isGuestScanSessionStatus = (value: unknown): value is GuestScanSessionStatus =>
  typeof value === "string" &&
  GUEST_SCAN_STATUSES.includes(value as GuestScanSessionStatus);

const normalizeRequiredString = (value: string, label: string): string => {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`${label} is required.`);
  }
  return normalized;
};

const normalizeOptionalString = (value: string | null | undefined): string | null => {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized.length > 0 ? normalized : null;
};

export const hashGuestScanClaimToken = (claimToken: string): string =>
  createHash("sha256").update(claimToken).digest("hex");

export const createGuestScanSession = async (): Promise<CreateGuestScanSessionResult> => {
  const ttlMs = parsePositiveInt(process.env.GUEST_SCAN_SESSION_TTL_MS, DEFAULT_GUEST_SCAN_TTL_MS);
  const guestScanSessionId = randomUUID();
  const claimToken = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + ttlMs).toISOString();

  const { data, error } = await supabase
    .from(TABLE)
    .insert({
      id: guestScanSessionId,
      claim_token_hash: hashGuestScanClaimToken(claimToken),
      status: "created" satisfies GuestScanSessionStatus,
      expires_at: expiresAt,
    })
    .select("id, status, expires_at")
    .single();

  if (error) {
    throw new Error(error.message || "guest_scan_session_create_failed");
  }

  return {
    guestScanSessionId:
      typeof data?.id === "string" ? data.id : guestScanSessionId,
    claimToken,
    status: isGuestScanSessionStatus(data?.status) ? data.status : "created",
    expiresAt: typeof data?.expires_at === "string" ? data.expires_at : expiresAt,
  };
};

const markGuestScanExpired = async (guestScanSessionId: string): Promise<void> => {
  await supabase
    .from(TABLE)
    .update({
      status: "expired" satisfies GuestScanSessionStatus,
      updated_at: new Date().toISOString(),
    })
    .eq("id", guestScanSessionId);
};

export const validateGuestScanToken = async (input: {
  guestScanSessionId: string;
  claimToken: string;
}): Promise<GuestScanValidationResult> => {
  const guestScanSessionId = input.guestScanSessionId.trim();
  const claimToken = input.claimToken.trim();
  if (!guestScanSessionId || !claimToken) {
    return {
      ok: false,
      status: 401,
      error: "missing_guest_scan_token",
    };
  }

  const { data, error } = await supabase
    .from(TABLE)
    .select(SESSION_SELECT_COLUMNS)
    .eq("id", guestScanSessionId)
    .eq("claim_token_hash", hashGuestScanClaimToken(claimToken))
    .maybeSingle();

  if (error) {
    return {
      ok: false,
      status: 503,
      error: "guest_scan_unavailable",
    };
  }

  const session = asGuestScanSessionRow(data);
  if (!session) {
    return {
      ok: false,
      status: 403,
      error: "invalid_guest_scan_token",
    };
  }

  const expiresAtMs = Date.parse(session.expires_at);
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now()) {
    await markGuestScanExpired(session.id);
    return {
      ok: false,
      status: 410,
      error: "guest_scan_expired",
    };
  }

  if (session.status === "claimed" || session.claimed_user_id) {
    return {
      ok: false,
      status: 403,
      error: "guest_scan_claimed",
    };
  }

  return {
    ok: true,
    session,
  };
};

export const recordGuestScanSessionProgress = async (input: {
  guestScanSessionId: string;
  claimToken: string;
  scanSessionId?: string | null;
  barcode?: string | null;
  barcodeGtin14?: string | null;
  status: Extract<GuestScanSessionStatus, "scanning" | "result_started" | "result_ready">;
}): Promise<GuestScanValidationResult> => {
  const validation = await validateGuestScanToken({
    guestScanSessionId: input.guestScanSessionId,
    claimToken: input.claimToken,
  });
  if (!validation.ok) return validation;

  const nextBarcode = normalizeOptionalString(input.barcode);
  const nextBarcodeGtin14 = normalizeOptionalString(input.barcodeGtin14);
  const existingBarcodeGtin14 = normalizeOptionalString(
    validation.session.barcode_gtin14,
  );

  if (
    existingBarcodeGtin14 &&
    nextBarcodeGtin14 &&
    existingBarcodeGtin14 !== nextBarcodeGtin14
  ) {
    return {
      ok: false,
      status: 409,
      error: "guest_scan_already_used",
    };
  }

  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from(TABLE)
    .update({
      status: input.status,
      scan_session_id:
        typeof input.scanSessionId === "string" && input.scanSessionId.trim()
          ? input.scanSessionId.trim()
          : validation.session.scan_session_id,
      barcode: nextBarcode ?? validation.session.barcode,
      barcode_gtin14: nextBarcodeGtin14 ?? validation.session.barcode_gtin14,
      last_seen_at: now,
      updated_at: now,
    })
    .eq("id", validation.session.id)
    .select(SESSION_SELECT_COLUMNS)
    .single();

  if (error) {
    return {
      ok: false,
      status: 503,
      error: "guest_scan_unavailable",
    };
  }

  const session = asGuestScanSessionRow(data);
  if (!session) {
    return {
      ok: false,
      status: 503,
      error: "guest_scan_unavailable",
    };
  }

  return {
    ok: true,
    session,
  };
};

export const claimGuestScanSession = async (input: {
  guestScanSessionId: string;
  claimToken: string;
  userId: string;
}): Promise<GuestScanClaimResult> => {
  const guestScanSessionId = normalizeRequiredString(
    input.guestScanSessionId,
    "guestScanSessionId",
  );
  const claimToken = normalizeRequiredString(input.claimToken, "claimToken");
  const userId = normalizeRequiredString(input.userId, "userId");
  const validation = await validateGuestScanToken({
    guestScanSessionId,
    claimToken,
  });
  if (!validation.ok) return validation;

  const now = new Date().toISOString();
  const pending = await supabase
    .from(TABLE)
    .update({
      status: "claim_pending" satisfies GuestScanSessionStatus,
      updated_at: now,
    })
    .eq("id", validation.session.id)
    .is("claimed_user_id", null);

  if (pending.error) {
    return {
      ok: false,
      status: 409,
      error: "guest_scan_claim_conflict",
    };
  }

  const { data, error } = await supabase
    .from(TABLE)
    .update({
      status: "claimed" satisfies GuestScanSessionStatus,
      claimed_user_id: userId,
      claimed_at: now,
      updated_at: now,
    })
    .eq("id", validation.session.id)
    .is("claimed_user_id", null)
    .select(SESSION_SELECT_COLUMNS)
    .single();

  if (error) {
    await supabase
      .from(TABLE)
      .update({
        status: "claim_failed" satisfies GuestScanSessionStatus,
        updated_at: new Date().toISOString(),
      })
      .eq("id", validation.session.id)
      .is("claimed_user_id", null);
    return {
      ok: false,
      status: 409,
      error: "guest_scan_claim_conflict",
    };
  }

  const session = asGuestScanSessionRow(data);
  if (!session) {
    return {
      ok: false,
      status: 409,
      error: "guest_scan_claim_conflict",
    };
  }

  return {
    ok: true,
    session,
  };
};
