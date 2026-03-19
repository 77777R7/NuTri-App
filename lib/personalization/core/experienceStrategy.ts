import type { DecisionReason, ExperienceMode, PersonalizationProfile } from '@/types/personalization';
import { REASON_CODES, RULE_IDS, buildReason } from './reasonCodes';

export type CompiledExperienceMode = {
  mode: ExperienceMode;
  reasons: DecisionReason[];
};

const DEFAULT_EXPERIENCE_MODE: ExperienceMode = {
  explanationDepth: 'guided',
  uiDensity: 'standard',
  showAdvancedSafety: false,
  showDetailedForms: false,
};

export const compileExperienceMode = (
  profile: PersonalizationProfile,
): CompiledExperienceMode => {
  let mode = { ...DEFAULT_EXPERIENCE_MODE };
  let reasonCode: DecisionReason['code'] = REASON_CODES.experienceDefault;
  let ruleId: DecisionReason['ruleId'] = RULE_IDS.experienceDefault;
  let source: DecisionReason['source'] = 'derived';

  if (profile.declared.supplementExperience === 'brand_new') {
    mode = {
      explanationDepth: 'simple',
      uiDensity: 'minimal',
      showAdvancedSafety: false,
      showDetailedForms: false,
    };
    reasonCode = REASON_CODES.experienceModeSelected;
    ruleId = RULE_IDS.experienceModeSelected;
    source = 'declared';
  } else if (profile.declared.supplementExperience === 'tried_a_few') {
    mode = { ...DEFAULT_EXPERIENCE_MODE };
    reasonCode = REASON_CODES.experienceModeSelected;
    ruleId = RULE_IDS.experienceModeSelected;
    source = 'declared';
  } else if (profile.declared.supplementExperience === 'regular_user') {
    mode = {
      explanationDepth: 'guided',
      uiDensity: 'standard',
      showAdvancedSafety: true,
      showDetailedForms: false,
    };
    reasonCode = REASON_CODES.experienceModeSelected;
    ruleId = RULE_IDS.experienceModeSelected;
    source = 'declared';
  } else if (
    profile.declared.supplementExperience === 'structured_stack'
  ) {
    mode = {
      explanationDepth: 'advanced',
      uiDensity: 'advanced',
      showAdvancedSafety: true,
      showDetailedForms: true,
    };
    reasonCode = REASON_CODES.experienceModeSelected;
    ruleId = RULE_IDS.experienceModeSelected;
    source = 'declared';
  } else if (profile.observed.savedStackCount >= 4) {
    mode = {
      explanationDepth: 'advanced',
      uiDensity: 'advanced',
      showAdvancedSafety: true,
      showDetailedForms: true,
    };
    reasonCode = REASON_CODES.experienceObservedStack;
    ruleId = RULE_IDS.experienceObservedStack;
    source = 'observed';
  }

  return {
    mode,
    reasons: [
      buildReason(reasonCode, ruleId, source, {
        explanationDepth: mode.explanationDepth,
        uiDensity: mode.uiDensity,
      }),
    ],
  };
};

export const experienceStrategyInternals = {
  DEFAULT_EXPERIENCE_MODE,
};
