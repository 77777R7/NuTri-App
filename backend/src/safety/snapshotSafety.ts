import type { DsldFactsInput, FactsDigest, LnhpdFactsInput } from "../factsDigest.js";
import {
  buildFactsDigestFromDsld,
  buildFactsDigestFromLnhpd,
  buildFactsDigestFromWeb,
} from "../factsDigest.js";
import { normalizeNpnValue } from "../npnCandidates.js";
import type { SupplementSnapshot } from "../schemas/supplementSnapshot.js";
import type { DailyDoseBasisReason } from "./types.js";
import { buildLabelDirectionsTextFromDigest, deriveDailyDoseBasis } from "./dailyDoseBasis.js";

const LNHPD_RUNTIME_ENABLED = String(process.env.LNHPD_RUNTIME_ENABLED ?? "true").toLowerCase() !== "false";

const buildLnhpdFactsInputFromSnapshot = (snapshot: SupplementSnapshot): LnhpdFactsInput => ({
  brandName: snapshot.product.brand ?? null,
  productName: snapshot.product.name ?? null,
  npn: snapshot.regulatory.npn ?? null,
  servingSize: snapshot.label.servingSize ?? null,
  servingsPerContainer: snapshot.label.servingsPerContainer ?? null,
  actives: snapshot.label.actives.map((item) => ({
    name: item.name,
    amount: item.amount ?? null,
    unit: item.amountUnitNormalized ?? item.amountUnit ?? null,
    formRaw: item.form ?? null,
  })),
  inactive: snapshot.label.inactive.map((item) => item.name),
  purposes: [],
  routes: [],
  doses: [],
  datasetVersion: snapshot.analysis?.labelExtraction?.datasetVersion ?? null,
  extractedAt: snapshot.analysis?.labelExtraction?.fetchedAt ?? null,
});

const buildDsldFactsInputFromSnapshot = (snapshot: SupplementSnapshot): DsldFactsInput => ({
  brandName: snapshot.product.brand ?? null,
  productName: snapshot.product.name ?? null,
  servingSize: snapshot.label.servingSize ?? null,
  servingsPerContainer: snapshot.label.servingsPerContainer ?? null,
  actives: snapshot.label.actives.map((item) => ({
    name: item.name,
    amount: item.amount ?? null,
    unit: item.amountUnitNormalized ?? item.amountUnit ?? null,
    formRaw: item.form ?? null,
  })),
  inactive: snapshot.label.inactive.map((item) => item.name),
  proprietaryBlends: snapshot.label.proprietaryBlends.map((blend) => ({
    name: blend.name,
    totalAmount: blend.totalAmount ?? null,
    unit: blend.unit ?? null,
    ingredients: blend.ingredients ?? null,
  })),
  datasetVersion: snapshot.analysis?.labelExtraction?.datasetVersion ?? null,
  extractedAt: snapshot.analysis?.labelExtraction?.fetchedAt ?? null,
});

export const buildSnapshotSafetyDigestBundle = (params: {
  snapshot: SupplementSnapshot;
  supplementId: string;
  barcodeGtin14: string | null;
  brandName: string;
  productName: string;
}): {
  digest: FactsDigest;
  labelDirectionsRawText: string | null;
} => {
  const { snapshot, supplementId, barcodeGtin14, brandName, productName } = params;
  const sourceRaw = snapshot.analysis?.labelExtraction?.source ?? null;
  const source = sourceRaw === "label_scan" ? "dsld" : sourceRaw;

  if (source === "dsld") {
    const digest = buildFactsDigestFromDsld({
      facts: buildDsldFactsInputFromSnapshot(snapshot),
      snapshot,
      identityValue: snapshot.regulatory.dsldLabelId ?? (barcodeGtin14 ?? supplementId),
      regionTags: snapshot.regulatory.regionTags,
    });
    return {
      digest,
      labelDirectionsRawText: buildLabelDirectionsTextFromDigest(digest),
    };
  }

  const snapshotNpn = LNHPD_RUNTIME_ENABLED
    ? normalizeNpnValue(snapshot.regulatory.npn ?? null)
    : null;
  if (snapshotNpn) {
    const digest = buildFactsDigestFromLnhpd({
      facts: buildLnhpdFactsInputFromSnapshot(snapshot),
      snapshot,
      identityValue: snapshotNpn,
      regionTags: snapshot.regulatory.regionTags,
    });
    return {
      digest,
      labelDirectionsRawText: buildLabelDirectionsTextFromDigest(digest),
    };
  }

  const digest = buildFactsDigestFromWeb({
    facts: {
      barcode: barcodeGtin14 ?? "",
      canonical: {
        name: snapshot.product.name ?? productName,
        brand: snapshot.product.brand ?? brandName,
        url: null,
        domain: null,
      },
      identifiers: { npn: null },
      textFacts: {
        ingredientsText: null,
        directionsText: null,
        warningsText: null,
        servingSizeText: snapshot.label.servingSize ?? null,
      },
      coverageScore: 0,
      missingFields: [
        "textFacts.ingredientsText",
        "textFacts.directionsText",
        "textFacts.warningsText",
      ],
    },
    snapshot,
    identityType: "webCanonicalId",
    identityValue: barcodeGtin14 ?? supplementId,
    regionTags: snapshot.regulatory.regionTags,
  });
  return {
    digest,
    labelDirectionsRawText: buildLabelDirectionsTextFromDigest(digest),
  };
};

export const buildSnapshotSafetyDoseContext = (params: {
  snapshot: SupplementSnapshot;
  supplementId: string;
  barcodeGtin14: string | null;
  brandName: string;
  productName: string;
  hasUsableActiveDose: boolean;
}): {
  dailyMultiplier: number;
  dailyDoseBasis: "label_daily_estimate" | "one_serving_fallback";
  dailyDoseBasisReason: DailyDoseBasisReason;
  labelDirectionsRawText: string | null;
  digest: FactsDigest;
} => {
  const bundle = buildSnapshotSafetyDigestBundle(params);
  const basis = deriveDailyDoseBasis({
    labelDirectionsRawText: bundle.labelDirectionsRawText,
    hasUsableActiveDose: params.hasUsableActiveDose,
    sourceContext: "snapshot_only",
  });
  return {
    dailyMultiplier: basis.dailyMultiplier,
    dailyDoseBasis: basis.dailyDoseBasis,
    dailyDoseBasisReason: basis.dailyDoseBasisReason,
    labelDirectionsRawText: basis.labelDirectionsRawText,
    digest: bundle.digest,
  };
};
