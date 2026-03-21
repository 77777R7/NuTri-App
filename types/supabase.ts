export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "13.0.5"
  }
  public: {
    Tables: {
      ai_analyses: {
        Row: {
          analysis_data: Json
          created_at: string
          id: string
          supplement_id: string | null
          user_id: string | null
        }
        Insert: {
          analysis_data: Json
          created_at?: string
          id?: string
          supplement_id?: string | null
          user_id?: string | null
        }
        Update: {
          analysis_data?: Json
          created_at?: string
          id?: string
          supplement_id?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_analyses_supplement_id_fkey"
            columns: ["supplement_id"]
            isOneToOne: false
            referencedRelation: "supplements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_analyses_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      analysis_identity_cache: {
        Row: {
          attempts: number
          created_at: string
          error_code: string | null
          expires_at: string | null
          facts_digest_hash: string
          facts_digest_json: Json
          facts_source_version: string
          identity_type: string
          identity_value: string
          last_error: string | null
          locale: string
          locked_until: string | null
          payload: Json | null
          prompt_version: string
          section: string
          status: string
          updated_at: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          error_code?: string | null
          expires_at?: string | null
          facts_digest_hash: string
          facts_digest_json: Json
          facts_source_version: string
          identity_type: string
          identity_value: string
          last_error?: string | null
          locale: string
          locked_until?: string | null
          payload?: Json | null
          prompt_version: string
          section: string
          status: string
          updated_at?: string
        }
        Update: {
          attempts?: number
          created_at?: string
          error_code?: string | null
          expires_at?: string | null
          facts_digest_hash?: string
          facts_digest_json?: Json
          facts_source_version?: string
          identity_type?: string
          identity_value?: string
          last_error?: string | null
          locale?: string
          locked_until?: string | null
          payload?: Json | null
          prompt_version?: string
          section?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      barcode_overrides: {
        Row: {
          barcode_gtin14: string
          brand: string | null
          category: string | null
          created_at: string
          dsld_label_id: number | null
          image_url: string | null
          notes: string | null
          product_name: string | null
          updated_at: string
        }
        Insert: {
          barcode_gtin14: string
          brand?: string | null
          category?: string | null
          created_at?: string
          dsld_label_id?: number | null
          image_url?: string | null
          notes?: string | null
          product_name?: string | null
          updated_at?: string
        }
        Update: {
          barcode_gtin14?: string
          brand?: string | null
          category?: string | null
          created_at?: string
          dsld_label_id?: number | null
          image_url?: string | null
          notes?: string | null
          product_name?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "barcode_overrides_dsld_label_id_fkey"
            columns: ["dsld_label_id"]
            isOneToOne: false
            referencedRelation: "dsld_labels_meta"
            referencedColumns: ["dsld_label_id"]
          },
          {
            foreignKeyName: "barcode_overrides_dsld_label_id_fkey"
            columns: ["dsld_label_id"]
            isOneToOne: false
            referencedRelation: "regression_dsld_form_candidates_v"
            referencedColumns: ["dsld_label_id"]
          },
        ]
      }
      barcode_regulatory_map: {
        Row: {
          barcode_gtin14: string
          barcode_raw: string | null
          confidence: number
          created_at: string
          expires_at: string | null
          last_seen_at: string
          npn: string
          source: string
          updated_at: string
        }
        Insert: {
          barcode_gtin14: string
          barcode_raw?: string | null
          confidence?: number
          created_at?: string
          expires_at?: string | null
          last_seen_at?: string
          npn: string
          source: string
          updated_at?: string
        }
        Update: {
          barcode_gtin14?: string
          barcode_raw?: string | null
          confidence?: number
          created_at?: string
          expires_at?: string | null
          last_seen_at?: string
          npn?: string
          source?: string
          updated_at?: string
        }
        Relationships: []
      }
      barcode_regulatory_map_candidates: {
        Row: {
          barcode_gtin14: string
          barcode_raw: string | null
          created_at: string
          existing_confidence: number | null
          existing_expires_at: string | null
          existing_npn: string | null
          existing_rank: number | null
          existing_source: string | null
          id: number
          incoming_confidence: number | null
          incoming_expires_at: string | null
          incoming_npn: string
          incoming_rank: number | null
          incoming_source: string
          reason_code: string
        }
        Insert: {
          barcode_gtin14: string
          barcode_raw?: string | null
          created_at?: string
          existing_confidence?: number | null
          existing_expires_at?: string | null
          existing_npn?: string | null
          existing_rank?: number | null
          existing_source?: string | null
          id?: number
          incoming_confidence?: number | null
          incoming_expires_at?: string | null
          incoming_npn: string
          incoming_rank?: number | null
          incoming_source: string
          reason_code: string
        }
        Update: {
          barcode_gtin14?: string
          barcode_raw?: string | null
          created_at?: string
          existing_confidence?: number | null
          existing_expires_at?: string | null
          existing_npn?: string | null
          existing_rank?: number | null
          existing_source?: string | null
          id?: number
          incoming_confidence?: number | null
          incoming_expires_at?: string | null
          incoming_npn?: string
          incoming_rank?: number | null
          incoming_source?: string
          reason_code?: string
        }
        Relationships: []
      }
      barcode_resolution_training: {
        Row: {
          barcode_gtin14: string
          cache_hits: Json | null
          calls: Json | null
          created_at: string
          engine_version: string
          facts_coverage: number | null
          facts_summary: Json | null
          id: number
          outcome: string
          query_profiles_used: string[] | null
          selected_domain: string | null
          selected_url: string | null
          serp_topk: Json | null
          signals: Json | null
          stage0_outcome: string
          timing: Json | null
        }
        Insert: {
          barcode_gtin14: string
          cache_hits?: Json | null
          calls?: Json | null
          created_at?: string
          engine_version: string
          facts_coverage?: number | null
          facts_summary?: Json | null
          id?: number
          outcome: string
          query_profiles_used?: string[] | null
          selected_domain?: string | null
          selected_url?: string | null
          serp_topk?: Json | null
          signals?: Json | null
          stage0_outcome: string
          timing?: Json | null
        }
        Update: {
          barcode_gtin14?: string
          cache_hits?: Json | null
          calls?: Json | null
          created_at?: string
          engine_version?: string
          facts_coverage?: number | null
          facts_summary?: Json | null
          id?: number
          outcome?: string
          query_profiles_used?: string[] | null
          selected_domain?: string | null
          selected_url?: string | null
          serp_topk?: Json | null
          signals?: Json | null
          stage0_outcome?: string
          timing?: Json | null
        }
        Relationships: []
      }
      barcode_scans: {
        Row: {
          barcode_gtin14: string
          barcode_raw: string | null
          brand_name: string | null
          catalog_hit: boolean
          checksum_valid: boolean | null
          created_at: string
          device_id: string | null
          dsld_label_id: number | null
          id: string
          meta: Json | null
          product_name: string | null
          request_id: string | null
          scanned_at: string
          served_from: string
          snapshot_id: string | null
          timing_total_ms: number | null
        }
        Insert: {
          barcode_gtin14: string
          barcode_raw?: string | null
          brand_name?: string | null
          catalog_hit?: boolean
          checksum_valid?: boolean | null
          created_at?: string
          device_id?: string | null
          dsld_label_id?: number | null
          id?: string
          meta?: Json | null
          product_name?: string | null
          request_id?: string | null
          scanned_at?: string
          served_from?: string
          snapshot_id?: string | null
          timing_total_ms?: number | null
        }
        Update: {
          barcode_gtin14?: string
          barcode_raw?: string | null
          brand_name?: string | null
          catalog_hit?: boolean
          checksum_valid?: boolean | null
          created_at?: string
          device_id?: string | null
          dsld_label_id?: number | null
          id?: string
          meta?: Json | null
          product_name?: string | null
          request_id?: string | null
          scanned_at?: string
          served_from?: string
          snapshot_id?: string | null
          timing_total_ms?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "barcode_scans_dsld_label_id_fkey"
            columns: ["dsld_label_id"]
            isOneToOne: false
            referencedRelation: "dsld_labels_meta"
            referencedColumns: ["dsld_label_id"]
          },
          {
            foreignKeyName: "barcode_scans_dsld_label_id_fkey"
            columns: ["dsld_label_id"]
            isOneToOne: false
            referencedRelation: "regression_dsld_form_candidates_v"
            referencedColumns: ["dsld_label_id"]
          },
        ]
      }
      brands: {
        Row: {
          country: string | null
          created_at: string
          id: string
          logo_url: string | null
          name: string
          updated_at: string
          verified: boolean
          website: string | null
        }
        Insert: {
          country?: string | null
          created_at?: string
          id?: string
          logo_url?: string | null
          name: string
          updated_at?: string
          verified?: boolean
          website?: string | null
        }
        Update: {
          country?: string | null
          created_at?: string
          id?: string
          logo_url?: string | null
          name?: string
          updated_at?: string
          verified?: boolean
          website?: string | null
        }
        Relationships: []
      }
      citations: {
        Row: {
          accessed_at: string | null
          audit_status: string
          created_at: string
          id: string
          identifier: string | null
          source: string | null
          title: string | null
          type: string
          updated_at: string
          url: string | null
          year: number | null
        }
        Insert: {
          accessed_at?: string | null
          audit_status?: string
          created_at?: string
          id: string
          identifier?: string | null
          source?: string | null
          title?: string | null
          type: string
          updated_at?: string
          url?: string | null
          year?: number | null
        }
        Update: {
          accessed_at?: string | null
          audit_status?: string
          created_at?: string
          id?: string
          identifier?: string | null
          source?: string | null
          title?: string | null
          type?: string
          updated_at?: string
          url?: string | null
          year?: number | null
        }
        Relationships: []
      }
      dose_response_curves: {
        Row: {
          audit_status: string
          beneficial_min: number | null
          created_at: string
          curve_id: string
          curve_type: string | null
          ingredient_id: string | null
          ingredient_key: string | null
          notes: string | null
          penalty_slope: number | null
          penalty_start: number | null
          plateau_end: number | null
          plateau_start: number | null
          reference_ids: string[] | null
          score_cap: number | null
          score_midpoint: number | null
          target_unit: string | null
          target_value: number | null
          ul_scope: string | null
          ul_unit: string | null
          ul_value: number | null
          updated_at: string
        }
        Insert: {
          audit_status?: string
          beneficial_min?: number | null
          created_at?: string
          curve_id: string
          curve_type?: string | null
          ingredient_id?: string | null
          ingredient_key?: string | null
          notes?: string | null
          penalty_slope?: number | null
          penalty_start?: number | null
          plateau_end?: number | null
          plateau_start?: number | null
          reference_ids?: string[] | null
          score_cap?: number | null
          score_midpoint?: number | null
          target_unit?: string | null
          target_value?: number | null
          ul_scope?: string | null
          ul_unit?: string | null
          ul_value?: number | null
          updated_at?: string
        }
        Update: {
          audit_status?: string
          beneficial_min?: number | null
          created_at?: string
          curve_id?: string
          curve_type?: string | null
          ingredient_id?: string | null
          ingredient_key?: string | null
          notes?: string | null
          penalty_slope?: number | null
          penalty_start?: number | null
          plateau_end?: number | null
          plateau_start?: number | null
          reference_ids?: string[] | null
          score_cap?: number | null
          score_midpoint?: number | null
          target_unit?: string | null
          target_value?: number | null
          ul_scope?: string | null
          ul_unit?: string | null
          ul_value?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "dose_response_curves_ingredient_id_fkey"
            columns: ["ingredient_id"]
            isOneToOne: false
            referencedRelation: "ingredients"
            referencedColumns: ["id"]
          },
        ]
      }
      dsld_barcode_canonical: {
        Row: {
          barcode_normalized_gtin14: string
          canonical_brand: string | null
          canonical_dsld_label_id: number
          canonical_product_name: string | null
          has_pdf: boolean | null
          has_thumbnail: boolean | null
          label_count: number | null
        }
        Insert: {
          barcode_normalized_gtin14: string
          canonical_brand?: string | null
          canonical_dsld_label_id: number
          canonical_product_name?: string | null
          has_pdf?: boolean | null
          has_thumbnail?: boolean | null
          label_count?: number | null
        }
        Update: {
          barcode_normalized_gtin14?: string
          canonical_brand?: string | null
          canonical_dsld_label_id?: number
          canonical_product_name?: string | null
          has_pdf?: boolean | null
          has_thumbnail?: boolean | null
          label_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "dsld_barcode_canonical_canonical_dsld_label_id_fkey"
            columns: ["canonical_dsld_label_id"]
            isOneToOne: false
            referencedRelation: "dsld_labels_meta"
            referencedColumns: ["dsld_label_id"]
          },
          {
            foreignKeyName: "dsld_barcode_canonical_canonical_dsld_label_id_fkey"
            columns: ["canonical_dsld_label_id"]
            isOneToOne: false
            referencedRelation: "regression_dsld_form_candidates_v"
            referencedColumns: ["dsld_label_id"]
          },
        ]
      }
      dsld_facts: {
        Row: {
          dataset_version: string | null
          dsld_label_id: number
          extracted_at: string
          facts_json: Json
        }
        Insert: {
          dataset_version?: string | null
          dsld_label_id: number
          extracted_at?: string
          facts_json: Json
        }
        Update: {
          dataset_version?: string | null
          dsld_label_id?: number
          extracted_at?: string
          facts_json?: Json
        }
        Relationships: []
      }
      dsld_label_facts: {
        Row: {
          brand_name: string | null
          dataset_version: string | null
          dsld_label_id: number
          extracted_at: string
          facts_json: Json
          product_name: string | null
        }
        Insert: {
          brand_name?: string | null
          dataset_version?: string | null
          dsld_label_id: number
          extracted_at?: string
          facts_json: Json
          product_name?: string | null
        }
        Update: {
          brand_name?: string | null
          dataset_version?: string | null
          dsld_label_id?: number
          extracted_at?: string
          facts_json?: Json
          product_name?: string | null
        }
        Relationships: []
      }
      dsld_labels_meta: {
        Row: {
          active_ingredients_summary: string | null
          asin_candidate: string | null
          barcode_format: string | null
          barcode_normalized_gtin14: string | null
          barcode_quality: string | null
          brand: string | null
          brand_norm: string | null
          canonical_dsld_label_id: number | null
          category: string | null
          category_raw: string | null
          cgmp_compliance: string | null
          checkdigit_valid_computed: boolean | null
          dsld_label_id: number
          dsld_pdf: string | null
          dsld_product_version_code: string | null
          dsld_source_file: string | null
          dsld_thumbnail: string | null
          external_code_10char: string | null
          form: string | null
          has_pdf: boolean | null
          has_thumbnail: boolean | null
          ifos_fish_oil: string | null
          inactive_ingredients: string | null
          informed_sport: string | null
          is_canonical_for_barcode: boolean | null
          name_norm: string | null
          nsf_certified_for_sport: string | null
          package_quantity: number | null
          package_unit: string | null
          product_name: string | null
          serving_size_count: number | null
          serving_size_raw: string | null
          servings_per_container: number | null
          third_party_testing: string | null
          upc_digits_str: string | null
          upc_len: number | null
          upc_raw_dsld: string | null
        }
        Insert: {
          active_ingredients_summary?: string | null
          asin_candidate?: string | null
          barcode_format?: string | null
          barcode_normalized_gtin14?: string | null
          barcode_quality?: string | null
          brand?: string | null
          brand_norm?: string | null
          canonical_dsld_label_id?: number | null
          category?: string | null
          category_raw?: string | null
          cgmp_compliance?: string | null
          checkdigit_valid_computed?: boolean | null
          dsld_label_id: number
          dsld_pdf?: string | null
          dsld_product_version_code?: string | null
          dsld_source_file?: string | null
          dsld_thumbnail?: string | null
          external_code_10char?: string | null
          form?: string | null
          has_pdf?: boolean | null
          has_thumbnail?: boolean | null
          ifos_fish_oil?: string | null
          inactive_ingredients?: string | null
          informed_sport?: string | null
          is_canonical_for_barcode?: boolean | null
          name_norm?: string | null
          nsf_certified_for_sport?: string | null
          package_quantity?: number | null
          package_unit?: string | null
          product_name?: string | null
          serving_size_count?: number | null
          serving_size_raw?: string | null
          servings_per_container?: number | null
          third_party_testing?: string | null
          upc_digits_str?: string | null
          upc_len?: number | null
          upc_raw_dsld?: string | null
        }
        Update: {
          active_ingredients_summary?: string | null
          asin_candidate?: string | null
          barcode_format?: string | null
          barcode_normalized_gtin14?: string | null
          barcode_quality?: string | null
          brand?: string | null
          brand_norm?: string | null
          canonical_dsld_label_id?: number | null
          category?: string | null
          category_raw?: string | null
          cgmp_compliance?: string | null
          checkdigit_valid_computed?: boolean | null
          dsld_label_id?: number
          dsld_pdf?: string | null
          dsld_product_version_code?: string | null
          dsld_source_file?: string | null
          dsld_thumbnail?: string | null
          external_code_10char?: string | null
          form?: string | null
          has_pdf?: boolean | null
          has_thumbnail?: boolean | null
          ifos_fish_oil?: string | null
          inactive_ingredients?: string | null
          informed_sport?: string | null
          is_canonical_for_barcode?: boolean | null
          name_norm?: string | null
          nsf_certified_for_sport?: string | null
          package_quantity?: number | null
          package_unit?: string | null
          product_name?: string | null
          serving_size_count?: number | null
          serving_size_raw?: string | null
          servings_per_container?: number | null
          third_party_testing?: string | null
          upc_digits_str?: string | null
          upc_len?: number | null
          upc_raw_dsld?: string | null
        }
        Relationships: []
      }
      generic_form_tokens: {
        Row: {
          alias_confidence: number | null
          created_at: string
          id: string
          notes: string | null
          token_normalized: string
          token_raw: string
          updated_at: string
        }
        Insert: {
          alias_confidence?: number | null
          created_at?: string
          id?: string
          notes?: string | null
          token_normalized: string
          token_raw: string
          updated_at?: string
        }
        Update: {
          alias_confidence?: number | null
          created_at?: string
          id?: string
          notes?: string | null
          token_normalized?: string
          token_raw?: string
          updated_at?: string
        }
        Relationships: []
      }
      iherb_overlay_merge_audit: {
        Row: {
          authoritative_identity_key: string | null
          authoritative_source_type: string | null
          barcode_gtin14: string | null
          created_at: string
          id: number
          match_status: string
          merge_payload: Json
          product_id: string
          reason_code: string | null
          run_id: string
        }
        Insert: {
          authoritative_identity_key?: string | null
          authoritative_source_type?: string | null
          barcode_gtin14?: string | null
          created_at?: string
          id?: number
          match_status: string
          merge_payload?: Json
          product_id: string
          reason_code?: string | null
          run_id: string
        }
        Update: {
          authoritative_identity_key?: string | null
          authoritative_source_type?: string | null
          barcode_gtin14?: string | null
          created_at?: string
          id?: number
          match_status?: string
          merge_payload?: Json
          product_id?: string
          reason_code?: string | null
          run_id?: string
        }
        Relationships: []
      }
      iherb_overlay_products: {
        Row: {
          barcode_gtin14: string | null
          brand_name: string
          categories: Json
          created_at: string
          description_sections: Json
          id: number
          link: string | null
          overlay_sha256: string | null
          product_catalog_image: string | null
          product_id: string
          product_images: Json
          serving: Json
          source_extracted_at: string | null
          source_zip_path: string | null
          supplement_facts: Json
          title: string
          upc_code: string | null
          updated_at: string
        }
        Insert: {
          barcode_gtin14?: string | null
          brand_name: string
          categories?: Json
          created_at?: string
          description_sections?: Json
          id?: number
          link?: string | null
          overlay_sha256?: string | null
          product_catalog_image?: string | null
          product_id: string
          product_images?: Json
          serving?: Json
          source_extracted_at?: string | null
          source_zip_path?: string | null
          supplement_facts?: Json
          title: string
          upc_code?: string | null
          updated_at?: string
        }
        Update: {
          barcode_gtin14?: string | null
          brand_name?: string
          categories?: Json
          created_at?: string
          description_sections?: Json
          id?: number
          link?: string | null
          overlay_sha256?: string | null
          product_catalog_image?: string | null
          product_id?: string
          product_images?: Json
          serving?: Json
          source_extracted_at?: string | null
          source_zip_path?: string | null
          supplement_facts?: Json
          title?: string
          upc_code?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      ingredient_dataset_import_issues: {
        Row: {
          canonical_key: string | null
          created_at: string
          id: string
          ingredient_id: string | null
          issue_type: string
          message: string
          payload_json: Json | null
          resolved_at: string | null
          run_id: string | null
          severity: string
          status: string
        }
        Insert: {
          canonical_key?: string | null
          created_at?: string
          id?: string
          ingredient_id?: string | null
          issue_type: string
          message: string
          payload_json?: Json | null
          resolved_at?: string | null
          run_id?: string | null
          severity: string
          status?: string
        }
        Update: {
          canonical_key?: string | null
          created_at?: string
          id?: string
          ingredient_id?: string | null
          issue_type?: string
          message?: string
          payload_json?: Json | null
          resolved_at?: string | null
          run_id?: string | null
          severity?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "ingredient_dataset_import_issues_ingredient_id_fkey"
            columns: ["ingredient_id"]
            isOneToOne: false
            referencedRelation: "ingredients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ingredient_dataset_import_issues_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "ingredient_dataset_import_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      ingredient_dataset_import_runs: {
        Row: {
          created_at: string
          dataset_version: string | null
          finished_at: string | null
          id: string
          started_at: string
          stats_json: Json | null
          strict: boolean
          updated_at: string
        }
        Insert: {
          created_at?: string
          dataset_version?: string | null
          finished_at?: string | null
          id?: string
          started_at?: string
          stats_json?: Json | null
          strict?: boolean
          updated_at?: string
        }
        Update: {
          created_at?: string
          dataset_version?: string | null
          finished_at?: string | null
          id?: string
          started_at?: string
          stats_json?: Json | null
          strict?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      ingredient_evidence: {
        Row: {
          audit_status: string
          created_at: string
          evidence_grade: string | null
          goal: string
          id: string
          ingredient_id: string
          min_effective_dose: number | null
          optimal_dose_range: unknown
          updated_at: string
        }
        Insert: {
          audit_status?: string
          created_at?: string
          evidence_grade?: string | null
          goal: string
          id?: string
          ingredient_id: string
          min_effective_dose?: number | null
          optimal_dose_range?: unknown
          updated_at?: string
        }
        Update: {
          audit_status?: string
          created_at?: string
          evidence_grade?: string | null
          goal?: string
          id?: string
          ingredient_id?: string
          min_effective_dose?: number | null
          optimal_dose_range?: unknown
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ingredient_evidence_ingredient_id_fkey"
            columns: ["ingredient_id"]
            isOneToOne: false
            referencedRelation: "ingredients"
            referencedColumns: ["id"]
          },
        ]
      }
      ingredient_evidence_citations: {
        Row: {
          citation_id: string
          evidence_id: string
        }
        Insert: {
          citation_id: string
          evidence_id: string
        }
        Update: {
          citation_id?: string
          evidence_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ingredient_evidence_citations_citation_id_fkey"
            columns: ["citation_id"]
            isOneToOne: false
            referencedRelation: "citations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ingredient_evidence_citations_evidence_id_fkey"
            columns: ["evidence_id"]
            isOneToOne: false
            referencedRelation: "ingredient_evidence"
            referencedColumns: ["id"]
          },
        ]
      }
      ingredient_form_aliases: {
        Row: {
          alias_norm: string
          alias_text: string
          audit_status: string
          confidence: number | null
          created_at: string
          form_key: string
          id: string
          ingredient_id: string | null
          source: string | null
          updated_at: string
        }
        Insert: {
          alias_norm: string
          alias_text: string
          audit_status?: string
          confidence?: number | null
          created_at?: string
          form_key: string
          id?: string
          ingredient_id?: string | null
          source?: string | null
          updated_at?: string
        }
        Update: {
          alias_norm?: string
          alias_text?: string
          audit_status?: string
          confidence?: number | null
          created_at?: string
          form_key?: string
          id?: string
          ingredient_id?: string | null
          source?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ingredient_form_aliases_ingredient_id_fkey"
            columns: ["ingredient_id"]
            isOneToOne: false
            referencedRelation: "ingredients"
            referencedColumns: ["id"]
          },
        ]
      }
      ingredient_form_citations: {
        Row: {
          citation_id: string
          form_id: string
        }
        Insert: {
          citation_id: string
          form_id: string
        }
        Update: {
          citation_id?: string
          form_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ingredient_form_citations_citation_id_fkey"
            columns: ["citation_id"]
            isOneToOne: false
            referencedRelation: "citations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ingredient_form_citations_form_id_fkey"
            columns: ["form_id"]
            isOneToOne: false
            referencedRelation: "ingredient_forms"
            referencedColumns: ["id"]
          },
        ]
      }
      ingredient_forms: {
        Row: {
          audit_status: string
          confidence: number
          created_at: string
          evidence_grade: string | null
          form_key: string
          form_label: string
          id: string
          ingredient_id: string
          relative_factor: number
          updated_at: string
        }
        Insert: {
          audit_status?: string
          confidence?: number
          created_at?: string
          evidence_grade?: string | null
          form_key: string
          form_label: string
          id?: string
          ingredient_id: string
          relative_factor?: number
          updated_at?: string
        }
        Update: {
          audit_status?: string
          confidence?: number
          created_at?: string
          evidence_grade?: string | null
          form_key?: string
          form_label?: string
          id?: string
          ingredient_id?: string
          relative_factor?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ingredient_forms_ingredient_id_fkey"
            columns: ["ingredient_id"]
            isOneToOne: false
            referencedRelation: "ingredients"
            referencedColumns: ["id"]
          },
        ]
      }
      ingredient_synonyms: {
        Row: {
          alias_type: string | null
          confidence: number | null
          created_at: string
          id: string
          ingredient_id: string
          source: string | null
          synonym: string
          updated_at: string
        }
        Insert: {
          alias_type?: string | null
          confidence?: number | null
          created_at?: string
          id?: string
          ingredient_id: string
          source?: string | null
          synonym: string
          updated_at?: string
        }
        Update: {
          alias_type?: string | null
          confidence?: number | null
          created_at?: string
          id?: string
          ingredient_id?: string
          source?: string | null
          synonym?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ingredient_synonyms_ingredient_id_fkey"
            columns: ["ingredient_id"]
            isOneToOne: false
            referencedRelation: "ingredients"
            referencedColumns: ["id"]
          },
        ]
      }
      ingredient_unit_conversions: {
        Row: {
          condition: string | null
          created_at: string
          factor: number
          from_unit: string
          id: string
          ingredient_id: string
          to_unit: string
          updated_at: string
        }
        Insert: {
          condition?: string | null
          created_at?: string
          factor: number
          from_unit: string
          id?: string
          ingredient_id: string
          to_unit: string
          updated_at?: string
        }
        Update: {
          condition?: string | null
          created_at?: string
          factor?: number
          from_unit?: string
          id?: string
          ingredient_id?: string
          to_unit?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ingredient_unit_conversions_ingredient_id_fkey"
            columns: ["ingredient_id"]
            isOneToOne: false
            referencedRelation: "ingredients"
            referencedColumns: ["id"]
          },
        ]
      }
      ingredients: {
        Row: {
          benefits: string | null
          canonical_key: string | null
          category: string | null
          created_at: string
          dietary_sources: string | null
          goals: string[] | null
          id: string
          ingredient_type: string | null
          name: string
          rda_adult: number | null
          risks: string | null
          scientific_name: string | null
          ul_adult: number | null
          unit: string | null
          units_supported: string[] | null
          updated_at: string
        }
        Insert: {
          benefits?: string | null
          canonical_key?: string | null
          category?: string | null
          created_at?: string
          dietary_sources?: string | null
          goals?: string[] | null
          id?: string
          ingredient_type?: string | null
          name: string
          rda_adult?: number | null
          risks?: string | null
          scientific_name?: string | null
          ul_adult?: number | null
          unit?: string | null
          units_supported?: string[] | null
          updated_at?: string
        }
        Update: {
          benefits?: string | null
          canonical_key?: string | null
          category?: string | null
          created_at?: string
          dietary_sources?: string | null
          goals?: string[] | null
          id?: string
          ingredient_type?: string | null
          name?: string
          rda_adult?: number | null
          risks?: string | null
          scientific_name?: string | null
          ul_adult?: number | null
          unit?: string | null
          units_supported?: string[] | null
          updated_at?: string
        }
        Relationships: []
      }
      interactions: {
        Row: {
          affected_pillar: string | null
          audit_status: string
          condition_json: Json | null
          condition_logic: string | null
          created_at: string
          direction: string | null
          effect_type: string | null
          effect_value: number | null
          evidence_grade: string | null
          ingredient_a_id: string | null
          ingredient_a_key: string | null
          ingredient_a_name: string | null
          ingredient_b_id: string | null
          ingredient_b_key: string | null
          ingredient_b_name: string | null
          interaction_id: string
          interaction_type: string | null
          notes: string | null
          rationale: string | null
          reference_ids: string[] | null
          rule_confidence: number | null
          updated_at: string
        }
        Insert: {
          affected_pillar?: string | null
          audit_status?: string
          condition_json?: Json | null
          condition_logic?: string | null
          created_at?: string
          direction?: string | null
          effect_type?: string | null
          effect_value?: number | null
          evidence_grade?: string | null
          ingredient_a_id?: string | null
          ingredient_a_key?: string | null
          ingredient_a_name?: string | null
          ingredient_b_id?: string | null
          ingredient_b_key?: string | null
          ingredient_b_name?: string | null
          interaction_id: string
          interaction_type?: string | null
          notes?: string | null
          rationale?: string | null
          reference_ids?: string[] | null
          rule_confidence?: number | null
          updated_at?: string
        }
        Update: {
          affected_pillar?: string | null
          audit_status?: string
          condition_json?: Json | null
          condition_logic?: string | null
          created_at?: string
          direction?: string | null
          effect_type?: string | null
          effect_value?: number | null
          evidence_grade?: string | null
          ingredient_a_id?: string | null
          ingredient_a_key?: string | null
          ingredient_a_name?: string | null
          ingredient_b_id?: string | null
          ingredient_b_key?: string | null
          ingredient_b_name?: string | null
          interaction_id?: string
          interaction_type?: string | null
          notes?: string | null
          rationale?: string | null
          reference_ids?: string[] | null
          rule_confidence?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "interactions_ingredient_a_id_fkey"
            columns: ["ingredient_a_id"]
            isOneToOne: false
            referencedRelation: "ingredients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "interactions_ingredient_b_id_fkey"
            columns: ["ingredient_b_id"]
            isOneToOne: false
            referencedRelation: "ingredients"
            referencedColumns: ["id"]
          },
        ]
      }
      invalid_source_ids: {
        Row: {
          created_at: string
          reason: string | null
          source: string
          source_id: string
        }
        Insert: {
          created_at?: string
          reason?: string | null
          source: string
          source_id: string
        }
        Update: {
          created_at?: string
          reason?: string | null
          source?: string
          source_id?: string
        }
        Relationships: []
      }
      label_analysis_cache: {
        Row: {
          analysis: Json
          analysis_cache_key: string
          analysis_issues: string[]
          analysis_status: string | null
          analysis_version: string
          created_at: string
          llm_ms: number | null
          parse_cache_key: string
          updated_at: string
        }
        Insert: {
          analysis: Json
          analysis_cache_key: string
          analysis_issues?: string[]
          analysis_status?: string | null
          analysis_version: string
          created_at?: string
          llm_ms?: number | null
          parse_cache_key: string
          updated_at?: string
        }
        Update: {
          analysis?: Json
          analysis_cache_key?: string
          analysis_issues?: string[]
          analysis_status?: string | null
          analysis_version?: string
          created_at?: string
          llm_ms?: number | null
          parse_cache_key?: string
          updated_at?: string
        }
        Relationships: []
      }
      label_parse_cache: {
        Row: {
          created_at: string
          diagnostics: Json | null
          ocr_cache_key: string
          parse_cache_key: string
          parsed_ingredients: Json
          parser_version: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          diagnostics?: Json | null
          ocr_cache_key: string
          parse_cache_key: string
          parsed_ingredients: Json
          parser_version: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          diagnostics?: Json | null
          ocr_cache_key?: string
          parse_cache_key?: string
          parsed_ingredients?: Json
          parser_version?: string
          updated_at?: string
        }
        Relationships: []
      }
      label_scan_metrics: {
        Row: {
          analysis_cache_hit: boolean | null
          analysis_for_draft_revision: number | null
          analysis_status: string | null
          app_state: string | null
          cache_mode: string | null
          client_started_at_ms: number | null
          created_at: string
          flag_variant: string | null
          id: number
          image_hash: string
          issue_types: string[]
          job_id: string | null
          lane_split_chosen: string | null
          lane_split_reverted_reason: string | null
          lane_split_triggered: boolean | null
          locked_field_conflict_count: number | null
          meta: Json | null
          needs_confirmation: boolean
          ocr_cache_hit: boolean | null
          ocr_call_count: number | null
          parse_cache_hit: boolean | null
          parse_coverage: number | null
          parser_version: string
          patch_id: string | null
          patch_type: string | null
          preprocess_profile: string
          request_id: string
          response_status: string
          t_click_to_analysis_complete_render_ms: number | null
          t_click_to_draft_render_ms: number | null
          t_click_to_draft_response_ms: number | null
          t_client_roundtrip_ms: number | null
          t_decode_ms: number | null
          t_first_draft_server_ms: number | null
          t_llm_ms: number | null
          t_ocr_ms: number | null
          t_parse_ms: number | null
        }
        Insert: {
          analysis_cache_hit?: boolean | null
          analysis_for_draft_revision?: number | null
          analysis_status?: string | null
          app_state?: string | null
          cache_mode?: string | null
          client_started_at_ms?: number | null
          created_at?: string
          flag_variant?: string | null
          id?: number
          image_hash: string
          issue_types?: string[]
          job_id?: string | null
          lane_split_chosen?: string | null
          lane_split_reverted_reason?: string | null
          lane_split_triggered?: boolean | null
          locked_field_conflict_count?: number | null
          meta?: Json | null
          needs_confirmation?: boolean
          ocr_cache_hit?: boolean | null
          ocr_call_count?: number | null
          parse_cache_hit?: boolean | null
          parse_coverage?: number | null
          parser_version: string
          patch_id?: string | null
          patch_type?: string | null
          preprocess_profile: string
          request_id: string
          response_status: string
          t_click_to_analysis_complete_render_ms?: number | null
          t_click_to_draft_render_ms?: number | null
          t_click_to_draft_response_ms?: number | null
          t_client_roundtrip_ms?: number | null
          t_decode_ms?: number | null
          t_first_draft_server_ms?: number | null
          t_llm_ms?: number | null
          t_ocr_ms?: number | null
          t_parse_ms?: number | null
        }
        Update: {
          analysis_cache_hit?: boolean | null
          analysis_for_draft_revision?: number | null
          analysis_status?: string | null
          app_state?: string | null
          cache_mode?: string | null
          client_started_at_ms?: number | null
          created_at?: string
          flag_variant?: string | null
          id?: number
          image_hash?: string
          issue_types?: string[]
          job_id?: string | null
          lane_split_chosen?: string | null
          lane_split_reverted_reason?: string | null
          lane_split_triggered?: boolean | null
          locked_field_conflict_count?: number | null
          meta?: Json | null
          needs_confirmation?: boolean
          ocr_cache_hit?: boolean | null
          ocr_call_count?: number | null
          parse_cache_hit?: boolean | null
          parse_coverage?: number | null
          parser_version?: string
          patch_id?: string | null
          patch_type?: string | null
          preprocess_profile?: string
          request_id?: string
          response_status?: string
          t_click_to_analysis_complete_render_ms?: number | null
          t_click_to_draft_render_ms?: number | null
          t_click_to_draft_response_ms?: number | null
          t_client_roundtrip_ms?: number | null
          t_decode_ms?: number | null
          t_first_draft_server_ms?: number | null
          t_llm_ms?: number | null
          t_ocr_ms?: number | null
          t_parse_ms?: number | null
        }
        Relationships: []
      }
      lnhpd_facts: {
        Row: {
          brand_name: string | null
          dataset_version: string | null
          extracted_at: string
          facts_json: Json
          is_complete: boolean | null
          is_on_market: boolean | null
          lnhpd_id: number
          missing_fields: string[] | null
          npn: string | null
          product_name: string | null
        }
        Insert: {
          brand_name?: string | null
          dataset_version?: string | null
          extracted_at?: string
          facts_json: Json
          is_complete?: boolean | null
          is_on_market?: boolean | null
          lnhpd_id: number
          missing_fields?: string[] | null
          npn?: string | null
          product_name?: string | null
        }
        Update: {
          brand_name?: string | null
          dataset_version?: string | null
          extracted_at?: string
          facts_json?: Json
          is_complete?: boolean | null
          is_on_market?: boolean | null
          lnhpd_id?: number
          missing_fields?: string[] | null
          npn?: string | null
          product_name?: string | null
        }
        Relationships: []
      }
      lnhpd_quality_snapshots: {
        Row: {
          active_complete: number
          active_total: number
          captured_at: string
          id: number
          missing_medicinal: number
          missing_nonmedicinal: number
          missing_purpose: number
        }
        Insert: {
          active_complete: number
          active_total: number
          captured_at?: string
          id?: number
          missing_medicinal: number
          missing_nonmedicinal: number
          missing_purpose: number
        }
        Update: {
          active_complete?: number
          active_total?: number
          captured_at?: string
          id?: number
          missing_medicinal?: number
          missing_nonmedicinal?: number
          missing_purpose?: number
        }
        Relationships: []
      }
      lnhpd_raw_records: {
        Row: {
          dataset_version: string | null
          endpoint: string
          fetched_at: string
          id: number
          lnhpd_id: number | null
          payload: Json
          record_hash: string
        }
        Insert: {
          dataset_version?: string | null
          endpoint: string
          fetched_at?: string
          id?: number
          lnhpd_id?: number | null
          payload: Json
          record_hash: string
        }
        Update: {
          dataset_version?: string | null
          endpoint?: string
          fetched_at?: string
          id?: number
          lnhpd_id?: number | null
          payload?: Json
          record_hash?: string
        }
        Relationships: []
      }
      manual_review_queue: {
        Row: {
          created_at: string
          entity_type: string
          id: string
          name_key: string | null
          name_raw: string | null
          payload_json: Json | null
          source: string | null
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          entity_type: string
          id?: string
          name_key?: string | null
          name_raw?: string | null
          payload_json?: Json | null
          source?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          entity_type?: string
          id?: string
          name_key?: string | null
          name_raw?: string | null
          payload_json?: Json | null
          source?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      negative_cache: {
        Row: {
          attempt_count: number
          barcode_gtin14: string
          barcode_raw: string | null
          last_attempt_at: string
          reason_code: string
          until: string
          updated_at: string
        }
        Insert: {
          attempt_count?: number
          barcode_gtin14: string
          barcode_raw?: string | null
          last_attempt_at?: string
          reason_code: string
          until: string
          updated_at?: string
        }
        Update: {
          attempt_count?: number
          barcode_gtin14?: string
          barcode_raw?: string | null
          last_attempt_at?: string
          reason_code?: string
          until?: string
          updated_at?: string
        }
        Relationships: []
      }
      normalization_rules: {
        Row: {
          created_at: string
          description: string | null
          pattern: string
          replacement: string
          rule_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          pattern: string
          replacement: string
          rule_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          pattern?: string
          replacement?: string
          rule_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      npn_negative_cache: {
        Row: {
          attempt_count: number
          last_attempt_at: string
          npn: string
          reason_code: string
          until: string | null
          updated_at: string
        }
        Insert: {
          attempt_count?: number
          last_attempt_at?: string
          npn: string
          reason_code: string
          until?: string | null
          updated_at?: string
        }
        Update: {
          attempt_count?: number
          last_attempt_at?: string
          npn?: string
          reason_code?: string
          until?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      nutrient_targets: {
        Row: {
          audit_status: string
          authority: string | null
          created_at: string
          id: string
          ingredient_id: string | null
          ingredient_key: string | null
          jurisdiction: string | null
          notes: string | null
          reference_ids: string[] | null
          target_type: string | null
          target_value: number | null
          unit: string | null
          updated_at: string
        }
        Insert: {
          audit_status?: string
          authority?: string | null
          created_at?: string
          id?: string
          ingredient_id?: string | null
          ingredient_key?: string | null
          jurisdiction?: string | null
          notes?: string | null
          reference_ids?: string[] | null
          target_type?: string | null
          target_value?: number | null
          unit?: string | null
          updated_at?: string
        }
        Update: {
          audit_status?: string
          authority?: string | null
          created_at?: string
          id?: string
          ingredient_id?: string | null
          ingredient_key?: string | null
          jurisdiction?: string | null
          notes?: string | null
          reference_ids?: string[] | null
          target_type?: string | null
          target_value?: number | null
          unit?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "nutrient_targets_ingredient_id_fkey"
            columns: ["ingredient_id"]
            isOneToOne: false
            referencedRelation: "ingredients"
            referencedColumns: ["id"]
          },
        ]
      }
      ocr_cache: {
        Row: {
          analysis: Json | null
          confidence: number
          created_at: string
          image_hash: string
          ocr_engine: string | null
          ocr_params_version: string | null
          original_image_hash: string | null
          parsed_ingredients: Json
          parser_version: string | null
          preprocess_profile: string | null
          vision_raw: Json | null
        }
        Insert: {
          analysis?: Json | null
          confidence?: number
          created_at?: string
          image_hash: string
          ocr_engine?: string | null
          ocr_params_version?: string | null
          original_image_hash?: string | null
          parsed_ingredients: Json
          parser_version?: string | null
          preprocess_profile?: string | null
          vision_raw?: Json | null
        }
        Update: {
          analysis?: Json | null
          confidence?: number
          created_at?: string
          image_hash?: string
          ocr_engine?: string | null
          ocr_params_version?: string | null
          original_image_hash?: string | null
          parsed_ingredients?: Json
          parser_version?: string | null
          preprocess_profile?: string | null
          vision_raw?: Json | null
        }
        Relationships: []
      }
      personalization_bundle_runs: {
        Row: {
          activated_at: string | null
          artifact_byte_size: number | null
          artifact_checksum: string | null
          artifact_kind: string
          artifact_path: string | null
          build_meta: Json
          created_at: string
          generated_at: string
          id: string
          is_active: boolean
          not_enough_structured_data_count: number
          prepared_candidate_count: number
          rules_version: string
          schema_version: string
          source_row_count: number
          source_table: string
          storage_bucket: string | null
          storage_path: string | null
        }
        Insert: {
          activated_at?: string | null
          artifact_byte_size?: number | null
          artifact_checksum?: string | null
          artifact_kind: string
          artifact_path?: string | null
          build_meta?: Json
          created_at?: string
          generated_at: string
          id?: string
          is_active?: boolean
          not_enough_structured_data_count?: number
          prepared_candidate_count?: number
          rules_version: string
          schema_version: string
          source_row_count?: number
          source_table: string
          storage_bucket?: string | null
          storage_path?: string | null
        }
        Update: {
          activated_at?: string | null
          artifact_byte_size?: number | null
          artifact_checksum?: string | null
          artifact_kind?: string
          artifact_path?: string | null
          build_meta?: Json
          created_at?: string
          generated_at?: string
          id?: string
          is_active?: boolean
          not_enough_structured_data_count?: number
          prepared_candidate_count?: number
          rules_version?: string
          schema_version?: string
          source_row_count?: number
          source_table?: string
          storage_bucket?: string | null
          storage_path?: string | null
        }
        Relationships: []
      }
      personalization_candidate_gaps: {
        Row: {
          brand_name: string | null
          bundle_run_id: string
          created_at: string
          details: Json
          facts_status: string
          gap_codes: string[]
          id: string
          product_id: string
          source_product_id: string | null
          title: string | null
        }
        Insert: {
          brand_name?: string | null
          bundle_run_id: string
          created_at?: string
          details?: Json
          facts_status: string
          gap_codes?: string[]
          id?: string
          product_id: string
          source_product_id?: string | null
          title?: string | null
        }
        Update: {
          brand_name?: string | null
          bundle_run_id?: string
          created_at?: string
          details?: Json
          facts_status?: string
          gap_codes?: string[]
          id?: string
          product_id?: string
          source_product_id?: string | null
          title?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "personalization_candidate_gaps_bundle_run_id_fkey"
            columns: ["bundle_run_id"]
            isOneToOne: false
            referencedRelation: "personalization_bundle_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      product_ingredients: {
        Row: {
          amount: number | null
          amount_normalized: number | null
          amount_unknown: boolean
          basis: string
          canonical_source_id: string | null
          created_at: string
          form_raw: string | null
          id: string
          ingredient_id: string | null
          is_active: boolean
          is_proprietary_blend: boolean
          match_confidence: number | null
          match_method: string | null
          name_key: string
          name_raw: string
          parse_confidence: number | null
          source: string
          source_id: string
          unit: string | null
          unit_kind: string | null
          unit_normalized: string | null
          unit_raw: string | null
          updated_at: string
        }
        Insert: {
          amount?: number | null
          amount_normalized?: number | null
          amount_unknown?: boolean
          basis?: string
          canonical_source_id?: string | null
          created_at?: string
          form_raw?: string | null
          id?: string
          ingredient_id?: string | null
          is_active?: boolean
          is_proprietary_blend?: boolean
          match_confidence?: number | null
          match_method?: string | null
          name_key: string
          name_raw: string
          parse_confidence?: number | null
          source: string
          source_id: string
          unit?: string | null
          unit_kind?: string | null
          unit_normalized?: string | null
          unit_raw?: string | null
          updated_at?: string
        }
        Update: {
          amount?: number | null
          amount_normalized?: number | null
          amount_unknown?: boolean
          basis?: string
          canonical_source_id?: string | null
          created_at?: string
          form_raw?: string | null
          id?: string
          ingredient_id?: string | null
          is_active?: boolean
          is_proprietary_blend?: boolean
          match_confidence?: number | null
          match_method?: string | null
          name_key?: string
          name_raw?: string
          parse_confidence?: number | null
          source?: string
          source_id?: string
          unit?: string | null
          unit_kind?: string | null
          unit_normalized?: string | null
          unit_raw?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_ingredients_ingredient_id_fkey"
            columns: ["ingredient_id"]
            isOneToOne: false
            referencedRelation: "ingredients"
            referencedColumns: ["id"]
          },
        ]
      }
      product_scores: {
        Row: {
          best_fit_goals: Json | null
          canonical_source_id: string | null
          computed_at: string
          confidence: number | null
          created_at: string
          effectiveness_score: number | null
          explain_json: Json | null
          flags_json: Json | null
          highlights_json: Json | null
          id: string
          inputs_hash: string | null
          integrity_score: number | null
          overall_score: number | null
          safety_score: number | null
          score_version: string
          source: string
          source_id: string
          updated_at: string
        }
        Insert: {
          best_fit_goals?: Json | null
          canonical_source_id?: string | null
          computed_at?: string
          confidence?: number | null
          created_at?: string
          effectiveness_score?: number | null
          explain_json?: Json | null
          flags_json?: Json | null
          highlights_json?: Json | null
          id?: string
          inputs_hash?: string | null
          integrity_score?: number | null
          overall_score?: number | null
          safety_score?: number | null
          score_version: string
          source: string
          source_id: string
          updated_at?: string
        }
        Update: {
          best_fit_goals?: Json | null
          canonical_source_id?: string | null
          computed_at?: string
          confidence?: number | null
          created_at?: string
          effectiveness_score?: number | null
          explain_json?: Json | null
          flags_json?: Json | null
          highlights_json?: Json | null
          id?: string
          inputs_hash?: string | null
          integrity_score?: number | null
          overall_score?: number | null
          safety_score?: number | null
          score_version?: string
          source?: string
          source_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      product_scores_shadow: {
        Row: {
          best_fit_goals: Json | null
          canonical_source_id: string | null
          computed_at: string
          confidence: number | null
          created_at: string
          effectiveness_score: number | null
          explain_json: Json | null
          flags_json: Json | null
          highlights_json: Json | null
          id: string
          inputs_hash: string | null
          integrity_score: number | null
          overall_score: number | null
          safety_score: number | null
          score_version: string
          source: string
          source_id: string
          updated_at: string
        }
        Insert: {
          best_fit_goals?: Json | null
          canonical_source_id?: string | null
          computed_at?: string
          confidence?: number | null
          created_at?: string
          effectiveness_score?: number | null
          explain_json?: Json | null
          flags_json?: Json | null
          highlights_json?: Json | null
          id?: string
          inputs_hash?: string | null
          integrity_score?: number | null
          overall_score?: number | null
          safety_score?: number | null
          score_version: string
          source: string
          source_id: string
          updated_at?: string
        }
        Update: {
          best_fit_goals?: Json | null
          canonical_source_id?: string | null
          computed_at?: string
          confidence?: number | null
          created_at?: string
          effectiveness_score?: number | null
          explain_json?: Json | null
          flags_json?: Json | null
          highlights_json?: Json | null
          id?: string
          inputs_hash?: string | null
          integrity_score?: number | null
          overall_score?: number | null
          safety_score?: number | null
          score_version?: string
          source?: string
          source_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      resolution_cache: {
        Row: {
          barcode_gtin14: string
          best_domain: string | null
          best_url: string | null
          confidence: number | null
          engine_version: string
          expires_at: string | null
          fail_count: number
          last_failure_at: string | null
          last_success_at: string | null
          signals: Json | null
          success_count: number
          updated_at: string
        }
        Insert: {
          barcode_gtin14: string
          best_domain?: string | null
          best_url?: string | null
          confidence?: number | null
          engine_version: string
          expires_at?: string | null
          fail_count?: number
          last_failure_at?: string | null
          last_success_at?: string | null
          signals?: Json | null
          success_count?: number
          updated_at?: string
        }
        Update: {
          barcode_gtin14?: string
          best_domain?: string | null
          best_url?: string | null
          confidence?: number | null
          engine_version?: string
          expires_at?: string | null
          fail_count?: number
          last_failure_at?: string | null
          last_success_at?: string | null
          signals?: Json | null
          success_count?: number
          updated_at?: string
        }
        Relationships: []
      }
      scoring_dataset_state: {
        Row: {
          key: string
          updated_at: string
          version: string | null
        }
        Insert: {
          key: string
          updated_at?: string
          version?: string | null
        }
        Update: {
          key?: string
          updated_at?: string
          version?: string | null
        }
        Relationships: []
      }
      serp_cache: {
        Row: {
          barcode_gtin14: string
          cache_key: string
          engine_version: string
          expires_at: string
          fetched_at: string
          gl: string | null
          hl: string | null
          profile_id: string
          query: string
          results: Json
        }
        Insert: {
          barcode_gtin14: string
          cache_key: string
          engine_version: string
          expires_at: string
          fetched_at?: string
          gl?: string | null
          hl?: string | null
          profile_id: string
          query: string
          results: Json
        }
        Update: {
          barcode_gtin14?: string
          cache_key?: string
          engine_version?: string
          expires_at?: string
          fetched_at?: string
          gl?: string | null
          hl?: string | null
          profile_id?: string
          query?: string
          results?: Json
        }
        Relationships: []
      }
      snapshots: {
        Row: {
          analysis_json: Json | null
          created_at: string
          expires_at: string | null
          id: string
          key: string
          payload_json: Json
          source: string
          updated_at: string
        }
        Insert: {
          analysis_json?: Json | null
          created_at?: string
          expires_at?: string | null
          id: string
          key: string
          payload_json: Json
          source: string
          updated_at?: string
        }
        Update: {
          analysis_json?: Json | null
          created_at?: string
          expires_at?: string | null
          id?: string
          key?: string
          payload_json?: Json
          source?: string
          updated_at?: string
        }
        Relationships: []
      }
      supplements: {
        Row: {
          barcode: string | null
          brand_id: string
          category: string | null
          created_at: string
          description: string | null
          fingerprint: string | null
          id: string
          image_url: string | null
          name: string
          updated_at: string
          verified: boolean
        }
        Insert: {
          barcode?: string | null
          brand_id: string
          category?: string | null
          created_at?: string
          description?: string | null
          fingerprint?: string | null
          id?: string
          image_url?: string | null
          name: string
          updated_at?: string
          verified?: boolean
        }
        Update: {
          barcode?: string | null
          brand_id?: string
          category?: string | null
          created_at?: string
          description?: string | null
          fingerprint?: string | null
          id?: string
          image_url?: string | null
          name?: string
          updated_at?: string
          verified?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "supplements_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
        ]
      }
      target_profiles: {
        Row: {
          audit_status: string
          created_at: string
          default_for: string | null
          description: string | null
          notes: string | null
          profile_id: string
          profile_name: string | null
          reference_ids: string[] | null
          updated_at: string
        }
        Insert: {
          audit_status?: string
          created_at?: string
          default_for?: string | null
          description?: string | null
          notes?: string | null
          profile_id: string
          profile_name?: string | null
          reference_ids?: string[] | null
          updated_at?: string
        }
        Update: {
          audit_status?: string
          created_at?: string
          default_for?: string | null
          description?: string | null
          notes?: string | null
          profile_id?: string
          profile_name?: string | null
          reference_ids?: string[] | null
          updated_at?: string
        }
        Relationships: []
      }
      token_aliases: {
        Row: {
          alias_confidence: number | null
          created_at: string
          id: string
          ingredient_id: string | null
          notes: string | null
          token_normalized: string
          token_raw: string
          updated_at: string
        }
        Insert: {
          alias_confidence?: number | null
          created_at?: string
          id?: string
          ingredient_id?: string | null
          notes?: string | null
          token_normalized: string
          token_raw: string
          updated_at?: string
        }
        Update: {
          alias_confidence?: number | null
          created_at?: string
          id?: string
          ingredient_id?: string | null
          notes?: string | null
          token_normalized?: string
          token_raw?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "token_aliases_ingredient_id_fkey"
            columns: ["ingredient_id"]
            isOneToOne: false
            referencedRelation: "ingredients"
            referencedColumns: ["id"]
          },
        ]
      }
      ul__toxicity: {
        Row: {
          age_range: string | null
          audit_status: string
          authority: string | null
          confidence: number | null
          created_at: string
          ingredient_id: string | null
          ingredient_key: string | null
          notes: string | null
          population: string | null
          reference_ids: string[] | null
          scope: string | null
          ul_id: string
          ul_value: number | null
          unit: string
          updated_at: string
        }
        Insert: {
          age_range?: string | null
          audit_status?: string
          authority?: string | null
          confidence?: number | null
          created_at?: string
          ingredient_id?: string | null
          ingredient_key?: string | null
          notes?: string | null
          population?: string | null
          reference_ids?: string[] | null
          scope?: string | null
          ul_id: string
          ul_value?: number | null
          unit: string
          updated_at?: string
        }
        Update: {
          age_range?: string | null
          audit_status?: string
          authority?: string | null
          confidence?: number | null
          created_at?: string
          ingredient_id?: string | null
          ingredient_key?: string | null
          notes?: string | null
          population?: string | null
          reference_ids?: string[] | null
          scope?: string | null
          ul_id?: string
          ul_value?: number | null
          unit?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ul__toxicity_ingredient_id_fkey"
            columns: ["ingredient_id"]
            isOneToOne: false
            referencedRelation: "ingredients"
            referencedColumns: ["id"]
          },
        ]
      }
      user_checkins: {
        Row: {
          check_in_date: string
          created_at: string
          id: string
          supplement_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          check_in_date: string
          created_at?: string
          id?: string
          supplement_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          check_in_date?: string
          created_at?: string
          id?: string
          supplement_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_checkins_supplement_id_fkey"
            columns: ["supplement_id"]
            isOneToOne: false
            referencedRelation: "supplements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_checkins_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      user_personalization_events: {
        Row: {
          created_at: string
          event_name: string
          id: string
          payload: Json
          rules_version: string | null
          snapshot_id: string | null
          support_state: string | null
          surface: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          event_name: string
          id?: string
          payload?: Json
          rules_version?: string | null
          snapshot_id?: string | null
          support_state?: string | null
          surface?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          event_name?: string
          id?: string
          payload?: Json
          rules_version?: string | null
          snapshot_id?: string | null
          support_state?: string | null
          surface?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_personalization_events_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      user_personalization_state: {
        Row: {
          created_at: string
          feedback_state: Json
          last_snapshot_id: string | null
          preference_vector: Json | null
          support_state: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          feedback_state?: Json
          last_snapshot_id?: string | null
          preference_vector?: Json | null
          support_state?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          feedback_state?: Json
          last_snapshot_id?: string | null
          preference_vector?: Json | null
          support_state?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_personalization_state_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      user_profiles: {
        Row: {
          activity_level: string | null
          age: number | null
          created_at: string
          dietary_preference: string | null
          gender: string | null
          height: number | null
          location: string | null
          timezone: string | null
          updated_at: string
          user_id: string
          weight: number | null
        }
        Insert: {
          activity_level?: string | null
          age?: number | null
          created_at?: string
          dietary_preference?: string | null
          gender?: string | null
          height?: number | null
          location?: string | null
          timezone?: string | null
          updated_at?: string
          user_id: string
          weight?: number | null
        }
        Update: {
          activity_level?: string | null
          age?: number | null
          created_at?: string
          dietary_preference?: string | null
          gender?: string | null
          height?: number | null
          location?: string | null
          timezone?: string | null
          updated_at?: string
          user_id?: string
          weight?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "user_profiles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      user_streak: {
        Row: {
          created_at: string
          current_streak: number
          last_check_in: string | null
          longest_streak: number
          total_check_ins: number
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          current_streak?: number
          last_check_in?: string | null
          longest_streak?: number
          total_check_ins?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          current_streak?: number
          last_check_in?: string | null
          longest_streak?: number
          total_check_ins?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_streak_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      user_supplements: {
        Row: {
          created_at: string
          id: string
          notes: string | null
          reminder_enabled: boolean
          reminder_frequency: string | null
          reminder_time: string | null
          saved_at: string
          supplement_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          notes?: string | null
          reminder_enabled?: boolean
          reminder_frequency?: string | null
          reminder_time?: string | null
          saved_at?: string
          supplement_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          notes?: string | null
          reminder_enabled?: boolean
          reminder_frequency?: string | null
          reminder_time?: string | null
          saved_at?: string
          supplement_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_supplements_supplement_id_fkey"
            columns: ["supplement_id"]
            isOneToOne: false
            referencedRelation: "supplements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_supplements_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      users: {
        Row: {
          created_at: string
          email: string
          id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          email: string
          id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      web_canonical_map: {
        Row: {
          barcode_gtin14: string
          best_url: string | null
          canonical_hash: string
          canonical_urls: Json
          created_at: string
          engine_version: string
          expires_at: string | null
          updated_at: string
        }
        Insert: {
          barcode_gtin14: string
          best_url?: string | null
          canonical_hash: string
          canonical_urls: Json
          created_at?: string
          engine_version: string
          expires_at?: string | null
          updated_at?: string
        }
        Update: {
          barcode_gtin14?: string
          best_url?: string | null
          canonical_hash?: string
          canonical_urls?: Json
          created_at?: string
          engine_version?: string
          expires_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      lnhpd_facts_complete: {
        Row: {
          brand_name: string | null
          dataset_version: string | null
          extracted_at: string | null
          facts_json: Json | null
          is_complete: boolean | null
          is_on_market: boolean | null
          lnhpd_id: number | null
          missing_fields: string[] | null
          npn: string | null
          product_name: string | null
        }
        Insert: {
          brand_name?: string | null
          dataset_version?: string | null
          extracted_at?: string | null
          facts_json?: Json | null
          is_complete?: boolean | null
          is_on_market?: boolean | null
          lnhpd_id?: number | null
          missing_fields?: string[] | null
          npn?: string | null
          product_name?: string | null
        }
        Update: {
          brand_name?: string | null
          dataset_version?: string | null
          extracted_at?: string | null
          facts_json?: Json | null
          is_complete?: boolean | null
          is_on_market?: boolean | null
          lnhpd_id?: number | null
          missing_fields?: string[] | null
          npn?: string | null
          product_name?: string | null
        }
        Relationships: []
      }
      lnhpd_quality_current: {
        Row: {
          active_complete: number | null
          active_total: number | null
          missing_medicinal: number | null
          missing_nonmedicinal: number | null
          missing_purpose: number | null
        }
        Relationships: []
      }
      lnhpd_quality_latest: {
        Row: {
          active_complete: number | null
          active_total: number | null
          captured_at: string | null
          id: number | null
          missing_medicinal: number | null
          missing_nonmedicinal: number | null
          missing_purpose: number | null
        }
        Relationships: []
      }
      missing_barcodes: {
        Row: {
          barcode_gtin14: string | null
          first_seen_at: string | null
          last_seen_at: string | null
          scan_count: number | null
        }
        Relationships: []
      }
      missing_barcodes_with_latest_snapshot: {
        Row: {
          barcode_gtin14: string | null
          first_seen_at: string | null
          guessed_brand: string | null
          guessed_image_url: string | null
          guessed_name: string | null
          last_seen_at: string | null
          scan_count: number | null
          snapshot_created_at: string | null
        }
        Relationships: []
      }
      missing_barcodes_with_snapshot: {
        Row: {
          barcode_gtin14: string | null
          first_seen_at: string | null
          guessed_brand: string | null
          guessed_image_url: string | null
          guessed_name: string | null
          last_seen_at: string | null
          scan_count: number | null
          snapshot_created_at: string | null
        }
        Relationships: []
      }
      non_dsld_barcodes: {
        Row: {
          barcode_gtin14: string | null
          first_seen_at: string | null
          guessed_brand: string | null
          guessed_category: string | null
          guessed_image_url: string | null
          guessed_name: string | null
          last_seen_at: string | null
          product_form: string | null
          scan_count: number | null
          snapshot_created_at: string | null
          snapshot_id: string | null
          snapshot_status: string | null
          snapshot_updated_at: string | null
        }
        Relationships: []
      }
      non_dsld_barcodes_v2: {
        Row: {
          barcode_gtin14: string | null
          first_seen_at: string | null
          guessed_brand: string | null
          guessed_category: string | null
          guessed_image_url: string | null
          guessed_name: string | null
          last_seen_at: string | null
          product_form: string | null
          scan_count: number | null
          snapshot_created_at: string | null
          snapshot_id: string | null
          snapshot_status: string | null
          snapshot_updated_at: string | null
        }
        Relationships: []
      }
      regression_dsld_form_candidates_v: {
        Row: {
          active_ingredients_summary: string | null
          barcode_normalized_gtin14: string | null
          brand: string | null
          dsld_label_id: number | null
          dsld_product_version_code: string | null
          product_name: string | null
          serving_size_raw: string | null
          servings_per_container: number | null
          token_hit_flags: Json | null
        }
        Insert: {
          active_ingredients_summary?: string | null
          barcode_normalized_gtin14?: string | null
          brand?: string | null
          dsld_label_id?: number | null
          dsld_product_version_code?: string | null
          product_name?: string | null
          serving_size_raw?: string | null
          servings_per_container?: number | null
          token_hit_flags?: never
        }
        Update: {
          active_ingredients_summary?: string | null
          barcode_normalized_gtin14?: string | null
          brand?: string | null
          dsld_label_id?: number | null
          dsld_product_version_code?: string | null
          product_name?: string | null
          serving_size_raw?: string | null
          servings_per_container?: number | null
          token_hit_flags?: never
        }
        Relationships: []
      }
    }
    Functions: {
      cleanup_expired_analysis_identity_cache: { Args: never; Returns: number }
      cleanup_expired_barcode_regulatory_map: { Args: never; Returns: number }
      cleanup_expired_barcode_resolution_training: {
        Args: { ttl_days?: number }
        Returns: number
      }
      cleanup_expired_negative_cache: { Args: never; Returns: number }
      cleanup_expired_npn_negative_cache: { Args: never; Returns: number }
      cleanup_expired_ocr_cache: {
        Args: { ttl_days?: number }
        Returns: number
      }
      cleanup_expired_resolution_cache: { Args: never; Returns: number }
      cleanup_expired_serp_cache: { Args: never; Returns: number }
      cleanup_expired_web_canonical_map: { Args: never; Returns: number }
      cleanup_stale_analysis_identity_jobs: {
        Args: { stale_minutes?: number }
        Returns: number
      }
      record_lnhpd_quality_snapshot: { Args: never; Returns: undefined }
      refresh_lnhpd_facts: { Args: never; Returns: undefined }
      refresh_lnhpd_facts_range: {
        Args: { p_max_id: number; p_min_id: number }
        Returns: undefined
      }
      resolve_catalog_by_variants: {
        Args: { p_variants: string[] }
        Returns: {
          active_ingredients_summary: string
          barcode_gtin14: string
          brand: string
          category: string
          category_raw: string
          cgmp_compliance: string
          dsld_label_id: number
          dsld_pdf: string
          dsld_thumbnail: string
          form: string
          ifos_fish_oil: boolean
          image_url: string
          inactive_ingredients: string
          informed_sport: boolean
          nsf_certified_for_sport: boolean
          package_quantity: number
          package_unit: string
          product_name: string
          resolved_from: string
          serving_size_count: number
          serving_size_raw: string
          servings_per_container: number
          third_party_testing: string
        }[]
      }
      resolve_dsld_by_gtin14: {
        Args: { p_variants: string[] }
        Returns: {
          active_ingredients_summary: string
          barcode_gtin14: string
          brand: string
          category: string
          category_raw: string
          cgmp_compliance: string
          dsld_label_id: number
          dsld_pdf: string
          dsld_thumbnail: string
          form: string
          ifos_fish_oil: string
          inactive_ingredients: string
          informed_sport: string
          nsf_certified_for_sport: string
          package_quantity: number
          package_unit: string
          product_name: string
          serving_size_count: number
          serving_size_raw: string
          servings_per_container: number
          third_party_testing: string
        }[]
      }
      resolve_dsld_facts_by_gtin14: {
        Args: { p_gtin14: string }
        Returns: {
          dataset_version: string
          dsld_label_id: number
          extracted_at: string
          facts_json: Json
        }[]
      }
      resolve_dsld_facts_by_label_id: {
        Args: { p_label_id: number }
        Returns: {
          dataset_version: string
          dsld_label_id: number
          extracted_at: string
          facts_json: Json
        }[]
      }
      resolve_ingredient_lookup: {
        Args: { query_text: string }
        Returns: {
          base_unit: string
          canonical_name: string
          ingredient_id: string
          match_confidence: number
          match_method: string
        }[]
      }
      resolve_lnhpd_facts_by_id: {
        Args: { p_lnhpd_id: number }
        Returns: {
          dataset_version: string
          extracted_at: string
          facts_json: Json
          lnhpd_id: number
        }[]
      }
      run_barcode_resolution_cleanup_daily: { Args: never; Returns: undefined }
      run_lnhpd_refresh_and_report: { Args: never; Returns: undefined }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      verify_barcode_contract: {
        Args: never
        Returns: {
          details: string
          ok: boolean
          requirement: string
        }[]
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
