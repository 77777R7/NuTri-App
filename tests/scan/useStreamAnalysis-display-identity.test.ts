import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const HOOK_FILE = path.join(process.cwd(), 'hooks/useStreamAnalysis.ts');
const RESOLVER_FILE = path.join(process.cwd(), 'lib/scan/resolveTrustedDisplayIdentity.ts');

test('stream hook exposes trusted display identity telemetry fields', () => {
  const source = fs.readFileSync(HOOK_FILE, 'utf8');
  assert.ok(source.includes('displayIdentityMode'));
  assert.ok(source.includes('displayIdentitySourceAttribution'));
  assert.ok(source.includes('titleSanitized'));
  assert.ok(source.includes('watchdogReason'));
  assert.ok(source.includes('resolveTrustedDisplayIdentity'));
  assert.ok(source.includes('displayIdentityMode: trustedDisplayIdentity.displayIdentityMode'));
});

test('display identity resolver prioritizes bundle meta productIdentity', () => {
  const source = fs.readFileSync(RESOLVER_FILE, 'utf8');
  assert.ok(source.includes('productIdentity'));
  assert.ok(source.includes('bundleProductIdentity'));
  assert.ok(source.includes('sourceAttribution'));
  assert.ok(source.includes('identityStable'));
});
