import { BlurView } from "expo-blur";
import { router } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  Check,
  Clock,
  Edit2,
  Lock,
  Maximize2,
  Moon,
  NotebookPen,
  Search,
  StickyNote,
  Sun,
  X,
} from "lucide-react-native";
import { AnimatePresence, MotiView } from "moti";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Keyboard,
  Dimensions,
  KeyboardAvoidingView,
  Linking,
  Modal,
  NativeSyntheticEvent,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TextLayoutEventData,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Easing } from "react-native-reanimated";

import { AutoFitText } from "@/components/common/AutoFitText";
import { CalendarStrip } from "@/components/ui/calendar-strip";
import { DuplicateIngredientGroupCard } from "@/components/screens/mySaved/DuplicateIngredientGroupCard";
import { SavedStackSafetySummary } from "@/components/screens/mySaved/SavedStackSafetySummary";
import { CompareSheet } from "@/components/screens/my-supplement/CompareSheet";
import { GoalFitScorecard } from "@/components/screens/my-supplement/GoalFitScorecard";
import { MySavedSmartFilterPanel } from "@/components/screens/my-supplement/MySavedSmartFilterPanel";
import type {
  StackDuplicateGroup,
  StackLevelSafetySummary,
  StackSafetyMeta,
} from "@/components/screens/mySaved/types";
import { Config } from "@/constants/Config";
import { useAuth } from "@/contexts/AuthContext";
import { usePersonalization } from "@/contexts/PersonalizationContext";
import { useScanHistory } from "@/contexts/ScanHistoryContext";
import { useSavedSupplements } from "@/contexts/SavedSupplementsContext";
import { usePremiumAccess } from "@/hooks/usePremiumAccess";
import { useScreenTokens } from "@/hooks/useScreenTokens";
import {
  trackEvaluatedLoopClick,
  trackEvaluatedLoopConversion,
  trackEvaluatedLoopExposure,
  trackEvaluatedLoopSave,
} from "@/lib/analytics/evaluated-loop";
import { trackOnboardingEvent } from "@/lib/analytics/onboarding";
import { emitAnalyticsEvent } from "@/lib/analytics/transport";
import { withAuthHeaders } from "@/lib/auth-token";
import { getLocalDateKey } from "@/lib/check-ins";
import {
  buildScheduleDefaultsSummary,
  getAllGoalDisplayLabels,
  getAllSupplementTypeDisplayLabels,
  getGoalDisplayLabel,
  getReminderPriorityLabel,
  getSupplementTypeDisplayLabel,
  getTimingAnchorDisplayLabel,
} from "@/lib/personalization/uiLabels";
import { PERSONALIZATION_RESEARCH_UI_ENABLED } from "@/lib/personalization/researchFlags";
import {
  buildGoalTagToKeyMap,
  buildTypeTagToKeyMap,
  filterSupplementsByActiveTags,
  getMembershipMatchTier,
  getMembershipReasonCodes,
  isEvaluatedCoverageReadyMembership,
  matchesEvaluatedSmartFilterTag,
} from "@/lib/personalization/smartFilterMatching";
import { buildGoalCompareEntries } from "@/lib/personalization/core/compareModel";
import { buildGoalFitCard } from "@/lib/personalization/core/goalFitCardBuilder";
import { resolveRoutineTimeUserSet } from "@/lib/routineIntent";
import {
  loadMealTimePrefs,
  updateMealTimePrefSlot,
  type MealTimePrefs,
} from "@/lib/storage/meal-time-prefs";
import { buildSuggestedRoutineV0, type SuggestedRoutineSlot } from "@/lib/suggestedRoutine";
import { buildWhatsInsideDisplay, collectDisplayableFactDoses } from "@/lib/supplementFactsDisplay";
import { formatBrandForPill, formatDoseForPill } from "@/lib/supplementDisplay";
import { supabase } from "@/lib/supabase";
import { buildTimingSuggestion } from "@/lib/timingSuggestion";
import { getOdsFactForSupplement } from "@/lib/knowledge/ods-factpack";
import { getNonOdsFactForSupplement } from "@/lib/knowledge/non-ods-factpack";
import { SAFE_OVERVIEW_PLACEHOLDER, isMeaningfulOverviewText } from "@/lib/knowledge/what-it-does";
import {
  buildApplyCopy,
  buildAutosyncPatch,
  buildScheduleHintText,
  isAnchorSlotActive,
  shouldRunAnchorAutosync,
  shouldShowSuggestedPlanCard,
  shouldShowScheduleTimeCategoryPill,
} from "@/lib/schedulePresentation";
import type { RoutineDayOfWeek, RoutinePreferences, SavedSupplement } from "@/types/saved-supplements";
import type {
  GoalKey,
  GoalCompareEntry,
  OverrideEvent,
  ScheduleDefaultsPersonalizationVM,
  SavedProductEvaluation,
  SmartFilterProductMembership,
  SupplementTypeKey,
} from "@/types/personalization";

type Props = {
  data: SavedSupplement[];
  onDeleteSelected?: (ids: string[]) => void | Promise<void>;
  onSaveRoutine?: (id: string, prefs: RoutinePreferences) => void | Promise<void>;
  onAddSupplement?: () => void;
};

type Theme = {
  key: string;
  bgHex: string;
  textColor: string;
  tagBorderColor: string;
  arrowBg: string;
  arrowColor: string;
  icon: "sun" | "moon";
  glassTint: string;
};

type TagCategory = {
  title: string;
  color: { bg: string; text: string; border: string };
  activeColor: { bg: string; text: string; border: string };
  tags: string[];
};

type FilterState = "closed" | "opening" | "open" | "closing";

type BatchScheduleUpdate = {
  startDate?: string;
  daysOfWeek?: RoutineDayOfWeek[];
  time?: string;
  withFood?: boolean;
};

type SmartFilterEvaluatedDetailAnalyticsContext = {
  productId: string;
  activeTags: string[];
  filteredCount: number;
  searchQuery: string;
  membership: SmartFilterProductMembership;
};

const ROUTINE_DAY_OPTIONS: Array<{ value: RoutineDayOfWeek; label: string; summaryLabel: string }> = [
  { value: 0, label: "S", summaryLabel: "Sunday" },
  { value: 1, label: "M", summaryLabel: "Monday" },
  { value: 2, label: "T", summaryLabel: "Tuesday" },
  { value: 3, label: "W", summaryLabel: "Wednesday" },
  { value: 4, label: "T", summaryLabel: "Thursday" },
  { value: 5, label: "F", summaryLabel: "Friday" },
  { value: 6, label: "S", summaryLabel: "Saturday" },
];

const getSuggestedSlotKey = (slot: Pick<SuggestedRoutineSlot, "label" | "time">) => `${slot.label}:${slot.time}`;

const formatRoutineDaySummary = (labels: string[]) => {
  if (labels.length === 0) return "Every day";
  if (labels.length === 1) return labels[0];
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  return `${labels.slice(0, -1).join(", ")}, and ${labels[labels.length - 1]}`;
};

const normalizeRoutineDays = (days: RoutineDayOfWeek[] | undefined) =>
  Array.from(new Set(days ?? [])).sort((left, right) => left - right);

const areRoutineDaysEqual = (
  left: RoutineDayOfWeek[] | undefined,
  right: RoutineDayOfWeek[] | undefined,
) => {
  const normalizedLeft = normalizeRoutineDays(left);
  const normalizedRight = normalizeRoutineDays(right);
  if (normalizedLeft.length !== normalizedRight.length) return false;
  return normalizedLeft.every((value, index) => value === normalizedRight[index]);
};

const parseLocalDateKey = (value: string | undefined | null) => {
  if (!value) return null;
  const [yearText, monthText, dayText] = value.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
  return new Date(year, month - 1, day, 12, 0, 0, 0);
};

const shiftLocalDateKey = (value: string, offsetDays: number) => {
  const parsed = parseLocalDateKey(value);
  if (!parsed) return value;
  parsed.setDate(parsed.getDate() + offsetDays);
  return getLocalDateKey(parsed);
};

const resolveRoutineStartDate = (routineStartDate: string | undefined, createdAt: string) =>
  routineStartDate ?? getLocalDateKey(new Date(createdAt));

const formatRoutineStartDateLabel = (value: string, todayKey: string) => {
  if (value === todayKey) return "Today";
  const tomorrowKey = shiftLocalDateKey(todayKey, 1);
  if (value === tomorrowKey) return "Tomorrow";
  const parsed = parseLocalDateKey(value);
  if (!parsed) return value;
  return parsed.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
};

const formatRoutineWeekRangeLabel = (value: string) => {
  const parsed = parseLocalDateKey(value);
  if (!parsed) return "";
  const start = new Date(parsed);
  start.setDate(parsed.getDate() - parsed.getDay());
  const end = new Date(start);
  end.setDate(start.getDate() + 6);

  const sameMonth = start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear();
  if (sameMonth) {
    return `${start.toLocaleDateString(undefined, { month: "short" })} ${start.getDate()}-${end.getDate()}, ${end.getFullYear()}`;
  }

  const sameYear = start.getFullYear() === end.getFullYear();
  if (sameYear) {
    return `${start.toLocaleDateString(undefined, { month: "short" })} ${start.getDate()} - ${end.toLocaleDateString(undefined, { month: "short" })} ${end.getDate()}, ${end.getFullYear()}`;
  }

  return `${start.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })} - ${end.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`;
};

const SUGGESTED_PLAN_HIGHLIGHT_PATTERN =
  /(\b\d+(?:-\d+)?\s+(?:veggie\s+|softgel\s+|gummy\s+|tablet\s+|capsule\s+)?(?:capsule|capsules|tablet|tablets|softgel|softgels|gummy|gummies|packet|packets|scoop|scoops|drop|drops)\b|\b\d+(?:-\d+)?\s+times daily\b|\bwith or without food\b|\bwith food\b|\bwithout food\b)/gi;

const renderHighlightedSuggestedText = (text: string) => {
  const parts = text.split(SUGGESTED_PLAN_HIGHLIGHT_PATTERN);
  return parts.map((part, index) => {
    if (!part) return null;
    const shouldHighlight = SUGGESTED_PLAN_HIGHLIGHT_PATTERN.test(part);
    SUGGESTED_PLAN_HIGHLIGHT_PATTERN.lastIndex = 0;

    return (
      <Text
        key={`suggested-part-${index}`}
        style={shouldHighlight ? styles.suggestedRoutineHighlightText : undefined}
      >
        {part}
      </Text>
    );
  });
};

type AnalysisUsage = {
  summary?: string | null;
  timing?: string | null;
  withFood?: boolean | null;
  withFoodReason?: string | null;
  frequency?: string | null;
  dosage?: string | null;
};

type AnalysisEfficacy = {
  overviewSummary?: string | null;
  overallAssessment?: string | null;
  verdict?: string | null;
  coreBenefits?: string[] | null;
};

type MySupplementOverviewV2 = {
  oneLiner?: string | null;
  whatItIs?: string | null;
  tips?: string[] | null;
  whatYouMayNotice?: string[] | null;
  watchOuts?: string[] | null;
  meta?: {
    promptVersion?: string | null;
    factsDigestHash?: string | null;
    factsSourceVersion?: string | null;
    generatedAt?: string | null;
    model?: string | null;
  } | null;
};

type AnalysisPayload = {
  efficacy?: AnalysisEfficacy | null;
  usage?: AnalysisUsage | null;
  usagePayload?: { usage?: AnalysisUsage | null } | null;
  mySupplementOverviewV2?: MySupplementOverviewV2 | null;
  analysis?: {
    efficacy?: AnalysisEfficacy | null;
    usage?: AnalysisUsage | null;
    usagePayload?: { usage?: AnalysisUsage | null } | null;
    mySupplementOverviewV2?: MySupplementOverviewV2 | null;
  } | null;
};

const THEMES: Theme[] = [
  {
    key: "deep-blue",
    bgHex: "#1e40af",
    textColor: "#ffffff",
    tagBorderColor: "rgba(255,255,255,0.30)",
    arrowBg: "#000000",
    arrowColor: "#ffffff",
    icon: "moon",
    glassTint: "rgba(147,197,253,0.42)",
  },
  {
    key: "yellow",
    bgHex: "#FACC15",
    textColor: "#0f172a",
    tagBorderColor: "rgba(15,23,42,0.30)",
    arrowBg: "#000000",
    arrowColor: "#ffffff",
    icon: "sun",
    glassTint: "rgba(250,204,21,0.32)",
  },
  {
    key: "beige",
    bgHex: "#EFE2C8",
    textColor: "#0f172a",
    tagBorderColor: "rgba(15,23,42,0.30)",
    arrowBg: "#000000",
    arrowColor: "#ffffff",
    icon: "sun",
    glassTint: "rgba(216,196,153,0.42)",
  },
  {
    key: "sky",
    bgHex: "#93C5FD",
    textColor: "#0f172a",
    tagBorderColor: "rgba(15,23,42,0.30)",
    arrowBg: "#000000",
    arrowColor: "#ffffff",
    icon: "moon",
    glassTint: "rgba(147,197,253,0.52)",
  },
  {
    key: "lavender",
    bgHex: "#E0C3FC",
    textColor: "#0f172a",
    tagBorderColor: "rgba(15,23,42,0.30)",
    arrowBg: "#000000",
    arrowColor: "#ffffff",
    icon: "moon",
    glassTint: "rgba(224,195,252,0.50)",
  },
];

const SMART_TAG_BASE_CATEGORIES: TagCategory[] = [
  {
    title: "Activity",
    color: { bg: "#f0fdfa", text: "#0f766e", border: "#ccfbf1" },
    activeColor: {
      bg: "rgba(20,184,166,0.15)",
      text: "#0f766e",
      border: "rgba(94,234,212,0.6)",
    },
    tags: ["Recently Viewed"],
  },
  {
    title: "Goals",
    color: { bg: "#eff6ff", text: "#1d4ed8", border: "#dbeafe" },
    activeColor: {
      bg: "rgba(59,130,246,0.15)",
      text: "#1d4ed8",
      border: "rgba(147,197,253,0.6)",
    },
    tags: getAllGoalDisplayLabels(),
  },
  {
    title: "Type",
    color: { bg: "#faf5ff", text: "#6b21a8", border: "#f3e8ff" },
    activeColor: {
      bg: "rgba(168,85,247,0.15)",
      text: "#6b21a8",
      border: "rgba(216,180,254,0.6)",
    },
    tags: getAllSupplementTypeDisplayLabels(),
  },
  {
    title: "Timing",
    color: { bg: "#fffbeb", text: "#b45309", border: "#fef3c7" },
    activeColor: {
      bg: "rgba(245,158,11,0.15)",
      text: "#92400e",
      border: "rgba(253,230,138,0.6)",
    },
    tags: ["Morning", "Pre-workout", "With Meal", "Bedtime"],
  },
];

const SMART_TAG_SET = new Set(SMART_TAG_BASE_CATEGORIES.flatMap((category) => category.tags));

const SCREEN_BG = "#F2F3F7";
const NAV_HEIGHT = 64;
const SCREEN_TITLE_FONT = Platform.select({
  ios: "Georgia",
  android: "serif",
  default: "serif",
});

const FILTER_COLLAPSED_SIZE = 54;
const FILTER_EXPANDED_HEIGHT = 520;
const FILTER_WIDTH_DURATION = 400;
const FILTER_HEIGHT_DURATION = 400;
// Match the web timing/feel (fade durations)
const FILTER_EASING = Easing.bezier(0.32, 0.72, 0, 1);
const BACKDROP_SHOW_DELAY = 150;
const BACKDROP_FADE_IN_DURATION = 500;
const BACKDROP_FADE_OUT_DURATION = 300;

const ITEM_HEIGHT = 40;
const VISIBLE_ITEMS = 3;

const isoDesc = (a: string, b: string) => b.localeCompare(a);

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

const normalizeKey = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .trim();

const STOP_WORDS = new Set([
  "extra",
  "strength",
  "triple",
  "double",
  "maximum",
  "max",
  "ultra",
  "advanced",
  "support",
  "formula",
  "complex",
  "with",
  "and",
  "plus",
  "daily",
  "professional",
  "high",
  "potency",
  "premium",
  "rapid",
  "release",
  "extended",
  "time",
  "capsule",
  "capsules",
  "caps",
  "softgel",
  "softgels",
  "tablet",
  "tablets",
  "tabs",
  "gummy",
  "gummies",
  "chewable",
  "chews",
  "liquid",
  "drops",
  "drop",
  "spray",
  "powder",
  "gel",
  "gels",
  "serving",
  "servings",
  "count",
  "ct",
  "mg",
  "mcg",
  "g",
  "iu",
  "ml",
  "oz",
  "fl",
  "fluid",
]);

const titleToken = (token: string) =>
  token.length > 1 ? token[0].toUpperCase() + token.slice(1) : token.toUpperCase();

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const pickFirstText = (...values: Array<string | null | undefined>) => {
  for (const value of values) {
    if (isNonEmptyString(value)) return value.trim();
  }
  return "";
};

const formatSentence = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return "";
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
};

const formatRetryAfterLabel = (seconds: number): string | null => {
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  if (seconds < 3600) {
    const mins = Math.max(1, Math.ceil(seconds / 60));
    return `~${mins}m`;
  }
  const hours = Math.max(1, Math.ceil(seconds / 3600));
  return `~${hours}h`;
};

const CALORIE_DOSE_REGEX = /\bcal(?:ories)?\b/i;

const formatSavedDoseForDisplay = (raw?: string | null): string | null => {
  const formatted = formatDoseForPill(raw);
  if (!formatted) return null;
  return CALORIE_DOSE_REGEX.test(formatted) ? null : formatted;
};

const computeFactsStatusClient = (facts: MySupplementFactsV1 | null | undefined): "full" | "partial" | "none" => {
  if (!facts) return "none";
  const hasActiveDose = (facts.actives ?? []).some((active) => {
    const amountText = typeof active?.amountText === "string" ? active.amountText.trim() : "";
    if (amountText) return true;
    if (active?.amount != null && typeof active?.unit === "string" && active.unit.trim()) return true;
    return false;
  });
  const hasDirections = typeof facts.directions?.rawText === "string" && facts.directions.rawText.trim().length > 0;
  const hasOverlayIngredients = Array.isArray(facts.overlay?.ingredients) && facts.overlay.ingredients.length > 0;
  const hasOverlaySuggestedUse =
    typeof facts.overlay?.suggestedUse === "string" && facts.overlay.suggestedUse.trim().length > 0;
  return hasActiveDose || hasDirections || hasOverlayIngredients || hasOverlaySuggestedUse ? "full" : "partial";
};

const hasOverlayBackedFacts = (facts: MySupplementFactsV1 | null | undefined): boolean => {
  if (!facts) return false;
  const hasOverlayIngredients = Array.isArray(facts.overlay?.ingredients) && facts.overlay.ingredients.length > 0;
  const hasOverlaySuggestedUse =
    typeof facts.overlay?.suggestedUse === "string" && facts.overlay.suggestedUse.trim().length > 0;
  return hasOverlayIngredients || hasOverlaySuggestedUse;
};

const computeOverviewFactsStatus = (
  facts: MySupplementFactsV1 | null | undefined,
  barcode?: string | null,
): "full" | "partial" | "none" => {
  const baseStatus = computeFactsStatusClient(facts);
  if (baseStatus === "none") return "none";
  if (!(barcode?.trim())) return baseStatus;
  return hasOverlayBackedFacts(facts) ? baseStatus : "partial";
};

const extractFactsDigestHashFromAnalysisPayload = (payload: AnalysisPayload | null): string | null => {
  if (!payload || typeof payload !== "object") return null;
  const root = payload as any;
  const rootHash =
    typeof root?.mySupplementOverviewV2?.meta?.factsDigestHash === "string" ? root.mySupplementOverviewV2.meta.factsDigestHash : null;
  if (rootHash) return rootHash;
  const nestedHash =
    typeof root?.analysis?.mySupplementOverviewV2?.meta?.factsDigestHash === "string"
      ? root.analysis.mySupplementOverviewV2.meta.factsDigestHash
      : null;
  return nestedHash ?? null;
};

const isUuid = (value: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

const normalizeTwoSentenceSummary = (value: string) => {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  const matches = normalized.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [];
  const firstRaw = (matches[0] ?? normalized).trim();
  const secondRaw = (matches[1] ?? "Follow the product label for dosing and timing.").trim();
  const first = /[.!?]$/.test(firstRaw) ? firstRaw : `${firstRaw}.`;
  const second = /[.!?]$/.test(secondRaw) ? secondRaw : `${secondRaw}.`;
  return `${first} ${second}`;
};

const OVERLAY_DESCRIPTION_SKIP_REGEX =
  /^(gluten free|non-gmo\b|dietary supplement\b|quality matters\b|igen\b|ifos\b|third party tested\b|cgmp compliant\b|non bpa\b|single source\b|\d+\s*(mg|mcg|g|iu|softgels?|capsules?|tablets?)\b)/i;

const normalizeOverlayDescriptionText = (value: string | null | undefined): string =>
  pickFirstText(value)
    .replace(/\u00a0/g, " ")
    .replace(/[®™]/g, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([.!?])(?=[A-Za-z0-9])/g, "$1 ")
    .replace(/([,:;])(?=[A-Za-z0-9])/g, "$1 ")
    .replace(/\s+/g, " ")
    .trim();

const extractOverlayNarrative = (value: string | null | undefined): string => {
  const normalized = normalizeOverlayDescriptionText(value);
  if (!normalized) return "";
  const narrativeMatch = normalized.match(
    /\b(Our\b.*|This\b.*|Looking for\b.*|Fight free radicals\b.*|[A-Z][A-Za-z0-9&+/-]*(?:\s+[A-Z][A-Za-z0-9&+/-]*){0,7}\s+(?:is|are|provides|provide|delivers|deliver|combines|combine|includes|include|helps|help|supports|support|promotes|promote|features|feature)\b.*)/i,
  );
  return narrativeMatch ? narrativeMatch[1].trim() : normalized;
};

const buildOverlayOverviewSupport = (value: string | null | undefined): { summary: string; bullets: string[] } => {
  const narrative = extractOverlayNarrative(value);
  if (!narrative) return { summary: "", bullets: [] };

  const sentences = (narrative.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [narrative])
    .map((sentence) => formatSentence(sentence))
    .filter((sentence) => sentence.length >= 42)
    .filter((sentence) => !OVERLAY_DESCRIPTION_SKIP_REGEX.test(sentence));

  if (sentences.length === 0) {
    return { summary: "", bullets: [] };
  }

  return {
    summary: sentences.slice(0, 2).join(" "),
    bullets: sentences.slice(2, 5),
  };
};

const pickOverviewTextCandidate = (params: {
  productName: string;
  candidates: Array<{ source: "ods" | "curated" | "overlay" | "ai" | "efficacy" | "benefit" | "fallback"; text: string }>;
}): {
  text: string;
  source: "ods" | "curated" | "overlay" | "ai" | "efficacy" | "benefit" | "fallback" | "placeholder";
  usedPlaceholder: boolean;
} => {
  for (const candidate of params.candidates) {
    if (!isMeaningfulOverviewText(candidate.text, params.productName)) continue;
    return {
      text: candidate.text.trim(),
      source: candidate.source,
      usedPlaceholder: false,
    };
  }

  return {
    text: SAFE_OVERVIEW_PLACEHOLDER,
    source: "placeholder",
    usedPlaceholder: true,
  };
};

const buildLocalOverviewFallback = (params: { productName: string; dosageText?: string | null }) => {
  const name = params.productName.toLowerCase();
  const has = (tokens: string[]) => tokens.some((token) => name.includes(token));

  let timing = "Anytime (with meals)";
  let withFood = true;
  let benefitPhrase = "general wellness";

  if (has(["melatonin"])) {
    timing = "Bedtime (30–60 min before sleep)";
    withFood = false;
    benefitPhrase = "healthy sleep onset";
  } else if (has(["probiotic"])) {
    timing = "Morning (before breakfast)";
    withFood = false;
    benefitPhrase = "gut microbiome balance";
  } else if (has(["whey", "protein"])) {
    timing = "Post-workout or between meals";
    withFood = true;
    benefitPhrase = "daily protein intake";
  } else if (has(["astaxanthin"])) {
    timing = "With meals";
    withFood = true;
    benefitPhrase = "antioxidant support";
  } else if (has(["creatine"])) {
    timing = "Anytime";
    withFood = true;
    benefitPhrase = "exercise performance";
  } else if (has(["magnesium"])) {
    timing = "Evening (after dinner)";
    withFood = true;
    benefitPhrase = "muscle relaxation";
  } else if (has(["omega-3", "fish oil", "krill"])) {
    timing = "Breakfast or dinner (with a meal)";
    withFood = true;
    benefitPhrase = "heart health";
  } else if (has(["vitamin d", "d3"])) {
    timing = "Morning (with breakfast)";
    withFood = true;
    benefitPhrase = "bone and immune health";
  } else if (has(["iron"])) {
    timing = "Morning (empty stomach)";
    withFood = false;
    benefitPhrase = "healthy red blood cells";
  } else if (has(["calcium"])) {
    timing = "With meals";
    withFood = true;
    benefitPhrase = "bone health";
  } else if (has(["zinc"])) {
    timing = "With meals";
    withFood = true;
    benefitPhrase = "immune function";
  } else if (has(["vitamin", "b1", "b2", "b3", "b6", "b12", "folate"])) {
    timing = "Morning (with breakfast)";
    withFood = true;
    benefitPhrase = "daily nutrition";
  }

  const nameText = params.productName.trim() || "This supplement";
  const doseText = params.dosageText?.trim() ? ` (${params.dosageText.trim()})` : "";
  const summary = normalizeTwoSentenceSummary(
    `${nameText}${doseText} is commonly used to support ${benefitPhrase}. Follow the product label for dosing and timing.`,
  );

  return { summary, timing, withFood };
};

const getShortProductName = (productName: string, brandName: string) => {
  const trimmed = productName.trim();
  if (!trimmed) return productName;

  const brandRegex = brandName
    ? new RegExp(`^${escapeRegExp(brandName)}\\s+`, "i")
    : null;
  let working = brandRegex ? trimmed.replace(brandRegex, "") : trimmed;
  working = working.replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();

  const normalized = working.toLowerCase();
  if (/(omega\s*-?\s*3|fish\s*oil|epa|dha)/i.test(normalized)) return "Omega-3";
  if (/\bprobiotics?\b/i.test(normalized)) return "Probiotic";
  if (/\bastaxanthin\b/i.test(normalized)) return "Astaxanthin";
  if (/\bmelatonin\b/i.test(normalized)) return "Melatonin";
  if (/\bcollagen\b/i.test(normalized)) return "Collagen";
  if (/\bcoq10\b|\bco\s*q\s*10\b|\bcoenzyme\s*q10\b/i.test(normalized)) return "CoQ10";
  if (/\bmagnesium\b/i.test(normalized)) return "Magnesium";
  if (/\bzinc\b/i.test(normalized)) return "Zinc";
  if (/\bcalcium\b/i.test(normalized)) return "Calcium";
  if (/\biron\b/i.test(normalized)) return "Iron";
  if (/\bpotassium\b/i.test(normalized)) return "Potassium";
  if (/\bselenium\b/i.test(normalized)) return "Selenium";
  if (/\bbiotin\b/i.test(normalized)) return "Biotin";
  if (/\bvitamin\s*b\s*complex\b/i.test(normalized)) return "Vitamin B-Complex";
  const vitaminMatch = working.match(/\bvitamin\s*([a-k](?:\d{1,2})?)\b/i);
  if (vitaminMatch) return `Vitamin ${vitaminMatch[1].toUpperCase()}`;

  const tokens = working
    .split(" ")
    .map((token) => token.replace(/[^\w-]+/g, ""))
    .filter(Boolean)
    .filter((token) => {
      const lowered = token.toLowerCase();
      if (STOP_WORDS.has(lowered)) return false;
      if (/^\d+(\.\d+)?$/.test(lowered)) return false;
      if (/^\d+(\.\d+)?(mg|mcg|g|iu|ml|oz)$/.test(lowered)) return false;
      return true;
    });

  if (tokens.length === 0) return trimmed;
  return tokens.slice(0, 2).map(titleToken).join(" ");
};

const getDedupeKey = (item: Pick<SavedSupplement, "barcode" | "brandName" | "productName">) => {
  if (item.barcode) return `barcode:${item.barcode}`;
  return `name:${normalizeKey(item.brandName)}:${normalizeKey(item.productName)}`;
};

const getNameKey = (productName: string, brandName: string) =>
  normalizeKey(getShortProductName(productName, brandName));

const getBrandNameKey = (productName: string, brandName: string) =>
  `brand:${normalizeKey(brandName)}:${getNameKey(productName, brandName)}`;

const getTimeCategory = (time?: string) => {
  if (!time) return null;
  const [hoursStr, minutesStr] = time.split(":");
  const hours = Number.parseInt(hoursStr, 10);
  const minutes = Number.parseInt(minutesStr, 10);
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return null;

  const totalMinutes = hours * 60 + minutes;

  if (totalMinutes >= 300 && totalMinutes < 720) {
    return {
      label: "Morning",
      textColor: "#b45309",
      pillStyle: { backgroundColor: "#fffbeb", borderColor: "#fde68a" },
    };
  }
  if (totalMinutes >= 720 && totalMinutes < 1020) {
    return {
      label: "Midday",
      textColor: "#c2410c",
      pillStyle: { backgroundColor: "#fff7ed", borderColor: "#fed7aa" },
    };
  }
  if (totalMinutes >= 1020 && totalMinutes < 1260) {
    return {
      label: "Evening",
      textColor: "#4338ca",
      pillStyle: { backgroundColor: "#eef2ff", borderColor: "#c7d2fe" },
    };
  }

  return {
    label: "Bedtime",
    textColor: "#475569",
    pillStyle: { backgroundColor: "#f1f5f9", borderColor: "#e2e8f0" },
  };
};

const parseTimeToMinutes = (time: string | null | undefined): number | null => {
  const value = typeof time === "string" ? time.trim() : "";
  if (!/^\d{2}:\d{2}$/.test(value)) return null;
  const [hoursText, minutesText] = value.split(":");
  const hours = Number.parseInt(hoursText, 10);
  const minutes = Number.parseInt(minutesText, 10);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return hours * 60 + minutes;
};

const circularMinuteDistance = (a: number, b: number): number => {
  const diff = Math.abs(a - b);
  return Math.min(diff, 24 * 60 - diff);
};

const nearestMealSlotForTime = (
  time: string,
  mealTimePrefs?: MealTimePrefs | null,
): "Breakfast" | "Lunch" | "Dinner" | "Bedtime" | null => {
  const target = parseTimeToMinutes(time);
  if (target == null) return null;
  const seeds: Array<{ label: "Breakfast" | "Lunch" | "Dinner" | "Bedtime"; time: string }> = [
    { label: "Breakfast", time: mealTimePrefs?.breakfast ?? "08:00" },
    { label: "Lunch", time: mealTimePrefs?.lunch ?? "12:30" },
    { label: "Dinner", time: mealTimePrefs?.dinner ?? "18:30" },
    { label: "Bedtime", time: mealTimePrefs?.bedtime ?? "22:00" },
  ];

  let best: "Breakfast" | "Lunch" | "Dinner" | "Bedtime" | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const seed of seeds) {
    const minutes = parseTimeToMinutes(seed.time);
    if (minutes == null) continue;
    const distance = circularMinuteDistance(target, minutes);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = seed.label;
    }
  }
  return best;
};

const resolveDefaultTimeForTimingAnchor = (
  anchors: string[] | undefined,
  mealTimePrefs?: MealTimePrefs | null,
) => {
  const anchor = anchors?.[0]?.trim().toLowerCase();
  if (!anchor) return "08:00";

  if (anchor === "breakfast" || anchor === "morning" || anchor === "pre_workout") {
    return mealTimePrefs?.breakfast ?? "08:00";
  }
  if (anchor === "lunch" || anchor === "midday") {
    return mealTimePrefs?.lunch ?? "12:30";
  }
  if (anchor === "dinner" || anchor === "evening" || anchor === "post_workout") {
    return mealTimePrefs?.dinner ?? "18:30";
  }
  if (anchor === "bedtime") {
    return mealTimePrefs?.bedtime ?? "22:00";
  }

  return "08:00";
};

const suggestedSlotMatchesTimingAnchors = (
  slot: Pick<SuggestedRoutineSlot, "label">,
  anchors: string[] | undefined,
) => {
  const slotKey = slot.label.trim().toLowerCase();
  return (anchors ?? []).some((anchor) => {
    const normalized = anchor.trim().toLowerCase();
    if (normalized === slotKey) return true;
    if (normalized === "morning" && slotKey === "breakfast") return true;
    if (normalized === "midday" && slotKey === "lunch") return true;
    if ((normalized === "evening" || normalized === "post_workout") && slotKey === "dinner") return true;
    return false;
  });
};

