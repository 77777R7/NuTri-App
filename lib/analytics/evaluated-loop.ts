import type {
  GoalKey,
  ProductCoverageStatus,
  ProductGoalMatchTier,
  SupplementTypeKey,
} from '@/types/personalization';
import { emitAnalyticsEvent, type AnalyticsTransport } from './transport';

export type EvaluatedLoopAnalyticsEvent =
  | 'evaluated_loop_exposure'
  | 'evaluated_loop_click'
  | 'evaluated_loop_save'
  | 'evaluated_loop_conversion';

export type EvaluatedLoopSurface =
  | 'smart_filter'
  | 'first_stack'
  | 'plan_preview';

export type EvaluatedLoopCoverageStatus = ProductCoverageStatus | 'unknown';

export type EvaluatedLoopMatchTier =
  | ProductGoalMatchTier
  | 'not_enough_structured_data';

type EvaluatedLoopBasePayload = {
  surface: EvaluatedLoopSurface;
  snapshotId: string;
  rulesVersion: string;
  goalKey?: GoalKey;
  typeKey?: SupplementTypeKey;
  productId?: string;
  actionKey?: string;
  matchTier?: EvaluatedLoopMatchTier;
  coverageStatus?: EvaluatedLoopCoverageStatus;
  position?: number;
  selectedCount?: number;
  resultCount?: number;
  coverageReadyCount?: number;
  notEnoughStructuredDataCount?: number;
  scheduleTemplateKey?: string;
  hasEvaluatedPlan?: boolean;
  hasExplanation?: boolean;
  source?: 'auto' | 'user';
  reasonCodes?: string[];
};

export type EvaluatedLoopExposurePayload = EvaluatedLoopBasePayload & {
  source?: 'auto' | 'user';
};

export type EvaluatedLoopClickPayload = EvaluatedLoopBasePayload & {
  productId?: string;
  actionKey?: string;
  position?: number;
};

export type EvaluatedLoopSavePayload = EvaluatedLoopBasePayload & {
  productId?: string;
  actionKey?: string;
};

export type EvaluatedLoopConversionPayload = EvaluatedLoopBasePayload & {
  productId?: string;
  conversionType:
    | 'saved_to_stack'
    | 'schedule_applied'
    | 'check_in_completed'
    | 'first_stack_accepted';
};

export type EvaluatedLoopPayloadByEvent = {
  evaluated_loop_exposure: EvaluatedLoopExposurePayload;
  evaluated_loop_click: EvaluatedLoopClickPayload;
  evaluated_loop_save: EvaluatedLoopSavePayload;
  evaluated_loop_conversion: EvaluatedLoopConversionPayload;
};

const normalizeReasonCodes = (reasonCodes?: string[]) =>
  Array.from(
    new Set(
      (reasonCodes ?? [])
        .map((code) => code.trim())
        .filter(Boolean),
    ),
  );

const buildPayload = <T extends EvaluatedLoopBasePayload>(
  payload: T,
): Record<string, unknown> => ({
  ...payload,
  ...(payload.reasonCodes ? { reasonCodes: normalizeReasonCodes(payload.reasonCodes) } : {}),
});

export const trackEvaluatedLoopEvent = <TEvent extends EvaluatedLoopAnalyticsEvent>(
  event: TEvent,
  payload: EvaluatedLoopPayloadByEvent[TEvent],
  transport?: AnalyticsTransport,
) => {
  emitAnalyticsEvent('evaluated-loop', event, buildPayload(payload), transport);
};

export const trackEvaluatedLoopExposure = (
  payload: EvaluatedLoopExposurePayload,
  transport?: AnalyticsTransport,
) => trackEvaluatedLoopEvent('evaluated_loop_exposure', payload, transport);

export const trackEvaluatedLoopClick = (
  payload: EvaluatedLoopClickPayload,
  transport?: AnalyticsTransport,
) => trackEvaluatedLoopEvent('evaluated_loop_click', payload, transport);

export const trackEvaluatedLoopSave = (
  payload: EvaluatedLoopSavePayload,
  transport?: AnalyticsTransport,
) => trackEvaluatedLoopEvent('evaluated_loop_save', payload, transport);

export const trackEvaluatedLoopConversion = (
  payload: EvaluatedLoopConversionPayload,
  transport?: AnalyticsTransport,
) => trackEvaluatedLoopEvent('evaluated_loop_conversion', payload, transport);

export const evaluatedLoopAnalyticsInternals = {
  buildPayload,
  normalizeReasonCodes,
};
