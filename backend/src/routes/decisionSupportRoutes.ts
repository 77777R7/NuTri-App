import type { Express, NextFunction, Request, RequestHandler, Response } from "express";

import type { NormalizedBarcode } from "../barcode.js";

type DecisionSupportRoutePayload = {
  digest: string;
  decisionInputsHash: string;
  decisionContractVersion?: unknown;
  overlayClaimsHash?: unknown;
  overlayAugmentationVersion?: unknown;
  overlayAugmentationSource?: unknown;
  patchActivationCanonical?: unknown;
  rubricVersion?: unknown;
  categoryId?: unknown;
  categoryProfileVersion?: unknown;
  viewMode?: unknown;
  verdict?: unknown;
  verdictReason?: unknown;
  subscores?: unknown;
  checklist?: unknown;
  blockers?: unknown;
  topBlockers?: unknown;
  extraTrustSignals?: unknown;
  sourceTiers?: unknown;
  nutriScoreCardV2?: unknown;
  overviewBlock?: unknown;
  scienceBlock?: unknown;
  usageBlock?: unknown;
  safetyBlock?: unknown;
  personalizedResultLane?: Record<string, unknown>;
  qualityMark?: unknown;
  decisionDebug?: unknown;
};

type DecisionSupportRouteAuthorityBundle = {
  overlayClaims: unknown;
  quickDigest: {
    factsDigestHash: string;
    digest?: {
      identity?: {
        value?: unknown;
        type?: unknown;
      } | null;
      sourceType?: unknown;
    } | null;
  };
  patched: {
    digest: {
      sourceType?: unknown;
    };
    activation: Record<string, unknown>;
  };
  decisionSupport: DecisionSupportRoutePayload;
  personalizationScopeHash: string;
};

type BuildDecisionSupportComparisonStanding = (params: {
  barcodeGtin14: string;
  overlayClaims: unknown;
  digest: unknown;
  decisionSupport: DecisionSupportRoutePayload;
}) => Promise<unknown | null>;

export type DecisionSupportRoutesDependencies = {
  verifySupabaseToken: RequestHandler;
  normalizeBarcodeInput: (value: string) => NormalizedBarcode | null;
  parseDecisionSupportViewMode: (value: string | null | undefined) => unknown;
  parseDebugDecisionRequested: (req: Request) => boolean;
  recordDecisionSupportFetch: (scanSessionId: string | null, barcodeGtin14: string) => number | undefined;
  buildDecisionSupportAuthorityBundle: (
    normalizedBarcode: NormalizedBarcode,
    options: {
      req: Request;
      viewMode: unknown;
    },
  ) => Promise<DecisionSupportRouteAuthorityBundle>;
  buildDecisionSupportComparisonStanding: BuildDecisionSupportComparisonStanding;
  buildDecisionSupportDigestMismatchPayload: (
    latestDigest: string,
    latestDecisionInputsHash: string,
    latestPersonalizationScopeHash: string,
  ) => unknown;
  getPatchShadowLookup: (params: { barcodeGtin14: string; identityKeys: string[] }) => unknown;
  incrementMetric: (metricName: string) => void;
  allowDebugFields: (req: Request) => boolean;
  captureException: (error: unknown, context?: Record<string, unknown>) => void;
};

const hasRequestHandlerShape = (handler: RequestHandler): handler is RequestHandler =>
  typeof handler === "function";