const buildScheduleOverrideEvents = ({
  scheduleDefaults,
  selectedStartDate,
  todayKey,
  selectedDaysOfWeek,
  time,
  mealTimePrefs,
}: {
  scheduleDefaults: ScheduleDefaultsPersonalizationVM;
  selectedStartDate: string;
  todayKey: string;
  selectedDaysOfWeek: RoutineDayOfWeek[];
  time: string;
  mealTimePrefs?: MealTimePrefs | null;
}): OverrideEvent[] => {
  const timestamp = new Date().toISOString();
  const events: OverrideEvent[] = [];
  const nearestAnchor = nearestMealSlotForTime(time, mealTimePrefs);
  const suggestedAnchor = nearestAnchor
    ? nearestAnchor.toLowerCase()
    : getTimeCategory(time)?.label.toLowerCase().replace(/\s+/g, "_") ?? "custom";

  if (suggestedAnchor && scheduleDefaults.suggestedTimingAnchors[0] !== suggestedAnchor) {
    events.push({
      id: `schedule_anchor_${timestamp}`,
      timestamp,
      source: "user",
      surface: "schedule_defaults",
      action: "set",
      field: "suggestedTimingAnchors",
      value: [suggestedAnchor],
    });
  }

  const preferScheduleSetup = selectedStartDate !== todayKey || selectedDaysOfWeek.length > 0;
  if (scheduleDefaults.preferScheduleSetup !== preferScheduleSetup) {
    events.push({
      id: `schedule_setup_${timestamp}`,
      timestamp,
      source: "user",
      surface: "schedule_defaults",
      action: "set",
      field: "preferScheduleSetup",
      value: preferScheduleSetup,
    });
  }

  return events;
};

const analysisCache = new Map<string, { factsDigestHash: string | null; data: AnalysisPayload }>();
const factsCache = new Map<string, MySupplementFactsV1>();

type MySupplementFactsV1 = {
  version: "facts_v1";
  identity: { type: string; value: string };
  factsSourceVersion: string;
  factsDigestHash: string;
  product: {
    name: string | null;
    brandDisplay: string | null;
    dosageForm: string | null;
  };
  actives: Array<{
    name: string;
    amount: number | null;
    unit: string | null;
    amountText: string | null;
    source: "label" | "dsld" | "lnhpd" | "web";
    confidence: number | null;
  }>;
  directions: {
    rawText: string | null;
    parsed: {
      perDoseCount: number | null;
      countUnit:
        | "tablet"
        | "capsule"
        | "softgel"
        | "gummy"
        | "scoop"
        | "drop"
        | "packet"
        | "serving"
        | null;
      timesPerDay: number | null;
      withMeals: boolean | null;
      timingHints: Array<"morning" | "evening" | "bedtime" | "with_meals" | "before_meals" | "after_meals">;
    };
    parseConfidence: number;
  };
  overlay: {
    provider: "iherb";
    brandName: string | null;
    title: string | null;
    description: string | null;
    link: string | null;
    imageUrl: string | null;
    suggestedUse: string | null;
    warningsText: string | null;
    ingredients: Array<{
      name: string;
      dose: string | null;
    }>;
  } | null;
  warnings: {
    bullets: string[];
    missing: boolean;
  };
  claims: {
    labelPurposes: string[];
    webClaims: string[];
  };
};

type EnsureOverviewResponse = {
  supplementId: string;
  analysisReady: boolean;
  source?: "deepseek" | "rule" | "cache" | "none";
  analysisData?: AnalysisPayload | null;
  facts?: MySupplementFactsV1 | null;
  factsStatus?: "full" | "partial" | "none";
  factsDigestHash?: string | null;
  factsSourceVersion?: string | null;
  aiStatus?: "ready" | "pending" | "blocked" | "none";
  aiRetryAfterSec?: number | null;
  aiBlockedReason?: string | null;
};

type BarcodeMetadataResponse = {
  status: "ok" | "not_found";
  barcodeGtin14: string;
  productInfo: { brand: string | null; name: string | null };
  primaryDoseText: string | null;
  npn: string | null;
  dsldLabelId: string | null;
};

type StackOverlapItem = {
  ingredientKey: string;
  ingredientDisplay: string;
  count: number;
  supplements: Array<{ supplementId: string; productName: string }>;
};

type StackOverlapResponse = {
  status: "ok" | "partial";
  overlaps: StackOverlapItem[];
  summary: {
    processedSupplements: number;
    skippedSupplements: number;
    overlapCount: number;
    truncated: boolean;
    hiddenOverlapCount: number;
  };
  stackLevelSummary?: StackLevelSafetySummary | null;
  duplicateGroups?: StackDuplicateGroup[];
  meta?: StackSafetyMeta | null;
};

const ensureOverview = async (params: {
  supplementId?: string | null;
  barcode?: string | null;
  brandName?: string | null;
  productName: string;
  dosageText?: string | null;
  userSupplementId?: string | null;
}): Promise<EnsureOverviewResponse | null> => {
  const apiBase = Config.apiBaseUrl?.replace(/\/$/, "");
  if (!apiBase) return null;

  const headers = await withAuthHeaders({ "Content-Type": "application/json" });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6_500);
  let response: Response;
  try {
    response = await fetch(`${apiBase}/api/ensure-overview`, {
      method: "POST",
      headers,
      signal: controller.signal,
      body: JSON.stringify({
        supplementId: params.supplementId ?? null,
        barcode: params.barcode ?? null,
        brandName: params.brandName ?? null,
        productName: params.productName,
        dosageText: params.dosageText ?? null,
        userSupplementId: params.userSupplementId ?? null,
      }),
    }).finally(() => clearTimeout(timeout));
  } catch (error) {
    const name = typeof (error as { name?: unknown } | null)?.name === "string" ? (error as any).name : "";
    if (name === "AbortError") return null;
    const message = error instanceof Error ? error.message : "Unknown error";
    console.warn("[supplement-overview] ensure-overview fetch failed", message);
    return null;
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    console.warn("[supplement-overview] ensure-overview failed", response.status, detail);
    return null;
  }

  const payload = (await response.json().catch(() => null)) as EnsureOverviewResponse | null;
  if (!payload?.supplementId) {
    return null;
  }
  return payload;
};

const getOverviewLookupSupplementId = (
  supplementId?: string | null,
  barcode?: string | null,
): string | null => {
  const normalizedBarcode = typeof barcode === "string" ? barcode.trim() : "";
  if (normalizedBarcode) return null;
  return supplementId ?? null;
};

const fetchBarcodeMetadata = async (barcode: string): Promise<BarcodeMetadataResponse | null> => {
  const apiBase = Config.apiBaseUrl?.replace(/\/$/, "");
  if (!apiBase) return null;

  const headers = await withAuthHeaders();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4_500);
  let response: Response;
  try {
    response = await fetch(
      `${apiBase}/api/barcode-metadata?barcode=${encodeURIComponent(barcode)}`,
      {
        method: "GET",
        headers,
        signal: controller.signal,
      },
    ).finally(() => clearTimeout(timeout));
  } catch (error) {
    const name = typeof (error as { name?: unknown } | null)?.name === "string" ? (error as any).name : "";
    if (name === "AbortError") return null;
    const message = error instanceof Error ? error.message : "Unknown error";
    console.warn("[supplement-dose] barcode-metadata fetch failed", message);
    return null;
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    console.warn("[supplement-dose] barcode-metadata failed", response.status, detail);
    return null;
  }

  const payload = (await response.json().catch(() => null)) as BarcodeMetadataResponse | null;
  if (!payload?.status) return null;
  return payload;
};

const fetchStackOverlap = async (): Promise<StackOverlapResponse | null> => {
  const apiBase = Config.apiBaseUrl?.replace(/\/$/, "");
  if (!apiBase) return null;

  const headers = await withAuthHeaders();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4_500);
  let response: Response;
  try {
    response = await fetch(`${apiBase}/api/user-stack-overlap`, {
      method: "GET",
      headers,
      signal: controller.signal,
    }).finally(() => clearTimeout(timeout));
  } catch (error) {
    const name = typeof (error as { name?: unknown } | null)?.name === "string" ? (error as any).name : "";
    if (name === "AbortError") return null;
    const message = error instanceof Error ? error.message : "Unknown error";
    console.warn("[stack-overlap] fetch failed", message);
    return null;
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    console.warn("[stack-overlap] failed", response.status, detail);
    return null;
  }

  const payload = (await response.json().catch(() => null)) as StackOverlapResponse | null;
  if (!payload || !Array.isArray(payload.overlaps)) return null;
  return payload;
};

