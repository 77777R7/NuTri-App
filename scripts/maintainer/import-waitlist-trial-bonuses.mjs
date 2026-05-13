#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

const EMAIL_ALIASES = ['email', 'email address', 'email_address', 'subscriber email', 'subscriber_email'];
const REFERRAL_CODE_ALIASES = ['referral code', 'referral_code', 'referralcode', 'invite code', 'invite_code', 'ref'];
const REFERRED_COUNT_ALIASES = [
  'referred count',
  'referred_count',
  'referral count',
  'referral_count',
  'referrals',
  'referrals count',
  'referrals_count',
  'successful referrals',
  'successful_referrals',
  'confirmed referrals',
  'confirmed_referrals',
  'total referrals',
  'total_referrals',
];

const usage = () => {
  console.log(`Usage:
  node scripts/maintainer/import-waitlist-trial-bonuses.mjs --input beehiiv-export.csv
  node scripts/maintainer/import-waitlist-trial-bonuses.mjs --input beehiiv-export.csv --apply

Required for --apply:
  SUPABASE_URL or EXPO_PUBLIC_SUPABASE_URL
  SUPABASE_SERVICE_ROLE_KEY

Expected CSV columns:
  email plus one referral count column, such as referred_count, referral_count, referrals, or successful_referrals.
  referral_code/ref is optional.
`);
};

const parseArgs = () => {
  const args = process.argv.slice(2);
  const options = { apply: false, input: '' };

  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value === '--apply') {
      options.apply = true;
      continue;
    }
    if (value === '--input') {
      options.input = args[index + 1] ?? '';
      index += 1;
      continue;
    }
    if (value === '--help' || value === '-h') {
      usage();
      process.exit(0);
    }
  }

  return options;
};

const parseCsv = (source) => {
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        cell += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (!inQuotes && char === ',') {
      row.push(cell);
      cell = '';
      continue;
    }

    if (!inQuotes && (char === '\n' || char === '\r')) {
      if (char === '\r' && next === '\n') {
        index += 1;
      }
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      continue;
    }

    cell += char;
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  return rows.filter((entry) => entry.some((value) => value.trim().length > 0));
};

const normalizeHeader = (value) => value.trim().toLowerCase().replace(/\s+/g, ' ');

const findColumn = (headers, aliases) => {
  const normalizedAliases = new Set(aliases.map(normalizeHeader));
  return headers.findIndex((header) => normalizedAliases.has(header));
};

const parseReferralCount = (value) => {
  const normalized = String(value ?? '').replace(/,/g, '').trim();
  if (!normalized) return 0;
  const parsed = Number.parseInt(normalized, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};

const computeBonusDays = (referredCount) => {
  if (referredCount >= 3) return 4;
  if (referredCount === 2) return 2;
  if (referredCount === 1) return 1;
  return 0;
};

const normalizeEmail = (value) => String(value ?? '').trim().toLowerCase();

const loadRows = (inputPath) => {
  const raw = readFileSync(inputPath, 'utf8');
  const parsedRows = parseCsv(raw);
  if (parsedRows.length < 2) {
    throw new Error('CSV must include a header row and at least one subscriber row.');
  }

  const headers = parsedRows[0].map(normalizeHeader);
  const emailIndex = findColumn(headers, EMAIL_ALIASES);
  const codeIndex = findColumn(headers, REFERRAL_CODE_ALIASES);
  const referredCountIndex = findColumn(headers, REFERRED_COUNT_ALIASES);

  if (emailIndex < 0) {
    throw new Error(`Could not find an email column. Accepted names: ${EMAIL_ALIASES.join(', ')}`);
  }
  if (referredCountIndex < 0) {
    throw new Error(`Could not find a referral count column. Accepted names: ${REFERRED_COUNT_ALIASES.join(', ')}`);
  }

  const byEmail = new Map();

  for (const row of parsedRows.slice(1)) {
    const email = normalizeEmail(row[emailIndex]);
    if (!email || !email.includes('@')) continue;

    const referredCount = parseReferralCount(row[referredCountIndex]);
    const referralCode = codeIndex >= 0 ? String(row[codeIndex] ?? '').trim() : '';
    const existing = byEmail.get(email);

    if (!existing || referredCount > existing.referred_count) {
      byEmail.set(email, {
        email,
        referred_count: referredCount,
        bonus_days: computeBonusDays(referredCount),
        ...(referralCode ? { referral_code: referralCode } : {}),
        source: 'beehiiv_csv',
        synced_at: new Date().toISOString(),
      });
    } else if (referralCode && !existing.referral_code) {
      existing.referral_code = referralCode;
    }
  }

  return Array.from(byEmail.values()).sort((a, b) => a.email.localeCompare(b.email));
};

const chunkRows = (rows, size) => {
  const chunks = [];
  for (let index = 0; index < rows.length; index += size) {
    chunks.push(rows.slice(index, index + size));
  }
  return chunks;
};

const main = async () => {
  const options = parseArgs();
  if (!options.input) {
    usage();
    throw new Error('Missing --input path.');
  }

  const inputPath = path.resolve(options.input);
  const rows = loadRows(inputPath);
  const referralRows = rows.filter((row) => row.referred_count > 0);
  const maxReferredCount = rows.reduce((max, row) => Math.max(max, row.referred_count), 0);

  console.log(`[waitlist-trial-import] Parsed ${rows.length} subscribers from ${inputPath}`);
  console.log(`[waitlist-trial-import] ${referralRows.length} subscribers have at least one referral; max referrals: ${maxReferredCount}`);
  console.log(`[waitlist-trial-import] Dry run: ${options.apply ? 'no' : 'yes'}`);
  console.log('[waitlist-trial-import] Sample rows:', rows.slice(0, 3));

  if (!options.apply) {
    console.log('[waitlist-trial-import] Add --apply to upsert these rows into public.waitlist_trial_bonuses.');
    return;
  }

  const supabaseUrl = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL || '';
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Missing SUPABASE_URL/EXPO_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.');
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  for (const batch of chunkRows(rows, 500)) {
    const { error } = await supabase
      .from('waitlist_trial_bonuses')
      .upsert(batch, { onConflict: 'email' });

    if (error) {
      throw new Error(`Failed to upsert waitlist trial bonus batch: ${error.message}`);
    }
  }

  console.log(`[waitlist-trial-import] Upserted ${rows.length} waitlist trial bonus rows.`);
};

main().catch((error) => {
  console.error('[waitlist-trial-import]', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
