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
import { normalizeRoutinePreferences } from '@/lib/routineSchedule';
import { supabase } from '@/lib/supabase';
import { recordPersonalizationEvents } from '@/lib/supabase/personalization';
import { useAuth } from '@/contexts/AuthContext';
import { getSavedSupplementAddGateDecision } from '@/lib/pro/featureGates';
import type {
  RoutinePreferences,
  SavedSupplement,
  SavedSupplementAddOptions,
  SavedSupplementAddResult,
  SavedSupplementInput,
} from '@/types/saved-supplements';

type SavedSupplementsState = {
  loading: boolean;
  savedSupplements: SavedSupplement[];
  addSupplement: (input: SavedSupplementInput, options?: SavedSupplementAddOptions) => SavedSupplementAddResult;
  removeSupplement: (id: string) => Promise<void>;
  removeSupplements: (ids: string[]) => Promise<void>;
  updateSupplement: (id: string, updates: Partial<SavedSupplement>) => Promise<void>;
  updateRoutine: (id: string, routine: RoutinePreferences) => Promise<void>;
  toggleCheckIn: (id: string, enabled: boolean) => Promise<void>;
  refreshFromRemote: () => Promise<void>;
};

const SavedSupplementsContext = createContext<SavedSupplementsState | undefined>(undefined);

const UNKNOWN_BRAND = 'Unknown brand';

const normalize = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .trim();

const sanitizeBrandName = (value?: string | null): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.toLowerCase() === UNKNOWN_BRAND.toLowerCase()) return null;
  return trimmed;
};

const getAllDedupeKeys = (item: Pick<SavedSupplement, 'supplementId' | 'barcode' | 'brandName' | 'productName'>) => {
  const keys: string[] = [];
  if (item.supplementId) keys.push(`supplement:${item.supplementId}`);
  if (item.barcode) keys.push(`barcode:${item.barcode}`);
  keys.push(`name:${normalize(item.brandName)}:${normalize(item.productName)}`);
  return keys;
};

const createLocalId = () => `local_${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`;

const sanitizeRoutine = (routine: RoutinePreferences | null | undefined) =>
  normalizeRoutinePreferences(routine);

const sanitizeSavedSupplement = (item: SavedSupplement): SavedSupplement => ({
  ...item,
  routine: sanitizeRoutine(item.routine),
});

const parseNotes = (notes: string | null) => {
  if (!notes) return null;
  try {
    return JSON.parse(notes) as {
      dosageText?: string;
      brandName?: string;
      routine?: RoutinePreferences;
      tags?: string[];
      lastViewed?: string;
      syncedToCheckIn?: boolean;
      reminderEnabled?: boolean;
    };
  } catch (error) {
    console.warn('[saved-supplements] Unable to parse notes payload', error);
    return null;
  }
};

