import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { loadSavedSupplements, saveSavedSupplements } from '@/lib/storage/saved-supplements';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import type { RoutinePreferences, SavedSupplement, SavedSupplementInput } from '@/types/saved-supplements';

type SavedSupplementsState = {
  loading: boolean;
  savedSupplements: SavedSupplement[];
  addSupplement: (input: SavedSupplementInput) => SavedSupplement | null;
  removeSupplement: (id: string) => Promise<void>;
  removeSupplements: (ids: string[]) => Promise<void>;
  updateSupplement: (id: string, updates: Partial<SavedSupplement>) => Promise<void>;
  updateRoutine: (id: string, routine: RoutinePreferences) => Promise<void>;
  toggleCheckIn: (id: string, enabled: boolean) => Promise<void>;
  refreshFromRemote: () => Promise<void>;
};

const SavedSupplementsContext = createContext<SavedSupplementsState | undefined>(undefined);

const normalize = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .trim();

const getDedupeKey = (item: Pick<SavedSupplement, 'barcode' | 'brandName' | 'productName'>) => {
  if (item.barcode) {
    return `barcode:${item.barcode}`;
  }
  return `name:${normalize(item.brandName)}:${normalize(item.productName)}`;
};

const createLocalId = () => `local_${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`;

const parseNotes = (notes: string | null) => {
  if (!notes) return null;
  try {
    return JSON.parse(notes) as {
      dosageText?: string;
      brandName?: string;
      routine?: RoutinePreferences;
      syncedToCheckIn?: boolean;
      reminderEnabled?: boolean;
    };
  } catch (error) {
    console.warn('[saved-supplements] Unable to parse notes payload', error);
    return null;
  }
};

