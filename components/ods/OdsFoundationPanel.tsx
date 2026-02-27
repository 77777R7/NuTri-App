import React, { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";

import { ExternalLink } from "@/components/external-link";
import { useTranslation } from "@/lib/i18n";
import { lookupFoundationForIngredient } from "@/lib/knowledge/foundationLookup";
import { resolveOdsPanelSections, type OdsPanelMode } from "@/lib/scan/odsPanelMode";

type Props = {
  ingredientName?: string | null;
  mode: OdsPanelMode;
  interactionLines?: string[];
  ulLines?: string[];
  maxBullets?: number;
  maxWatchOuts?: number;
};

export function OdsFoundationPanel({
  ingredientName,
  mode,
  interactionLines = [],
  ulLines = [],
  maxBullets = 3,
  maxWatchOuts = 3,
}: Props) {
  const { t } = useTranslation();
  const normalizedName = typeof ingredientName === "string" ? ingredientName.trim() : "";
  const hit = useMemo(() => lookupFoundationForIngredient(normalizedName), [normalizedName]);
  if (!normalizedName) return null;
  if (hit.kind === "miss") return null;

  const badgeText = hit.kind === "ods" ? t.analysisSourceOds : t.analysisFoundationBadgeCurated;
  const overview = typeof hit.overview === "string" ? hit.overview.trim() : "";
  const whatItDoes = (Array.isArray(hit.whatItDoes) ? hit.whatItDoes : []).filter(Boolean).slice(0, maxBullets);
  const watchOuts = (Array.isArray(hit.watchOuts) ? hit.watchOuts : []).filter(Boolean).slice(0, maxWatchOuts);
  const interactions = interactionLines
    .filter((line): line is string => typeof line === "string" && line.trim().length > 0)
    .slice(0, maxWatchOuts);
  const ulSignals = ulLines
    .filter((line): line is string => typeof line === "string" && line.trim().length > 0)
    .slice(0, maxWatchOuts);

  const sections = resolveOdsPanelSections({
    mode,
    hasOverview: Boolean(overview),
    whatItDoesCount: whatItDoes.length,
    watchOutsCount: watchOuts.length,
    interactionCount: interactions.length,
    ulCount: ulSignals.length,
  });
  const title = mode === "safety" ? "General watch-outs" : t.analysisFoundationTitle;
  const disclaimer =
    mode === "safety"
      ? "General safety context — not product label warnings."
      : t.analysisGeneralBackgroundDisclaimer;

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>{title}</Text>
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{badgeText}</Text>
        </View>
      </View>

      <Text style={styles.disclaimer}>{disclaimer}</Text>

      {sections.showOverview ? <Text style={styles.paragraph}>{overview}</Text> : null}

      {sections.showWhatItDoes ? (
        <View style={{ gap: 6 }}>
          <Text style={styles.sectionTitle}>{t.analysisFoundationWhatItDoes}</Text>
          {whatItDoes.map((line) => (
            <Text key={line} style={styles.bullet}>
              {"\u2022"} {line}
            </Text>
          ))}
        </View>
      ) : null}

      {sections.showWatchOuts ? (
        <View style={{ gap: 6 }}>
          <Text style={styles.sectionTitle}>{t.analysisFoundationWatchOuts}</Text>
          {watchOuts.map((line) => (
            <Text key={line} style={styles.bullet}>
              {"\u2022"} {line}
            </Text>
          ))}
        </View>
      ) : null}

      {sections.showInteractions ? (
        <View style={{ gap: 6 }}>
          <Text style={styles.sectionTitle}>Interactions</Text>
          {interactions.map((line) => (
            <Text key={line} style={styles.bullet}>
              {"\u2022"} {line}
            </Text>
          ))}
        </View>
      ) : null}

      {sections.showUl ? (
        <View style={{ gap: 6 }}>
          <Text style={styles.sectionTitle}>UL guidance</Text>
          {ulSignals.map((line) => (
            <Text key={line} style={styles.bullet}>
              {"\u2022"} {line}
            </Text>
          ))}
        </View>
      ) : null}

      {hit.title ? (
        hit.sourceUrl ? (
          <ExternalLink href={hit.sourceUrl} style={styles.ctaBtn}>
            <Text style={styles.ctaText}>{hit.title}</Text>
          </ExternalLink>
        ) : (
          <View style={styles.ctaBtn}>
            <Text style={styles.ctaText}>{hit.title}</Text>
          </View>
        )
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: "#FFFBEB",
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: "#FDE68A",
    borderLeftWidth: 4,
    borderLeftColor: "#F59E0B",
    gap: 10,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  title: {
    fontSize: 13,
    fontWeight: "800",
    color: "#92400E",
    flexShrink: 1,
  },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: "rgba(245,158,11,0.12)",
    borderWidth: 1,
    borderColor: "rgba(245,158,11,0.25)",
  },
  badgeText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#92400E",
  },
  disclaimer: {
    fontSize: 12,
    lineHeight: 18,
    color: "#78350F",
    fontWeight: "600",
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: "800",
    color: "#92400E",
  },
  paragraph: {
    fontSize: 13,
    lineHeight: 20,
    color: "#78350F",
  },
  bullet: {
    fontSize: 13,
    lineHeight: 20,
    color: "#78350F",
  },
  ctaBtn: {
    marginTop: 4,
    alignSelf: "flex-start",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.65)",
    borderWidth: 1,
    borderColor: "rgba(245,158,11,0.35)",
  },
  ctaText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#92400E",
  },
});
