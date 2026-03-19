import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { useAuth } from '@/contexts/AuthContext';
import { useDailyCheckIns } from '@/contexts/DailyCheckInContext';
import { useOnboarding } from '@/contexts/OnboardingContext';
import { useSavedSupplements } from '@/contexts/SavedSupplementsContext';
import {
  apiClient,
  type EnsureOverviewFacts,
  type EnsureOverviewResponse,
} from '@/lib/api-client';
import {
  buildCheckInSeries,
  getCurrentPerfectStreakDays,
  hasAnyCompletedCheckInDay,
} from '@/lib/check-in-adherence';
import { getLocalDateKey } from '@/lib/check-ins';
import { evaluateEligibilityPolicy } from '@/lib/personalization/core/eligibilityPolicy';
import {
  scoreProductGoalMatches,
  type ProductIngredientLikeInput,
} from '@/lib/personalization/core/goalMatchScoring';
import { compilePersonalizationSnapshot } from '@/lib/personalization/core/personalizationCompiler';
import {
  loadFeedbackState,
  recordFeedbackEvents,
} from '@/lib/personalization/feedback/feedbackStore';
import {
  selectFirstStackPlan,
  selectHomePersonalization,
  selectPlanPreviewPersonalization,
  selectScheduleDefaultsPersonalization,
  selectSmartFilterPersonalization,
} from '@/lib/personalization/selectors';
import type {
  EligibilityDecision,
  ExplanationResult,
  ExplanationSurface,
  FeedbackState,
  GoalKey,
  OverrideEvent,
  PersonalizationSnapshot,
  ProductGoalMatch,
  SavedProductEvaluationInput,
  SmartFilterProductMembership,
  SupplementTypeKey,
} from '@/types/personalization';
import type { SavedSupplement } from '@/types/saved-supplements';

type PersonalizationContextValue = {
  loading: boolean;
  snapshot: PersonalizationSnapshot;
  feedbackState: FeedbackState;
  smartFilterEvaluationLoading: boolean;
  smartFilterMembershipById: Record<string, SmartFilterProductMembership>;
  firstStackPlan: ReturnType<typeof selectFirstStackPlan>;
  home: ReturnType<typeof selectHomePersonalization>;
  smartFilter: ReturnType<typeof selectSmartFilterPersonalization>;
  planPreview: ReturnType<typeof selectPlanPreviewPersonalization>;
  scheduleDefaults: ReturnType<typeof selectScheduleDefaultsPersonalization>;
  recordOverrideEvents: (events: OverrideEvent[]) => Promise<void>;
  explainSurface: (surface: ExplanationSurface) => Promise<ExplanationResult>;
};

const PersonalizationContext = createContext<PersonalizationContextValue | undefined>(undefined);

const DEFAULT_SNAPSHOT = compilePersonalizationSnapshot();

type CoverageStatus = 'full' | 'partial' | 'none';

type ProductEvaluationState = {
  loading: boolean;
  savedProducts: Record<string, SavedProductEvaluationInput>;
};

const EMPTY_PRODUCT_EVALUATIONS: ProductEvaluationState = {
  loading: false,
  savedProducts: {},
};

const normalizeActivity = (value?: string | null) => {
  const trimmed = value?.trim();
  return trimmed ? [trimmed] : undefined;
};

const normalizeLookupKey = (value?: string | null) =>
  value
    ?.trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .trim() ?? '';

const isUuid = (value: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

const getOverviewLookupSupplementId = (
  supplementId?: string | null,
  barcode?: string | null,
): string | null => {
  const normalizedBarcode = typeof barcode === 'string' ? barcode.trim() : '';
  if (normalizedBarcode) return null;
  return supplementId ?? null;
};

const parseAmountText = (value?: string | null): { amount: number | null; unit: string | null } => {
  const trimmed = value?.trim();
  if (!trimmed) return { amount: null, unit: null };
  const match = trimmed.match(/(-?\d[\d,]*(?:\.\d+)?)\s*(mcg|mg|g)\b/i);
  if (!match) return { amount: null, unit: null };

  const amount = Number.parseFloat(match[1].replace(/,/g, ''));
  if (!Number.isFinite(amount)) {
    return { amount: null, unit: null };
  }

  return {
    amount,
    unit: match[2].toLowerCase(),
  };
};

const pickFirstText = (...values: Array<string | null | undefined>) => {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }

  return undefined;
};