function ScrollWheel({
  items,
  value,
  onChange,
}: {
  items: string[];
  value: string;
  onChange: (val: string) => void;
}) {
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    const index = items.indexOf(value);
    if (index < 0) return;
    scrollRef.current?.scrollTo({ y: index * ITEM_HEIGHT, animated: false });
  }, [items, value]);

  const handleScrollEnd = useCallback(
    (event: { nativeEvent: { contentOffset: { y: number } } }) => {
      const offsetY = event.nativeEvent.contentOffset.y;
      const rawIndex = Math.round(offsetY / ITEM_HEIGHT);
      const clampedIndex = Math.max(0, Math.min(rawIndex, items.length - 1));
      const nextValue = items[clampedIndex];
      if (nextValue && nextValue !== value) onChange(nextValue);
    },
    [items, onChange, value],
  );

  return (
    <View style={styles.wheelWrap}>
      <ScrollView
        ref={scrollRef}
        showsVerticalScrollIndicator={false}
        snapToAlignment="center"
        snapToInterval={ITEM_HEIGHT}
        decelerationRate="fast"
        contentContainerStyle={styles.wheelContent}
        onMomentumScrollEnd={handleScrollEnd}
        onScrollEndDrag={handleScrollEnd}
      >
        {items.map((item) => {
          const isActive = item === value;
          return (
            <View key={item} style={styles.wheelItemRow}>
              <Text style={[styles.wheelItemText, isActive ? styles.wheelItemActive : styles.wheelItemInactive]}>
                {item}
              </Text>
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

function TimePicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (val: string) => void;
}) {
  const hours = useMemo(() => Array.from({ length: 12 }, (_, i) => (i + 1).toString()), []);
  const minutes = useMemo(() => Array.from({ length: 60 }, (_, i) => i.toString().padStart(2, "0")), []);
  const ampm = ["AM", "PM"];

  const parseTime = (timeStr: string) => {
    if (!timeStr) return { h: "8", m: "00", p: "AM" };
    const [h24, m] = timeStr.split(":");
    let hour = Number.parseInt(h24, 10);
    const period = hour >= 12 ? "PM" : "AM";
    if (hour === 0) hour = 12;
    else if (hour > 12) hour -= 12;
    return { h: hour.toString(), m, p: period };
  };

  const { h, m, p } = parseTime(value);

  const updateTime = useCallback(
    (newH: string, newM: string, newP: string) => {
      let hour = Number.parseInt(newH, 10);
      if (newP === "PM" && hour < 12) hour += 12;
      if (newP === "AM" && hour === 12) hour = 0;
      const h24 = hour.toString().padStart(2, "0");
      onChange(`${h24}:${newM}`);
    },
    [onChange],
  );

  return (
    <View style={styles.timePickerWrap}>
      <View style={styles.timePickerHighlight} />
      <View style={styles.timePickerRow}>
        <View style={styles.timePickerColumn}>
          <ScrollWheel items={ampm} value={p} onChange={(val) => updateTime(h, m, val)} />
        </View>
        <View style={styles.timePickerColumn}>
          <ScrollWheel items={hours} value={h} onChange={(val) => updateTime(val, m, p)} />
        </View>
        <View style={styles.timePickerColumn}>
          <ScrollWheel items={minutes} value={m} onChange={(val) => updateTime(h, val, p)} />
        </View>
      </View>
      <LinearGradient
        colors={["rgba(248,250,252,0.95)", "rgba(248,250,252,0.0)"]}
        style={styles.timePickerFadeTop}
        pointerEvents="none"
      />
      <LinearGradient
        colors={["rgba(248,250,252,0.0)", "rgba(248,250,252,0.95)"]}
        style={styles.timePickerFadeBottom}
        pointerEvents="none"
      />
    </View>
  );
}

function StartDatePickerSheet({
  visible,
  selectedDate,
  onSelectDate,
  onClose,
}: {
  visible: boolean;
  selectedDate: string;
  onSelectDate: (dateKey: string) => void;
  onClose: () => void;
}) {
  const todayKey = useMemo(() => getLocalDateKey(new Date()), []);
  const tomorrowKey = useMemo(() => shiftLocalDateKey(todayKey, 1), [todayKey]);
  const [visibleDate, setVisibleDate] = useState(selectedDate);

  useEffect(() => {
    if (!visible) return;
    setVisibleDate(selectedDate);
  }, [selectedDate, visible]);

  if (!visible) return null;

  const handleSelectDate = (dateKey: string) => {
    onSelectDate(dateKey);
    setVisibleDate(dateKey);
    onClose();
  };

  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose}>
      <View style={styles.startDateOverlay}>
        <Pressable style={StyleSheet.absoluteFillObject} onPress={onClose} />
        <MotiView
          from={{ opacity: 0, translateY: 16 }}
          animate={{ opacity: 1, translateY: 0 }}
          exit={{ opacity: 0, translateY: 12 }}
          transition={{ type: "timing", duration: 220, easing: Easing.out(Easing.cubic) }}
          style={styles.startDateModal}
        >
          <View style={styles.startDateModalHeader}>
            <View style={styles.startDateModalTitleRow}>
              <CalendarDays size={18} color="#2563eb" />
              <Text style={styles.startDateModalTitle}>Start date</Text>
            </View>
            <Pressable onPress={onClose} style={styles.startDateModalClose}>
              <X size={16} color="#475569" />
            </Pressable>
          </View>

          <Text style={styles.startDateModalSubtitle}>
            Check-ins only start counting on or after this date.
          </Text>

          <View style={styles.startDateQuickActionRow}>
            {[
              { key: "today", label: "Today", value: todayKey },
              { key: "tomorrow", label: "Tomorrow", value: tomorrowKey },
            ].map((action) => {
              const isActive = selectedDate === action.value;
              return (
                <Pressable
                  key={action.key}
                  onPress={() => handleSelectDate(action.value)}
                  style={[
                    styles.startDateQuickActionChip,
                    isActive && styles.startDateQuickActionChipActive,
                  ]}
                >
                  <Text
                    style={[
                      styles.startDateQuickActionText,
                      isActive && styles.startDateQuickActionTextActive,
                    ]}
                  >
                    {action.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <View style={styles.startDateMonthRow}>
            <Pressable
              onPress={() => setVisibleDate((prev) => shiftLocalDateKey(prev, -7))}
              style={styles.startDateMonthNav}
            >
              <ArrowLeft size={14} color="#475569" />
            </Pressable>
            <Text style={styles.startDateMonthLabel}>{formatRoutineWeekRangeLabel(visibleDate)}</Text>
            <Pressable
              onPress={() => setVisibleDate((prev) => shiftLocalDateKey(prev, 7))}
              style={styles.startDateMonthNav}
            >
              <ArrowRight size={14} color="#475569" />
            </Pressable>
          </View>

          <CalendarStrip
            selectedDate={selectedDate}
            visibleDate={visibleDate}
            onSelectDate={handleSelectDate}
          />
        </MotiView>
      </View>
    </Modal>
  );
}

function BatchScheduleSheet({
  visible,
  selectedCount,
  scheduleDefaults,
  mealTimePrefs,
  onClose,
  onApply,
  onRecordOverrideEvents,
}: {
  visible: boolean;
  selectedCount: number;
  scheduleDefaults: ScheduleDefaultsPersonalizationVM;
  mealTimePrefs?: MealTimePrefs | null;
  onClose: () => void;
  onApply: (update: BatchScheduleUpdate) => void | Promise<void>;
  onRecordOverrideEvents?: (events: OverrideEvent[]) => Promise<void>;
}) {
  const todayKey = useMemo(() => getLocalDateKey(new Date()), []);
  const tomorrowKey = useMemo(() => shiftLocalDateKey(todayKey, 1), [todayKey]);
  const [startDateMode, setStartDateMode] = useState<"keep" | "today" | "tomorrow" | "custom">("keep");
  const [customStartDate, setCustomStartDate] = useState(todayKey);
  const [daysMode, setDaysMode] = useState<"keep" | "every" | "custom">("keep");
  const [selectedDays, setSelectedDays] = useState<RoutineDayOfWeek[]>([]);
  const [timeMode, setTimeMode] = useState<"keep" | "set">("keep");
  const [time, setTime] = useState("08:00");
  const [withFoodMode, setWithFoodMode] = useState<"keep" | "yes" | "no">("keep");
  const [startDatePickerOpen, setStartDatePickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setStartDateMode("keep");
    setCustomStartDate(todayKey);
    setDaysMode("keep");
    setSelectedDays([]);
    setTimeMode("keep");
    setTime(resolveDefaultTimeForTimingAnchor(scheduleDefaults.suggestedTimingAnchors, mealTimePrefs));
    setWithFoodMode("keep");
    setStartDatePickerOpen(false);
    setSaving(false);
  }, [mealTimePrefs, scheduleDefaults.suggestedTimingAnchors, todayKey, visible]);

  if (!visible) return null;

  const effectiveStartDate =
    startDateMode === "today"
      ? todayKey
      : startDateMode === "tomorrow"
      ? tomorrowKey
      : customStartDate;
  const effectiveStartDateLabel = formatRoutineStartDateLabel(effectiveStartDate, todayKey);
  const anchorSummary = scheduleDefaults.suggestedTimingAnchors[0]
    ? getTimingAnchorDisplayLabel(scheduleDefaults.suggestedTimingAnchors[0])
    : null;
  const batchScheduleSummary = buildScheduleDefaultsSummary(scheduleDefaults);
  const hasChanges =
    startDateMode !== "keep" ||
    daysMode !== "keep" ||
    timeMode !== "keep" ||
    withFoodMode !== "keep";

  const toggleBatchDay = (day: RoutineDayOfWeek) => {
    setDaysMode("custom");
    setSelectedDays((prev) => {
      const current = normalizeRoutineDays(prev);
      if (current.includes(day)) {
        return current.filter((value) => value !== day);
      }
      return normalizeRoutineDays([...current, day]);
    });
  };

  const handleApply = async () => {
    if (!hasChanges || saving) return;
    const update: BatchScheduleUpdate = {};
    if (startDateMode !== "keep") update.startDate = effectiveStartDate;
    if (daysMode === "every") update.daysOfWeek = [];
    if (daysMode === "custom") update.daysOfWeek = selectedDays;
    if (timeMode === "set") update.time = time;
    if (withFoodMode === "yes") update.withFood = true;
    if (withFoodMode === "no") update.withFood = false;

    try {
      setSaving(true);
      await onApply(update);
      const events = buildScheduleOverrideEvents({
        scheduleDefaults,
        selectedStartDate: effectiveStartDate,
        todayKey,
        selectedDaysOfWeek: daysMode === "custom" ? selectedDays : [],
        time: timeMode === "set" ? time : resolveDefaultTimeForTimingAnchor(scheduleDefaults.suggestedTimingAnchors, mealTimePrefs),
        mealTimePrefs,
      });
      if (events.length > 0) {
        await onRecordOverrideEvents?.(events);
      }
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose}>
      <View style={styles.batchOverlay}>
        <Pressable style={StyleSheet.absoluteFillObject} onPress={onClose} />
        <MotiView
          from={{ opacity: 0, translateY: 24 }}
          animate={{ opacity: 1, translateY: 0 }}
          exit={{ opacity: 0, translateY: 18 }}
          transition={{ type: "timing", duration: 240, easing: Easing.out(Easing.cubic) }}
          style={styles.batchSheet}
        >
          <View style={styles.batchHeaderRow}>
            <View style={styles.batchHeaderTextWrap}>
              <Text style={styles.batchTitle}>Edit schedule</Text>
              <Text style={styles.batchSubtitle}>Apply to {selectedCount} supplements</Text>
            </View>
            <Pressable onPress={onClose} style={styles.batchCloseBtn}>
              <X size={16} color="#475569" />
            </Pressable>
          </View>

          <ScrollView
            style={styles.batchScroll}
            contentContainerStyle={styles.batchScrollContent}
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.batchSummaryCard}>
              <Text style={styles.batchSummaryTitle}>
                {scheduleDefaults.preferScheduleSetup ? "Recommended next step" : "Default reminder style"}
              </Text>
              <Text style={styles.batchSummaryBody}>{batchScheduleSummary}</Text>
              {anchorSummary ? (
                <Text style={styles.batchSummaryMeta}>
                  Suggested anchor: {anchorSummary} • {getReminderPriorityLabel(scheduleDefaults.reminderPriority)}
                </Text>
              ) : (
                <Text style={styles.batchSummaryMeta}>
                  {getReminderPriorityLabel(scheduleDefaults.reminderPriority)}
                </Text>
              )}
            </View>

            <View style={styles.batchSection}>
              <Text style={styles.batchSectionTitle}>Start date</Text>
              <View style={styles.batchChipRow}>
                {[
                  { key: "keep" as const, label: "Keep current" as const },
                  { key: "today" as const, label: "Today" as const },
                  { key: "tomorrow" as const, label: "Tomorrow" as const },
                ].map((option) => {
                  const isActive = startDateMode === option.key;
                  return (
                    <Pressable
                      key={option.key}
                      onPress={() => setStartDateMode(option.key)}
                      style={[styles.batchChoiceChip, isActive && styles.batchChoiceChipActive]}
                    >
                      <Text style={[styles.batchChoiceText, isActive && styles.batchChoiceTextActive]}>
                        {option.label}
                      </Text>
                    </Pressable>
                  );
                })}
                <Pressable
                  onPress={() => {
                    setStartDateMode("custom");
                    setStartDatePickerOpen(true);
                  }}
                  style={[
                    styles.batchChoiceChip,
                    startDateMode === "custom" && styles.batchChoiceChipActive,
                  ]}
                >
                  <Text
                    style={[
                      styles.batchChoiceText,
                      startDateMode === "custom" && styles.batchChoiceTextActive,
                    ]}
                  >
                    {startDateMode === "custom" ? effectiveStartDateLabel : "Pick date"}
                  </Text>
                </Pressable>
              </View>
            </View>

            <View style={styles.batchSection}>
              <Text style={styles.batchSectionTitle}>Days of week</Text>
              <View style={styles.batchChipRow}>
                <Pressable
                  onPress={() => setDaysMode("keep")}
                  style={[styles.batchChoiceChip, daysMode === "keep" && styles.batchChoiceChipActive]}
                >
                  <Text style={[styles.batchChoiceText, daysMode === "keep" && styles.batchChoiceTextActive]}>
                    Keep current
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => {
                    setDaysMode("every");
                    setSelectedDays([]);
                  }}
                  style={[styles.batchChoiceChip, daysMode === "every" && styles.batchChoiceChipActive]}
                >
                  <Text style={[styles.batchChoiceText, daysMode === "every" && styles.batchChoiceTextActive]}>
                    Every day
                  </Text>
                </Pressable>
              </View>
              <View style={styles.weekdayChipRow}>
                {ROUTINE_DAY_OPTIONS.map((option) => {
                  const isSelected = daysMode === "custom" && selectedDays.includes(option.value);
                  return (
                    <Pressable
                      key={`batch-day-${option.value}`}
                      onPress={() => toggleBatchDay(option.value)}
                      style={[styles.weekdayChip, isSelected && styles.weekdayChipActive]}
                    >
                      <Text style={[styles.weekdayChipText, isSelected && styles.weekdayChipTextActive]}>
                        {option.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            <View style={styles.batchSection}>
              <Text style={styles.batchSectionTitle}>Time</Text>
              <View style={styles.batchChipRow}>
                <Pressable
                  onPress={() => setTimeMode("keep")}
                  style={[styles.batchChoiceChip, timeMode === "keep" && styles.batchChoiceChipActive]}
                >
                  <Text style={[styles.batchChoiceText, timeMode === "keep" && styles.batchChoiceTextActive]}>
                    Keep current
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => setTimeMode("set")}
                  style={[styles.batchChoiceChip, timeMode === "set" && styles.batchChoiceChipActive]}
                >
                  <Text style={[styles.batchChoiceText, timeMode === "set" && styles.batchChoiceTextActive]}>
                    Set time
                  </Text>
                </Pressable>
              </View>
              {timeMode === "set" ? <TimePicker value={time} onChange={setTime} /> : null}
            </View>

            <View style={styles.batchSection}>
              <Text style={styles.batchSectionTitle}>Take with food</Text>
              <View style={styles.batchChipRow}>
                {[
                  { key: "keep", label: "Keep current" },
                  { key: "yes", label: "Yes" },
                  { key: "no", label: "No" },
                ].map((option) => {
                  const isActive = withFoodMode === option.key;
                  return (
                    <Pressable
                      key={option.key}
                      onPress={() => setWithFoodMode(option.key as "keep" | "yes" | "no")}
                      style={[styles.batchChoiceChip, isActive && styles.batchChoiceChipActive]}
                    >
                      <Text style={[styles.batchChoiceText, isActive && styles.batchChoiceTextActive]}>
                        {option.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          </ScrollView>

          <View style={styles.batchFooter}>
            <Text style={styles.batchFooterHint}>Only the fields you change will be applied.</Text>
            <Pressable
              disabled={!hasChanges || saving}
              onPress={() => {
                void handleApply();
              }}
              style={[
                styles.batchApplyBtn,
                (!hasChanges || saving) && styles.batchApplyBtnDisabled,
              ]}
            >
              <Text
                style={[
                  styles.batchApplyText,
                  (!hasChanges || saving) && styles.batchApplyTextDisabled,
                ]}
              >
                {saving ? "Applying..." : `Apply to ${selectedCount}`}
              </Text>
            </Pressable>
          </View>
        </MotiView>

        <StartDatePickerSheet
          visible={startDatePickerOpen}
          selectedDate={effectiveStartDate}
          onSelectDate={setCustomStartDate}
          onClose={() => setStartDatePickerOpen(false)}
        />
      </View>
    </Modal>
  );
}

const CollectionCard = React.memo(
  function CollectionCard({
    item,
    displayBrandName,
    overlapCount,
    index,
    theme,
    zIndex,
    stackOverlap,
    expanded,
    detailOpen,
    selectionMode,
    selected,
    onToggleSelect,
    onToggleExpand,
    onOpenDetail,
    onViewNote,
  }: {
    item: SavedSupplement;
    displayBrandName: string;
    overlapCount: number;
    index: number;
    theme: Theme;
    zIndex: number;
    stackOverlap: number;
    expanded: boolean;
    detailOpen: boolean;
    selectionMode: boolean;
    selected: boolean;
    onToggleSelect: () => void;
    onToggleExpand: () => void;
    onOpenDetail: () => void;
    onViewNote: () => void;
  }) {
    const showHalo = !selectionMode && expanded;
    const noteText = item.routine?.note || "";
    const customTags = item.tags?.filter((tag) => !SMART_TAG_SET.has(tag)) ?? [];
    const routineTimeUserSet = resolveRoutineTimeUserSet(item.routine);
    const cardSavedTime = routineTimeUserSet && item.routine?.time?.trim() ? item.routine.time : null;
    const timeCategory = getTimeCategory(cardSavedTime ?? undefined);
    const scheduleIcon =
      timeCategory?.label === "Morning" || timeCategory?.label === "Midday"
        ? "sun"
        : timeCategory
        ? "moon"
        : null;

    return (
      <MotiView
        style={[
          styles.cardShell,
          {
            zIndex: expanded ? 999 : zIndex,
            elevation: expanded ? 999 : Math.max(1, zIndex + 1),
          },
        ]}
        animate={{
          marginTop: index === 0 ? 0 : selectionMode ? 16 : expanded ? 0 : -stackOverlap,
          marginBottom: expanded ? 16 : 0,
          translateY: expanded ? -10 : 0,
          shadowOpacity: selected ? 0.16 : expanded ? 0.12 : 0.0,
        }}
        transition={{ type: "spring", stiffness: 380, damping: 30, mass: 0.8 }}
      >
        <AnimatePresence>
          {expanded && noteText && !selectionMode ? (
            <MotiView
              from={{ opacity: 0, translateY: -40 }}
              animate={{
                opacity: 1,
                translateY: 80,
              }}
              exit={{ opacity: 0, translateY: -30 }}
              transition={{ type: "spring", stiffness: 150, damping: 18, mass: 0.9 }}
              style={styles.noteCard}
            >
              <Pressable
                style={styles.noteCardInner}
                onPress={(event) => {
                  event.stopPropagation();
                  onViewNote();
                }}
              >
                <View style={styles.noteCardIcon}>
                  <StickyNote size={14} color="#94a3b8" />
                </View>
                <View style={styles.noteCardContent}>
                  <Text style={styles.noteCardText} numberOfLines={3} ellipsizeMode="tail">
                    {noteText}
                  </Text>
                </View>
                <View style={styles.noteCardAction}>
                  <Maximize2 size={12} color="#94a3b8" />
                </View>
              </Pressable>
              <View style={styles.noteCardShade} />
            </MotiView>
          ) : null}
        </AnimatePresence>

        <View style={[styles.cardFill, { backgroundColor: theme.bgHex }]}>
          <Pressable
            onPress={() => {
              if (selectionMode) onToggleSelect();
              else onToggleExpand();
            }}
            style={styles.cardPressable}
          >
            <AnimatePresence>
              {selectionMode && selected ? (
                <MotiView
                  from={{ opacity: 0, scale: 0.92, translateY: 0 }}
                  animate={{ opacity: 1, scale: 1, translateY: 0 }}
                  exit={{ opacity: 0, scale: 0.96, translateY: 0 }}
                  transition={{ type: "timing", duration: 190, easing: Easing.out(Easing.cubic) }}
                  style={styles.selectCheckBubble}
                >
                  <BlurView intensity={14} tint="light" style={StyleSheet.absoluteFillObject} />
                  <LinearGradient
                    colors={["rgba(255,255,255,0.45)", "rgba(255,255,255,0.20)"]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={StyleSheet.absoluteFillObject}
                  />
                  <MotiView
                    from={{ opacity: 0, scale: 0.94 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.96 }}
                    transition={{ type: "timing", duration: 170, delay: 30, easing: Easing.out(Easing.cubic) }}
                  >
                    <Check size={18} color={theme.textColor === "#ffffff" ? "#ffffff" : "#0f172a"} />
                  </MotiView>
                </MotiView>
              ) : null}
            </AnimatePresence>

	            <View style={styles.cardInner}>
	              <View style={styles.cardContentRow}>
	                <View style={styles.cardTextColumn}>
	                  <View style={styles.cardHeader}>
	                    <Text style={[styles.cardTitle, { color: theme.textColor }]} numberOfLines={1} ellipsizeMode="tail">
	                      {getShortProductName(item.productName, item.brandName)}
	                    </Text>

	                    <View style={styles.cardScheduleIconSlot}>
	                      {selectionMode || !scheduleIcon ? null : scheduleIcon === "sun" ? (
	                        <Sun size={24} color={theme.textColor} />
	                      ) : (
	                        <Moon size={24} color={theme.textColor} />
	                      )}
	                    </View>
	                  </View>

		                  <View style={styles.cardMeta}>
		                    <View style={styles.tagRow}>
		                      <View style={[styles.tagPill, styles.brandPillClamp, { borderColor: theme.tagBorderColor }]}>
		                        <Text
		                          style={[styles.tagText, styles.pillTextClamp, { color: theme.textColor }]}
		                          numberOfLines={1}
		                          ellipsizeMode="tail"
		                        >
		                          {formatBrandForPill(displayBrandName)}
		                        </Text>
		                      </View>
	                        {overlapCount > 0 ? (
	                          <View style={[styles.tagPill, styles.overlapPill, { borderColor: theme.tagBorderColor }]}>
	                            <Text
	                              style={[styles.tagText, styles.pillTextClamp, { color: theme.textColor }]}
	                              numberOfLines={1}
	                              ellipsizeMode="tail"
	                            >
	                              Overlap {overlapCount}
	                            </Text>
	                          </View>
	                        ) : null}
		                    </View>

	                    {customTags.length > 0 ? (
	                      <View style={styles.customTagRow}>
	                        {customTags.map((tag) => (
	                          <View key={tag} style={[styles.tagPill, { borderColor: theme.tagBorderColor }]}>
	                            <Text style={[styles.tagText, { color: theme.textColor }]}>{tag}</Text>
	                          </View>
	                        ))}
	                      </View>
	                    ) : null}
	                  </View>
	                </View>

	              </View>
	            </View>
          </Pressable>

          <View style={styles.arrowWrap} pointerEvents="box-none">
            <AnimatePresence>
              {showHalo ? (
                <MotiView
                  from={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ type: "spring", stiffness: 220, damping: 22 }}
                  style={styles.arrowHalo}
                />
              ) : null}
            </AnimatePresence>

            <Pressable
              onPress={onOpenDetail}
              disabled={selectionMode}
              style={[
                styles.arrowBtn,
                {
                  backgroundColor: theme.arrowBg,
                  opacity: selectionMode ? 0.35 : 1,
                },
              ]}
            >
              <ArrowRight size={20} color={theme.arrowColor} />
            </Pressable>
          </View>

          {selected ? <View pointerEvents="none" style={styles.selectedRing} /> : null}
        </View>
      </MotiView>
    );
  },
  (prev, next) =>
    prev.item === next.item &&
    prev.displayBrandName === next.displayBrandName &&
    prev.overlapCount === next.overlapCount &&
    prev.index === next.index &&
    prev.theme === next.theme &&
    prev.zIndex === next.zIndex &&
    prev.expanded === next.expanded &&
    prev.detailOpen === next.detailOpen &&
    prev.selectionMode === next.selectionMode &&
    prev.selected === next.selected,
);

function DetailSheet({
  item,
  theme,
  scheduleDefaults,
  selectedGoalKey,
  savedProductEvaluation,
  compareEntries,
  stackOverlaps,
  stackSafetySummary,
  duplicateGroups,
  stackSafetyMeta,
  stackSafetyLocked,
  mealTimePrefs,
  onLearnMealTimePref,
  onOpenStackSafetyPaywall,
  onClose,
  onSaveRoutine,
  onRecordOverrideEvents,
  onTrackPersonalizationEvent,
  smartFilterAnalyticsContext,
  onTrackSmartFilterEvent,
}: {
  item: SavedSupplement;
  theme: Theme;
  scheduleDefaults: ScheduleDefaultsPersonalizationVM;
  selectedGoalKey?: GoalKey;
  savedProductEvaluation?: SavedProductEvaluation;
  compareEntries?: GoalCompareEntry[];
  stackOverlaps?: StackOverlapItem[];
  stackSafetySummary?: StackLevelSafetySummary | null;
  duplicateGroups?: StackDuplicateGroup[];
  stackSafetyMeta?: StackSafetyMeta | null;
  stackSafetyLocked?: boolean;
  mealTimePrefs?: MealTimePrefs | null;
  onLearnMealTimePref?: (
    label: "Breakfast" | "Lunch" | "Dinner" | "Bedtime",
    time: string,
    mode: "seed" | "manual",
  ) => void | Promise<void>;
  onOpenStackSafetyPaywall?: () => void;
  onClose: () => void;
  onSaveRoutine?: (id: string, prefs: RoutinePreferences) => void | Promise<void>;
  onRecordOverrideEvents?: (events: OverrideEvent[]) => Promise<void>;
  onTrackPersonalizationEvent?: (input: {
    eventName: "goal_fit_detail_opened" | "compare_opened";
    surface: string;
    payload?: Record<string, unknown>;
  }) => Promise<void>;
  smartFilterAnalyticsContext?: SmartFilterEvaluatedDetailAnalyticsContext | null;
  onTrackSmartFilterEvent?: (event: string, payload: Record<string, unknown>) => void;
}) {
  const insets = useSafeAreaInsets();
  const screenHeight = Dimensions.get("window").height;
  const screenWidth = Dimensions.get("window").width;
  const { updateSupplement } = useSavedSupplements();
  const defaultScheduleTime = resolveDefaultTimeForTimingAnchor(
    scheduleDefaults.suggestedTimingAnchors,
    mealTimePrefs,
  );
  const [note, setNote] = useState(item.routine?.note ?? "");
  const [time, setTime] = useState(item.routine?.time ?? defaultScheduleTime);
  const [withFood, setWithFood] = useState(item.routine?.withFood ?? false);
  const initialStartDate = resolveRoutineStartDate(item.routine?.startDate, item.createdAt);
  const [selectedStartDate, setSelectedStartDate] = useState(initialStartDate);
  const [selectedDaysOfWeek, setSelectedDaysOfWeek] = useState<RoutineDayOfWeek[]>(
    normalizeRoutineDays(item.routine?.daysOfWeek),
  );
  const [startDatePickerOpen, setStartDatePickerOpen] = useState(false);
  const [timeTouched, setTimeTouched] = useState(false);
  const [facts, setFacts] = useState<MySupplementFactsV1 | null>(null);
  const [factsStatus, setFactsStatus] = useState<"full" | "partial" | "none">("none");
  const [factsDigestHash, setFactsDigestHash] = useState<string | null>(null);
  const [, setFactsSourceVersion] = useState<string | null>(null);
  const [factsRefreshExhausted, setFactsRefreshExhausted] = useState(false);
  const [factsRefreshRetryNonce, setFactsRefreshRetryNonce] = useState(0);
  const [analysisData, setAnalysisData] = useState<AnalysisPayload | null>(null);
  const [, setAiStatus] = useState<"ready" | "pending" | "blocked" | "none">("none");
  const [aiRetryAfterSec, setAiRetryAfterSec] = useState(0);
  const [aiBlockedReason, setAiBlockedReason] = useState<string | null>(null);
  const [aiUiPhase, setAiUiPhase] = useState<"idle" | "pending" | "ready" | "timeout" | "blocked" | "none">("idle");
  const aiUiPhaseRef = useRef<"idle" | "pending" | "ready" | "timeout" | "blocked" | "none">("idle");
  const pollTimersRef = useRef<Array<ReturnType<typeof setTimeout>>>([]);
  const factsDigestHashRef = useRef<string | null>(null);
  const factsRefreshLoopActiveRef = useRef(false);
  const lastFactsRefreshAtRef = useRef(0);
  const [unsaveArmed, setUnsaveArmed] = useState(false);
  const unsaveArmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasSavedRoutine =
    Boolean(item.routine?.note) ||
    Boolean(item.routine?.time) ||
    item.routine?.withFood !== undefined ||
    Boolean(item.routine?.startDate) ||
    Boolean(item.routine?.daysOfWeek?.length);
  const [saveState, setSaveState] = useState<"idle" | "saved">(
    hasSavedRoutine ? "saved" : "idle",
  );
  const savePillWidthRef = useRef(108);
  const [savePillWidth, setSavePillWidth] = useState(108);
  const [detailKeyboardHeight, setDetailKeyboardHeight] = useState(0);
  const sheetScrollRef = useRef<ScrollView>(null);
  const sheetScrollYRef = useRef(0);
  const noteInputRef = useRef<TextInput>(null);
  const noteSectionYRef = useRef(0);
  const timeSectionYRef = useRef(0);
  const timingSourceMetricKeyRef = useRef<string | null>(null);
  const suggestedPlanMetricKeyRef = useRef<string | null>(null);
  const odsFallbackMetricKeyRef = useRef<string | null>(null);
  const timesPerDaySourceMetricKeyRef = useRef<string | null>(null);
  const whatItDoesMetricKeyRef = useRef<string | null>(null);
  const savedSuggestedHiddenMetricKeyRef = useRef<string | null>(null);
  const factsRefreshSessionIdRef = useRef<string | null>(null);
  const authoritativeDoseRepairRef = useRef<string | null>(null);
  const [overviewExpanded, setOverviewExpanded] = useState(false);
  const [whatsInsideExpanded, setWhatsInsideExpanded] = useState(false);
  const [compareOpen, setCompareOpen] = useState(false);
  const [selectedAnchorKey, setSelectedAnchorKey] = useState<string | null>(null);
  const autoAnchorSyncedRef = useRef<string | null>(null);
  const [anchorPrefilled, setAnchorPrefilled] = useState(false);
  const autosyncedThisSessionRef = useRef(false);
  const detailOpenedAtRef = useRef<number>(Date.now());
  const odsFirstPaintLoggedRef = useRef(false);
  const goalFitDetailTrackedKeyRef = useRef<string | null>(null);

  const lastSavedRef = useRef<RoutinePreferences>({
    note: item.routine?.note ?? "",
    time: item.routine?.time ?? "",
    timeUserSet: item.routine?.timeUserSet ?? undefined,
    withFood: item.routine?.withFood ?? false,
    startDate: initialStartDate,
    daysOfWeek: normalizeRoutineDays(item.routine?.daysOfWeek),
  });
  const lastDetailItemIdRef = useRef<string | null>(null);

  useEffect(() => {
    const next = {
      note: item.routine?.note ?? "",
      time: item.routine?.time ?? "",
      timeUserSet: item.routine?.timeUserSet ?? undefined,
      withFood: item.routine?.withFood ?? false,
      startDate: resolveRoutineStartDate(item.routine?.startDate, item.createdAt),
      daysOfWeek: normalizeRoutineDays(item.routine?.daysOfWeek),
    };
    lastSavedRef.current = next;
    setNote(next.note ?? "");
    setTime(next.time || defaultScheduleTime);
    setWithFood(!!next.withFood);
    setSelectedStartDate(next.startDate ?? resolveRoutineStartDate(item.routine?.startDate, item.createdAt));
    setSelectedDaysOfWeek(next.daysOfWeek ?? []);
    setTimeTouched(false);
    setUnsaveArmed(false);
    if (unsaveArmTimerRef.current) clearTimeout(unsaveArmTimerRef.current);
    unsaveArmTimerRef.current = null;
    setOverviewExpanded(false);
    setWhatsInsideExpanded(false);
    setSelectedAnchorKey(null);
    autoAnchorSyncedRef.current = null;
    autosyncedThisSessionRef.current = false;
    setAnchorPrefilled(false);
    setStartDatePickerOpen(false);
    detailOpenedAtRef.current = Date.now();
    odsFirstPaintLoggedRef.current = false;
    const hasExplicitRoutine =
      Boolean(item.routine?.note) ||
      Boolean(item.routine?.time) ||
      item.routine?.withFood !== undefined ||
      Boolean(item.routine?.startDate) ||
      Boolean(item.routine?.daysOfWeek?.length);
    setSaveState(
      hasExplicitRoutine ? "saved" : "idle",
    );
  }, [defaultScheduleTime, item.createdAt, item.id, item.routine?.daysOfWeek, item.routine?.note, item.routine?.startDate, item.routine?.time, item.routine?.timeUserSet, item.routine?.withFood]);

  useEffect(() => {
    if (!unsaveArmed) {
      if (unsaveArmTimerRef.current) clearTimeout(unsaveArmTimerRef.current);
      unsaveArmTimerRef.current = null;
      return;
    }

    if (unsaveArmTimerRef.current) clearTimeout(unsaveArmTimerRef.current);
    unsaveArmTimerRef.current = setTimeout(() => {
      unsaveArmTimerRef.current = null;
      setUnsaveArmed(false);
    }, 3500);

    return () => {
      if (unsaveArmTimerRef.current) clearTimeout(unsaveArmTimerRef.current);
      unsaveArmTimerRef.current = null;
    };
  }, [unsaveArmed]);

  const handleSavePillLabelLayout = useCallback(
    (event: NativeSyntheticEvent<TextLayoutEventData>) => {
      const line = event.nativeEvent.lines?.[0];
      if (!line) return;
      const labelPadding = 26 * 2; // matches styles.saveBtn paddingHorizontal
      const minWidth = 108;
      const maxWidth = Math.max(minWidth, Math.floor(screenWidth - 48));
      const next = Math.min(maxWidth, Math.max(minWidth, Math.ceil(line.width + labelPadding)));
      if (savePillWidthRef.current === next) return;
      savePillWidthRef.current = next;
      setSavePillWidth(next);
    },
    [screenWidth],
  );

  useEffect(() => {
    const showEvent = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const showSub = Keyboard.addListener(showEvent, (event) => {
      setDetailKeyboardHeight(event.endCoordinates?.height ?? 0);
    });
    const hideSub = Keyboard.addListener(hideEvent, () => setDetailKeyboardHeight(0));

    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  useEffect(() => {
    let isActive = true;
    const clearPollTimers = () => {
      for (const timer of pollTimersRef.current) clearTimeout(timer);
      pollTimersRef.current = [];
    };
    const userSupplementId = isUuid(item.id) ? item.id : null;

    const isNewItem = lastDetailItemIdRef.current !== item.id;
    lastDetailItemIdRef.current = item.id;
    if (isNewItem) {
      setFacts(null);
      setFactsStatus("none");
      setFactsDigestHash(null);
      factsDigestHashRef.current = null;
      setFactsSourceVersion(null);
      setFactsRefreshExhausted(false);
      setFactsRefreshRetryNonce(0);
      factsRefreshLoopActiveRef.current = false;
      lastFactsRefreshAtRef.current = 0;
      factsRefreshSessionIdRef.current = null;
    }

    // Reset AI enhancement state for each open and for each manual retry.
    clearPollTimers();
    setAnalysisData(null);
    setAiStatus("none");
    setAiRetryAfterSec(0);
    setAiBlockedReason(null);
    aiUiPhaseRef.current = "idle";
    setAiUiPhase("idle");

    const finalizeFacts = (
      supplementId: string,
      payload: MySupplementFactsV1,
      meta?: {
        factsStatus?: "full" | "partial" | "none";
        factsDigestHash?: string | null;
        factsSourceVersion?: string | null;
      },
    ) => {
      factsCache.set(supplementId, payload);
      if (!isActive) return;
      setFacts(payload);
      const nextFactsStatus = meta?.factsStatus ?? computeOverviewFactsStatus(payload, item.barcode ?? null);
      setFactsStatus(nextFactsStatus);
      const nextHash = meta?.factsDigestHash ?? payload.factsDigestHash ?? null;
      if (nextFactsStatus === "full") {
        setFactsRefreshExhausted(false);
        setFactsRefreshRetryNonce(0);
      } else if (nextHash && nextHash !== factsDigestHashRef.current) {
        setFactsRefreshExhausted(false);
        setFactsRefreshRetryNonce(0);
      }
      factsDigestHashRef.current = nextHash;
      setFactsDigestHash(nextHash);
      setFactsSourceVersion(meta?.factsSourceVersion ?? payload.factsSourceVersion ?? null);
    };

    const finalizeReady = (supplementId: string, payload: AnalysisPayload, digestHash?: string | null) => {
      const resolvedHash = digestHash ?? extractFactsDigestHashFromAnalysisPayload(payload);
      analysisCache.set(supplementId, { factsDigestHash: resolvedHash, data: payload });
      clearPollTimers();
      if (!isActive) return;
      setAnalysisData(payload);
      setAiStatus("ready");
      setAiRetryAfterSec(0);
      setAiBlockedReason(null);
      aiUiPhaseRef.current = "ready";
      setAiUiPhase("ready");
    };

    const finalizePending = () => {
      if (!isActive) return;
      setAiStatus("pending");
      setAiRetryAfterSec(0);
      setAiBlockedReason(null);
      aiUiPhaseRef.current = "pending";
      setAiUiPhase("pending");
    };

    const finalizeBlocked = (retryAfterSec: number, reason: string | null) => {
      clearPollTimers();
      if (!isActive) return;
      setAiStatus("blocked");
      setAiRetryAfterSec(Math.max(0, retryAfterSec));
      setAiBlockedReason(reason);
      aiUiPhaseRef.current = "blocked";
      setAiUiPhase("blocked");
      setAnalysisData(null);
    };

    const finalizeNone = () => {
      clearPollTimers();
      if (!isActive) return;
      setAiStatus("none");
      setAiRetryAfterSec(0);
      setAiBlockedReason(null);
      aiUiPhaseRef.current = "none";
      setAiUiPhase("none");
      setAnalysisData(null);
    };

    const finalizeTimeout = () => {
      clearPollTimers();
      if (!isActive) return;
      setAiStatus("pending");
      setAiRetryAfterSec(0);
      setAiBlockedReason(null);
      aiUiPhaseRef.current = "timeout";
      setAiUiPhase("timeout");
      setAnalysisData(null);
    };

    const fetchLatestHashMatched = async (
      supplementId: string,
      currentFactsDigestHash: string | null,
    ): Promise<AnalysisPayload | null> => {
      if (!currentFactsDigestHash) return null;
      const { data, error } = await supabase
        .from("ai_analyses")
        .select("analysis_data, created_at")
        .eq("supplement_id", supplementId)
        .is("user_id", null)
        .order("created_at", { ascending: false })
        .limit(5);

      if (error) {
        throw new Error(error.message);
      }

      const rows = Array.isArray(data) ? data : [];
      for (const row of rows) {
        const payload = ((row as any)?.analysis_data ?? null) as AnalysisPayload | null;
        if (!payload) continue;
        const hash = extractFactsDigestHashFromAnalysisPayload(payload);
        if (hash && hash === currentFactsDigestHash) return payload;
      }
      return null;
    };

    const startPendingPoll = (supplementId: string, currentFactsDigestHash: string | null) => {
      if (!currentFactsDigestHash) {
        finalizeTimeout();
        return;
      }

      finalizePending();
      clearPollTimers();
      factsDigestHashRef.current = currentFactsDigestHash;

      const runAttempt = async (): Promise<boolean> => {
        try {
          if (factsDigestHashRef.current !== currentFactsDigestHash) return false;
          const payload = await fetchLatestHashMatched(supplementId, currentFactsDigestHash);
          if (factsDigestHashRef.current !== currentFactsDigestHash) return false;
          if (!isActive || aiUiPhaseRef.current !== "pending") return false;
          if (!payload) return false;
          finalizeReady(supplementId, payload, currentFactsDigestHash);
          return true;
        } catch (error) {
          if (!isActive || aiUiPhaseRef.current !== "pending") return false;
          const message = error instanceof Error ? error.message : "Unknown error";
          console.warn("[supplement-overview] Failed to poll analysis", message);
          return false;
        }
      };

      void runAttempt().then((hit) => {
        if (!isActive || hit || aiUiPhaseRef.current !== "pending") return;
        const scheduleMs = [1000, 2000, 3000, 4000];
        let elapsed = 0;
        scheduleMs.forEach((slot, index) => {
          elapsed += slot;
          const jitter = Math.floor(Math.random() * 401) - 200;
          const delay = Math.max(0, elapsed + jitter);
          const timer = setTimeout(async () => {
            if (!isActive || aiUiPhaseRef.current !== "pending") return;
            const found = await runAttempt();
            if (found) return;
            if (index === scheduleMs.length - 1) finalizeTimeout();
          }, delay);
          pollTimersRef.current.push(timer);
        });
      });
    };

    const applyEnsureResponse = async (
      fallbackSupplementId: string | null,
      ensured: EnsureOverviewResponse | null,
    ) => {
      if (!ensured) {
        finalizeTimeout();
        return;
      }

      const supplementId = ensured.supplementId ?? fallbackSupplementId;
      if (!supplementId) {
        finalizeTimeout();
        return;
      }

      const responseFacts = ensured.facts ?? null;
      const responseFactsDigestHash =
        ensured.factsDigestHash ?? responseFacts?.factsDigestHash ?? null;
      const responseFactsSourceVersion =
        ensured.factsSourceVersion ?? responseFacts?.factsSourceVersion ?? null;
      const responseFactsStatus =
        ensured.factsStatus ?? computeOverviewFactsStatus(responseFacts, item.barcode ?? null);

      if (responseFacts) {
        finalizeFacts(supplementId, responseFacts, {
          factsStatus: responseFactsStatus,
          factsDigestHash: responseFactsDigestHash,
          factsSourceVersion: responseFactsSourceVersion,
        });
      } else if (isActive) {
        setFactsStatus(responseFactsStatus);
        factsDigestHashRef.current = responseFactsDigestHash;
        setFactsDigestHash(responseFactsDigestHash);
        setFactsSourceVersion(responseFactsSourceVersion);
      }

      const inlinePayload = ensured.analysisData ?? null;
      const inlineHash = extractFactsDigestHashFromAnalysisPayload(inlinePayload);
      if (inlinePayload && responseFactsDigestHash && inlineHash === responseFactsDigestHash) {
        finalizeReady(supplementId, inlinePayload, responseFactsDigestHash);
        return;
      }

      const derivedStatus: "ready" | "pending" | "blocked" | "none" =
        ensured.aiStatus ?? (ensured.analysisReady ? "ready" : "none");

      if (derivedStatus === "ready") {
        const cached = analysisCache.get(supplementId);
        if (cached && cached.factsDigestHash && cached.factsDigestHash === responseFactsDigestHash) {
          finalizeReady(supplementId, cached.data, responseFactsDigestHash);
          return;
        }
        const payload = await fetchLatestHashMatched(supplementId, responseFactsDigestHash);
        if (payload) {
          finalizeReady(supplementId, payload, responseFactsDigestHash);
          return;
        }
        finalizeNone();
        return;
      }

      if (derivedStatus === "blocked") {
        finalizeBlocked(
          typeof ensured.aiRetryAfterSec === "number" ? ensured.aiRetryAfterSec : 0,
          typeof ensured.aiBlockedReason === "string" ? ensured.aiBlockedReason : null,
        );
        return;
      }

      if (derivedStatus === "pending") {
        startPendingPoll(supplementId, responseFactsDigestHash);
        return;
      }

      finalizeNone();
    };

    const load = async () => {
      const dosageShort = formatSavedDoseForDisplay(item.dosageText);
      const barcode = item.barcode?.trim() || null;
      const lookupSupplementId = getOverviewLookupSupplementId(item.supplementId, barcode);
      const persistResolvedSupplementId = (nextSupplementId: string | null) => {
        if (!nextSupplementId || item.supplementId === nextSupplementId) return;
        void updateSupplement(item.id, { supplementId: nextSupplementId }).catch((error) => {
          const message = error instanceof Error ? error.message : "Unknown error";
          console.warn("[supplement-overview] Failed to persist supplementId", message);
        });
      };

      let supplementId = lookupSupplementId;
      if (supplementId) {
        const cachedFacts = factsCache.get(supplementId);
        if (cachedFacts && isActive) {
          finalizeFacts(supplementId, cachedFacts, {
            factsStatus: computeOverviewFactsStatus(cachedFacts, barcode),
            factsDigestHash: cachedFacts.factsDigestHash ?? null,
            factsSourceVersion: cachedFacts.factsSourceVersion ?? null,
          });
        }
      }

      // Re-resolve identity from barcode for older saved items before trusting a cached supplementId.
      if (!supplementId) {
        const ensured = await ensureOverview({
          supplementId: null,
          barcode,
          brandName: item.brandName ?? null,
          productName: item.productName,
          dosageText: dosageShort,
          userSupplementId,
        });

        supplementId = ensured?.supplementId ?? null;
        if (supplementId && ensured?.facts) {
          finalizeFacts(supplementId, ensured.facts);
        }

        persistResolvedSupplementId(supplementId);

        if (!isActive) return;
        if (!supplementId) {
          finalizeTimeout();
          return;
        }
        await applyEnsureResponse(supplementId, ensured);
        return;
      }

      try {
        const ensured = await ensureOverview({
          supplementId: lookupSupplementId,
          barcode,
          brandName: item.brandName ?? null,
          productName: item.productName,
          dosageText: dosageShort,
          userSupplementId,
        });

        if (!isActive) return;
        persistResolvedSupplementId(ensured?.supplementId ?? supplementId);
        await applyEnsureResponse(supplementId, ensured);
      } catch (error) {
        if (!isActive) return;
        const message = error instanceof Error ? error.message : "Unknown error";
        console.warn("[supplement-overview] Failed to load analysis", message);
        finalizeTimeout();
      }
    };

    void load()
      .catch((error) => {
        if (!isActive) return;
        const message = error instanceof Error ? error.message : "Unknown error";
        console.warn("[supplement-overview] Unhandled load error", message);
        finalizeTimeout();
      });

    return () => {
      isActive = false;
      clearPollTimers();
    };
  }, [
    item.id,
    item.supplementId,
    item.barcode,
    item.brandName,
    item.productName,
    item.dosageText,
    updateSupplement,
  ]);

  useEffect(() => {
    let isActive = true;
    const timers: Array<ReturnType<typeof setTimeout>> = [];

    const barcode = item.barcode?.trim() ?? "";
    if (
      factsStatus !== "partial" ||
      !barcode ||
      (factsRefreshExhausted && factsRefreshRetryNonce === 0) ||
      factsRefreshLoopActiveRef.current
    ) {
      return () => {
        isActive = false;
        timers.forEach((timer) => clearTimeout(timer));
      };
    }

    factsRefreshLoopActiveRef.current = true;
    const scheduleMs = [2000, 5000, 10000];
    const expectedHash = factsDigestHash ?? null;
    const dosageShort = formatSavedDoseForDisplay(item.dosageText);
    const userSupplementId = isUuid(item.id) ? item.id : null;
    const refreshStartedAt = Date.now();
    let attemptsUsed = 0;
    let exhaustedByAttempts = false;
    const sessionId =
      factsRefreshSessionIdRef.current ??
      `${item.id}:${(factsDigestHash ?? "none").slice(0, 8)}:${refreshStartedAt.toString(36)}`;
    factsRefreshSessionIdRef.current = sessionId;

    const refreshOnce = async () => {
      const now = Date.now();
      if (now - lastFactsRefreshAtRef.current < 1500) {
        return false;
      }
      lastFactsRefreshAtRef.current = now;
      attemptsUsed += 1;
      const attempt = attemptsUsed;
      const aiPhaseBefore = aiUiPhaseRef.current;
      let outcome: "no_facts" | "resolved_full" | "resolved_partial" | "hash_changed" | "error" = "resolved_partial";
      let resolvedSupplementIdForAttempt = getOverviewLookupSupplementId(item.supplementId, barcode);

      try {
        const ensured = await ensureOverview({
          supplementId: resolvedSupplementIdForAttempt,
          barcode,
          brandName: item.brandName ?? null,
          productName: item.productName,
          dosageText: dosageShort,
          userSupplementId,
        });
        if (!ensured?.facts) {
          outcome = "no_facts";
          return false;
        }
        if (!isActive) return true;

        resolvedSupplementIdForAttempt = ensured.supplementId ?? resolvedSupplementIdForAttempt;
        if (resolvedSupplementIdForAttempt && resolvedSupplementIdForAttempt !== item.supplementId) {
          void updateSupplement(item.id, { supplementId: resolvedSupplementIdForAttempt }).catch((error) => {
            const message = error instanceof Error ? error.message : "Unknown error";
            console.warn("[supplement-facts] Failed to persist refreshed supplementId", message);
          });
        }

        const nextFacts = ensured.facts;
        const nextFactsStatus = ensured.factsStatus ?? computeOverviewFactsStatus(nextFacts, barcode);
        const nextHash = ensured.factsDigestHash ?? nextFacts.factsDigestHash ?? null;

        if (expectedHash && factsDigestHashRef.current && factsDigestHashRef.current !== expectedHash) {
          outcome = "hash_changed";
          return true;
        }

        setFacts(nextFacts);
        setFactsStatus(nextFactsStatus);
        setFactsSourceVersion(ensured.factsSourceVersion ?? nextFacts.factsSourceVersion ?? null);
        factsDigestHashRef.current = nextHash;
        setFactsDigestHash(nextHash);
        if (resolvedSupplementIdForAttempt) {
          factsCache.set(resolvedSupplementIdForAttempt, nextFacts);
        }

        if (nextFactsStatus === "full") {
          setFactsRefreshExhausted(false);
          setFactsRefreshRetryNonce(0);
          outcome = "resolved_full";
          return true;
        }
        outcome = "resolved_partial";
        return false;
      } catch (error) {
        outcome = "error";
        throw error;
      } finally {
        console.info("[supplement-facts-refresh-attempt]", {
          metric: "facts_refresh_attempt",
          sessionId,
          supplementId: resolvedSupplementIdForAttempt,
          factsDigestHash: expectedHash,
          attempt,
          aiPhaseBefore,
          aiPhaseAfter: aiUiPhaseRef.current,
          outcome,
        });
      }
    };

    const run = async () => {
      for (let i = 0; i < scheduleMs.length; i += 1) {
        if (!isActive) return;
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, scheduleMs[i]);
          timers.push(timer);
        });
        if (!isActive) return;
        const resolved = await refreshOnce().catch((error) => {
          const message = error instanceof Error ? error.message : "Unknown error";
          console.warn("[supplement-facts] refresh failed", message);
          return false;
        });
        if (resolved || !isActive) return;
      }
      if (isActive) {
        setFactsRefreshExhausted(true);
        exhaustedByAttempts = true;
        console.info("[supplement-facts-refresh]", {
          metric: "facts_partial_session_stuck_rate",
          sessionId,
          supplementId: item.supplementId ?? null,
          factsDigestHash: expectedHash,
          attempts: attemptsUsed,
          exhausted: true,
          durationMs: Date.now() - refreshStartedAt,
        });
      }
    };

    void run()
      .then(() => {
        if (!isActive) return;
        if (!exhaustedByAttempts) {
          console.info("[supplement-facts-refresh]", {
            metric: "facts_refresh_attempts_avg",
            sessionId,
            supplementId: item.supplementId ?? null,
            factsDigestHash: expectedHash,
            attempts: attemptsUsed,
            exhausted: false,
            durationMs: Date.now() - refreshStartedAt,
          });
        }
      })
      .catch((error) => {
        if (!isActive) return;
        const message = error instanceof Error ? error.message : "Unknown error";
        console.warn("[supplement-facts-refresh] loop failed", message);
      })
      .finally(() => {
        factsRefreshLoopActiveRef.current = false;
      });

    return () => {
      isActive = false;
      timers.forEach((timer) => clearTimeout(timer));
      factsRefreshLoopActiveRef.current = false;
    };
  }, [
    factsDigestHash,
    factsRefreshExhausted,
    factsRefreshRetryNonce,
    factsStatus,
    item.barcode,
    item.brandName,
    item.dosageText,
    item.id,
    item.productName,
    item.supplementId,
  ]);

  useEffect(() => {
    if (saveState !== "saved") return;
    const last = lastSavedRef.current;
    const noteChanged = (last.note || "") !== (note || "");
    const timeChanged = (last.time || "") !== (time || "");
    const foodChanged = (last.withFood ?? false) !== (withFood ?? false);
    const startDateChanged = (last.startDate || initialStartDate) !== selectedStartDate;
    const daysChanged = !areRoutineDaysEqual(last.daysOfWeek, selectedDaysOfWeek);
    if (noteChanged || timeChanged || foodChanged || startDateChanged || daysChanged) setSaveState("idle");
  }, [initialStartDate, note, saveState, selectedDaysOfWeek, selectedStartDate, time, withFood]);

  useEffect(() => {
    // Cancel "Unsave" confirmation if anything changes.
    if (!unsaveArmed) return;
    setUnsaveArmed(false);
  }, [note, saveState, selectedDaysOfWeek, selectedStartDate, time, withFood]);

  const routineTimeUserSet = resolveRoutineTimeUserSet(item.routine);
  const savedTime = routineTimeUserSet && item.routine?.time?.trim() ? item.routine.time : null;
  const timeCategory = getTimeCategory(savedTime ?? undefined);
  const showTimeCategoryPill = shouldShowScheduleTimeCategoryPill(savedTime, Boolean(timeCategory));
  const selectedDayLabels = selectedDaysOfWeek
    .map((value) => ROUTINE_DAY_OPTIONS.find((option) => option.value === value)?.summaryLabel ?? null)
    .filter((value): value is string => Boolean(value));
  const weekdaySelectionSummary =
    formatRoutineDaySummary(selectedDayLabels);
  const todayDateKey = useMemo(() => getLocalDateKey(new Date()), []);
  const startDateDisplayLabel = useMemo(
    () => formatRoutineStartDateLabel(selectedStartDate, todayDateKey),
    [selectedStartDate, todayDateKey],
  );
  const startDateSummaryText = useMemo(() => {
    const prefix = startDateDisplayLabel === "Today" ? "today" : `on ${startDateDisplayLabel}`;
    if (selectedDaysOfWeek.length > 0) {
      const dayVerb = selectedDaysOfWeek.length === 1 ? "is" : "are";
      return `Check-ins start ${prefix}. Only ${weekdaySelectionSummary} ${dayVerb} scheduled for Daily Check-in, streaks, achievements, and reminders.`;
    }
    return `Check-ins start ${prefix} and stay eligible every day after that.`;
  }, [selectedDaysOfWeek.length, startDateDisplayLabel, weekdaySelectionSummary]);

  const toggleDaysOfWeek = (day: RoutineDayOfWeek) => {
    setSelectedDaysOfWeek((prev) => {
      const current = normalizeRoutineDays(prev);
      if (current.includes(day)) {
        return current.filter((value) => value !== day);
      }
      return normalizeRoutineDays([...current, day]);
    });
  };

  const handleSave = async () => {
    const nextTimeUserSet = Boolean(time?.trim()) && (timeTouched || routineTimeUserSet);
    const prefs: RoutinePreferences = {
      note,
      time,
      timeUserSet: nextTimeUserSet,
      withFood,
      startDate: selectedStartDate,
      ...(selectedDaysOfWeek.length ? { daysOfWeek: selectedDaysOfWeek } : {}),
      ...(item.routine?.whenToTake ? { whenToTake: item.routine.whenToTake } : {}),
      ...(item.routine?.howToTake ? { howToTake: item.routine.howToTake } : {}),
    };
    lastSavedRef.current = prefs;
    try {
      await onSaveRoutine?.(item.id, prefs);
      if (timeTouched && suggestedRoutine.timingKind === "meal_based") {
        const manualSlot = nearestMealSlotForTime(time, mealTimePrefs ?? null);
        if (manualSlot) {
          await onLearnMealTimePref?.(manualSlot, time, "manual");
        }
      }
      const overrideEvents = buildScheduleOverrideEvents({
        scheduleDefaults,
        selectedStartDate,
        todayKey: todayDateKey,
        selectedDaysOfWeek,
        time,
        mealTimePrefs,
      });
      if (overrideEvents.length > 0) {
        await onRecordOverrideEvents?.(overrideEvents);
      }
      if (smartFilterAnalyticsContext) {
        onTrackSmartFilterEvent?.("smart_filter_evaluated_schedule_saved", {
          productId: smartFilterAnalyticsContext.productId,
          activeTags: smartFilterAnalyticsContext.activeTags,
          filteredCount: smartFilterAnalyticsContext.filteredCount,
          searchQuery: smartFilterAnalyticsContext.searchQuery || null,
          bucket: smartFilterAnalyticsContext.membership.bucket,
          highlightedGoal: smartFilterAnalyticsContext.membership.highlightedGoal ?? null,
          rankEligible: smartFilterAnalyticsContext.membership.eligibility?.rankEligible ?? null,
          hasStartDate: Boolean(selectedStartDate),
          daysOfWeekCount: selectedDaysOfWeek.length,
          withFood,
        });
      }
    } finally {
      setTimeTouched(false);
      setSaveState("saved");
    }
  };

  const handleUnsave = async () => {
    const cleared: RoutinePreferences = {};
    lastSavedRef.current = cleared;
    try {
      await onSaveRoutine?.(item.id, cleared);
    } finally {
      // Reset UI to a clean "Not set" baseline.
      setNote("");
      setTime("08:00");
      setWithFood(false);
      setSelectedStartDate(resolveRoutineStartDate(undefined, item.createdAt));
      setSelectedDaysOfWeek([]);
      setTimeTouched(false);
      setAnchorPrefilled(false);
      setSaveState("idle");
      setUnsaveArmed(false);
      if (unsaveArmTimerRef.current) clearTimeout(unsaveArmTimerRef.current);
      unsaveArmTimerRef.current = null;
    }
  };

  const handleSavePillPress = () => {
    if (saveState !== "saved") {
      void handleSave();
      return;
    }
    if (!unsaveArmed) {
      setUnsaveArmed(true);
      return;
    }
    void handleUnsave();
  };

  const analysisRoot = (() => {
    const raw = analysisData ?? null;
    const nested = raw?.analysis ?? null;
    if (nested && (nested.efficacy || nested.usage || nested.usagePayload)) {
      // Some older payloads nest usage/efficacy under `analysis`. Keep V2 fields if they exist at the root.
      return {
        ...nested,
        mySupplementOverviewV2: raw?.mySupplementOverviewV2 ?? nested.mySupplementOverviewV2 ?? null,
      };
    }
    return raw;
  })();
  const usage = (analysisRoot?.usagePayload?.usage ?? analysisRoot?.usage ?? null) as AnalysisUsage | null;
  const efficacy = (analysisRoot?.efficacy ?? null) as AnalysisEfficacy | null;

  const localDose = formatSavedDoseForDisplay(item.dosageText);
  const authoritativeFactDoses = useMemo(
    () =>
      collectDisplayableFactDoses({
        actives: facts?.actives ?? [],
        overlayIngredients: facts?.overlay?.ingredients ?? [],
      }),
    [facts?.actives, facts?.overlay?.ingredients],
  );
  const detailDose = authoritativeFactDoses[0] ?? localDose;

  const fallback = buildLocalOverviewFallback({
    productName: item.productName,
    dosageText: detailDose,
  });

  const coreBenefits = Array.isArray(efficacy?.coreBenefits)
    ? efficacy?.coreBenefits.filter((benefit) => isNonEmptyString(benefit)).slice(0, 3)
    : [];
  const normalizedBenefit = coreBenefits[0]?.replace(/[.!?]+$/g, "").replace(/^supports?\s+/i, "").trim() ?? "";
  const benefitSummary = normalizedBenefit
    ? normalizeTwoSentenceSummary(
        `${item.productName} is commonly used to support ${normalizedBenefit}. Follow the product label for dosing and timing.`,
      )
    : "";

  const aiV2 = (analysisRoot?.mySupplementOverviewV2 ?? null) as MySupplementOverviewV2 | null;
  const aiNotice = Array.isArray(aiV2?.whatYouMayNotice)
    ? aiV2.whatYouMayNotice.filter(isNonEmptyString).slice(0, 3)
    : [];
  const aiWatchOuts = Array.isArray(aiV2?.watchOuts) ? aiV2.watchOuts.filter(isNonEmptyString).slice(0, 4) : [];
  const aiRetryAfterLabel = formatRetryAfterLabel(aiRetryAfterSec);

  const factsTimingHint = (() => {
    const hints = facts?.directions?.parsed?.timingHints ?? [];
    if (hints.includes("bedtime")) return "Bedtime";
    if (hints.includes("evening")) return "Evening";
    if (hints.includes("morning")) return "Morning";
    if (hints.includes("with_meals") || hints.includes("after_meals")) return "With a meal";
    if (hints.includes("before_meals")) return "Before meals";
    return null;
  })();

  const factsWithMeals = facts?.directions?.parsed?.withMeals ?? null;
  const timingHints = facts?.directions?.parsed?.timingHints ?? [];
  const labelHasWithMealsSignal = timingHints.includes("with_meals") || timingHints.includes("after_meals");
  const activeNames = (facts?.actives ?? []).map((active) => active?.name ?? "").filter(isNonEmptyString);
  const timingSuggestion = buildTimingSuggestion({
    factsStatus,
    labelRawText: facts?.directions?.rawText ?? null,
    usageTiming: usage?.timing ?? null,
    factsTimingHint,
    fallbackTiming: fallback.timing,
    usageWithFood: usage?.withFood ?? null,
    factsWithMeals,
    fallbackWithFood: fallback.withFood,
    usageWithFoodReason: usage?.withFoodReason ?? null,
    labelHasWithMealsSignal,
    activeNames,
  });

  const displayBrandName = pickFirstText(facts?.overlay?.brandName, facts?.product?.brandDisplay, item.brandName);
  const whatsInsideDisplay = buildWhatsInsideDisplay({
    actives: facts?.actives ?? [],
    dosageText: localDose,
    productName: item.productName,
    overlayIngredients: facts?.overlay?.ingredients ?? [],
    allowInference: false,
    allowDoseOnly: false,
  });
  const overlayOverview = buildOverlayOverviewSupport(facts?.overlay?.description);
  const labelDirectionsRaw = typeof facts?.directions?.rawText === "string" ? facts.directions.rawText.trim() : "";
  const overlaySuggestedUseRaw =
    typeof facts?.overlay?.suggestedUse === "string" ? facts.overlay.suggestedUse.trim() : "";
  const labelDirectionsFallbackRaw = overlaySuggestedUseRaw ? "" : labelDirectionsRaw;
  const howToUseTitle = overlaySuggestedUseRaw ? "How to use (Manufacturing Claim)" : "How to use";
  const howToUseText = overlaySuggestedUseRaw || labelDirectionsFallbackRaw;
  const howToUseMetaText = !howToUseText
    ? factsStatus === "full"
      ? "Use instructions aren't available from iHerb or the label yet."
      : "Usage details are still loading."
    : null;
  const suggestedRoutine = buildSuggestedRoutineV0({
    parsed: facts?.directions?.parsed ?? null,
    parseConfidence: facts?.directions?.parseConfidence ?? null,
    rawDirectionsText: facts?.directions?.rawText ?? null,
    withFoodFallback: timingSuggestion.withFood,
    timingKind: timingSuggestion.kind,
    existingRoutineTime: item.routine?.time ?? null,
    existingTimeUserSet: routineTimeUserSet,
    mealTimePrefs: mealTimePrefs ?? null,
  });
  const selectableSuggestedSlots = !suggestedRoutine.requiresManualTime && suggestedRoutine.slots.length > 1
    ? suggestedRoutine.slots
    : [];

  useEffect(() => {
    const authoritativeDose = authoritativeFactDoses[0] ?? null;
    if (!authoritativeDose) return;

    const currentDose = formatSavedDoseForDisplay(item.dosageText);
    if (currentDose === authoritativeDose) return;

    if (currentDose) {
      const factDoseKeys = new Set(authoritativeFactDoses.map((dose) => normalizeKey(dose)));
      if (factDoseKeys.has(normalizeKey(currentDose))) return;
    }

    const repairKey = `${item.id}:${authoritativeDose}`;
    if (authoritativeDoseRepairRef.current === repairKey) return;
    authoritativeDoseRepairRef.current = repairKey;

    updateSupplement(item.id, { dosageText: authoritativeDose }).catch(() => {
      if (authoritativeDoseRepairRef.current === repairKey) {
        authoritativeDoseRepairRef.current = null;
      }
    });
  }, [authoritativeFactDoses, item.id, item.dosageText, updateSupplement]);
  const defaultSelectedSuggestedSlot =
    selectableSuggestedSlots.find((slot) =>
      suggestedSlotMatchesTimingAnchors(slot, scheduleDefaults.suggestedTimingAnchors),
    ) ??
    selectableSuggestedSlots.find((slot) => isAnchorSlotActive(slot, suggestedRoutine.applyAnchor)) ??
    selectableSuggestedSlots[0] ??
    null;
  const selectedSuggestedSlot =
    selectedAnchorKey && selectableSuggestedSlots.some((slot) => getSuggestedSlotKey(slot) === selectedAnchorKey)
      ? selectableSuggestedSlots.find((slot) => getSuggestedSlotKey(slot) === selectedAnchorKey) ?? null
      : defaultSelectedSuggestedSlot;
  const scheduleDefaultsSummary = buildScheduleDefaultsSummary(scheduleDefaults);
  const defaultAnchorSummary = scheduleDefaults.suggestedTimingAnchors[0]
    ? getTimingAnchorDisplayLabel(scheduleDefaults.suggestedTimingAnchors[0])
    : null;

  useEffect(() => {
    if (selectedAnchorKey || savedTime || selectableSuggestedSlots.length === 0) return;
    const preferredAnchor = scheduleDefaults.suggestedTimingAnchors[0];
    if (!preferredAnchor) return;

    const match = selectableSuggestedSlots.find((slot) => {
      const slotKey = normalizeKey(slot.label);
      const anchorKey = normalizeKey(preferredAnchor);
      if (slotKey === anchorKey) return true;
      if (anchorKey === "morning" && slotKey === "breakfast") return true;
      if (anchorKey === "evening" && (slotKey === "dinner" || slotKey === "bedtime")) return true;
      return false;
    });

    if (match) {
      setSelectedAnchorKey(getSuggestedSlotKey(match));
    }
  }, [savedTime, scheduleDefaults.suggestedTimingAnchors, selectableSuggestedSlots, selectedAnchorKey]);

  const effectiveApplyAnchor = suggestedRoutine.requiresManualTime
    ? {
        ...suggestedRoutine.applyAnchor,
        time,
        withFood,
      }
    : selectedSuggestedSlot ?? suggestedRoutine.applyAnchor;
  const applyCopy = buildApplyCopy({
    requiresManualTime: suggestedRoutine.requiresManualTime,
    timesPerDaySource: suggestedRoutine.timesPerDaySource,
    timesPerDaySuggested: suggestedRoutine.timesPerDaySuggested,
    displayMode: suggestedRoutine.displayMode,
    anchor: effectiveApplyAnchor,
  });
  const applySuggestionButtonText = applyCopy.buttonText;
  const effectiveApplyNotice = applyCopy.notice;
  const showAddLabelDirectionsCta = !howToUseText && factsStatus === "full";
  const handleAddLabelDirections = () => {
    if (!note.trim()) {
      setNote("Label directions: ");
    }
    requestAnimationFrame(() => {
      const scrollY = Math.max(0, noteSectionYRef.current - 24);
      sheetScrollRef.current?.scrollTo({ y: scrollY, animated: true });
      setTimeout(() => noteInputRef.current?.focus(), 160);
    });
  };
  const handleChooseFlexibleTime = () => {
    requestAnimationFrame(() => {
      const scrollY = Math.max(0, timeSectionYRef.current - 24);
      sheetScrollRef.current?.scrollTo({ y: scrollY, animated: true });
    });
  };
  const handleCheckFactsAgain = () => {
    setFactsRefreshExhausted(false);
    setFactsRefreshRetryNonce((value) => value + 1);
  };

  const odsFactHit = getOdsFactForSupplement({
    activeNames: (facts?.actives ?? []).map((active) => active?.name ?? ""),
    productName: item.productName,
  });
  const hasOdsFoundation = Boolean(odsFactHit);
  const nonOdsFactHit = !hasOdsFoundation
    ? getNonOdsFactForSupplement({
        activeNames: (facts?.actives ?? []).map((active) => active?.name ?? ""),
        productName: item.productName,
      })
    : null;
  const hasNonOdsFoundation = Boolean(nonOdsFactHit);
  const foundationWhatItDoesBullets = (
    hasOdsFoundation ? odsFactHit?.entry.whatItDoes : nonOdsFactHit?.entry.whatItDoes
  )?.filter(isNonEmptyString).slice(0, 3) ?? [];
  const foundationSourceUrl = hasOdsFoundation ? odsFactHit?.entry.sourceUrl ?? null : nonOdsFactHit?.entry.sourceUrl ?? null;
  const foundationSourceTitle = hasOdsFoundation ? odsFactHit?.displayTitle ?? null : nonOdsFactHit?.entry.sourceLabel ?? null;
  const showSuggestedPlanCard = shouldShowSuggestedPlanCard(savedTime);

  useEffect(() => {
    const metricKey = `${item.id}:${factsDigestHash ?? "none"}:${timingSuggestion.source}`;
    if (timingSourceMetricKeyRef.current === metricKey) return;
    timingSourceMetricKeyRef.current = metricKey;
    console.info("[timing-source-metric]", {
      metric: "timing_source_rate",
      supplementId: item.supplementId ?? null,
      factsDigestHash: factsDigestHash ?? null,
      source: timingSuggestion.source,
      kind: timingSuggestion.kind,
    });
  }, [factsDigestHash, item.id, item.supplementId, timingSuggestion.kind, timingSuggestion.source]);

  useEffect(() => {
    const metricKey = `${item.id}:${factsDigestHash ?? "none"}:${suggestedRoutine.requiresManualTime ? "flex" : "meal"}`;
    if (suggestedPlanMetricKeyRef.current === metricKey) return;
    suggestedPlanMetricKeyRef.current = metricKey;
    console.info("[suggested-plan-metric]", {
      metric: "flexible_mode_rate",
      supplementId: item.supplementId ?? null,
      factsDigestHash: factsDigestHash ?? null,
      requiresManualTime: suggestedRoutine.requiresManualTime,
      timingKind: suggestedRoutine.timingKind,
      source: suggestedRoutine.source,
      confidence: suggestedRoutine.confidence,
    });
  }, [
    factsDigestHash,
    item.id,
    item.supplementId,
    suggestedRoutine.confidence,
    suggestedRoutine.requiresManualTime,
    suggestedRoutine.source,
    suggestedRoutine.timingKind,
  ]);

  useEffect(() => {
    const foundationResult = hasOdsFoundation ? "ods" : hasNonOdsFoundation ? "curated" : "miss";
    const metricKey = `${item.id}:${factsDigestHash ?? "none"}:${foundationResult}`;
    if (odsFallbackMetricKeyRef.current === metricKey) return;
    odsFallbackMetricKeyRef.current = metricKey;
    console.info("[ods-foundation-metric]", {
      metric: hasOdsFoundation ? "ods_foundation_hit_rate" : hasNonOdsFoundation ? "non_ods_foundation_hit_rate" : "ods_foundation_miss_rate",
      supplementId: item.supplementId ?? null,
      factsDigestHash: factsDigestHash ?? null,
      result: foundationResult,
    });
  }, [factsDigestHash, hasNonOdsFoundation, hasOdsFoundation, item.id, item.supplementId]);

  useEffect(() => {
    if ((!hasOdsFoundation && !hasNonOdsFoundation) || odsFirstPaintLoggedRef.current) return;
    odsFirstPaintLoggedRef.current = true;
    const firstPaintMs = Math.max(0, Date.now() - detailOpenedAtRef.current);
    const late = firstPaintMs > 300;
    console.info("[ods-first-paint]", {
      metric: "ods_first_paint_ms",
      supplementId: item.supplementId ?? null,
      factsDigestHash: factsDigestHash ?? null,
      valueMs: firstPaintMs,
      thresholdMs: 300,
    });
    console.info("[ods-late-hit]", {
      metric: "ods_late_hit_rate",
      supplementId: item.supplementId ?? null,
      factsDigestHash: factsDigestHash ?? null,
      late,
      valueMs: firstPaintMs,
      thresholdMs: 300,
    });
  }, [factsDigestHash, hasNonOdsFoundation, hasOdsFoundation, item.supplementId]);

  useEffect(() => {
    const metricKey = `${item.id}:${factsDigestHash ?? "none"}:${showSuggestedPlanCard ? "show" : "hide"}`;
    if (savedSuggestedHiddenMetricKeyRef.current === metricKey) return;
    savedSuggestedHiddenMetricKeyRef.current = metricKey;
    console.info("[saved-suggested-card-metric]", {
      metric: "saved_item_suggested_hidden_rate",
      supplementId: item.supplementId ?? null,
      factsDigestHash: factsDigestHash ?? null,
      hidden: !showSuggestedPlanCard,
      saved: Boolean(savedTime),
    });
  }, [factsDigestHash, item.id, item.supplementId, savedTime, showSuggestedPlanCard]);

  useEffect(() => {
    const metricKey = `${item.id}:${factsDigestHash ?? "none"}:${suggestedRoutine.timesPerDaySource}`;
    if (timesPerDaySourceMetricKeyRef.current === metricKey) return;
    timesPerDaySourceMetricKeyRef.current = metricKey;
    console.info("[times-per-day-source-metric]", {
      metric: "times_per_day_label_source_rate",
      supplementId: item.supplementId ?? null,
      factsDigestHash: factsDigestHash ?? null,
      timesPerDaySource: suggestedRoutine.timesPerDaySource,
    });
  }, [factsDigestHash, item.id, item.supplementId, suggestedRoutine.timesPerDaySource]);

  useEffect(() => {
    const autosync = shouldRunAnchorAutosync({
      itemId: item.id,
      factsDigestHash,
      savedTime,
      timeTouched,
      requiresManualTime: suggestedRoutine.requiresManualTime,
      anchor: effectiveApplyAnchor,
      lastSyncKey: autoAnchorSyncedRef.current,
    });
    if (!autosync.shouldSync) return;
    autoAnchorSyncedRef.current = autosync.syncKey;
    autosyncedThisSessionRef.current = true;
    setAnchorPrefilled(true);
    const patch = buildAutosyncPatch(effectiveApplyAnchor);
    setTime(patch.time);
    setWithFood(patch.withFood);
    console.info("[schedule-anchor-autosync]", {
      metric: "schedule_anchor_autosync_rate",
      supplementId: item.supplementId ?? null,
      factsDigestHash: factsDigestHash ?? null,
      anchorLabel: effectiveApplyAnchor.label,
      anchorTime: effectiveApplyAnchor.time,
      withFood: effectiveApplyAnchor.withFood,
      displayMode: suggestedRoutine.displayMode,
    });
  }, [
    effectiveApplyAnchor.label,
    effectiveApplyAnchor.time,
    effectiveApplyAnchor.withFood,
    factsDigestHash,
    item.id,
    savedTime,
    suggestedRoutine.requiresManualTime,
    timeTouched,
  ]);

  const handleApplySuggestedRoutine = async () => {
    if (!suggestedRoutine.slots.length) return;
    const anchor = effectiveApplyAnchor;
    const prefs: RoutinePreferences = {
      note,
      time: anchor.time,
      timeUserSet: true,
      withFood: anchor.withFood,
      whenToTake: suggestedRoutine.whenToTake,
      howToTake: suggestedRoutine.howToTake,
    };

    setTime(anchor.time);
    setWithFood(anchor.withFood);
    setTimeTouched(true);
    lastSavedRef.current = prefs;
    try {
      await onSaveRoutine?.(item.id, prefs);
      console.info("[schedule-apply-conversion]", {
        metric: "schedule_apply_conversion",
        supplementId: item.supplementId ?? null,
        requiresManualTime: suggestedRoutine.requiresManualTime,
        timingKind: suggestedRoutine.timingKind,
        source: suggestedRoutine.source,
        confidence: suggestedRoutine.confidence,
        withFood: anchor.withFood,
      });
      console.info("[schedule-apply-autosync]", {
        metric: "apply_after_autosync_rate",
        supplementId: item.supplementId ?? null,
        afterAutosync: autosyncedThisSessionRef.current,
        displayMode: suggestedRoutine.displayMode,
      });
      if (smartFilterAnalyticsContext) {
        onTrackSmartFilterEvent?.("smart_filter_evaluated_schedule_saved", {
          productId: smartFilterAnalyticsContext.productId,
          activeTags: smartFilterAnalyticsContext.activeTags,
          filteredCount: smartFilterAnalyticsContext.filteredCount,
          searchQuery: smartFilterAnalyticsContext.searchQuery || null,
          bucket: smartFilterAnalyticsContext.membership.bucket,
          highlightedGoal: smartFilterAnalyticsContext.membership.highlightedGoal ?? null,
          rankEligible: smartFilterAnalyticsContext.membership.eligibility?.rankEligible ?? null,
          conversionType: "suggested_routine_apply",
          timingKind: suggestedRoutine.timingKind,
          source: suggestedRoutine.source,
          withFood: anchor.withFood,
        });
      }
      if (
        suggestedRoutine.timingKind === "meal_based" &&
        (anchor.label === "Breakfast" || anchor.label === "Lunch" || anchor.label === "Dinner" || anchor.label === "Bedtime")
      ) {
        await onLearnMealTimePref?.(anchor.label, anchor.time, "seed");
      }
      const overrideEvents = buildScheduleOverrideEvents({
        scheduleDefaults,
        selectedStartDate,
        todayKey: todayDateKey,
        selectedDaysOfWeek,
        time: anchor.time,
        mealTimePrefs,
      });
      if (overrideEvents.length > 0) {
        await onRecordOverrideEvents?.(overrideEvents);
      }
    } finally {
      setSaveState("saved");
    }
  };

  const whatItDoesCandidate = pickOverviewTextCandidate({
    productName: item.productName,
    candidates: [
      { source: "ods", text: hasOdsFoundation ? odsFactHit?.entry.overview ?? "" : "" },
      { source: "curated", text: hasNonOdsFoundation ? nonOdsFactHit?.entry.overview ?? "" : "" },
      { source: "overlay", text: overlayOverview.summary },
      { source: "ai", text: typeof aiV2?.whatItIs === "string" ? aiV2.whatItIs.trim() : "" },
      { source: "efficacy", text: efficacy?.overviewSummary ? normalizeTwoSentenceSummary(efficacy.overviewSummary) : "" },
      { source: "benefit", text: benefitSummary },
      { source: "fallback", text: fallback.summary },
    ],
  });
  const whatItDoesText = whatItDoesCandidate.text;
  const whatItDoesBullets = foundationWhatItDoesBullets.length > 0
    ? foundationWhatItDoesBullets
    : whatItDoesCandidate.source === "overlay"
      ? overlayOverview.bullets
      : [];
  const whatItDoesSourceTitle =
    whatItDoesCandidate.source === "overlay" ? "iHerb product page (Manufacturing Claim)" : foundationSourceTitle;
  const whatItDoesSourceUrl =
    whatItDoesCandidate.source === "overlay" ? facts?.overlay?.link ?? null : foundationSourceUrl;

  const watchOutLines = (() => {
    const fromFacts = (facts?.warnings?.bullets ?? []).filter(isNonEmptyString).slice(0, 6);
    const fromFoundation = (
      hasOdsFoundation ? odsFactHit?.entry.watchOuts : nonOdsFactHit?.entry.watchOuts
    )?.filter(isNonEmptyString) ?? [];
    const fallbackWatchOuts = fromFacts.length > 0 ? [] : fromFoundation.length > 0 ? fromFoundation : aiWatchOuts;
    const merged = [...fromFacts, ...fallbackWatchOuts];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const line of merged) {
      const key = normalizeKey(line);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(line);
      if (out.length >= 6) break;
    }
    return out;
  })();

  useEffect(() => {
    const metricKey = `${item.id}:${factsDigestHash ?? "none"}:${whatItDoesCandidate.usedPlaceholder ? "placeholder" : "resolved"}`;
    if (whatItDoesMetricKeyRef.current === metricKey) return;
    whatItDoesMetricKeyRef.current = metricKey;
    console.info("[what-it-does-metric]", {
      metric: "what_it_does_placeholder_rate",
      supplementId: item.supplementId ?? null,
      factsDigestHash: factsDigestHash ?? null,
      placeholder: whatItDoesCandidate.usedPlaceholder,
      source: whatItDoesCandidate.source,
    });
    if (hasOdsFoundation) {
      console.info("[ods-quality-metric]", {
        metric: "ods_overview_reject_rate",
        supplementId: item.supplementId ?? null,
        factsDigestHash: factsDigestHash ?? null,
        rejected: Boolean(odsFactHit?.qualityRejected),
      });
      console.info("[ods-quality-metric]", {
        metric: "ods_bullet_reject_rate",
        supplementId: item.supplementId ?? null,
        factsDigestHash: factsDigestHash ?? null,
        expected: 3,
        rendered: whatItDoesBullets.length,
      });
    }
  }, [
    factsDigestHash,
    whatItDoesBullets.length,
    hasOdsFoundation,
    item.id,
    item.supplementId,
    odsFactHit?.qualityRejected,
    whatItDoesCandidate.source,
    whatItDoesCandidate.usedPlaceholder,
  ]);

  const stackOverlapLines = (() => {
    const overlaps = Array.isArray(stackOverlaps) ? stackOverlaps : [];
    return overlaps
      .map((entry) => {
        const currentSupplementId = item.supplementId ?? "";
        const otherSupplements = entry.supplements.filter(
          (supplement) => supplement.supplementId && supplement.supplementId !== currentSupplementId,
        );
        const otherCount = otherSupplements.length > 0 ? otherSupplements.length : Math.max(0, entry.count - 1);
        if (otherCount <= 0) {
          return `${entry.ingredientDisplay} appears in more than one saved supplement.`;
        }
        return `${entry.ingredientDisplay} also appears in ${otherCount} other saved supplement${otherCount === 1 ? "" : "s"}.`;
      })
      .slice(0, 5);
  })();
  const surfacedDuplicateGroups = useMemo(
    () => (Array.isArray(duplicateGroups) ? duplicateGroups.filter((group) => group?.surfaced) : []),
    [duplicateGroups],
  );
  const hasStackSafetyWarning = Boolean(stackSafetySummary?.headline) && surfacedDuplicateGroups.length > 0;
  const hasAnyStackSafetySignal = hasStackSafetyWarning || stackOverlapLines.length > 0;
  const showLockedStackSafety = Boolean(stackSafetyLocked && hasAnyStackSafetySignal);
  const overviewDetailsLoading = (factsStatus === "partial" && !factsRefreshExhausted) || aiUiPhase === "pending";
  const overviewDetailsReady =
    !overviewDetailsLoading &&
    (whatItDoesBullets.length > 0 ||
      watchOutLines.length > 0 ||
      aiNotice.length > 0 ||
      hasAnyStackSafetySignal ||
      stackOverlapLines.length > 0 ||
      aiUiPhase === "ready");
  const showOverviewToggle =
    overviewDetailsLoading ||
    overviewDetailsReady ||
    watchOutLines.length > 0 ||
    aiUiPhase === "blocked" ||
    aiUiPhase === "none";
  const whatsInsideLinesForDisplay = whatsInsideExpanded
    ? whatsInsideDisplay.lines
    : whatsInsideDisplay.lines.slice(0, Math.max(0, whatsInsideDisplay.previewLimit));
  const whatsInsideOverflowCount = Math.max(0, whatsInsideDisplay.hiddenCount);
  const showWhatsInsideToggle =
    (whatsInsideDisplay.source === "overlay" || whatsInsideDisplay.source === "actives") &&
    whatsInsideOverflowCount > 0;
  const goalFitCard = useMemo(
    () =>
      buildGoalFitCard({
        evaluation: savedProductEvaluation,
        goalKey: selectedGoalKey,
        stackOverlapCount: stackOverlaps?.length ?? 0,
      }),
    [savedProductEvaluation, selectedGoalKey, stackOverlaps],
  );
  const compareEntryList = useMemo(() => {
    if (!goalFitCard) return compareEntries ?? [];

    const currentEntry: GoalCompareEntry = {
      productId: item.id,
      goalKey: goalFitCard.goalKey,
      title: item.productName,
      brandName: formatBrandForPill(displayBrandName),
      dosageText: detailDose ?? undefined,
      tier: goalFitCard.tier,
      confidence: goalFitCard.confidence,
      whyFit: goalFitCard.whyFit,
      whyNotStronger: goalFitCard.whyNotStronger,
      holdbacks: goalFitCard.holdbacks,
    };

    const peers = (compareEntries ?? []).filter((entry) => entry.productId !== item.id);
    return [currentEntry, ...peers].slice(0, 3);
  }, [compareEntries, detailDose, displayBrandName, goalFitCard, item.id, item.productName]);

  useEffect(() => {
    if (!PERSONALIZATION_RESEARCH_UI_ENABLED || !goalFitCard) return;
    const trackKey = [
      item.id,
      goalFitCard.goalKey ?? "none",
      goalFitCard.tier,
      compareEntryList.length > 1 ? "compare" : "single",
    ].join(":");
    if (goalFitDetailTrackedKeyRef.current === trackKey) return;
    goalFitDetailTrackedKeyRef.current = trackKey;
    void onTrackPersonalizationEvent?.({
      eventName: "goal_fit_detail_opened",
      surface: "my_saved_detail",
      payload: {
        goalKey: goalFitCard.goalKey ?? null,
        productId: item.id,
        tier: goalFitCard.tier,
        compareEnabled: compareEntryList.length > 1,
      },
    });
  }, [compareEntryList.length, goalFitCard, item.id, onTrackPersonalizationEvent]);

  const handleOpenCompare = useCallback(() => {
    setCompareOpen(true);
    void onTrackPersonalizationEvent?.({
      eventName: "compare_opened",
      surface: "my_saved_detail",
      payload: {
        goalKey: goalFitCard?.goalKey ?? selectedGoalKey ?? null,
        currentProductId: item.id,
        comparedProductCount: compareEntryList.length,
      },
    });
  }, [compareEntryList.length, goalFitCard?.goalKey, item.id, onTrackPersonalizationEvent, selectedGoalKey]);

  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose}>
      <View style={styles.detailOverlay}>
        <BlurView intensity={18} tint="dark" style={StyleSheet.absoluteFillObject} />
        <Pressable style={StyleSheet.absoluteFillObject} onPress={onClose} />

        <MotiView
          from={{ translateY: screenHeight, opacity: 0 }}
          animate={{ translateY: 0, opacity: 1 }}
          exit={{ translateY: screenHeight, opacity: 0 }}
	          transition={{ type: "timing", duration: 320, easing: Easing.out(Easing.cubic) }}
	          style={styles.sheet}
	        >
	          <Pressable onPress={onClose} style={[styles.sheetClose, { top: insets.top + 12 }]}>
	            <X size={20} color="#ffffff" />
	          </Pressable>

	          <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
	            <ScrollView
	              ref={sheetScrollRef}
	              style={{ flex: 1 }}
	              showsVerticalScrollIndicator={false}
	              onScroll={(event) => {
	                sheetScrollYRef.current = event.nativeEvent.contentOffset.y;
	              }}
	              scrollEventThrottle={16}
	              keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
	              keyboardShouldPersistTaps="handled"
	              contentContainerStyle={{ paddingBottom: 40 + insets.bottom + Math.max(0, detailKeyboardHeight) }}
		            >
		            <View style={[styles.sheetHeader, { backgroundColor: theme.bgHex, paddingTop: insets.top + 18 }]}>
		              <View style={{ gap: 12 }}>
		                <View style={styles.sheetHeaderRow}>
		                  {theme.icon === "sun" ? (
		                    <Sun size={18} color={theme.textColor} />
                  ) : (
                    <Moon size={18} color={theme.textColor} />
                  )}
                  <Text style={[styles.sheetHeaderLabel, { color: theme.textColor }]}>Collection Detail</Text>
                </View>

                <Text style={[styles.sheetTitle, { color: theme.textColor }]}>{item.productName}</Text>

	                <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
	                  <View style={[styles.sheetTag, styles.brandPillClamp, { borderColor: theme.tagBorderColor }]}>
	                    <Text
	                      style={[styles.sheetTagText, styles.pillTextClamp, { color: theme.textColor }]}
	                      numberOfLines={1}
	                    >
	                      {formatBrandForPill(displayBrandName)}
	                    </Text>
	                  </View>
	                  {(() => {
	                    if (!detailDose) return null;
	                    return (
	                      <View style={[styles.sheetTag, styles.dosePillClamp, { borderColor: theme.tagBorderColor }]}>
	                        <Text
	                          style={[styles.sheetTagText, styles.pillTextClamp, { color: theme.textColor }]}
	                          numberOfLines={1}
	                        >
	                          {detailDose}
	                        </Text>
	                      </View>
	                    );
	                  })()}
                  {hasAnyStackSafetySignal ? (
                    <View style={[styles.sheetTag, styles.sheetStackSafetyPill]}>
                      <Text style={[styles.sheetTagText, styles.sheetStackSafetyPillText]} numberOfLines={1}>
                        Stack overlap
                      </Text>
                    </View>
                  ) : null}
	                </View>
              </View>
            </View>

            <View style={styles.sheetBody}>
              <View style={{ gap: 12 }}>
                <View style={styles.sectionHead}>
                  <Text style={styles.sectionTitle}>Overview</Text>
                </View>

                <View style={styles.glassBlock}>
                  <View style={[StyleSheet.absoluteFillObject, { backgroundColor: theme.glassTint }]} />
                  <View style={styles.glassRing}>
                    <BlurView intensity={24} tint="light" style={StyleSheet.absoluteFillObject} />
                    <View style={styles.glassRingBorder} />
                    <LinearGradient
                      colors={[
                        "rgba(255,255,255,0.40)",
                        "rgba(255,255,255,0.12)",
                        "rgba(255,255,255,0.00)",
                      ]}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}
                      style={StyleSheet.absoluteFillObject}
                    />
                    <View pointerEvents="none" style={styles.glassHighlightEdge} />
                  </View>

	                  <View style={styles.overviewContent}>
	                    <View style={{ gap: 18 }}>
	                      <View style={{ gap: 10 }}>
	                        <View style={styles.overviewSectionTitleRow}>
	                          <Text style={styles.overviewSectionTitle}>{"What's inside"}</Text>
                          {whatsInsideDisplay.badgeLabel ? (
                            <View style={styles.overviewInferredBadge}>
                              <Text style={styles.overviewInferredBadgeText}>{whatsInsideDisplay.badgeLabel}</Text>
                            </View>
                          ) : null}
                        </View>
	                        {whatsInsideDisplay.source === "overlay" ||
                          whatsInsideDisplay.source === "actives" ? (
	                          <View style={{ gap: 10 }}>
	                            {whatsInsideLinesForDisplay.map((line) => (
	                              <View key={line} style={styles.overviewBulletRow}>
	                                <View style={styles.overviewBulletDot} />
	                                <Text style={styles.overviewBulletText}>{line}</Text>
	                              </View>
	                            ))}
                            {showWhatsInsideToggle ? (
                              <Pressable
                                accessibilityLabel={whatsInsideExpanded ? "Show fewer ingredients" : `Show ${whatsInsideOverflowCount} more ingredients`}
                                onPress={() => setWhatsInsideExpanded((value) => !value)}
                                style={styles.overviewToggleBtn}
                              >
                                <Text style={styles.overviewToggleText}>
                                  {whatsInsideExpanded ? "Show less" : `+${whatsInsideOverflowCount} more`}
                                </Text>
                              </Pressable>
                            ) : null}
	                            {whatsInsideDisplay.metaText ? (
	                              <Text style={styles.overviewMetaText}>{whatsInsideDisplay.metaText}</Text>
	                            ) : null}
                          </View>
                        ) : (
                          <Text style={styles.overviewMetaText}>
                            Ingredient and dosage details aren&apos;t available from iHerb or structured facts yet.
                          </Text>
                        )}
                      </View>

	                      <View style={{ gap: 10 }}>
	                        <Text style={styles.overviewSectionTitle}>{howToUseTitle}</Text>
                          {howToUseText ? (
	                          <Text style={styles.overviewBulletText}>{howToUseText}</Text>
                          ) : null}
                          {howToUseMetaText ? (
                            <Text style={styles.overviewMetaText}>{howToUseMetaText}</Text>
                          ) : null}
                          {showAddLabelDirectionsCta ? (
                            <Pressable onPress={handleAddLabelDirections} style={styles.addLabelCtaBtn}>
                              <Text style={styles.addLabelCtaText}>Add label directions</Text>
                            </Pressable>
                          ) : null}
                      </View>

	                      <View style={{ gap: 10 }}>
	                        <Text style={styles.overviewSectionTitle}>What it does</Text>
		                        <Text style={styles.overviewSummary}>
	                            {whatItDoesText}
	                          </Text>
                        {overviewExpanded && whatItDoesBullets.length > 0 ? (
                          <View style={{ gap: 8 }}>
                            {whatItDoesBullets.map((line) => (
                              <View key={line} style={styles.overviewBulletRow}>
                                <View style={styles.overviewBulletDot} />
                                <Text style={styles.overviewBulletText}>{formatSentence(line)}</Text>
                              </View>
                            ))}
                          </View>
                        ) : null}
	                      </View>

	                      {overviewExpanded && aiNotice.length > 0 ? (
	                        <View style={{ gap: 10 }}>
	                          <Text style={styles.overviewSectionTitle}>What you may notice</Text>
	                          <View style={{ gap: 10 }}>
                            {aiNotice.map((item) => (
                              <View key={item} style={styles.overviewBulletRow}>
                                <View style={styles.overviewBulletDot} />
                                <Text style={styles.overviewBulletText}>{formatSentence(item)}</Text>
                              </View>
                            ))}
                          </View>
                        </View>
                      ) : null}

		                      {overviewExpanded && watchOutLines.length > 0 ? (
		                        <View style={{ gap: 10 }}>
		                          <Text style={styles.overviewSectionTitle}>Watch outs</Text>
		                          <View style={{ gap: 10 }}>
		                            {watchOutLines.map((line) => (
		                              <View key={line} style={styles.overviewBulletRow}>
		                                <View style={styles.overviewBulletDot} />
		                                <Text style={styles.overviewBulletText}>{formatSentence(line)}</Text>
		                              </View>
		                            ))}
	                          </View>
	                        </View>
	                      ) : null}

	                      {overviewExpanded && showLockedStackSafety ? (
	                        <View style={{ gap: 10 }}>
	                          <Text style={styles.overviewSectionTitle}>Stack Safety Check</Text>
                            <Pressable
                              style={styles.lockedStackSafetyCard}
                              onPress={onOpenStackSafetyPaywall}
                            >
                              <View style={styles.lockedStackSafetyIcon}>
                                <Lock size={16} color="#0f172a" />
                              </View>
                              <View style={styles.lockedStackSafetyTextWrap}>
                                <Text style={styles.lockedStackSafetyTitle}>Unlock stack safety</Text>
                                <Text style={styles.lockedStackSafetyBody}>
                                  Check repeated ingredients and dose overlaps across your saved stack.
                                </Text>
                              </View>
                              <ArrowRight size={18} color="#64748b" />
                            </Pressable>
	                        </View>
	                      ) : null}

	                      {overviewExpanded && !showLockedStackSafety && hasStackSafetyWarning ? (
	                        <View style={{ gap: 10 }}>
	                          <Text style={styles.overviewSectionTitle}>Stack Safety Check</Text>
                            {stackSafetySummary ? (
                              <SavedStackSafetySummary summary={stackSafetySummary} meta={stackSafetyMeta ?? null} />
                            ) : null}
                            <View style={{ gap: 10 }}>
                              {surfacedDuplicateGroups.map((group) => (
                                <DuplicateIngredientGroupCard
                                  key={group.ingredientCanonicalKey}
                                  group={group}
                                />
                              ))}
                            </View>
	                        </View>
	                      ) : null}

	                      {overviewExpanded && !showLockedStackSafety && !hasStackSafetyWarning && stackOverlapLines.length > 0 ? (
	                        <View style={{ gap: 10 }}>
	                          <Text style={styles.overviewSectionTitle}>Stack overlaps</Text>
	                          <View style={{ gap: 10 }}>
                            {stackOverlapLines.map((line) => (
                              <View key={line} style={styles.overviewBulletRow}>
                                <View style={styles.overviewBulletDot} />
                                <Text style={styles.overviewBulletText}>{line}</Text>
                              </View>
                            ))}
	                          </View>
	                        </View>
	                      ) : null}

		                      {showOverviewToggle ? (
		                        <Pressable
		                          style={styles.overviewToggleBtn}
		                          onPress={() => setOverviewExpanded((value) => !value)}
		                        >
	                          <Text style={styles.overviewToggleText}>
	                            {overviewExpanded
	                              ? "Show less"
	                              : overviewDetailsLoading
	                              ? "Show more (loading...)"
	                              : overviewDetailsReady
	                              ? "Show more · Ready"
	                              : "Show more"}
		                          </Text>
		                        </Pressable>
		                      ) : null}

		                      {overviewExpanded && whatItDoesSourceTitle ? (
		                        whatItDoesSourceUrl ? (
		                          <Pressable
		                            onPress={() => {
		                              void Linking.openURL(whatItDoesSourceUrl).catch((error) => {
		                                const message = error instanceof Error ? error.message : "Unknown error";
		                                console.warn("[ods-fallback] Failed to open source URL", message);
		                              });
		                            }}
		                            style={styles.overviewSourceLinkBtn}
		                          >
		                            <Text style={styles.overviewSourceLinkText}>{whatItDoesSourceTitle}</Text>
		                          </Pressable>
		                        ) : (
		                          <View style={styles.overviewSourceLinkBtn}>
		                            <Text style={styles.overviewSourceLinkText}>{whatItDoesSourceTitle}</Text>
		                          </View>
		                        )
		                      ) : null}
	                        {factsStatus === "partial" && factsRefreshExhausted ? (
	                          <Pressable onPress={handleCheckFactsAgain} style={styles.addLabelCtaBtn}>
	                            <Text style={styles.addLabelCtaText}>Check again</Text>
	                          </Pressable>
                        ) : null}

	                      {overviewExpanded && aiUiPhase === "pending" ? (
	                        <View style={{ gap: 12, marginTop: 6 }}>
	                          <Text style={styles.overviewPlaceholder}>Generating AI insights...</Text>
	                          <View style={styles.overviewSkeletonLine} />
	                          <View style={[styles.overviewSkeletonLine, { width: "70%" }]} />
	                        </View>
	                      ) : overviewExpanded && overviewDetailsLoading ? (
                        <Text style={styles.overviewMetaText}>Loading more details...</Text>
	                      ) : overviewExpanded && aiUiPhase === "blocked" ? (
	                        <View style={{ gap: 8, marginTop: 6 }}>
	                          <Text style={styles.overviewMetaText}>
	                            {aiRetryAfterLabel
                              ? `AI insights temporarily unavailable. Try again in ${aiRetryAfterLabel}.`
                              : "AI insights temporarily unavailable. Try again later."}
                          </Text>
                          {aiBlockedReason ? (
                            <Text style={styles.overviewMetaText}>Reason: {aiBlockedReason}</Text>
                          ) : null}
                        </View>
		                      ) : overviewExpanded && aiUiPhase === "none" ? (
	                        <View style={{ marginTop: 6 }}>
	                          <Text style={styles.overviewMetaText}>
	                            AI insights are currently unavailable. Facts are shown above.
                          </Text>
                        </View>
                      ) : null}
                    </View>
                  </View>
                </View>
              </View>

              {PERSONALIZATION_RESEARCH_UI_ENABLED && goalFitCard ? (
                <GoalFitScorecard
                  card={goalFitCard}
                  tintColor={theme.glassTint}
                  compareEnabled={compareEntryList.length > 1}
                  onOpenCompare={compareEntryList.length > 1 ? handleOpenCompare : undefined}
                />
              ) : null}

              <View style={{ marginTop: 24 }}>
                <View style={styles.routineBlock}>
                  <View style={[StyleSheet.absoluteFillObject, { backgroundColor: theme.glassTint }]} />
                  <View style={styles.routineRing}>
                    <BlurView intensity={24} tint="light" style={StyleSheet.absoluteFillObject} />
                    <View style={styles.glassRingBorder} />
                    <LinearGradient
                      colors={[
                        "rgba(255,255,255,0.35)",
                        "rgba(255,255,255,0.10)",
                        "rgba(255,255,255,0.00)",
                      ]}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}
                      style={StyleSheet.absoluteFillObject}
                    />
                    <View pointerEvents="none" style={styles.glassHighlightEdge} />
                  </View>

                  <View style={styles.routineContent}>
	                    <View style={styles.scheduleHeaderRow}>
	                      <View style={styles.scheduleTitleRow}>
	                        <Clock size={16} color="#94a3b8" />
	                        <Text style={styles.scheduleTitle}>Schedule</Text>
	                      </View>
	                      <AnimatePresence>
	                        {showTimeCategoryPill && timeCategory ? (
	                          <MotiView
                            from={{ opacity: 0, translateX: 10 }}
                            animate={{ opacity: 1, translateX: 0 }}
                            exit={{ opacity: 0, translateX: 10 }}
                            transition={{ type: "timing", duration: 180 }}
                            style={[styles.timeCategoryPill, timeCategory.pillStyle]}
                          >
                            <Text style={[styles.timeCategoryText, { color: timeCategory.textColor }]}>{timeCategory.label}</Text>
	                          </MotiView>
	                        ) : null}
	                      </AnimatePresence>
	                    </View>

	                    <View style={{ gap: 20, marginTop: 16 }}>
	                      <Text style={styles.scheduleHintText}>
	                        {buildScheduleHintText({ savedTime, autosyncedPrefill: anchorPrefilled })}
	                      </Text>
                        <Text style={styles.schedulePersonalizationHint}>{scheduleDefaultsSummary}</Text>
                        {showSuggestedPlanCard ? (
                          <View style={styles.suggestedRoutineCard}>
	                          <View style={styles.suggestedRoutineHeader}>
	                            <Text style={styles.suggestedRoutineTitle}>Suggested plan</Text>
	                          </View>
	                          <Text style={styles.suggestedRoutineRationale}>
                              {renderHighlightedSuggestedText(suggestedRoutine.rationale)}
                            </Text>
                            {selectableSuggestedSlots.length > 1 ? (
                              <Text style={styles.suggestedRoutineChoiceHint}>
                                Choose which reminder time to save. Daily Check-in still counts this supplement once per day.
                              </Text>
                            ) : null}
                            {defaultAnchorSummary ? (
                              <Text style={styles.suggestedRoutineChoiceHint}>
                                Personalized default anchor: {defaultAnchorSummary}.
                              </Text>
                            ) : null}
	                          <View style={styles.suggestedRoutineSlots}>
	                            {suggestedRoutine.requiresManualTime ? (
	                              <Text style={styles.suggestedRoutineSlotText}>
                                  <Text style={styles.suggestedRoutineSlotLabelText}>Flexible</Text>
                                  <Text style={styles.suggestedRoutineSlotDividerText}> · </Text>
                                  <Text style={styles.suggestedRoutineSlotTimeText}>choose time</Text>
                                </Text>
	                            ) : (
	                              suggestedRoutine.slots.map((slot, idx) => (
	                                  <Pressable
                                    key={`${slot.label}-${slot.time}-${idx}`}
                                    disabled={selectableSuggestedSlots.length <= 1}
                                    onPress={() => setSelectedAnchorKey(getSuggestedSlotKey(slot))}
                                    style={[
                                      styles.suggestedRoutineSlotRow,
                                      isAnchorSlotActive(slot, effectiveApplyAnchor)
                                        ? styles.suggestedRoutineSlotRowActive
                                        : null,
                                    ]}
                                  >
	                                  <Text
                                      style={[
                                        styles.suggestedRoutineSlotText,
	                                      isAnchorSlotActive(slot, effectiveApplyAnchor)
	                                        ? styles.suggestedRoutineSlotTextActive
	                                        : null,
                                      ]}
                                    >
	                                    <Text style={styles.suggestedRoutineSlotLabelText}>{slot.label}</Text>
                                        <Text style={styles.suggestedRoutineSlotDividerText}> · </Text>
                                        <Text style={styles.suggestedRoutineSlotTimeText}>{slot.time}</Text>
                                        {slot.withFood ? (
                                          <>
                                            <Text style={styles.suggestedRoutineSlotDividerText}> · </Text>
                                            <Text style={styles.suggestedRoutineSlotFoodText}>with food</Text>
                                          </>
                                        ) : null}
	                                  </Text>
                                  </Pressable>
	                              ))
	                            )}
	                          </View>
                          {suggestedRoutine.requiresManualTime ? (
                            <Pressable onPress={handleChooseFlexibleTime} style={styles.chooseTimeBtn}>
                              <Text style={styles.chooseTimeText}>Choose time</Text>
	                            </Pressable>
	                          ) : null}
	                          <Pressable onPress={handleApplySuggestedRoutine} style={styles.applySuggestionBtn}>
	                            <Text style={styles.applySuggestionText}>{applySuggestionButtonText}</Text>
	                          </Pressable>
	                          {effectiveApplyNotice ? (
	                            <Text style={styles.suggestedRoutineNotice}>{effectiveApplyNotice}</Text>
	                          ) : null}
	                        </View>
	                        ) : null}
	                        <View style={styles.startDateSection}>
	                          <Pressable
	                            accessibilityRole="button"
	                            accessibilityLabel="Choose start date"
	                            onPress={() => setStartDatePickerOpen(true)}
	                            style={styles.startDateRow}
	                          >
	                            <View style={styles.startDateRowTextWrap}>
	                              <Text style={styles.startDateTitle}>Start date</Text>
	                              <Text style={styles.startDateCaption}>When this supplement begins counting</Text>
	                            </View>
	                            <View style={styles.startDateValueWrap}>
	                              <CalendarDays size={16} color="#64748b" />
	                              <Text style={styles.startDateValueText}>{startDateDisplayLabel}</Text>
	                              <ArrowRight size={14} color="#94a3b8" />
	                            </View>
	                          </Pressable>
	                        </View>
	                        <View style={styles.weekdaySection}>
	                          <View style={styles.weekdayHeaderRow}>
	                            <Text style={styles.weekdayTitle}>Days of week</Text>
                              <Text style={styles.weekdayCaption}>Use this only if you do not take it every day.</Text>
                          </View>

                          <View style={styles.weekdayChipRow}>
                            {ROUTINE_DAY_OPTIONS.map((option) => {
                              const isSelected = selectedDaysOfWeek.includes(option.value);
                              return (
                                <Pressable
                                  key={`weekday-${option.value}`}
                                  accessibilityRole="button"
                                  accessibilityLabel={`Toggle ${option.label}`}
                                  onPress={() => toggleDaysOfWeek(option.value)}
                                  style={[
                                    styles.weekdayChip,
                                    isSelected && styles.weekdayChipActive,
                                  ]}
                                >
                                  <Text
                                    style={[
                                      styles.weekdayChipText,
                                      isSelected && styles.weekdayChipTextActive,
                                    ]}
                                  >
                                    {option.label}
                                  </Text>
                                </Pressable>
                              );
                            })}
                            <Pressable
                              accessibilityRole="button"
                              accessibilityLabel="Set supplement to every day"
                              onPress={() => setSelectedDaysOfWeek([])}
                              style={[
                                styles.weekdayShortcutChip,
                                selectedDaysOfWeek.length === 0 && styles.weekdayShortcutChipActive,
                              ]}
                            >
                              <Text
                                style={[
                                  styles.weekdayShortcutText,
                                  selectedDaysOfWeek.length === 0 && styles.weekdayShortcutTextActive,
                                ]}
                              >
                                Every day
                              </Text>
                            </Pressable>
	                          </View>

	                          <Text style={styles.weekdayHelpText}>
	                            {startDateSummaryText}
	                          </Text>
	                        </View>
                        <View
                          onLayout={(event) => {
                            timeSectionYRef.current = event.nativeEvent.layout.y;
                          }}
                        >
	                      <TimePicker
                            value={time}
                            onChange={(nextTime) => {
                              setTime(nextTime);
                              setTimeTouched(true);
                            }}
                          />
                        </View>

                      <Pressable
                        style={styles.foodToggleRow}
                        onPress={() => setWithFood((prev) => !prev)}
                      >
                        <View style={[styles.foodToggleTrack, withFood && styles.foodToggleTrackActive]}>
                          <MotiView
                            style={styles.foodToggleThumb}
                            animate={{ translateX: withFood ? 20 : 0 }}
                            transition={{ type: "spring", stiffness: 500, damping: 30 }}
                          />
                        </View>
                        <Text style={[styles.foodToggleText, withFood && styles.foodToggleTextActive]}>
                          Take with food
                        </Text>
                      </Pressable>
                    </View>

                    <View
                      onLayout={(event) => {
                        noteSectionYRef.current = event.nativeEvent.layout.y;
                      }}
                    >
                      <View style={styles.noteHeaderRow}>
                        <NotebookPen size={16} color="#94a3b8" />
	                    <Text style={styles.noteHeaderText}>Personal Note</Text>
	                  </View>

	                  <TextInput
	                    ref={noteInputRef}
	                    value={note}
	                    onChangeText={setNote}
	                    onFocus={() => {
	                      setTimeout(() => {
	                        // Never scroll upwards on focus (can feel like it "jumps" to the top).
	                        const targetY = Math.max(0, noteSectionYRef.current - 80);
	                        const currentY = sheetScrollYRef.current;
	                        if (targetY <= currentY + 4) return;
	                        sheetScrollRef.current?.scrollTo({ y: targetY, animated: true });
	                      }, 120);
	                    }}
	                    placeholder="Add your notes here (e.g. 'Avoid caffeine')..."
	                    placeholderTextColor="#94a3b8"
	                    multiline
	                    textAlignVertical="top"
	                    style={styles.noteInput}
                      />
                    </View>

		                    <View style={styles.saveRow}>
		                      <View style={styles.saveMeasureWrap} pointerEvents="none">
		                        <Text
		                          onTextLayout={handleSavePillLabelLayout}
		                          style={styles.saveMeasureText}
		                          numberOfLines={1}
		                        >
		                          {unsaveArmed ? "Unsave" : "Save"}
		                        </Text>
		                      </View>
		                      <View style={styles.saveShadow}>
		                        <Pressable onPress={handleSavePillPress}>
		                          <MotiView
		                            style={styles.saveBtn}
		                            animate={{
		                              width: savePillWidth,
		                              backgroundColor:
		                                saveState === "saved"
		                                  ? unsaveArmed
		                                    ? "rgba(239,68,68,0.18)"
		                                    : "rgba(34,197,94,0.18)"
	                                  : "rgba(255,255,255,0.35)",
	                              borderColor:
	                                saveState === "saved"
	                                  ? unsaveArmed
	                                    ? "rgba(239,68,68,0.55)"
	                                    : "rgba(34,197,94,0.55)"
	                                  : "rgba(255,255,255,0.55)",
	                            }}
	                            transition={{ type: "timing", duration: 340 }}
	                          >
	                            <LinearGradient
	                              colors={
	                                saveState === "saved"
	                                  ? unsaveArmed
	                                    ? ["rgba(255,255,255,0.35)", "rgba(239,68,68,0.18)", "rgba(255,255,255,0.00)"]
	                                    : ["rgba(255,255,255,0.35)", "rgba(34,197,94,0.18)", "rgba(255,255,255,0.00)"]
	                                  : ["rgba(255,255,255,0.60)", "rgba(255,255,255,0.20)", "rgba(255,255,255,0.00)"]
	                              }
	                              start={{ x: 0, y: 0 }}
	                              end={{ x: 1, y: 1 }}
	                              style={StyleSheet.absoluteFillObject}
                            />

		                            <View style={styles.saveInner}>
		                              <MotiView
		                                animate={saveState === "saved" ? { opacity: 0, translateY: -4, scale: 0.98 } : { opacity: 1, translateY: 0, scale: 1 }}
		                                transition={{ type: "timing", duration: 280 }}
		                              >
		                                <Text style={styles.saveText} numberOfLines={1}>
		                                  Save
		                                </Text>
		                              </MotiView>

	                              <MotiView
	                                style={styles.saveCheck}
	                                animate={
	                                  saveState === "saved" && !unsaveArmed
	                                    ? { opacity: 1, translateY: 0, scale: 1 }
	                                    : { opacity: 0, translateY: 6, scale: 0.96 }
	                                }
	                                transition={{ type: "timing", duration: 320, delay: saveState === "saved" ? 60 : 0 }}
	                              >
	                                <MotiView
	                                  animate={saveState === "saved" ? { scale: [0.9, 1.06, 1], rotate: ["-2deg", "0deg"] } : { scale: 1, rotate: "0deg" }}
	                                  transition={{ type: "timing", duration: 340 }}
	                                >
	                                  <Check size={20} color="#059669" />
	                                </MotiView>
	                              </MotiView>

		                              <MotiView
		                                style={styles.saveCheck}
		                                animate={
		                                  saveState === "saved" && unsaveArmed
		                                    ? { opacity: 1, translateY: 0, scale: 1 }
	                                    : { opacity: 0, translateY: 6, scale: 0.96 }
	                                }
		                                transition={{ type: "timing", duration: 260 }}
		                              >
		                                <Text
		                                  style={[styles.saveText, { color: "#dc2626" }]}
		                                  numberOfLines={1}
		                                  ellipsizeMode="clip"
		                                >
		                                  Unsave
		                                </Text>
		                              </MotiView>
		                            </View>
		                          </MotiView>
		                        </Pressable>
		                      </View>
		                    </View>

	                    <Text style={styles.note}>Note: Always consult the product label for specific instructions.</Text>
	                  </View>
	                </View>
	              </View>
		            </View>
		          </ScrollView>
		          </KeyboardAvoidingView>
		        </MotiView>
		      </View>
		      <StartDatePickerSheet
		        visible={startDatePickerOpen}
		        selectedDate={selectedStartDate}
		        onSelectDate={setSelectedStartDate}
		        onClose={() => setStartDatePickerOpen(false)}
		      />
          {PERSONALIZATION_RESEARCH_UI_ENABLED ? (
            <CompareSheet
              visible={compareOpen}
              entries={compareEntryList}
              goalKey={goalFitCard?.goalKey}
              tintColor={theme.glassTint}
              onClose={() => setCompareOpen(false)}
            />
          ) : null}
		    </Modal>
		  );
}

function NoteQuickView({
  item,
  onClose,
  onEdit,
}: {
  item: SavedSupplement;
  onClose: () => void;
  onEdit: () => void;
}) {
  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose}>
      <View style={styles.noteOverlay}>
        <Pressable style={StyleSheet.absoluteFillObject} onPress={onClose} />
        <MotiView
          from={{ opacity: 0, translateY: 16 }}
          animate={{ opacity: 1, translateY: 0 }}
          exit={{ opacity: 0, translateY: 12 }}
          transition={{ type: "timing", duration: 220, easing: Easing.out(Easing.cubic) }}
          style={styles.noteModal}
        >
          <View style={styles.noteModalHeader}>
            <View style={styles.noteModalTitleRow}>
              <NotebookPen size={20} color="#2563eb" />
              <Text style={styles.noteModalTitle}>Personal Note</Text>
            </View>
            <Pressable onPress={onClose} style={styles.noteModalClose}>
              <X size={16} color="#475569" />
            </Pressable>
          </View>

          <ScrollView style={styles.noteModalBody} showsVerticalScrollIndicator={false}>
            <Text style={styles.noteModalText}>{item.routine?.note || "No note content."}</Text>
          </ScrollView>

          <View style={styles.noteModalFooter}>
            <Pressable
              onPress={() => {
                onClose();
                setTimeout(onEdit, 150);
              }}
              style={styles.noteModalEdit}
            >
              <Edit2 size={14} color="#64748b" />
              <Text style={styles.noteModalEditText}>Edit in Detail</Text>
            </Pressable>
          </View>
        </MotiView>
      </View>
    </Modal>
  );
}

export function MySupplementView({ data, onDeleteSelected, onSaveRoutine }: Props) {
  const tokens = useScreenTokens(NAV_HEIGHT);
  const { user } = useAuth();
  const {
    snapshot,
    smartFilter,
    scheduleDefaults,
    recordOverrideEvents,
    trackPersonalizationEvent,
    smartFilterEvaluationLoading,
    smartFilterMembershipById,
  } = usePersonalization();
  const { scans } = useScanHistory();
  const { updateSupplement } = useSavedSupplements();
  const premiumAccess = usePremiumAccess();

  const contentBottomPadding = tokens.contentBottomPadding;
  const contentTopPadding = tokens.contentTopPadding;

  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchScheduleOpen, setBatchScheduleOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [filterState, setFilterState] = useState<FilterState>("closed");
  // Backdrop is mounted immediately (blocks touches) but fades in later to match the web sequence.
  const [filterBackdropMounted, setFilterBackdropMounted] = useState(false);
  const [filterBackdropVisible, setFilterBackdropVisible] = useState(false);
  const [activeTags, setActiveTags] = useState<Set<string>>(new Set());
  const [viewingNoteId, setViewingNoteId] = useState<string | null>(null);

  const [userTags, setUserTags] = useState<string[]>([]);
  const [newTagText, setNewTagText] = useState("");
  const [isCreatingTag, setIsCreatingTag] = useState(false);
  const [assigningTag, setAssigningTag] = useState<string | null>(null);
  const [stackOverlapBySupplementId, setStackOverlapBySupplementId] = useState<Map<string, StackOverlapItem[]>>(
    () => new Map(),
  );
  const [stackOverlapCountBySupplementId, setStackOverlapCountBySupplementId] = useState<Map<string, number>>(
    () => new Map(),
  );
  const [stackSafetySummaryBySupplementId, setStackSafetySummaryBySupplementId] = useState<Map<string, StackLevelSafetySummary>>(
    () => new Map(),
  );
  const [duplicateGroupsBySupplementId, setDuplicateGroupsBySupplementId] = useState<Map<string, StackDuplicateGroup[]>>(
    () => new Map(),
  );
  const [stackSafetyMetaBySupplementId, setStackSafetyMetaBySupplementId] = useState<Map<string, StackSafetyMeta>>(
    () => new Map(),
  );
  const [mealTimePrefs, setMealTimePrefs] = useState<MealTimePrefs | null>(null);

  const visibleGoalTags = useMemo(
    () => smartFilter.visibleGoals.map((goalKey) => getGoalDisplayLabel(goalKey)),
    [smartFilter.visibleGoals],
  );
  const seededTypeTags = useMemo(
    () => smartFilter.preselectedTypes.map((typeKey) => getSupplementTypeDisplayLabel(typeKey)),
    [smartFilter.preselectedTypes],
  );
  const highlightedGoalTag = useMemo(
    () => (smartFilter.highlightedGoal ? getGoalDisplayLabel(smartFilter.highlightedGoal) : null),
    [smartFilter.highlightedGoal],
  );
  const goalTagToKey = useMemo(
    () => buildGoalTagToKeyMap(smartFilter.visibleGoals),
    [smartFilter.visibleGoals],
  );
  const typeTagToKey = useMemo(() => buildTypeTagToKeyMap(), []);
  const smartTagCategories = useMemo<TagCategory[]>(() => {
    return SMART_TAG_BASE_CATEGORIES.map((category) =>
      category.title === "Goals" ? { ...category, tags: visibleGoalTags } : category,
    );
  }, [visibleGoalTags]);
  const hasSeededFiltersRef = useRef(false);
  const hasLoggedFirstFilterUseRef = useRef(false);
  const smartFilterExposureKeyRef = useRef<string | null>(null);
  const smartFilterResultsExposureKeyRef = useRef<string | null>(null);
  const evaluatedInteractionByIdRef = useRef<
    Map<
      string,
      {
        goalKey?: GoalKey;
        typeKey?: SupplementTypeKey;
        matchTier?: ReturnType<typeof getMembershipMatchTier>;
        coverageStatus?: SmartFilterProductMembership["coverageStatus"];
        reasonCodes: string[];
      }
    >
  >(new Map());
  const evaluatedExposureKeyRef = useRef<string | null>(null);
  const stackSafetyAlertKeyRef = useRef<string | null>(null);

  const pillWidthRef = useRef(84);
  const [pillWidth, setPillWidth] = useState(84);
  const [brandOverrideById, setBrandOverrideById] = useState<Map<string, string>>(() => new Map());
  const updatedDosageRef = useRef(new Map<string, string>());
  const dosageMetadataBackfillStartedRef = useRef(false);
  const brandMetadataBackfillStartedRef = useRef(false);
  const filterTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const filterScrollRef = useRef<ScrollView>(null);
  const filterWrapRef = useRef<View>(null);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [detailAnalyticsContext, setDetailAnalyticsContext] = useState<SmartFilterEvaluatedDetailAnalyticsContext | null>(null);
  const [filterAnchor, setFilterAnchor] = useState<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);

  const clearFilterTimers = useCallback(() => {
    filterTimersRef.current.forEach((timer) => clearTimeout(timer));
    filterTimersRef.current = [];
  }, []);

  const logStackOverlapEvent = useCallback(
    (event: "stack_overlap_exposed" | "stack_overlap_clicked" | "stack_overlap_action_taken", payload: Record<string, unknown>) => {
      console.info("[stack-overlap-event]", event, payload);
    },
    [],
  );

  const trackSmartFilterEvaluatedEvent = useCallback((event: string, payload: Record<string, unknown>) => {
    const enrichedPayload = {
      surface: "my_saved_smart_filter",
      snapshotId: snapshot.snapshotId,
      rulesVersion: snapshot.rulesVersion,
      ...payload,
    };
    try {
      emitAnalyticsEvent("evaluated-loop", event, enrichedPayload);
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      console.warn("[smart-filter-evaluated-analytics] shared tracker failed", message);
    }
    console.info("[smart-filter-evaluated-analytics]", event, enrichedPayload);
  }, [snapshot.rulesVersion, snapshot.snapshotId]);

  useEffect(() => () => clearFilterTimers(), [clearFilterTimers]);

  useEffect(() => {
    if (hasSeededFiltersRef.current) return;
    if (smartFilterEvaluationLoading) return;
    const seededSmartTags = Array.from(
      new Set<string>([
        ...seededTypeTags,
        ...(highlightedGoalTag ? [highlightedGoalTag] : []),
      ]),
    );
    if (seededSmartTags.length === 0) return;
    if (data.length === 0) return;
    const hasSeedMatch = data.some((item) =>
      seededSmartTags.some((tag) =>
        matchesEvaluatedSmartFilterTag({
          tag,
          membership: smartFilterMembershipById[item.id],
          goalTagToKey,
          typeTagToKey,
        }),
      ),
    );
    if (!hasSeedMatch) {
      hasSeededFiltersRef.current = true;
      return;
    }

    setActiveTags((prev) => {
      if (prev.size > 0) return prev;
      return new Set(seededSmartTags);
    });
    hasSeededFiltersRef.current = true;
  }, [
    data,
    goalTagToKey,
    highlightedGoalTag,
    seededTypeTags,
    smartFilterEvaluationLoading,
    smartFilterMembershipById,
    typeTagToKey,
  ]);

  useEffect(() => {
    if (selectionMode) setExpandedId(null);
  }, [selectionMode]);

  useEffect(() => {
    let isActive = true;
    if (!user?.id) {
      setMealTimePrefs(null);
      return () => {
        isActive = false;
      };
    }

    void loadMealTimePrefs(user.id)
      .then((prefs) => {
        if (!isActive) return;
        setMealTimePrefs(prefs);
      })
      .catch((error) => {
        if (!isActive) return;
        const message = error instanceof Error ? error.message : "Unknown error";
        console.warn("[meal-time-prefs] load failed", message);
      });

    return () => {
      isActive = false;
    };
  }, [user?.id]);

  useEffect(() => {
    if (filterState !== "closed") setExpandedId(null);
  }, [filterState]);

  useEffect(() => {
    if (detailId) setExpandedId(null);
  }, [detailId]);

  useEffect(() => {
    if (!detailId) {
      setDetailAnalyticsContext(null);
    }
  }, [detailId]);

  useEffect(() => {
    const showEvent = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const showSub = Keyboard.addListener(showEvent, (event) => {
      setKeyboardHeight(event.endCoordinates?.height ?? 0);
    });
    const hideSub = Keyboard.addListener(hideEvent, () => setKeyboardHeight(0));

    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  useEffect(() => {
    if (!isCreatingTag || keyboardHeight === 0) return;
    const timer = setTimeout(() => {
      filterScrollRef.current?.scrollToEnd({ animated: true });
    }, 120);
    return () => clearTimeout(timer);
  }, [isCreatingTag, keyboardHeight]);

  const measureFilterAnchor = useCallback(() => {
    const node = filterWrapRef.current;
    if (!node) return;
    node.measureInWindow((x, y, width, height) => {
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      setFilterAnchor({ x, y, width, height });
    });
  }, []);

  useEffect(() => {
    if (filterState === "closed") {
      const frame = requestAnimationFrame(measureFilterAnchor);
      return () => cancelAnimationFrame(frame);
    }
    return undefined;
  }, [filterState, measureFilterAnchor, tokens.height, tokens.width]);

  useEffect(() => {
    const smartFilterTags = new Set(smartTagCategories.flatMap((category) => category.tags));
    setActiveTags((prev) => {
      const next = new Set<string>();
      prev.forEach((tag) => {
        if (!SMART_TAG_SET.has(tag)) {
          next.add(tag);
          return;
        }
        if (smartFilterTags.has(tag)) {
          next.add(tag);
        }
      });

      return next.size === prev.size ? prev : next;
    });
  }, [smartTagCategories]);

  useEffect(() => {
    if (hasLoggedFirstFilterUseRef.current) return;
    if (activeTags.size === 0) return;
    hasLoggedFirstFilterUseRef.current = true;
    trackOnboardingEvent("first_filter_used", {
      selectedCount: activeTags.size,
      source: "my_supplement_smart_filter",
    });
  }, [activeTags.size]);

  useEffect(() => {
    const tagsFromData = new Set<string>();
    data.forEach((item) => {
      item.tags?.forEach((tag) => {
        if (!SMART_TAG_SET.has(tag)) tagsFromData.add(tag);
      });
    });

    if (tagsFromData.size === 0) return;
    setUserTags((prev) => {
      const next = new Set(prev);
      tagsFromData.forEach((tag) => next.add(tag));
      return Array.from(next);
    });
  }, [data]);

  const scanDoseLookup = useMemo(() => {
    const byKey = new Map<string, string>();
    const byBrandNameKey = new Map<string, string>();
    const byNameKey = new Map<string, string>();
    const categoryByKey = new Map<string, string>();
    const categoryByBrandNameKey = new Map<string, string>();
    const categoryByNameKey = new Map<string, string>();
    const nameKeySources = new Map<string, Set<string>>();

    scans.forEach((scan) => {
      const nameKey = getNameKey(scan.productName, scan.brandName);
      const brandNameKey = getBrandNameKey(scan.productName, scan.brandName);
      const key = getDedupeKey(scan);
      const sources = nameKeySources.get(nameKey) ?? new Set<string>();
      sources.add(brandNameKey);
      nameKeySources.set(nameKey, sources);

      const category = scan.category?.trim();
      if (category) {
        categoryByKey.set(key, category);
        categoryByBrandNameKey.set(brandNameKey, category);
        categoryByNameKey.set(nameKey, category);
      }

      const dose = scan.dosageText?.trim();
      if (!dose) return;

      const normalizedDose = normalizeKey(dose);
      const normalizedCategory = category ? normalizeKey(category) : "";
      if (normalizedCategory && normalizedDose === normalizedCategory) return;

      byKey.set(key, dose);
      byBrandNameKey.set(brandNameKey, dose);
      byNameKey.set(nameKey, dose);
    });

    const conflictedNameKeys = new Set<string>();
    nameKeySources.forEach((sources, nameKey) => {
      if (sources.size > 1) conflictedNameKeys.add(nameKey);
    });

    return {
      byKey,
      byBrandNameKey,
      byNameKey,
      conflictedNameKeys,
      categoryByKey,
      categoryByBrandNameKey,
      categoryByNameKey,
    };
  }, [scans]);

  const resolveDosageText = useCallback(
    (item: SavedSupplement) => {
      const current = item.dosageText?.trim() ?? "";
      const nameKey = getNameKey(item.productName, item.brandName);
      const brandNameKey = getBrandNameKey(item.productName, item.brandName);

      const scanDose =
        scanDoseLookup.byKey.get(getDedupeKey(item)) ||
        scanDoseLookup.byBrandNameKey.get(brandNameKey) ||
        (!scanDoseLookup.conflictedNameKeys.has(nameKey) ? scanDoseLookup.byNameKey.get(nameKey) : undefined);

      const category =
        scanDoseLookup.categoryByKey.get(getDedupeKey(item)) ||
        scanDoseLookup.categoryByBrandNameKey.get(brandNameKey) ||
        (!scanDoseLookup.conflictedNameKeys.has(nameKey)
          ? scanDoseLookup.categoryByNameKey.get(nameKey)
          : undefined);

	      const normalizedCurrent = normalizeKey(current);
	      const normalizedCategory = category ? normalizeKey(category) : "";
	      const cleanedCurrent = normalizedCategory && normalizedCurrent === normalizedCategory ? "" : current;

	      // Keep dosageText clean: never persist or display full directions here.
	      const preferredRaw = cleanedCurrent || scanDose || "";
	      return formatSavedDoseForDisplay(preferredRaw) ?? "";
	    },
	    [scanDoseLookup],
	  );

  const resolvedData = useMemo(
    () =>
      data.map((item) => {
        const nextBrandName = brandOverrideById.get(item.id) ?? item.brandName;
        const resolvedItem = nextBrandName === item.brandName ? item : { ...item, brandName: nextBrandName };
        return { ...resolvedItem, dosageText: resolveDosageText(resolvedItem) };
      }),
    [brandOverrideById, data, resolveDosageText],
  );

  const dataById = useMemo(() => {
    const map = new Map<string, SavedSupplement>();
    data.forEach((item) => map.set(item.id, item));
    return map;
  }, [data]);

  useEffect(() => {
    resolvedData.forEach((item) => {
      const original = dataById.get(item.id);
      if (!original) return;

      const originalDose = original.dosageText?.trim() ?? "";
      const resolvedDose = item.dosageText?.trim() ?? "";
      if (resolvedDose === originalDose) return;
      if (updatedDosageRef.current.get(item.id) === resolvedDose) return;

      updatedDosageRef.current.set(item.id, resolvedDose);
      updateSupplement(item.id, { dosageText: resolvedDose }).catch(() => {
        if (updatedDosageRef.current.get(item.id) === resolvedDose) {
          updatedDosageRef.current.delete(item.id);
        }
      });
    });
  }, [dataById, resolvedData, updateSupplement]);

  const sorted = useMemo(() => [...resolvedData].sort((a, b) => isoDesc(a.createdAt, b.createdAt)), [resolvedData]);

  const stackOverlapSeed = useMemo(
    () =>
      data
        .map((item) => `${item.id}:${item.supplementId ?? ""}:${item.updatedAt}`)
        .sort()
        .join("|"),
    [data],
  );

  useEffect(() => {
    let isActive = true;

    if (!user?.id || data.length === 0) {
      setStackOverlapBySupplementId(new Map());
      setStackOverlapCountBySupplementId(new Map());
      setStackSafetySummaryBySupplementId(new Map());
      setDuplicateGroupsBySupplementId(new Map());
      setStackSafetyMetaBySupplementId(new Map());
      return () => {
        isActive = false;
      };
    }

    const run = async () => {
      const payload = await fetchStackOverlap();
      if (!isActive || !payload) {
        if (!payload) {
          setStackOverlapBySupplementId(new Map());
          setStackOverlapCountBySupplementId(new Map());
          setStackSafetySummaryBySupplementId(new Map());
          setDuplicateGroupsBySupplementId(new Map());
          setStackSafetyMetaBySupplementId(new Map());
        }
        return;
      }

      const bySupplement = new Map<string, StackOverlapItem[]>();
      const countBySupplement = new Map<string, number>();
      const duplicateBySupplement = new Map<string, StackDuplicateGroup[]>();
      const summaryBySupplement = new Map<string, StackLevelSafetySummary>();
      const metaBySupplement = new Map<string, StackSafetyMeta>();

      for (const overlap of payload.overlaps) {
        for (const supplement of overlap.supplements) {
          const supplementId = supplement.supplementId?.trim();
          if (!supplementId) continue;
          const existing = bySupplement.get(supplementId) ?? [];
          if (!existing.some((entry) => entry.ingredientKey === overlap.ingredientKey)) {
            existing.push(overlap);
            bySupplement.set(supplementId, existing);
            countBySupplement.set(supplementId, (countBySupplement.get(supplementId) ?? 0) + 1);
          }
        }
      }

      const surfacedGroups = (payload.duplicateGroups ?? []).filter((group) => group?.surfaced);
      for (const group of surfacedGroups) {
        for (const product of group.products ?? []) {
          const supplementId = product.supplementId?.trim();
          if (!supplementId) continue;
          const existing = duplicateBySupplement.get(supplementId) ?? [];
          if (!existing.some((entry) => entry.ingredientCanonicalKey === group.ingredientCanonicalKey)) {
            existing.push(group);
            duplicateBySupplement.set(supplementId, existing);
          }
          if (payload.stackLevelSummary?.headline) {
            summaryBySupplement.set(supplementId, payload.stackLevelSummary);
          }
          if (payload.meta) {
            metaBySupplement.set(supplementId, payload.meta);
          }
        }
      }

      for (const [supplementId, groups] of duplicateBySupplement.entries()) {
        countBySupplement.set(
          supplementId,
          Math.max(countBySupplement.get(supplementId) ?? 0, groups.length),
        );
      }

      setStackOverlapBySupplementId(bySupplement);
      setStackOverlapCountBySupplementId(countBySupplement);
      setStackSafetySummaryBySupplementId(summaryBySupplement);
      setDuplicateGroupsBySupplementId(duplicateBySupplement);
      setStackSafetyMetaBySupplementId(metaBySupplement);
      if (payload.overlaps.length > 0 || surfacedGroups.length > 0) {
        logStackOverlapEvent("stack_overlap_exposed", {
          overlapCount: payload.meta?.surfacedGroupCount ?? payload.summary?.overlapCount ?? payload.overlaps.length,
          truncated: payload.summary?.truncated ?? false,
          hiddenOverlapCount: payload.summary?.hiddenOverlapCount ?? 0,
        });
      }
    };

    void run().catch((error) => {
      if (!isActive) return;
      const message = error instanceof Error ? error.message : "Unknown error";
      console.warn("[stack-overlap] Unhandled fetch error", message);
      setStackOverlapBySupplementId(new Map());
      setStackOverlapCountBySupplementId(new Map());
      setStackSafetySummaryBySupplementId(new Map());
      setDuplicateGroupsBySupplementId(new Map());
      setStackSafetyMetaBySupplementId(new Map());
    });

    return () => {
      isActive = false;
    };
  }, [data.length, logStackOverlapEvent, stackOverlapSeed, user?.id]);

  const handleLearnMealTimePref = useCallback(
    async (label: "Breakfast" | "Lunch" | "Dinner" | "Bedtime", time: string, mode: "seed" | "manual") => {
      if (!user?.id) return;
      const slot =
        label === "Breakfast"
          ? "breakfast"
          : label === "Lunch"
          ? "lunch"
          : label === "Dinner"
          ? "dinner"
          : "bedtime";
      if (mode === "seed" && mealTimePrefs) {
        return;
      }
      const next = await updateMealTimePrefSlot(user.id, slot, time, mealTimePrefs);
      if (next) {
        setMealTimePrefs(next);
      }
    },
    [mealTimePrefs, user?.id],
  );

  useEffect(() => {
    if (dosageMetadataBackfillStartedRef.current) return;
    if (sorted.length === 0) return;
    dosageMetadataBackfillStartedRef.current = true;

    const isStrengthDose = (dose: string) => /\b(mcg|mg|g|iu|cfu|ml|oz)\b/i.test(dose);
    const isCountDose = (dose: string) =>
      /\b(tablet|capsule|softgel|gummy|scoop|drop|packet|serving)\b/i.test(dose);

    const candidates = sorted
      .filter((item) => {
        const barcode = item.barcode?.trim();
        if (!barcode) return false;
        const currentDose = formatSavedDoseForDisplay(item.dosageText);
        if (!currentDose) return true;
        if (isStrengthDose(currentDose)) return false;
        if (CALORIE_DOSE_REGEX.test(currentDose)) return true;
        return isCountDose(currentDose);
      })
      .slice(0, 10);

    if (candidates.length === 0) return;

    let cancelled = false;
    const run = async () => {
      for (const item of candidates) {
        if (cancelled) break;
        const barcode = item.barcode?.trim();
        if (!barcode) continue;

        const meta = await fetchBarcodeMetadata(barcode);
        if (cancelled) break;
        if (!meta || meta.status !== "ok") continue;

        const nextDose = formatSavedDoseForDisplay(meta.primaryDoseText);
        if (!nextDose) continue;

        const currentDose = formatSavedDoseForDisplay(item.dosageText);
        if (currentDose && isStrengthDose(currentDose)) continue; // upgrade-only
        if (nextDose === currentDose) continue;

        try {
          await updateSupplement(item.id, { dosageText: nextDose });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Unknown error";
          console.warn("[supplement-dose] Failed to backfill dose", message);
        }
      }
    };

    void run().catch((error) => {
      const message = error instanceof Error ? error.message : "Unknown error";
      console.warn("[supplement-dose] Unhandled dosage metadata backfill error", message);
    });
    return () => {
      cancelled = true;
    };
  }, [sorted, updateSupplement]);

  useEffect(() => {
    if (brandMetadataBackfillStartedRef.current) return;
    if (sorted.length === 0) return;
    brandMetadataBackfillStartedRef.current = true;

    const candidates = sorted
      .filter((item) => Boolean(item.barcode?.trim()))
      .slice(0, 12);

    if (candidates.length === 0) return;

    let cancelled = false;
    const run = async () => {
      for (const item of candidates) {
        if (cancelled) break;

        const barcode = item.barcode?.trim();
        if (!barcode) continue;

        const ensured = await ensureOverview({
          supplementId: getOverviewLookupSupplementId(item.supplementId, barcode),
          barcode,
          brandName: item.brandName ?? null,
          productName: item.productName,
          dosageText: formatSavedDoseForDisplay(item.dosageText),
          userSupplementId: isUuid(item.id) ? item.id : null,
        });
        if (cancelled || !ensured?.facts) continue;

        const nextBrand = pickFirstText(
          ensured.facts.overlay?.brandName,
          ensured.facts.product.brandDisplay,
          item.brandName,
        );
        const nextImageUrl = pickFirstText(ensured.facts.overlay?.imageUrl, item.imageUrl);
        if (!nextBrand && !nextImageUrl) continue;

        const brandChanged = Boolean(nextBrand) && normalizeKey(nextBrand) !== normalizeKey(item.brandName);
        const imageChanged = Boolean(nextImageUrl) && nextImageUrl !== item.imageUrl;
        if (brandChanged && nextBrand) {
          setBrandOverrideById((prev) => {
            if (prev.get(item.id) === nextBrand) return prev;
            const next = new Map(prev);
            next.set(item.id, nextBrand);
            return next;
          });
        }

        if (!brandChanged && !imageChanged && ensured.supplementId === item.supplementId) {
          continue;
        }

        try {
          await updateSupplement(item.id, {
            ...(brandChanged && nextBrand ? { brandName: nextBrand } : {}),
            ...(imageChanged ? { imageUrl: nextImageUrl } : {}),
            ...(ensured.supplementId && ensured.supplementId !== item.supplementId
              ? { supplementId: ensured.supplementId }
              : {}),
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Unknown error";
          console.warn("[supplement-metadata] Failed to backfill Saved supplement metadata", message);
        }
      }
    };

    void run().catch((error) => {
      const message = error instanceof Error ? error.message : "Unknown error";
      console.warn("[supplement-metadata] Unhandled Saved supplement metadata backfill error", message);
    });

    return () => {
      cancelled = true;
    };
  }, [sorted, updateSupplement]);

  const idToThemeMap = useMemo(() => {
    const map = new Map<string, Theme>();
    sorted.forEach((item, index) => {
      map.set(item.id, THEMES[index % THEMES.length]);
    });
    return map;
  }, [sorted]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let result: SavedSupplement[];

    if (q) {
      result = resolvedData.filter((s) => s.productName.toLowerCase().startsWith(q));
      result.sort((a, b) => a.productName.localeCompare(b.productName));
    } else {
      result = [...sorted];
    }

    if (activeTags.size > 0) {
      result = filterSupplementsByActiveTags({
        items: result,
        activeTags,
        membershipById: smartFilterMembershipById,
        goalTagToKey,
        typeTagToKey,
      });
    }

    return result;
  }, [activeTags, goalTagToKey, resolvedData, search, smartFilterMembershipById, sorted, typeTagToKey]);

  const activeGoalKeys = useMemo(
    () =>
      Array.from(activeTags)
        .map((tag) => goalTagToKey.get(tag))
        .filter((value): value is GoalKey => Boolean(value)),
    [activeTags, goalTagToKey],
  );

  const activeTypeKeys = useMemo(
    () =>
      Array.from(activeTags)
        .map((tag) => typeTagToKey.get(tag))
        .filter((value): value is SupplementTypeKey => Boolean(value)),
    [activeTags, typeTagToKey],
  );

  const smartFilterCoverageReadyCount = useMemo(
    () =>
      Object.values(smartFilterMembershipById).filter((membership) => membership?.coverageStatus === "coverage_ready")
        .length,
    [smartFilterMembershipById],
  );

  const smartFilterNotEnoughStructuredDataCount = useMemo(
    () =>
      Object.values(smartFilterMembershipById).filter(
        (membership) => membership?.bucket === "not_enough_structured_data",
      ).length,
    [smartFilterMembershipById],
  );

  const filteredEvaluatedResults = useMemo(
    () =>
      filtered
        .map((item, index) => ({
          item,
          index,
          membership: smartFilterMembershipById[item.id],
        }))
        .filter(({ membership }) => isEvaluatedCoverageReadyMembership(membership)),
    [filtered, smartFilterMembershipById],
  );

  useEffect(() => {
    if (smartFilterEvaluationLoading) return;
    const membershipCount = Object.keys(smartFilterMembershipById).length;
    if (membershipCount === 0) return;
    const nextKey = `${snapshot.snapshotId}:${membershipCount}:${smartFilterCoverageReadyCount}:${smartFilterNotEnoughStructuredDataCount}`;
    if (smartFilterExposureKeyRef.current === nextKey) return;
    smartFilterExposureKeyRef.current = nextKey;
    trackEvaluatedLoopExposure({
      surface: "smart_filter",
      snapshotId: snapshot.snapshotId,
      rulesVersion: snapshot.rulesVersion,
      source: "auto",
      selectedCount: activeTags.size,
      resultCount: membershipCount,
      coverageReadyCount: smartFilterCoverageReadyCount,
      notEnoughStructuredDataCount: smartFilterNotEnoughStructuredDataCount,
      goalKey: smartFilter.highlightedGoal,
      reasonCodes: smartFilter.reasons.map((reason) => reason.code),
    });
  }, [
    activeTags.size,
    smartFilter,
    smartFilterCoverageReadyCount,
    smartFilterEvaluationLoading,
    smartFilterMembershipById,
    smartFilterNotEnoughStructuredDataCount,
    snapshot.rulesVersion,
    snapshot.snapshotId,
  ]);

  useEffect(() => {
    if (activeTags.size === 0) return;
    const coverageReadyResultCount = filteredEvaluatedResults.length;
    if (coverageReadyResultCount === 0) return;
    const nextKey = `${snapshot.snapshotId}:${Array.from(activeTags).sort().join("|")}:${coverageReadyResultCount}:${filtered.length}`;
    if (smartFilterResultsExposureKeyRef.current === nextKey) return;
    smartFilterResultsExposureKeyRef.current = nextKey;
    trackEvaluatedLoopExposure({
      surface: "smart_filter",
      snapshotId: snapshot.snapshotId,
      rulesVersion: snapshot.rulesVersion,
      source: "user",
      selectedCount: activeTags.size,
      resultCount: filtered.length,
      coverageReadyCount: coverageReadyResultCount,
      notEnoughStructuredDataCount: filtered.filter(
        (item) => smartFilterMembershipById[item.id]?.bucket === "not_enough_structured_data",
      ).length,
      goalKey: activeGoalKeys[0],
      typeKey: activeTypeKeys[0],
    });
  }, [
    activeGoalKeys,
    activeTags,
    activeTypeKeys,
    filtered,
    filteredEvaluatedResults.length,
    smartFilterMembershipById,
    snapshot.rulesVersion,
    snapshot.snapshotId,
  ]);

  const activeSmartTags = useMemo(
    () => Array.from(activeTags).filter((tag) => SMART_TAG_SET.has(tag)).sort((left, right) => left.localeCompare(right)),
    [activeTags],
  );

  const evaluatedFilterSummary = useMemo(() => {
    const summary = {
      totalFilteredCount: filtered.length,
      evaluatedResultCount: 0,
      strongCount: 0,
      relatedCount: 0,
      weakCount: 0,
      notEnoughStructuredDataCount: 0,
      rankEligibleCount: 0,
    };

    filtered.forEach((item) => {
      const membership = smartFilterMembershipById[item.id];
      if (!membership) return;
      summary.evaluatedResultCount += 1;
      if (membership.bucket === "strong_match") summary.strongCount += 1;
      if (membership.bucket === "related") summary.relatedCount += 1;
      if (membership.bucket === "weak_match") summary.weakCount += 1;
      if (membership.bucket === "not_enough_structured_data") summary.notEnoughStructuredDataCount += 1;
      if (membership.eligibility?.rankEligible) summary.rankEligibleCount += 1;
    });

    return summary;
  }, [filtered, smartFilterMembershipById]);

  useEffect(() => {
    if (smartFilterEvaluationLoading) return;
    if (activeSmartTags.length === 0) return;
    const exposureKey = JSON.stringify({
      activeSmartTags,
      search: search.trim().toLowerCase(),
      ids: filtered.map((item) => item.id),
    });
    if (evaluatedExposureKeyRef.current === exposureKey) return;
    evaluatedExposureKeyRef.current = exposureKey;
    trackSmartFilterEvaluatedEvent("smart_filter_evaluated_results_exposed", {
      activeTags: activeSmartTags,
      searchQuery: search.trim() || null,
      ...evaluatedFilterSummary,
    });
  }, [
    activeSmartTags,
    evaluatedFilterSummary,
    filtered,
    search,
    smartFilterEvaluationLoading,
    trackSmartFilterEvaluatedEvent,
  ]);

  const cards = useMemo(
    () =>
      filtered.map((item, idx) => ({
        item,
        idx,
        theme: idToThemeMap.get(item.id) || THEMES[0],
      })),
    [filtered, idToThemeMap],
  );

  const stackSafetyCardDuplicateGroups = useMemo(() => {
    const byIngredient = new Map<string, StackDuplicateGroup>();
    duplicateGroupsBySupplementId.forEach((groups) => {
      groups.forEach((group) => {
        const key = group.ingredientCanonicalKey;
        if (!key) return;
        const existing = byIngredient.get(key);
        if (!existing || (group.surfaced && !existing.surfaced)) {
          byIngredient.set(key, group);
        }
      });
    });
    const priority = (group: StackDuplicateGroup) => {
      if (group.status === "over") return 0;
      if (group.status === "near") return 1;
      if (group.status === "below") return 2;
      return 3;
    };
    return Array.from(byIngredient.values()).sort(
      (left, right) =>
        priority(left) - priority(right) ||
        right.productCount - left.productCount ||
        left.ingredientDisplayName.localeCompare(right.ingredientDisplayName),
    );
  }, [duplicateGroupsBySupplementId]);

  const stackSafetyCardOverlapCount = useMemo(() => {
    const keys = new Set<string>();
    stackOverlapBySupplementId.forEach((overlaps) => {
      overlaps.forEach((overlap) => {
        if (overlap.ingredientKey) keys.add(overlap.ingredientKey);
      });
    });
    return Math.max(keys.size, stackSafetyCardDuplicateGroups.length);
  }, [stackOverlapBySupplementId, stackSafetyCardDuplicateGroups.length]);

  const stackSafetyTargetItem = useMemo(() => {
    const supplementIds = new Set<string>();
    stackSafetyCardDuplicateGroups.forEach((group) => {
      group.products.forEach((product) => {
        if (product.supplementId) supplementIds.add(product.supplementId);
      });
    });
    if (supplementIds.size > 0) {
      const match = sorted.find((item) => item.supplementId && supplementIds.has(item.supplementId));
      if (match) return match;
    }
    return sorted[0] ?? null;
  }, [sorted, stackSafetyCardDuplicateGroups]);

  const selectedCount = selectedIds.size;

  const isAssigningMode = Boolean(assigningTag);
  const isBatchSelectionMode = selectionMode && !isAssigningMode;
  const schedulePillEnabled = selectedCount > 0;
  const headerSplitDelay = isBatchSelectionMode ? 96 : 0;
  const headerTitleText = "My Saved";
  let headerLabel = "Select";
  let headerIsDelete = false;
  let headerIsAssigning = false;

  if (assigningTag) {
    headerLabel = selectedCount > 0 ? `Add to ${assigningTag} (${selectedCount})` : `Select items for ${assigningTag}`;
    headerIsDelete = false;
    headerIsAssigning = true;
  } else if (!selectionMode) {
    headerLabel = "Select";
  } else if (selectedCount > 0) {
    headerLabel = "Delete";
    headerIsDelete = true;
  } else {
    headerLabel = "Cancel";
  }

  const handleHeaderLabelLayout = useCallback(
    (event: NativeSyntheticEvent<TextLayoutEventData>) => {
      const line = event.nativeEvent.lines?.[0];
      if (!line) return;
      const maxWidth = tokens.width - tokens.pageX * 2;
      const next = Math.min(maxWidth, Math.max(84, Math.ceil(line.width + 36)));
      if (pillWidthRef.current === next) return;
      pillWidthRef.current = next;
      setPillWidth(next);
    },
    [tokens.pageX, tokens.width],
  );

  const toggleSelected = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const exitSelection = useCallback(() => {
    setSelectionMode(false);
    setSelectedIds(new Set());
    setExpandedId(null);
    setAssigningTag(null);
    setBatchScheduleOpen(false);
  }, []);

  const handleDeleteSelectedAction = useCallback(async () => {
    if (selectedIds.size === 0) return;
    const ids = Array.from(selectedIds);
    const overlapDeleteCount = ids.reduce((count, id) => {
      const supplementId = data.find((entry) => entry.id === id)?.supplementId ?? null;
      if (!supplementId) return count;
      return count + (stackOverlapCountBySupplementId.get(supplementId) ?? 0);
    }, 0);
    if (overlapDeleteCount > 0) {
      logStackOverlapEvent("stack_overlap_action_taken", {
        action: "delete",
        selectedCount: ids.length,
        overlapMentions: overlapDeleteCount,
      });
    }
    if (detailId && selectedIds.has(detailId)) setDetailId(null);
    await onDeleteSelected?.(ids);
    exitSelection();
  }, [
    data,
    detailId,
    exitSelection,
    logStackOverlapEvent,
    onDeleteSelected,
    selectedIds,
    stackOverlapCountBySupplementId,
  ]);

  const handleHeaderAction = useCallback(async () => {
    if (assigningTag) {
      if (selectedIds.size > 0) {
        const ids = Array.from(selectedIds);
        ids.forEach((id) => {
          const item = data.find((entry) => entry.id === id);
          if (!item) return;
          const existing = item.tags ?? [];
          if (existing.includes(assigningTag)) return;
          updateSupplement(id, { tags: [...existing, assigningTag] }).catch(() => undefined);
        });
        exitSelection();
      } else {
        exitSelection();
      }
      return;
    }

    if (!selectionMode) {
      setSelectionMode(true);
      return;
    }

    if (selectedIds.size > 0) {
      await handleDeleteSelectedAction();
      return;
    }

    exitSelection();
  }, [
    assigningTag,
    data,
    exitSelection,
    handleDeleteSelectedAction,
    selectedIds.size,
    selectionMode,
    updateSupplement,
  ]);

  const handleSaveRoutine = useCallback(
    async (id: string, prefs: RoutinePreferences) => {
      await onSaveRoutine?.(id, prefs);
      const membership = smartFilterMembershipById[id];
      if (!isEvaluatedCoverageReadyMembership(membership)) return;
      const attribution = evaluatedInteractionByIdRef.current.get(id);
      const goalKey = attribution?.goalKey ?? activeGoalKeys[0] ?? membership.highlightedGoal;
      const typeKey = attribution?.typeKey ?? activeTypeKeys[0];
      const matchTier = attribution?.matchTier ?? getMembershipMatchTier(membership, goalKey);
      const reasonCodes = attribution?.reasonCodes?.length ? attribution.reasonCodes : getMembershipReasonCodes(membership);
      trackEvaluatedLoopSave({
        surface: "smart_filter",
        snapshotId: snapshot.snapshotId,
        rulesVersion: snapshot.rulesVersion,
        source: "user",
        productId: id,
        goalKey,
        typeKey,
        matchTier,
        coverageStatus: membership.coverageStatus,
        reasonCodes,
      });
      trackEvaluatedLoopConversion({
        surface: "smart_filter",
        snapshotId: snapshot.snapshotId,
        rulesVersion: snapshot.rulesVersion,
        source: "user",
        productId: id,
        goalKey,
        typeKey,
        matchTier,
        coverageStatus: membership.coverageStatus,
        conversionType: "schedule_applied",
        reasonCodes,
      });
    },
    [activeGoalKeys, activeTypeKeys, onSaveRoutine, smartFilterMembershipById, snapshot.rulesVersion, snapshot.snapshotId],
  );

  const handleApplyBatchSchedule = useCallback(
    async (update: BatchScheduleUpdate) => {
      const ids = Array.from(selectedIds);
      if (ids.length === 0) return;

      await Promise.all(
        ids.map(async (id) => {
          const item = data.find((entry) => entry.id === id);
          if (!item) return;
          const next: RoutinePreferences = {
            ...(item.routine ?? {}),
          };

          if (Object.prototype.hasOwnProperty.call(update, "startDate")) {
            next.startDate = update.startDate;
          }
          if (Object.prototype.hasOwnProperty.call(update, "daysOfWeek")) {
            if (update.daysOfWeek && update.daysOfWeek.length > 0) {
              next.daysOfWeek = update.daysOfWeek;
            } else {
              delete next.daysOfWeek;
            }
          }
          if (Object.prototype.hasOwnProperty.call(update, "time") && update.time) {
            next.time = update.time;
            next.timeUserSet = true;
          }
          if (Object.prototype.hasOwnProperty.call(update, "withFood")) {
            next.withFood = update.withFood;
          }

          if (onSaveRoutine) {
            await onSaveRoutine(id, next);
            return;
          }
          await updateSupplement(id, { routine: next });
        }),
      );

      if (activeSmartTags.length > 0) {
        const memberships = ids
          .map((id) => smartFilterMembershipById[id])
          .filter((membership): membership is SmartFilterProductMembership => Boolean(membership));
        if (memberships.length > 0) {
          trackSmartFilterEvaluatedEvent("smart_filter_evaluated_batch_schedule_applied", {
            activeTags: activeSmartTags,
            searchQuery: search.trim() || null,
            selectedCount: ids.length,
            evaluatedSelectedCount: memberships.length,
            strongCount: memberships.filter((membership) => membership.bucket === "strong_match").length,
            relatedCount: memberships.filter((membership) => membership.bucket === "related").length,
            weakCount: memberships.filter((membership) => membership.bucket === "weak_match").length,
            notEnoughStructuredDataCount: memberships.filter((membership) => membership.bucket === "not_enough_structured_data").length,
          });
          memberships
            .filter((membership) => isEvaluatedCoverageReadyMembership(membership))
            .forEach((membership) => {
              const goalKey = activeGoalKeys[0] ?? membership.highlightedGoal;
              const typeKey = activeTypeKeys[0];
              const matchTier = getMembershipMatchTier(membership, goalKey);
              const reasonCodes = getMembershipReasonCodes(membership);
              trackEvaluatedLoopSave({
                surface: "smart_filter",
                snapshotId: snapshot.snapshotId,
                rulesVersion: snapshot.rulesVersion,
                source: "user",
                actionKey: "batch_schedule",
                productId: membership.productId,
                goalKey,
                typeKey,
                matchTier,
                coverageStatus: membership.coverageStatus,
                selectedCount: ids.length,
                reasonCodes,
              });
              trackEvaluatedLoopConversion({
                surface: "smart_filter",
                snapshotId: snapshot.snapshotId,
                rulesVersion: snapshot.rulesVersion,
                source: "user",
                actionKey: "batch_schedule",
                productId: membership.productId,
                goalKey,
                typeKey,
                matchTier,
                coverageStatus: membership.coverageStatus,
                selectedCount: ids.length,
                conversionType: "schedule_applied",
                reasonCodes,
              });
            });
        }
      }

      exitSelection();
    },
    [
      activeGoalKeys,
      activeSmartTags,
      activeTypeKeys,
      data,
      exitSelection,
      onSaveRoutine,
      search,
      selectedIds,
      smartFilterMembershipById,
      snapshot.rulesVersion,
      snapshot.snapshotId,
      trackSmartFilterEvaluatedEvent,
      updateSupplement,
    ],
  );

  const markAsViewed = useCallback(
    (id: string) => {
      updateSupplement(id, { lastViewed: new Date().toISOString() }).catch(() => undefined);
    },
    [updateSupplement],
  );

  const openStackSafetyPaywall = useCallback(() => {
    router.push({
      pathname: "/paywall/official",
      params: {
        source: "stack_safety",
        returnTo: "/main/Home-Page?tab=saved",
      },
    });
  }, []);

  const handleOpenStackSafety = useCallback(() => {
    if (!premiumAccess.isPremium) {
      openStackSafetyPaywall();
      return;
    }

    if (!stackSafetyTargetItem) return;
    logStackOverlapEvent("stack_overlap_clicked", {
      surface: "stack_safety_alert",
      supplementId: stackSafetyTargetItem.supplementId ?? null,
      productName: stackSafetyTargetItem.productName,
      overlapCount: stackSafetyCardOverlapCount,
      surfacedGroupCount: stackSafetyCardDuplicateGroups.filter((group) => group.surfaced).length,
    });
    markAsViewed(stackSafetyTargetItem.id);
    setExpandedId(null);
    setDetailId(stackSafetyTargetItem.id);
  }, [
    logStackOverlapEvent,
    markAsViewed,
    openStackSafetyPaywall,
    premiumAccess.isPremium,
    stackSafetyCardDuplicateGroups,
    stackSafetyCardOverlapCount,
    stackSafetyTargetItem,
  ]);

  useEffect(() => {
    if (selectionMode || detailId) return;
    if (stackSafetyCardOverlapCount <= 0) return;

    const alertKey = [
      stackOverlapSeed,
      stackSafetyCardOverlapCount,
      premiumAccess.isPremium ? "pro" : "free",
    ].join(":");
    if (stackSafetyAlertKeyRef.current === alertKey) return;
    stackSafetyAlertKeyRef.current = alertKey;

    if (premiumAccess.isPremium) {
      Alert.alert(
        "Stack overlap found",
        "NuTri marked the saved products that repeat ingredients so you can review them in detail.",
        [
          { text: "Not now", style: "cancel" },
          { text: "View detail", onPress: handleOpenStackSafety },
        ],
      );
      return;
    }

    Alert.alert(
      "Stack overlap found",
      "NuTri found a repeated ingredient signal. Unlock Stack Safety to review the details.",
      [
        { text: "Later", style: "cancel" },
        { text: "Unlock", onPress: openStackSafetyPaywall },
      ],
    );
  }, [
    detailId,
    handleOpenStackSafety,
    openStackSafetyPaywall,
    premiumAccess.isPremium,
    selectionMode,
    stackOverlapSeed,
    stackSafetyCardOverlapCount,
  ]);

  const toggleTag = useCallback((tag: string) => {
    const next = new Set(activeTags);
    const action = next.has(tag) ? "remove" : "add";
    if (action === "remove") next.delete(tag);
    else next.add(tag);

    if (SMART_TAG_SET.has(tag)) {
      trackSmartFilterEvaluatedEvent("smart_filter_evaluated_tag_toggled", {
        tag,
        action,
        activeTagsBefore: Array.from(activeTags).filter((value) => SMART_TAG_SET.has(value)).sort((left, right) => left.localeCompare(right)),
        activeTagsAfter: Array.from(next).filter((value) => SMART_TAG_SET.has(value)).sort((left, right) => left.localeCompare(right)),
        goalKey: goalTagToKey.get(tag) ?? null,
        typeKey: typeTagToKey.get(tag) ?? null,
        searchQuery: search.trim() || null,
      });
    }

    setActiveTags(next);
  }, [activeTags, goalTagToKey, search, trackSmartFilterEvaluatedEvent, typeTagToKey]);

  const closeFilter = useCallback(() => {
    if (filterState === "closed" || filterState === "closing") return;
    clearFilterTimers();
    setIsCreatingTag(false);
    setFilterState("closing");
    // Fade out immediately to avoid header/safe-area flash during the final width snap.
    setFilterBackdropVisible(false);
    filterTimersRef.current.push(
      setTimeout(() => {
        setFilterState("closed");
      }, FILTER_HEIGHT_DURATION),
    );
    filterTimersRef.current.push(
      setTimeout(() => {
        setFilterBackdropMounted(false);
      }, FILTER_HEIGHT_DURATION),
    );
  }, [clearFilterTimers, filterState]);

  useEffect(() => {
    if (!selectionMode) return;
    closeFilter();
  }, [closeFilter, selectionMode]);

  const handleCreateTag = useCallback(() => {
    if (!newTagText.trim()) {
      setIsCreatingTag(false);
      return;
    }

    const newTag = newTagText.trim();
    if (!userTags.includes(newTag)) {
      setUserTags((prev) => [...prev, newTag]);
    }

    setNewTagText("");
    setIsCreatingTag(false);
    closeFilter();
    setSelectionMode(true);
    setAssigningTag(newTag);
    setSelectedIds(new Set());
  }, [closeFilter, newTagText, userTags]);

  const handleDeleteTag = useCallback(
    (tagToDelete: string) => {
      if (assigningTag === tagToDelete) {
        exitSelection();
      }

      setUserTags((prev) => prev.filter((tag) => tag !== tagToDelete));
      setActiveTags((prev) => {
        const next = new Set(prev);
        next.delete(tagToDelete);
        return next;
      });

      data.forEach((item) => {
        if (!item.tags?.includes(tagToDelete)) return;
        const nextTags = item.tags.filter((tag) => tag !== tagToDelete);
        updateSupplement(item.id, { tags: nextTags }).catch(() => undefined);
      });
    },
    [assigningTag, data, exitSelection, updateSupplement],
  );

  const openFilter = useCallback(() => {
    if (filterState !== "closed") return;
    clearFilterTimers();
    setIsCreatingTag(false);
    setExpandedId(null);
    measureFilterAnchor();
    // Mount immediately to block background touches, then fade in after the expand starts.
    setFilterBackdropMounted(true);
    setFilterBackdropVisible(false);
    setFilterState("opening");
    filterTimersRef.current.push(
      setTimeout(() => {
        setFilterState("open");
      }, FILTER_WIDTH_DURATION),
    );
    filterTimersRef.current.push(
      setTimeout(() => {
        setFilterBackdropVisible(true);
      }, BACKDROP_SHOW_DELAY),
    );
  }, [clearFilterTimers, filterState, measureFilterAnchor]);

  const detailItem = useMemo(
    () => (detailId ? resolvedData.find((item) => item.id === detailId) ?? null : null),
    [detailId, resolvedData],
  );
  const detailTheme = useMemo(
    () => (detailItem ? idToThemeMap.get(detailItem.id) || THEMES[0] : null),
    [detailItem, idToThemeMap],
  );
  const detailSavedProductEvaluation = useMemo(
    () =>
      detailItem
        ? (snapshot.evaluations.savedProductEvaluations?.[detailItem.id] ?? undefined)
        : undefined,
    [detailItem, snapshot.evaluations.savedProductEvaluations],
  );
  const detailGoalKey = useMemo(
    () =>
      activeGoalKeys[0] ??
      detailSavedProductEvaluation?.smartFilterMembership.highlightedGoal ??
      (detailItem ? smartFilterMembershipById[detailItem.id]?.highlightedGoal : undefined),
    [activeGoalKeys, detailItem, detailSavedProductEvaluation, smartFilterMembershipById],
  );
  const detailCompareEntries = useMemo(() => {
    if (!detailItem) return [];

    const evaluations = Object.values(snapshot.evaluations.savedProductEvaluations ?? {})
      .filter((evaluation): evaluation is SavedProductEvaluation => Boolean(evaluation));
    const compareCandidates = evaluations.filter(
      (evaluation) =>
        evaluation.productId === detailItem.id || evaluation.coverage.status === "coverage_ready",
    );

    return buildGoalCompareEntries({
      evaluations: compareCandidates,
      currentProductId: detailItem.id,
      goalKey: detailGoalKey,
    });
  }, [
    detailGoalKey,
    detailItem,
    snapshot.evaluations.savedProductEvaluations,
  ]);

  const viewingNoteItem = useMemo(
    () => (viewingNoteId ? resolvedData.find((item) => item.id === viewingNoteId) ?? null : null),
    [resolvedData, viewingNoteId],
  );

  const baseOverlap = tokens.height < 760 ? 18 : 24;
  const stackOverlap = selectionMode ? 0 : baseOverlap;
  const stackPadding = stackOverlap * Math.max(0, cards.length - 1);
  const listBottomPadding = contentBottomPadding + stackPadding;

  const rowGap = 12;
  const contentWidth = tokens.width - tokens.pageX * 2;
  const searchWidth = Math.max(0, contentWidth - FILTER_COLLAPSED_SIZE - rowGap);
  const filterIconShift = Math.max(0, contentWidth - FILTER_COLLAPSED_SIZE);
  const filterAnchorRight = filterAnchor
    ? Math.max(0, tokens.width - (filterAnchor.x + filterAnchor.width))
    : tokens.pageX;
  const filterCollapsed = filterState === "closed";
  const isFilterOpen = filterState === "open";
  const filterContentVisible = filterState !== "closed";
  const filterContentActive = filterState === "open";
  const isFilterActive = filterBackdropVisible || isFilterOpen;
  const showFilterCollapsed = filterState === "closed" || filterState === "closing";
  const showFilterOverlay = filterState !== "closed" && !!filterAnchor;
  const overlayVisible = filterBackdropMounted && (filterBackdropVisible || filterState === "closing");
  const inlineVisible = !overlayVisible;
  const filterOpenHeight = useMemo(() => {
    if (filterAnchor?.y == null || keyboardHeight === 0) return FILTER_EXPANDED_HEIGHT;
    const available = tokens.height - keyboardHeight - tokens.insets.bottom - filterAnchor.y - 12;
    if (!Number.isFinite(available)) return FILTER_EXPANDED_HEIGHT;
    return Math.min(FILTER_EXPANDED_HEIGHT, Math.max(FILTER_COLLAPSED_SIZE, available));
  }, [filterAnchor, keyboardHeight, tokens.height, tokens.insets.bottom]);

  const renderFilterWrap = useCallback(
    (variant: "inline" | "overlay") => {
      const isOverlay = variant === "overlay";
      const isVisible = isOverlay ? overlayVisible : inlineVisible;

      return (
        <MySavedSmartFilterPanel
          variant={variant}
          styles={styles}
          filterWrapRef={filterWrapRef}
          filterScrollRef={filterScrollRef}
          isVisible={isVisible}
          filterAnchorRight={filterAnchorRight}
          filterAnchorY={filterAnchor?.y}
          contentWidth={contentWidth}
          filterOpenHeight={filterOpenHeight}
          filterCollapsedSize={FILTER_COLLAPSED_SIZE}
          filterWidthDuration={FILTER_WIDTH_DURATION}
          filterHeightDuration={FILTER_HEIGHT_DURATION}
          filterEasing={FILTER_EASING}
          filterState={filterState}
          filterContentVisible={filterContentVisible}
          filterContentActive={filterContentActive}
          showFilterCollapsed={showFilterCollapsed}
          filterIconShift={filterIconShift}
          highlightedGoalTag={highlightedGoalTag}
          smartTagCategories={smartTagCategories}
          activeTags={activeTags}
          userTags={userTags}
          isCreatingTag={isCreatingTag}
          newTagText={newTagText}
          keyboardHeight={keyboardHeight}
          topInset={tokens.insets.top}
          onOpen={openFilter}
          onClose={closeFilter}
          onToggleTag={toggleTag}
          onDeleteTag={handleDeleteTag}
          onStartCreatingTag={() => setIsCreatingTag(true)}
          onCancelCreatingTag={() => setIsCreatingTag(false)}
          onCreateTag={handleCreateTag}
          onChangeNewTagText={setNewTagText}
          onClearAll={() => setActiveTags(new Set())}
        />
      );
    },
    [
      activeTags,
      closeFilter,
      contentWidth,
      filterBackdropMounted,
      filterBackdropVisible,
      filterAnchor,
      filterAnchorRight,
      filterContentActive,
      filterContentVisible,
      filterIconShift,
      filterOpenHeight,
      filterState,
      handleCreateTag,
      handleDeleteTag,
      isCreatingTag,
      keyboardHeight,
      inlineVisible,
      newTagText,
      overlayVisible,
      openFilter,
      setActiveTags,
      setIsCreatingTag,
      setNewTagText,
      smartTagCategories,
      tokens.insets.top,
      toggleTag,
      userTags,
    ],
  );

  return (
    <View style={styles.screen}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        removeClippedSubviews={false}
        scrollEnabled={!isFilterActive}
        contentInsetAdjustmentBehavior="never"
        scrollIndicatorInsets={{ top: contentTopPadding, bottom: listBottomPadding }}
        style={{ overflow: "visible" }}
        contentContainerStyle={{
          paddingTop: contentTopPadding,
          paddingBottom: listBottomPadding,
        }}
      >
        <View style={styles.contentWrap}>
          <View style={[styles.contentInner, { paddingHorizontal: tokens.pageX }]}>
            <View style={styles.headerMeasureWrap} pointerEvents="none">
              <Text onTextLayout={handleHeaderLabelLayout} style={styles.headerPillMeasure} numberOfLines={1}>
                {headerLabel}
              </Text>
            </View>

	            <View style={[styles.headerRow, { marginBottom: tokens.sectionGap, zIndex: isFilterActive ? 1001 : 1 }]}>
	              <View style={styles.headerTitleWrap}>
	                <AutoFitText
	                  text={headerTitleText}
	                  baseFontSize={tokens.h1Size}
	                  baseLineHeight={tokens.h1Line}
	                  minFontSize={Math.max(28, tokens.h1Size - 6)}
	                  style={styles.h1}
	                />
	              </View>

	              <View style={styles.headerPillSplitRow}>
	                <AnimatePresence>
	                  {isBatchSelectionMode ? (
	                    <MotiView
	                      from={{ opacity: 0, translateX: 24, width: 18, scaleY: 0.9 }}
	                      animate={{ opacity: 1, translateX: 0, width: 44, scaleY: 1 }}
	                      exit={{ opacity: 0, translateX: 14, width: 18, scaleY: 0.92 }}
	                      transition={{
	                        opacity: { type: "timing", duration: 260, easing: FILTER_EASING },
	                        translateX: { type: "timing", duration: 320, easing: FILTER_EASING },
	                        width: { type: "timing", duration: 320, easing: FILTER_EASING },
	                        scaleY: { type: "timing", duration: 280, easing: FILTER_EASING },
	                      }}
	                      style={styles.headerIconPillMotion}
	                    >
	                      <Pressable
	                        disabled={!schedulePillEnabled}
	                        onPress={() => setBatchScheduleOpen(true)}
	                        style={[styles.headerIconPill, styles.headerPillNeutral]}
	                      >
	                        <BlurView intensity={18} tint="light" style={StyleSheet.absoluteFillObject} />
	                        <LinearGradient
	                          colors={["rgba(255,255,255,0.74)", "rgba(226,232,240,0.24)", "rgba(255,255,255,0)"]}
	                          start={{ x: 0, y: 0 }}
	                          end={{ x: 1, y: 1 }}
	                          style={[StyleSheet.absoluteFillObject, { opacity: 0.96 }]}
	                        />
	                        <MotiView
	                          animate={{ opacity: schedulePillEnabled ? 1 : 0 }}
	                          transition={{ type: "timing", duration: 220, easing: FILTER_EASING }}
	                          style={StyleSheet.absoluteFillObject}
	                        >
	                          <LinearGradient
	                            colors={["rgba(255,255,255,0.92)", "rgba(37,99,235,0.14)", "rgba(255,255,255,0)"]}
	                            start={{ x: 0, y: 0 }}
	                            end={{ x: 1, y: 1 }}
	                            style={[StyleSheet.absoluteFillObject, { opacity: 0.96 }]}
	                          />
	                        </MotiView>
	                        <MotiView
	                          animate={{ opacity: schedulePillEnabled ? 1 : 0 }}
	                          transition={{ type: "timing", duration: 220, easing: FILTER_EASING }}
	                          style={[
	                            StyleSheet.absoluteFillObject,
	                            styles.headerPillBorderOverlay,
	                            styles.headerPillPrimaryOverlay,
	                          ]}
	                        />
	                        <View style={styles.headerPillInner}>
	                          <MotiView
	                            from={{ opacity: 0, scale: 0.9, translateX: 4 }}
	                            animate={{ opacity: 1, scale: 1, translateX: 0 }}
	                            exit={{ opacity: 0, scale: 0.94, translateX: 3 }}
	                            transition={{ type: "timing", duration: 200, delay: 80, easing: FILTER_EASING }}
	                            style={styles.headerIconGlyphStack}
	                          >
	                            <MotiView
	                              animate={{
	                                opacity: schedulePillEnabled ? 0 : 1,
	                                scale: schedulePillEnabled ? 0.96 : 1,
	                              }}
	                              transition={{ type: "timing", duration: 180, easing: FILTER_EASING }}
	                              style={styles.headerIconGlyphLayer}
	                            >
	                              <CalendarDays size={18} color="#94a3b8" />
	                            </MotiView>
	                            <MotiView
	                              animate={{
	                                opacity: schedulePillEnabled ? 1 : 0,
	                                scale: schedulePillEnabled ? 1 : 0.96,
	                              }}
	                              transition={{ type: "timing", duration: 200, delay: schedulePillEnabled ? 40 : 0, easing: FILTER_EASING }}
	                              style={styles.headerIconGlyphLayer}
	                            >
	                              <CalendarDays size={18} color="#1d4ed8" />
	                            </MotiView>
	                          </MotiView>
	                        </View>
	                        </Pressable>
	                      </MotiView>
	                  ) : null}
	                </AnimatePresence>

	                <MotiView
	                  style={styles.headerPillMotion}
	                  animate={{
	                    width: pillWidth,
	                    translateX: isBatchSelectionMode ? 6 : 0,
	                    scaleX: isBatchSelectionMode ? 0.985 : 1,
	                  }}
	                  transition={{
	                    width: { type: "spring", damping: 20, stiffness: 220, mass: 0.95 },
	                    translateX: { type: "timing", duration: 280, delay: headerSplitDelay, easing: FILTER_EASING },
	                    scaleX: { type: "timing", duration: 260, delay: headerSplitDelay, easing: FILTER_EASING },
	                  }}
	                >
	                  <Pressable
	                    onPress={handleHeaderAction}
	                    style={[styles.headerPill, styles.headerPillNeutral]}
	                  >
	                    <BlurView intensity={18} tint="light" style={StyleSheet.absoluteFillObject} />
	                    <LinearGradient
	                      colors={["rgba(255,255,255,0.70)", "rgba(255,255,255,0.22)", "rgba(255,255,255,0)"]}
	                      start={{ x: 0, y: 0 }}
	                      end={{ x: 1, y: 1 }}
	                      style={[StyleSheet.absoluteFillObject, { opacity: 0.92 }]}
	                    />
	                    <MotiView
	                      animate={{ opacity: headerIsAssigning ? 1 : 0 }}
	                      transition={{ type: "timing", duration: 220, easing: FILTER_EASING }}
	                      style={StyleSheet.absoluteFillObject}
	                    >
	                      <LinearGradient
	                        colors={["rgba(255,255,255,0.80)", "rgba(59,130,246,0.12)", "rgba(255,255,255,0)"]}
	                        start={{ x: 0, y: 0 }}
	                        end={{ x: 1, y: 1 }}
	                        style={[StyleSheet.absoluteFillObject, { opacity: 0.92 }]}
	                      />
	                    </MotiView>
	                    <MotiView
	                      animate={{ opacity: headerIsDelete ? 1 : 0 }}
	                      transition={{ type: "timing", duration: 220, easing: FILTER_EASING }}
	                      style={StyleSheet.absoluteFillObject}
	                    >
	                      <LinearGradient
	                        colors={["rgba(255,255,255,0.65)", "rgba(239,68,68,0.10)", "rgba(255,255,255,0)"]}
	                        start={{ x: 0, y: 0 }}
	                        end={{ x: 1, y: 1 }}
	                        style={[StyleSheet.absoluteFillObject, { opacity: 0.92 }]}
	                      />
	                    </MotiView>
	                    <MotiView
	                      animate={{ opacity: headerIsAssigning ? 1 : 0 }}
	                      transition={{ type: "timing", duration: 220, easing: FILTER_EASING }}
	                      style={[
	                        StyleSheet.absoluteFillObject,
	                        styles.headerPillBorderOverlay,
	                        styles.headerPillPrimaryOverlay,
	                      ]}
	                    />
	                    <MotiView
	                      animate={{ opacity: headerIsDelete ? 1 : 0 }}
	                      transition={{ type: "timing", duration: 220, easing: FILTER_EASING }}
	                      style={[
	                        StyleSheet.absoluteFillObject,
	                        styles.headerPillBorderOverlay,
	                        styles.headerPillDangerOverlay,
	                      ]}
	                    />

	                    <View style={styles.headerPillInner}>
	                      <AnimatePresence exitBeforeEnter>
	                        <MotiView
	                          key={headerLabel}
	                          from={{ translateY: 8, opacity: 0, scale: 0.98 }}
	                          animate={{ translateY: 0, opacity: 1, scale: 1 }}
	                          exit={{ translateY: -8, opacity: 0, scale: 0.98 }}
	                          transition={{ type: "timing", duration: 180 }}
	                        >
	                          <Text
	                            style={[
	                              styles.headerPillText,
	                              headerIsDelete && { color: "#ef4444" },
	                              headerIsAssigning && { color: "#2563eb" },
	                            ]}
	                            numberOfLines={1}
	                            adjustsFontSizeToFit
	                            minimumFontScale={0.8}
	                          >
	                            {headerLabel}
	                          </Text>
	                        </MotiView>
	                      </AnimatePresence>
	                    </View>
	                  </Pressable>
	                </MotiView>
	              </View>
	            </View>

	            <View style={[styles.searchWrap, { marginBottom: tokens.sectionGap, zIndex: isFilterActive ? 1001 : 2 }]}>
	              <View style={styles.searchRow}>
	                <MotiView
                  style={[styles.searchPill, { width: searchWidth }]}
                  animate={{
                    opacity: filterCollapsed ? 1 : 0,
                    translateX: filterCollapsed ? 0 : -8,
                    scale: filterCollapsed ? 1 : 0.985,
                  }}
                  transition={{ type: "timing", duration: FILTER_WIDTH_DURATION, easing: FILTER_EASING }}
                  pointerEvents={filterCollapsed ? "auto" : "none"}
                >
                  <Search size={20} color="#94a3b8" />
                  <TextInput
                    value={search}
                    onChangeText={setSearch}
                    placeholder="Search supplements..."
                    placeholderTextColor="#94a3b8"
                    style={styles.searchInput}
                    returnKeyType="search"
                  />
                </MotiView>
	                {renderFilterWrap("inline")}
	              </View>
	            </View>

            <View style={styles.listWrap}>
              {cards.map(({ item, theme }, i) => (
                <CollectionCard
                  key={item.id}
                  item={item}
                  displayBrandName={item.brandName}
                  overlapCount={item.supplementId ? stackOverlapCountBySupplementId.get(item.supplementId) ?? 0 : 0}
                  index={i}
                  theme={theme}
                  zIndex={i}
                  stackOverlap={stackOverlap}
                  expanded={expandedId === item.id}
                  detailOpen={detailId === item.id}
                  selectionMode={selectionMode}
                  selected={selectedIds.has(item.id)}
                  onToggleSelect={() => toggleSelected(item.id)}
                  onToggleExpand={() => {
                    if (selectionMode) return;
                    setExpandedId((prev) => (prev === item.id ? null : item.id));
                  }}
                  onOpenDetail={() => {
                    if (selectionMode) return;
                    const overlapCount = item.supplementId
                      ? stackOverlapCountBySupplementId.get(item.supplementId) ?? 0
                      : 0;
                    const membership = smartFilterMembershipById[item.id];
                    if (activeSmartTags.length > 0 && membership) {
                      setDetailAnalyticsContext({
                        productId: item.id,
                        activeTags: activeSmartTags,
                        filteredCount: evaluatedFilterSummary.totalFilteredCount,
                        searchQuery: search.trim(),
                        membership,
                      });
                      trackSmartFilterEvaluatedEvent("smart_filter_evaluated_result_opened", {
                        productId: item.id,
                        productName: item.productName,
                        activeTags: activeSmartTags,
                        filteredCount: evaluatedFilterSummary.totalFilteredCount,
                        searchQuery: search.trim() || null,
                        bucket: membership.bucket,
                        highlightedGoal: membership.highlightedGoal ?? null,
                        rankEligible: membership.eligibility?.rankEligible ?? null,
                      });
                    } else {
                      setDetailAnalyticsContext(null);
                    }
                    if (overlapCount > 0) {
                      logStackOverlapEvent("stack_overlap_clicked", {
                        supplementId: item.supplementId ?? null,
                        productName: item.productName,
                        overlapCount,
                      });
                    }
                    if (isEvaluatedCoverageReadyMembership(membership)) {
                      const goalKey = activeGoalKeys[0] ?? membership.highlightedGoal;
                      const typeKey = activeTypeKeys[0];
                      const matchTier = getMembershipMatchTier(membership, goalKey);
                      const reasonCodes = getMembershipReasonCodes(membership);
                      evaluatedInteractionByIdRef.current.set(item.id, {
                        goalKey,
                        typeKey,
                        matchTier,
                        coverageStatus: membership.coverageStatus,
                        reasonCodes,
                      });
                      trackEvaluatedLoopClick({
                        surface: "smart_filter",
                        snapshotId: snapshot.snapshotId,
                        rulesVersion: snapshot.rulesVersion,
                        source: "user",
                        productId: item.id,
                        goalKey,
                        typeKey,
                        matchTier,
                        coverageStatus: membership.coverageStatus,
                        position: filtered.findIndex((entry) => entry.id === item.id),
                        selectedCount: activeTags.size,
                        reasonCodes,
                      });
                    }
                    markAsViewed(item.id);
                    setExpandedId(null);
                    setDetailId(item.id);
                  }}
                  onViewNote={() => {
                    if (selectionMode) return;
                    setDetailAnalyticsContext(null);
                    setViewingNoteId(item.id);
                  }}
                />
              ))}

              {cards.length === 0 ? (
                <View style={{ paddingVertical: 90, alignItems: "center" }}>
                  <Text style={{ color: "#94a3b8", includeFontPadding: false, lineHeight: 18 }}>
                    {activeTags.size > 0 ? "No supplements match current filters." : "No supplements found."}
                  </Text>
                  {activeTags.size > 0 ? (
                    <Pressable onPress={() => setActiveTags(new Set())} style={styles.emptyStateClearButton}>
                      <Text style={styles.emptyStateClearText}>Clear filters</Text>
                    </Pressable>
                  ) : null}
                </View>
              ) : null}
            </View>
          </View>
        </View>
      </ScrollView>

      {filterBackdropMounted ? (
        <MotiView
          animate={{ opacity: filterBackdropVisible ? 1 : 0 }}
          transition={{
            type: "timing",
            duration: filterBackdropVisible ? BACKDROP_FADE_IN_DURATION : BACKDROP_FADE_OUT_DURATION,
            easing: FILTER_EASING,
          }}
          style={styles.filterBackdrop}
          pointerEvents={filterBackdropVisible ? "auto" : "none"}
        >
          <BlurView
            intensity={50}
            tint="light"
            blurReductionFactor={1}
            experimentalBlurMethod="dimezisBlurView"
            style={StyleSheet.absoluteFillObject}
          />
          <Pressable style={StyleSheet.absoluteFillObject} onPress={closeFilter}>
            <View style={styles.filterBackdropTint} />
          </Pressable>
        </MotiView>
      ) : null}

      {showFilterOverlay ? (
        <View pointerEvents="box-none" style={styles.filterOverlayHost}>
          {renderFilterWrap("overlay")}
        </View>
      ) : null}

      <BatchScheduleSheet
        visible={batchScheduleOpen}
        selectedCount={selectedCount}
        scheduleDefaults={scheduleDefaults}
        mealTimePrefs={mealTimePrefs}
        onClose={() => setBatchScheduleOpen(false)}
        onApply={handleApplyBatchSchedule}
        onRecordOverrideEvents={recordOverrideEvents}
      />

      {detailItem && detailTheme ? (
        <DetailSheet
          item={detailItem}
          theme={detailTheme}
          scheduleDefaults={scheduleDefaults}
          selectedGoalKey={detailGoalKey}
          savedProductEvaluation={detailSavedProductEvaluation}
          compareEntries={detailCompareEntries}
          stackOverlaps={detailItem.supplementId ? stackOverlapBySupplementId.get(detailItem.supplementId) ?? [] : []}
          stackSafetySummary={detailItem.supplementId ? stackSafetySummaryBySupplementId.get(detailItem.supplementId) ?? null : null}
          duplicateGroups={detailItem.supplementId ? duplicateGroupsBySupplementId.get(detailItem.supplementId) ?? [] : []}
          stackSafetyMeta={detailItem.supplementId ? stackSafetyMetaBySupplementId.get(detailItem.supplementId) ?? null : null}
          stackSafetyLocked={!premiumAccess.isPremium}
          mealTimePrefs={mealTimePrefs}
          onLearnMealTimePref={handleLearnMealTimePref}
          onOpenStackSafetyPaywall={openStackSafetyPaywall}
          onClose={() => {
            setDetailAnalyticsContext(null);
            setDetailId(null);
          }}
          onSaveRoutine={handleSaveRoutine}
          onRecordOverrideEvents={recordOverrideEvents}
          onTrackPersonalizationEvent={trackPersonalizationEvent}
          smartFilterAnalyticsContext={detailAnalyticsContext}
          onTrackSmartFilterEvent={trackSmartFilterEvaluatedEvent}
        />
      ) : null}

      {viewingNoteItem ? (
        <NoteQuickView
          item={viewingNoteItem}
          onClose={() => setViewingNoteId(null)}
          onEdit={() => {
            if (!viewingNoteItem) return;
            markAsViewed(viewingNoteItem.id);
            setViewingNoteId(null);
            setDetailAnalyticsContext(null);
            setDetailId(viewingNoteItem.id);
            setExpandedId(null);
          }}
        />
      ) : null}

    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: SCREEN_BG },
  contentWrap: { position: "relative" },
  contentInner: { position: "relative" },

  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 14,
  },
  headerTitleWrap: {
    flex: 1,
    minWidth: 0,
    paddingRight: 12,
  },
  h1: {
    fontFamily: SCREEN_TITLE_FONT,
    fontWeight: "500",
    color: "#111111",
    letterSpacing: -1.1,
    includeFontPadding: false,
    flex: 1,
    minWidth: 0,
  },
  headerPillMotion: {
    height: 44,
    borderRadius: 999,
    borderCurve: "continuous",
    shadowColor: "#0f172a",
    shadowOpacity: 0.12,
    shadowRadius: 15,
    shadowOffset: { width: 0, height: 10 },
    elevation: 3,
    flexShrink: 0,
  },
  headerPillSplitRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    flexShrink: 0,
  },
  headerPillSplitMotion: {
    height: 44,
    borderRadius: 999,
    borderCurve: "continuous",
    shadowColor: "#0f172a",
    shadowOpacity: 0.12,
    shadowRadius: 15,
    shadowOffset: { width: 0, height: 10 },
    elevation: 3,
    minWidth: 116,
  },
  headerIconPillMotion: {
    width: 44,
    height: 44,
    borderRadius: 999,
    borderCurve: "continuous",
    overflow: "hidden",
    shadowColor: "#0f172a",
    shadowOpacity: 0.11,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 3,
  },
  headerPill: {
    height: 44,
    paddingHorizontal: 18,
    borderRadius: 999,
    borderCurve: "continuous",
    overflow: "hidden",
    borderWidth: 1,
  },
  headerPillPrimary: {
    borderColor: "rgba(37,99,235,0.28)",
  },
  headerPillNeutral: {
    borderColor: "rgba(255,255,255,0.7)",
  },
  headerPillMuted: {
    borderColor: "rgba(226,232,240,0.88)",
  },
  headerPillDanger: {
    borderColor: "rgba(239,68,68,0.28)",
  },
  headerIconPill: {
    width: "100%",
    height: "100%",
    borderRadius: 999,
    borderCurve: "continuous",
    overflow: "hidden",
    borderWidth: 1,
  },
  headerPillBorderOverlay: {
    borderRadius: 999,
    borderCurve: "continuous",
    borderWidth: 1,
  },
  headerPillPrimaryOverlay: {
    borderColor: "rgba(59,130,246,0.55)",
  },
  headerPillDangerOverlay: {
    borderColor: "rgba(239,68,68,0.55)",
  },
  headerPillInner: { flex: 1, alignItems: "center", justifyContent: "center" },
  headerIconGlyphStack: {
    width: 18,
    height: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  headerIconGlyphLayer: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  headerPillText: {
    fontSize: 14,
    lineHeight: 18,
    fontWeight: "700",
    color: "#334155",
    textAlign: "center",
    includeFontPadding: false,
  },
  headerPillTextPrimary: {
    color: "#1d4ed8",
  },
  headerPillTextMuted: {
    color: "#94a3b8",
  },
  headerMeasureWrap: {
    position: "absolute",
    left: -9999,
    top: 0,
    opacity: 0,
  },
  headerPillMeasure: {
    fontSize: 14,
    lineHeight: 18,
    fontWeight: "700",
    includeFontPadding: false,
  },

  searchWrap: {},
  searchRow: {
    width: "100%",
    height: FILTER_COLLAPSED_SIZE,
    position: "relative",
  },
  searchPill: {
    position: "absolute",
    left: 0,
    top: 0,
    height: 54,
    borderRadius: 999,
    borderCurve: "continuous",
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "#E4E7EB",
    shadowColor: "#0f172a",
    shadowOpacity: 0.08,
    shadowOffset: { width: 0, height: 6 },
    shadowRadius: 10,
    elevation: 3,
  },
  searchInput: {
    flex: 1,
    height: 54,
    fontSize: 16,
    lineHeight: 20,
    fontWeight: "600",
    color: "#0f172a",
    includeFontPadding: false,
  },

  filterWrap: {
    position: "absolute",
    right: 0,
    top: 0,
    overflow: "hidden",
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    borderCurve: "continuous",
    shadowColor: "#0f172a",
    shadowOpacity: 0.12,
    shadowOffset: { width: 0, height: 10 },
    shadowRadius: 15,
    elevation: 6,
  },
  filterCollapsed: {
    width: "100%",
    height: "100%",
    alignItems: "center",
    justifyContent: "center",
  },
  filterButton: {
    width: "100%",
    height: "100%",
    alignItems: "center",
    justifyContent: "center",
  },
  filterCollapsedOverlay: {
    position: "absolute",
    right: 0,
    top: 0,
    width: FILTER_COLLAPSED_SIZE,
    height: FILTER_COLLAPSED_SIZE,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 2,
  },
  filterCollapsedButton: {
    width: "100%",
    height: "100%",
    alignItems: "center",
    justifyContent: "center",
  },

  filterInner: {
    flex: 1,
    width: "100%",
    padding: 24,
  },
  filterInnerTint: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(255,255,255,0.56)",
  },
  filterInnerBorder: {
    ...StyleSheet.absoluteFillObject,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.35)",
    borderRadius: 32,
    borderCurve: "continuous",
  },
  filterKeyboard: {
    flex: 1,
    width: "100%",
  },
  filterHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 24,
  },
  filterTitle: {
    fontSize: 20,
    lineHeight: 24,
    fontWeight: "800",
    color: "#1f2937",
    includeFontPadding: false,
  },
  filterSubtitle: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "500",
    color: "#94a3b8",
    includeFontPadding: false,
  },
  filterCloseBtn: {
    width: 40,
    height: 40,
    borderRadius: 999,
    borderCurve: "continuous",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f8fafc",
  },
  filterContent: {
    flex: 1,
  },
  filterContentInner: {
    paddingBottom: 12,
  },
  filterSection: {
    marginBottom: 24,
  },
  filterSectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 12,
  },
  filterDot: {
    width: 6,
    height: 6,
    borderRadius: 999,
  },
  filterDotNeutral: {
    backgroundColor: "#0f172a",
  },
  filterSectionTitle: {
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1,
    textTransform: "uppercase",
    color: "#94a3b8",
    includeFontPadding: false,
  },
  filterTagsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  filterTag: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 999,
    borderCurve: "continuous",
    borderWidth: 1,
  },
  filterTagText: {
    fontSize: 12,
    fontWeight: "700",
    includeFontPadding: false,
  },

  userTagWrap: {
    position: "relative",
  },
  userTag: {
    paddingLeft: 16,
    paddingRight: 34,
    paddingVertical: 12,
    borderRadius: 999,
    borderCurve: "continuous",
    borderWidth: 1,
  },
  userTagText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#475569",
    includeFontPadding: false,
  },
  userTagDelete: {
    position: "absolute",
    right: 6,
    top: "50%",
    marginTop: -12,
    width: 24,
    height: 24,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
  },

  newTagBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 18,
    borderCurve: "continuous",
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: "#cbd5f5",
  },
  newTagText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#94a3b8",
    includeFontPadding: false,
  },
  newTagInputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    minWidth: 160,
    flex: 1,
  },
  newTagInput: {
    flex: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    borderCurve: "continuous",
    backgroundColor: "#f8fafc",
    borderWidth: 1,
    borderColor: "#e2e8f0",
    fontSize: 12,
    fontWeight: "600",
    color: "#0f172a",
    includeFontPadding: false,
  },
  newTagConfirm: {
    width: 32,
    height: 32,
    borderRadius: 999,
    backgroundColor: "#0f172a",
    alignItems: "center",
    justifyContent: "center",
  },
  newTagCancel: {
    width: 32,
    height: 32,
    borderRadius: 999,
    backgroundColor: "#f1f5f9",
    alignItems: "center",
    justifyContent: "center",
  },

  filterFooter: {
    borderTopWidth: 1,
    borderTopColor: "#e2e8f0",
    paddingTop: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  filterFooterText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#94a3b8",
    includeFontPadding: false,
  },
  clearFiltersBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 12,
    borderCurve: "continuous",
    backgroundColor: "#fee2e2",
  },
  clearFiltersText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#ef4444",
    includeFontPadding: false,
  },
  emptyStateClearButton: {
    marginTop: 14,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 12,
    borderCurve: "continuous",
    backgroundColor: "#e2e8f0",
  },
  emptyStateClearText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#475569",
    includeFontPadding: false,
  },

  filterBackdrop: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 1000,
  },
  filterOverlayHost: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 1001,
  },
  filterBackdropTint: {
    flex: 1,
    backgroundColor: "rgba(226,232,240,0.28)",
  },

  listWrap: { overflow: "visible" },

  cardShell: {
    borderRadius: 40,
    borderCurve: "continuous",
    shadowColor: "#000",
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 6,
  },
  cardFill: { borderRadius: 40, borderCurve: "continuous", overflow: "hidden" },
  cardPressable: {
    borderRadius: 40,
    borderCurve: "continuous",
    paddingHorizontal: 24,
    paddingTop: 28,
    paddingBottom: 32,
  },
  selectedRing: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 40,
    borderCurve: "continuous",
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.55)",
  },
  cardInner: { gap: 16 },
  cardContentRow: { flexDirection: "row", alignItems: "center", gap: 14 },
  cardTextColumn: { flex: 1, minWidth: 0 },
  cardHeader: {
    position: "relative",
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
    paddingRight: 38,
  },
  cardScheduleIconSlot: {
    position: "absolute",
    right: 0,
    top: -4,
    width: 28,
    minWidth: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  cardTitle: {
    flex: 1,
    fontSize: 30,
    lineHeight: 34,
    fontWeight: "800",
    letterSpacing: -0.2,
    includeFontPadding: false,
  },
  cardMeta: { marginTop: 12, gap: 10 },
  cardThumbFrame: {
    width: 72,
    height: 72,
    borderRadius: 22,
    borderCurve: "continuous",
    overflow: "hidden",
    backgroundColor: "rgba(255,255,255,0.18)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.32)",
  },
  cardThumbImage: { width: "100%", height: "100%" },
  tagRow: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  customTagRow: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  tagPill: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, borderCurve: "continuous", borderWidth: 1 },
  overlapPill: { backgroundColor: "rgba(255,255,255,0.12)" },
  brandPillClamp: { maxWidth: 240, flexShrink: 1 },
  dosePillClamp: { maxWidth: 180, flexShrink: 1 },
  pillTextClamp: { flexShrink: 1 },
  tagText: { fontSize: 12, lineHeight: 16, fontWeight: "600", includeFontPadding: false },

  arrowWrap: {
    position: "absolute",
    right: 24,
    bottom: 18,
    width: 56,
    height: 56,
    alignItems: "center",
    justifyContent: "center",
  },
  arrowHalo: {
    position: "absolute",
    width: 68,
    height: 68,
    borderRadius: 999,
    borderCurve: "continuous",
    backgroundColor: "rgba(255,255,255,0.26)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.40)",
    shadowColor: "#000",
    shadowOpacity: 0.14,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 10,
  },
  arrowBtn: { width: 48, height: 48, borderRadius: 999, borderCurve: "continuous", alignItems: "center", justifyContent: "center" },

  selectCheckBubble: {
    position: "absolute",
    top: 18,
    right: 18,
    width: 34,
    height: 34,
    borderRadius: 999,
    borderCurve: "continuous",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.55)",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    shadowColor: "#000",
    shadowOpacity: 0.14,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 10 },
    zIndex: 3,
  },

  noteCard: {
    position: "absolute",
    left: 16,
    right: 16,
    bottom: 0,
    height: 100,
    borderRadius: 28,
    borderCurve: "continuous",
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#f1f5f9",
    zIndex: 0,
    shadowColor: "#0f172a",
    shadowOpacity: 0.06,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
  },
  noteCardInner: {
    flex: 1,
    flexDirection: "row",
    paddingTop: 18,
    paddingHorizontal: 18,
    paddingBottom: 12,
    gap: 10,
    alignItems: "flex-start",
  },
  noteCardIcon: { paddingTop: 2 },
  noteCardContent: { flex: 1 },
  noteCardText: {
    fontSize: 12,
    lineHeight: 18,
    fontWeight: "600",
    color: "#64748b",
    includeFontPadding: false,
  },
  noteCardAction: { alignSelf: "flex-end", paddingBottom: 4 },
  noteCardShade: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 16,
    backgroundColor: "rgba(0,0,0,0.05)",
    opacity: 0.4,
  },

  detailOverlay: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.20)" },
  sheet: { height: "92%", backgroundColor: "#ffffff", borderTopLeftRadius: 40, borderTopRightRadius: 40, borderCurve: "continuous", overflow: "hidden" },
  sheetClose: {
    position: "absolute",
    right: 24,
    width: 40,
    height: 40,
    borderRadius: 999,
    borderCurve: "continuous",
    backgroundColor: "#000000",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 20,
    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowRadius: 15,
    shadowOffset: { width: 0, height: 10 },
  },
  sheetHeader: { paddingHorizontal: 32, paddingBottom: 112 },
  sheetImageFrame: {
    width: 92,
    height: 92,
    borderRadius: 28,
    borderCurve: "continuous",
    overflow: "hidden",
    backgroundColor: "rgba(255,255,255,0.18)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.28)",
  },
  sheetImage: { width: "100%", height: "100%" },
  sheetHeaderRow: { flexDirection: "row", alignItems: "center", gap: 8, opacity: 0.85 },
  sheetHeaderLabel: { fontSize: 12, lineHeight: 16, fontWeight: "700", letterSpacing: 1.2, textTransform: "uppercase", includeFontPadding: false },
  sheetTitle: { fontSize: 36, lineHeight: 40, fontWeight: "800", letterSpacing: -0.2, includeFontPadding: false },

  sheetTag: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, borderCurve: "continuous", borderWidth: 1 },
  sheetTagText: { fontSize: 12, lineHeight: 16, fontWeight: "600", includeFontPadding: false },
  sheetStackSafetyPill: {
    borderColor: "rgba(180,83,9,0.34)",
    backgroundColor: "#fef3c7",
  },
  sheetStackSafetyPillText: {
    color: "#92400e",
    fontWeight: "800",
  },

  sheetBody: { marginTop: -80, backgroundColor: "#ffffff", borderTopLeftRadius: 48, borderTopRightRadius: 48, borderCurve: "continuous", paddingHorizontal: 24, paddingTop: 24 },
  sectionHead: { paddingHorizontal: 8, marginBottom: 12 },
  sectionTitle: { fontSize: 20, lineHeight: 24, fontWeight: "800", color: "#0f172a", includeFontPadding: false },

  glassBlock: { minHeight: 220, borderRadius: 40, borderCurve: "continuous", overflow: "hidden", position: "relative" },
  glassRing: { position: "absolute", top: 12, left: 12, right: 12, bottom: 12, borderRadius: 36, borderCurve: "continuous", overflow: "hidden", backgroundColor: "rgba(255,255,255,0.20)", shadowColor: "#000", shadowOpacity: 0.08, shadowRadius: 18, shadowOffset: { width: 0, height: 10 }, elevation: 2 },
  glassHighlightEdge: { ...StyleSheet.absoluteFillObject, borderRadius: 36, borderCurve: "continuous", borderWidth: 1, borderColor: "rgba(255,255,255,0.35)" },
  glassRingBorder: { ...StyleSheet.absoluteFillObject, borderWidth: 1, borderColor: "rgba(255,255,255,0.30)" },
  overviewContent: { minHeight: 220, paddingHorizontal: 32, paddingVertical: 32, justifyContent: "flex-start" },
  overviewSummary: { fontSize: 17, lineHeight: 26, fontWeight: "600", color: "#1f2937", includeFontPadding: false },
  overviewSectionTitleRow: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  overviewSectionTitle: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "900",
    color: "#334155",
    textTransform: "uppercase",
    letterSpacing: 1.0,
    includeFontPadding: false,
  },
  overviewInferredBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    borderCurve: "continuous",
    borderWidth: 1,
    borderColor: "rgba(59,130,246,0.28)",
    backgroundColor: "rgba(59,130,246,0.10)",
  },
  overviewInferredBadgeText: {
    fontSize: 10,
    lineHeight: 12,
    fontWeight: "800",
    color: "#1d4ed8",
    textTransform: "uppercase",
    letterSpacing: 0.4,
    includeFontPadding: false,
  },
  overviewMetaText: { fontSize: 12, lineHeight: 16, fontWeight: "700", color: "#64748b", includeFontPadding: false },
  overviewPlaceholder: { fontSize: 15, lineHeight: 22, fontWeight: "600", color: "#94a3b8", includeFontPadding: false },
  overviewSkeletonLine: { height: 16, borderRadius: 10, backgroundColor: "rgba(148,163,184,0.35)", width: "92%" },
  overviewSkeletonBulletRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  overviewRetryBtn: {
    marginTop: 16,
    alignSelf: "flex-start",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    borderCurve: "continuous",
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.35)",
    backgroundColor: "rgba(255,255,255,0.55)",
  },
  overviewRetryText: { fontSize: 13, lineHeight: 18, fontWeight: "800", color: "#0f172a", includeFontPadding: false },
  overviewBullets: { marginTop: 18, gap: 10 },
  overviewBulletRow: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  overviewBulletDot: { width: 6, height: 6, borderRadius: 999, backgroundColor: "#94a3b8", marginTop: 8 },
  overviewBulletText: { flex: 1, fontSize: 14, lineHeight: 20, fontWeight: "600", color: "#475569", includeFontPadding: false },
  overviewBulletLabel: { fontWeight: "700", color: "#334155" },
  lockedStackSafetyCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 24,
    borderCurve: "continuous",
    borderWidth: 1,
    borderColor: "rgba(15,23,42,0.08)",
    backgroundColor: "rgba(248,250,252,0.82)",
    padding: 14,
  },
  lockedStackSafetyIcon: {
    width: 34,
    height: 34,
    borderRadius: 999,
    borderCurve: "continuous",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.82)",
  },
  lockedStackSafetyTextWrap: {
    flex: 1,
    gap: 4,
  },
  lockedStackSafetyTitle: {
    fontSize: 14,
    lineHeight: 18,
    fontWeight: "900",
    color: "#0f172a",
    includeFontPadding: false,
  },
  lockedStackSafetyBody: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "600",
    color: "#64748b",
    includeFontPadding: false,
  },
  addLabelCtaBtn: {
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderCurve: "continuous",
    borderWidth: 1,
    borderColor: "rgba(59,130,246,0.28)",
    backgroundColor: "rgba(255,255,255,0.66)",
  },
  addLabelCtaText: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "800",
    color: "#1d4ed8",
    includeFontPadding: false,
  },
  overviewSourceLinkBtn: {
    marginTop: 2,
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderCurve: "continuous",
    borderWidth: 1,
    borderColor: "rgba(15,23,42,0.16)",
    backgroundColor: "rgba(255,255,255,0.55)",
  },
  overviewSourceLinkText: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "700",
    color: "#1e3a8a",
    includeFontPadding: false,
  },
  overviewToggleBtn: {
    marginTop: 4,
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderCurve: "continuous",
    borderWidth: 1,
    borderColor: "rgba(71,85,105,0.24)",
    backgroundColor: "rgba(255,255,255,0.55)",
  },
  overviewToggleText: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "800",
    color: "#334155",
    includeFontPadding: false,
  },

  routineBlock: { minHeight: 600, borderRadius: 40, borderCurve: "continuous", overflow: "hidden", position: "relative" },
  routineRing: { position: "absolute", top: 12, left: 12, right: 12, bottom: 12, borderRadius: 36, borderCurve: "continuous", overflow: "hidden", backgroundColor: "rgba(255,255,255,0.20)", shadowColor: "#000", shadowOpacity: 0.08, shadowRadius: 18, shadowOffset: { width: 0, height: 10 }, elevation: 2 },
  routineContent: { paddingHorizontal: 32, paddingTop: 36, paddingBottom: 28 },

  scheduleHeaderRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  scheduleTitleRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  scheduleTitle: { fontSize: 12, fontWeight: "800", color: "#475569", textTransform: "uppercase", letterSpacing: 1.0, includeFontPadding: false },
  scheduleHintText: { fontSize: 12, lineHeight: 16, fontWeight: "600", color: "#94a3b8", includeFontPadding: false },
  schedulePersonalizationHint: { marginTop: -10, fontSize: 11, lineHeight: 16, fontWeight: "700", color: "#64748b", includeFontPadding: false },
  suggestedRoutineCard: {
    borderRadius: 18,
    borderCurve: "continuous",
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.28)",
    backgroundColor: "rgba(255,255,255,0.56)",
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 8,
  },
  suggestedRoutineHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  suggestedRoutineTitle: { fontSize: 13, lineHeight: 18, fontWeight: "800", color: "#334155", includeFontPadding: false },
  suggestedRoutineRationale: { fontSize: 12, lineHeight: 18, fontWeight: "600", color: "#475569", includeFontPadding: false },
  suggestedRoutineHighlightText: { fontWeight: "800", color: "#1f2937" },
  suggestedRoutineChoiceGroup: { gap: 8, marginTop: 2 },
  suggestedRoutineChoiceHint: { fontSize: 11, lineHeight: 15, fontWeight: "700", color: "#64748b", includeFontPadding: false },
  anchorChoiceRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 2, flexWrap: "wrap" },
  anchorChoiceChip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    borderCurve: "continuous",
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.35)",
    backgroundColor: "rgba(255,255,255,0.46)",
  },
  anchorChoiceChipActive: {
    borderColor: "rgba(30,64,175,0.35)",
    backgroundColor: "rgba(219,234,254,0.55)",
  },
  anchorChoiceText: { fontSize: 11, lineHeight: 14, fontWeight: "700", color: "#64748b", includeFontPadding: false },
  anchorChoiceTextActive: { color: "#1e3a8a" },
  suggestedRoutineSlots: { gap: 6, marginTop: 2 },
  suggestedRoutineSlotRow: {
    borderRadius: 14,
    borderCurve: "continuous",
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.12)",
    backgroundColor: "rgba(255,255,255,0.24)",
  },
  suggestedRoutineSlotRowActive: {
    borderColor: "rgba(30,64,175,0.18)",
    backgroundColor: "rgba(219,234,254,0.36)",
  },
  suggestedRoutineSlotText: { fontSize: 12, lineHeight: 18, fontWeight: "700", color: "#334155", includeFontPadding: false },
  suggestedRoutineSlotTextActive: { color: "#1e3a8a" },
  suggestedRoutineSlotLabelText: { fontWeight: "900", color: "#1f2937" },
  suggestedRoutineSlotDividerText: { fontWeight: "700", color: "#94a3b8" },
  suggestedRoutineSlotTimeText: { fontWeight: "900", color: "#1e3a8a" },
  suggestedRoutineSlotFoodText: { fontWeight: "800", color: "#0f766e" },
  applySuggestionBtn: {
    marginTop: 6,
    alignSelf: "flex-start",
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    borderCurve: "continuous",
    borderWidth: 1,
    borderColor: "rgba(30,64,175,0.28)",
    backgroundColor: "rgba(255,255,255,0.65)",
  },
  applySuggestionText: { fontSize: 12, lineHeight: 16, fontWeight: "800", color: "#1e3a8a", includeFontPadding: false },
  chooseTimeBtn: {
    marginTop: 2,
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderCurve: "continuous",
    borderWidth: 1,
    borderColor: "rgba(71,85,105,0.28)",
    backgroundColor: "rgba(255,255,255,0.55)",
  },
  chooseTimeText: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "700",
    color: "#334155",
    includeFontPadding: false,
  },
  suggestedRoutineNotice: { fontSize: 11, lineHeight: 15, fontWeight: "700", color: "#64748b", includeFontPadding: false },
  startDateSection: { gap: 8 },
  startDateRow: {
    minHeight: 52,
    borderRadius: 18,
    borderCurve: "continuous",
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.28)",
    backgroundColor: "rgba(255,255,255,0.54)",
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  startDateRowTextWrap: { flex: 1, gap: 2 },
  startDateTitle: { fontSize: 12, lineHeight: 16, fontWeight: "800", color: "#334155", includeFontPadding: false },
  startDateCaption: { fontSize: 11, lineHeight: 14, fontWeight: "700", color: "#94a3b8", includeFontPadding: false },
  startDateValueWrap: { flexDirection: "row", alignItems: "center", gap: 8 },
  startDateValueText: { fontSize: 12, lineHeight: 16, fontWeight: "800", color: "#1e3a8a", includeFontPadding: false },
  timeCategoryPill: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 10, borderWidth: 1 },
  timeCategoryText: { fontSize: 11, fontWeight: "700", includeFontPadding: false },
  weekdaySection: { gap: 10 },
  weekdayHeaderRow: { flexDirection: "row", alignItems: "center", gap: 12, flexWrap: "wrap" },
  weekdayTitle: { fontSize: 12, lineHeight: 16, fontWeight: "800", color: "#475569", includeFontPadding: false },
  weekdayCaption: { fontSize: 11, lineHeight: 15, fontWeight: "700", color: "#94a3b8", includeFontPadding: false },
  weekdayShortcutChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderCurve: "continuous",
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.35)",
    backgroundColor: "rgba(255,255,255,0.46)",
    minHeight: 34,
    justifyContent: "center",
  },
  weekdayShortcutChipActive: {
    borderColor: "rgba(30,64,175,0.35)",
    backgroundColor: "rgba(219,234,254,0.55)",
  },
  weekdayShortcutText: { fontSize: 11, lineHeight: 14, fontWeight: "700", color: "#64748b", includeFontPadding: false },
  weekdayShortcutTextActive: { color: "#1e3a8a" },
  weekdayChipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  weekdayChip: {
    minWidth: 36,
    paddingHorizontal: 8,
    paddingVertical: 8,
    borderRadius: 999,
    borderCurve: "continuous",
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.35)",
    backgroundColor: "rgba(255,255,255,0.46)",
    alignItems: "center",
    justifyContent: "center",
  },
  weekdayChipActive: {
    borderColor: "rgba(30,64,175,0.35)",
    backgroundColor: "rgba(219,234,254,0.62)",
  },
  weekdayChipText: { fontSize: 12, lineHeight: 16, fontWeight: "800", color: "#64748b", includeFontPadding: false },
  weekdayChipTextActive: { color: "#1e3a8a" },
  weekdayHelpText: { fontSize: 11, lineHeight: 15, fontWeight: "700", color: "#64748b", includeFontPadding: false },

  timePickerWrap: {
    height: 140,
    borderRadius: 24,
    borderCurve: "continuous",
    backgroundColor: "#f8fafc",
    borderWidth: 1,
    borderColor: "#e2e8f0",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  timePickerHighlight: {
    position: "absolute",
    top: "50%",
    marginTop: -ITEM_HEIGHT / 2,
    left: 16,
    right: 16,
    height: ITEM_HEIGHT,
    borderRadius: 12,
    borderCurve: "continuous",
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },
  timePickerRow: { flexDirection: "row", width: "100%", justifyContent: "space-between", paddingHorizontal: 16 },
  timePickerColumn: { width: 64 },
  timePickerFadeTop: { position: "absolute", top: 0, left: 0, right: 0, height: 32 },
  timePickerFadeBottom: { position: "absolute", bottom: 0, left: 0, right: 0, height: 32 },

  wheelWrap: { height: ITEM_HEIGHT * VISIBLE_ITEMS },
  wheelContent: { paddingVertical: ITEM_HEIGHT },
  wheelItemRow: { height: ITEM_HEIGHT, alignItems: "center", justifyContent: "center" },
  wheelItemText: { fontSize: 16, includeFontPadding: false },
  wheelItemActive: { fontWeight: "700", color: "#1e293b" },
  wheelItemInactive: { fontWeight: "500", color: "#94a3b8" },

  foodToggleRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  foodToggleTrack: {
    width: 52,
    height: 30,
    borderRadius: 999,
    borderCurve: "continuous",
    backgroundColor: "#e2e8f0",
    padding: 4,
  },
  foodToggleTrackActive: { backgroundColor: "#10b981" },
  foodToggleThumb: {
    width: 22,
    height: 22,
    borderRadius: 999,
    borderCurve: "continuous",
    backgroundColor: "#ffffff",
    shadowColor: "#0f172a",
    shadowOpacity: 0.15,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
  },
  foodToggleText: { fontSize: 16, fontWeight: "600", color: "#94a3b8", includeFontPadding: false },
  foodToggleTextActive: { color: "#047857" },

  noteHeaderRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 24 },
  noteHeaderText: { fontSize: 12, fontWeight: "800", color: "#475569", textTransform: "uppercase", letterSpacing: 1.0, includeFontPadding: false },
  noteInput: {
    marginTop: 12,
    minHeight: 140,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 24,
    borderCurve: "continuous",
    backgroundColor: "#f8fafc",
    borderWidth: 1,
    borderColor: "#e2e8f0",
    fontSize: 15,
    fontWeight: "600",
    color: "#334155",
    includeFontPadding: false,
  },

  saveRow: { alignItems: "flex-end", marginTop: 24 },
  saveMeasureWrap: {
    position: "absolute",
    left: -9999,
    top: 0,
    opacity: 0,
  },
  saveMeasureText: {
    fontSize: 16,
    lineHeight: 20,
    fontWeight: "700",
    includeFontPadding: false,
  },
  saveShadow: { borderRadius: 999, borderCurve: "continuous", shadowColor: "#0f172a", shadowOpacity: 0.18, shadowRadius: 18, shadowOffset: { width: 0, height: 10 }, backgroundColor: "rgba(255,255,255,0.001)" },
  saveBtn: { height: 48, paddingHorizontal: 26, borderRadius: 999, borderCurve: "continuous", borderWidth: 1, overflow: "hidden", justifyContent: "center" },
  saveInner: { flex: 1, minWidth: 56, height: 20, alignItems: "center", justifyContent: "center" },
  saveText: { fontSize: 16, lineHeight: 20, fontWeight: "700", color: "rgba(51,65,85,0.95)", includeFontPadding: false },
  saveCheck: { position: "absolute", alignItems: "center", justifyContent: "center" },

  note: { marginTop: 24, fontSize: 16, lineHeight: 22, color: "rgba(100,116,139,0.85)", includeFontPadding: false },

  batchOverlay: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(15,23,42,0.28)",
  },
  batchSheet: {
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    borderCurve: "continuous",
    backgroundColor: "#ffffff",
    overflow: "hidden",
    shadowColor: "#0f172a",
    shadowOpacity: 0.16,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: -8 },
    maxHeight: "82%",
  },
  batchHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#eef2f7",
  },
  batchHeaderTextWrap: {
    flex: 1,
    gap: 4,
  },
  batchTitle: {
    fontSize: 20,
    lineHeight: 24,
    fontWeight: "800",
    color: "#0f172a",
    includeFontPadding: false,
  },
  batchSubtitle: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "700",
    color: "#64748b",
    includeFontPadding: false,
  },
  batchCloseBtn: {
    width: 34,
    height: 34,
    borderRadius: 999,
    borderCurve: "continuous",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f8fafc",
  },
  batchScroll: {
    flexGrow: 0,
  },
  batchScrollContent: {
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 16,
    gap: 20,
  },
  batchSection: {
    gap: 12,
  },
  batchSectionTitle: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "900",
    color: "#475569",
    textTransform: "uppercase",
    letterSpacing: 0.9,
    includeFontPadding: false,
  },
  batchChipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  batchChoiceChip: {
    minHeight: 36,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderCurve: "continuous",
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.32)",
    backgroundColor: "rgba(248,250,252,0.96)",
    justifyContent: "center",
  },
  batchChoiceChipActive: {
    borderColor: "rgba(30,64,175,0.3)",
    backgroundColor: "rgba(219,234,254,0.64)",
  },
  batchChoiceText: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "700",
    color: "#64748b",
    includeFontPadding: false,
  },
  batchChoiceTextActive: {
    color: "#1e3a8a",
  },
  batchSummaryCard: {
    gap: 4,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#DBEAFE",
    backgroundColor: "#EFF6FF",
  },
  batchSummaryTitle: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "800",
    color: "#1D4ED8",
    includeFontPadding: false,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  batchSummaryBody: {
    fontSize: 13,
    lineHeight: 19,
    fontWeight: "700",
    color: "#1F2937",
    includeFontPadding: false,
  },
  batchSummaryMeta: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "600",
    color: "#475569",
    includeFontPadding: false,
  },
  batchFooter: {
    gap: 12,
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 18,
    borderTopWidth: 1,
    borderTopColor: "#eef2f7",
    backgroundColor: "#ffffff",
  },
  batchFooterHint: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "700",
    color: "#64748b",
    includeFontPadding: false,
  },
  batchApplyBtn: {
    minHeight: 48,
    borderRadius: 16,
    borderCurve: "continuous",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#0f172a",
    paddingHorizontal: 16,
  },
  batchApplyBtnDisabled: {
    backgroundColor: "#e2e8f0",
  },
  batchApplyText: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "800",
    color: "#ffffff",
    includeFontPadding: false,
  },
  batchApplyTextDisabled: {
    color: "#94a3b8",
  },

  startDateOverlay: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(15,23,42,0.4)" },
  startDateModal: {
    width: "88%",
    maxWidth: 360,
    borderRadius: 28,
    borderCurve: "continuous",
    backgroundColor: "#ffffff",
    overflow: "hidden",
    shadowColor: "#0f172a",
    shadowOpacity: 0.18,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 12 },
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 18,
    gap: 14,
  },
  startDateModalHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  startDateModalTitleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  startDateModalTitle: { fontSize: 16, fontWeight: "700", color: "#0f172a", includeFontPadding: false },
  startDateModalClose: {
    width: 32,
    height: 32,
    borderRadius: 999,
    borderCurve: "continuous",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f1f5f9",
  },
  startDateModalSubtitle: { fontSize: 12, lineHeight: 17, fontWeight: "600", color: "#64748b", includeFontPadding: false },
  startDateQuickActionRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  startDateQuickActionChip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    borderCurve: "continuous",
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.35)",
    backgroundColor: "rgba(248,250,252,0.95)",
  },
  startDateQuickActionChipActive: {
    borderColor: "rgba(37,99,235,0.35)",
    backgroundColor: "rgba(219,234,254,0.7)",
  },
  startDateQuickActionText: { fontSize: 12, lineHeight: 16, fontWeight: "700", color: "#64748b", includeFontPadding: false },
  startDateQuickActionTextActive: { color: "#1d4ed8" },
  startDateMonthRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  startDateMonthNav: {
    width: 32,
    height: 32,
    borderRadius: 999,
    borderCurve: "continuous",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f8fafc",
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },
  startDateMonthLabel: {
    flex: 1,
    textAlign: "center",
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "800",
    color: "#334155",
    includeFontPadding: false,
    paddingHorizontal: 8,
  },

  noteOverlay: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(15,23,42,0.4)" },
  noteModal: {
    width: "88%",
    maxWidth: 360,
    maxHeight: "70%",
    borderRadius: 32,
    borderCurve: "continuous",
    backgroundColor: "#ffffff",
    overflow: "hidden",
    shadowColor: "#0f172a",
    shadowOpacity: 0.2,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 12 },
  },
  noteModalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#f1f5f9",
  },
  noteModalTitleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  noteModalTitle: { fontSize: 16, fontWeight: "700", color: "#0f172a", includeFontPadding: false },
  noteModalClose: {
    width: 32,
    height: 32,
    borderRadius: 999,
    borderCurve: "continuous",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f1f5f9",
  },
  noteModalBody: { paddingHorizontal: 20, paddingVertical: 16 },
  noteModalText: { fontSize: 14, lineHeight: 22, fontWeight: "600", color: "#475569", includeFontPadding: false },
  noteModalFooter: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: "#f8fafc",
    alignItems: "flex-end",
    backgroundColor: "#f8fafc",
  },
  noteModalEdit: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 12,
    borderCurve: "continuous",
    borderWidth: 1,
    borderColor: "#e2e8f0",
    backgroundColor: "#ffffff",
  },
  noteModalEditText: { fontSize: 12, fontWeight: "700", color: "#64748b", includeFontPadding: false },

});

export const mySupplementSmartFilterInternals = {
  buildGoalTagToKeyMap,
  buildTypeTagToKeyMap,
  filterSupplementsByActiveTags,
  matchesEvaluatedSmartFilterTag,
  getMembershipReasonCodes,
  getMembershipMatchTier,
  isEvaluatedCoverageReadyMembership,
};
