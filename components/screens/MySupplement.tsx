import { BlurView } from "expo-blur";
import { LinearGradient } from "expo-linear-gradient";
import {
  ArrowRight,
  Check,
  Clock,
  Edit2,
  Maximize2,
  Moon,
  NotebookPen,
  Plus,
  Search,
  SlidersHorizontal,
  StickyNote,
  Sun,
  X,
} from "lucide-react-native";
import { AnimatePresence, MotiView } from "moti";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
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
import { Config } from "@/constants/Config";
import { useAuth } from "@/contexts/AuthContext";
import { useOnboarding } from "@/contexts/OnboardingContext";
import { useScanHistory } from "@/contexts/ScanHistoryContext";
import { useSavedSupplements } from "@/contexts/SavedSupplementsContext";
import { useScreenTokens } from "@/hooks/useScreenTokens";
import { trackOnboardingEvent } from "@/lib/analytics/onboarding";
import { withAuthHeaders } from "@/lib/auth-token";
import { GOAL_OPTIONS, TYPE_OPTIONS, resolveVisibleGoalTags, resolveTypeTags } from "@/lib/onboarding-v2";
import { resolveRoutineTimeUserSet } from "@/lib/routineIntent";
import {
  loadMealTimePrefs,
  updateMealTimePrefSlot,
  type MealTimePrefs,
} from "@/lib/storage/meal-time-prefs";
import { buildSuggestedRoutineV0 } from "@/lib/suggestedRoutine";
import { buildWhatsInsideDisplay } from "@/lib/supplementFactsDisplay";
import { formatBrandForPill, formatDoseForPill } from "@/lib/supplementDisplay";
import { supabase } from "@/lib/supabase";
import { buildTimingSuggestion } from "@/lib/timingSuggestion";
import { getOdsFactForSupplement } from "@/lib/knowledge/ods-factpack";
import { getNonOdsFactForSupplement } from "@/lib/knowledge/non-ods-factpack";
import { pickMeaningfulOverviewText } from "@/lib/knowledge/what-it-does";
import {
  buildApplyCopy,
  buildAutosyncPatch,
  buildScheduleHintText,
  isAnchorSlotActive,
  shouldRunAnchorAutosync,
  shouldShowSuggestedPlanCard,
  shouldShowScheduleTimeCategoryPill,
} from "@/lib/schedulePresentation";
import type { RoutinePreferences, SavedSupplement } from "@/types/saved-supplements";

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
    tags: [...GOAL_OPTIONS],
  },
  {
    title: "Type",
    color: { bg: "#faf5ff", text: "#6b21a8", border: "#f3e8ff" },
    activeColor: {
      bg: "rgba(168,85,247,0.15)",
      text: "#6b21a8",
      border: "rgba(216,180,254,0.6)",
    },
    tags: [...TYPE_OPTIONS],
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
    suggestedUse: string | null;
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

const CollectionCard = React.memo(
  function CollectionCard({
    item,
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
                  from={{ opacity: 0, scale: 0.86, translateY: -2 }}
                  animate={{ opacity: 1, scale: 1, translateY: 0 }}
                  exit={{ opacity: 0, scale: 0.92, translateY: -2 }}
                  transition={{ type: "spring", stiffness: 320, damping: 22 }}
                  style={styles.selectCheckBubble}
                >
                  <BlurView intensity={14} tint="light" style={StyleSheet.absoluteFillObject} />
                  <LinearGradient
                    colors={["rgba(255,255,255,0.45)", "rgba(255,255,255,0.20)"]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={StyleSheet.absoluteFillObject}
                  />
                  <Check size={18} color={theme.textColor === "#ffffff" ? "#ffffff" : "#0f172a"} />
                </MotiView>
              ) : null}
            </AnimatePresence>

            <View style={styles.cardInner}>
              <View style={styles.cardHeader}>
                <Text style={[styles.cardTitle, { color: theme.textColor }]} numberOfLines={1} ellipsizeMode="tail">
                  {getShortProductName(item.productName, item.brandName)}
                </Text>

                {selectionMode || !scheduleIcon ? (
                  <View style={{ width: 24, height: 24 }} />
                ) : scheduleIcon === "sun" ? (
                  <Sun size={24} color={theme.textColor} />
                ) : (
                  <Moon size={24} color={theme.textColor} />
                )}
              </View>

	              <View style={styles.cardMeta}>
	                <View style={styles.tagRow}>
	                  <View style={[styles.tagPill, styles.brandPillClamp, { borderColor: theme.tagBorderColor }]}>
	                    <Text
	                      style={[styles.tagText, styles.pillTextClamp, { color: theme.textColor }]}
	                      numberOfLines={1}
	                      ellipsizeMode="tail"
	                    >
	                      {formatBrandForPill(item.brandName)}
	                    </Text>
	                  </View>
	                  {(() => {
	                    const dose = formatSavedDoseForDisplay(item.dosageText);
	                    if (!dose) return null;
	                    return (
	                      <View style={[styles.tagPill, styles.dosePillClamp, { borderColor: theme.tagBorderColor }]}>
	                        <Text
	                          style={[styles.tagText, styles.pillTextClamp, { color: theme.textColor }]}
	                          numberOfLines={1}
	                          ellipsizeMode="tail"
	                        >
	                          {dose}
	                        </Text>
	                      </View>
	                    );
	                  })()}
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
  stackOverlaps,
  mealTimePrefs,
  onLearnMealTimePref,
  onClose,
  onSaveRoutine,
}: {
  item: SavedSupplement;
  theme: Theme;
  stackOverlaps?: StackOverlapItem[];
  mealTimePrefs?: MealTimePrefs | null;
  onLearnMealTimePref?: (
    label: "Breakfast" | "Lunch" | "Dinner" | "Bedtime",
    time: string,
    mode: "seed" | "manual",
  ) => void | Promise<void>;
  onClose: () => void;
  onSaveRoutine?: (id: string, prefs: RoutinePreferences) => void | Promise<void>;
}) {
  const insets = useSafeAreaInsets();
  const screenHeight = Dimensions.get("window").height;
  const screenWidth = Dimensions.get("window").width;
  const { updateSupplement } = useSavedSupplements();
  const [note, setNote] = useState(item.routine?.note ?? "");
  const [time, setTime] = useState(item.routine?.time ?? "08:00");
  const [withFood, setWithFood] = useState(item.routine?.withFood ?? false);
  const [timeTouched, setTimeTouched] = useState(false);
  const [facts, setFacts] = useState<MySupplementFactsV1 | null>(null);
  const [factsStatus, setFactsStatus] = useState<"full" | "partial" | "none">("none");
  const [factsDigestHash, setFactsDigestHash] = useState<string | null>(null);
  const [factsSourceVersion, setFactsSourceVersion] = useState<string | null>(null);
  const [factsRefreshExhausted, setFactsRefreshExhausted] = useState(false);
  const [factsRefreshRetryNonce, setFactsRefreshRetryNonce] = useState(0);
  const [analysisData, setAnalysisData] = useState<AnalysisPayload | null>(null);
  const [aiStatus, setAiStatus] = useState<"ready" | "pending" | "blocked" | "none">("none");
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
  const [saveState, setSaveState] = useState<"idle" | "saved">(
    item.routine?.note || item.routine?.time || item.routine?.withFood !== undefined ? "saved" : "idle",
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
  const [overviewExpanded, setOverviewExpanded] = useState(false);
  const [selectedAnchorLabel, setSelectedAnchorLabel] = useState<"Breakfast" | "Dinner" | null>(null);
  const autoAnchorSyncedRef = useRef<string | null>(null);
  const [anchorPrefilled, setAnchorPrefilled] = useState(false);
  const autosyncedThisSessionRef = useRef(false);
  const detailOpenedAtRef = useRef<number>(Date.now());
  const odsFirstPaintLoggedRef = useRef(false);

  const lastSavedRef = useRef<RoutinePreferences>({
    note: item.routine?.note ?? "",
    time: item.routine?.time ?? "",
    timeUserSet: item.routine?.timeUserSet ?? undefined,
    withFood: item.routine?.withFood ?? false,
  });
  const lastDetailItemIdRef = useRef<string | null>(null);

  useEffect(() => {
    const next = {
      note: item.routine?.note ?? "",
      time: item.routine?.time ?? "",
      timeUserSet: item.routine?.timeUserSet ?? undefined,
      withFood: item.routine?.withFood ?? false,
    };
    lastSavedRef.current = next;
    setNote(next.note ?? "");
    setTime(next.time || "08:00");
    setWithFood(!!next.withFood);
    setTimeTouched(false);
    setUnsaveArmed(false);
    if (unsaveArmTimerRef.current) clearTimeout(unsaveArmTimerRef.current);
    unsaveArmTimerRef.current = null;
    setOverviewExpanded(false);
    setSelectedAnchorLabel(null);
    autoAnchorSyncedRef.current = null;
    autosyncedThisSessionRef.current = false;
    setAnchorPrefilled(false);
    detailOpenedAtRef.current = Date.now();
    odsFirstPaintLoggedRef.current = false;
    setSaveState(next.note || next.time || next.withFood !== undefined ? "saved" : "idle");
  }, [item.id, item.routine?.note, item.routine?.time, item.routine?.timeUserSet, item.routine?.withFood]);

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
      const nextFactsStatus = meta?.factsStatus ?? computeFactsStatusClient(payload);
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
      supplementId: string,
      ensured: EnsureOverviewResponse | null,
    ) => {
      if (!ensured) {
        finalizeTimeout();
        return;
      }

      const responseFacts = ensured.facts ?? null;
      const responseFactsDigestHash =
        ensured.factsDigestHash ?? responseFacts?.factsDigestHash ?? null;
      const responseFactsSourceVersion =
        ensured.factsSourceVersion ?? responseFacts?.factsSourceVersion ?? null;
      const responseFactsStatus = ensured.factsStatus ?? computeFactsStatusClient(responseFacts);

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

      let supplementId = item.supplementId ?? null;
      if (supplementId) {
        const cachedFacts = factsCache.get(supplementId);
        if (cachedFacts && isActive) {
          finalizeFacts(supplementId, cachedFacts, {
            factsStatus: computeFactsStatusClient(cachedFacts),
            factsDigestHash: cachedFacts.factsDigestHash ?? null,
            factsSourceVersion: cachedFacts.factsSourceVersion ?? null,
          });
        }
      }

      // Backfill supplementId when older local items are missing it (detail-open only).
      if (!supplementId) {
        const ensured = await ensureOverview({
          supplementId: null,
          barcode: item.barcode ?? null,
          brandName: item.brandName ?? null,
          productName: item.productName,
          dosageText: dosageShort,
          userSupplementId,
        });

        supplementId = ensured?.supplementId ?? null;
        if (supplementId && ensured?.facts) {
          finalizeFacts(supplementId, ensured.facts);
        }

        if (supplementId && item.supplementId !== supplementId) {
          // Best-effort sync; failure shouldn't block Overview rendering.
          void updateSupplement(item.id, { supplementId }).catch((error) => {
            const message = error instanceof Error ? error.message : "Unknown error";
            console.warn("[supplement-overview] Failed to persist supplementId", message);
          });
        }

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
          supplementId,
          barcode: item.barcode ?? null,
          brandName: item.brandName ?? null,
          productName: item.productName,
          dosageText: dosageShort,
          userSupplementId,
        });

        if (!isActive) return;
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

      try {
        const ensured = await ensureOverview({
          supplementId: item.supplementId ?? null,
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

        const nextFacts = ensured.facts;
        const nextFactsStatus = ensured.factsStatus ?? computeFactsStatusClient(nextFacts);
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
        if (ensured.supplementId) {
          factsCache.set(ensured.supplementId, nextFacts);
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
          supplementId: item.supplementId ?? null,
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
    if (noteChanged || timeChanged || foodChanged) setSaveState("idle");
  }, [note, saveState, time, withFood]);

  useEffect(() => {
    // Cancel "Unsave" confirmation if anything changes.
    if (!unsaveArmed) return;
    setUnsaveArmed(false);
  }, [note, saveState, time, withFood]);

  const routineTimeUserSet = resolveRoutineTimeUserSet(item.routine);
  const savedTime = routineTimeUserSet && item.routine?.time?.trim() ? item.routine.time : null;
  const timeCategory = getTimeCategory(savedTime ?? undefined);
  const showTimeCategoryPill = shouldShowScheduleTimeCategoryPill(savedTime, Boolean(timeCategory));

  const handleSave = async () => {
    const nextTimeUserSet = Boolean(time?.trim()) && (timeTouched || routineTimeUserSet);
    const prefs: RoutinePreferences = {
      note,
      time,
      timeUserSet: nextTimeUserSet,
      withFood,
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

  const fallback = buildLocalOverviewFallback({
    productName: item.productName,
    dosageText: formatSavedDoseForDisplay(item.dosageText),
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
  const aiTips = Array.isArray(aiV2?.tips) ? aiV2.tips.filter(isNonEmptyString).slice(0, 3) : [];
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

  const suggestedTimingLabel = timingSuggestion.source === "label" ? "Suggested (label)" : "Suggested (general)";
  const suggestedTimingText = formatSentence(timingSuggestion.text);
  const suggestedReasonText = (() => {
    switch (timingSuggestion.reasonKind) {
      case "label_says_with_meals":
        return "Why (label): Label suggests taking with meals.";
      case "fat_soluble":
        return "Why (general tip): Often taken with a meal (fat can help absorption).";
      case "reduce_nausea":
        return "Why (general tip): Taking with food may reduce stomach upset.";
      default:
        return "";
    }
  })();

  const localDose = formatSavedDoseForDisplay(item.dosageText);
  const whatsInsideDisplay = buildWhatsInsideDisplay({
    actives: facts?.actives ?? [],
    dosageText: localDose,
    productName: item.productName,
    overlayIngredients: facts?.overlay?.ingredients ?? [],
  });
  const labelDirectionsRaw = typeof facts?.directions?.rawText === "string" ? facts.directions.rawText.trim() : "";
  const overlaySuggestedUseRaw =
    typeof facts?.overlay?.suggestedUse === "string" ? facts.overlay.suggestedUse.trim() : "";
  const resolvedDirectionsRaw = overlaySuggestedUseRaw || labelDirectionsRaw;
  const showDirectionsRow = Boolean(resolvedDirectionsRaw) || factsStatus === "full";
  const labelDirectionsPrimaryText = resolvedDirectionsRaw || "Directions not found for this product.";
  const labelDirectionsMetaText = !resolvedDirectionsRaw && factsStatus === "full"
    ? "Check the bottle label. You can add your own note below."
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
  const mealChoiceSlots = suggestedRoutine.displayMode === "choice_slots"
    ? suggestedRoutine.slots.filter((slot) => slot.label === "Breakfast" || slot.label === "Dinner")
    : [];
  const defaultChoiceLabel =
    mealChoiceSlots.find((slot) => slot.label === suggestedRoutine.applyAnchor.label)?.label ?? mealChoiceSlots[0]?.label ?? null;
  const selectedChoiceLabel = selectedAnchorLabel && mealChoiceSlots.some((slot) => slot.label === selectedAnchorLabel)
    ? selectedAnchorLabel
    : defaultChoiceLabel;
  const selectedChoiceSlot = selectedChoiceLabel
    ? mealChoiceSlots.find((slot) => slot.label === selectedChoiceLabel) ?? null
    : null;
  const effectiveApplyAnchor = suggestedRoutine.requiresManualTime
    ? {
        ...suggestedRoutine.applyAnchor,
        time,
        withFood,
      }
    : selectedChoiceSlot ?? suggestedRoutine.applyAnchor;
  const applyCopy = buildApplyCopy({
    requiresManualTime: suggestedRoutine.requiresManualTime,
    timesPerDaySource: suggestedRoutine.timesPerDaySource,
    timesPerDaySuggested: suggestedRoutine.timesPerDaySuggested,
    displayMode: suggestedRoutine.displayMode,
    anchor: effectiveApplyAnchor,
  });
  const applySuggestionButtonText = applyCopy.buttonText;
  const effectiveApplyNotice = applyCopy.notice;
  const showAddLabelDirectionsCta = !resolvedDirectionsRaw && factsStatus === "full";
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
  const usingOdsOverview = hasOdsFoundation && !odsFactHit?.qualityRejected;

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
      if (
        suggestedRoutine.timingKind === "meal_based" &&
        (anchor.label === "Breakfast" || anchor.label === "Lunch" || anchor.label === "Dinner" || anchor.label === "Bedtime")
      ) {
        await onLearnMealTimePref?.(anchor.label, anchor.time, "seed");
      }
    } finally {
      setSaveState("saved");
    }
  };

  const whatItDoesCandidate = pickMeaningfulOverviewText({
    productName: item.productName,
    candidates: [
      hasOdsFoundation ? odsFactHit?.entry.overview ?? "" : "",
      hasNonOdsFoundation ? nonOdsFactHit?.entry.overview ?? "" : "",
      typeof aiV2?.whatItIs === "string" ? aiV2.whatItIs.trim() : "",
      efficacy?.overviewSummary ? normalizeTwoSentenceSummary(efficacy.overviewSummary) : "",
      benefitSummary,
      fallback.summary,
    ],
  });
  const whatItDoesText = whatItDoesCandidate.text;

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
      source: usingOdsOverview ? "ods" : hasNonOdsFoundation ? "curated" : "fallback",
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
        rendered: foundationWhatItDoesBullets.length,
      });
    }
  }, [
    factsDigestHash,
    foundationWhatItDoesBullets.length,
    hasNonOdsFoundation,
    hasOdsFoundation,
    item.id,
    item.supplementId,
    odsFactHit?.qualityRejected,
    usingOdsOverview,
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
  const overviewDetailsLoading = (factsStatus === "partial" && !factsRefreshExhausted) || aiUiPhase === "pending";
  const overviewDetailsReady =
    !overviewDetailsLoading &&
    (foundationWhatItDoesBullets.length > 0 ||
      watchOutLines.length > 0 ||
      aiNotice.length > 0 ||
      aiTips.length > 0 ||
      stackOverlapLines.length > 0 ||
      aiUiPhase === "ready");
  const showOverviewToggle =
    overviewDetailsLoading ||
    overviewDetailsReady ||
    watchOutLines.length > 0 ||
    aiUiPhase === "blocked" ||
    aiUiPhase === "none";
  const whatsInsideLinesForDisplay = overviewExpanded
    ? whatsInsideDisplay.lines
    : whatsInsideDisplay.lines.slice(0, 3);
  const whatsInsideExtraCount =
    Math.max(0, whatsInsideDisplay.hiddenCount) +
    Math.max(0, whatsInsideDisplay.lines.length - whatsInsideLinesForDisplay.length);

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
	                      {formatBrandForPill(item.brandName)}
	                    </Text>
	                  </View>
	                  {(() => {
	                    const dose = formatSavedDoseForDisplay(item.dosageText);
	                    if (!dose) return null;
	                    return (
	                      <View style={[styles.sheetTag, styles.dosePillClamp, { borderColor: theme.tagBorderColor }]}>
	                        <Text
	                          style={[styles.sheetTagText, styles.pillTextClamp, { color: theme.textColor }]}
	                          numberOfLines={1}
	                        >
	                          {dose}
	                        </Text>
	                      </View>
	                    );
	                  })()}
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
                          whatsInsideDisplay.source === "actives" ||
                          whatsInsideDisplay.source === "inferred" ? (
	                          <View style={{ gap: 10 }}>
	                            {whatsInsideLinesForDisplay.map((line) => (
	                              <View key={line} style={styles.overviewBulletRow}>
	                                <View style={styles.overviewBulletDot} />
	                                <Text style={styles.overviewBulletText}>{line}</Text>
	                              </View>
	                            ))}
	                            {whatsInsideExtraCount > 0 ? (
	                              <Text style={styles.overviewMetaText}>+{whatsInsideExtraCount} more</Text>
	                            ) : null}
	                            {whatsInsideDisplay.metaText ? (
	                              <Text style={styles.overviewMetaText}>{whatsInsideDisplay.metaText}</Text>
	                            ) : null}
                          </View>
                        ) : whatsInsideDisplay.source === "dose" ? (
                          <View style={{ gap: 8 }}>
                            <Text style={styles.overviewBulletText}>{whatsInsideDisplay.lines[0]}</Text>
                            {factsStatus === "partial" ? (
                              <Text style={styles.overviewMetaText}>
                                Main ingredient is still loading from the label...
                              </Text>
                            ) : null}
                          </View>
                        ) : (
                          <Text style={styles.overviewBulletText}>
                            <Text style={styles.overviewBulletLabel}>Dose: </Text>
                            {localDose ?? "Follow the product label."}
                          </Text>
                        )}
                      </View>

	                      <View style={{ gap: 10 }}>
	                        <Text style={styles.overviewSectionTitle}>How to use</Text>

	                        {showDirectionsRow ? (
	                          <>
	                            <Text style={styles.overviewBulletText}>
	                              <Text style={styles.overviewBulletLabel}>
                                {overlaySuggestedUseRaw
                                    ? "Directions (from iHerb): "
                                    : labelDirectionsRaw
                                      ? "Directions (from label): "
                                      : "Directions: "}
	                              </Text>
	                              {labelDirectionsPrimaryText}
	                            </Text>
	                            {labelDirectionsMetaText ? (
	                              <Text style={styles.overviewMetaText}>{labelDirectionsMetaText}</Text>
	                            ) : null}
	                            {showAddLabelDirectionsCta ? (
	                              <Pressable onPress={handleAddLabelDirections} style={styles.addLabelCtaBtn}>
	                                <Text style={styles.addLabelCtaText}>Add label directions</Text>
	                              </Pressable>
	                            ) : null}
	                          </>
	                        ) : null}

	                        <Text style={styles.overviewBulletText}>
	                          <Text style={styles.overviewBulletLabel}>{suggestedTimingLabel}: </Text>
	                          {suggestedTimingText}
	                        </Text>
	                        {suggestedReasonText ? (
	                          <Text style={styles.overviewBulletText}>{formatSentence(suggestedReasonText)}</Text>
	                        ) : null}

	                        {overviewExpanded && aiTips.length > 0 ? (
	                          <View style={{ gap: 10 }}>
	                            {aiTips.map((tip) => (
	                              <View key={tip} style={styles.overviewBulletRow}>
	                                <View style={styles.overviewBulletDot} />
                                <Text style={styles.overviewBulletText}>{formatSentence(tip)}</Text>
                              </View>
                            ))}
                          </View>
                        ) : null}
                      </View>

	                      <View style={{ gap: 10 }}>
	                        <Text style={styles.overviewSectionTitle}>What it does</Text>
		                        <Text style={styles.overviewSummary}>
	                            {whatItDoesText}
	                          </Text>
                        {overviewExpanded && foundationWhatItDoesBullets.length > 0 ? (
                          <View style={{ gap: 8 }}>
                            {foundationWhatItDoesBullets.map((line) => (
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

	                      {overviewExpanded && stackOverlapLines.length > 0 ? (
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

		                      {overviewExpanded && foundationSourceTitle ? (
		                        foundationSourceUrl ? (
		                          <Pressable
		                            onPress={() => {
		                              void Linking.openURL(foundationSourceUrl).catch((error) => {
		                                const message = error instanceof Error ? error.message : "Unknown error";
		                                console.warn("[ods-fallback] Failed to open source URL", message);
		                              });
		                            }}
		                            style={styles.overviewSourceLinkBtn}
		                          >
		                            <Text style={styles.overviewSourceLinkText}>{foundationSourceTitle}</Text>
		                          </Pressable>
		                        ) : (
		                          <View style={styles.overviewSourceLinkBtn}>
		                            <Text style={styles.overviewSourceLinkText}>{foundationSourceTitle}</Text>
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
                        {showSuggestedPlanCard ? (
                          <View style={styles.suggestedRoutineCard}>
	                          <View style={styles.suggestedRoutineHeader}>
	                            <Text style={styles.suggestedRoutineTitle}>Suggested plan</Text>
                            <Text style={styles.suggestedRoutineMeta}>
                              {suggestedRoutine.source === "label" ? "From label facts" : "Heuristic"}
                              {" · "}
                              {suggestedRoutine.confidence}
                            </Text>
                          </View>
	                          <Text style={styles.suggestedRoutineRationale}>{suggestedRoutine.rationale}</Text>
                            {suggestedRoutine.displayMode === "choice_slots" ? (
                              <View style={styles.anchorChoiceRow}>
                                {mealChoiceSlots.map((slot) => {
                                  const isSelected = selectedChoiceLabel === slot.label;
                                  return (
                                    <Pressable
                                      key={`anchor-choice-${slot.label}`}
                                      style={[styles.anchorChoiceChip, isSelected && styles.anchorChoiceChipActive]}
                                      onPress={() => {
                                        setSelectedAnchorLabel(slot.label === "Breakfast" ? "Breakfast" : "Dinner");
                                      }}
                                    >
                                      <Text style={[styles.anchorChoiceText, isSelected && styles.anchorChoiceTextActive]}>
                                        {slot.label}
                                      </Text>
                                    </Pressable>
                                  );
                                })}
                              </View>
                            ) : null}
	                          <View style={styles.suggestedRoutineSlots}>
	                            {suggestedRoutine.requiresManualTime ? (
	                              <Text style={styles.suggestedRoutineSlotText}>Flexible · choose time</Text>
	                            ) : (
	                              suggestedRoutine.slots.map((slot, idx) => (
	                                  <Text
                                    key={`${slot.label}-${slot.time}-${idx}`}
                                    style={[
                                      styles.suggestedRoutineSlotText,
	                                      isAnchorSlotActive(slot, effectiveApplyAnchor)
	                                        ? styles.suggestedRoutineSlotTextActive
	                                        : null,
                                    ]}
                                  >
	                                  {`${slot.label} · ${slot.time}${slot.withFood ? " · with food" : ""}`}
	                                </Text>
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
  const { draft } = useOnboarding();
  const { scans } = useScanHistory();
  const { updateSupplement } = useSavedSupplements();

  const contentBottomPadding = tokens.contentBottomPadding;
  const contentTopPadding = tokens.contentTopPadding;

  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
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
  const [mealTimePrefs, setMealTimePrefs] = useState<MealTimePrefs | null>(null);

  const visibleGoalTags = useMemo(
    () => resolveVisibleGoalTags(draft?.smartFilterConfig?.visibleGoals ?? draft?.goals),
    [draft?.goals, draft?.smartFilterConfig?.visibleGoals],
  );
  const seededTypeTags = useMemo(
    () => resolveTypeTags(draft?.smartFilterConfig?.preselectedTypes ?? draft?.preferredTypes),
    [draft?.preferredTypes, draft?.smartFilterConfig?.preselectedTypes],
  );
  const smartTagCategories = useMemo<TagCategory[]>(() => {
    return SMART_TAG_BASE_CATEGORIES.map((category) =>
      category.title === "Goals" ? { ...category, tags: visibleGoalTags } : category,
    );
  }, [visibleGoalTags]);
  const hasSeededFiltersRef = useRef(false);
  const hasLoggedFirstFilterUseRef = useRef(false);

  const pillWidthRef = useRef(84);
  const [pillWidth, setPillWidth] = useState(84);
  const updatedDosageRef = useRef(new Map<string, string>());
  const dosageMetadataBackfillStartedRef = useRef(false);
  const filterTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const filterScrollRef = useRef<ScrollView>(null);
  const filterWrapRef = useRef<View>(null);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
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

  useEffect(() => () => clearFilterTimers(), [clearFilterTimers]);

  useEffect(() => {
    if (hasSeededFiltersRef.current) return;
    if (seededTypeTags.length === 0) return;
    if (data.length === 0) return;
    const hasSeedMatch = data.some((item) =>
      (item.tags ?? []).some((tag) => seededTypeTags.includes(tag)),
    );
    if (!hasSeedMatch) {
      hasSeededFiltersRef.current = true;
      return;
    }

    setActiveTags((prev) => {
      if (prev.size > 0) return prev;
      return new Set(seededTypeTags);
    });
    hasSeededFiltersRef.current = true;
  }, [data, seededTypeTags]);

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
    () => data.map((item) => ({ ...item, dosageText: resolveDosageText(item) })),
    [data, resolveDosageText],
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
        }
        return;
      }

      const bySupplement = new Map<string, StackOverlapItem[]>();
      const countBySupplement = new Map<string, number>();

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

      setStackOverlapBySupplementId(bySupplement);
      setStackOverlapCountBySupplementId(countBySupplement);
      if (payload.overlaps.length > 0) {
        logStackOverlapEvent("stack_overlap_exposed", {
          overlapCount: payload.summary?.overlapCount ?? payload.overlaps.length,
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
      result = result.filter((s) => {
        const hasMatchingStaticTag = s.tags && s.tags.some((tag) => activeTags.has(tag));
        const isRecentlyViewed = activeTags.has("Recently Viewed") && !!s.lastViewed;
        return hasMatchingStaticTag || isRecentlyViewed;
      });
    }

    return result;
  }, [activeTags, resolvedData, search, sorted]);

  const cards = useMemo(
    () =>
      filtered.map((item, idx) => ({
        item,
        idx,
        theme: idToThemeMap.get(item.id) || THEMES[0],
      })),
    [filtered, idToThemeMap],
  );

  const selectedCount = selectedIds.size;

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
    headerLabel = `Delete (${selectedCount})`;
    headerIsDelete = true;
  } else {
    headerLabel = "Done";
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
  }, []);

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
      return;
    }

    exitSelection();
  }, [
    assigningTag,
    data,
    detailId,
    exitSelection,
    logStackOverlapEvent,
    onDeleteSelected,
    selectedIds,
    selectionMode,
    stackOverlapCountBySupplementId,
    updateSupplement,
  ]);

  const handleSaveRoutine = useCallback(
    async (id: string, prefs: RoutinePreferences) => {
      await onSaveRoutine?.(id, prefs);
    },
    [onSaveRoutine],
  );

  const markAsViewed = useCallback(
    (id: string) => {
      updateSupplement(id, { lastViewed: new Date().toISOString() }).catch(() => undefined);
    },
    [updateSupplement],
  );

  const toggleTag = useCallback((tag: string) => {
    setActiveTags((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });
  }, []);

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
        <MotiView
          ref={isOverlay ? undefined : filterWrapRef}
          shouldRasterizeIOS
          renderToHardwareTextureAndroid
          from={{
            width: FILTER_COLLAPSED_SIZE,
            height: FILTER_COLLAPSED_SIZE,
            borderRadius: 27,
            backgroundColor: "#E4E7EB",
            borderColor: "rgba(255,255,255,0)",
          }}
          style={[
            styles.filterWrap,
            isOverlay && filterAnchor
              ? {
                  right: filterAnchorRight,
                  top: filterAnchor.y,
                }
              : null,
          ]}
          animate={{
            width: filterState === "closed" ? FILTER_COLLAPSED_SIZE : contentWidth,
            height: filterState === "open" ? filterOpenHeight : FILTER_COLLAPSED_SIZE,
            borderRadius: filterState === "closed" ? 27 : 32,
            backgroundColor: filterState === "closed" ? "#E4E7EB" : "rgba(255,255,255,0.72)",
            borderColor: filterState === "closed" ? "rgba(255,255,255,0)" : "rgba(255,255,255,0.5)",
            opacity: isVisible ? 1 : 0,
          }}
          transition={{
            width: { type: "timing", duration: FILTER_WIDTH_DURATION, easing: FILTER_EASING },
            height: { type: "timing", duration: FILTER_HEIGHT_DURATION, easing: FILTER_EASING },
            borderRadius: { type: "timing", duration: 240, easing: FILTER_EASING },
            backgroundColor: { type: "timing", duration: 220, easing: FILTER_EASING },
            borderColor: { type: "timing", duration: 220, easing: FILTER_EASING },
            opacity: { type: "timing", duration: 180, easing: FILTER_EASING },
          }}
          pointerEvents={isVisible ? "auto" : "none"}
        >
        <AnimatePresence>
          {filterContentVisible ? (
            <MotiView
              key="filter-open"
              shouldRasterizeIOS
              renderToHardwareTextureAndroid
              animate={{
                opacity: filterContentActive ? 1 : 0,
                translateY: filterContentActive ? 0 : 6,
              }}
              transition={{ type: "timing", duration: 200 }}
              style={styles.filterInner}
              pointerEvents={filterContentActive ? "auto" : "none"}
            >
              <BlurView intensity={36} tint="light" style={StyleSheet.absoluteFillObject} />
              <View style={styles.filterInnerTint} pointerEvents="none" />
              <LinearGradient
                pointerEvents="none"
                colors={["rgba(255,255,255,0.70)", "rgba(255,255,255,0.28)", "rgba(255,255,255,0)"]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={StyleSheet.absoluteFillObject}
              />
              <View style={styles.filterInnerBorder} pointerEvents="none" />

              <KeyboardAvoidingView
                behavior={Platform.OS === "ios" ? "padding" : "height"}
                keyboardVerticalOffset={Math.max(0, (filterAnchor?.y ?? tokens.insets.top) + 120)}
                style={styles.filterKeyboard}
              >
                <MotiView
                  from={{ opacity: 0, translateY: 10 }}
                  animate={{ opacity: 1, translateY: 0 }}
                  transition={{ type: "timing", duration: 200 }}
                  style={styles.filterHeader}
                >
                  <View>
                    <Text style={styles.filterTitle}>Smart Filter</Text>
                    <Text style={styles.filterSubtitle}>Categorize your stack</Text>
                  </View>
                  <Pressable onPress={closeFilter} style={styles.filterCloseBtn}>
                    <X size={20} color="#475569" />
                  </Pressable>
                </MotiView>

                <ScrollView
                  ref={filterScrollRef}
                  style={styles.filterContent}
                  showsVerticalScrollIndicator={false}
                  keyboardDismissMode="on-drag"
                  keyboardShouldPersistTaps="handled"
                  contentContainerStyle={[
                    styles.filterContentInner,
                    { paddingBottom: Math.max(24, keyboardHeight + 12) },
                  ]}
                >
                  {smartTagCategories.map((category, index) => (
                    <MotiView
                      key={category.title}
                      from={{ opacity: 0, translateY: 12 }}
                      animate={{ opacity: 1, translateY: 0 }}
                      transition={{ type: "timing", duration: 240, delay: 120 + index * 60 }}
                      style={styles.filterSection}
                    >
                      <View style={styles.filterSectionHeader}>
                        <View
                          style={[
                            styles.filterDot,
                            {
                              backgroundColor: category.activeColor.bg,
                              borderColor: category.activeColor.border,
                            },
                          ]}
                        />
                        <Text style={styles.filterSectionTitle}>{category.title}</Text>
                      </View>
                      <View style={styles.filterTagsRow}>
                        {category.tags.map((tag) => {
                          const isActive = activeTags.has(tag);
                          return (
                            <Pressable
                              key={tag}
                              onPress={() => toggleTag(tag)}
                              style={[
                                styles.filterTag,
                                isActive
                                  ? {
                                      backgroundColor: category.activeColor.bg,
                                      borderColor: category.activeColor.border,
                                    }
                                  : {
                                      backgroundColor: "#ffffff",
                                      borderColor: "#e2e8f0",
                                    },
                              ]}
                            >
                              <Text
                                style={[
                                  styles.filterTagText,
                                  { color: isActive ? category.activeColor.text : "#475569" },
                                ]}
                              >
                                {tag}
                              </Text>
                            </Pressable>
                          );
                        })}
                      </View>
                    </MotiView>
                  ))}

                  <MotiView
                    from={{ opacity: 0, translateY: 12 }}
                    animate={{ opacity: 1, translateY: 0 }}
                    transition={{ type: "timing", duration: 240, delay: 380 }}
                    style={styles.filterSection}
                  >
                    <View style={styles.filterSectionHeader}>
                      <View style={[styles.filterDot, styles.filterDotNeutral]} />
                      <Text style={styles.filterSectionTitle}>My Tags</Text>
                    </View>

                    <View style={styles.filterTagsRow}>
                      {userTags.map((tag) => {
                        const isActive = activeTags.has(tag);
                        return (
                          <View key={tag} style={styles.userTagWrap}>
                            <Pressable
                              onPress={() => toggleTag(tag)}
                              style={[
                                styles.userTag,
                                isActive
                                  ? {
                                      backgroundColor: "rgba(100,116,139,0.15)",
                                      borderColor: "rgba(148,163,184,0.5)",
                                    }
                                  : {
                                      backgroundColor: "#ffffff",
                                      borderColor: "#e2e8f0",
                                    },
                              ]}
                            >
                              <Text style={[styles.userTagText, isActive && { color: "#1e293b" }]}>{tag}</Text>
                            </Pressable>
                            <Pressable
                              onPress={(event) => {
                                event.stopPropagation();
                                handleDeleteTag(tag);
                              }}
                              style={styles.userTagDelete}
                            >
                              <X size={13} color={isActive ? "#64748b" : "#94a3b8"} />
                            </Pressable>
                          </View>
                        );
                      })}

                      {!isCreatingTag ? (
                        <Pressable
                          onPress={() => {
                            setIsCreatingTag(true);
                            requestAnimationFrame(() => filterScrollRef.current?.scrollToEnd({ animated: true }));
                          }}
                          style={styles.newTagBtn}
                        >
                          <Plus size={14} color="#94a3b8" />
                          <Text style={styles.newTagText}>New Tag</Text>
                        </Pressable>
                      ) : (
                        <View style={styles.newTagInputRow}>
                          <TextInput
                            autoFocus
                            value={newTagText}
                            onChangeText={setNewTagText}
                            placeholder="Tag name..."
                            placeholderTextColor="#94a3b8"
                            onSubmitEditing={handleCreateTag}
                            onFocus={() => filterScrollRef.current?.scrollToEnd({ animated: true })}
                            style={styles.newTagInput}
                          />
                          <Pressable onPress={handleCreateTag} style={styles.newTagConfirm}>
                            <Check size={14} color="#ffffff" />
                          </Pressable>
                          <Pressable onPress={() => setIsCreatingTag(false)} style={styles.newTagCancel}>
                            <X size={14} color="#64748b" />
                          </Pressable>
                        </View>
                      )}
                    </View>
                  </MotiView>
                </ScrollView>

                <MotiView
                  from={{ opacity: 0, translateY: 10 }}
                  animate={{ opacity: 1, translateY: 0 }}
                  transition={{ type: "timing", duration: 200, delay: 280 }}
                  style={styles.filterFooter}
                >
                  <Text style={styles.filterFooterText}>
                    {activeTags.size > 0 ? `${activeTags.size} selected` : "No filters"}
                  </Text>
                  {activeTags.size > 0 ? (
                    <Pressable onPress={() => setActiveTags(new Set())} style={styles.clearFiltersBtn}>
                      <Text style={styles.clearFiltersText}>Clear All</Text>
                    </Pressable>
                  ) : null}
                </MotiView>
              </KeyboardAvoidingView>
            </MotiView>
          ) : null}
        </AnimatePresence>

        <MotiView
          style={styles.filterCollapsedOverlay}
          animate={
            showFilterCollapsed
              ? { opacity: 1, translateX: 0, scale: 1 }
              : { opacity: 0, translateX: -filterIconShift, scale: 0.94 }
          }
          transition={{
            opacity: { type: "timing", duration: 360, easing: FILTER_EASING },
            translateX: { type: "timing", duration: FILTER_WIDTH_DURATION, easing: FILTER_EASING },
            scale: { type: "timing", duration: FILTER_WIDTH_DURATION, easing: FILTER_EASING },
          }}
          pointerEvents={filterState === "closed" ? "auto" : "none"}
        >
          <Pressable style={styles.filterCollapsedButton} onPress={openFilter}>
            <SlidersHorizontal size={18} color="#0f172a" />
          </Pressable>
        </MotiView>
        </MotiView>
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
                  text="My Saved"
                  baseFontSize={36}
                  baseLineHeight={40}
                  minFontSize={32}
                  style={styles.h1}
                />
              </View>

              <MotiView style={styles.headerPillMotion} animate={{ width: pillWidth }} transition={{ type: "timing", duration: 320 }}>
                <Pressable
                  onPress={handleHeaderAction}
                  style={[
                    styles.headerPill,
                    {
                      borderColor: headerIsDelete
                        ? "rgba(239,68,68,0.55)"
                        : headerIsAssigning
                        ? "rgba(59,130,246,0.55)"
                        : "rgba(255,255,255,0.70)",
                    },
                  ]}
                >
                  <BlurView intensity={18} tint="light" style={StyleSheet.absoluteFillObject} />
                  <LinearGradient
                    colors={
                      headerIsDelete
                        ? ["rgba(255,255,255,0.65)", "rgba(239,68,68,0.10)", "rgba(255,255,255,0)"]
                        : headerIsAssigning
                        ? ["rgba(255,255,255,0.80)", "rgba(59,130,246,0.12)", "rgba(255,255,255,0)"]
                        : ["rgba(255,255,255,0.70)", "rgba(255,255,255,0.22)", "rgba(255,255,255,0)"]
                    }
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={[StyleSheet.absoluteFillObject, { opacity: 0.92 }]}
                  />

                  <View style={styles.headerPillInner}>
                    <AnimatePresence exitBeforeEnter>
                      <MotiView
                        key={headerLabel}
                        from={{ translateY: 10, opacity: 0, scale: 0.98 }}
                        animate={{ translateY: 0, opacity: 1, scale: 1 }}
                        exit={{ translateY: -10, opacity: 0, scale: 0.98 }}
                        transition={{ type: "timing", duration: 220 }}
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
                    if (overlapCount > 0) {
                      logStackOverlapEvent("stack_overlap_clicked", {
                        supplementId: item.supplementId ?? null,
                        productName: item.productName,
                        overlapCount,
                      });
                    }
                    markAsViewed(item.id);
                    setExpandedId(null);
                    setDetailId(item.id);
                  }}
                  onViewNote={() => {
                    if (selectionMode) return;
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

      {detailItem && detailTheme ? (
        <DetailSheet
          item={detailItem}
          theme={detailTheme}
          stackOverlaps={detailItem.supplementId ? stackOverlapBySupplementId.get(detailItem.supplementId) ?? [] : []}
          mealTimePrefs={mealTimePrefs}
          onLearnMealTimePref={handleLearnMealTimePref}
          onClose={() => setDetailId(null)}
          onSaveRoutine={handleSaveRoutine}
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
    fontWeight: "800",
    color: "#0f172a",
    letterSpacing: -0.2,
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
  headerPill: {
    height: 44,
    paddingHorizontal: 18,
    borderRadius: 999,
    borderCurve: "continuous",
    overflow: "hidden",
    borderWidth: 1,
  },
  headerPillInner: { flex: 1, alignItems: "center", justifyContent: "center" },
  headerPillText: {
    fontSize: 14,
    lineHeight: 18,
    fontWeight: "700",
    color: "#334155",
    textAlign: "center",
    includeFontPadding: false,
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
  cardHeader: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12 },
  cardTitle: {
    flex: 1,
    fontSize: 30,
    lineHeight: 34,
    fontWeight: "800",
    letterSpacing: -0.2,
    includeFontPadding: false,
  },
  cardMeta: { marginTop: 12, gap: 10 },
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
    bottom: 32,
    width: 56,
    height: 56,
    alignItems: "center",
    justifyContent: "center",
  },
  arrowHalo: {
    position: "absolute",
    width: 76,
    height: 76,
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
  sheetHeaderRow: { flexDirection: "row", alignItems: "center", gap: 8, opacity: 0.85 },
  sheetHeaderLabel: { fontSize: 12, lineHeight: 16, fontWeight: "700", letterSpacing: 1.2, textTransform: "uppercase", includeFontPadding: false },
  sheetTitle: { fontSize: 36, lineHeight: 40, fontWeight: "800", letterSpacing: -0.2, includeFontPadding: false },

  sheetTag: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, borderCurve: "continuous", borderWidth: 1 },
  sheetTagText: { fontSize: 12, lineHeight: 16, fontWeight: "600", includeFontPadding: false },

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
  suggestedRoutineMeta: { fontSize: 11, lineHeight: 14, fontWeight: "700", color: "#64748b", includeFontPadding: false, textTransform: "uppercase" },
  suggestedRoutineRationale: { fontSize: 12, lineHeight: 16, fontWeight: "600", color: "#475569", includeFontPadding: false },
  anchorChoiceRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 2 },
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
  suggestedRoutineSlotText: { fontSize: 12, lineHeight: 16, fontWeight: "700", color: "#334155", includeFontPadding: false },
  suggestedRoutineSlotTextActive: { color: "#1e3a8a" },
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
  timeCategoryPill: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 10, borderWidth: 1 },
  timeCategoryText: { fontSize: 11, fontWeight: "700", includeFontPadding: false },

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
