import { Config } from '@/constants/Config';
import type {
  AiSupplementAnalysis,
  AiSupplementAnalysisSuccess,
  SearchItem,
} from '../backend/src/types';

export type BarcodeSearchItem = SearchItem;
export type BarcodeAnalysis = AiSupplementAnalysis;
export type BarcodeAnalysisSuccess = AiSupplementAnalysisSuccess;

export type SearchResponseOk = {
  status: 'ok';
  barcode: string;
  items: BarcodeSearchItem[];
};

export type SearchResponseNotFound = {
  status: 'not_found';
  barcode: string;
  items: [];
};

export type SearchResponse = SearchResponseOk | SearchResponseNotFound;

export type EnrichResponseOk = {
  status: 'ok';
  barcode: string;
  analysis: BarcodeAnalysis;
};

export type EnrichResponseError = {
  error: string;
  detail?: string;
};

const getSearchApiBase = (): string => {
  const apiBase = Config.searchApiBaseUrl?.replace(/\/$/, '');
  if (!apiBase) {
    throw new Error('Search API base URL is not configured.');
  }
  return apiBase;
};

export const fetchSearchByBarcode = async (barcode: string): Promise<SearchResponse> => {
  const apiBase = getSearchApiBase();
  const response = await fetch(`${apiBase}/api/search-by-barcode?code=${encodeURIComponent(barcode)}`);
  const payload = (await response.json()) as SearchResponse | EnrichResponseError;

  if (!response.ok || 'error' in payload) {
    const detail = 'detail' in payload ? payload.detail : undefined;
    throw new Error(detail || payload.error || 'Search backend error');
  }

  return payload as SearchResponse;
};

export const fetchEnrichedSupplement = async (
  barcode: string,
  items: BarcodeSearchItem[],
): Promise<BarcodeAnalysis> => {
  const apiBase = getSearchApiBase();
  const response = await fetch(`${apiBase}/api/enrich-supplement`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ barcode, items }),
  });

  const payload = (await response.json()) as EnrichResponseOk | EnrichResponseError;
  if (!response.ok || 'error' in payload) {
    const detail = 'detail' in payload ? payload.detail : undefined;
    throw new Error(detail || payload.error || 'LLM enrichment failed');
  }

  return payload.analysis;
};

export type BarcodeScanResult =
  | (SearchResponseOk & { analysis: BarcodeAnalysis | null })
  | (SearchResponseNotFound & { analysis: null });

export const analyzeBarcode = async (barcode: string): Promise<BarcodeScanResult> => {
  const search = await fetchSearchByBarcode(barcode);

  if (search.status === 'not_found' || search.items.length === 0) {
    return { ...search, items: [], analysis: null };
  }

  let analysis: BarcodeAnalysis | null = null;
  try {
    analysis = await fetchEnrichedSupplement(search.barcode, search.items);
  } catch (error) {
    console.warn('[search-agent] enrichment failed', error);
  }

  return {
    status: 'ok',
    barcode: search.barcode,
    items: search.items,
    analysis,
  } satisfies BarcodeScanResult;
};