const deriveTypeKeysFromFacts = (facts: EnsureOverviewFacts): SupplementTypeKey[] => {
  const haystack = [
    facts.product.name,
    facts.product.brandDisplay,
    facts.overlay?.title,
    facts.overlay?.description,
    facts.overlay?.suggestedUse,
    ...(facts.actives ?? []).map((active) => active.name),
    ...(facts.overlay?.ingredients ?? []).map((ingredient) => ingredient.name),
  ]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .join(' ')
    .toLowerCase();

  const next = new Set<SupplementTypeKey>();

  if (/\b(probiotic|lactobacillus|bifidobacter|saccharomyces|prebiotic|cfu)\b/.test(haystack)) {
    next.add('probiotic');
  }
  if (/\b(protein|whey|casein|isolate|collagen|amino acid|bcaa|eaa)\b/.test(haystack)) {
    next.add('protein');
  }
  if (
    /\b(vitamin|ascorbic|cholecalciferol|ergocalciferol|tocopherol|retinol|folate|folic acid|cobalamin|niacin|thiamin|riboflavin|biotin|pantothenic)\b/.test(
      haystack,
    )
  ) {
    next.add('vitamin');
  }
  if (
    /\b(magnesium|zinc|calcium|iron|selenium|copper|chromium|potassium|iodine|manganese|electrolyte)\b/.test(
      haystack,
    )
  ) {
    next.add('mineral');
  }
  if (
    /\b(ashwagandha|rhodiola|turmeric|elderberry|bacopa|ginseng|garlic|maca|valerian|mushroom|lion'?s mane|reishi|cordyceps|botanical|herbal?)\b/.test(
      haystack,
    )
  ) {
    next.add('herb');
  }

  return Array.from(next);
};

const buildIngredientInputsFromFacts = (facts: EnsureOverviewFacts): ProductIngredientLikeInput[] => {
  const ingredientsByKey = new Map<string, ProductIngredientLikeInput>();

  for (const active of facts.actives ?? []) {
    const normalizedKey = normalizeLookupKey(active.name);
    if (!normalizedKey) continue;
    const fallbackAmount = parseAmountText(active.amountText);
    ingredientsByKey.set(normalizedKey, {
      ingredientLabel: active.name,
      name: active.name,
      amount: typeof active.amount === 'number' ? active.amount : fallbackAmount.amount,
      unit: active.unit ?? fallbackAmount.unit,
      disclosureQuality:
        typeof active.amount === 'number' || fallbackAmount.amount != null ? 'high' : 'medium',
    });
  }

  for (const ingredient of facts.overlay?.ingredients ?? []) {
    const normalizedKey = normalizeLookupKey(ingredient.name);
    if (!normalizedKey || ingredientsByKey.has(normalizedKey)) continue;
    const parsedDose = parseAmountText(ingredient.dose);
    ingredientsByKey.set(normalizedKey, {
      ingredientLabel: ingredient.name,
      name: ingredient.name,
      amount: parsedDose.amount,
      unit: parsedDose.unit,
      disclosureQuality: parsedDose.amount != null ? 'medium' : 'low',
    });
  }

  return Array.from(ingredientsByKey.values());
};

const hasCoverageReadyFacts = (facts: EnsureOverviewFacts | null | undefined, factsStatus?: CoverageStatus) => {
  if (!facts || factsStatus !== 'full') return false;
  const structuredIngredients = buildIngredientInputsFromFacts(facts);
  return structuredIngredients.some(
    (ingredient) => typeof ingredient.amount === 'number' && !!ingredient.unit && !!ingredient.name,
  );
};

