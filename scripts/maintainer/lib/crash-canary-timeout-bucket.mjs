const TIMEOUT_TERMINALS = new Set(["CLIENT_TIMEOUT", "REQUEST_ERROR"]);

const normalizeEventType = (value) => {
  const text = String(value ?? "").trim().toLowerCase();
  return text || null;
};

export const classifyCrashCanaryTimeoutBucket = (row) => {
  const terminal = String(row?.terminal ?? "").trim().toUpperCase();
  if (!TIMEOUT_TERMINALS.has(terminal)) return null;

  const lastSseEventType = normalizeEventType(row?.lastSseEventType);
  const rev1Raw = row?.rev1Ms;
  const rev1Ms = Number(rev1Raw);
  const hasRev1 = rev1Raw != null && Number.isFinite(rev1Ms) && rev1Ms >= 0;

  if (!lastSseEventType) {
    return "sse_not_connected";
  }
  if (hasRev1) {
    return "done_late";
  }
  return "sse_connected_no_done";
};
