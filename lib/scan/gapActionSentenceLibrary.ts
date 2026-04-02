export type GapModule = 'overview' | 'usage' | 'safety' | 'science';

const GAP_REASON_COPY: Record<string, { what: string; action: string }> = {
  missing_directions: {
    what: 'The record does not include daily directions or frequency.',
    action: 'Capture the Directions panel or add daily frequency manually to improve usage precision.',
  },
  missing_warnings: {
    what: 'Label-specific warnings are not available in this source.',
    action: 'Check the product label warnings section and consult a clinician for personal risk factors.',
  },
  missing_amounts: {
    what: 'Some ingredient entries are missing exact amounts.',
    action: 'Scan a clearer Supplement Facts panel so amounts can be validated ingredient-by-ingredient.',
  },
  missing_units: {
    what: 'Some ingredient units are missing or unclear.',
    action: 'Retake the label image with the amount+unit columns fully visible.',
  },
  missing_form: {
    what: 'The chemical form is not disclosed in the current record.',
    action: 'Use the label or official monograph where the form is explicitly listed.',
  },
  multiple_label_entries: {
    what: 'This ingredient appears multiple times on the label.',
    action: 'Review each entry as listed; we do not merge them to avoid masking label structure.',
  },
  source_low_quality: {
    what: 'This source has limited reliability for label-grade details.',
    action: 'Prefer regulatory or label-backed sources for warnings and directions.',
  },
  partial_record: {
    what: 'Only partial record fields are available for this product.',
    action: 'Rescan or provide a clearer label panel to unlock a fuller product-level analysis.',
  },
  // P0-3: Cover-level gap actions
  cover_overview_sparse: {
    what: 'Overview information is derived from limited source data.',
    action: 'Capture the full Supplement Facts panel to unlock a richer product overview.',
  },
  cover_safety_missing: {
    what: 'Safety warnings are not included in this data source.',
    action: 'Check the product label or consult a clinician for personal safety guidance.',
  },
  cover_usage_sparse: {
    what: 'Usage guidance is based on general supplement advice.',
    action: 'Scan the Directions panel to get product-specific dosing recommendations.',
  },
  cover_ingredients_missing: {
    what: 'No ingredient list is available from this source.',
    action: 'Capture the Supplement Facts panel to unlock ingredient-level analysis.',
  },
};

const asSentence = (value: string): string => (/[^.!?]$/.test(value.trim()) ? `${value.trim()}.` : value.trim());

export const buildGapActionSentences = (
  reasons: string[] | undefined,
  module: GapModule,
): string[] => {
  const unique = Array.from(new Set((reasons ?? []).filter(Boolean)));
  if (!unique.length) {
    if (module === 'overview') {
      return ['This section is based on the current verified record.', 'Add clearer label evidence to expand product-level detail.'];
    }
    if (module === 'science') {
      return ['Science signals are assembled from verified facts and reviewed dataset evidence.', 'If form or dose is missing, the module will stay conservative rather than infer unsupported claims.'];
    }
    return ['This section uses available evidence conservatively.', 'You can improve precision by adding label-grade data (Directions, Warnings, Supplement Facts).'];
  }

  const lines: string[] = [];
  unique.slice(0, 2).forEach((reason) => {
    const copy = GAP_REASON_COPY[reason];
    if (!copy) return;
    lines.push(asSentence(copy.what));
    lines.push(asSentence(copy.action));
  });

  if (lines.length < 2) {
    lines.push('Some expected fields are not available in this source.');
    lines.push('Use clearer scan evidence to improve product-specific guidance.');
  }

  return lines;
};
