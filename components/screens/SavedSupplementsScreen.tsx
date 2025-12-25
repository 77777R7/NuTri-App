import { BlurView } from "expo-blur";
import { LinearGradient } from "expo-linear-gradient";
import {
  ArrowRight,
  Check,
  ChevronDown,
  Moon,
  Search,
  SlidersHorizontal,
  Sun,
  X,
} from "lucide-react-native";
import { AnimatePresence, MotiView } from "moti";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Dimensions,
  LayoutChangeEvent,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Easing } from "react-native-reanimated";

import { useScanHistory } from "@/contexts/ScanHistoryContext";
import { useSavedSupplements } from "@/contexts/SavedSupplementsContext";
import type { RoutinePreferences, SavedSupplement } from "@/types/saved-supplements";

type Props = {
  data: SavedSupplement[];
  onDeleteSelected?: (ids: string[]) => void | Promise<void>;
  onSaveRoutine?: (id: string, prefs: RoutinePreferences) => void | Promise<void>;
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

const WHEN_OPTIONS = [
  { value: "morning", label: "Morning (empty stomach)" },
  { value: "meals", label: "With meals" },
  { value: "after_meals", label: "After meals" },
  { value: "evening", label: "Evening" },
  { value: "bed", label: "Before bed" },
];

const HOW_OPTIONS = [
  { value: "water", label: "With water" },
  { value: "food", label: "With food" },
  { value: "fat", label: "With a fat-containing meal" },
  { value: "no_caffeine", label: "Avoid taking with coffee or tea" },
  { value: "split", label: "Split dose throughout the day" },
];
const BOTTOM_INSET_TRIM = 10;
const NAV_HEIGHT = 64;

function formatSelectValue(value?: string) {
  if (!value) return "";
  return value
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function isoDesc(a: string, b: string) {
  return b.localeCompare(a);
}

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

const getShortProductName = (productName: string, brandName: string) => {
  const trimmed = productName.trim();
  if (!trimmed) return productName;

  const brandRegex = brandName
    ? new RegExp(`^${brandName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s+`, "i")
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
    .map(token => token.replace(/[^\w-]+/g, ""))
    .filter(Boolean)
    .filter(token => {
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

function AnchorSelect({
  value,
  placeholder,
  options,
  onChange,
}: {
  value: string;
  placeholder: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<{ x: number; y: number; w: number; h: number } | null>(
    null,
  );
  const triggerRef = useRef<any>(null);

  const screen = Dimensions.get("window");
  const itemH = 44;
  const dropdownH = Math.min(6 + options.length * itemH + 6, 260);

  const openSelect = () => {
    triggerRef.current?.measureInWindow((x: number, y: number, w: number, h: number) => {
      setAnchor({ x, y, w, h });
      setOpen(true);
    });
  };

  const close = () => setOpen(false);

  const label = value ? formatSelectValue(value) : placeholder;

  const top = useMemo(() => {
    if (!anchor) return 0;
    const below = anchor.y + anchor.h + 8;
    const overflow = below + dropdownH > screen.height - 16;
    if (overflow) return Math.max(16, anchor.y - dropdownH - 8);
    return below;
  }, [anchor, dropdownH, screen.height]);

  return (
    <>
      <View ref={triggerRef} collapsable={false}>
        <Pressable onPress={openSelect} style={styles.selectTrigger}>
          <BlurView intensity={18} tint="light" style={StyleSheet.absoluteFillObject} />
          <LinearGradient
            colors={["rgba(255,255,255,0.62)", "rgba(255,255,255,0.32)"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFillObject}
          />
          <View style={styles.selectTriggerInner}>
            <Text style={styles.selectTriggerText} numberOfLines={1}>
              {label}
            </Text>
            <MotiView
              animate={{ rotate: open ? "180deg" : "0deg" }}
              transition={{ type: "timing", duration: 180 }}
            >
              <ChevronDown size={16} color="#0f172a" />
            </MotiView>
          </View>
        </Pressable>
      </View>

      <Modal visible={open} transparent animationType="none" onRequestClose={close}>
        <Pressable style={styles.selectOverlay} onPress={close}>
          {anchor ? (
            <View style={[styles.selectDropdownWrap, { top, left: anchor.x, width: anchor.w }]}>
              <Pressable style={styles.selectDropdownInner} onPress={() => { }}>
                <BlurView intensity={22} tint="light" style={StyleSheet.absoluteFillObject} />
                <View style={styles.selectDropdownGlass} />
                <AnimatePresence>
                  <MotiView
                    from={{ opacity: 0, translateY: -10 }}
                    animate={{ opacity: 1, translateY: 0 }}
                    exit={{ opacity: 0, translateY: -10 }}
                    transition={{ type: "timing", duration: 180 }}
                  >
                    {options.map((opt) => {
                      const selected = opt.value === value;
                      return (
                        <Pressable
                          key={opt.value}
                          onPress={() => {
                            onChange(opt.value);
                            close();
                          }}
                          style={[styles.selectItem, selected && styles.selectItemActive]}
                        >
                          <View style={styles.selectCheckSlot}>
                            {selected ? <Check size={16} color="#2563eb" /> : null}
                          </View>
                          <Text style={styles.selectItemText}>{opt.label}</Text>
                        </Pressable>
                      );
                    })}
                  </MotiView>
                </AnimatePresence>
              </Pressable>
            </View>
          ) : null}
        </Pressable>
      </Modal>
    </>
  );
}

const CollectionCard = React.memo(
  function CollectionCard({
    item,
    index,
    theme,
    zIndex,
    expanded,
    detailOpen,
    selectionMode,
    selected,
    onToggleSelect,
    onToggleExpand,
    onOpenDetail,
  }: {
    item: SavedSupplement;
    index: number;
    theme: Theme;
    zIndex: number;
    expanded: boolean;
    detailOpen: boolean;
    selectionMode: boolean;
    selected: boolean;
    onToggleSelect: () => void;
    onToggleExpand: () => void;
    onOpenDetail: () => void;
  }) {
    const showHalo = !selectionMode && expanded;

    return (
      <MotiView
        style={[
          styles.card,
          {
            backgroundColor: theme.bgHex,
            zIndex: expanded ? 999 : zIndex,
            elevation: expanded ? 999 : Math.max(1, zIndex + 1),
          },
        ]}
        animate={{
          scale: expanded ? 1.05 : 1,
          marginTop: index === 0 ? 0 : selectionMode ? 16 : expanded ? 0 : -24,
          marginBottom: expanded ? 16 : 0,
          translateY: expanded ? -10 : 0,
          shadowOpacity: selected ? 0.16 : expanded ? 0.12 : 0.0,
        }}
        transition={{ type: "spring", stiffness: 380, damping: 30, mass: 0.8 }}
      >
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
              <Text style={[styles.cardTitle, { color: theme.textColor }]} numberOfLines={1} ellipsizeMode="clip">
                {getShortProductName(item.productName, item.brandName)}
              </Text>

              {selectionMode ? (
                <View style={{ width: 24, height: 24 }} />
              ) : theme.icon === "sun" ? (
                <Sun size={24} color={theme.textColor} />
              ) : (
                <Moon size={24} color={theme.textColor} />
              )}
            </View>

            <View style={styles.cardFooter}>
              <View style={styles.tagRow}>
                <View style={[styles.tagPill, { borderColor: theme.tagBorderColor }]}>
                  <Text style={[styles.tagText, { color: theme.textColor }]} numberOfLines={1}>
                    {item.brandName}
                  </Text>
                </View>
                {item.dosageText?.trim() ? (
                  <View style={[styles.tagPill, { borderColor: theme.tagBorderColor }]}>
                    <Text style={[styles.tagText, { color: theme.textColor }]} numberOfLines={1}>
                      {item.dosageText}
                    </Text>
                  </View>
                ) : null}
              </View>

              <View style={styles.arrowWrap}>
                <AnimatePresence>
                  {showHalo ? (
                    <MotiView
                      from={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.96 }}
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
                  <MotiView
                    animate={{ rotate: detailOpen ? "-90deg" : "0deg" }}
                    transition={{ type: "spring", stiffness: 260, damping: 18 }}
                  >
                    <ArrowRight size={20} color={theme.arrowColor} />
                  </MotiView>
                </Pressable>
              </View>
            </View>
          </View>
        </Pressable>
        {selected ? <View pointerEvents="none" style={styles.selectedRing} /> : null}
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
  const [whenToTake, setWhenToTake] = useState(item.routine?.whenToTake ?? "");
  const [howToTake, setHowToTake] = useState(item.routine?.howToTake ?? "");
  const [saveState, setSaveState] = useState<"idle" | "saved">(
    item.routine?.whenToTake || item.routine?.howToTake ? "saved" : "idle",
  );

  const lastSavedRef = useRef<RoutinePreferences>({
    whenToTake: item.routine?.whenToTake ?? "",
    howToTake: item.routine?.howToTake ?? "",
  });

  useEffect(() => {
    const next = {
      whenToTake: item.routine?.whenToTake ?? "",
      howToTake: item.routine?.howToTake ?? "",
    };
    lastSavedRef.current = next;
    setWhenToTake(next.whenToTake ?? "");
    setHowToTake(next.howToTake ?? "");
    setSaveState(next.whenToTake || next.howToTake ? "saved" : "idle");
  }, [item.id, item.routine?.howToTake, item.routine?.whenToTake]);

  useEffect(() => {
    if (saveState !== "saved") return;
    const last = lastSavedRef.current;
    const changed =
      (last.whenToTake || "") !== (whenToTake || "") ||
      (last.howToTake || "") !== (howToTake || "");
    if (changed) setSaveState("idle");
  }, [howToTake, saveState, whenToTake]);

  const handleSave = async () => {
    const prefs = { whenToTake, howToTake };
    lastSavedRef.current = prefs;
    try {
      await onSaveRoutine?.(item.id, prefs);
    } finally {
      setSaveState("saved");
    }
  };

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
          <Pressable onPress={onClose} style={styles.sheetClose}>
            <X size={20} color="#ffffff" />
          </Pressable>

          <ScrollView
            style={{ flex: 1 }}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: 170 }}
          >
            <View
              style={[
                styles.sheetHeader,
                { backgroundColor: theme.bgHex, paddingTop: insets.top + 18 },
              ]}
            >
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

                <View style={{ flexDirection: "row", gap: 8 }}>
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

                  <View style={styles.glassCenter}>
                    <Text style={styles.glassText}>
                      A quick summary based on label info and common usage.
                    </Text>
                  </View>
                </View>
              </View>

              <View style={{ marginTop: 18 }}>
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
                    <Text style={styles.routineTitle}>Routine Preferences</Text>

                    <View style={{ marginTop: 20, gap: 22 }}>
                      <View style={{ gap: 12 }}>
                        <Text style={styles.fieldLabel}>When to take</Text>
                        <AnchorSelect
                          value={whenToTake}
                          placeholder="Select timing"
                          options={WHEN_OPTIONS}
                          onChange={setWhenToTake}
                        />
                      </View>

                      <View style={{ gap: 12 }}>
                        <Text style={styles.fieldLabel}>How to take</Text>
                        <AnchorSelect
                          value={howToTake}
                          placeholder="Select method"
                          options={HOW_OPTIONS}
                          onChange={setHowToTake}
                        />
                      </View>
                    </View>

                    <View style={styles.saveRow}>
                      <Pressable onPress={handleSave}>
                        <MotiView
                          style={styles.saveBtn}
                          animate={{
                            backgroundColor:
                              saveState === "saved"
                                ? "rgba(34,197,94,0.18)"
                                : "rgba(255,255,255,0.35)",
                            borderColor:
                              saveState === "saved"
                                ? "rgba(34,197,94,0.55)"
                                : "rgba(255,255,255,0.55)",
                          }}
                          transition={{ type: "timing", duration: 340 }}
                        >
                          <LinearGradient
                            colors={
                              saveState === "saved"
                                ? [
                                  "rgba(255,255,255,0.35)",
                                  "rgba(34,197,94,0.18)",
                                  "rgba(255,255,255,0.00)",
                                ]
                                : [
                                  "rgba(255,255,255,0.60)",
                                  "rgba(255,255,255,0.20)",
                                  "rgba(255,255,255,0.00)",
                                ]
                            }
                            start={{ x: 0, y: 0 }}
                            end={{ x: 1, y: 1 }}
                            style={StyleSheet.absoluteFillObject}
                          />
                          <View style={styles.saveInner}>
                            <MotiView
                              animate={
                                saveState === "saved"
                                  ? { opacity: 0, translateY: -4, scale: 0.98 }
                                  : { opacity: 1, translateY: 0, scale: 1 }
                              }
                              transition={{ type: "timing", duration: 280 }}
                            >
                              <Text style={styles.saveText}>Save</Text>
                            </MotiView>

                            <MotiView
                              style={styles.saveCheck}
                              animate={
                                saveState === "saved"
                                  ? { opacity: 1, translateY: 0, scale: 1 }
                                  : { opacity: 0, translateY: 6, scale: 0.96 }
                              }
                              transition={{ type: "timing", duration: 320, delay: saveState === "saved" ? 60 : 0 }}
                            >
                              <MotiView
                                animate={
                                  saveState === "saved"
                                    ? { scale: [0.9, 1.06, 1], rotate: ["-2deg", "0deg"] }
                                    : { scale: 1, rotate: "0deg" }
                                }
                                transition={{ type: "timing", duration: 340 }}
                              >
                                <Check size={20} color="#059669" />
                              </MotiView>
                            </MotiView>
                          </View>
                        </MotiView>
                      </Pressable>
                    </View>

                    <Text style={styles.note}>
                      Note: Always consult the product label for specific instructions.
                    </Text>
                  </View>
                </View>
              </View>

              <View style={{ height: 36 }} />
            </View>
          </ScrollView>
        </MotiView>
      </View>
    </Modal>
  );
}

export function MySupplementView({ data, onDeleteSelected, onSaveRoutine }: Props) {
  const insets = useSafeAreaInsets();
  const { scans } = useScanHistory();
  const { updateSupplement } = useSavedSupplements();
  const bottomInset = Math.max(0, insets.bottom - BOTTOM_INSET_TRIM);
  const contentBottomPadding = NAV_HEIGHT + bottomInset + 24;
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [detailId, setDetailId] = useState<string | null>(null);
  const pillWidthRef = useRef(84);
  const [pillWidth, setPillWidth] = useState(84);
  const updatedDosageRef = useRef(new Map<string, string>());

  useEffect(() => {
    if (selectionMode) setExpandedId(null);
  }, [selectionMode]);

  const scanDoseLookup = useMemo(() => {
    const byKey = new Map<string, string>();
    const byBrandNameKey = new Map<string, string>();
    const byNameKey = new Map<string, string>();
    const nameKeySources = new Map<string, Set<string>>();

    scans.forEach((scan) => {
      const nameKey = getNameKey(scan.productName, scan.brandName);
      const brandNameKey = getBrandNameKey(scan.productName, scan.brandName);
      const sources = nameKeySources.get(nameKey) ?? new Set<string>();
      sources.add(brandNameKey);
      nameKeySources.set(nameKey, sources);

      const dose = scan.dosageText?.trim();
      if (!dose) return;
      const normalizedDose = normalizeKey(dose);
      const normalizedCategory = scan.category ? normalizeKey(scan.category) : "";
      if (normalizedCategory && normalizedDose === normalizedCategory) return;

      const key = getDedupeKey(scan);
      byKey.set(key, dose);
      byBrandNameKey.set(brandNameKey, dose);
      byNameKey.set(nameKey, dose);
    });

    const conflictedNameKeys = new Set<string>();
    nameKeySources.forEach((sources, nameKey) => {
      if (sources.size > 1) conflictedNameKeys.add(nameKey);
    });

    return { byKey, byBrandNameKey, byNameKey, conflictedNameKeys };
  }, [scans]);

  const resolveDosageText = useCallback(
    (item: SavedSupplement) => {
      const current = item.dosageText?.trim() ?? "";
      const nameKey = getNameKey(item.productName, item.brandName);
      const brandNameKey = getBrandNameKey(item.productName, item.brandName);
      const scanDose =
        scanDoseLookup.byKey.get(getDedupeKey(item)) ||
        scanDoseLookup.byBrandNameKey.get(brandNameKey) ||
        (!scanDoseLookup.conflictedNameKeys.has(nameKey)
          ? scanDoseLookup.byNameKey.get(nameKey)
          : undefined);

      return scanDose || current;
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
      if (!resolvedDose || resolvedDose === originalDose) return;
      if (updatedDosageRef.current.get(item.id) === resolvedDose) return;

      updatedDosageRef.current.set(item.id, resolvedDose);
      updateSupplement(item.id, { dosageText: resolvedDose }).catch(() => {
        if (updatedDosageRef.current.get(item.id) === resolvedDose) {
          updatedDosageRef.current.delete(item.id);
        }
      });
    });
  }, [dataById, resolvedData, updateSupplement]);

  const sorted = useMemo(() => {
    return [...resolvedData].sort((a, b) => isoDesc(a.createdAt, b.createdAt));
  }, [resolvedData]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return sorted;
    return sorted.filter((s) => {
      return (
        s.productName.toLowerCase().includes(q) ||
        s.brandName.toLowerCase().includes(q) ||
        (s.dosageText ?? "").toLowerCase().includes(q)
      );
    });
  }, [sorted, search]);

  const cards = useMemo(() => {
    return filtered.map((item, idx) => {
      const theme = THEMES[idx % THEMES.length];
      return { item, idx, theme };
    });
  }, [filtered]);

  const selectedCount = selectedIds.size;
  const headerMode: "select" | "done" | "delete" =
    !selectionMode ? "select" : selectedCount > 0 ? "delete" : "done";

  const headerLabel =
    headerMode === "select" ? "Select" : headerMode === "done" ? "Done" : `Delete (${selectedCount})`;

  const headerIsDelete = headerMode === "delete";
  const handleHeaderLabelLayout = useCallback((event: LayoutChangeEvent) => {
    const next = Math.max(84, Math.ceil(event.nativeEvent.layout.width + 36));
    if (pillWidthRef.current === next) return;
    pillWidthRef.current = next;
    setPillWidth(next);
  }, []);

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
  }, []);

  const deleteSelected = useCallback(async () => {
    if (selectedIds.size === 0) return;
    const ids = Array.from(selectedIds);

    if (detailId && selectedIds.has(detailId)) setDetailId(null);

    await onDeleteSelected?.(ids);
    exitSelection();
  }, [detailId, exitSelection, onDeleteSelected, selectedIds]);

  const openDetail = useCallback((id: string) => setDetailId(id), []);
  const closeDetail = useCallback(() => setDetailId(null), []);

  const detailCard = useMemo(() => {
    if (!detailId) return null;
    return cards.find((c) => c.item.id === detailId) ?? null;
  }, [detailId, cards]);

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <View
        pointerEvents="none"
        style={[styles.statusBarBlock, { height: insets.top, top: -insets.top }]}
      />
      <ScrollView
        showsVerticalScrollIndicator={false}
        removeClippedSubviews={false}
        style={{ overflow: "visible" }}
        contentContainerStyle={{ paddingBottom: contentBottomPadding, overflow: "visible" }}
      >
        <View style={styles.headerRow}>
          <Text style={styles.h1}>My Supplement</Text>

          <MotiView
            style={styles.headerPillMotion}
            animate={{ width: pillWidth }}
            transition={{ type: "timing", duration: 320 }}
          >
            <Pressable
              onPress={() => {
                if (!selectionMode) {
                  setSelectionMode(true);
                  return;
                }
                if (headerMode === "delete") {
                  deleteSelected();
                  return;
                }
                exitSelection();
              }}
              style={[
                styles.headerPill,
                { borderColor: headerIsDelete ? "rgba(239,68,68,0.55)" : "rgba(255,255,255,0.70)" },
              ]}
            >
              <BlurView intensity={18} tint="light" style={StyleSheet.absoluteFillObject} />
              <LinearGradient
                colors={
                  headerIsDelete
                    ? ["rgba(255,255,255,0.56)", "rgba(255,255,255,0.24)"]
                    : ["rgba(255,255,255,0.62)", "rgba(255,255,255,0.28)"]
                }
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={StyleSheet.absoluteFillObject}
              />
              <LinearGradient
                colors={
                  headerIsDelete
                    ? ["rgba(255,255,255,0.65)", "rgba(239,68,68,0.10)", "rgba(255,255,255,0)"]
                    : ["rgba(255,255,255,0.70)", "rgba(255,255,255,0.22)", "rgba(255,255,255,0)"]
                }
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={[StyleSheet.absoluteFillObject, { opacity: 0.92 }]}
              />

              <View style={styles.headerPillInner}>
                <AnimatePresence exitBeforeEnter>
                  <MotiView
                    key={headerMode}
                    from={{ translateY: 10, opacity: 0, scale: 0.98 }}
                    animate={{ translateY: 0, opacity: 1, scale: 1 }}
                    exit={{ translateY: -10, opacity: 0, scale: 0.98 }}
                    transition={{ type: "timing", duration: 220 }}
                  >
                    <Text
                      onLayout={handleHeaderLabelLayout}
                      style={[styles.headerPillText, headerIsDelete && { color: "#ef4444" }]}
                    >
                      {headerLabel}
                    </Text>
                  </MotiView>
                </AnimatePresence>
              </View>
            </Pressable>
          </MotiView>
        </View>

        <View style={styles.searchWrap}>
          <View style={styles.searchRow}>
            <View style={styles.searchPill}>
              <Search size={20} color="#94a3b8" />
              <TextInput
                value={search}
                onChangeText={setSearch}
                placeholder="Search supplements..."
                placeholderTextColor="#94a3b8"
                style={styles.searchInput}
              />
            </View>
            <Pressable style={styles.filterBtn}>
              <SlidersHorizontal size={18} color="#0f172a" />
            </Pressable>
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
              expanded={expandedId === item.id}
              detailOpen={detailId === item.id}
              selectionMode={selectionMode}
              selected={selectedIds.has(item.id)}
              onToggleSelect={() => toggleSelected(item.id)}
              onToggleExpand={() => setExpandedId(expandedId === item.id ? null : item.id)}
              onOpenDetail={() => {
                if (selectionMode) return;
                openDetail(item.id);
              }}
            />
          ))}

          {cards.length === 0 ? (
            <View style={{ paddingVertical: 90, alignItems: "center" }}>
              <Text style={{ color: "#94a3b8" }}>No supplements found.</Text>
            </View>
          ) : null}
        </View>
      </ScrollView>

      {detailCard ? (
        <DetailSheet
          item={detailCard.item}
          theme={detailCard.theme}
          onClose={closeDetail}
          onSaveRoutine={onSaveRoutine}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#F2F3F7",
  },
  statusBarBlock: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    backgroundColor: "#F2F3F7",
    zIndex: 50,
  },
  headerRow: {
    paddingHorizontal: 24,
    marginTop: -4,
    marginBottom: 22,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 14,
  },
  h1: {
    fontSize: 36,
    fontWeight: "500",
    color: "#0f172a",
    letterSpacing: -0.2,
  },
  headerPill: {
    height: 44,
    paddingHorizontal: 18,
    borderRadius: 999,
    overflow: "hidden",
    borderWidth: 1,
    shadowColor: "#0f172a",
    shadowOpacity: 0.12,
    shadowRadius: 15,
    shadowOffset: { width: 0, height: 10 },
    elevation: 3,
  },
  headerPillMotion: {
    height: 44,
  },
  headerPillInner: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  headerPillText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#334155",
    textAlign: "center",
  },
  searchWrap: {
    paddingHorizontal: 24,
    marginBottom: 24,
  },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
  },
  searchPill: {
    flex: 1,
    height: 54,
    borderRadius: 999,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "#E4E7EB",
  },
  searchInput: {
    flex: 1,
    height: 54,
    fontSize: 16,
    color: "#0f172a",
  },
  filterBtn: {
    width: 54,
    height: 54,
    borderRadius: 999,
    backgroundColor: "#E4E7EB",
    alignItems: "center",
    justifyContent: "center",
  },
  listWrap: {
    paddingHorizontal: 16,
    paddingBottom: 40,
    overflow: "visible",
  },
  card: {
    borderRadius: 40,
    paddingHorizontal: 24,
    paddingTop: 28,
    paddingBottom: 32,
    overflow: "hidden",
    shadowColor: "#000",
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 6,
  },
  selectedRing: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 40,
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.55)",
  },
  cardPressable: {
    borderRadius: 40,
  },
  cardInner: {
    gap: 18,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
  },
  cardTitle: {
    flex: 1,
    fontSize: 30,
    fontWeight: "500",
    letterSpacing: -0.2,
  },
  cardFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    marginTop: 10,
  },
  tagRow: {
    flexDirection: "row",
    gap: 8,
    flex: 1,
  },
  tagPill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
  },
  tagText: {
    fontSize: 12,
    fontWeight: "500",
  },
  arrowWrap: {
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
    backgroundColor: "rgba(255,255,255,0.26)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.40)",
    shadowColor: "#000",
    shadowOpacity: 0.14,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 10,
  },
  arrowBtn: {
    width: 40,
    height: 40,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
  },
  selectCheckBubble: {
    position: "absolute",
    top: 18,
    right: 18,
    width: 34,
    height: 34,
    borderRadius: 999,
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
  selectTrigger: {
    height: 64,
    borderRadius: 999,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.65)",
    shadowColor: "#0f172a",
    shadowOpacity: 0.14,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 10 },
    backgroundColor: "rgba(255,255,255,0.35)",
  },
  selectTriggerInner: {
    flex: 1,
    paddingHorizontal: 24,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  selectTriggerText: {
    flex: 1,
    fontSize: 16,
    fontWeight: "500",
    color: "#0f172a",
  },
  selectOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.12)",
  },
  selectDropdownWrap: {
    position: "absolute",
  },
  selectDropdownInner: {
    borderRadius: 16,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.40)",
    shadowColor: "#0f172a",
    shadowOpacity: 0.18,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
  },
  selectDropdownGlass: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(255,255,255,0.90)",
  },
  selectItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 12,
    gap: 8,
  },
  selectItemActive: {
    backgroundColor: "rgba(0,0,0,0.05)",
  },
  selectCheckSlot: {
    width: 18,
    alignItems: "center",
  },
  selectItemText: {
    fontSize: 14,
    color: "#334155",
  },
  detailOverlay: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.20)",
  },
  sheet: {
    height: "92%",
    backgroundColor: "#ffffff",
    borderTopLeftRadius: 40,
    borderTopRightRadius: 40,
    overflow: "hidden",
  },
  sheetClose: {
    position: "absolute",
    top: 24,
    right: 24,
    width: 40,
    height: 40,
    borderRadius: 999,
    backgroundColor: "#000000",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 20,
    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowRadius: 15,
    shadowOffset: { width: 0, height: 10 },
  },
  sheetHeader: {
    paddingHorizontal: 32,
    paddingBottom: 112,
  },
  sheetHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    opacity: 0.85,
  },
  sheetHeaderLabel: {
    fontSize: 12,
    fontWeight: "600",
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  sheetTitle: {
    fontSize: 36,
    fontWeight: "500",
    letterSpacing: -0.2,
  },
  sheetTag: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
  },
  sheetTagText: {
    fontSize: 12,
    fontWeight: "500",
  },
  sheetBody: {
    marginTop: -80,
    backgroundColor: "#ffffff",
    borderTopLeftRadius: 48,
    borderTopRightRadius: 48,
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 170,
  },
  sectionHead: {
    paddingHorizontal: 8,
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: "600",
    color: "#0f172a",
  },
  glassBlock: {
    minHeight: 220,
    borderRadius: 40,
    overflow: "hidden",
    position: "relative",
  },
  glassRing: {
    position: "absolute",
    top: 12,
    left: 12,
    right: 12,
    bottom: 12,
    borderRadius: 36,
    overflow: "hidden",
    backgroundColor: "rgba(255,255,255,0.20)",
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 2,
  },
  glassHighlightEdge: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 36,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.35)",
  },
  glassRingBorder: {
    ...StyleSheet.absoluteFillObject,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.30)",
  },
  glassCenter: {
    minHeight: 220,
    paddingHorizontal: 40,
    paddingVertical: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  glassText: {
    fontSize: 18,
    fontWeight: "500",
    color: "#334155",
    textAlign: "center",
    lineHeight: 28,
  },
  routineBlock: {
    minHeight: 520,
    borderRadius: 40,
    overflow: "hidden",
    position: "relative",
  },
  routineRing: {
    position: "absolute",
    top: 12,
    left: 12,
    right: 12,
    bottom: 12,
    borderRadius: 36,
    overflow: "hidden",
    backgroundColor: "rgba(255,255,255,0.20)",
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 2,
  },
  routineContent: {
    paddingHorizontal: 32,
    paddingTop: 40,
    paddingBottom: 36,
  },
  routineTitle: {
    fontSize: 14,
    fontWeight: "800",
    color: "#334155",
    letterSpacing: 1.0,
    textTransform: "uppercase",
  },
  fieldLabel: {
    fontSize: 16,
    fontWeight: "500",
    color: "#475569",
  },
  saveRow: {
    alignItems: "flex-end",
    marginTop: 28,
  },
  saveBtn: {
    height: 48,
    paddingHorizontal: 26,
    borderRadius: 999,
    borderWidth: 1,
    overflow: "hidden",
    justifyContent: "center",
    shadowColor: "#0f172a",
    shadowOpacity: 0.18,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
  },
  saveInner: {
    minWidth: 56,
    height: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  saveText: {
    fontSize: 16,
    fontWeight: "600",
    color: "rgba(51,65,85,0.95)",
  },
  saveCheck: {
    position: "absolute",
    alignItems: "center",
    justifyContent: "center",
  },
  note: {
    marginTop: 36,
    fontSize: 16,
    color: "rgba(100,116,139,0.85)",
  },
});
