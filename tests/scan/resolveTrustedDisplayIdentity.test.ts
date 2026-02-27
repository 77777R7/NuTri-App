import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveTrustedDisplayIdentity } from '@/lib/scan/resolveTrustedDisplayIdentity';

test('trusted regulatory source keeps real product name before rev1 when stage0 winner is stable', () => {
  const resolved = resolveTrustedDisplayIdentity({
    bundleMeta: {
      sourceType: 'lnhpd',
      sourceTypeFinal: false,
      revision: 0,
      stage0Winner: 'lnhpd',
      stage0ReplaceCount: 0,
      authoritativeIdentity: { type: 'npn', value: '80012345' },
    } as any,
    productName: 'Vitamin D 1000IU',
    productSubtitle: 'Laboratories Nutri',
  });

  assert.equal(resolved.displayIdentityMode, 'trusted');
  assert.equal(resolved.title, 'Vitamin D 1000IU');
  assert.equal(resolved.titleSanitized, false);
});

test('regulatory trusted source can show real product name before stage0 stability lock', () => {
  const resolved = resolveTrustedDisplayIdentity({
    bundleMeta: {
      sourceType: 'lnhpd',
      sourceTypeFinal: false,
      revision: 0,
      stage0Winner: 'web_hint_unverified',
      stage0ReplaceCount: 1,
      authoritativeIdentity: { type: 'npn', value: '80012345' },
    } as any,
    productName: 'Vitamin D 1000IU',
    productSubtitle: 'Laboratories Nutri',
  });

  assert.equal(resolved.displayIdentityMode, 'trusted');
  assert.equal(resolved.title, 'Vitamin D 1000IU');
  assert.equal(resolved.titleSanitized, false);
});

test('label_record source remains pending while identity is unstable', () => {
  const resolved = resolveTrustedDisplayIdentity({
    bundleMeta: {
      sourceType: 'label',
      sourceTypeFinal: false,
      revision: 0,
      stage0Winner: 'web_hint_unverified',
      stage0ReplaceCount: 1,
      authoritativeIdentity: { type: 'gtin14', value: '00665553227870' },
    } as any,
    productName: 'Vitamin D 1000IU',
    productSubtitle: 'Laboratories Nutri',
  });

  assert.equal(resolved.displayIdentityMode, 'pending');
  assert.equal(resolved.title, 'Analyzing barcode...');
  assert.equal(resolved.titleSanitized, true);
});

test('web hint with sourceTypeFinal=false remains pending (not unverified)', () => {
  const resolved = resolveTrustedDisplayIdentity({
    bundleMeta: {
      sourceType: 'web',
      sourceTypeFinal: false,
      revision: 0,
      authoritativeIdentity: { type: 'gtin14', value: '00665553227870' },
    } as any,
    productName: 'Golf with your Friends - YouTube',
  });

  assert.equal(resolved.displayIdentityMode, 'pending');
  assert.equal(resolved.title, 'Analyzing barcode...');
  assert.match(resolved.subtitle, /UPC:\s*00665553227870/);
  assert.equal(resolved.titleSanitized, true);
});

test('web hint with sourceTypeFinal=true shows unverified mode', () => {
  const resolved = resolveTrustedDisplayIdentity({
    bundleMeta: {
      sourceType: 'web',
      sourceTypeFinal: true,
      revision: 1,
      authoritativeIdentity: { type: 'gtin14', value: '00665553227870' },
    } as any,
    productName: 'Suspicious Web Title',
  });

  assert.equal(resolved.displayIdentityMode, 'unverified');
  assert.equal(resolved.title, 'Unverified barcode');
  assert.match(resolved.subtitle, /unverified/i);
  assert.equal(resolved.titleSanitized, true);
});

test('unknown attribution without barcode stays in pending neutral mode', () => {
  const resolved = resolveTrustedDisplayIdentity({
    bundleMeta: null,
    productName: null,
    productSubtitle: null,
  });

  assert.equal(resolved.displayIdentityMode, 'pending');
  assert.equal(resolved.title, 'Analyzing barcode...');
  assert.equal(resolved.subtitle, 'Identifying product details.');
  assert.equal(resolved.titleSanitized, true);
});

test('debug mode appends web hint domain in subtitle', () => {
  const resolved = resolveTrustedDisplayIdentity({
    bundleMeta: {
      sourceType: 'web',
      sourceTypeFinal: true,
      revision: 1,
      authoritativeIdentity: { type: 'gtin14', value: '00064642079992' },
    } as any,
    productName: 'Suspicious Web Title',
    showDebugWebHintSource: true,
    sources: [{ url: 'https://www.youtube.com/watch?v=abc' }],
  });

  assert.equal(resolved.displayIdentityMode, 'unverified');
  assert.match(resolved.subtitle, /youtube\.com/i);
});

test('bundle meta productIdentity with identityStable=true is preferred for trusted regulatory first frame', () => {
  const resolved = resolveTrustedDisplayIdentity({
    bundleMeta: {
      sourceType: 'web',
      sourceTypeFinal: false,
      revision: 0,
      stage0Winner: 'web_hint_unverified',
      stage0ReplaceCount: 1,
      authoritativeIdentity: { type: 'gtin14', value: '00665553227870' },
      productIdentity: {
        name: 'Vitamin D 1000IU (Tablet)',
        brand: 'Laboratories Nutri',
        sourceAttribution: 'verified_regulatory',
        identityStable: true,
        sourceId: 'npn:80012345',
      },
    } as any,
    productName: 'Suspicious fallback title',
    productSubtitle: '',
  });

  assert.equal(resolved.displayIdentityMode, 'trusted');
  assert.equal(resolved.title, 'Vitamin D 1000IU (Tablet)');
  assert.equal(resolved.subtitle, 'Laboratories Nutri');
  assert.equal(resolved.titleSanitized, false);
});

test('bundle meta productIdentity keeps label_record pending when identityStable=false', () => {
  const resolved = resolveTrustedDisplayIdentity({
    bundleMeta: {
      sourceType: 'label',
      sourceTypeFinal: false,
      revision: 0,
      stage0Winner: 'web_hint_unverified',
      stage0ReplaceCount: 1,
      authoritativeIdentity: { type: 'gtin14', value: '00665553227870' },
      productIdentity: {
        name: 'Label Scan Product',
        brand: 'Brand X',
        sourceAttribution: 'label_record',
        identityStable: false,
        sourceId: 'label:abc123',
      },
    } as any,
    productName: 'Label Scan Product',
  });

  assert.equal(resolved.displayIdentityMode, 'pending');
  assert.equal(resolved.titleSanitized, true);
});

test('stage0 verified winner can unlock trusted first frame even when provisional sourceType is web', () => {
  const resolved = resolveTrustedDisplayIdentity({
    bundleMeta: {
      sourceType: 'web',
      sourceTypeFinal: false,
      revision: 0,
      stage0Winner: 'verified_regulatory',
      stage0ReplaceCount: 0,
      authoritativeIdentity: { type: 'gtin14', value: '00064642061379' },
    } as any,
    productName: 'Glucosamine 500mg - Regular Strength',
    productSubtitle: 'Jamieson',
  });

  assert.equal(resolved.displayIdentityMode, 'trusted');
  assert.equal(resolved.title, 'Glucosamine 500mg - Regular Strength');
  assert.equal(resolved.titleSanitized, false);
});
