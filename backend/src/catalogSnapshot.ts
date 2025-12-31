import type { NormalizedBarcode } from "./barcode.js";
import type { SupplementSnapshot } from "./schemas/supplementSnapshot.js";
import { buildBarcodeSnapshot, validateSnapshotOrFallback } from "./snapshot.js";
import type { CatalogResolved } from "./catalogResolver.js";

function addClaimSignal(snapshot: SupplementSnapshot, programCode: string, payload: Record<string, unknown>) {
  snapshot.trust.signals.push({
    programCode,
    status: "claimed",
    evidenceUrl: null,
    evidencePayloadSummary: payload,
    evidenceRef: null,
    source: "label",
    lastCheckedAt: snapshot.createdAt,
    expiresAt: null,
  });
}

export function buildCatalogBarcodeSnapshot(params: {
  barcodeRaw: string;
  normalized: NormalizedBarcode;
  catalog: CatalogResolved;
}): SupplementSnapshot {
  const category = params.catalog.category ?? params.catalog.categoryRaw ?? null;
  const image = params.catalog.imageUrl ?? null;

  const candidate = buildBarcodeSnapshot({
    barcode: params.barcodeRaw,
    productInfo: {
      brand: params.catalog.brand,
      name: params.catalog.productName,
      category,
      image,
    },
    sources: [],
    efficacy: null,
    safety: null,
    usagePayload: null,
  });

  // Catalog 命中即视为 resolved（即使没有 AI 分析/分数）
  candidate.status = "resolved";

  // 用 Catalog 的 gtin14 作为 normalized（保证全系统一致）
  candidate.product.barcode.normalized = params.catalog.barcodeGtin14;
  candidate.product.barcode.normalizedFormat = "gtin14";
  candidate.product.barcode.variants = params.normalized.variants;

  // 绑定 DSLD label id（未来做证据链/溯源很关键）
  candidate.regulatory.dsldLabelId = params.catalog.dsldLabelId ? String(params.catalog.dsldLabelId) : null;

  // 可选：把“可信度/认证”作为 claimed 信号写入（不做 verified，保证准确性优先）
  if (params.catalog.cgmpCompliance) {
    addClaimSignal(candidate, "CGMP", { value: params.catalog.cgmpCompliance });
  }
  if (params.catalog.nsfCertifiedForSport) {
    addClaimSignal(candidate, "NSF_CERTIFIED_FOR_SPORT", { value: true });
  }
  if (params.catalog.informedSport) {
    addClaimSignal(candidate, "INFORMED_SPORT", { value: true });
  }
  if (params.catalog.ifosFishOil) {
    addClaimSignal(candidate, "IFOS", { value: true });
  }
  if (params.catalog.thirdPartyTesting) {
    addClaimSignal(candidate, "THIRD_PARTY_TESTING", { value: params.catalog.thirdPartyTesting });
  }
  if (candidate.trust.signals.length > 0 && candidate.trust.overallStatus === "unknown") {
    candidate.trust.overallStatus = "claimed";
  }

  return validateSnapshotOrFallback({
    candidate,
    fallback: {
      source: "barcode",
      barcodeRaw: params.barcodeRaw,
      productInfo: {
        brand: params.catalog.brand ?? null,
        name: params.catalog.productName ?? null,
        category,
        imageUrl: image,
      },
      createdAt: candidate.createdAt,
    },
  });
}
