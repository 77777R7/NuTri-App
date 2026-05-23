import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { BlurView } from "expo-blur";
import { X } from "lucide-react-native";

import { CompareSheet } from "@/components/screens/my-supplement/CompareSheet";
import { GoalFitScorecard } from "@/components/screens/my-supplement/GoalFitScorecard";
import { GoalNavigatorContextCard } from "@/components/screens/personalization/GoalNavigatorContextCard";
import { RefinePicksDrawer } from "@/components/screens/personalization/RefinePicksDrawer";
import { usePersonalization } from "@/contexts/PersonalizationContext";
import { useSavedSupplements } from "@/contexts/SavedSupplementsContext";
import { usePremiumAccess } from "@/hooks/usePremiumAccess";
import { apiClient } from "@/lib/api-client";
import { buildGoalCompareEntries } from "@/lib/personalization/core/compareModel";
import { buildPersonalizationControlEvents } from "@/lib/personalization/core/critiqueEngine";
import {
  getConservativeReviewGoals,
  getGoalNavigatorEnabledGoals,
} from "@/lib/personalization/core/goalConfidenceProfiles";
import { buildOfficialPaywallParams } from "@/lib/pro/featureGates";
import { summarizeGoalFitReasons } from "@/lib/personalization/goalFitCopy";
import { getGoalDisplayLabel } from "@/lib/personalization/uiLabels";
import type {
  GoalKey,
  GoalNavigatorCandidate,
  GoalNavigatorResponse,
  PersonalizationControlKey,
} from "@/types/personalization";

import { GoalNavigatorGoalTabs } from "./GoalNavigatorGoalTabs";
import { GoalNavigatorResultCard } from "./GoalNavigatorResultCard";
import { NotEnoughDataPanel } from "./NotEnoughDataPanel";

const GOAL_TINTS: Record<GoalKey, string> = {
  sleep: "rgba(196,181,253,0.38)",
  energy: "rgba(253,224,71,0.32)",
  immunity: "rgba(147,197,253,0.42)",
  recovery: "rgba(252,211,77,0.34)",
  focus: "rgba(165,243,252,0.34)",
  libido_enhancement: "rgba(251,207,232,0.34)",
  stress_support: "rgba(191,219,254,0.34)",
  weight_management: "rgba(187,247,208,0.34)",
};

const normalize = (value?: string | null) =>
  value
    ?.toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .trim() ?? "";

const isGoalKey = (value: string): value is GoalKey =>
  value === "sleep" ||
  value === "energy" ||
  value === "immunity" ||
  value === "recovery" ||
  value === "focus" ||
  value === "libido_enhancement" ||
  value === "stress_support" ||
  value === "weight_management";

