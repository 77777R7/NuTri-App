export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export interface Database {
  public: {
    Tables: {
      ai_analyses: {
        Row: {
          analysis_data: Json;
          created_at: string;
          id: string;
          supplement_id: string | null;
          user_id: string | null;
        };
        Insert: {
          analysis_data: Json;
          created_at?: string;
          id?: string;
          supplement_id?: string | null;
          user_id?: string | null;
        };
        Update: {
          analysis_data?: Json;
          created_at?: string;
          id?: string;
          supplement_id?: string | null;
          user_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'ai_analyses_supplement_id_fkey';
            columns: ['supplement_id'];
            referencedRelation: 'supplements';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'ai_analyses_user_id_fkey';
            columns: ['user_id'];
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
        ];
      };
      brands: {
        Row: {
          country: string | null;
          created_at: string;
          id: string;
          logo_url: string | null;
          name: string;
          updated_at: string;
          verified: boolean;
          website: string | null;
        };
        Insert: {
          country?: string | null;
          created_at?: string;
          id?: string;
          logo_url?: string | null;
          name: string;
          updated_at?: string;
          verified?: boolean;
          website?: string | null;
        };
        Update: {
          country?: string | null;
          created_at?: string;
          id?: string;
          logo_url?: string | null;
          name?: string;
          updated_at?: string;
          verified?: boolean;
          website?: string | null;
        };
        Relationships: [];
      };
      ingredients: {
        Row: {
          benefits: string | null;
          created_at: string;
          dietary_sources: string | null;
          id: string;
          name: string;
          rda_adult: number | null;
          risks: string | null;
          scientific_name: string | null;
          ul_adult: number | null;
          unit: string | null;
          updated_at: string;
        };
        Insert: {
          benefits?: string | null;
          created_at?: string;
          dietary_sources?: string | null;
          id?: string;
          name: string;
          rda_adult?: number | null;
          risks?: string | null;
          scientific_name?: string | null;
          ul_adult?: number | null;
          unit?: string | null;
          updated_at?: string;
        };
        Update: {
          benefits?: string | null;
          created_at?: string;
          dietary_sources?: string | null;
          id?: string;
          name?: string;
          rda_adult?: number | null;
          risks?: string | null;
          scientific_name?: string | null;
          ul_adult?: number | null;
          unit?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      scans: {
        Row: {
          barcode: string | null;
          confidence_score: number | null;
          created_at: string;
          id: string;
          ocr_data: Json | null;
          scan_type: string;
          supplement_id: string | null;
          timestamp: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          barcode?: string | null;
          confidence_score?: number | null;
          created_at?: string;
          id?: string;
          ocr_data?: Json | null;
          scan_type: string;
          supplement_id?: string | null;
          timestamp?: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          barcode?: string | null;
          confidence_score?: number | null;
          created_at?: string;
          id?: string;
          ocr_data?: Json | null;
          scan_type?: string;
          supplement_id?: string | null;
          timestamp?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'scans_supplement_id_fkey';
            columns: ['supplement_id'];
            referencedRelation: 'supplements';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'scans_user_id_fkey';
            columns: ['user_id'];
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
        ];
      };
      supplement_ingredients: {
        Row: {
          amount: number | null;
          created_at: string;
          daily_value_percentage: number | null;
          ingredient_id: string;
          supplement_id: string;
          unit: string;
          updated_at: string;
        };
        Insert: {
          amount?: number | null;
          created_at?: string;
          daily_value_percentage?: number | null;
          ingredient_id: string;
          supplement_id: string;
          unit: string;
          updated_at?: string;
        };
        Update: {
          amount?: number | null;
          created_at?: string;
          daily_value_percentage?: number | null;
          ingredient_id?: string;
          supplement_id?: string;
          unit?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'supplement_ingredients_ingredient_id_fkey';
            columns: ['ingredient_id'];
            referencedRelation: 'ingredients';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'supplement_ingredients_supplement_id_fkey';
            columns: ['supplement_id'];
            referencedRelation: 'supplements';
            referencedColumns: ['id'];
          },
        ];
      };
      supplements: {
        Row: {
          barcode: string | null;
          brand_id: string;
          category: string | null;
          created_at: string;
          description: string | null;
          id: string;
          image_url: string | null;
          name: string;
          updated_at: string;
          verified: boolean;
        };
        Insert: {
          barcode?: string | null;
          brand_id: string;
          category?: string | null;
          created_at?: string;
          description?: string | null;
          id?: string;
          image_url?: string | null;
          name: string;
          updated_at?: string;
          verified?: boolean;
        };
        Update: {
          barcode?: string | null;
          brand_id?: string;
          category?: string | null;
          created_at?: string;
          description?: string | null;
          id?: string;
          image_url?: string | null;
          name?: string;
          updated_at?: string;
          verified?: boolean;
        };
        Relationships: [
          {
            foreignKeyName: 'supplements_brand_id_fkey';
            columns: ['brand_id'];
            referencedRelation: 'brands';
            referencedColumns: ['id'];
          },
        ];
      };
      user_profiles: {
        Row: {
          activity_level: string | null;
          age: number | null;
          created_at: string;
          dietary_preference: string | null;
          gender: string | null;
          height: number | null;
          location: string | null;
          timezone: string | null;
          updated_at: string;
          user_id: string;
          weight: number | null;
        };
        Insert: {
          activity_level?: string | null;
          age?: number | null;
          created_at?: string;
          dietary_preference?: string | null;
          gender?: string | null;
          height?: number | null;
          location?: string | null;
          timezone?: string | null;
          updated_at?: string;
          user_id: string;
          weight?: number | null;
        };
        Update: {
          activity_level?: string | null;
          age?: number | null;
          created_at?: string;
          dietary_preference?: string | null;
          gender?: string | null;
          height?: number | null;
          location?: string | null;
          timezone?: string | null;
          updated_at?: string;
          user_id?: string;
          weight?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: 'user_profiles_user_id_fkey';
            columns: ['user_id'];
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
        ];
      };
      user_checkins: {
        Row: {
          check_in_date: string;
          created_at: string;
          id: string;
          supplement_id: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          check_in_date: string;
          created_at?: string;
          id?: string;
          supplement_id: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          check_in_date?: string;
          created_at?: string;
          id?: string;
          supplement_id?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'user_checkins_supplement_id_fkey';
            columns: ['supplement_id'];
            referencedRelation: 'supplements';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'user_checkins_user_id_fkey';
            columns: ['user_id'];
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
        ];
      };
      user_streak: {
        Row: {
          created_at: string;
          current_streak: number;
          last_check_in: string | null;
          longest_streak: number;
          total_check_ins: number;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          current_streak?: number;
          last_check_in?: string | null;
          longest_streak?: number;
          total_check_ins?: number;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          current_streak?: number;
          last_check_in?: string | null;
          longest_streak?: number;
          total_check_ins?: number;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'user_streak_user_id_fkey';
            columns: ['user_id'];
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
        ];
      };
      user_supplements: {
        Row: {
          created_at: string;
          id: string;
          notes: string | null;
          reminder_enabled: boolean;
          reminder_frequency: string | null;
          reminder_time: string | null;
          saved_at: string;
          supplement_id: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          notes?: string | null;
          reminder_enabled?: boolean;
          reminder_frequency?: string | null;
          reminder_time?: string | null;
          saved_at?: string;
          supplement_id: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          notes?: string | null;
          reminder_enabled?: boolean;
          reminder_frequency?: string | null;
          reminder_time?: string | null;
          saved_at?: string;
          supplement_id?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'user_supplements_supplement_id_fkey';
            columns: ['supplement_id'];
            referencedRelation: 'supplements';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'user_supplements_user_id_fkey';
            columns: ['user_id'];
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
        ];
      };
      users: {
        Row: {
          created_at: string;
          email: string;
          id: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          email: string;
          id: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          email?: string;
          id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'users_id_fkey';
            columns: ['id'];
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
        ];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
