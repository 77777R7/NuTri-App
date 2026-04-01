import type { BarcodeScanResult } from '@/lib/search-agent';
import { analyzeBarcode } from '@/lib/search-agent';

export type { BarcodeAnalysis, BarcodeScanResult } from '@/lib/search-agent';

export async function submitBarcodeScan(barcode: string): Promise<BarcodeScanResult> {
  return analyzeBarcode(barcode);
}
