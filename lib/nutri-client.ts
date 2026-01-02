import { analyzeBarcode } from '@/lib/search-agent';
import type { BarcodeScanResult } from '@/lib/search-agent';
import { withAuthHeaders } from '@/lib/auth-token';

const API_BASE = (process.env.EXPO_PUBLIC_API_BASE_URL?.replace(/\/$/, '') as string) || '';

export const nutri = {
  auth: {
    async me() {
      const headers = await withAuthHeaders();
      const response = await fetch(`${API_BASE}/api/me`, { credentials: 'include' as any, headers });
      if (!response.ok) throw new Error('Auth failed');
      return response.json();
    },
    async logout() {
      const headers = await withAuthHeaders();
      await fetch(`${API_BASE}/api/logout`, {
        method: 'POST',
        credentials: 'include' as any,
        headers,
      });
    },
  },
  entities: {
    Supplement: {
      async list(order = '-created_date') {
        const headers = await withAuthHeaders();
        const response = await fetch(`${API_BASE}/api/supplements?order=${encodeURIComponent(order)}`, {
          headers,
        });
        if (!response.ok) throw new Error('Failed to list supplements');
        return response.json();
      },
      async filter(where: Record<string, unknown> = {}, order = '-created_date') {
        const headers = await withAuthHeaders({ 'Content-Type': 'application/json' });
        const response = await fetch(`${API_BASE}/api/supplements/search`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ where, order }),
        });
        if (!response.ok) throw new Error('Failed to filter');
        return response.json();
      },
      async create(data: Record<string, unknown>) {
        const headers = await withAuthHeaders({ 'Content-Type': 'application/json' });
        const response = await fetch(`${API_BASE}/api/supplements`, {
          method: 'POST',
          headers,
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
        const headers = await withAuthHeaders();
        const response = await fetch(`${API_BASE}/api/upload`, { method: 'POST', body: form, headers });
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
        const headers = await withAuthHeaders({ 'Content-Type': 'application/json' });
        const response = await fetch(`${API_BASE}/api/scan`, {
          method: 'POST',
          headers,
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