const buildSavedProductEvaluation = (params: {
  item: SavedSupplement;
  ensured: EnsureOverviewResponse | null;
  visibleGoals: GoalKey[];
  duplicateRisk: PersonalizationSnapshot['profile']['observed']['duplicateRisk'];
  supplementExperience?: PersonalizationSnapshot['profile']['declared']['supplementExperience'];
  adherenceBlocker?: PersonalizationSnapshot['profile']['declared']['adherenceBlocker'];
  ageRange?: string;
}) => {
  const ensuredFacts = params.ensured?.facts ?? null;
  const factsStatus = params.ensured?.factsStatus ?? 'none';
  const coverageReady = hasCoverageReadyFacts(ensuredFacts, factsStatus);
  if (!coverageReady || !ensuredFacts || params.visibleGoals.length === 0) {
    return {
      savedProduct: {
        productId: params.item.id,
        factsStatus,
        display: {
          ...(pickFirstText(
            ensuredFacts?.product.name,
            ensuredFacts?.overlay?.title,
            params.item.productName,
          )
            ? {
                title: pickFirstText(
                  ensuredFacts?.product.name,
                  ensuredFacts?.overlay?.title,
                  params.item.productName,
                ),
              }
            : {}),
          ...(pickFirstText(
            ensuredFacts?.product.brandDisplay,
            ensuredFacts?.overlay?.brandName,
            params.item.brandName,
          )
            ? {
                brandName: pickFirstText(
                  ensuredFacts?.product.brandDisplay,
                  ensuredFacts?.overlay?.brandName,
                  params.item.brandName,
                ),
              }
            : {}),
          ...(pickFirstText(params.item.dosageText)
            ? {
                dosageText: pickFirstText(params.item.dosageText),
              }
            : {}),
          ...(pickFirstText(
            ensuredFacts?.overlay?.imageUrl,
            params.item.imageUrl,
          )
            ? {
                imageUrl: pickFirstText(
                  ensuredFacts?.overlay?.imageUrl,
                  params.item.imageUrl,
                ),
              }
            : {}),
        },
      } satisfies SavedProductEvaluationInput,
    };
  }

  const productGoalMatches = scoreProductGoalMatches({
    goals: params.visibleGoals,
    ingredients: buildIngredientInputsFromFacts(ensuredFacts),
    disclosureQuality: 'high',
    proprietaryBlendWithoutClearActives: false,
  });

  const eligibility = evaluateEligibilityPolicy({
    productGoalMatches,
    duplicateRisk: params.duplicateRisk,
    supplementExperience: params.supplementExperience,
    ageRange: params.ageRange ?? null,
    adherenceBlocker: params.adherenceBlocker,
    hasDietConstraintConflict: false,
    requiresGenericSafetyPath: false,
  });

  return {
    savedProduct: {
      productId: params.item.id,
      factsStatus,
      productGoalMatches,
      eligibility,
      display: {
        ...(pickFirstText(
          ensuredFacts.product.name,
          ensuredFacts.overlay?.title,
          params.item.productName,
        )
          ? {
              title: pickFirstText(
                ensuredFacts.product.name,
                ensuredFacts.overlay?.title,
                params.item.productName,
              ),
            }
          : {}),
        ...(pickFirstText(
          ensuredFacts.product.brandDisplay,
          ensuredFacts.overlay?.brandName,
          params.item.brandName,
        )
          ? {
              brandName: pickFirstText(
                ensuredFacts.product.brandDisplay,
                ensuredFacts.overlay?.brandName,
                params.item.brandName,
              ),
            }
          : {}),
        ...(pickFirstText(params.item.dosageText)
          ? {
              dosageText: pickFirstText(params.item.dosageText),
            }
          : {}),
        ...(pickFirstText(
          ensuredFacts.overlay?.imageUrl,
          params.item.imageUrl,
        )
          ? {
              imageUrl: pickFirstText(
                ensuredFacts.overlay?.imageUrl,
                params.item.imageUrl,
              ),
            }
          : {}),
      },
    } satisfies SavedProductEvaluationInput,
  };
};

const resolveConsistencyLevel = (score: number, hasObservedCheckIns: boolean) => {
  if (!hasObservedCheckIns) return 'unknown' as const;
  if (score >= 0.8) return 'high' as const;
  if (score >= 0.4) return 'medium' as const;
  return 'low' as const;
};

