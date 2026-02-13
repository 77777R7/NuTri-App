export type PipelineStepStatus = "ok" | "degraded" | "failed";

export type PipelineStepMetric<TStep extends string = string> = {
  step: TStep;
  status: PipelineStepStatus;
  code?: string;
  ms?: number;
  startedAtMs?: number;
};

export const PIPELINE_NOT_REACHED_CODE = "not_reached";
export const PIPELINE_NOT_RUN_CODE = "not_run";
export const PIPELINE_BLOCKED_BY_PREFIX = "blocked_by:";

export const sanitizePipelineCode = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  // Keep codes stable and safe for aggregation keys.
  return trimmed.replace(/[^A-Za-z0-9_:\\-]+/g, "_").slice(0, 120);
};

export const extractRootCause = (code: unknown): string | null => {
  const sanitized = sanitizePipelineCode(code);
  if (!sanitized) return null;
  if (sanitized.startsWith(PIPELINE_BLOCKED_BY_PREFIX)) {
    return sanitized.slice(PIPELINE_BLOCKED_BY_PREFIX.length) || null;
  }
  return sanitized;
};

/**
 * Normalize "not_reached" placeholders into stable, explainable codes:
 * - If an upstream step failed/degraded with a real code => blocked_by:<rootCause>
 * - Otherwise => not_run
 * - If the step is ok => omit code
 */
export const finalizePipelineStepCodes = <TStep extends string>(
  stepsOrder: readonly TStep[],
  state: Map<TStep, PipelineStepMetric<TStep>>,
  options: { placeholderCode?: string } = {},
): Map<TStep, PipelineStepMetric<TStep>> => {
  const placeholder = options.placeholderCode ?? PIPELINE_NOT_REACHED_CODE;

  const out = new Map<TStep, PipelineStepMetric<TStep>>();
  for (const [k, v] of state.entries()) {
    out.set(k, { ...v });
  }

  let prevStatus: PipelineStepStatus | null = null;
  let prevCode: string | null = null;

  for (const step of stepsOrder) {
    const item = out.get(step);
    if (!item) continue;

    const status = item.status ?? "degraded";
    const code = item.code;

    // Only rewrite the internal placeholder.
    if (code !== placeholder) {
      prevStatus = status;
      prevCode = extractRootCause(code);
      continue;
    }

    // If a step succeeded, don't emit a synthetic code.
    if (status === "ok") {
      out.set(step, { ...item, code: undefined });
      prevStatus = status;
      prevCode = null;
      continue;
    }

    const prevRootCause = extractRootCause(prevCode);
    const shouldBlockByPrev =
      prevStatus !== null &&
      prevStatus !== "ok" &&
      prevRootCause !== null &&
      prevRootCause !== placeholder &&
      prevRootCause !== PIPELINE_NOT_RUN_CODE;

    const nextCode = shouldBlockByPrev
      ? `${PIPELINE_BLOCKED_BY_PREFIX}${prevRootCause}`
      : PIPELINE_NOT_RUN_CODE;

    out.set(step, { ...item, status, code: nextCode });
    prevStatus = status;
    // Carry forward the root cause, not the wrapper prefix, so we don't nest blocked_by.
    prevCode = shouldBlockByPrev ? prevRootCause : nextCode;
  }

  return out;
};
