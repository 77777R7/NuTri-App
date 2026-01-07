import { readFile } from 'node:fs/promises';

import { supabase } from '../src/supabase.js';

type IngredientFormRecord = {
  form_key: string;
  form_display?: string;
  form_label?: string;
  relative_factor?: number | string | null;
  confidence?: number | string | null;
  evidence_grade?: string | null;
  audit_status?: string | null;
  reference_ids?: string[];
};

type EvidenceRecord = {
  goal: string;
  min_effective_dose?: number | string | null;
  optimal_range?: { min?: number | string | null; max?: number | string | null } | null;
  evidence_grade?: string | null;
  audit_status?: string | null;
  reference_ids?: string[];
};

type IngredientRecord = {
  ingredient_id: string;
  ingredient: string;
  category?: string | null;
  base_unit?: string | null;
  synonyms?: string[];
  goals?: string[];
  forms?: IngredientFormRecord[];
  evidence_by_goal?: EvidenceRecord[];
};

type CitationRecord = {
  id: string;
  type: string;
  identifier?: string | null;
  source?: string | null;
  title?: string | null;
  year?: number | string | null;
  url?: string | null;
  audit_status?: string | null;
  accessed_at?: string | null;
};

type FormAliasRecord = {
  alias_text: string;
  form_key: string;
  ingredient_id?: string | null;
  confidence?: number | string | null;
  audit_status?: string | null;
  source?: string | null;
};

type DatasetPackage = {
  version?: string;
  generated_at?: string | null;
  ingredients?: IngredientRecord[];
  citations?: CitationRecord[];
  goals?: string[];
  form_aliases?: FormAliasRecord[];
};

const args = process.argv.slice(2);
const getArg = (flag: string) => {
  const idx = args.indexOf(`--${flag}`);
  if (idx === -1) return null;
  return args[idx + 1] ?? null;
};
const hasFlag = (flag: string) => args.includes(`--${flag}`);

const toNumber = (value: unknown): number | null => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const normalizeText = (value?: string | null): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
};

const normalizeAuditStatus = (value?: string | null): string => {
  const normalized = (value ?? '').trim().toLowerCase();
  if (!normalized) return 'needs_review';
  if (['verified', 'needs_review', 'needs_resolution', 'derived'].includes(normalized)) {
    return normalized;
  }
  return 'needs_review';
};

const normalizeAliasText = (value: string): string =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

const deriveAuditStatus = (referenceIds: string[] | undefined, citations: Map<string, CitationRecord>): string => {
  if (!referenceIds?.length) return 'needs_review';
  let hasVerified = false;
  let hasNeedsReview = false;
  let hasNeedsResolution = false;
  referenceIds.forEach((refId) => {
    const status = normalizeAuditStatus(citations.get(refId)?.audit_status ?? null);
    if (status === 'verified') hasVerified = true;
    else if (status === 'needs_review' || status === 'derived') hasNeedsReview = true;
    else if (status === 'needs_resolution') hasNeedsResolution = true;
  });
  if (hasVerified) return 'verified';
  if (hasNeedsReview) return 'needs_review';
  if (hasNeedsResolution) return 'needs_resolution';
  return 'needs_review';
};

const buildNumRange = (range?: EvidenceRecord['optimal_range']): string | null => {
  if (!range) return null;
  const min = toNumber(range.min ?? null);
  const max = toNumber(range.max ?? null);
  if (min == null || max == null) return null;
  return `[${min},${max}]`;
};

const chunk = <T>(values: T[], size: number): T[][] => {
  if (size <= 0) return [values];
  const chunks: T[][] = [];
  for (let i = 0; i < values.length; i += size) {
    chunks.push(values.slice(i, i + size));
  }
  return chunks;
};

const filePath = getArg('file');
const dryRun = hasFlag('dry-run');
const strictMode = hasFlag('strict');

if (process.env.CI && !strictMode) {
  console.error('[import] CI requires --strict');
  process.exit(1);
}

if (!filePath) {
  console.error(
    'Usage: tsx backend/scripts/import-ingredient-dataset.ts --file <path> [--dry-run] [--strict]',
  );
  process.exit(1);
}

