import React, { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";

import { ExternalLink } from "@/components/external-link";
import { useTranslation } from "@/lib/i18n";
import { lookupFoundationForIngredient } from "@/lib/knowledge/foundationLookup";

type Props = {
  ingredientName: string;
  variant: "full" | "watch_outs_only";
  maxBullets?: number;
  maxWatchOuts?: number;
};

export function OdsFoundationPanel({
  ingredientName,
  variant,
  maxBullets = 3,
  maxWatchOuts = 3,
}: Props) {
  const { t } = useTranslation();
  const hit = useMemo(() => lookupFoundationForIngredient(ingredientName), [ingredientName]);
  if (hit.kind === "miss") return null;

  const badgeText = hit.kind === "ods" ? t.analysisSourceOds : t.analysisFoundationBadgeCurated;
  const overview = typeof hit.overview === "string" ? hit.overview.trim() : "";
  const whatItDoes = (Array.isArray(hit.whatItDoes) ? hit.whatItDoes : []).filter(Boolean).slice(0, maxBullets);
  const watchOuts = (Array.isArray(hit.watchOuts) ? hit.watchOuts : []).filter(Boolean).slice(0, maxWatchOuts);

  const showOverview = variant === "full" && Boolean(overview);
  const showWhatItDoes = variant === "full" && whatItDoes.length > 0;
  const showWatchOuts = watchOuts.length > 0;

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>{t.analysisFoundationTitle}</Text>
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{badgeText}</Text>
        </View>
      </View>

      <Text style={styles.disclaimer}>{t.analysisGeneralBackgroundDisclaimer}</Text>

      {showOverview ? <Text style={styles.paragraph}>{overview}</Text> : null}

      {showWhatItDoes ? (
        <View style={{ gap: 6 }}>
          <Text style={styles.sectionTitle}>{t.analysisFoundationWhatItDoes}</Text>
          {whatItDoes.map((line) => (
            <Text key={line} style={styles.bullet}>
              {"\u2022"} {line}
            </Text>
          ))}
        </View>
      ) : null}

      {showWatchOuts ? (
        <View style={{ gap: 6 }}>
          <Text style={styles.sectionTitle}>{t.analysisFoundationWatchOuts}</Text>
          {watchOuts.map((line) => (
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
