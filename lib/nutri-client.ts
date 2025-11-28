import { analyzeBarcode } from '@/lib/search-agent';
import type { BarcodeScanResult } from '@/lib/search-agent';

const API_BASE = (process.env.EXPO_PUBLIC_API_BASE_URL?.replace(/\/$/, '') as string) || '';

export const nutri = {
  auth: {
    async me() {
      const response = await fetch(`${API_BASE}/api/me`, { credentials: 'include' as any });
      if (!response.ok) throw new Error('Auth failed');
      return response.json();
    },
    async logout() {
      await fetch(`${API_BASE}/api/logout`, {
        method: 'POST',
        credentials: 'include' as any,
      });
    },
  },
  entities: {
    Supplement: {
      async list(order = '-created_date') {
        const response = await fetch(`${API_BASE}/api/supplements?order=${encodeURIComponent(order)}`);
        if (!response.ok) throw new Error('Failed to list supplements');
        return response.json();
      },
      async filter(where: Record<string, unknown> = {}, order = '-created_date') {
        const response = await fetch(`${API_BASE}/api/supplements/search`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ where, order }),
        });
        if (!response.ok) throw new Error('Failed to filter');
        return response.json();
      },
      async create(data: Record<string, unknown>) {
        const response = await fetch(`${API_BASE}/api/supplements`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        });
        if (!response.ok) throw new Error('Create failed');
        return response.json();
      },
      async schema() {
        const mod = await import('./schema/Supplement.schema.json');
        // @ts-ignore -- metro json import
        return mod.default || mod;
      },
    },
  },
  integrations: {
    Core: {
      async UploadFile({ file }: { file: any }) {
        const form = new FormData();
        form.append('file', file);
        const response = await fetch(`${API_BASE}/api/upload`, { method: 'POST', body: form });
        if (!response.ok) throw new Error('Upload failed');
        return response.json();
      },
      async ExtractDataFromUploadedFile({
        file_url,
        json_schema,
      }: {
        file_url: string;
        json_schema: unknown;
      }) {
        const response = await fetch(`${API_BASE}/api/scan`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ file_url, json_schema }),
        });
        if (!response.ok) return { status: 'error' as const };
        return response.json();
      },
      async InvokeLLM({
        barcode,
      }: {
        barcode: string;
      }): Promise<BarcodeScanResult> {
        if (!barcode || !barcode.trim()) {
          throw new Error('barcode is required');
        }
        return analyzeBarcode(barcode.trim());
      },
    },
  },
};

export default nutri;
