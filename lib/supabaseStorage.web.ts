export type SupabaseAuthStorage = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem: (key: string) => Promise<void>;
};

const memory = new Map<string, string>();

const safeLocalStorage = () => {
  try {
    if (typeof window === 'undefined') return null;
    const ls = window.localStorage;
    // Touch it once so Safari private mode / locked storage throws early.
    const probeKey = '__nutri_ls_probe__';
    ls.setItem(probeKey, '1');
    ls.removeItem(probeKey);
    return ls;
  } catch {
    return null;
  }
};

export const storage: SupabaseAuthStorage = {
  getItem: async (key) => {
    const ls = safeLocalStorage();
    if (ls) return ls.getItem(key);
    return memory.get(key) ?? null;
  },
  setItem: async (key, value) => {
    const ls = safeLocalStorage();
    if (ls) {
      ls.setItem(key, value);
      return;
    }
    memory.set(key, value);
  },
  removeItem: async (key) => {
    const ls = safeLocalStorage();
    if (ls) {
      ls.removeItem(key);
      return;
    }
    memory.delete(key);
  },
};

