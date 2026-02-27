import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const SELECT_SCRIPT_FILE = path.join(process.cwd(), 'scripts/maintainer/mobile-soak-select-barcodes.mjs');

test('stratified profiles exclude killer and enforce unique barcode selection', () => {
  const source = fs.readFileSync(SELECT_SCRIPT_FILE, 'utf8');

  assert.ok(source.includes('const buildRolePlan = (count, selectedProfile) => {'));
  assert.ok(source.includes('if (selectedProfile === "smoke5")'));
  assert.ok(source.includes('if (selectedProfile === "authoritative30" || selectedProfile === "authoritative200")'));
  assert.ok(source.includes('authoritative200'));
  assert.ok(source.includes('const AUTHORITATIVE_PROFILE_TARGETS = {'));
  assert.ok(source.includes('authoritative200: { lnhpd: 100, dsld: 100 }'));
  assert.ok(source.includes('const STRATIFIED50_RELEASE_ROLE_COUNTS = Object.freeze({'));
  assert.ok(source.includes('lnhpd: 18,'));
  assert.ok(source.includes('dsld: 24,'));
  assert.ok(source.includes('web_hint: 6,'));
  assert.ok(source.includes('not_found: 2,'));
  assert.ok(source.includes('ceiling4: 4'));
  assert.ok(source.includes('const CEILING_SUITE_BARCODES = ['));
  assert.ok(source.includes('if (selectedProfile === "ceiling4") {'));
  assert.ok(source.includes('return Array(Math.max(0, count)).fill("ceiling");'));
  assert.ok(source.includes('if (profile === "ceiling4") {'));
  assert.ok(source.includes('role: "ceiling"'));
  assert.ok(source.includes('ceiling suite (4 fixed LNHPD data-ceiling barcodes)'));
  assert.ok(source.includes('const authoritativePlan = [...Array(target.lnhpd).fill("lnhpd"), ...Array(target.dsld).fill("dsld")];'));
  assert.ok(source.includes('if (selectedProfile === "stratified50") {'));
  assert.ok(source.includes('stratified50 UL-eligible weighted (lnhpd=18 dsld=24 web_hint=6 not_found=2)'));
  assert.ok(source.includes('if (profile === "authoritative30" || profile === "authoritative200") {'));
  assert.ok(source.includes('${profile} requires ${target.lnhpd} lnhpd + ${target.dsld} dsld unique barcodes'));
  assert.ok(
    source.includes(
      "...dsldPoolFromCanonical",
    ),
  );
  assert.ok(source.includes('const looksLikeDsldCanonicalRow = (row) => {'));
  assert.ok(source.includes('const looksLikeDsldMetaRow = (row) => {'));
  assert.ok(source.includes('"barcode_normalized_gtin14",'));
  assert.ok(source.includes('"upc_digits_str",'));
  assert.ok(source.includes('table: "dsld_barcode_canonical"'));
  assert.ok(source.includes('table: "dsld_labels_meta"'));
  assert.ok(source.includes('const collectPool = async ({ table, matcher, limit, pageSize = 1000 }) => {'));
  assert.ok(source.includes(".range(start, end)"));
  assert.ok(source.includes('logDiag("pool_counts", {'));
  assert.ok(source.includes('const looksLikeDsldSnapshotRow = (row) => {'));
  assert.ok(source.includes('"key",'));
  assert.ok(source.includes('const plan = ["lnhpd", "dsld", "web_hint", "not_found"]'));
  assert.ok(!source.includes('plan.push("killer")'));

  assert.ok(
    source.includes(
      'profile === "stratified30"',
    ),
  );
  assert.ok(source.includes('|| profile === "authoritative200"'));
  assert.ok(source.includes('if (fallback && (!enforceUnique || !used.has(fallback))) return fallback;'));
  assert.ok(source.includes('if (barcode && (enforceUnique || role !== "killer")) {'));
  assert.ok(source.includes('profile === "authoritative30" || profile === "authoritative200"'));
  assert.ok(source.includes('? ["lnhpd", "dsld"]'));
  assert.ok(source.includes('authoritative set ('));

  assert.ok(source.includes('profile === "smoke5"'));
  assert.ok(source.includes('stratified unique set (lnhpd/dsld/web_hint/not_found), killer excluded'));
  assert.ok(source.includes('uniquenessEnforced: enforceUnique'));
});
