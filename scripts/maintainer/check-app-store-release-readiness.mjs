#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const blockers = [];
const warnings = [];
const passes = [];

const readText = (relativePath) => readFileSync(path.join(root, relativePath), 'utf8');
const readJson = (relativePath) => JSON.parse(readText(relativePath));

const addPass = (message) => passes.push(message);
const addWarning = (message) => warnings.push(message);
const addBlocker = (message) => blockers.push(message);

const getGitStatus = () => {
  try {
    return execFileSync('git', ['status', '--short'], { cwd: root, encoding: 'utf8' })
      .split('\n')
      .map((line) => line.trimEnd())
      .filter(Boolean);
  } catch (error) {
    addWarning(`Could not read git status: ${error.message}`);
    return [];
  }
};

const protectedScanPaths = [
  'app/scan/barcode.tsx',
  'app/scan/result.tsx',
  'components/scan/',
  'hooks/useStreamAnalysis.ts',
  'lib/auth-token.ts',
  'lib/auth-mode.ts',
  'app.config.ts',
  'backend/src/server.ts',
  'eas.json',
];

const isProtectedScanPath = (filePath) =>
  protectedScanPaths.some((protectedPath) =>
    protectedPath.endsWith('/') ? filePath.startsWith(protectedPath) : filePath === protectedPath,
  );

const parseStatusPath = (line) => {
  const pathPart = line.slice(3).trim();
  const renameSeparator = ' -> ';
  return pathPart.includes(renameSeparator) ? pathPart.split(renameSeparator).at(-1) : pathPart;
};

const assertNoDevBypassEnv = (profileName, env = {}) => {
  for (const key of ['EXPO_PUBLIC_DEV_FORCE_HOME', 'EXPO_PUBLIC_DEV_FORCE_PREMIUM']) {
    if (env[key] != null) {
      addBlocker(`${profileName} EAS profile must not set ${key}`);
    }
  }
};

const assertPublicHttpsUrl = (profileName, key, value) => {
  if (value == null || value === '') return;
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    addBlocker(`${profileName}.${key} is not a valid URL: ${value}`);
    return;
  }
  if (parsed.protocol !== 'https:') {
    addBlocker(`${profileName}.${key} must be https for App Store builds: ${value}`);
  }
  const host = parsed.hostname;
  const isPrivate =
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '0.0.0.0' ||
    host.startsWith('10.') ||
    host.startsWith('192.168.') ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host);
  if (isPrivate) {
    addBlocker(`${profileName}.${key} must not point to a private/local host: ${value}`);
  }
};

const packageJson = readJson('package.json');
const easJson = readJson('eas.json');
const appConfigSource = readText('app.config.ts');

if (packageJson.dependencies?.['expo-location']) {
  addBlocker('expo-location is installed but no shipped device-location feature is currently allowed.');
} else {
  addPass('No unused expo-location dependency is present.');
}

if (/NSLocationWhenInUseUsageDescription/.test(appConfigSource)) {
  addBlocker('iOS location usage description is present without an approved device-location feature.');
} else {
  addPass('No unused iOS location permission string is present.');
}

if (!/NSCameraUsageDescription/.test(appConfigSource)) {
  addBlocker('NSCameraUsageDescription is required for barcode scanning.');
} else {
  addPass('Camera purpose string is configured.');
}

const production = easJson.build?.production;
if (!production) {
  addBlocker('Missing EAS production build profile.');
} else {
  const env = production.env ?? {};
  assertNoDevBypassEnv('production', env);
  if (env.EXPO_PUBLIC_DISABLE_AUTH === '1' || env.EXPO_PUBLIC_DISABLE_AUTH === 'true') {
    addBlocker('production EAS profile must not disable auth.');
  }
  if (!env.EXPO_PUBLIC_REVENUECAT_IOS_API_KEY) {
    addBlocker('production EAS profile must include EXPO_PUBLIC_REVENUECAT_IOS_API_KEY.');
  }
  if (env.EXPO_PUBLIC_REVENUECAT_ENTITLEMENT_ID !== 'pro') {
    addBlocker('production EAS profile must set EXPO_PUBLIC_REVENUECAT_ENTITLEMENT_ID=pro.');
  }
  assertPublicHttpsUrl('production', 'EXPO_PUBLIC_API_BASE_URL', env.EXPO_PUBLIC_API_BASE_URL);
  assertPublicHttpsUrl('production', 'EXPO_PUBLIC_SEARCH_API_BASE_URL', env.EXPO_PUBLIC_SEARCH_API_BASE_URL);
  addPass('Production EAS profile exists and RevenueCat contract is present.');
}

for (const [profileName, profile] of Object.entries(easJson.build ?? {})) {
  assertNoDevBypassEnv(profileName, profile.env ?? {});
}

if (!easJson.submit?.production?.ios?.ascAppId) {
  addBlocker('Missing submit.production.ios.ascAppId for App Store submit.');
} else {
  addPass(`App Store Connect app id is configured: ${easJson.submit.production.ios.ascAppId}`);
}

for (const requiredDoc of [
  'docs/app-store-release-gate-current.md',
  'docs/revenuecat-apple-purchase-followup.md',
  'docs/scan-release-gate.md',
  'docs/product-search-release-readiness.md',
]) {
  if (!existsSync(path.join(root, requiredDoc))) {
    addWarning(`Missing release support doc: ${requiredDoc}`);
  } else {
    addPass(`Release support doc exists: ${requiredDoc}`);
  }
}

const statusLines = getGitStatus();
const protectedDirty = statusLines
  .map((line) => ({ line, filePath: parseStatusPath(line) }))
  .filter(({ filePath }) => isProtectedScanPath(filePath));

if (protectedDirty.length > 0) {
  addBlocker(
    `Protected scan/release files are dirty and need a dedicated release gate:\n${protectedDirty
      .map(({ line }) => `  ${line}`)
      .join('\n')}`,
  );
} else {
  addPass('No protected scan/release files are dirty.');
}

const stagedLines = statusLines.filter((line) => line[0] !== ' ' && line[0] !== '?');
if (stagedLines.length > 0) {
  addWarning(
    `There are staged changes. Confirm the staged set is the intended release package:\n${stagedLines
      .map((line) => `  ${line}`)
      .join('\n')}`,
  );
}

const report = {
  status: blockers.length > 0 ? 'blocked' : 'pass',
  blockerCount: blockers.length,
  warningCount: warnings.length,
  passCount: passes.length,
  blockers,
  warnings,
  passes,
};

console.log(JSON.stringify(report, null, 2));

if (blockers.length > 0) {
  process.exit(1);
}
