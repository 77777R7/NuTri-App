export type RoutineDayOfWeek = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export type RoutinePreferences = {
  note?: string;
  time?: string;
  timeUserSet?: boolean;
  withFood?: boolean;
  whenToTake?: string;
  howToTake?: string;
  startDate?: string;
  daysOfWeek?: RoutineDayOfWeek[];
};

export type SavedSupplement = {
  id: string;
  supplementId?: string;
  barcode?: string | null;
  imageUrl?: string | null;
  productName: string;
  brandName: string;
  dosageText: string;
  createdAt: string;
  updatedAt: string;
  syncedToCheckIn: boolean;
  lastViewed?: string;
  tags?: string[];
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
