export type ScanHistoryItem = {
  id: string;
  barcode?: string | null;
  productName: string;
  brandName: string;
  dosageText: string;
  scannedAt: string;
  category?: string | null;
  imageUrl?: string | null;
};

export type ScanHistoryInput = Omit<ScanHistoryItem, 'id' | 'scannedAt'> & {
  scannedAt?: string;
};