export function GoalNavigatorScreen({ initialGoal }: { initialGoal?: string }) {
  const insets = useSafeAreaInsets();
  const { snapshot, smartFilter, recordOverrideEvents, trackPersonalizationEvent } = usePersonalization();
  const { savedSupplements, addSupplement } = useSavedSupplements();
  const premiumAccess = usePremiumAccess();
  const visibleGoals = smartFilter.visibleGoals;
  const supportedGoals = useMemo(
    () => getGoalNavigatorEnabledGoals(visibleGoals),
    [visibleGoals],
  );
  const conservativeGoals = useMemo(
    () => getConservativeReviewGoals(visibleGoals),
    [visibleGoals],
  );

  const resolvedInitialGoal = useMemo<GoalKey | null>(() => {
    if (initialGoal && isGoalKey(initialGoal) && supportedGoals.includes(initialGoal)) {
      return initialGoal;
    }

    return supportedGoals[0] ?? null;
  }, [initialGoal, supportedGoals]);

  const [selectedGoal, setSelectedGoal] = useState<GoalKey | null>(resolvedInitialGoal);
  const [response, setResponse] = useState<GoalNavigatorResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(null);
  const [compareVisible, setCompareVisible] = useState(false);
  const openedEventTrackedRef = useRef(false);

  useEffect(() => {
    if (!resolvedInitialGoal) {
      setSelectedGoal(null);
      return;
    }
    if (resolvedInitialGoal && (!selectedGoal || !supportedGoals.includes(selectedGoal))) {
      setSelectedGoal(resolvedInitialGoal);
    }
  }, [resolvedInitialGoal, selectedGoal, supportedGoals]);

  useEffect(() => {
    let active = true;
    if (!selectedGoal) {
      setResponse(null);
      return () => {
        active = false;
      };
    }

    setLoading(true);
    setError(null);

    void apiClient
      .fetchGoalNavigator({
        goalKey: selectedGoal,
        preferredTypes: smartFilter.preselectedTypes,
        snapshotId: snapshot.snapshotId,
        preferenceVector: snapshot.strategies.preferenceVector,
        userContext: {
          duplicateRisk: snapshot.profile.observed.duplicateRisk,
          supplementExperience: snapshot.profile.declared.supplementExperience,
          ageRange: snapshot.profile.declared.ageRange,
          adherenceBlocker: snapshot.profile.declared.adherenceBlocker,
        },
      })
      .then((next) => {
        if (!active) return;
        setResponse(next);
      })
      .catch((requestError) => {
        if (!active) return;
        const message = requestError instanceof Error ? requestError.message : "Unable to load goal fits right now.";
        console.warn("[goal-navigator] request failed", message);
        setError("We could not load goal-based picks right now.");
      })
      .finally(() => {
        if (!active) return;
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [
    selectedGoal,
    smartFilter.preselectedTypes,
    snapshot.profile,
    snapshot.snapshotId,
    snapshot.strategies.preferenceVector,
  ]);

  useEffect(() => {
    if (openedEventTrackedRef.current || !selectedGoal) return;
    openedEventTrackedRef.current = true;
    void trackPersonalizationEvent({
      eventName: "goal_navigator_opened",
      surface: "goal_navigator",
      payload: {
        goalKey: selectedGoal,
        preferredTypeCount: smartFilter.preselectedTypes.length,
        visibleGoalCount: supportedGoals.length,
        conservativeGoalCount: conservativeGoals.length,
      },
    });
  }, [
    conservativeGoals.length,
    selectedGoal,
    smartFilter.preselectedTypes.length,
    supportedGoals.length,
    trackPersonalizationEvent,
  ]);

  const savedKeySet = useMemo(() => {
    const next = new Set<string>();
    for (const item of savedSupplements) {
      if (item.barcode?.trim()) next.add(`barcode:${item.barcode.trim()}`);
      next.add(`name:${normalize(item.brandName)}:${normalize(item.productName)}`);
    }
    return next;
  }, [savedSupplements]);

  const selectedCandidate = useMemo(
    () => response?.candidates.find((candidate) => candidate.productId === selectedCandidateId) ?? null,
    [response?.candidates, selectedCandidateId],
  );

  const compareEntries = useMemo(
    () =>
      selectedCandidate
        ? buildGoalCompareEntries({
            evaluations: response?.candidates.map((candidate) => candidate.evaluation) ?? [],
            currentProductId: selectedCandidate.productId,
            goalKey: selectedGoal ?? undefined,
            limit: 3,
          })
        : [],
    [response?.candidates, selectedCandidate, selectedGoal],
  );

  const goalTint = selectedGoal ? GOAL_TINTS[selectedGoal] : GOAL_TINTS.immunity;

  const isSaved = useCallback(
    (candidate: GoalNavigatorCandidate) => {
      const display = candidate.evaluation.display;
      if (candidate.barcode?.trim() && savedKeySet.has(`barcode:${candidate.barcode.trim()}`)) {
        return true;
      }

      return savedKeySet.has(
        `name:${normalize(display?.brandName ?? "")}:${normalize(display?.title ?? "")}`,
      );
    },
    [savedKeySet],
  );

  const handleSaveCandidate = useCallback(
    (candidate: GoalNavigatorCandidate) => {
      if (premiumAccess.loading) return;

      const display = candidate.evaluation.display;
      const addResult = addSupplement({
        barcode: candidate.barcode ?? null,
        imageUrl: display?.imageUrl ?? null,
        productName: display?.title ?? "Coverage-ready supplement",
        brandName: display?.brandName ?? "Unknown brand",
        dosageText: display?.dosageText ?? "",
        tags: [getGoalDisplayLabel(candidate.goalKey)],
      }, {
        isPremium: premiumAccess.isPremium,
      });

      if (addResult.status === "limit_reached") {
        router.push({
          pathname: "/paywall/official",
          params: buildOfficialPaywallParams({
            source: "saved_supplement_limit",
            returnTo: initialGoal ? `/main/goal-navigator?goal=${encodeURIComponent(initialGoal)}` : "/main/goal-navigator",
          }),
        });
        return;
      }

      if (addResult.status !== "added") {
        return;
      }
    },
    [addSupplement, initialGoal, premiumAccess.isPremium, premiumAccess.loading],
  );

  const handleToggleControl = useCallback(
    async ({ key, active }: { key: PersonalizationControlKey; active: boolean }) => {
      await recordOverrideEvents(
        buildPersonalizationControlEvents({
          key,
          active,
        }),
      );
    },
    [recordOverrideEvents],
  );

  const handleOpenCandidate = useCallback(
    (candidate: GoalNavigatorCandidate) => {
      setSelectedCandidateId(candidate.productId);
      void trackPersonalizationEvent({
        eventName: "goal_fit_detail_opened",
        surface: "goal_navigator",
        payload: {
          goalKey: candidate.goalKey,
          productId: candidate.productId,
          tier: candidate.tier,
        },
      });
    },
    [trackPersonalizationEvent],
  );

  const handleOpenCompare = useCallback(() => {
    if (!selectedCandidate) return;
    setCompareVisible(true);
    void trackPersonalizationEvent({
      eventName: "compare_opened",
      surface: "goal_navigator",
      payload: {
        goalKey: selectedGoal ?? null,
        currentProductId: selectedCandidate.productId,
        comparedProductCount: compareEntries.length,
      },
    });
  }, [compareEntries.length, selectedCandidate, selectedGoal, trackPersonalizationEvent]);

  const summaryLine = useMemo(() => {
    if (supportedGoals.length === 0 && conservativeGoals.length > 0) {
      return "This view stays focused on goals where we can make clearer, more confident picks.";
    }
    if (!selectedGoal) return "Pick a goal to see the strongest next picks we can explain clearly.";
    return `The strongest next picks for ${getGoalDisplayLabel(selectedGoal)}, with quick reasons you can scan fast.`;
  }, [conservativeGoals.length, selectedGoal, supportedGoals.length]);

  return (
    <SafeAreaView style={styles.screen} edges={["top", "left", "right"]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.closeButton}>
          <X size={18} color="#0f172a" />
        </Pressable>
        <View style={styles.headerTextWrap}>
          <Text style={styles.eyebrow}>Explore by goal</Text>
          <Text style={styles.title}>Explore by goal</Text>
          <Text style={styles.subtitle}>{summaryLine}</Text>
        </View>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: Math.max(24, insets.bottom + 18) },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {supportedGoals.length > 0 && selectedGoal ? (
          <GoalNavigatorGoalTabs
            goals={supportedGoals}
            selectedGoal={selectedGoal}
            onSelectGoal={setSelectedGoal}
          />
        ) : null}

        {supportedGoals.length > 0 ? (
          <RefinePicksDrawer
            preferenceVector={snapshot.strategies.preferenceVector}
            onToggleChip={handleToggleControl}
            helperText="Only change this if you want simpler, stronger, or lower-overlap picks."
          />
        ) : null}

        {supportedGoals.length > 0 ? (
          <GoalNavigatorContextCard
            dietLanes={snapshot.strategies.dietLanes}
            activityPlan={snapshot.strategies.activityPlan}
          />
        ) : null}

        {supportedGoals.length === 0 && conservativeGoals.length > 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>These goals stay in conservative review.</Text>
            <Text style={styles.emptyBody}>
              {conservativeGoals.map((goalKey) => getGoalDisplayLabel(goalKey)).join(", ")} currently use
              a more cautious review path, so we are not pushing them through the main ranking yet.
            </Text>
          </View>
        ) : loading ? (
          <View style={styles.loadingBlock}>
            <ActivityIndicator color="#2563eb" />
            <Text style={styles.loadingText}>Finding the clearest next picks...</Text>
          </View>
        ) : error ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>{error}</Text>
            <Text style={styles.emptyBody}>Try again in a moment. We only show picks we can explain clearly.</Text>
          </View>
        ) : response?.candidates.length ? (
          <>
            {response.candidates.map((candidate) => (
              <GoalNavigatorResultCard
                key={candidate.productId}
                candidate={candidate}
                tintColor={goalTint}
                saved={isSaved(candidate)}
                onOpen={() => handleOpenCandidate(candidate)}
                onSave={() => handleSaveCandidate(candidate)}
              />
            ))}

            <NotEnoughDataPanel count={response.fallback.notEnoughStructuredDataCount} />
          </>
        ) : (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>No strong candidates surfaced yet.</Text>
            <Text style={styles.emptyBody}>
              We are only showing products with enough label detail to explain why they fit.
            </Text>
          </View>
        )}
      </ScrollView>

      {selectedCandidate ? (
        <Modal transparent animationType="fade" onRequestClose={() => setSelectedCandidateId(null)}>
          <View style={styles.modalOverlay}>
            <BlurView intensity={28} tint="dark" style={StyleSheet.absoluteFillObject} />
            <Pressable style={StyleSheet.absoluteFillObject} onPress={() => setSelectedCandidateId(null)} />

            <View style={styles.detailSheet}>
              <ScrollView
                style={styles.detailScroll}
                contentContainerStyle={[
                  styles.detailContent,
                  { paddingBottom: Math.max(20, insets.bottom + 12) },
                ]}
                showsVerticalScrollIndicator={false}
              >
                <View style={styles.detailHeaderRow}>
                  <View style={styles.detailHeaderTextWrap}>
                    <Text style={styles.detailEyebrow}>Explore by goal</Text>
                    <Text style={styles.detailTitle}>
                      {selectedCandidate.evaluation.display?.title ?? "Coverage-ready supplement"}
                    </Text>
                    <Text style={styles.detailMeta}>
                      {[selectedCandidate.evaluation.display?.brandName, selectedCandidate.evaluation.display?.dosageText]
                        .filter(Boolean)
                        .join(" · ")}
                    </Text>
                  </View>
                  <Pressable onPress={() => setSelectedCandidateId(null)} style={styles.closeButton}>
                    <X size={18} color="#0f172a" />
                  </Pressable>
                </View>

                <GoalFitScorecard
                  card={selectedCandidate.goalFitCard}
                  tintColor={goalTint}
                  compareEnabled={compareEntries.length > 1}
                  onOpenCompare={compareEntries.length > 1 ? handleOpenCompare : undefined}
                />

                <View style={styles.detailActionRow}>
                  <Pressable
                    onPress={() => handleSaveCandidate(selectedCandidate)}
                    style={[styles.detailSecondaryButton, isSaved(selectedCandidate) && styles.detailSecondaryButtonSaved]}
                    disabled={isSaved(selectedCandidate)}
                  >
                    <Text
                      style={[
                        styles.detailSecondaryButtonText,
                        isSaved(selectedCandidate) && styles.detailSecondaryButtonTextSaved,
                      ]}
                    >
                      {isSaved(selectedCandidate) ? "Saved to My Saved" : "Save to My Saved"}
                    </Text>
                  </Pressable>
                  {selectedCandidate.externalUrl ? (
                    <Pressable
                      onPress={() => {
                        void Linking.openURL(selectedCandidate.externalUrl!).catch((linkError) => {
                          const message = linkError instanceof Error ? linkError.message : "Unable to open link";
                          console.warn("[goal-navigator] open link failed", message);
                        });
                      }}
                      style={styles.detailPrimaryButton}
                    >
                      <Text style={styles.detailPrimaryButtonText}>Open product page</Text>
                    </Pressable>
                  ) : null}
                </View>

                <View style={styles.detailNote}>
                  <Text style={styles.detailNoteTitle}>What we used</Text>
                  <Text style={styles.detailNoteBody}>
                    {summarizeGoalFitReasons(
                      selectedCandidate.goalFitCard.whyFit,
                      "Structured ingredients drove this match.",
                    )}
                  </Text>
                </View>
              </ScrollView>
            </View>
          </View>

          <CompareSheet
            visible={compareVisible}
            entries={compareEntries}
            goalKey={selectedGoal ?? undefined}
            onClose={() => setCompareVisible(false)}
            tintColor={goalTint}
          />
        </Modal>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#f2f3f7",
  },
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 14,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 10,
  },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: 999,
    borderCurve: "continuous",
    backgroundColor: "rgba(255,255,255,0.92)",
    borderWidth: 1,
    borderColor: "rgba(226,232,240,0.92)",
    alignItems: "center",
    justifyContent: "center",
  },
  headerTextWrap: {
    flex: 1,
    gap: 4,
  },
  eyebrow: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "900",
    letterSpacing: 0.8,
    textTransform: "uppercase",
    color: "#2563eb",
    includeFontPadding: false,
  },
  title: {
    fontSize: 28,
    lineHeight: 34,
    fontWeight: "800",
    color: "#0f172a",
    includeFontPadding: false,
  },
  subtitle: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "600",
    color: "#475569",
    includeFontPadding: false,
  },
  scroll: { flex: 1 },
  scrollContent: {
    paddingHorizontal: 20,
    gap: 14,
  },
  preface: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "700",
    color: "#64748b",
    includeFontPadding: false,
  },
  loadingBlock: {
    minHeight: 180,
    borderRadius: 24,
    borderCurve: "continuous",
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "rgba(226,232,240,0.9)",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  loadingText: {
    fontSize: 14,
    lineHeight: 18,
    fontWeight: "700",
    color: "#475569",
    includeFontPadding: false,
  },
  emptyCard: {
    minHeight: 180,
    borderRadius: 24,
    borderCurve: "continuous",
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "rgba(226,232,240,0.9)",
    paddingHorizontal: 20,
    paddingVertical: 20,
    justifyContent: "center",
    gap: 10,
  },
  emptyTitle: {
    fontSize: 18,
    lineHeight: 24,
    fontWeight: "800",
    color: "#0f172a",
    includeFontPadding: false,
  },
  emptyBody: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "600",
    color: "#475569",
    includeFontPadding: false,
  },
  modalOverlay: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(15,23,42,0.32)",
  },
  detailSheet: {
    maxHeight: "86%",
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    borderCurve: "continuous",
    backgroundColor: "#f8fafc",
    overflow: "hidden",
  },
  detailScroll: { flexGrow: 0 },
  detailContent: {
    paddingHorizontal: 20,
    paddingTop: 18,
    gap: 14,
  },
  detailHeaderRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 14,
  },
  detailHeaderTextWrap: {
    flex: 1,
    gap: 4,
  },
  detailEyebrow: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "900",
    letterSpacing: 0.8,
    textTransform: "uppercase",
    color: "#2563eb",
    includeFontPadding: false,
  },
  detailTitle: {
    fontSize: 24,
    lineHeight: 30,
    fontWeight: "800",
    color: "#0f172a",
    includeFontPadding: false,
  },
  detailMeta: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "700",
    color: "#64748b",
    includeFontPadding: false,
  },
  detailActionRow: {
    flexDirection: "row",
    gap: 10,
  },
  detailPrimaryButton: {
    flex: 1,
    minHeight: 46,
    borderRadius: 16,
    borderCurve: "continuous",
    backgroundColor: "#0f172a",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  detailPrimaryButtonText: {
    fontSize: 14,
    lineHeight: 18,
    fontWeight: "800",
    color: "#ffffff",
    includeFontPadding: false,
  },
  detailSecondaryButton: {
    flex: 1,
    minHeight: 46,
    borderRadius: 16,
    borderCurve: "continuous",
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "rgba(203,213,225,0.95)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  detailSecondaryButtonSaved: {
    backgroundColor: "#dbeafe",
    borderColor: "rgba(96,165,250,0.54)",
  },
  detailSecondaryButtonText: {
    fontSize: 14,
    lineHeight: 18,
    fontWeight: "800",
    color: "#0f172a",
    includeFontPadding: false,
  },
  detailSecondaryButtonTextSaved: {
    color: "#1d4ed8",
  },
  detailNote: {
    borderRadius: 20,
    borderCurve: "continuous",
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "rgba(226,232,240,0.88)",
    paddingHorizontal: 18,
    paddingVertical: 18,
    gap: 6,
  },
  detailNoteTitle: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "900",
    color: "#0f172a",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    includeFontPadding: false,
  },
  detailNoteBody: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "600",
    color: "#475569",
    includeFontPadding: false,
  },
});