const msSince = (value?: string | null) => {
  if (!value) return null;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;
  return Math.max(0, Date.now() - timestamp);
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

      const cleanedBrandName = sanitizeBrandName(item.brandName);
      const notes = JSON.stringify({
        dosageText: item.dosageText,
        ...(cleanedBrandName ? { brandName: cleanedBrandName } : {}),
        routine: sanitizeRoutine(item.routine),
        tags: item.tags,
        lastViewed: item.lastViewed,
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

      const supplementBrand = sanitizeBrandName(supplement?.brands?.name ?? null);
      const noteBrand = sanitizeBrandName(notes?.brandName ?? null);

      const rawDosage = notes?.dosageText ?? '';
      const normalizedDosage = rawDosage ? normalize(rawDosage) : '';
      const normalizedCategory = supplement?.category ? normalize(supplement.category) : '';
      const dosageText =
        normalizedDosage && normalizedCategory && normalizedDosage === normalizedCategory ? '' : rawDosage;

      return {
        id: record.id,
        supplementId: record.supplement_id,
        barcode: supplement?.barcode ?? null,
        imageUrl: supplement?.image_url ?? null,
        productName: supplement?.name ?? 'Unknown supplement',
        brandName: supplementBrand ?? noteBrand ?? UNKNOWN_BRAND,
        dosageText,
        createdAt: record.saved_at ?? record.updated_at,
        updatedAt: record.updated_at ?? record.saved_at,
        syncedToCheckIn: notes?.syncedToCheckIn ?? true,
        lastViewed: notes?.lastViewed ?? undefined,
        tags: notes?.tags ?? undefined,
        reminderEnabled: notes?.reminderEnabled ?? record.reminder_enabled ?? false,
        routine: sanitizeRoutine(notes?.routine),
      };
    });

    if (remoteItems.length === 0) return;

    const merged = [...savedSupplements];
    let changed = false;

    const keyToIndex = new Map<string, number>();
    merged.forEach((item, idx) => {
      getAllDedupeKeys(item).forEach(key => {
        if (!keyToIndex.has(key)) keyToIndex.set(key, idx);
      });
    });

    const mergeIntoLocal = (local: SavedSupplement, remote: SavedSupplement): SavedSupplement => {
      const updates: Partial<SavedSupplement> = {};

      if (!local.supplementId && remote.supplementId) updates.supplementId = remote.supplementId;
      if (!local.barcode && remote.barcode) updates.barcode = remote.barcode;
      if (!local.imageUrl && remote.imageUrl) updates.imageUrl = remote.imageUrl;

      const localName = local.productName?.trim() ?? '';
      const remoteName = remote.productName?.trim() ?? '';
      if ((!localName || localName === 'Unknown supplement') && remoteName && remoteName !== 'Unknown supplement') {
        updates.productName = remoteName;
      }

      const remoteBrand = sanitizeBrandName(remote.brandName);
      const localBrand = sanitizeBrandName(local.brandName);
      if (remoteBrand && remoteBrand !== localBrand) {
        updates.brandName = remoteBrand;
      }

      const localDose = local.dosageText?.trim() ?? '';
      const remoteDose = remote.dosageText?.trim() ?? '';
      if (!localDose && remoteDose) {
        updates.dosageText = remote.dosageText;
      }

      if (Object.keys(updates).length === 0) return local;
      changed = true;
      return { ...local, ...updates };
    };

    remoteItems.forEach(remote => {
      const keys = getAllDedupeKeys(remote);
      const existingIndex = keys.map(key => keyToIndex.get(key)).find((idx): idx is number => idx != null);

      if (existingIndex == null) {
        merged.push(remote);
        changed = true;
        const idx = merged.length - 1;
        keys.forEach(key => keyToIndex.set(key, idx));
        return;
      }

      merged[existingIndex] = mergeIntoLocal(merged[existingIndex], remote);
      getAllDedupeKeys(merged[existingIndex]).forEach(key => {
        if (!keyToIndex.has(key)) keyToIndex.set(key, existingIndex);
      });
    });

    if (changed) {
      persist(merged);
    }
  }, [persist, savedSupplements, user?.id]);

  useEffect(() => {
    let isMounted = true;

    const hydrate = async () => {
      try {
        const stored = await loadSavedSupplements();
        if (!isMounted) return;
        setSavedSupplements(stored.map(sanitizeSavedSupplement));
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
    (input: SavedSupplementInput, options?: SavedSupplementAddOptions): SavedSupplementAddResult => {
      const now = new Date().toISOString();
      const next: SavedSupplement = {
        id: createLocalId(),
        supplementId: input.supplementId,
        barcode: input.barcode ?? null,
        imageUrl: input.imageUrl ?? null,
        productName: input.productName,
        brandName: sanitizeBrandName(input.brandName) ?? UNKNOWN_BRAND,
        dosageText: input.dosageText,
        createdAt: input.createdAt ?? now,
        updatedAt: now,
        syncedToCheckIn: input.syncedToCheckIn ?? true,
        lastViewed: input.lastViewed,
        tags: input.tags,
        reminderEnabled: input.reminderEnabled ?? false,
        routine: sanitizeRoutine(input.routine),
      };

      const nextKeys = getAllDedupeKeys(next);
      const existing = savedSupplements.find(item =>
        getAllDedupeKeys(item).some(key => nextKeys.includes(key)),
      );

      const gate = getSavedSupplementAddGateDecision({
        isPremium: options?.isPremium === true,
        savedCount: savedSupplements.length,
        isDuplicate: Boolean(existing),
      });

      if (gate.status === 'duplicate') {
        return { status: 'duplicate', supplement: existing! };
      }

      if (gate.status === 'limit_reached') {
        return gate;
      }

      const updated = [next, ...savedSupplements];
      persist(updated);
      syncToRemote(next).catch(() => undefined);
      return { status: 'added', supplement: next };
    },
    [persist, savedSupplements, syncToRemote],
  );

  const updateSupplement = useCallback(
    async (id: string, updates: Partial<SavedSupplement>) => {
      const now = new Date().toISOString();
      let updatedItem: SavedSupplement | null = null;

      setSavedSupplements(prev => {
        const next = prev.map(item => {
          if (item.id !== id) return item;
          updatedItem = {
            ...item,
            ...updates,
            updatedAt: now,
          };
          return updatedItem;
        });

        saveSavedSupplements(next).catch(error => {
          console.warn('[saved-supplements] Failed to persist', error);
        });

        return next;
      });

      if (!updatedItem) return;
      await syncToRemote(updatedItem);
    },
    [syncToRemote],
  );

  const updateRoutine = useCallback(
    async (id: string, routine: RoutinePreferences) => {
      await updateSupplement(id, { routine: sanitizeRoutine(routine) });
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
      void recordPersonalizationEvents([
        {
          userId: user?.id,
          eventName: 'save_then_unsave',
          surface: 'my_saved',
          payload: {
            productId: item.id,
            supplementId: item.supplementId ?? null,
            savedForMs: msSince(item.createdAt),
          },
        },
      ]);
      await removeFromRemote(item);
    },
    [persist, removeFromRemote, savedSupplements, user?.id],
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

      void recordPersonalizationEvents(
        removedItems.map((item) => ({
          userId: user?.id,
          eventName: 'save_then_unsave' as const,
          surface: 'my_saved',
          payload: {
            productId: item.id,
            supplementId: item.supplementId ?? null,
            savedForMs: msSince(item.createdAt),
          },
        })),
      );

      await Promise.all(removedItems.map(item => removeFromRemote(item)));
    },
    [removeFromRemote, user?.id],
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
