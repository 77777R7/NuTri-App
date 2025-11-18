export interface SearchItem {
  title: string;
  snippet: string;
  link: string;
}

export interface SearchResponseOk {
  status: "ok";
  barcode: string;
  items: SearchItem[];
}

export interface SearchResponseNotFound {
  status: "not_found";
  barcode: string;
}

export type SearchResponse = SearchResponseOk | SearchResponseNotFound;

export interface ErrorResponse {
  error: string;
  detail?: string;
  statusCode?: number;
}

export interface AiIngredient {
  name: string;
  amount: string | null;
  unit: string | null;
  notes: string | null;
}

export interface AiSupplementAnalysis {
  barcode: string;
  brand: string | null;
  productName: string | null;
  summary: string | null;
  confidence: number;
  ingredients: AiIngredient[];
  sources: Array<{ title: string; link: string }>; 
}
