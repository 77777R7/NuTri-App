import { analyzeBarcode } from '@/lib/search-agent';
import type { BarcodeAnalysis, BarcodeScanResult } from '@/lib/search-agent';
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

export type { BarcodeAnalysis, BarcodeScanResult } from '@/lib/search-agent';

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

export async function submitBarcodeScan(barcode: string): Promise<BarcodeScanResult> {
  return analyzeBarcode(barcode);
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
