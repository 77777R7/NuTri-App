import { BlurView } from "expo-blur";
import { LinearGradient } from "expo-linear-gradient";
import {
  Cross,
  ChevronDown,
  Info,
  Layers,
  Lock,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Target,
} from "lucide-react-native";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  LayoutAnimation,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  UIManager,
  View,
  Image,
} from "react-native";
import Animated, { FadeInUp, FadeOutDown } from "react-native-reanimated";

import type {
  TopSectionBannerPresentation,
  TopSectionHeroPresentation,
  TopSectionInsightPresentation,
  TopSectionInsightTopic,
  TopSectionSecondaryNotePresentation,
} from "@/lib/scan/analysisTopSectionPresentation";
import {
  NUTRI_ACTIVATION_DEFINITION,
  trackOnboardingEvent,
} from "@/lib/analytics/onboarding";
import { sanitizeScanDisplayText } from "@/lib/scan/neverBlank";

if (
  Platform.OS === "android" &&
  UIManager.setLayoutAnimationEnabledExperimental
) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

type AnalysisTopSectionRedesignProps = {
  hero: TopSectionHeroPresentation;
  banner: TopSectionBannerPresentation | null;
  insights: TopSectionInsightPresentation[];
  secondaryNote: TopSectionSecondaryNotePresentation | null;
  productTitle: string;
  productSubtitle?: string | null;
  heroImageUri?: string | null;
  verifiedLabelText: string;
  lockedPreview?: boolean;
};

type GoalCoverageRenderItem = {
  key: string;
  goalLabel: string;
  state: "strong" | "some" | "limited" | "none" | "unknown";
  description: string;
  stateLabel: string;
};

const getGoalCoverageStateStyles = (state: GoalCoverageRenderItem["state"]) => {
  switch (state) {
    case "strong":
      return {
        text: styles.goalCoverageStateStrong,
        chip: styles.goalCoverageStateChipStrong,
        card: styles.goalCoverageCardStrong,
        accent: styles.goalCoverageAccentStrong,
      };
    case "some":
      return {
        text: styles.goalCoverageStateSome,
        chip: styles.goalCoverageStateChipSome,
        card: styles.goalCoverageCardSome,
        accent: styles.goalCoverageAccentSome,
      };
    case "limited":
      return {
        text: styles.goalCoverageStateLimited,
        chip: styles.goalCoverageStateChipLimited,
        card: styles.goalCoverageCardLimited,
        accent: styles.goalCoverageAccentLimited,
      };
    case "none":
      return {
        text: styles.goalCoverageStateNone,
        chip: styles.goalCoverageStateChipNone,
        card: styles.goalCoverageCardNone,
        accent: styles.goalCoverageAccentNone,
      };
    case "unknown":
    default:
      return {
        text: styles.goalCoverageStateUnknown,
        chip: styles.goalCoverageStateChipUnknown,
        card: styles.goalCoverageCardUnknown,
        accent: styles.goalCoverageAccentUnknown,
      };
  }
};

const resolveInsightIcon = (
  topic: TopSectionInsightTopic,
  tone: TopSectionHeroPresentation["tone"],
) => {
  switch (topic) {
    case "support":
      if (tone === "positive") {
        return { Icon: Target, iconBg: "#EAF5F0", iconColor: "#1E7B55" };
      }
      if (tone === "caution") {
        return { Icon: Target, iconBg: "#FFF4E5", iconColor: "#D97706" };
      }
      return { Icon: Target, iconBg: "#EEF4FB", iconColor: "#4F6B8A" };
    case "allergy":
      if (tone === "positive") {
        return { Icon: ShieldCheck, iconBg: "#EAF5F0", iconColor: "#1E7B55" };
      }
      if (tone === "caution") {
        return { Icon: ShieldAlert, iconBg: "#FFF4E5", iconColor: "#D97706" };
      }
      return { Icon: Shield, iconBg: "#EEF4FB", iconColor: "#64748B" };
    case "dose":
      return { Icon: Info, iconBg: "#EBF3FF", iconColor: "#2563EB" };
    case "overlap":
      return { Icon: Layers, iconBg: "#F4EEFF", iconColor: "#7C3AED" };
    case "safety":
    default:
      return { Icon: Cross, iconBg: "#FFF4E5", iconColor: "#D97706" };
  }
};

