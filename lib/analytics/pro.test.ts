import assert from 'node:assert/strict';
import test from 'node:test';

import {
  proAnalyticsInternals,
  trackPaywallPurchaseStarted,
  trackPaywallPurchaseSuccess,
  trackPaywallViewed,
  trackPostPurchaseCtaTapped,
  trackPostPurchaseResumeFailed,
  trackPostPurchaseResumeSuccess,
  trackPostPurchaseViewed,
} from './pro.ts';
import type { AnalyticsTransport } from './transport.ts';

test('post-purchase analytics emits Pro namespace events with source and resume path', () => {
  const events: {
    namespace: string;
    event: string;
    payload: Record<string, unknown>;
  }[] = [];
  const transport: AnalyticsTransport = (namespace, event, payload) => {
    events.push({ namespace, event, payload });
  };

  trackPostPurchaseViewed({
    source: 'product_search',
    resumeTo: '/search',
    returnTo: '/main/Home-Page',
    ctaLabel: 'Continue searching',
    productId: 'nutri_pro_yearly',
    isTrial: true,
    isRestore: false,
  }, transport);

  trackPostPurchaseCtaTapped({
    source: 'product_search',
    resumeTo: '/search',
    ctaLabel: 'Continue searching',
    timeToFirstProAction: 1240,
  }, transport);

  assert.deepEqual(events, [
    {
      namespace: 'pro',
      event: 'post_purchase_viewed',
      payload: {
        source: 'product_search',
        resumeTo: '/search',
        returnTo: '/main/Home-Page',
        ctaLabel: 'Continue searching',
        productId: 'nutri_pro_yearly',
        isTrial: true,
        isRestore: false,
      },
    },
    {
      namespace: 'pro',
      event: 'post_purchase_cta_tapped',
      payload: {
        source: 'product_search',
        resumeTo: '/search',
        ctaLabel: 'Continue searching',
        timeToFirstProAction: 1240,
      },
    },
  ]);
});

test('paywall analytics emits purchase and resume funnel events', () => {
  const events: string[] = [];
  const payloads: Record<string, unknown>[] = [];
  const transport: AnalyticsTransport = (_namespace, event, payload) => {
    events.push(event);
    payloads.push(payload);
  };

  const base = {
    source: 'saved_supplement_limit' as const,
    returnTo: '/scan/result?sessionId=abc&resumeAction=save_supplement',
    resumeTo: '/scan/result?sessionId=abc&resumeAction=save_supplement',
    productId: 'nutri_pro_monthly',
    isTrial: false,
    isRestore: false,
  };

  trackPaywallViewed(base, transport);
  trackPaywallPurchaseStarted(base, transport);
  trackPaywallPurchaseSuccess(base, transport);
  trackPostPurchaseResumeSuccess({ ...base, timeToFirstProAction: 980 }, transport);
  trackPostPurchaseResumeFailed({ ...base, timeToFirstProAction: 1110 }, transport);

  assert.deepEqual(events, [
    'paywall_viewed',
    'paywall_purchase_started',
    'paywall_purchase_success',
    'post_purchase_resume_success',
    'post_purchase_resume_failed',
  ]);
  assert.equal(payloads[0].source, 'saved_supplement_limit');
  assert.equal(payloads[0].productId, 'nutri_pro_monthly');
  assert.equal(payloads[3].timeToFirstProAction, 980);
});

test('post-purchase analytics payload omits empty return destinations', () => {
  assert.deepEqual(
    proAnalyticsInternals.buildPostPurchasePayload({
      source: 'scan_limit',
      resumeTo: '/scan/barcode',
      returnTo: null,
      ctaLabel: 'Continue scanning',
    }),
    {
      source: 'scan_limit',
      resumeTo: '/scan/barcode',
      ctaLabel: 'Continue scanning',
    },
  );
});