export const SavedSupplementsProvider = ({ children }: { children: React.ReactNode }) => {
  const { user } = useAuth();
  const [savedSupplements, setSavedSupplements] = useState<SavedSupplement[]>([]);
  const [loading, setLoading] = useState(true);
  const hydratedRef = useRef(false);

  const persist = useCallback((next: SavedSupplement[]) => {
    setSavedSupplements(next);
    saveSavedSupplements(next).catch(error => {
      console.warn('[saved-supplements] Failed to persist', error);
    });
  }, []);

  const syncToRemote = useCallback(
    async (item: SavedSupplement) => {
      if (!user?.id || !item.supplementId) return;

      const notes = JSON.stringify({
        dosageText: item.dosageText,
        brandName: item.brandName,
        routine: item.routine,
        syncedToCheckIn: item.syncedToCheckIn,
        reminderEnabled: item.reminderEnabled,
      });

      const payload = {
        user_id: user.id,
        supplement_id: item.supplementId,
        saved_at: item.createdAt,
        reminder_enabled: item.reminderEnabled ?? false,
        notes,
      };

      const { error } = await supabase.from('user_supplements').upsert(payload, {
        onConflict: 'user_id,supplement_id',
      });

      if (error) {
        console.warn('[saved-supplements] Remote upsert failed', error);
      }
    },
    [user?.id],
  );

  const removeFromRemote = useCallback(
    async (item: SavedSupplement) => {
      if (!user?.id || !item.supplementId) return;
      const { error } = await supabase
        .from('user_supplements')
        .delete()
        .match({ user_id: user.id, supplement_id: item.supplementId });

      if (error) {
        console.warn('[saved-supplements] Remote delete failed', error);
      }
    },
    [user?.id],
  );

  const refreshFromRemote = useCallback(async () => {
    if (!user?.id) return;

    const { data, error } = await supabase
      .from('user_supplements')
      .select('id, saved_at, updated_at, reminder_enabled, notes, supplement_id, supplements ( id, name, barcode, category, image_url, brands ( name ) )')
      .eq('user_id', user.id);

    if (error) {
      console.warn('[saved-supplements] Remote fetch failed', error);
      return;
    }

    const remoteItems: SavedSupplement[] = (data ?? []).map(record => {
      const notes = parseNotes(record.notes ?? null);
      const supplement = record.supplements as {
        id: string;
        name: string;
        barcode: string | null;
        category: string | null;
        image_url: string | null;
        brands?: { name: string } | null;
      } | null;

      const rawDosage = notes?.dosageText ?? '';
      const normalizedDosage = rawDosage ? normalize(rawDosage) : '';
      const normalizedCategory = supplement?.category ? normalize(supplement.category) : '';
      const dosageText =
        normalizedDosage && normalizedCategory && normalizedDosage === normalizedCategory ? '' : rawDosage;

      return {
        id: record.id,
        supplementId: record.supplement_id,
        barcode: supplement?.barcode ?? null,
        productName: supplement?.name ?? 'Unknown supplement',
        brandName: notes?.brandName ?? supplement?.brands?.name ?? 'Unknown brand',
        dosageText,
        createdAt: record.saved_at ?? record.updated_at,
        updatedAt: record.updated_at ?? record.saved_at,
        syncedToCheckIn: notes?.syncedToCheckIn ?? true,
        reminderEnabled: notes?.reminderEnabled ?? record.reminder_enabled ?? false,
        routine: notes?.routine ?? undefined,
      };
    });

    if (remoteItems.length === 0) return;

    const merged = [...savedSupplements];
    const localKeys = new Set(savedSupplements.map(item => getDedupeKey(item)));

    remoteItems.forEach(item => {
      const key = getDedupeKey(item);
      if (!localKeys.has(key)) {
        merged.push(item);
      }
    });

    if (merged.length !== savedSupplements.length) {
      persist(merged);
    }
  }, [persist, savedSupplements, user?.id]);

  useEffect(() => {
    let isMounted = true;

    const hydrate = async () => {
      try {
        const stored = await loadSavedSupplements();
        if (!isMounted) return;
        setSavedSupplements(stored);
      } catch (error) {
        console.warn('[saved-supplements] Failed to hydrate', error);
      } finally {
        if (isMounted) {
          setLoading(false);
          hydratedRef.current = true;
        }
      }
    };

    hydrate();

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (!hydratedRef.current || !user?.id) return;
    refreshFromRemote().catch(() => undefined);
  }, [refreshFromRemote, user?.id]);

  const addSupplement = useCallback(
    (input: SavedSupplementInput) => {
      const now = new Date().toISOString();
      const next: SavedSupplement = {
        id: createLocalId(),
        supplementId: input.supplementId,
        barcode: input.barcode ?? null,
        productName: input.productName,
        brandName: input.brandName,
        dosageText: input.dosageText,
        createdAt: input.createdAt ?? now,
        updatedAt: now,
        syncedToCheckIn: input.syncedToCheckIn ?? true,
        reminderEnabled: input.reminderEnabled ?? false,
        routine: input.routine,
      };

      const nextKey = getDedupeKey(next);
      const existing = savedSupplements.find(item => getDedupeKey(item) === nextKey);
      if (existing) {
        return null;
      }

      const updated = [next, ...savedSupplements];
      persist(updated);
      syncToRemote(next).catch(() => undefined);
      return next;
    },
    [persist, savedSupplements, syncToRemote],
  );

  const updateSupplement = useCallback(
    async (id: string, updates: Partial<SavedSupplement>) => {
      const now = new Date().toISOString();
      let updatedItem: SavedSupplement | null = null;

      const next = savedSupplements.map(item => {
        if (item.id !== id) return item;
        updatedItem = {
          ...item,
          ...updates,
          updatedAt: now,
        };
        return updatedItem;
      });

      if (!updatedItem) return;
      persist(next);
      await syncToRemote(updatedItem);
    },
    [persist, savedSupplements, syncToRemote],
  );

  const updateRoutine = useCallback(
    async (id: string, routine: RoutinePreferences) => {
      await updateSupplement(id, { routine });
    },
    [updateSupplement],
  );

  const toggleCheckIn = useCallback(
    async (id: string, enabled: boolean) => {
      await updateSupplement(id, { syncedToCheckIn: enabled });
    },
    [updateSupplement],
  );

  const removeSupplement = useCallback(
    async (id: string) => {
      const item = savedSupplements.find(entry => entry.id === id);
      if (!item) return;
      const next = savedSupplements.filter(entry => entry.id !== id);
      persist(next);
      await removeFromRemote(item);
    },
    [persist, removeFromRemote, savedSupplements],
  );

  const removeSupplements = useCallback(
    async (ids: string[]) => {
      if (ids.length === 0) return;
      const idSet = new Set(ids);
      let removedItems: SavedSupplement[] = [];

      setSavedSupplements(prev => {
        removedItems = prev.filter(entry => idSet.has(entry.id));
        const next = prev.filter(entry => !idSet.has(entry.id));
        saveSavedSupplements(next).catch(error => {
          console.warn('[saved-supplements] Failed to persist', error);
        });
        return next;
      });

      await Promise.all(removedItems.map(item => removeFromRemote(item)));
    },
    [removeFromRemote, saveSavedSupplements],
  );

  const value = useMemo<SavedSupplementsState>(
    () => ({
      loading,
      savedSupplements,
      addSupplement,
      removeSupplement,
      removeSupplements,
      updateSupplement,
      updateRoutine,
      toggleCheckIn,
      refreshFromRemote,
    }),
    [
      addSupplement,
      loading,
      refreshFromRemote,
      removeSupplement,
      removeSupplements,
      savedSupplements,
      toggleCheckIn,
      updateRoutine,
      updateSupplement,
    ],
  );

  return (
    <SavedSupplementsContext.Provider value={value}>
      {children}
    </SavedSupplementsContext.Provider>
  );
};

export const useSavedSupplements = () => {
  const context = useContext(SavedSupplementsContext);
  if (!context) {
    throw new Error('useSavedSupplements must be used within SavedSupplementsProvider');
  }
  return context;
};