const main = async () => {
  const raw = await readFile(filePath, 'utf-8');
  const payload = JSON.parse(raw) as DatasetPackage;
  const datasetVersion = typeof payload.version === 'string' ? payload.version : null;

  const citations = Array.isArray(payload.citations) ? payload.citations : [];
  const ingredients = Array.isArray(payload.ingredients) ? payload.ingredients : [];
  const aliases = Array.isArray(payload.form_aliases) ? payload.form_aliases : [];

  if (!ingredients.length) {
    console.warn('[import] No ingredients found in payload.');
  }

  let runId: string | null = null;
  if (!dryRun) {
    const { data, error } = await supabase
      .from('ingredient_dataset_import_runs')
      .insert({
        dataset_version: datasetVersion,
        strict: strictMode,
      })
      .select('id')
      .maybeSingle();
    if (error) {
      throw new Error(`[import] import run insert failed: ${error.message}`);
    }
    runId = data?.id ?? null;
  }

  const citationMap = new Map<string, CitationRecord>();
  citations.forEach((citation) => {
    if (!citation?.id) return;
    citationMap.set(citation.id, citation);
  });

  if (!dryRun && citations.length) {
    const citationRows = citations.map((citation) => ({
      id: citation.id,
      type: citation.type,
      identifier: normalizeText(citation.identifier),
      source: normalizeText(citation.source),
      title: normalizeText(citation.title),
      year: toNumber(citation.year),
      url: normalizeText(citation.url),
      audit_status: normalizeAuditStatus(citation.audit_status),
      accessed_at: normalizeText(citation.accessed_at),
    }));
    const { error } = await supabase
      .from('citations')
      .upsert(citationRows, { onConflict: 'id' });
    if (error) {
      throw new Error(`[import] citations upsert failed: ${error.message}`);
    }
  }

  const ingredientIdMap = new Map<string, string>();
  const warnings: string[] = [];
  const issues: {
    severity: 'warning' | 'error';
    issue_type: string;
    canonical_key?: string | null;
    ingredient_id?: string | null;
    message: string;
    payload_json?: Record<string, unknown>;
  }[] = [];

  const recordIssue = (issue: {
    severity: 'warning' | 'error';
    issue_type: string;
    canonical_key?: string | null;
    ingredient_id?: string | null;
    message: string;
    payload_json?: Record<string, unknown>;
  }) => {
    issues.push(issue);
    if (issue.severity === 'warning') {
      warnings.push(issue.message);
    }
  };
  let issuesFlushed = false;

  const formRows: {
    ingredient_id: string;
    form_key: string;
    form_label: string;
    relative_factor: number;
    confidence: number;
    evidence_grade: string | null;
    audit_status: string;
  }[] = [];
  const formRefs: { form_key: string; ingredient_id: string; reference_ids: string[] }[] = [];

  const evidenceRows: {
    ingredient_id: string;
    goal: string;
    min_effective_dose: number | null;
    optimal_dose_range: string | null;
    evidence_grade: string | null;
    audit_status: string;
  }[] = [];
  const evidenceRefs: { ingredient_id: string; goal: string; reference_ids: string[] }[] = [];

  try {
    for (const record of ingredients) {
      if (!record?.ingredient_id || !record.ingredient) {
        continue;
      }
      const canonicalKey = record.ingredient_id.trim();
      const name = record.ingredient.trim();

      let existing = null as { id: string; canonical_key: string | null } | null;
      if (!dryRun) {
        const { data } = await supabase
          .from('ingredients')
          .select('id,canonical_key')
          .eq('canonical_key', canonicalKey)
          .maybeSingle();
        existing = data ?? null;
        if (!existing) {
          const { data: byName } = await supabase
            .from('ingredients')
            .select('id,canonical_key')
            .ilike('name', name)
            .maybeSingle();
          existing = byName ?? null;
        }
      }

      if (!dryRun) {
        const baseUnit = normalizeText(record.base_unit)?.toLowerCase() ?? null;

        if (existing?.id) {
          if (existing.canonical_key && existing.canonical_key !== canonicalKey) {
            const message = `[import] canonical_key conflict for ${canonicalKey} -> existing ${existing.canonical_key}`;
            recordIssue({
              severity: strictMode ? 'error' : 'warning',
              issue_type: 'canonical_key_conflict',
              canonical_key: canonicalKey,
              message,
              payload_json: { existing_canonical_key: existing.canonical_key },
            });
            if (strictMode) throw new Error(message);
            continue;
          }

          const { data: current } = await supabase
            .from('ingredients')
            .select('id,unit,name,canonical_key')
            .eq('id', existing.id)
            .maybeSingle();
          const existingUnit = normalizeText(current?.unit ?? null)?.toLowerCase() ?? null;
          if (baseUnit && existingUnit && baseUnit !== existingUnit) {
            const message = `[import] base_unit mismatch for ${canonicalKey}: ${existingUnit} vs ${baseUnit}`;
            recordIssue({
              severity: strictMode ? 'error' : 'warning',
              issue_type: 'base_unit_mismatch',
              canonical_key: canonicalKey,
              ingredient_id: existing.id,
              message,
              payload_json: { existing_unit: existingUnit, incoming_unit: baseUnit },
            });
            if (strictMode) throw new Error(message);
          }

          const nextUnit =
            existingUnit && baseUnit && existingUnit !== baseUnit ? existingUnit : baseUnit ?? existingUnit;
          const nextName = current?.name ?? name;

          const { error } = await supabase
            .from('ingredients')
            .update({
              canonical_key: canonicalKey,
              name: nextName,
              unit: nextUnit,
              category: normalizeText(record.category),
              goals: record.goals ?? null,
            })
            .eq('id', existing.id);
          if (error) {
            throw new Error(`[import] ingredient update failed (${canonicalKey}): ${error.message}`);
          }
          ingredientIdMap.set(canonicalKey, existing.id);
        } else {
          const { data, error } = await supabase
            .from('ingredients')
            .insert({
              canonical_key: canonicalKey,
              name,
              unit: normalizeText(record.base_unit)?.toLowerCase() ?? null,
              category: normalizeText(record.category),
              goals: record.goals ?? null,
            })
            .select('id')
            .maybeSingle();
          if (error || !data?.id) {
            throw new Error(
              `[import] ingredient insert failed (${canonicalKey}): ${error?.message ?? 'no id'}`,
            );
          }
          ingredientIdMap.set(canonicalKey, data.id as string);
        }
      } else {
        ingredientIdMap.set(canonicalKey, canonicalKey);
      }
    }

  if (!dryRun) {
    for (const record of ingredients) {
      const canonicalKey = record?.ingredient_id?.trim();
      if (!canonicalKey || !record.ingredient) continue;
      const ingredientUuid = ingredientIdMap.get(canonicalKey);
      if (!ingredientUuid) continue;

      const synonyms = Array.isArray(record.synonyms) ? record.synonyms : [];
      if (synonyms.length) {
        const { data: existing } = await supabase
          .from('ingredient_synonyms')
          .select('synonym')
          .eq('ingredient_id', ingredientUuid);
        const existingSet = new Set(
          (existing ?? []).map((row) => String(row.synonym ?? '').trim().toLowerCase()),
        );
        const seen = new Set(existingSet);
        const newRows = synonyms
          .map((syn) => syn?.trim())
          .filter((syn): syn is string => Boolean(syn))
          .filter((syn) => {
            const key = syn.toLowerCase();
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          })
          .map((syn) => ({
            ingredient_id: ingredientUuid,
            synonym: syn,
          }));
        if (newRows.length) {
          const { error } = await supabase
            .from('ingredient_synonyms')
            .insert(newRows);
          if (error) {
            throw new Error(`[import] synonym insert failed (${canonicalKey}): ${error.message}`);
          }
        }
      }
    }
  }

  if (!dryRun && aliases.length) {
    for (const alias of aliases) {
      if (!alias?.alias_text || !alias.form_key) continue;
      const aliasText = alias.alias_text.trim();
      const formKey = alias.form_key.trim();
      const aliasNorm = normalizeAliasText(aliasText);
      if (!aliasNorm) continue;
      const ingredientUuid = alias.ingredient_id
        ? ingredientIdMap.get(alias.ingredient_id.trim()) ?? null
        : null;
      if (alias.ingredient_id && !ingredientUuid) {
        recordIssue({
          severity: strictMode ? 'error' : 'warning',
          issue_type: 'alias_missing_ingredient',
          canonical_key: alias.ingredient_id,
          message: `[import] alias ingredient not found for ${alias.alias_text}`,
          payload_json: { alias_text: alias.alias_text, form_key: alias.form_key },
        });
        if (strictMode) {
          throw new Error(`[import] alias ingredient not found for ${alias.alias_text}`);
        }
        continue;
      }
      const baseQuery = supabase
        .from('ingredient_form_aliases')
        .select('id')
        .eq('alias_norm', aliasNorm)
        .eq('form_key', formKey);
      const { data: existingAlias, error } = ingredientUuid
        ? await baseQuery.eq('ingredient_id', ingredientUuid).maybeSingle()
        : await baseQuery.is('ingredient_id', null).maybeSingle();
      if (error) {
        throw new Error(`[import] alias lookup failed (${alias.alias_text}): ${error.message}`);
      }
      const payloadRow = {
        alias_text: aliasText,
        alias_norm: aliasNorm,
        form_key: formKey,
        ingredient_id: ingredientUuid,
        confidence: toNumber(alias.confidence),
        audit_status: normalizeAuditStatus(alias.audit_status ?? null),
        source: normalizeText(alias.source ?? null),
      };
      if (existingAlias?.id) {
        const { error: updateError } = await supabase
          .from('ingredient_form_aliases')
          .update(payloadRow)
          .eq('id', existingAlias.id);
        if (updateError) {
          throw new Error(`[import] alias update failed (${alias.alias_text}): ${updateError.message}`);
        }
      } else {
        const { error: insertError } = await supabase
          .from('ingredient_form_aliases')
          .insert(payloadRow);
        if (insertError) {
          throw new Error(`[import] alias insert failed (${alias.alias_text}): ${insertError.message}`);
        }
      }
    }
  }

  ingredients.forEach((record) => {
    const canonicalKey = record?.ingredient_id?.trim();
    if (!canonicalKey) return;
    const ingredientUuid = ingredientIdMap.get(canonicalKey);
    if (!ingredientUuid) return;

    (record.forms ?? []).forEach((form) => {
      const label = form?.form_display ?? form?.form_label;
      if (!form?.form_key || !label) return;
      const referenceIds = Array.isArray(form.reference_ids) ? form.reference_ids : [];
      const auditStatus =
        normalizeAuditStatus(form.audit_status ?? null) !== 'needs_review'
          ? normalizeAuditStatus(form.audit_status ?? null)
          : deriveAuditStatus(referenceIds, citationMap);
      formRows.push({
        ingredient_id: ingredientUuid,
        form_key: form.form_key.trim(),
        form_label: label.trim(),
        relative_factor: toNumber(form.relative_factor) ?? 1,
        confidence: toNumber(form.confidence) ?? 0.5,
        evidence_grade: normalizeText(form.evidence_grade) ?? null,
        audit_status: auditStatus,
      });
      if (referenceIds.length) {
        formRefs.push({
          ingredient_id: ingredientUuid,
          form_key: form.form_key.trim(),
          reference_ids: referenceIds,
        });
      }
    });

    (record.evidence_by_goal ?? []).forEach((evidence) => {
      if (!evidence?.goal) return;
      const referenceIds = Array.isArray(evidence.reference_ids) ? evidence.reference_ids : [];
      const auditStatus =
        normalizeAuditStatus(evidence.audit_status ?? null) !== 'needs_review'
          ? normalizeAuditStatus(evidence.audit_status ?? null)
          : deriveAuditStatus(referenceIds, citationMap);
      evidenceRows.push({
        ingredient_id: ingredientUuid,
        goal: evidence.goal.trim(),
        min_effective_dose: toNumber(evidence.min_effective_dose),
        optimal_dose_range: buildNumRange(evidence.optimal_range),
        evidence_grade: normalizeText(evidence.evidence_grade),
        audit_status: auditStatus,
      });
      if (referenceIds.length) {
        evidenceRefs.push({
          ingredient_id: ingredientUuid,
          goal: evidence.goal.trim(),
          reference_ids: referenceIds,
        });
      }
    });
  });

  if (!dryRun && formRows.length) {
    for (const batch of chunk(formRows, 500)) {
      const { error } = await supabase
        .from('ingredient_forms')
        .upsert(batch, { onConflict: 'ingredient_id,form_key' })
        .select('id,ingredient_id,form_key');
      if (error) {
        throw new Error(`[import] ingredient_forms upsert failed: ${error.message}`);
      }
    }
  }

  if (!dryRun && formRefs.length) {
    for (const entry of formRefs) {
      const { data, error } = await supabase
        .from('ingredient_forms')
        .select('id')
        .eq('ingredient_id', entry.ingredient_id)
        .eq('form_key', entry.form_key)
        .maybeSingle();
      if (error || !data?.id) {
        throw new Error(`[import] form lookup failed (${entry.form_key}): ${error?.message ?? 'no id'}`);
      }
      const joinRows = entry.reference_ids.map((ref) => ({
        form_id: data.id,
        citation_id: ref,
      }));
      const { error: joinError } = await supabase
        .from('ingredient_form_citations')
        .upsert(joinRows, { onConflict: 'form_id,citation_id' });
      if (joinError) {
        throw new Error(`[import] form citations upsert failed: ${joinError.message}`);
      }
    }
  }

  if (!dryRun && evidenceRows.length) {
    for (const batch of chunk(evidenceRows, 500)) {
      const { error } = await supabase
        .from('ingredient_evidence')
        .upsert(batch, { onConflict: 'ingredient_id,goal' })
        .select('id,ingredient_id,goal');
      if (error) {
        throw new Error(`[import] ingredient_evidence upsert failed: ${error.message}`);
      }
    }
  }

  if (!dryRun && evidenceRefs.length) {
    for (const entry of evidenceRefs) {
      const { data, error } = await supabase
        .from('ingredient_evidence')
        .select('id')
        .eq('ingredient_id', entry.ingredient_id)
        .eq('goal', entry.goal)
        .maybeSingle();
      if (error || !data?.id) {
        throw new Error(`[import] evidence lookup failed (${entry.goal}): ${error?.message ?? 'no id'}`);
      }
      const joinRows = entry.reference_ids.map((ref) => ({
        evidence_id: data.id,
        citation_id: ref,
      }));
      const { error: joinError } = await supabase
        .from('ingredient_evidence_citations')
        .upsert(joinRows, { onConflict: 'evidence_id,citation_id' });
      if (joinError) {
        throw new Error(`[import] evidence citations upsert failed: ${joinError.message}`);
      }
    }
  }

  if (!dryRun && datasetVersion) {
    const { error } = await supabase
      .from('scoring_dataset_state')
      .upsert({ key: 'ingredient_dataset', version: datasetVersion }, { onConflict: 'key' });
    if (error) {
      throw new Error(`[import] dataset version update failed: ${error.message}`);
    }
  }

  if (!dryRun && runId) {
    if (issues.length) {
      const issueRows = issues.map((issue) => ({
        run_id: runId,
        severity: issue.severity,
        issue_type: issue.issue_type,
        canonical_key: issue.canonical_key ?? null,
        ingredient_id: issue.ingredient_id ?? null,
        message: issue.message,
        payload_json: issue.payload_json ?? null,
      }));
      const { error } = await supabase
        .from('ingredient_dataset_import_issues')
        .insert(issueRows);
      if (error) {
        throw new Error(`[import] issue insert failed: ${error.message}`);
      }
      issuesFlushed = true;
    }
    const { error } = await supabase
      .from('ingredient_dataset_import_runs')
      .update({
        finished_at: new Date().toISOString(),
        stats_json: {
          ingredients: ingredients.length,
          citations: citations.length,
          forms: formRows.length,
          evidence: evidenceRows.length,
          aliases: aliases.length,
          warnings: warnings.length,
          issues: issues.length,
        },
      })
      .eq('id', runId);
    if (error) {
      throw new Error(`[import] import run update failed: ${error.message}`);
    }
  }

  warnings.forEach((warning) => console.warn(warning));
  console.log(
    `[import] done ingredients=${ingredients.length} citations=${citations.length} forms=${formRows.length} evidence=${evidenceRows.length} aliases=${aliases.length} dryRun=${dryRun} strict=${strictMode} warnings=${warnings.length}`,
  );
  } catch (error) {
    if (!dryRun && runId) {
      if (issues.length && !issuesFlushed) {
        const issueRows = issues.map((issue) => ({
          run_id: runId,
          severity: issue.severity,
          issue_type: issue.issue_type,
          canonical_key: issue.canonical_key ?? null,
          ingredient_id: issue.ingredient_id ?? null,
          message: issue.message,
          payload_json: issue.payload_json ?? null,
        }));
        await supabase.from('ingredient_dataset_import_issues').insert(issueRows);
      }
      await supabase
        .from('ingredient_dataset_import_runs')
        .update({
          finished_at: new Date().toISOString(),
          stats_json: {
            ingredients: ingredients.length,
            citations: citations.length,
            forms: formRows.length,
            evidence: evidenceRows.length,
            aliases: aliases.length,
            warnings: warnings.length,
            issues: issues.length,
            error: error instanceof Error ? error.message : String(error),
          },
        })
        .eq('id', runId);
    }
    throw error;
  }
};

main().catch((error) => {
  console.error('[import] failed', error instanceof Error ? error.message : error);
  process.exit(1);
});
