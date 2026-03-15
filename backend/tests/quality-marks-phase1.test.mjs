import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const readSource = async (relativePath) => readFile(path.resolve(__dirname, relativePath), "utf8");

test("phase 1 programs include IFOS and keep secondary references out of generic equivalence", async () => {
  const source = await readSource("../src/qualityMarks/programs.ts");
  assert.match(source, /id:\s*"ifos"[\s\S]*mapsToGenericThirdPartyClaim:\s*true/);
  assert.match(source, /id:\s*"informed_sport"[\s\S]*mapsToGenericThirdPartyClaim:\s*true/);
  assert.match(source, /id:\s*"consumerlab_review"[\s\S]*mapsToGenericThirdPartyClaim:\s*false/);
  assert.match(source, /id:\s*"labdoor"[\s\S]*mapsToGenericThirdPartyClaim:\s*false/);
  assert.doesNotMatch(source, /id:\s*"msc"/);
});

test("provider now seeds official registry searches for phase 1 programs", async () => {
  const source = await readSource("../src/qualityMarks/provider.ts");
  assert.match(source, /sourceType:\s*"official_registry"/);
  assert.match(source, /nsfsport-prod\.nsf\.org/);
  assert.match(source, /quality-supplements\.org/);
  assert.match(source, /sport\.wetestyoutrust\.com/);
  assert.match(source, /certifications\.nutrasource\.ca/);
});

test("detector returns program-aware matches and verification summary", async () => {
  const source = await readSource("../src/qualityMarks/detector.ts");
  assert.match(source, /programMatches:\s*QualityMarkProgramMatch\[\]/);
  assert.match(source, /verificationSummary:\s*QualityMarkVerificationSummary \| null/);
  assert.match(source, /Detected \$\{programMatches\.map/);
});

test("decision support aligns generic third-party terms and exposes verification summary", async () => {
  const source = await readSource("../src/decisionSupport.ts");
  const claimRegexLine = source.match(/const CLAIM_THIRD_PARTY_TESTED_REGEX =[\s\S]*?;/);
  assert.ok(claimRegexLine, "missing CLAIM_THIRD_PARTY_TESTED_REGEX");
  assert.match(claimRegexLine[0], /informed\[-\\s\]\*sport/);
  assert.doesNotMatch(claimRegexLine[0], /consumerlab/i);
  assert.doesNotMatch(claimRegexLine[0], /igen/i);
  assert.doesNotMatch(source, /label:\s*"MSC"/);
  assert.match(source, /programMatches\?: QualityMarkProgramMatch\[\]/);
  assert.match(source, /verificationSummary\?: QualityMarkVerificationSummary \| null/);
  assert.match(source, /Official registry verification/);
});
