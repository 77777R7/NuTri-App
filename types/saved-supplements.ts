export type RoutinePreferences = {
  whenToTake?: string;
  howToTake?: string;
};

export type SavedSupplement = {
  id: string;
  supplementId?: string;
  barcode?: string | null;
  productName: string;
  brandName: string;
  dosageText: string;
  createdAt: string;
  updatedAt: string;
  syncedToCheckIn: boolean;
  reminderEnabled?: boolean;
  routine?: RoutinePreferences;
};

export type SavedSupplementInput = Omit<
  SavedSupplement,
  'id' | 'createdAt' | 'updatedAt' | 'syncedToCheckIn'
> & {
  createdAt?: string;
  syncedToCheckIn?: boolean;
};
