export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      connections: {
        Row: {
          account_name: string
          created_at: string
          external_account_id: string | null
          id: string
          is_active: boolean
          last_used_at: string | null
          metadata: Json | null
          service_type: Database["public"]["Enums"]["service_type"]
          token_expires_at: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          account_name: string
          created_at?: string
          external_account_id?: string | null
          id?: string
          is_active?: boolean
          last_used_at?: string | null
          metadata?: Json | null
          service_type: Database["public"]["Enums"]["service_type"]
          token_expires_at?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          account_name?: string
          created_at?: string
          external_account_id?: string | null
          id?: string
          is_active?: boolean
          last_used_at?: string | null
          metadata?: Json | null
          service_type?: Database["public"]["Enums"]["service_type"]
          token_expires_at?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "connections_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      jobs: {
        Row: {
          ai_generated_title: string | null
          created_at: string
          credits_consumed: number | null
          custom_instructions: string | null
          destination_url: string | null
          error_message: string | null
          final_title: string | null
          formatted_content: string | null
          has_error: boolean | null
          id: string
          idempotency_key: string | null
          metadata: Json | null
          num_units: number | null
          original_file_url: string
          original_filename: string | null
          original_mime_type: string | null
          original_size_bytes: number | null
          processing_completed_at: string | null
          processing_started_at: string | null
          route_id: string | null
          source: string | null
          status: Database["public"]["Enums"]["job_status"]
          transcribed_text: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          ai_generated_title?: string | null
          created_at?: string
          credits_consumed?: number | null
          custom_instructions?: string | null
          destination_url?: string | null
          error_message?: string | null
          final_title?: string | null
          formatted_content?: string | null
          has_error?: boolean | null
          id?: string
          idempotency_key?: string | null
          metadata?: Json | null
          num_units?: number | null
          original_file_url: string
          original_filename?: string | null
          original_mime_type?: string | null
          original_size_bytes?: number | null
          processing_completed_at?: string | null
          processing_started_at?: string | null
          route_id?: string | null
          source?: string | null
          status?: Database["public"]["Enums"]["job_status"]
          transcribed_text?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          ai_generated_title?: string | null
          created_at?: string
          credits_consumed?: number | null
          custom_instructions?: string | null
          destination_url?: string | null
          error_message?: string | null
          final_title?: string | null
          formatted_content?: string | null
          has_error?: boolean | null
          id?: string
          idempotency_key?: string | null
          metadata?: Json | null
          num_units?: number | null
          original_file_url?: string
          original_filename?: string | null
          original_mime_type?: string | null
          original_size_bytes?: number | null
          processing_completed_at?: string | null
          processing_started_at?: string | null
          route_id?: string | null
          source?: string | null
          status?: Database["public"]["Enums"]["job_status"]
          transcribed_text?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "jobs_route_id_fkey"
            columns: ["route_id"]
            isOneToOne: false
            referencedRelation: "routes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      oauth_sessions: {
        Row: {
          code_verifier: string
          connection_id: string | null
          created_at: string
          error_code: string | null
          error_message: string | null
          expires_at: string
          nonce: string
          provider: Database["public"]["Enums"]["service_type"]
          state_payload: Json | null
          status: Database["public"]["Enums"]["oauth_session_status"]
          updated_at: string
          user_id: string
        }
        Insert: {
          code_verifier: string
          connection_id?: string | null
          created_at?: string
          error_code?: string | null
          error_message?: string | null
          expires_at?: string
          nonce: string
          provider: Database["public"]["Enums"]["service_type"]
          state_payload?: Json | null
          status?: Database["public"]["Enums"]["oauth_session_status"]
          updated_at?: string
          user_id: string
        }
        Update: {
          code_verifier?: string
          connection_id?: string | null
          created_at?: string
          error_code?: string | null
          error_message?: string | null
          expires_at?: string
          nonce?: string
          provider?: Database["public"]["Enums"]["service_type"]
          state_payload?: Json | null
          status?: Database["public"]["Enums"]["oauth_session_status"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "oauth_sessions_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "connections"
            referencedColumns: ["id"]
          },
        ]
      }
      picker_sessions: {
        Row: {
          connection_id: string
          created_at: string
          expires_at: string
          id: string
          mode: string
          user_id: string
        }
        Insert: {
          connection_id: string
          created_at?: string
          expires_at?: string
          id?: string
          mode: string
          user_id: string
        }
        Update: {
          connection_id?: string
          created_at?: string
          expires_at?: string
          id?: string
          mode?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "picker_sessions_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "connections"
            referencedColumns: ["id"]
          },
        ]
      }
      routes: {
        Row: {
          ai_title_instructions: string | null
          append_to_existing: boolean
          connection_id: string
          content_types: Database["public"]["Enums"]["content_type"][]
          created_at: string
          custom_instructions: string | null
          destination_config: Json | null
          destination_location: string | null
          id: string
          include_original_file: boolean
          is_active: boolean
          last_used_at: string | null
          name: string
          slug: string
          title_template: string | null
          updated_at: string
          usage_count: number
          use_ai_title: boolean
          user_id: string
        }
        Insert: {
          ai_title_instructions?: string | null
          append_to_existing?: boolean
          connection_id: string
          content_types?: Database["public"]["Enums"]["content_type"][]
          created_at?: string
          custom_instructions?: string | null
          destination_config?: Json | null
          destination_location?: string | null
          id?: string
          include_original_file?: boolean
          is_active?: boolean
          last_used_at?: string | null
          name: string
          slug: string
          title_template?: string | null
          updated_at?: string
          usage_count?: number
          use_ai_title?: boolean
          user_id: string
        }
        Update: {
          ai_title_instructions?: string | null
          append_to_existing?: boolean
          connection_id?: string
          content_types?: Database["public"]["Enums"]["content_type"][]
          created_at?: string
          custom_instructions?: string | null
          destination_config?: Json | null
          destination_location?: string | null
          id?: string
          include_original_file?: boolean
          is_active?: boolean
          last_used_at?: string | null
          name?: string
          slug?: string
          title_template?: string | null
          updated_at?: string
          usage_count?: number
          use_ai_title?: boolean
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "routes_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "routes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      users: {
        Row: {
          avatar_url: string | null
          created_at: string
          default_route_id: string | null
          display_name: string | null
          email: string
          global_ai_instructions: string | null
          handle: string
          id: string
          notification_preferences: Json | null
          purchased_credits: number
          subscription_credits: number
          subscription_expires_at: string | null
          subscription_plan: Database["public"]["Enums"]["subscription_plan"]
          subscription_renews: boolean | null
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          default_route_id?: string | null
          display_name?: string | null
          email: string
          global_ai_instructions?: string | null
          handle: string
          id?: string
          notification_preferences?: Json | null
          purchased_credits?: number
          subscription_credits?: number
          subscription_expires_at?: string | null
          subscription_plan?: Database["public"]["Enums"]["subscription_plan"]
          subscription_renews?: boolean | null
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          default_route_id?: string | null
          display_name?: string | null
          email?: string
          global_ai_instructions?: string | null
          handle?: string
          id?: string
          notification_preferences?: Json | null
          purchased_credits?: number
          subscription_credits?: number
          subscription_expires_at?: string | null
          subscription_plan?: Database["public"]["Enums"]["subscription_plan"]
          subscription_renews?: boolean | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "users_default_route_id_fkey"
            columns: ["default_route_id"]
            isOneToOne: false
            referencedRelation: "routes"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      add_purchased_credits: {
        Args: { p_credits: number; p_user_id: string }
        Returns: undefined
      }
      add_subscription_credits: {
        Args: {
          p_credits: number
          p_expires_at?: string
          p_plan?: Database["public"]["Enums"]["subscription_plan"]
          p_user_id: string
        }
        Returns: number
      }
      consume_credits: {
        Args: { p_amount: number; p_user_id: string }
        Returns: {
          purchased_deducted: number
          subscription_deducted: number
          total_consumed: number
        }[]
      }
      gen_route_slug: {
        Args: { p_name: string; p_user_id: string }
        Returns: string
      }
      gen_user_handle: { Args: { p_email: string }; Returns: string }
      get_total_credits: { Args: { p_user_id: string }; Returns: number }
      oauth_sessions_cleanup: { Args: never; Returns: undefined }
      picker_sessions_cleanup: { Args: never; Returns: undefined }
      slugify: { Args: { txt: string }; Returns: string }
      unaccent: { Args: { "": string }; Returns: string }
      uniquify_slug_global: {
        Args: { base: string; col: unknown; tbl: unknown }
        Returns: string
      }
      uniquify_slug_per_user: {
        Args: {
          base: string
          col: unknown
          p_user_id: string
          tbl: unknown
          user_col: unknown
        }
        Returns: string
      }
      vault_delete_token: { Args: { p_name: string }; Returns: undefined }
      vault_read_token: { Args: { p_name: string }; Returns: string }
      vault_store_token: {
        Args: { p_description?: string; p_name: string; p_secret: string }
        Returns: string
      }
    }
    Enums: {
      content_type: "writing" | "audio"
      job_status: "pending" | "processing" | "transcribed" | "delivered"
      oauth_session_status:
        | "started"
        | "callback_received"
        | "completed"
        | "failed"
      service_type: "obsidian" | "gdrive" | "onenote" | "notion"
      subscription_plan: "free" | "paid" | "unlimited" | "max"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}
