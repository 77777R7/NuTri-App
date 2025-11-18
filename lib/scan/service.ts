import { Config } from '@/constants/Config';
import { supabase } from '@/lib/supabase';
import type { Database } from '@/types/supabase';

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export type SupplementRecord = Database['public']['Tables']['supplements']['Row'];
export type BrandRecord = Database['public']['Tables']['brands']['Row'];

export type SupplementMatch = SupplementRecord & {
  brand?: BrandRecord | null;
};

const mapSupplement = (record: SupplementRecord & { brands?: BrandRecord | null }): SupplementMatch => {
  const { brands, ...rest } = record;
  return {
    ...rest,
    brand: brands ?? null,
  };
};

const SUPPLEMENT_SELECT = '*, brands(*)';

export type BarcodeSearchItem = {
  title: string;
  snippet: string;
  link: string;
};

export type BarcodeAnalysisSource = {
  title: string;
  link: string;
};

export type BarcodeAnalysisIngredient = {
  name: string;
  amount: string | null;
  unit: string | null;
  notes: string | null;
};

export type BarcodeAnalysis = {
  barcode: string;
  brand: string | null;
  productName: string | null;
  summary: string | null;
  confidence: number;
  ingredients: BarcodeAnalysisIngredient[];
  sources: BarcodeAnalysisSource[];
};

export type BarcodeScanResult =
  | {
      status: 'ok';
      barcode: string;
      items: BarcodeSearchItem[];
      analysis: BarcodeAnalysis | null;
    }
  | {
      status: 'not_found';
      barcode: string;
      items: [];
      analysis: null;
    };

export type LabelScanResult = {
  imageUri: string;
  extractedText: string;
  confidence: number;
  supplements: SupplementMatch[];
};

const extractCandidateNames = (text: string): string[] => {
  return text
    .split(/\r?\n/)
    .map(line => line.replace(/[.,]/g, '').trim())
    .filter(Boolean)
    .filter(line => line.length > 2)
    .slice(0, 5);
};

const performMockOcr = async (imageUri: string) => {
  await sleep(300);
  return {
    extractedText: `Example Vitamin D3\nServing Size 1 Softgel\nAmount Per Serving\nVitamin D3 (as Cholecalciferol) 25 mcg (1000 IU) 125%\nOther Ingredients: Organic Olive Oil, Bovine Gelatin, Vegetable Glycerin.`,
  };
};

type SearchApiItem = {
  title?: unknown;
  snippet?: unknown;
  link?: unknown;
};

type SearchApiResponse =
  | {
      status: 'ok';
      barcode?: string;
      items?: SearchApiItem[];
    }
  | {
    status: 'not_found';
    barcode?: string;
  }
  | {
      error: string;
      detail?: string;
    };

type EnrichApiResponse =
  | {
      status: 'ok';
      barcode: string;
      analysis: BarcodeAnalysis;
    }
  | {
      error: string;
      detail?: string;
    };

const normalizeItems = (items?: SearchApiItem[]): BarcodeSearchItem[] => {
  if (!Array.isArray(items)) {
    return [];
  }

  return items
    .map(item => ({
      title: typeof item?.title === 'string' ? item.title.trim() : '',
      snippet: typeof item?.snippet === 'string' ? item.snippet.trim() : '',
      link: typeof item?.link === 'string' ? item.link.trim() : '',
    }))
    .filter(item => item.title.length > 0 && item.link.length > 0)
    .slice(0, 5);
};

const requestEnrichment = async (
  apiBase: string,
  barcode: string,
  items: BarcodeSearchItem[],
): Promise<BarcodeAnalysis> => {
  const response = await fetch(`${apiBase}/api/enrich-supplement`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ barcode, items }),
  });

  const payload = (await response.json()) as EnrichApiResponse;
  if (!response.ok || 'error' in payload) {
    const detail = 'detail' in payload ? payload.detail : undefined;
    throw new Error(detail || payload.error || 'LLM enrichment failed');
  }

  return payload.analysis;
};

export async function submitBarcodeScan(barcode: string): Promise<BarcodeScanResult> {
  const apiBase = Config.searchApiBaseUrl?.replace(/\/$/, '');
  if (!apiBase) {
    throw new Error('API base URL is not configured.');
  }

  const searchUrl = `${apiBase}/api/search-by-barcode?code=${encodeURIComponent(barcode)}`;
  const response = await fetch(searchUrl);
  let payload: SearchApiResponse | null = null;

  try {
    payload = (await response.json()) as SearchApiResponse;
  } catch (error) {
    console.warn('[scan] unable to parse search response', error);
  }

  if (!response.ok) {
    const detail = payload && 'detail' in payload ? payload.detail : undefined;
    throw new Error(detail ? `Search backend error: ${detail}` : 'Search backend error');
  }

  if (!payload) {
    throw new Error('Invalid search response');
  }

  if ('error' in payload) {
    throw new Error(payload.error || 'Search backend error');
  }

  if (payload.status === 'not_found') {
    return {
      status: 'not_found',
      barcode: payload.barcode ?? barcode,
      items: [],
    };
  }

  if (payload.status === 'ok') {
    const items = normalizeItems(payload.items);
    if (items.length === 0) {
      return {
        status: 'not_found',
        barcode: payload.barcode ?? barcode,
        items: [],
        analysis: null,
      };
    }

    let analysis: BarcodeAnalysis | null = null;
    try {
      analysis = await requestEnrichment(apiBase, payload.barcode ?? barcode, items);
    } catch (error) {
      console.warn('[scan] enrichment failed', error);
    }

    return {
      status: 'ok',
      barcode: payload.barcode ?? barcode,
      items,
      analysis,
    };
  }

  throw new Error('Unexpected search response');
}

export async function submitLabelScan(imageUri: string): Promise<LabelScanResult> {
  const ocr = await performMockOcr(imageUri);
  const candidates = extractCandidateNames(ocr.extractedText);
  const matches: SupplementMatch[] = [];
  const seen = new Set<string>();

  for (const term of candidates) {
    if (!term || term.length < 3) {
      continue;
    }

    const { data, error } = await supabase
      .from('supplements')
      .select(SUPPLEMENT_SELECT)
      .ilike('name', `%${term}%`)
      .limit(5);

    if (error) {
      // Skip the term but log in dev console
      console.warn('[scan] label lookup failed', error);
      continue;
    }

    const records = (data ?? []) as (SupplementRecord & { brands?: BrandRecord | null })[];
    for (const record of records) {
      if (record.id && !seen.has(record.id)) {
        seen.add(record.id);
        matches.push(mapSupplement(record));
      }
    }
  }

  return {
    imageUri,
    extractedText: ocr.extractedText,
    confidence: matches.length > 0 ? 0.8 : 0.3,
    supplements: matches,
  };
}
