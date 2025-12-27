import type { BarcodeScanResult, LabelScanResult } from './service';

const generateId = () => {
  try {
    return globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
  } catch (error) {
    return Math.random().toString(36).slice(2);
  }
};


export type ScanSession =
  | {
    id: string;
    mode: 'barcode';
    input: { barcode: string };
    result?: BarcodeScanResult;
    isLoading?: boolean;
  }
  | {
    id: string;
    mode: 'label';
    input: { imageUri: string; imageBase64?: string };
    result: LabelScanResult;
  };

let currentSession: ScanSession | null = null;

export const setScanSession = (session: ScanSession) => {
  currentSession = session;
};

export const consumeScanSession = (): ScanSession | null => {
  const session = currentSession;
  currentSession = null;
  return session;
};

export const ensureSessionId = generateId;