const buildObservedSignals = (
  savedSupplements: ReturnType<typeof useSavedSupplements>['savedSupplements'],
  checkInsByDate: ReturnType<typeof useDailyCheckIns>['checkInsByDate'],
) => {
  const todayKey = getLocalDateKey(new Date());
  const currentStreak = savedSupplements.length
    ? getCurrentPerfectStreakDays(savedSupplements, checkInsByDate, todayKey)
    : 0;
  const series = savedSupplements.length
    ? buildCheckInSeries(savedSupplements, checkInsByDate, todayKey, 7)
    : [];
  const scheduledDays = series.filter((day) => day.isScheduledDay);
  const perfectDays = scheduledDays.filter((day) => day.isPerfectDay).length;
  const hasObservedCheckIns = hasAnyCompletedCheckInDay(checkInsByDate);
  const adherenceScore =
    scheduledDays.length > 0 ? perfectDays / scheduledDays.length : hasObservedCheckIns ? 0 : -1;
  const missedPattern = (() => {
    const missed = scheduledDays.filter((day) => !day.isPerfectDay);
    if (missed.length === 0) return undefined;
    const weekendMisses = missed.filter((day) => {
      const date = new Date(`${day.dateKey}T12:00:00`);
      const weekday = date.getDay();
      return weekday === 0 || weekday === 6;
    }).length;
    if (weekendMisses === missed.length) return 'weekends';
    if (weekendMisses === 0) return 'weekdays';
    return 'mixed';
  })();

  const duplicateRiskLevel =
    savedSupplements.length >= 8
      ? ('high' as const)
      : savedSupplements.length >= 4
        ? ('medium' as const)
        : ('none' as const);

  return {
    currentStreak,
    consistencyLevel: resolveConsistencyLevel(adherenceScore, hasObservedCheckIns),
    missedPattern,
    savedStackCount: savedSupplements.length,
    duplicateRiskLevel,
    duplicateIngredientKeys: [],
  };
};

