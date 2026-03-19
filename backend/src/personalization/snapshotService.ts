import type {
  ExplanationPayload,
  ExplanationResult,
  ExplanationSurface,
  PersonalizationSnapshot,
} from "../../../types/personalization";
import {
  buildExplanationPayload,
  createPersonalizationExplanationService,
  type PersonalizationExplainer,
} from "./ai.js";
import { createDeepSeekPersonalizationExplainer } from "./explainers/deepseekExplainer.js";

export type SnapshotExplanationResponse = {
  payload: ExplanationPayload;
  result: ExplanationResult;
};

export type SnapshotExplanationService = {
  buildPayload(snapshot: PersonalizationSnapshot, surface: ExplanationSurface): ExplanationPayload;
  explain(snapshot: PersonalizationSnapshot, surface: ExplanationSurface): Promise<SnapshotExplanationResponse>;
};

export const createSnapshotExplanationService = (
  explainer: PersonalizationExplainer = createDeepSeekPersonalizationExplainer(),
): SnapshotExplanationService => {
  const service = createPersonalizationExplanationService(explainer);

  return {
    buildPayload: service.buildPayload,
    explain: (snapshot, surface) => service.explainSnapshot(snapshot, surface),
  };
};

export const snapshotExplanationServiceInternals = {
  buildExplanationPayload,
};