const getHeroChipColors = (tone: TopSectionHeroPresentation["tone"]) => {
  if (tone === "positive") {
    return {
      fill: "#EAF5F0",
      border: "rgba(30,123,85,0.10)",
      text: "#1E7B55",
    };
  }
  if (tone === "caution") {
    return {
      fill: "#FFF4E5",
      border: "rgba(217,119,6,0.12)",
      text: "#B45309",
    };
  }
  return {
    fill: "#EEF4FB",
    border: "rgba(37,99,235,0.10)",
    text: "#375569",
  };
};

const getExpandedFrameHeight = (lineCount: number) => {
  if (lineCount >= 6) return 244;
  if (lineCount >= 4) return 204;
  if (lineCount >= 3) return 164;
  if (lineCount === 2) return 126;
  return 92;
};

export const AnalysisTopSectionRedesign: React.FC<
  AnalysisTopSectionRedesignProps
> = ({
  hero,
  banner,
  insights,
  secondaryNote,
  productTitle,
  productSubtitle,
  heroImageUri,
  verifiedLabelText,
  lockedPreview = false,
}) => {
  const derivedSyncKey = useMemo(
    () =>
      `${hero.chip}::${hero.summary}::${banner?.title ?? "no-banner"}::${insights
        .map(
          (row) =>
            `${row.key}:${row.collapsedTitle}:${row.subtitle ?? ""}:${row.expandActionLabel ?? ""}:${(
              row.goalCoverageItems ?? []
            )
              .map((item) => item.key)
              .join(",")}`,
        )
        .join("|")}`,
    [banner?.title, hero.chip, hero.summary, insights],
  );
  const defaultExpandedKey =
    insights.find((row) => row.defaultExpanded)?.key ??
    insights[0]?.key ??
    null;
  const lastSyncKeyRef = useRef<string>(derivedSyncKey);
  const [expandedKey, setExpandedKey] = useState<string | null>(
    defaultExpandedKey,
  );
  const [expandedCoverageRows, setExpandedCoverageRows] = useState<
    Record<string, boolean>
  >({});
  const [personalizationCoachDismissed, setPersonalizationCoachDismissed] =
    useState(false);

  useEffect(() => {
    if (lastSyncKeyRef.current === derivedSyncKey) return;
    lastSyncKeyRef.current = derivedSyncKey;
    setExpandedKey(defaultExpandedKey);
    setExpandedCoverageRows({});
    setPersonalizationCoachDismissed(false);
  }, [defaultExpandedKey, derivedSyncKey]);

  useEffect(() => {
    if (!expandedKey) return;
    if (insights.some((row) => row.key === expandedKey)) return;
    setExpandedKey(defaultExpandedKey);
  }, [defaultExpandedKey, expandedKey, insights]);

  const heroChipColors = getHeroChipColors(hero.tone);
  const hasGoalCoachSpot = insights.some((row) => row.coachSpot === "goal_fit");
  const hasAllergyCoachSpot = insights.some(
    (row) => row.coachSpot === "allergy_check",
  );
  const showPersonalizationCoach =
    !lockedPreview &&
    !personalizationCoachDismissed &&
    hasGoalCoachSpot &&
    hasAllergyCoachSpot;
  const handleDismissPersonalizationCoach = useCallback(() => {
    setPersonalizationCoachDismissed(true);
    trackOnboardingEvent("coach_dismissed", {
      activationDefinition: NUTRI_ACTIVATION_DEFINITION.id,
      surface: "scan_result_personalized_insights",
    });
  }, []);

  return (
    <View style={styles.wrapper}>
      <Animated.View
        entering={FadeInUp.duration(260)}
        style={styles.heroSection}
      >
        <LinearGradient
          colors={["rgba(255,255,255,0.82)", "rgba(255,255,255,0.72)"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.heroCard}
        >
          <BlurView
            intensity={18}
            tint="light"
            style={StyleSheet.absoluteFill}
          />
          <View
            style={[
              styles.heroChip,
              {
                backgroundColor: heroChipColors.fill,
                borderColor: heroChipColors.border,
              },
            ]}
          >
            <Text style={[styles.heroChipText, { color: heroChipColors.text }]}>
              {hero.chip}
            </Text>
          </View>

          <View style={styles.productRow}>
            {heroImageUri ? (
              <Image
                source={{ uri: heroImageUri }}
                style={styles.productImage}
                resizeMode="cover"
              />
            ) : (
              <View style={styles.productImageWrap}>
                <LinearGradient
                  colors={[
                    "#FFFFFF",
                    "#FCFDFE",
                    "#F9FBFD",
                    "#F7F9FB",
                    "#F4F7FA",
                    "#F1F5F9",
                  ]}
                  locations={[0, 0.2, 0.4, 0.6, 0.8, 1]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.productImageGlass}
                />
                <LinearGradient
                  colors={[
                    "#E2E8F0",
                    "#DEE5ED",
                    "#DAE2EB",
                    "#D6DEE8",
                    "#D3DBE6",
                    "#CFD8E3",
                    "#CBD5E1",
                  ]}
                  locations={[0, 0.1667, 0.3333, 0.5, 0.6667, 0.8333, 1]}
                  start={{ x: 0.5, y: 0 }}
                  end={{ x: 0.5, y: 1 }}
                  style={styles.productBottle}
                >
                  <View style={styles.productBottleCap} />
                </LinearGradient>
              </View>
            )}

            <View style={styles.productTextWrap}>
              <Text style={styles.productTitle} numberOfLines={2}>
                {productTitle}
              </Text>
              {!!productSubtitle ? (
                <Text style={styles.productSubtitle} numberOfLines={2}>
                  {productSubtitle}
                </Text>
              ) : null}
            </View>
          </View>

          <View style={styles.heroDivider} />
          <Text style={styles.heroSummary}>{hero.summary}</Text>
          <View style={styles.heroVerifiedRow}>
            <Shield size={14} color="#64748B" />
            <Text style={styles.heroVerifiedText}>{verifiedLabelText}</Text>
          </View>
        </LinearGradient>
      </Animated.View>

      {!lockedPreview && banner ? (
        <Animated.View
          entering={FadeInUp.duration(260).delay(60)}
          style={styles.bannerWrap}
        >
          <View style={styles.bannerCard}>
            <View style={styles.bannerIconWrap}>
              <ShieldAlert size={18} color="#D97706" />
            </View>
            <Text style={styles.bannerText}>
              {sanitizeScanDisplayText(banner.title) ?? banner.title}
            </Text>
          </View>
        </Animated.View>
      ) : null}

      {insights.length > 0 ? (
        <Animated.View
          entering={FadeInUp.duration(260).delay(100)}
          style={[
            styles.insightsSection,
            showPersonalizationCoach && styles.insightsSectionCoachActive,
          ]}
        >
          {showPersonalizationCoach ? (
            <View pointerEvents="none" style={styles.personalizationCoachPageScrim} />
          ) : null}
          <Text style={styles.insightsTitle}>Personalized Insights</Text>
          {showPersonalizationCoach ? (
            <View pointerEvents="none" style={styles.personalizationCoachBubble}>
              <Text style={styles.personalizationCoachBubbleText}>
                {
                  "After you choose a goal and allergies, these two spots become personalized: "
                }
                <Text style={styles.personalizationCoachBubbleEmphasis}>
                  fit for your goal
                </Text>
                {", and "}
                <Text style={styles.personalizationCoachBubbleEmphasis}>
                  anything you should avoid.
                </Text>
              </Text>
              <View style={styles.personalizationCoachBubbleTail} />
            </View>
          ) : null}
          <View
            style={[
              styles.insightsCard,
              showPersonalizationCoach && styles.insightsCardCoachActive,
            ]}
          >
            {insights.map((row, index) => {
              const isCoachHighlighted =
                showPersonalizationCoach &&
                (row.coachSpot === "goal_fit" ||
                  row.coachSpot === "allergy_check");
              const isExpanded =
                !showPersonalizationCoach && expandedKey === row.key;
              const { Icon, iconBg, iconColor } = resolveInsightIcon(
                row.topic,
                row.tone,
              );
              const isGoalCoverageRow =
                (row.goalCoverageItems?.length ?? 0) > 0;
              const rowTitle =
                sanitizeScanDisplayText(row.collapsedTitle) ??
                row.collapsedTitle;
              const rawSubtitle = sanitizeScanDisplayText(row.subtitle ?? null);
              const fullGoalCoverageItems: GoalCoverageRenderItem[] = (
                row.goalCoverageItems ?? []
              ).map((item) => ({
                key: item.key,
                goalLabel: item.goalLabel,
                state: item.state,
                description: item.description,
                stateLabel: item.stateLabel,
              }));
              const showAllGoalCoverage =
                expandedCoverageRows[row.key] === true;
              const fallbackVisibleGoalCoverageItems =
                row.visibleGoalCoverageItems &&
                row.visibleGoalCoverageItems.length > 0
                  ? row.visibleGoalCoverageItems.map((item) => ({
                      key: item.key,
                      goalLabel: item.goalLabel,
                      state: item.state,
                      description: item.description,
                      stateLabel: item.stateLabel,
                    }))
                  : fullGoalCoverageItems;
              const useInlineSecondaryCoverage =
                row.goalCoveragePresentation === "secondary_inline";
              const activeGoalCoverageItems = isGoalCoverageRow
                ? useInlineSecondaryCoverage
                  ? showAllGoalCoverage
                    ? fullGoalCoverageItems
                    : []
                  : ((showAllGoalCoverage
                      ? fullGoalCoverageItems
                      : fallbackVisibleGoalCoverageItems) ?? [])
                : [];
              const rowSubtitle =
                isGoalCoverageRow && showAllGoalCoverage
                  ? sanitizeScanDisplayText(row.expandedSubtitle ?? null)
                  : rawSubtitle;
              const expandedBullets = row.expandedBullets
                .map((bullet) => sanitizeScanDisplayText(bullet))
                .filter((bullet): bullet is string => Boolean(bullet));
              const expandedFrameHeight = getExpandedFrameHeight(
                isGoalCoverageRow
                  ? activeGoalCoverageItems.length +
                      expandedBullets.length +
                      (useInlineSecondaryCoverage ? 2 : 0)
                  : expandedBullets.length,
              );

              const handleToggle = () => {
                LayoutAnimation.configureNext(
                  LayoutAnimation.Presets.easeInEaseOut,
                );
                setExpandedKey((current) =>
                  current === row.key ? null : row.key,
                );
              };

              const handleGoalCoverageToggle = () => {
                LayoutAnimation.configureNext(
                  LayoutAnimation.Presets.easeInEaseOut,
                );
                setExpandedCoverageRows((current) => ({
                  ...current,
                  [row.key]: !current[row.key],
                }));
              };

              return (
                <View
                  key={row.key}
                  style={[
                    isExpanded
                      ? [
                          styles.rowBlockExpanded,
                          { minHeight: expandedFrameHeight },
                        ]
                      : null,
                    isCoachHighlighted &&
                      styles.personalizationCoachSpotBlock,
                  ]}
                >
                  <Pressable
                    onPress={handleToggle}
                    style={[
                      styles.rowPressable,
                      isCoachHighlighted && styles.personalizationCoachSpotRow,
                    ]}
                    disabled={lockedPreview || showPersonalizationCoach}
                  >
                    <View
                      style={[styles.rowIconWrap, { backgroundColor: iconBg }]}
                    >
                      <Icon size={18} color={iconColor} />
                    </View>
                    <View style={styles.rowCopy}>
                      <Text style={styles.rowTitle}>{rowTitle}</Text>
                      {!!rowSubtitle ? (
                        <Text style={styles.rowSubtitle}>{rowSubtitle}</Text>
                      ) : null}
                    </View>
                    <View
                      style={[
                        styles.chevronWrap,
                        isExpanded && styles.chevronWrapExpanded,
                      ]}
                    >
                      <ChevronDown
                        size={20}
                        color="#64748B"
                        strokeWidth={2.2}
                      />
                    </View>
                  </Pressable>

                  {isExpanded && isGoalCoverageRow && !lockedPreview ? (
                    <Animated.View
                      entering={FadeInUp.duration(200)}
                      exiting={FadeOutDown.duration(140)}
                      style={[
                        styles.expandedWrap,
                        { minHeight: Math.max(expandedFrameHeight - 58, 44) },
                      ]}
                    >
                      {expandedBullets.map((bullet, bulletIndex) => (
                        <Text
                          key={`${row.key}-${useInlineSecondaryCoverage ? "dominant" : "coverage"}-${bulletIndex}`}
                          style={styles.expandedLine}
                        >
                          {bullet}
                        </Text>
                      ))}
                      {useInlineSecondaryCoverage ? (
                        <View style={styles.inlineCoverageSection}>
                          <Text style={styles.inlineCoverageLabel}>
                            {row.inlineGoalCoverageTitle ?? "Goal check"}
                          </Text>
                          {!!(!showAllGoalCoverage
                            ? row.inlineGoalCoveragePreview
                            : undefined) ? (
                            <Text style={styles.inlineCoveragePreview}>
                              {!showAllGoalCoverage
                                ? row.inlineGoalCoveragePreview
                                : undefined}
                            </Text>
                          ) : null}
                          {!!(showAllGoalCoverage
                            ? row.expandedSubtitle
                            : undefined) ? (
                            <Text style={styles.inlineCoverageSubtitle}>
                              {showAllGoalCoverage
                                ? (sanitizeScanDisplayText(
                                    row.expandedSubtitle ?? null,
                                  ) ?? undefined)
                                : undefined}
                            </Text>
                          ) : null}
                        </View>
                      ) : null}
                      {activeGoalCoverageItems.map((item) => {
                        const stateStyles = getGoalCoverageStateStyles(
                          item.state,
                        );
                        return (
                          <View
                            key={`${row.key}-${item.key}`}
                            style={[
                              styles.goalCoverageLineWrap,
                              stateStyles.card,
                            ]}
                          >
                            <View
                              style={[
                                styles.goalCoverageAccent,
                                stateStyles.accent,
                              ]}
                            />
                            <View style={styles.goalCoverageCopy}>
                              <Text style={styles.goalCoverageGoalLabel}>
                                {item.goalLabel}
                              </Text>
                            </View>
                            <View
                              style={[
                                styles.goalCoverageStateChip,
                                stateStyles.chip,
                              ]}
                            >
                              <Text
                                style={[
                                  styles.goalCoverageStateText,
                                  stateStyles.text,
                                ]}
                              >
                                {item.stateLabel}
                              </Text>
                            </View>
                          </View>
                        );
                      })}
                      {row.canExpandAll &&
                      row.expandActionLabel &&
                      row.collapseActionLabel ? (
                        <Pressable
                          onPress={handleGoalCoverageToggle}
                          style={styles.goalCoverageActionWrap}
                        >
                          <Text style={styles.goalCoverageActionText}>
                            {showAllGoalCoverage
                              ? row.collapseActionLabel
                              : row.expandActionLabel}
                          </Text>
                        </Pressable>
                      ) : null}
                    </Animated.View>
                  ) : null}

                  {isExpanded &&
                  !isGoalCoverageRow &&
                  expandedBullets.length > 0 &&
                  !lockedPreview ? (
                    <Animated.View
                      entering={FadeInUp.duration(200)}
                      exiting={FadeOutDown.duration(140)}
                      style={[
                        styles.expandedWrap,
                        { minHeight: Math.max(expandedFrameHeight - 58, 44) },
                      ]}
                    >
                      {expandedBullets.map((bullet, bulletIndex) => (
                        <Text
                          key={`${row.key}-${bulletIndex}`}
                          style={styles.expandedLine}
                        >
                          {bullet}
                        </Text>
                      ))}
                    </Animated.View>
                  ) : null}

                  {index < insights.length - 1 ? (
                    <LinearGradient
                      colors={[
                        "rgba(11,30,54,0)",
                        "rgba(11,30,54,0.05)",
                        "rgba(11,30,54,0)",
                      ]}
                      locations={[0, 0.5, 1]}
                      start={{ x: 0, y: 0.5 }}
                      end={{ x: 1, y: 0.5 }}
                      style={styles.divider}
                    />
                  ) : null}
                </View>
              );
            })}
            {showPersonalizationCoach ? (
              <View pointerEvents="none" style={styles.personalizationCoachCardScrim} />
            ) : null}
            {secondaryNote ? (
              <>
                {insights.length > 0 ? (
                  <LinearGradient
                    colors={[
                      "rgba(11,30,54,0)",
                      "rgba(11,30,54,0.05)",
                      "rgba(11,30,54,0)",
                    ]}
                    locations={[0, 0.5, 1]}
                    start={{ x: 0, y: 0.5 }}
                    end={{ x: 1, y: 0.5 }}
                    style={styles.divider}
                  />
                ) : null}
                <View style={styles.secondaryNoteInlineWrap}>
                  <View style={styles.secondaryNoteCard}>
                    <View style={styles.secondaryNoteIconWrap}>
                      <Cross size={16} color="#D97706" />
                    </View>
                    <View style={styles.secondaryNoteCopy}>
                      <Text style={styles.secondaryNoteTitle}>
                        {secondaryNote.title}
                      </Text>
                      {!!sanitizeScanDisplayText(secondaryNote.body ?? null) ? (
                        <Text style={styles.secondaryNoteBody}>
                          {sanitizeScanDisplayText(secondaryNote.body ?? null)}
                        </Text>
                      ) : null}
                    </View>
                  </View>
                </View>
              </>
            ) : null}
            {lockedPreview ? (
              <View pointerEvents="none" style={styles.insightsLockedOverlay}>
                <BlurView
                  intensity={24}
                  tint="light"
                  style={StyleSheet.absoluteFill}
                />
                <View style={styles.insightsLockedTint} />
                <View style={styles.insightsLockedBadge}>
                  <Lock size={14} color="#0F172A" />
                  <Text style={styles.insightsLockedBadgeText}>Premium</Text>
                </View>
              </View>
            ) : null}
          </View>
          {showPersonalizationCoach ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Dismiss personalized insights guide"
              onPress={handleDismissPersonalizationCoach}
              style={styles.personalizationCoachTapLayer}
            />
          ) : null}
        </Animated.View>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  wrapper: {
    paddingHorizontal: 8,
    marginBottom: 24,
    gap: 16,
  },
  heroSection: {
    marginTop: 8,
  },
  heroCard: {
    overflow: "hidden",
    borderRadius: 32,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.8)",
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 26,
    shadowColor: "#0B1E36",
    shadowOpacity: 0.04,
    shadowRadius: 32,
    shadowOffset: { width: 0, height: 8 },
    backgroundColor: "rgba(255,255,255,0.72)",
  },
  heroChip: {
    alignSelf: "flex-start",
    minHeight: 33,
    borderRadius: 999,
    borderWidth: 0.678,
    paddingHorizontal: 14,
    justifyContent: "center",
    shadowColor: "#1E7B55",
    shadowOpacity: 0.1,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
  },
  heroChipText: {
    fontSize: 13,
    lineHeight: 19.5,
    fontWeight: "600",
    letterSpacing: -0.4,
  },
  productRow: {
    marginTop: 24,
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
  },
  productImage: {
    width: 72,
    height: 72,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#FFFFFF",
    backgroundColor: "#FFFFFF",
  },
  productImageWrap: {
    width: 72,
    height: 72,
    borderRadius: 20,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#FFFFFF",
    shadowColor: "#000000",
    shadowOpacity: 0.06,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 4 },
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
  },
  productImageGlass: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 20,
  },
  productBottle: {
    width: 32,
    height: 48,
    borderRadius: 8,
    borderWidth: 0.7,
    borderColor: "#FFFFFF",
    alignItems: "center",
    paddingTop: 8,
    shadowColor: "#000000",
    shadowOpacity: 0.05,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
  },
  productBottleCap: {
    width: 16,
    height: 6,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.6)",
  },
  productTextWrap: {
    flex: 1,
    justifyContent: "center",
  },
  productTitle: {
    fontSize: 20,
    lineHeight: 25,
    fontWeight: "800",
    color: "#0B1E36",
    letterSpacing: -0.45,
  },
  productSubtitle: {
    marginTop: 4,
    fontSize: 15,
    lineHeight: 22.5,
    fontWeight: "500",
    color: "#64748B",
    letterSpacing: -0.23,
  },
  heroDivider: {
    marginTop: 24,
    marginBottom: 20,
    height: 0.7,
    backgroundColor: "rgba(11,30,54,0.05)",
  },
  heroSummary: {
    fontSize: 15,
    lineHeight: 20.625,
    fontWeight: "500",
    color: "#0B1E36",
    letterSpacing: -0.23,
    maxWidth: 262,
  },
  heroVerifiedRow: {
    marginTop: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  heroVerifiedText: {
    fontSize: 13,
    lineHeight: 19.5,
    fontWeight: "500",
    color: "#64748B",
    letterSpacing: -0.08,
  },
  bannerWrap: {
    paddingHorizontal: 0,
  },
  bannerCard: {
    minHeight: 72,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: "rgba(253,224,139,0.5)",
    backgroundColor: "rgba(255,248,234,0.8)",
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    shadowColor: "#D97706",
    shadowOpacity: 0.05,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 8 },
  },
  bannerIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: "#FEF3C7",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(253,230,138,0.6)",
  },
  bannerText: {
    flex: 1,
    fontSize: 14.5,
    lineHeight: 20,
    fontWeight: "700",
    color: "#92400E",
    letterSpacing: -0.2,
  },
  insightsSection: {
    gap: 16,
  },
  insightsSectionCoachActive: {
    zIndex: 30,
    overflow: "visible",
  },
  insightsTitle: {
    paddingHorizontal: 8,
    fontSize: 18,
    lineHeight: 27,
    fontWeight: "600",
    color: "#0B1E36",
    letterSpacing: -0.89,
  },
  insightsCard: {
    borderRadius: 32,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.6)",
    backgroundColor: "rgba(255,255,255,0.5)",
    shadowColor: "#0B1E36",
    shadowOpacity: 0.03,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 4 },
    overflow: "hidden",
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
  insightsCardCoachActive: {
    zIndex: 2,
    overflow: "visible",
    borderColor: "transparent",
    backgroundColor: "transparent",
    shadowOpacity: 0,
  },
  personalizationCoachPageScrim: {
    position: "absolute",
    top: -520,
    right: -32,
    bottom: -1000,
    left: -32,
    zIndex: 1,
    backgroundColor: "rgba(0,0,0,0.58)",
  },
  personalizationCoachCardScrim: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 2,
    borderRadius: 32,
    backgroundColor: "rgba(0,0,0,0.18)",
  },
  personalizationCoachSpotBlock: {
    zIndex: 3,
    elevation: 12,
    overflow: "visible",
  },
  personalizationCoachSpotRow: {
    backgroundColor: "#FFFFFF",
    borderWidth: 1.3,
    borderColor: "#BFDBFE",
    shadowColor: "#60A5FA",
    shadowOpacity: 0.82,
    shadowRadius: 15,
    shadowOffset: { width: 0, height: 0 },
    elevation: 12,
  },
  personalizationCoachBubble: {
    alignSelf: "flex-end",
    marginTop: -2,
    marginRight: 10,
    marginBottom: 16,
    zIndex: 4,
    width: 248,
    borderRadius: 21,
    borderWidth: 1.2,
    borderColor: "#60A5FA",
    backgroundColor: "#FFFFFF",
    paddingHorizontal: 16,
    paddingVertical: 13,
    shadowColor: "#2563EB",
    shadowOpacity: 0.36,
    shadowRadius: 13,
    shadowOffset: { width: 0, height: 4 },
    elevation: 14,
  },
  personalizationCoachBubbleText: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "700",
    color: "#172033",
    letterSpacing: -0.12,
  },
  personalizationCoachBubbleEmphasis: {
    color: "#2563EB",
    fontWeight: "800",
  },
  personalizationCoachBubbleTail: {
    position: "absolute",
    bottom: -7,
    left: 56,
    width: 14,
    height: 14,
    borderRightWidth: 1.2,
    borderBottomWidth: 1.2,
    borderColor: "#60A5FA",
    backgroundColor: "#FFFFFF",
    transform: [{ rotate: "45deg" }],
  },
  personalizationCoachTapLayer: {
    position: "absolute",
    top: -520,
    right: -32,
    bottom: -1000,
    left: -32,
    zIndex: 5,
    backgroundColor: "transparent",
  },
  insightsLockedOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
  },
  insightsLockedTint: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(255,255,255,0.34)",
  },
  insightsLockedBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(15,23,42,0.08)",
    backgroundColor: "rgba(255,255,255,0.82)",
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  insightsLockedBadgeText: {
    fontSize: 13,
    lineHeight: 16,
    fontWeight: "700",
    color: "#0F172A",
  },
  secondaryNoteCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "rgba(217,119,6,0.14)",
    backgroundColor: "rgba(255,244,229,0.75)",
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  secondaryNoteInlineWrap: {
    paddingHorizontal: 10,
    paddingTop: 10,
    paddingBottom: 6,
  },
  secondaryNoteIconWrap: {
    width: 28,
    height: 28,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.62)",
  },
  secondaryNoteCopy: {
    flex: 1,
    gap: 4,
  },
  secondaryNoteTitle: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "700",
    color: "#9A5B0A",
    letterSpacing: -0.18,
  },
  secondaryNoteBody: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "500",
    color: "#8A5A14",
    letterSpacing: -0.15,
  },
  rowPressable: {
    minHeight: 70,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 14,
    gap: 16,
    borderRadius: 24,
  },
  rowBlockExpanded: {
    overflow: "hidden",
  },
  rowIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.5)",
    shadowColor: "#000000",
    shadowOpacity: 0.1,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
  },
  rowCopy: {
    flex: 1,
    minHeight: 41,
    justifyContent: "center",
  },
  rowTitle: {
    fontSize: 15,
    lineHeight: 20.625,
    fontWeight: "500",
    color: "#0B1E36",
    letterSpacing: -0.23,
  },
  rowSubtitle: {
    marginTop: 4,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "500",
    color: "#64748B",
    letterSpacing: -0.1,
  },
  chevronWrap: {
    width: 20,
    height: 20,
    alignItems: "center",
    justifyContent: "center",
    transform: [{ rotate: "0deg" }],
    marginTop: 1,
  },
  chevronWrapExpanded: {
    transform: [{ rotate: "180deg" }],
  },
  expandedWrap: {
    paddingLeft: 72,
    paddingRight: 22,
    paddingBottom: 12,
    paddingTop: 10,
    gap: 7.998,
  },
  expandedLine: {
    maxWidth: 182,
    fontSize: 14,
    lineHeight: 19.25,
    fontWeight: "400",
    color: "#475569",
    letterSpacing: -0.15,
  },
  goalCoverageLine: {
    fontSize: 14,
    lineHeight: 19.25,
    fontWeight: "400",
    color: "#475569",
    letterSpacing: -0.15,
  },
  goalCoverageLineWrap: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    columnGap: 10,
    borderRadius: 16,
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderWidth: 1,
  },
  goalCoverageAccent: {
    width: 4,
    alignSelf: "stretch",
    borderRadius: 999,
  },
  goalCoverageCopy: {
    flex: 1,
    minWidth: 0,
  },
  goalCoverageGoalLabel: {
    fontSize: 14,
    lineHeight: 18.5,
    fontWeight: "600",
    color: "#1E293B",
    letterSpacing: -0.15,
  },
  goalCoverageStateChip: {
    minHeight: 24,
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 4,
    justifyContent: "center",
    borderWidth: 1,
  },
  goalCoverageStateText: {
    fontSize: 12,
    lineHeight: 14,
    fontWeight: "700",
    letterSpacing: -0.1,
  },
  goalCoverageStateChipStrong: {
    backgroundColor: "#EAF5F0",
    borderColor: "rgba(30,123,85,0.12)",
  },
  goalCoverageStateChipSome: {
    backgroundColor: "#EEF4FB",
    borderColor: "rgba(49,92,140,0.12)",
  },
  goalCoverageStateChipLimited: {
    backgroundColor: "#FFF4E5",
    borderColor: "rgba(180,83,9,0.12)",
  },
  goalCoverageStateChipNone: {
    backgroundColor: "#F1F5F9",
    borderColor: "rgba(100,116,139,0.12)",
  },
  goalCoverageStateChipUnknown: {
    backgroundColor: "#F8FAFC",
    borderColor: "rgba(148,163,184,0.16)",
  },
  goalCoverageCardStrong: {
    backgroundColor: "rgba(234,245,240,0.55)",
    borderColor: "rgba(30,123,85,0.14)",
  },
  goalCoverageCardSome: {
    backgroundColor: "rgba(238,244,251,0.72)",
    borderColor: "rgba(49,92,140,0.14)",
  },
  goalCoverageCardLimited: {
    backgroundColor: "rgba(255,244,229,0.8)",
    borderColor: "rgba(180,83,9,0.16)",
  },
  goalCoverageCardNone: {
    backgroundColor: "rgba(241,245,249,0.85)",
    borderColor: "rgba(148,163,184,0.16)",
  },
  goalCoverageCardUnknown: {
    backgroundColor: "rgba(248,250,252,0.92)",
    borderColor: "rgba(203,213,225,0.32)",
  },
  goalCoverageAccentStrong: {
    backgroundColor: "#1E7B55",
  },
  goalCoverageAccentSome: {
    backgroundColor: "#315C8C",
  },
  goalCoverageAccentLimited: {
    backgroundColor: "#B45309",
  },
  goalCoverageAccentNone: {
    backgroundColor: "#64748B",
  },
  goalCoverageAccentUnknown: {
    backgroundColor: "#94A3B8",
  },
  goalCoverageStateStrong: {
    color: "#1E7B55",
  },
  goalCoverageStateSome: {
    color: "#315C8C",
  },
  goalCoverageStateLimited: {
    color: "#B45309",
  },
  goalCoverageStateNone: {
    color: "#64748B",
  },
  goalCoverageStateUnknown: {
    color: "#64748B",
  },
  inlineCoverageSection: {
    marginTop: 6,
    marginBottom: 2,
    gap: 4,
  },
  inlineCoverageLabel: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "600",
    color: "#0B1E36",
    letterSpacing: -0.18,
  },
  inlineCoveragePreview: {
    fontSize: 12.5,
    lineHeight: 17,
    fontWeight: "500",
    color: "#64748B",
    letterSpacing: -0.12,
  },
  inlineCoverageSubtitle: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "500",
    color: "#64748B",
    letterSpacing: -0.1,
  },
  goalCoverageActionWrap: {
    marginTop: 12,
    alignSelf: "flex-start",
    borderRadius: 999,
    backgroundColor: "rgba(37,99,235,0.08)",
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  goalCoverageActionText: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "600",
    color: "#2563EB",
    letterSpacing: -0.2,
  },
  divider: {
    marginHorizontal: 28,
    height: 1,
  },
});

export default AnalysisTopSectionRedesign;