export const PersonalizationProvider = ({ children }: { children: React.ReactNode }) => {
  const { user } = useAuth();
  const { draft, loading: onboardingLoading } = useOnboarding();
  const { savedSupplements, loading: savedLoading } = useSavedSupplements();
  const { checkInsByDate, loading: checkInLoading } = useDailyCheckIns();
  const [feedbackState, setFeedbackState] = useState<FeedbackState>({
    version: 'personalization-feedback/v1',
    updatedAt: new Date().toISOString(),
    events: [],
    overrides: {},
    dismissals: {},
  });
  const [feedbackLoading, setFeedbackLoading] = useState(true);
  const [productEvaluations, setProductEvaluations] =
    useState<ProductEvaluationState>(EMPTY_PRODUCT_EVALUATIONS);
  const ensureOverviewCacheRef = useRef(new Map<string, Promise<EnsureOverviewResponse | null>>());

  useEffect(() => {
    let active = true;
    setFeedbackLoading(true);
    void loadFeedbackState(user?.id)
      .then((state) => {
        if (!active) return;
        setFeedbackState(state);
      })
      .catch((error) => {
        console.warn('[personalization] Failed to load feedback state', error);
      })
      .finally(() => {
        if (active) {
          setFeedbackLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [user?.id]);

  const observedSignals = useMemo(
    () => buildObservedSignals(savedSupplements, checkInsByDate),
    [checkInsByDate, savedSupplements],
  );

  const profileInput = useMemo(
    () => ({
      draft,
      observed: observedSignals,
      declared: {
        activity: normalizeActivity(draft?.activity),
      },
    }),
    [draft, observedSignals],
  );

  const baseSnapshot = useMemo(
    () =>
      compilePersonalizationSnapshot({
        profileInput,
        feedbackState,
      }),
    [feedbackState, profileInput],
  );

  const fetchEnsureOverviewForSavedSupplement = useCallback(
    async (item: SavedSupplement) => {
      const cacheKey = [
        item.id,
        item.supplementId ?? '',
        item.barcode ?? '',
        item.updatedAt,
        item.productName,
        item.brandName,
        item.dosageText,
      ].join('|');

      const cached = ensureOverviewCacheRef.current.get(cacheKey);
      if (cached) {
        return cached;
      }

      const promise = apiClient
        .ensureOverview({
          supplementId: getOverviewLookupSupplementId(item.supplementId, item.barcode),
          barcode: item.barcode ?? null,
          brandName: item.brandName ?? null,
          productName: item.productName,
          dosageText: item.dosageText ?? null,
          userSupplementId: isUuid(item.id) ? item.id : null,
        })
        .catch((error) => {
          console.warn('[personalization] ensureOverview failed for saved supplement', {
            message: error instanceof Error ? error.message : 'Unknown error',
            savedSupplementId: item.id,
          });
          return null;
        });

      ensureOverviewCacheRef.current.set(cacheKey, promise);
      return promise;
    },
    [],
  );

  useEffect(() => {
    let active = true;

    const visibleGoals = baseSnapshot.surfaces.smartFilter.visibleGoals;
    if (savedSupplements.length === 0 || visibleGoals.length === 0) {
      setProductEvaluations((prev) =>
        prev.loading ||
        Object.keys(prev.savedProducts).length > 0
          ? EMPTY_PRODUCT_EVALUATIONS
          : prev,
      );
      return () => {
        active = false;
      };
    }

    setProductEvaluations((prev) => ({ ...prev, loading: true }));

    void Promise.all(
      savedSupplements.map(async (item) => {
        const ensured = await fetchEnsureOverviewForSavedSupplement(item);
        return buildSavedProductEvaluation({
          item,
          ensured,
          visibleGoals,
          duplicateRisk: baseSnapshot.profile.observed.duplicateRisk,
          supplementExperience: baseSnapshot.profile.declared.supplementExperience,
          adherenceBlocker: baseSnapshot.profile.declared.adherenceBlocker,
          ageRange: baseSnapshot.profile.declared.ageRange,
        });
      }),
    )
      .then((results) => {
        if (!active) return;
        const nextSavedProducts: Record<string, SavedProductEvaluationInput> = {};

        savedSupplements.forEach((item, index) => {
          const evaluation = results[index];
          if (!evaluation) return;
          nextSavedProducts[item.id] = evaluation.savedProduct;
        });

        setProductEvaluations({
          loading: false,
          savedProducts: nextSavedProducts,
        });
      })
      .catch((error) => {
        if (!active) return;
        console.warn('[personalization] saved-product evaluation loop failed', error);
        setProductEvaluations((prev) => ({
          ...prev,
          loading: false,
        }));
      });

    return () => {
      active = false;
    };
  }, [
    baseSnapshot.profile.declared.adherenceBlocker,
    baseSnapshot.profile.declared.ageRange,
    baseSnapshot.profile.declared.supplementExperience,
    baseSnapshot.profile.observed.duplicateRisk,
    baseSnapshot.surfaces.smartFilter.visibleGoals,
    fetchEnsureOverviewForSavedSupplement,
    savedSupplements,
  ]);

  const snapshot = useMemo(
    () =>
      compilePersonalizationSnapshot({
        profile: baseSnapshot.profile,
        feedbackState,
        evaluations: {
          savedProducts: productEvaluations.savedProducts,
        },
      }),
    [baseSnapshot.profile, feedbackState, productEvaluations.savedProducts],
  );

  const recordOverrideEvents = useCallback(
    async (events: OverrideEvent[]) => {
      const next = await recordFeedbackEvents(user?.id, events);
      setFeedbackState(next);
    },
    [user?.id],
  );

  const explainSurface = useCallback(
    async (surface: ExplanationSurface) => {
      const response = await apiClient.explainPersonalization({
        snapshot,
        surface,
      });

      return response.result;
    },
    [snapshot],
  );

  const firstStackPlan = useMemo(() => selectFirstStackPlan(snapshot), [snapshot]);
  const home = useMemo(() => selectHomePersonalization(snapshot), [snapshot]);
  const smartFilter = useMemo(() => selectSmartFilterPersonalization(snapshot), [snapshot]);
  const planPreview = useMemo(() => selectPlanPreviewPersonalization(snapshot), [snapshot]);
  const scheduleDefaults = useMemo(() => selectScheduleDefaultsPersonalization(snapshot), [snapshot]);

  const value = useMemo<PersonalizationContextValue>(
    () => ({
      loading: onboardingLoading || savedLoading || checkInLoading || feedbackLoading,
      snapshot,
      feedbackState,
      smartFilterEvaluationLoading: productEvaluations.loading,
      smartFilterMembershipById: snapshot.surfaces.smartFilter.productMembershipById ?? {},
      firstStackPlan,
      home,
      smartFilter,
      planPreview,
      scheduleDefaults,
      recordOverrideEvents,
      explainSurface,
    }),
    [
      checkInLoading,
      explainSurface,
      feedbackLoading,
      feedbackState,
      firstStackPlan,
      home,
      onboardingLoading,
      planPreview,
      productEvaluations.loading,
      recordOverrideEvents,
      savedLoading,
      scheduleDefaults,
      smartFilter,
      snapshot,
    ],
  );

  return (
    <PersonalizationContext.Provider value={value}>
      {children}
    </PersonalizationContext.Provider>
  );
};

export const usePersonalization = () => {
  const context = useContext(PersonalizationContext);
  if (!context) {
    throw new Error('usePersonalization must be used within a PersonalizationProvider');
  }
  return context;
};

export const personalizationContextInternals = {
  buildObservedSignals,
  buildSavedProductEvaluation,
  buildIngredientInputsFromFacts,
  deriveTypeKeysFromFacts,
  hasCoverageReadyFacts,
  DEFAULT_SNAPSHOT,
  resolveConsistencyLevel,
};
