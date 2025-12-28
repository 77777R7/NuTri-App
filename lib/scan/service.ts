import type { BarcodeScanResult } from '@/lib/search-agent';
import { analyzeBarcode } from '@/lib/search-agent';
import { Config } from '@/constants/Config';
import type { AiSupplementAnalysis } from '@/backend/src/types';
import type { LabelDraft } from '@/backend/src/labelAnalysis';

export type { BarcodeAnalysis, BarcodeScanResult } from '@/lib/search-agent';

export type LabelScanResult = {
  imageUri: string;
  imageHash: string;
  status: 'ok' | 'needs_confirmation' | 'failed';
  draft?: LabelDraft;
  analysis?: AiSupplementAnalysis | null;
  analysisStatus?: 'complete' | 'partial' | 'skipped' | 'pending' | 'unavailable' | 'failed';
  analysisIssues?: string[];
  message?: string;
  suggestion?: string;
  issues?: { type: string; message: string }[];
};

type AnalyzeLabelResponse = Omit<LabelScanResult, 'imageUri' | 'imageHash'>;

export async function submitBarcodeScan(barcode: string): Promise<BarcodeScanResult> {
  return analyzeBarcode(barcode);
}

const getSearchApiBase = (): string => {
  const apiBase = Config.searchApiBaseUrl?.replace(/\/$/, '');
  if (!apiBase) {
    throw new Error('Search API base URL is not configured.');
  }
  return apiBase;
};

const computeImageHash = (base64: string): string => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < base64.length; i++) {
    hash ^= base64.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  const normalized = (hash >>> 0).toString(16).padStart(8, '0');
  return `${normalized}-${base64.length}`;
};

export async function submitLabelScan(input: {
  imageUri: string;
  imageBase64: string;
  deviceId?: string;
  includeAnalysis?: boolean;
}): Promise<LabelScanResult> {
  const apiBase = getSearchApiBase();
  const imageHash = computeImageHash(input.imageBase64);
  const includeAnalysis = input.includeAnalysis === true;
  const endpoint = includeAnalysis
    ? `${apiBase}/api/analyze-label?includeAnalysis=1`
    : `${apiBase}/api/analyze-label`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      imageBase64: input.imageBase64,
      imageHash,
      deviceId: input.deviceId,
      includeAnalysis,
    }),
  });

  const payload = (await response.json().catch(() => null)) as AnalyzeLabelResponse | null;
  if (!response.ok) {
    const message = payload?.message ?? `OCR request failed (${response.status})`;
    throw new Error(message);
  }

  if (!payload?.status) {
    throw new Error('Invalid OCR response');
  }

  return {
    ...payload,
    imageUri: input.imageUri,
    imageHash,
  };
}

export async function requestLabelAnalysis(input: {
  imageHash: string;
  imageBase64?: string;
  deviceId?: string;
}): Promise<AnalyzeLabelResponse> {
  const apiBase = getSearchApiBase();
  const response = await fetch(`${apiBase}/api/analyze-label?includeAnalysis=1`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      imageHash: input.imageHash,
      imageBase64: input.imageBase64,
      deviceId: input.deviceId,
      includeAnalysis: true,
    }),
  });

  const payload = (await response.json().catch(() => null)) as AnalyzeLabelResponse | null;
  if (!response.ok) {
    const message = payload?.message ?? `Analysis request failed (${response.status})`;
    throw new Error(message);
  }

  if (!payload?.status) {
    throw new Error('Invalid analysis response');
  }

  return payload;
}