export const registerDecisionSupportRoutes = (
  app: Express,
  deps: DecisionSupportRoutesDependencies,
): void => {
  if (!hasRequestHandlerShape(deps.verifySupabaseToken)) {
    throw new Error("verifySupabaseToken dependency is required");
  }

  app.get("/api/decision-support/v1", deps.verifySupabaseToken, async (req: Request, res: Response, _next: NextFunction) => {
    const barcodeRaw = typeof req.query.barcode === "string" ? req.query.barcode.trim() : "";
    const normalizedBarcode = deps.normalizeBarcodeInput(barcodeRaw);
    if (!normalizedBarcode) {
      return res
        .status(400)
        .json({ error: "invalid_request", detail: "barcode is required" });
    }

    const requestedDigestRaw = typeof req.query.digest === "string" ? req.query.digest.trim() : "";
    const requestedDigest = requestedDigestRaw.length > 0 ? requestedDigestRaw : null;
    const requestedDecisionInputsHashRaw =
      typeof req.query.decisionInputsHash === "string" ? req.query.decisionInputsHash.trim() : "";
    const requestedDecisionInputsHash =
      requestedDecisionInputsHashRaw.length > 0 ? requestedDecisionInputsHashRaw : null;
    const scanSessionIdRaw = typeof req.query.scanSessionId === "string" ? req.query.scanSessionId.trim() : "";
    const scanSessionId = scanSessionIdRaw.length > 0 ? scanSessionIdRaw : null;
    const viewMode = deps.parseDecisionSupportViewMode(
      typeof req.query.viewMode === "string" ? req.query.viewMode : null,
    );
    const debugPatchRequested = (() => {
      const raw = req.query.debugPatch;
      if (Array.isArray(raw)) return raw.some((value) => String(value).trim() === "1");
      return String(raw ?? "").trim() === "1";
    })();
    const debugDecisionRequested = deps.parseDebugDecisionRequested(req);

    try {
      const barcodeGtin14 = normalizedBarcode.code.padStart(14, "0");
      const fetchCount = deps.recordDecisionSupportFetch(scanSessionId, barcodeGtin14);
      const authority = await deps.buildDecisionSupportAuthorityBundle(normalizedBarcode, { req, viewMode });
      const { overlayClaims, quickDigest, patched, decisionSupport, personalizationScopeHash } = authority;
      const debugIdentityValue = String(quickDigest.digest?.identity?.value ?? "").trim();
      const debugIdentityType = String(quickDigest.digest?.identity?.type ?? "").trim().toLowerCase();
      const debugSourceType = String(quickDigest.digest?.sourceType ?? "").trim().toLowerCase();
      const debugIdentityKeys = [
        debugSourceType && debugIdentityValue ? `${debugSourceType}:${debugIdentityValue}`.toLowerCase() : null,
        debugIdentityType && debugIdentityValue ? `${debugIdentityType}:${debugIdentityValue}`.toLowerCase() : null,
      ].filter((value): value is string => Boolean(value));
      const debugLookup = deps.getPatchShadowLookup({
        barcodeGtin14,
        identityKeys: debugIdentityKeys,
      });

      if (
        requestedDecisionInputsHash &&
        requestedDecisionInputsHash !== decisionSupport.decisionInputsHash
      ) {
        deps.incrementMetric("decision_inputs_hash_mismatch");
        console.warn("[telemetry] decision_inputs_hash_mismatch", {
          barcode: barcodeGtin14,
          scanSessionId,
          requestedDecisionInputsHash,
          latestDecisionInputsHash: decisionSupport.decisionInputsHash,
          latestDigest: decisionSupport.digest,
        });
      }

      if (requestedDigest && requestedDigest !== decisionSupport.digest) {
        deps.incrementMetric("decision_support_digest_mismatch");
        console.warn("[telemetry] decision_support_digest_mismatch", {
          barcode: barcodeGtin14,
          scanSessionId,
          requestedDigest,
          latestDigest: decisionSupport.digest,
          requestedDecisionInputsHash,
          latestDecisionInputsHash: decisionSupport.decisionInputsHash,
        });
        return res.status(409).json(
          deps.buildDecisionSupportDigestMismatchPayload(
            decisionSupport.digest,
            decisionSupport.decisionInputsHash,
            personalizationScopeHash,
          ),
        );
      }

      const comparisonStanding = await deps.buildDecisionSupportComparisonStanding({
        barcodeGtin14,
        overlayClaims,
        digest: patched.digest,
        decisionSupport,
      });
      const decisionSupportWithComparison: DecisionSupportRoutePayload = comparisonStanding
        ? {
          ...decisionSupport,
          personalizedResultLane: {
            ...decisionSupport.personalizedResultLane,
            productStanding: comparisonStanding,
          },
        }
        : decisionSupport;

      const allowPatchDebug = deps.allowDebugFields(req);
      const allowDecisionDebug = allowPatchDebug && debugDecisionRequested;
      return res.json({
        status: "ok",
        barcode: barcodeGtin14,
        sourceType: patched.digest.sourceType,
        factsDigestHash: quickDigest.factsDigestHash,
        digest: decisionSupportWithComparison.digest,
        decisionSupportDigest: decisionSupportWithComparison.digest,
        decisionInputsHash: decisionSupportWithComparison.decisionInputsHash,
        personalizationScopeHash,
        decisionContractVersion: decisionSupportWithComparison.decisionContractVersion,
        overlayClaimsHash: decisionSupportWithComparison.overlayClaimsHash,
        overlayAugmentationVersion: decisionSupportWithComparison.overlayAugmentationVersion,
        overlayAugmentationSource: decisionSupportWithComparison.overlayAugmentationSource,
        patchActivationCanonical: decisionSupportWithComparison.patchActivationCanonical,
        rubricVersion: decisionSupportWithComparison.rubricVersion,
        categoryId: decisionSupportWithComparison.categoryId,
        categoryProfileVersion: decisionSupportWithComparison.categoryProfileVersion,
        viewMode: decisionSupportWithComparison.viewMode,
        verdict: decisionSupportWithComparison.verdict,
        verdictReason: decisionSupportWithComparison.verdictReason,
        subscores: decisionSupportWithComparison.subscores,
        checklist: decisionSupportWithComparison.checklist,
        blockers: decisionSupportWithComparison.blockers,
        topBlockers: decisionSupportWithComparison.topBlockers,
        extraTrustSignals: decisionSupportWithComparison.extraTrustSignals,
        sourceTiers: decisionSupportWithComparison.sourceTiers,
        nutriScoreCardV2: decisionSupportWithComparison.nutriScoreCardV2,
        overviewBlock: decisionSupportWithComparison.overviewBlock,
        scienceBlock: decisionSupportWithComparison.scienceBlock,
        usageBlock: decisionSupportWithComparison.usageBlock,
        safetyBlock: decisionSupportWithComparison.safetyBlock,
        personalizedResultLane: decisionSupportWithComparison.personalizedResultLane,
        qualityMark: decisionSupportWithComparison.qualityMark,
        ...(typeof fetchCount === "number" ? { decisionSupportFetchCount: fetchCount } : {}),
        ...(allowDecisionDebug && decisionSupportWithComparison.decisionDebug
          ? {
            decisionDebug: decisionSupportWithComparison.decisionDebug,
          }
          : {}),
        ...(debugPatchRequested && allowPatchDebug
          ? {
            patchDebug: {
              ...patched.activation,
              digestIdentityKeys: debugIdentityKeys,
              lookup: debugLookup,
            },
          }
          : {}),
      });
    } catch (error) {
      deps.captureException(error, { route: "/api/decision-support/v1" });
      const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      return res.status(500).json({ error: "unexpected_error", detail });
    }
  });
};
