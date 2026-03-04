#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const BARCODE = '00023249011835';

const parseArgs = () => {
  const args = process.argv.slice(2);
  const parsed = {
    apiBase: process.env.EXPO_PUBLIC_SEARCH_API_BASE_URL || 'http://127.0.0.1:3001',
    barcode: BARCODE,
    outRoot: 'output/score_algorithm_audit',
  };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--api-base' && args[i + 1]) parsed.apiBase = args[++i];
    else if (arg === '--barcode' && args[i + 1]) parsed.barcode = args[++i];
    else if (arg === '--out-root' && args[i + 1]) parsed.outRoot = args[++i];
  }
  return parsed;
};

const clamp = (value) => Math.max(0, Math.min(100, Math.round(value)));

const scoreBand = (score) => {
  if (score >= 90) return 'Excellent';
  if (score >= 80) return 'Strong';
  if (score >= 70) return 'Good';
  if (score >= 60) return 'Fair';
  if (score >= 45) return 'Limited';
  return 'Weak';
};

const oldConfidenceWeight = (strength) => {
  if (strength === 'official') return 1.0;
  if (strength === 'scanned_label') return 0.95;
  if (strength === 'cert_page_verified') return 1.0;
  if (strength === 'overlay_claim') return 0.7;
  if (strength === 'overlay_label_transcription') return 0.7;
  if (strength === 'general_science') return 0.55;
  return 0.25;
};

const legacyModuleScore = (module) => {
  const items = Array.isArray(module?.checklist)
    ? module.checklist.filter((item) => {
        if (!item || typeof item !== 'object') return false;
        if (/testing_verification:independent_cert_page/i.test(String(item.key || ''))) return false;
        return true;
      })
    : [];
  if (items.length === 0) {
    return { score: 0, unknownRatio: 1, verifiedCount: 0, totalCount: 0 };
  }
  const verifiedCount = items.filter((item) => item?.state === 'verified').length;
  const unknownCount = items.filter((item) => item?.state === 'unknown').length;
  const unknownRatio = unknownCount / items.length;
  let score = clamp((verifiedCount / items.length) * 100);
  if (unknownRatio > 0.6) score = Math.min(score, 45);
  else if (unknownRatio > 0.4) score = Math.min(score, 60);
  return { score, unknownRatio, verifiedCount, totalCount: items.length };
};

const legacyOverall = (modules) => {
  const moduleLegacy = modules.map((module) => {
    const res = legacyModuleScore(module);
    return {
      id: module.id,
      title: module.title,
      legacyScore: res.score,
      unknownRatio: res.unknownRatio,
      verifiedCount: res.verifiedCount,
      totalCount: res.totalCount,
    };
  });
  const overallScore = moduleLegacy.length > 0
    ? clamp(moduleLegacy.reduce((sum, item) => sum + item.legacyScore, 0) / moduleLegacy.length)
    : 0;
  const allScoredItems = modules.flatMap((module) =>
    Array.isArray(module?.checklist)
      ? module.checklist.filter((item) => !/testing_verification:independent_cert_page/i.test(String(item?.key || '')))
      : [],
  );
  const weightedTotal = allScoredItems.length;
  const weightedKnown = allScoredItems.reduce((sum, item) => {
    if (item?.state === 'unknown') return sum;
    return sum + oldConfidenceWeight(String(item?.evidenceStrength || 'inferred'));
  }, 0);
  const confidencePct = weightedTotal > 0 ? clamp((weightedKnown / weightedTotal) * 100) : 0;
  return {
    overallScore,
    overallBand: scoreBand(overallScore),
    confidencePct,
    modules: moduleLegacy,
  };
};

const formatPct = (value) => `${Math.round(Number(value) || 0)}%`;

