import { emitAnalyticsEvent, type AnalyticsTransport } from './transport';
import type { OfficialPaywallSource } from '@/lib/pro/featureGates';

export type ProPostPurchasePayload = {
  source: OfficialPaywallSource;
  resumeTo: string;
  returnTo?: string | null;
  ctaLabel: string;
  productId?: string | null;
  isTrial?: boolean;
  isRestore?: boolean;
  timeToFirstProAction?: number | null;
};

export type ProPaywallPayload = {
  source: OfficialPaywallSource;
  returnTo?: string | null;
  resumeTo?: string | null;
  productId?: string | null;
  isTrial?: boolean;
  isRestore?: boolean;
  timeToFirstProAction?: number | null;
};

const buildProPayload = (payload: ProPaywallPayload): Record<string, unknown> => ({
  source: payload.source,
  ...(payload.returnTo ? { returnTo: payload.returnTo } : {}),
  ...(payload.resumeTo ? { resumeTo: payload.resumeTo } : {}),
  ...(payload.productId ? { productId: payload.productId } : {}),
  ...(typeof payload.isTrial === 'boolean' ? { isTrial: payload.isTrial } : {}),
  ...(typeof payload.isRestore === 'boolean' ? { isRestore: payload.isRestore } : {}),
  ...(typeof payload.timeToFirstProAction === 'number'
    ? { timeToFirstProAction: payload.timeToFirstProAction }
    : {}),
});

const buildPostPurchasePayload = (payload: ProPostPurchasePayload): Record<string, unknown> => ({
  ...buildProPayload(payload),
  resumeTo: payload.resumeTo,
  ctaLabel: payload.ctaLabel,
});

export const trackPaywallViewed = (
  payload: ProPaywallPayload,
  transport?: AnalyticsTransport,
) => {
  emitAnalyticsEvent('pro', 'paywall_viewed', buildProPayload(payload), transport);
};

export const trackPaywallPurchaseStarted = (
  payload: ProPaywallPayload,
  transport?: AnalyticsTransport,
) => {
  emitAnalyticsEvent('pro', 'paywall_purchase_started', buildProPayload(payload), transport);
};

export const trackPaywallPurchaseSuccess = (
  payload: ProPaywallPayload,
  transport?: AnalyticsTransport,
) => {
  emitAnalyticsEvent('pro', 'paywall_purchase_success', buildProPayload(payload), transport);
};

export const trackPostPurchaseResumeSuccess = (
  payload: ProPaywallPayload,
  transport?: AnalyticsTransport,
) => {
  emitAnalyticsEvent('pro', 'post_purchase_resume_success', buildProPayload(payload), transport);
};

export const trackPostPurchaseResumeFailed = (
  payload: ProPaywallPayload,
  transport?: AnalyticsTransport,
) => {
  emitAnalyticsEvent('pro', 'post_purchase_resume_failed', buildProPayload(payload), transport);
};

export const trackPostPurchaseViewed = (
  payload: ProPostPurchasePayload,
  transport?: AnalyticsTransport,
) => {
  emitAnalyticsEvent('pro', 'post_purchase_viewed', buildPostPurchasePayload(payload), transport);
};

export const trackPostPurchaseCtaTapped = (
  payload: ProPostPurchasePayload,
  transport?: AnalyticsTransport,
) => {
  emitAnalyticsEvent('pro', 'post_purchase_cta_tapped', buildPostPurchasePayload(payload), transport);
};

export const proAnalyticsInternals = {
  buildProPayload,
  buildPostPurchasePayload,
};
