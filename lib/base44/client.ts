import AsyncStorage from '@react-native-async-storage/async-storage';

import type { UserProfile } from './types';

const STORAGE_KEY = 'base44_user_profiles';
const USER_ID_KEY = 'base44_user_id';

async function loadAll(): Promise<UserProfile[]> {
  const json = await AsyncStorage.getItem(STORAGE_KEY);
  return json ? JSON.parse(json) : [];
}

async function saveAll(rows: UserProfile[]) {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(rows));
}

export const base44 = {
  auth: {
    async me() {
      let id = await AsyncStorage.getItem(USER_ID_KEY);
      if (!id) {
        id = 'local-user';
        await AsyncStorage.setItem(USER_ID_KEY, id);
      }
      return { id };
    },
  },
  UserProfile: {
    async list() {
      return loadAll();
    },
    async filter(query: Partial<UserProfile>) {
      const all = await loadAll();
      return all.filter((row) =>
        Object.entries(query).every(([k, v]) => (row as any)[k] === v),
      );
    },
    async upsert(row: UserProfile) {
      const all = await loadAll();
      const i = all.findIndex((r) => r.id === row.id);
      const now = new Date().toISOString();
      if (i >= 0) {
        all[i] = { ...all[i], ...row, updatedAt: now };
      } else {
        all.push({ ...row, createdAt: now, updatedAt: now });
      }
      await saveAll(all);
      return row;
    },
  },
};

export type { UserProfile };
