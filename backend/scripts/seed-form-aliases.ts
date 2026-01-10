import { supabase } from '../src/supabase.js';
import { BUILTIN_FORM_ALIASES } from '../src/scoring/v4ScoreEngine.js';

const normalizeAlias = (value: string): string =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

const run = async () => {
  const { data: existingRows, error: existingError } = await supabase
    .from('ingredient_form_aliases')
    .select('alias_norm,form_key')
    .is('ingredient_id', null);
  if (existingError) {
    throw existingError;
  }

  const existing = new Set(
    (existingRows ?? []).map((row) => {
      const aliasNorm = normalizeAlias(
        typeof row?.alias_norm === 'string' ? row.alias_norm : '',
      );
      const formKey = typeof row?.form_key === 'string' ? row.form_key : '';
      return `${aliasNorm}:${formKey}`;
    }),
  );

  const rows = BUILTIN_FORM_ALIASES.map((alias) => ({
    alias_text: alias.alias_text,
    alias_norm: normalizeAlias(alias.alias_norm || alias.alias_text),
    form_key: alias.form_key,
    ingredient_id: null,
    confidence: alias.confidence,
    audit_status: alias.audit_status ?? 'derived',
    source: alias.source ?? 'seed',
  })).filter((row) => {
    if (!row.alias_norm || !row.form_key) return false;
    const key = `${row.alias_norm}:${row.form_key}`;
    if (existing.has(key)) return false;
    existing.add(key);
    return true;
  });

  if (!rows.length) {
    console.log('No new form aliases to seed.');
    return;
  }

  const { error } = await supabase.from('ingredient_form_aliases').insert(rows);
  if (error) {
    throw error;
  }

  console.log(`Seeded ${rows.length} form aliases.`);
};

run().catch((error) => {
  console.error('Failed to seed form aliases:', error);
  process.exit(1);
});