const toMd = (report) => {
  const lines = [];
  lines.push('# Sports Research Omega-3 Score Algorithm Audit (Before vs After)');
  lines.push('');
  lines.push(`- Barcode: ${report.sample.barcode}`);
  lines.push(`- GTIN14: ${report.sample.gtin14}`);
  lines.push(`- Generated at: ${report.generatedAt}`);
  lines.push(`- API base: ${report.apiBase}`);
  lines.push('');
  lines.push('## Overall');
  lines.push('');
  lines.push(`- Before (legacy): ${report.before.overallScore}/100 · ${report.before.overallBand} · Confidence ${formatPct(report.before.confidencePct)}`);
  lines.push(`- After (new): ${report.after.overallScore}/100 · ${report.after.overallBand} · Confidence ${formatPct(report.after.confidencePct)}`);
  lines.push(`- Raw band before confidence gate: ${report.after.rawOverallBand}`);
  lines.push(`- Critical gate failed: ${report.after.criticalGateFailed ? 'yes' : 'no'}`);
  lines.push('');
  lines.push('## Module Breakdown');
  lines.push('');
  for (const module of report.modules) {
    lines.push(`### ${module.title} (${module.id})`);
    lines.push(`- Before score: ${module.before.legacyScore}`);
    lines.push(`- After score: ${module.after.finalScore}`);
    lines.push(`- Completeness: ${module.after.completenessScore}`);
    lines.push(`- Proof cap: ${module.after.proofCap}`);
    lines.push(`- Critical cap: ${module.after.criticalCap}`);
    lines.push(`- Unknown ratio: ${Math.round((module.after.unknownRatio || 0) * 100)}%`);
    lines.push(`- Confidence contribution: ${module.after.confidenceContribution.toFixed(2)} / weight ${module.after.confidenceWeightSum.toFixed(2)}`);
    lines.push(`- Critical gate triggered: ${module.after.criticalGateTriggered ? 'yes' : 'no'}`);
    lines.push('');
  }

  lines.push('## Checklist Contributions');
  lines.push('');
  for (const module of report.modules) {
    lines.push(`### ${module.title}`);
    for (const item of module.items) {
      lines.push(
        `- ${item.key}: state=${item.state}, weight=${item.weight}, role=${item.role}, evidenceStrength=${item.evidenceStrength}, contributed=${item.contributedToScore ? 'yes' : 'no'}`,
      );
    }
    lines.push('');
  }

  lines.push('## Why The Old Algorithm Broke');
  lines.push('');
  lines.push('- Legacy scoring mainly counted `verified item count / total` and ignored evidence-strength caps.');
  lines.push('- Legacy Testing & Verification excluded independent cert-page status from scoring, so claim-only evidence stayed high.');
  lines.push('- New scoring applies module completeness + proof cap + critical cap, then confidence-gated overall band.');
  lines.push('- Result prevents `100/Excellent` when confidence and independent verification are not strong enough.');
  lines.push('');
  return lines.join('\n');
};

const main = async () => {
  const args = parseArgs();
  const apiBase = String(args.apiBase || '').replace(/\/$/, '');
  const barcode = String(args.barcode || BARCODE);
  const gtin14 = barcode.padStart(14, '0');
  const url = `${apiBase}/api/decision-support/v1?barcode=${encodeURIComponent(barcode)}&viewMode=details`;
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      'X-Auth-Disabled': '1',
      Accept: 'application/json',
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`decision-support request failed (${res.status}): ${text.slice(0, 400)}`);
  }
  const payload = await res.json();
  const v2 = payload?.nutriScoreCardV2;
  if (!v2 || !Array.isArray(v2.modules)) {
    throw new Error('nutriScoreCardV2 missing from decision-support response');
  }

  const before = legacyOverall(v2.modules);
  const modules = v2.modules.map((module) => ({
    id: module.id,
    title: module.title,
    before: before.modules.find((item) => item.id === module.id) || null,
    after: {
      finalScore: Number(module?.score || 0),
      completenessScore: Number(module?.debug?.completenessScore || 0),
      proofCap: Number(module?.debug?.proofCap || 0),
      criticalCap: Number(module?.debug?.criticalCap || 0),
      unknownRatio: Number(module?.debug?.unknownRatio || 0),
      confidenceContribution: Number(module?.debug?.confidenceContribution || 0),
      confidenceWeightSum: Number(module?.debug?.confidenceWeightSum || 0),
      criticalGateTriggered: Boolean(module?.debug?.criticalGateTriggered),
    },
    items: Array.isArray(module?.checklist)
      ? module.checklist.map((item) => ({
          key: item?.key,
          label: item?.label,
          state: item?.state,
          weight: Number(item?.weight || 0),
          role: item?.role || (item?.scoreEligible === false ? 'info' : 'score'),
          evidenceStrength: item?.evidenceStrength || 'inferred',
          contributedToScore: (item?.role || 'score') === 'score' && Number(item?.weight || 0) > 0 && item?.state === 'verified',
        }))
      : [],
  }));

  const after = {
    overallScore: Number(v2?.overallScore || 0),
    overallBand: String(v2?.overallBand || scoreBand(Number(v2?.overallScore || 0))),
    confidencePct: Number(v2?.confidencePct || 0),
    rawOverallBand: String(v2?.debug?.rawOverallBand || ''),
    criticalGateFailed: Boolean(v2?.debug?.criticalGateFailed),
    moduleWeightsUsed: v2?.debug?.moduleWeightsUsed || null,
  };

  const report = {
    generatedAt: new Date().toISOString(),
    apiBase,
    sample: {
      barcode,
      gtin14,
      sourceType: payload?.sourceType || null,
      categoryId: payload?.categoryId || null,
      identity: payload?.sourceType && payload?.barcode ? `${payload.sourceType}:${payload.barcode}` : null,
    },
    before,
    after,
    modules,
  };

  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const outDir = path.resolve(args.outRoot, stamp);
  await fs.mkdir(outDir, { recursive: true });
  const jsonPath = path.join(outDir, 'sports_research_omega3_before_after.json');
  const mdPath = path.join(outDir, 'sports_research_omega3_before_after.md');
  await fs.writeFile(jsonPath, JSON.stringify(report, null, 2) + '\n', 'utf8');
  await fs.writeFile(mdPath, toMd(report), 'utf8');
  console.log(JSON.stringify({ ok: true, jsonPath, mdPath }, null, 2));
};

main().catch((error) => {
  console.error('[audit-score-algorithm-v2] failed:', error?.message || error);
  process.exit(1);
});
