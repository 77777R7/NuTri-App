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
import { useScanHistory } from "@/contexts/ScanHistoryContext";
import { useSavedSupplements } from "@/contexts/SavedSupplementsContext";
import { useScreenTokens } from "@/hooks/useScreenTokens";
import { supabase } from "@/lib/supabase";
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
  frequency?: string | null;
  dosage?: string | null;
};

type AnalysisEfficacy = {
  overviewSummary?: string | null;
  overallAssessment?: string | null;
  verdict?: string | null;
  coreBenefits?: string[] | null;
};

type AnalysisPayload = {
  efficacy?: AnalysisEfficacy | null;
  usage?: AnalysisUsage | null;
  usagePayload?: { usage?: AnalysisUsage | null } | null;
  analysis?: {
    efficacy?: AnalysisEfficacy | null;
    usage?: AnalysisUsage | null;
    usagePayload?: { usage?: AnalysisUsage | null } | null;
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

const SMART_TAG_CATEGORIES: TagCategory[] = [
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
    tags: ["Sleep", "Energy", "Immunity", "Recovery", "Focus"],
  },
  {
    title: "Type",
    color: { bg: "#faf5ff", text: "#6b21a8", border: "#f3e8ff" },
    activeColor: {
      bg: "rgba(168,85,247,0.15)",
      text: "#6b21a8",
      border: "rgba(216,180,254,0.6)",
    },
    tags: ["Vitamin", "Mineral", "Herb", "Probiotic", "Protein"],
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

const SMART_TAG_SET = new Set(SMART_TAG_CATEGORIES.flatMap((category) => category.tags));

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

const analysisCache = new Map<string, AnalysisPayload>();

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
    const timeCategory = getTimeCategory(item.routine?.time);
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
                  <View style={[styles.tagPill, { borderColor: theme.tagBorderColor }]}>
                    <Text style={[styles.tagText, { color: theme.textColor }]} numberOfLines={1} ellipsizeMode="tail">
                      {item.brandName}
                    </Text>
                  </View>
                  {item.dosageText?.trim() ? (
                    <View style={[styles.tagPill, { borderColor: theme.tagBorderColor }]}>
                      <Text style={[styles.tagText, { color: theme.textColor }]} numberOfLines={1} ellipsizeMode="tail">
                        {item.dosageText}
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
  onClose,
  onSaveRoutine,
}: {
  item: SavedSupplement;
  theme: Theme;
  onClose: () => void;
  onSaveRoutine?: (id: string, prefs: RoutinePreferences) => void | Promise<void>;
}) {
  const insets = useSafeAreaInsets();
  const screenHeight = Dimensions.get("window").height;
  const [note, setNote] = useState(item.routine?.note ?? "");
  const [time, setTime] = useState(item.routine?.time ?? "08:00");
  const [withFood, setWithFood] = useState(item.routine?.withFood ?? false);
  const [analysisData, setAnalysisData] = useState<AnalysisPayload | null>(null);
  const [analysisStatus, setAnalysisStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [saveState, setSaveState] = useState<"idle" | "saved">(
    item.routine?.note || item.routine?.time || item.routine?.withFood !== undefined ? "saved" : "idle",
  );

  const lastSavedRef = useRef<RoutinePreferences>({
    note: item.routine?.note ?? "",
    time: item.routine?.time ?? "",
    withFood: item.routine?.withFood ?? false,
  });

  useEffect(() => {
    const next = {
      note: item.routine?.note ?? "",
      time: item.routine?.time ?? "",
      withFood: item.routine?.withFood ?? false,
    };
    lastSavedRef.current = next;
    setNote(next.note ?? "");
    setTime(next.time || "08:00");
    setWithFood(!!next.withFood);
    setSaveState(next.note || next.time || next.withFood !== undefined ? "saved" : "idle");
  }, [item.id, item.routine?.note, item.routine?.time, item.routine?.withFood]);

  useEffect(() => {
    let isActive = true;
    const supplementId = item.supplementId ?? null;

    if (!supplementId) {
      setAnalysisData(null);
      setAnalysisStatus("idle");
      return () => {
        isActive = false;
      };
    }

    const cached = analysisCache.get(supplementId);
    if (cached) {
      setAnalysisData(cached);
      setAnalysisStatus("ready");
      return () => {
        isActive = false;
      };
    }

    setAnalysisData(null);
    setAnalysisStatus("loading");
    supabase
      .from("ai_analyses")
      .select("analysis_data, created_at")
      .eq("supplement_id", supplementId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!isActive) return;
        if (error) {
          console.warn("[supplement-overview] Failed to load analysis", error.message);
          setAnalysisData(null);
          setAnalysisStatus("error");
          return;
        }
        const payload = (data?.analysis_data ?? null) as AnalysisPayload | null;
        if (payload) {
          analysisCache.set(supplementId, payload);
        }
        setAnalysisData(payload);
        setAnalysisStatus("ready");
      })
      .catch((error: Error) => {
        if (!isActive) return;
        console.warn("[supplement-overview] Failed to load analysis", error.message);
        setAnalysisData(null);
        setAnalysisStatus("error");
      });

    return () => {
      isActive = false;
    };
  }, [item.supplementId]);

  useEffect(() => {
    if (saveState !== "saved") return;
    const last = lastSavedRef.current;
    const noteChanged = (last.note || "") !== (note || "");
    const timeChanged = (last.time || "") !== (time || "");
    const foodChanged = (last.withFood ?? false) !== (withFood ?? false);
    if (noteChanged || timeChanged || foodChanged) setSaveState("idle");
  }, [note, saveState, time, withFood]);

  const handleSave = async () => {
    const prefs = { note, time, withFood };
    lastSavedRef.current = prefs;
    try {
      await onSaveRoutine?.(item.id, prefs);
    } finally {
      setSaveState("saved");
    }
  };

  const timeCategory = getTimeCategory(time);
  const analysisRoot = (() => {
    const raw = analysisData ?? null;
    const nested = raw?.analysis ?? null;
    if (nested && (nested.efficacy || nested.usage || nested.usagePayload)) {
      return nested;
    }
    return raw;
  })();
  const usage = (analysisRoot?.usagePayload?.usage ?? analysisRoot?.usage ?? null) as AnalysisUsage | null;
  const efficacy = (analysisRoot?.efficacy ?? null) as AnalysisEfficacy | null;

  const overviewBenefits = Array.isArray(efficacy?.coreBenefits)
    ? efficacy?.coreBenefits.filter((benefit) => isNonEmptyString(benefit))
    : [];
  const benefitsText =
    overviewBenefits.length === 1
      ? `Supports ${overviewBenefits[0]}`
      : overviewBenefits.length > 1
      ? `Supports ${overviewBenefits[0]} and ${overviewBenefits[1]}`
      : "";

  const functionText = pickFirstText(
    efficacy?.overviewSummary,
    efficacy?.overallAssessment,
    efficacy?.verdict,
    benefitsText,
    usage?.summary,
  );
  const whenToTakeText = pickFirstText(usage?.timing, usage?.frequency);
  const howToTakeText =
    usage?.withFood === true
      ? "Take with food"
      : usage?.withFood === false
      ? "Take on an empty stomach"
      : pickFirstText(usage?.dosage, usage?.summary);

  const overviewBullets = [
    { label: "When to take", text: whenToTakeText },
    { label: "How to take", text: howToTakeText },
  ].filter((item) => isNonEmptyString(item.text));

  const overviewFallback =
    analysisStatus === "loading"
      ? "Loading AI overview..."
      : analysisStatus === "error"
      ? "Overview is unavailable right now."
      : "Overview is not available yet.";

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

          <ScrollView
            style={{ flex: 1 }}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: 40 + insets.bottom }}
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
                  <View style={[styles.sheetTag, { borderColor: theme.tagBorderColor }]}>
                    <Text style={[styles.sheetTagText, { color: theme.textColor }]} numberOfLines={1}>
                      {item.brandName}
                    </Text>
                  </View>
                  {item.dosageText?.trim() ? (
                    <View style={[styles.sheetTag, { borderColor: theme.tagBorderColor }]}>
                      <Text style={[styles.sheetTagText, { color: theme.textColor }]} numberOfLines={1}>
                        {item.dosageText}
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
                    {functionText ? (
                      <Text style={styles.overviewSummary}>{formatSentence(functionText)}</Text>
                    ) : (
                      <Text style={styles.overviewPlaceholder}>{overviewFallback}</Text>
                    )}

                    {overviewBullets.length > 0 ? (
                      <View style={styles.overviewBullets}>
                        {overviewBullets.map((bullet) => (
                          <View key={bullet.label} style={styles.overviewBulletRow}>
                            <View style={styles.overviewBulletDot} />
                            <Text style={styles.overviewBulletText}>
                              <Text style={styles.overviewBulletLabel}>{bullet.label}: </Text>
                              {formatSentence(bullet.text)}
                            </Text>
                          </View>
                        ))}
                      </View>
                    ) : null}
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
                        {timeCategory ? (
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
                      <TimePicker value={time} onChange={setTime} />

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

                    <View style={styles.noteHeaderRow}>
                      <NotebookPen size={16} color="#94a3b8" />
                      <Text style={styles.noteHeaderText}>Personal Note</Text>
                    </View>

                    <TextInput
                      value={note}
                      onChangeText={setNote}
                      placeholder="Add your notes here (e.g. 'Avoid caffeine')..."
                      placeholderTextColor="#94a3b8"
                      multiline
                      textAlignVertical="top"
                      style={styles.noteInput}
                    />

                    <View style={styles.saveRow}>
                      <View style={styles.saveShadow}>
                        <Pressable onPress={handleSave}>
                          <MotiView
                            style={styles.saveBtn}
                            animate={{
                              backgroundColor: saveState === "saved" ? "rgba(34,197,94,0.18)" : "rgba(255,255,255,0.35)",
                              borderColor: saveState === "saved" ? "rgba(34,197,94,0.55)" : "rgba(255,255,255,0.55)",
                            }}
                            transition={{ type: "timing", duration: 340 }}
                          >
                            <LinearGradient
                              colors={
                                saveState === "saved"
                                  ? ["rgba(255,255,255,0.35)", "rgba(34,197,94,0.18)", "rgba(255,255,255,0.00)"]
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
                                <Text style={styles.saveText}>Save</Text>
                              </MotiView>

                              <MotiView
                                style={styles.saveCheck}
                                animate={saveState === "saved" ? { opacity: 1, translateY: 0, scale: 1 } : { opacity: 0, translateY: 6, scale: 0.96 }}
                                transition={{ type: "timing", duration: 320, delay: saveState === "saved" ? 60 : 0 }}
                              >
                                <MotiView
                                  animate={saveState === "saved" ? { scale: [0.9, 1.06, 1], rotate: ["-2deg", "0deg"] } : { scale: 1, rotate: "0deg" }}
                                  transition={{ type: "timing", duration: 340 }}
                                >
                                  <Check size={20} color="#059669" />
                                </MotiView>
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

  const pillWidthRef = useRef(84);
  const [pillWidth, setPillWidth] = useState(84);
  const updatedDosageRef = useRef(new Map<string, string>());
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

  useEffect(() => () => clearFilterTimers(), [clearFilterTimers]);

  useEffect(() => {
    if (selectionMode) setExpandedId(null);
  }, [selectionMode]);

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

      if (cleanedCurrent) return cleanedCurrent;
      return scanDose || cleanedCurrent;
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
      if (detailId && selectedIds.has(detailId)) setDetailId(null);
      await onDeleteSelected?.(ids);
      exitSelection();
      return;
    }

    exitSelection();
  }, [assigningTag, data, detailId, exitSelection, onDeleteSelected, selectedIds, selectionMode, updateSupplement]);

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
                  {SMART_TAG_CATEGORIES.map((category, index) => (
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
                    No supplements found.
                  </Text>
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
        <DetailSheet item={detailItem} theme={detailTheme} onClose={() => setDetailId(null)} onSaveRoutine={handleSaveRoutine} />
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
  overviewContent: { minHeight: 220, paddingHorizontal: 32, paddingVertical: 32, justifyContent: "center" },
  overviewSummary: { fontSize: 17, lineHeight: 26, fontWeight: "600", color: "#1f2937", includeFontPadding: false },
  overviewPlaceholder: { fontSize: 15, lineHeight: 22, fontWeight: "600", color: "#94a3b8", includeFontPadding: false },
  overviewBullets: { marginTop: 18, gap: 10 },
  overviewBulletRow: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  overviewBulletDot: { width: 6, height: 6, borderRadius: 999, backgroundColor: "#94a3b8", marginTop: 8 },
  overviewBulletText: { flex: 1, fontSize: 14, lineHeight: 20, fontWeight: "600", color: "#475569", includeFontPadding: false },
  overviewBulletLabel: { fontWeight: "700", color: "#334155" },

  routineBlock: { minHeight: 600, borderRadius: 40, borderCurve: "continuous", overflow: "hidden", position: "relative" },
  routineRing: { position: "absolute", top: 12, left: 12, right: 12, bottom: 12, borderRadius: 36, borderCurve: "continuous", overflow: "hidden", backgroundColor: "rgba(255,255,255,0.20)", shadowColor: "#000", shadowOpacity: 0.08, shadowRadius: 18, shadowOffset: { width: 0, height: 10 }, elevation: 2 },
  routineContent: { paddingHorizontal: 32, paddingTop: 36, paddingBottom: 28 },

  scheduleHeaderRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  scheduleTitleRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  scheduleTitle: { fontSize: 12, fontWeight: "800", color: "#475569", textTransform: "uppercase", letterSpacing: 1.0, includeFontPadding: false },
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
  saveShadow: { borderRadius: 999, borderCurve: "continuous", shadowColor: "#0f172a", shadowOpacity: 0.18, shadowRadius: 18, shadowOffset: { width: 0, height: 10 }, backgroundColor: "rgba(255,255,255,0.001)" },
  saveBtn: { height: 48, paddingHorizontal: 26, borderRadius: 999, borderCurve: "continuous", borderWidth: 1, overflow: "hidden", justifyContent: "center" },
  saveInner: { minWidth: 56, height: 20, alignItems: "center", justifyContent: "center" },
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
