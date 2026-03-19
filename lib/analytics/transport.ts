export type AnalyticsNamespace = 'onboarding' | 'evaluated-loop';

export type AnalyticsTransport = (
  namespace: AnalyticsNamespace,
  event: string,
  payload: Record<string, unknown>,
) => void;

const sanitizePayload = (payload: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(payload).filter(([, value]) => value !== undefined),
  );

export const consoleAnalyticsTransport: AnalyticsTransport = (
  namespace,
  event,
  payload,
) => {
  console.info(`[${namespace}-event]`, event, sanitizePayload(payload));
};

export const emitAnalyticsEvent = (
  namespace: AnalyticsNamespace,
  event: string,
  payload: Record<string, unknown> = {},
  transport: AnalyticsTransport = consoleAnalyticsTransport,
) => {
  transport(namespace, event, sanitizePayload(payload));
};

export const analyticsTransportInternals = {
  sanitizePayload,
};
