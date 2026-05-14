#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';
import process from 'node:process';

const sourceExtensions = ['.ts', '.tsx', '.js', '.jsx'];
const importExtensions = [...sourceExtensions, '.json'];
const scannedExtensions = new Set(sourceExtensions);

const gitFiles = execFileSync('git', ['ls-files'], {
  cwd: process.cwd(),
  encoding: 'utf8',
})
  .split('\n')
  .filter((file) => scannedExtensions.has(extname(file)));

const importPattern =
  /\b(?:import|export)\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?['"](@\/[^'"]+)['"]/g;

const candidatePathsForAlias = (aliasPath) => {
  const relativePath = aliasPath.slice(2);
  const basePath = join(process.cwd(), relativePath);
  const candidates = [basePath];

  for (const extension of importExtensions) {
    candidates.push(`${basePath}${extension}`);
  }

  for (const extension of importExtensions) {
    candidates.push(join(basePath, `index${extension}`));
  }

  return candidates;
};

const resolvesAlias = (aliasPath) =>
  candidatePathsForAlias(aliasPath).some((candidatePath) => {
    if (!existsSync(candidatePath)) return false;
    const stat = statSync(candidatePath);
    return stat.isFile();
  });

const missing = [];

for (const file of gitFiles) {
  const source = readFileSync(file, 'utf8');
  let match;
  while ((match = importPattern.exec(source)) !== null) {
    const aliasPath = match[1];
    if (!resolvesAlias(aliasPath)) {
      missing.push(`${file}: unresolved ${aliasPath}`);
    }
  }
}

if (missing.length > 0) {
  console.error('[app-alias-imports] unresolved alias imports found');
  for (const line of missing) {
    console.error(`- ${line}`);
  }
  process.exitCode = 1;
} else {
  console.error(`[app-alias-imports] checked ${gitFiles.length} source files`);
}
