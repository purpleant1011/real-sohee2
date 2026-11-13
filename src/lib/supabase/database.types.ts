export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

// 이 파일은 scripts/gen-db-types.mjs 가 마이그레이션 재생 결과로 생성한다. 직접 수정하지 않는다.
export type Database = {
  public: {
    Tables: {
      admin_approval_requests: {
        Row: {
          id: string
          workspace_id: string | null
          action_type: string
          target_type: string
          target_id: string
          reason: string
          requested_by: string
          approved_by: string | null
          status: string
          expected_version: number | null
          request_payload: Json
          result_summary: Json
          semantic_fingerprint: string
          idempotency_key: string
          requested_at: string
          expires_at: string
          approved_at: string | null
          applied_at: string | null
          rejected_at: string | null
          cancelled_at: string | null
        }
        Insert: {
          id?: string
          workspace_id?: string | null
          action_type: string
          target_type: string
          target_id: string
          reason: string
          requested_by: string
          approved_by?: string | null
          status: string
          expected_version?: number | null
          request_payload?: Json
          result_summary?: Json
          semantic_fingerprint: string
          idempotency_key: string
          requested_at: string
          expires_at: string
          approved_at?: string | null
          applied_at?: string | null
          rejected_at?: string | null
          cancelled_at?: string | null
        }
        Update: {
          id?: string
          workspace_id?: string | null
          action_type?: string
          target_type?: string
          target_id?: string
          reason?: string
          requested_by?: string
          approved_by?: string | null
          status?: string
          expected_version?: number | null
          request_payload?: Json
          result_summary?: Json
          semantic_fingerprint?: string
          idempotency_key?: string
          requested_at?: string
          expires_at?: string
          approved_at?: string | null
          applied_at?: string | null
          rejected_at?: string | null
          cancelled_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "admin_approval_requests_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      admin_invite_intents: {
        Row: {
          id: string
          approval_request_id: string
          email_hash: string
          status: string
          created_at: string
        }
        Insert: {
          id?: string
          approval_request_id: string
          email_hash: string
          status?: string
          created_at?: string
        }
        Update: {
          id?: string
          approval_request_id?: string
          email_hash?: string
          status?: string
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "admin_invite_intents_approval_request_id_fkey"
            columns: ["approval_request_id"]
            isOneToOne: false
            referencedRelation: "admin_approval_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_action_runs: {
        Row: {
          id: string
          mission_id: string | null
          workspace_id: string
          action_type: string
          step_index: number
          status: string
          risk_tier: string
          approval_id: string | null
          reserved_sc: number
          settled_sc: number
          provider: string
          model: string
          tool_name: string | null
          error_code: string | null
          provider_accepted_at: string | null
          verified_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          mission_id?: string | null
          workspace_id: string
          action_type: string
          step_index?: number
          status?: string
          risk_tier?: string
          approval_id?: string | null
          reserved_sc?: number
          settled_sc?: number
          provider?: string
          model?: string
          tool_name?: string | null
          error_code?: string | null
          provider_accepted_at?: string | null
          verified_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          mission_id?: string | null
          workspace_id?: string
          action_type?: string
          step_index?: number
          status?: string
          risk_tier?: string
          approval_id?: string | null
          reserved_sc?: number
          settled_sc?: number
          provider?: string
          model?: string
          tool_name?: string | null
          error_code?: string | null
          provider_accepted_at?: string | null
          verified_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_action_runs_mission_id_fkey"
            columns: ["mission_id"]
            isOneToOne: false
            referencedRelation: "agent_missions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_action_runs_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_activity_events: {
        Row: {
          event_id: string
          workspace_id: string
          run_id: string
          mission_id: string | null
          step_id: string | null
          sequence: number
          observed_at: string
          kind: string
          simulated: boolean
          dedupe_key: string
        }
        Insert: {
          event_id?: string
          workspace_id: string
          run_id: string
          mission_id?: string | null
          step_id?: string | null
          sequence: number
          observed_at?: string
          kind: string
          simulated?: boolean
          dedupe_key: string
        }
        Update: {
          event_id?: string
          workspace_id?: string
          run_id?: string
          mission_id?: string | null
          step_id?: string | null
          sequence?: number
          observed_at?: string
          kind?: string
          simulated?: boolean
          dedupe_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_activity_events_mission_id_fkey"
            columns: ["mission_id"]
            isOneToOne: false
            referencedRelation: "marketing_missions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_activity_events_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "conversation_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_activity_events_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_approvals: {
        Row: {
          id: string
          workspace_id: string
          proposal_id: string
          session_id: string
          action_run_id: string | null
          proposal_type: string
          title: string
          description: string
          target_field: string | null
          current_value: Json | null
          proposed_value: Json
          status: string
          actor_id: string | null
          rejection_reason: string | null
          version: number
          expires_at: string | null
          created_at: string
          updated_at: string
          resolved_at: string | null
        }
        Insert: {
          id?: string
          workspace_id: string
          proposal_id: string
          session_id: string
          action_run_id?: string | null
          proposal_type: string
          title: string
          description: string
          target_field?: string | null
          current_value?: Json | null
          proposed_value: Json
          status?: string
          actor_id?: string | null
          rejection_reason?: string | null
          version?: number
          expires_at?: string | null
          created_at?: string
          updated_at?: string
          resolved_at?: string | null
        }
        Update: {
          id?: string
          workspace_id?: string
          proposal_id?: string
          session_id?: string
          action_run_id?: string | null
          proposal_type?: string
          title?: string
          description?: string
          target_field?: string | null
          current_value?: Json | null
          proposed_value?: Json
          status?: string
          actor_id?: string | null
          rejection_reason?: string | null
          version?: number
          expires_at?: string | null
          created_at?: string
          updated_at?: string
          resolved_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agent_approvals_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_energy_ledgers: {
        Row: {
          workspace_id: string
          plan_tier: string
          monthly_total_energy: number
          used_energy_current_month: number
          reserved_energy_active_runs: number
          remaining_available_energy: number
          burn_rate_percentage: number
          budget_alert_stage: string
          forecast_run_out_days: number
          updated_at: string
        }
        Insert: {
          workspace_id: string
          plan_tier?: string
          monthly_total_energy?: number
          used_energy_current_month?: number
          reserved_energy_active_runs?: number
          remaining_available_energy?: number
          burn_rate_percentage?: number
          budget_alert_stage?: string
          forecast_run_out_days?: number
          updated_at?: string
        }
        Update: {
          workspace_id?: string
          plan_tier?: string
          monthly_total_energy?: number
          used_energy_current_month?: number
          reserved_energy_active_runs?: number
          remaining_available_energy?: number
          burn_rate_percentage?: number
          budget_alert_stage?: string
          forecast_run_out_days?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_energy_ledgers_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_energy_reservations: {
        Row: {
          reservation_id: string
          workspace_id: string
          run_id: string | null
          action_type: string
          amount: number
          status: string
          created_at: string
          released_at: string | null
        }
        Insert: {
          reservation_id: string
          workspace_id: string
          run_id?: string | null
          action_type: string
          amount: number
          status?: string
          created_at?: string
          released_at?: string | null
        }
        Update: {
          reservation_id?: string
          workspace_id?: string
          run_id?: string | null
          action_type?: string
          amount?: number
          status?: string
          created_at?: string
          released_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agent_energy_reservations_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_energy_transactions: {
        Row: {
          transaction_id: string
          workspace_id: string
          pack_count: number
          paid_amount_krw: number
          added_energy: number
          created_at: string
        }
        Insert: {
          transaction_id: string
          workspace_id: string
          pack_count?: number
          paid_amount_krw?: number
          added_energy?: number
          created_at?: string
        }
        Update: {
          transaction_id?: string
          workspace_id?: string
          pack_count?: number
          paid_amount_krw?: number
          added_energy?: number
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_energy_transactions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_execution_receipts: {
        Row: {
          receipt_id: string
          workspace_id: string
          action_type: string
          channel: string | null
          status: string
          external_url: string | null
          provider_object_id: string | null
          content_fingerprint: string | null
          verification_method: string | null
          verified_at: string | null
          created_at: string
        }
        Insert: {
          receipt_id: string
          workspace_id: string
          action_type: string
          channel?: string | null
          status: string
          external_url?: string | null
          provider_object_id?: string | null
          content_fingerprint?: string | null
          verification_method?: string | null
          verified_at?: string | null
          created_at?: string
        }
        Update: {
          receipt_id?: string
          workspace_id?: string
          action_type?: string
          channel?: string | null
          status?: string
          external_url?: string | null
          provider_object_id?: string | null
          content_fingerprint?: string | null
          verification_method?: string | null
          verified_at?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_execution_receipts_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_memories: {
        Row: {
          id: string
          workspace_id: string
          memory_class: string
          subject: string
          fact_content: string
          confidence_score: number
          provenance_type: string
          provenance_id: string | null
          status: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          workspace_id: string
          memory_class: string
          subject: string
          fact_content: string
          confidence_score?: number
          provenance_type?: string
          provenance_id?: string | null
          status?: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          workspace_id?: string
          memory_class?: string
          subject?: string
          fact_content?: string
          confidence_score?: number
          provenance_type?: string
          provenance_id?: string | null
          status?: string
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_memories_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_missions: {
        Row: {
          id: string
          workspace_id: string
          title: string
          category: string
          status: string
          goal: string | null
          risk_tier: string
          autonomy_mode: string
          model_route: string
          total_reserved_sc: number
          total_settled_sc: number
          created_at: string
          updated_at: string
          completed_at: string | null
        }
        Insert: {
          id?: string
          workspace_id: string
          title: string
          category?: string
          status?: string
          goal?: string | null
          risk_tier?: string
          autonomy_mode?: string
          model_route?: string
          total_reserved_sc?: number
          total_settled_sc?: number
          created_at?: string
          updated_at?: string
          completed_at?: string | null
        }
        Update: {
          id?: string
          workspace_id?: string
          title?: string
          category?: string
          status?: string
          goal?: string | null
          risk_tier?: string
          autonomy_mode?: string
          model_route?: string
          total_reserved_sc?: number
          total_settled_sc?: number
          created_at?: string
          updated_at?: string
          completed_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agent_missions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_sessions: {
        Row: {
          id: string
          workspace_id: string
          session_id: string
          thread_id: string | null
          conversation_id: string | null
          current_surface: Json
          correlation_id: string | null
          snapshot_version: number
          device_channel: string
          status: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          workspace_id: string
          session_id: string
          thread_id?: string | null
          conversation_id?: string | null
          current_surface?: Json
          correlation_id?: string | null
          snapshot_version?: number
          device_channel?: string
          status?: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          workspace_id?: string
          session_id?: string
          thread_id?: string | null
          conversation_id?: string | null
          current_surface?: Json
          correlation_id?: string | null
          snapshot_version?: number
          device_channel?: string
          status?: string
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_sessions_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "conversation_threads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_sessions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_credit_ledgers: {
        Row: {
          workspace_id: string
          balance: number
          reserved: number
          total_granted: number
          updated_at: string
        }
        Insert: {
          workspace_id: string
          balance?: number
          reserved?: number
          total_granted?: number
          updated_at?: string
        }
        Update: {
          workspace_id?: string
          balance?: number
          reserved?: number
          total_granted?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_credit_ledgers_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_usage_events: {
        Row: {
          id: string
          workspace_id: string
          job_id: string
          message_id: string
          provider: string
          model: string
          operation: string
          provider_request_id: string | null
          provider_call_key: string
          text_input_tokens: number
          cached_text_input_tokens: number
          text_output_tokens: number
          image_input_tokens: number
          image_output_tokens: number
          provider_total_tokens: number
          usage_source: string
          policy_version: string
          computed_credits: number
          occurred_at: string
        }
        Insert: {
          id?: string
          workspace_id: string
          job_id: string
          message_id: string
          provider: string
          model: string
          operation: string
          provider_request_id?: string | null
          provider_call_key: string
          text_input_tokens: number
          cached_text_input_tokens: number
          text_output_tokens: number
          image_input_tokens: number
          image_output_tokens: number
          provider_total_tokens: number
          usage_source: string
          policy_version: string
          computed_credits: number
          occurred_at?: string
        }
        Update: {
          id?: string
          workspace_id?: string
          job_id?: string
          message_id?: string
          provider?: string
          model?: string
          operation?: string
          provider_request_id?: string | null
          provider_call_key?: string
          text_input_tokens?: number
          cached_text_input_tokens?: number
          text_output_tokens?: number
          image_input_tokens?: number
          image_output_tokens?: number
          provider_total_tokens?: number
          usage_source?: string
          policy_version?: string
          computed_credits?: number
          occurred_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_usage_events_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "conversation_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_usage_events_message_fkey"
            columns: ["workspace_id", "workspace_id", "message_id", "message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_usage_events_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      approval_envelopes: {
        Row: {
          envelope_id: string
          workspace_id: string
          title: string
          autonomy_level: string
          valid_from: string
          valid_until: string
          allowed_channels: Json
          max_posts_per_day: number
          max_discount_percent_allowed: number
          dm_policy: string
          max_agent_energy_cap: number
          risk_ceiling: string
          prohibited_actions: Json
          is_active: boolean
          approved_at: string
          approved_by: string | null
        }
        Insert: {
          envelope_id: string
          workspace_id: string
          title: string
          autonomy_level?: string
          valid_from?: string
          valid_until: string
          allowed_channels?: Json
          max_posts_per_day?: number
          max_discount_percent_allowed?: number
          dm_policy?: string
          max_agent_energy_cap?: number
          risk_ceiling?: string
          prohibited_actions?: Json
          is_active?: boolean
          approved_at?: string
          approved_by?: string | null
        }
        Update: {
          envelope_id?: string
          workspace_id?: string
          title?: string
          autonomy_level?: string
          valid_from?: string
          valid_until?: string
          allowed_channels?: Json
          max_posts_per_day?: number
          max_discount_percent_allowed?: number
          dm_policy?: string
          max_agent_energy_cap?: number
          risk_ceiling?: string
          prohibited_actions?: Json
          is_active?: boolean
          approved_at?: string
          approved_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "approval_envelopes_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      approvals: {
        Row: {
          id: string
          workspace_id: string
          content_id: string
          version_id: string
          fingerprint: string
          status: string
          disclosure_confirmed: boolean
          rights_confirmed: boolean
          reason: string
          decided_by: string
          decided_at: string
        }
        Insert: {
          id?: string
          workspace_id: string
          content_id: string
          version_id: string
          fingerprint: string
          status: string
          disclosure_confirmed: boolean
          rights_confirmed: boolean
          reason: string
          decided_by: string
          decided_at?: string
        }
        Update: {
          id?: string
          workspace_id?: string
          content_id?: string
          version_id?: string
          fingerprint?: string
          status?: string
          disclosure_confirmed?: boolean
          rights_confirmed?: boolean
          reason?: string
          decided_by?: string
          decided_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "approvals_workspace_id_content_id_fkey"
            columns: ["workspace_id", "workspace_id", "content_id", "content_id"]
            isOneToOne: false
            referencedRelation: "content_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "approvals_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "approvals_workspace_id_version_id_fkey"
            columns: ["workspace_id", "workspace_id", "version_id", "version_id"]
            isOneToOne: false
            referencedRelation: "content_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      artifact_slides: {
        Row: {
          id: string
          workspace_id: string
          artifact_id: string
          batch_id: string
          position: number
          role: string
          media_asset_id: string | null
          alt_text: string
          status: string
          safe_error_code: string | null
          retryable: boolean
          rights_status: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          workspace_id: string
          artifact_id: string
          batch_id: string
          position: number
          role: string
          media_asset_id?: string | null
          alt_text?: string
          status: string
          safe_error_code?: string | null
          retryable?: boolean
          rights_status?: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          workspace_id?: string
          artifact_id?: string
          batch_id?: string
          position?: number
          role?: string
          media_asset_id?: string | null
          alt_text?: string
          status?: string
          safe_error_code?: string | null
          retryable?: boolean
          rights_status?: string
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "artifact_slides_artifact_fkey"
            columns: ["workspace_id", "workspace_id", "artifact_id", "artifact_id"]
            isOneToOne: false
            referencedRelation: "conversation_artifacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "artifact_slides_batch_fkey"
            columns: ["workspace_id", "workspace_id", "workspace_id", "artifact_id", "artifact_id", "artifact_id", "batch_id", "batch_id", "batch_id"]
            isOneToOne: false
            referencedRelation: "generation_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "artifact_slides_media_fkey"
            columns: ["workspace_id", "workspace_id", "media_asset_id", "media_asset_id"]
            isOneToOne: false
            referencedRelation: "media_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "artifact_slides_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_events: {
        Row: {
          id: string
          workspace_id: string
          actor_id: string | null
          event_type: string
          entity_type: string
          entity_id: string | null
          metadata: Json
          created_at: string
        }
        Insert: {
          id?: string
          workspace_id: string
          actor_id?: string | null
          event_type: string
          entity_type: string
          entity_id?: string | null
          metadata?: Json
          created_at?: string
        }
        Update: {
          id?: string
          workspace_id?: string
          actor_id?: string | null
          event_type?: string
          entity_type?: string
          entity_id?: string | null
          metadata?: Json
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_events_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_export_jobs: {
        Row: {
          id: string
          approval_request_id: string
          workspace_id: string | null
          scope: string
          export_from: string
          export_to: string
          format: string
          status: string
          storage_bucket: string | null
          storage_path: string | null
          content_sha256: string | null
          row_count: number | null
          byte_size: number | null
          error_code: string | null
          created_at: string
          expires_at: string
          filter_fingerprint: string | null
          generated_at: string | null
          integrity_state: string
          event_chain_state: string
        }
        Insert: {
          id?: string
          approval_request_id: string
          workspace_id?: string | null
          scope: string
          export_from: string
          export_to: string
          format: string
          status: string
          storage_bucket?: string | null
          storage_path?: string | null
          content_sha256?: string | null
          row_count?: number | null
          byte_size?: number | null
          error_code?: string | null
          created_at?: string
          expires_at: string
          filter_fingerprint?: string | null
          generated_at?: string | null
          integrity_state?: string
          event_chain_state?: string
        }
        Update: {
          id?: string
          approval_request_id?: string
          workspace_id?: string | null
          scope?: string
          export_from?: string
          export_to?: string
          format?: string
          status?: string
          storage_bucket?: string | null
          storage_path?: string | null
          content_sha256?: string | null
          row_count?: number | null
          byte_size?: number | null
          error_code?: string | null
          created_at?: string
          expires_at?: string
          filter_fingerprint?: string | null
          generated_at?: string | null
          integrity_state?: string
          event_chain_state?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_export_jobs_approval_request_id_fkey"
            columns: ["approval_request_id"]
            isOneToOne: false
            referencedRelation: "admin_approval_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_export_jobs_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      automation_instances: {
        Row: {
          instance_id: string
          workspace_id: string
          automation_id: string
          version_no: number
          current_state: string
          state_history: Json
          active_envelope_id: string | null
          scheduled_at: string | null
          last_run_at: string | null
          next_run_at: string | null
          retry_count: number
          updated_at: string
        }
        Insert: {
          instance_id: string
          workspace_id: string
          automation_id: string
          version_no?: number
          current_state?: string
          state_history?: Json
          active_envelope_id?: string | null
          scheduled_at?: string | null
          last_run_at?: string | null
          next_run_at?: string | null
          retry_count?: number
          updated_at?: string
        }
        Update: {
          instance_id?: string
          workspace_id?: string
          automation_id?: string
          version_no?: number
          current_state?: string
          state_history?: Json
          active_envelope_id?: string | null
          scheduled_at?: string | null
          last_run_at?: string | null
          next_run_at?: string | null
          retry_count?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "automation_instances_active_envelope_id_fkey"
            columns: ["active_envelope_id"]
            isOneToOne: false
            referencedRelation: "approval_envelopes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automation_instances_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      automation_rules: {
        Row: {
          id: string
          workspace_id: string
          kind: string
          active: boolean
          approval_required: boolean
          configuration: Json
          created_by: string
          created_at: string
          updated_at: string
          timezone: string
          next_run_at: string | null
          last_run_at: string | null
          configuration_version: number
        }
        Insert: {
          id?: string
          workspace_id: string
          kind: string
          active?: boolean
          approval_required?: boolean
          configuration?: Json
          created_by: string
          created_at?: string
          updated_at?: string
          timezone?: string
          next_run_at?: string | null
          last_run_at?: string | null
          configuration_version?: number
        }
        Update: {
          id?: string
          workspace_id?: string
          kind?: string
          active?: boolean
          approval_required?: boolean
          configuration?: Json
          created_by?: string
          created_at?: string
          updated_at?: string
          timezone?: string
          next_run_at?: string | null
          last_run_at?: string | null
          configuration_version?: number
        }
        Relationships: [
          {
            foreignKeyName: "automation_rules_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      automation_runs: {
        Row: {
          id: string
          workspace_id: string
          rule_id: string
          status: string
          input_summary: Json
          output_summary: Json
          error_code: string | null
          created_at: string
          finished_at: string | null
          scheduled_for: string | null
          credit_reservation_id: string | null
          report_snapshot_id: string | null
          safe_error_code: string | null
          claimed_by_worker_id: string | null
          claimed_at: string | null
        }
        Insert: {
          id?: string
          workspace_id: string
          rule_id: string
          status: string
          input_summary?: Json
          output_summary?: Json
          error_code?: string | null
          created_at?: string
          finished_at?: string | null
          scheduled_for?: string | null
          credit_reservation_id?: string | null
          report_snapshot_id?: string | null
          safe_error_code?: string | null
          claimed_by_worker_id?: string | null
          claimed_at?: string | null
        }
        Update: {
          id?: string
          workspace_id?: string
          rule_id?: string
          status?: string
          input_summary?: Json
          output_summary?: Json
          error_code?: string | null
          created_at?: string
          finished_at?: string | null
          scheduled_for?: string | null
          credit_reservation_id?: string | null
          report_snapshot_id?: string | null
          safe_error_code?: string | null
          claimed_by_worker_id?: string | null
          claimed_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "automation_runs_report_snapshot_id_fkey"
            columns: ["report_snapshot_id"]
            isOneToOne: false
            referencedRelation: "report_snapshots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automation_runs_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automation_runs_workspace_id_rule_id_fkey"
            columns: ["workspace_id", "workspace_id", "rule_id", "rule_id"]
            isOneToOne: false
            referencedRelation: "automation_rules"
            referencedColumns: ["id"]
          },
        ]
      }
      benefit_campaigns: {
        Row: {
          id: string
          type: string
          title: string
          message: string
          audience_rule: Json
          starts_at: string
          ends_at: string | null
          budget_cap_sc: number | null
          per_workspace_sc: number
          status: string
          created_by: string
          approved_by: string | null
          total_recipients_count: number | null
          granted_recipients_count: number | null
          total_granted_sc: number | null
          estimated_cogs_krw: number | null
          realized_cogs_krw: number | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          type: string
          title: string
          message: string
          audience_rule?: Json
          starts_at?: string
          ends_at?: string | null
          budget_cap_sc?: number | null
          per_workspace_sc?: number
          status?: string
          created_by: string
          approved_by?: string | null
          total_recipients_count?: number | null
          granted_recipients_count?: number | null
          total_granted_sc?: number | null
          estimated_cogs_krw?: number | null
          realized_cogs_krw?: number | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          type?: string
          title?: string
          message?: string
          audience_rule?: Json
          starts_at?: string
          ends_at?: string | null
          budget_cap_sc?: number | null
          per_workspace_sc?: number
          status?: string
          created_by?: string
          approved_by?: string | null
          total_recipients_count?: number | null
          granted_recipients_count?: number | null
          total_granted_sc?: number | null
          estimated_cogs_krw?: number | null
          realized_cogs_krw?: number | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
        ]
      }
      benefit_grants: {
        Row: {
          id: string
          campaign_id: string
          workspace_id: string
          status: string
          granted_sc: number
          granted_at: string | null
          redeemed_at: string | null
          expired_at: string | null
          ledger_entry_id: string | null
          idempotency_key: string
          error_message: string | null
          created_at: string
        }
        Insert: {
          id?: string
          campaign_id: string
          workspace_id: string
          status?: string
          granted_sc?: number
          granted_at?: string | null
          redeemed_at?: string | null
          expired_at?: string | null
          ledger_entry_id?: string | null
          idempotency_key: string
          error_message?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          campaign_id?: string
          workspace_id?: string
          status?: string
          granted_sc?: number
          granted_at?: string | null
          redeemed_at?: string | null
          expired_at?: string | null
          ledger_entry_id?: string | null
          idempotency_key?: string
          error_message?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "benefit_grants_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "benefit_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "benefit_grants_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      billing_plan_entitlement_versions: {
        Row: {
          policy_version: string
          plan_code: string
          weekly_credits: number
          timezone: string
          effective_from: string
          policy_status: string
          created_at: string
        }
        Insert: {
          policy_version: string
          plan_code: string
          weekly_credits: number
          timezone?: string
          effective_from: string
          policy_status: string
          created_at?: string
        }
        Update: {
          policy_version?: string
          plan_code?: string
          weekly_credits?: number
          timezone?: string
          effective_from?: string
          policy_status?: string
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "billing_plan_entitlement_versions_plan_code_fkey"
            columns: ["plan_code"]
            isOneToOne: false
            referencedRelation: "billing_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      billing_plans: {
        Row: {
          id: string
          code: string
          monthly_price_krw: number
          included_credits: number | null
          policy_status: string
          created_at: string
        }
        Insert: {
          id?: string
          code: string
          monthly_price_krw: number
          included_credits?: number | null
          policy_status?: string
          created_at?: string
        }
        Update: {
          id?: string
          code?: string
          monthly_price_krw?: number
          included_credits?: number | null
          policy_status?: string
          created_at?: string
        }
        Relationships: [
        ]
      }
      blog_stage_facts: {
        Row: {
          event_id: string
          workspace_id: string
          run_id: string
          sequence: number
          observed_at: string
          stage: string
          status: string
          provenance: string
          source_id: string
          sample_size: number | null
          covered: number | null
          total: number | null
          dedupe_key: string
        }
        Insert: {
          event_id?: string
          workspace_id: string
          run_id: string
          sequence: number
          observed_at?: string
          stage: string
          status: string
          provenance: string
          source_id: string
          sample_size?: number | null
          covered?: number | null
          total?: number | null
          dedupe_key: string
        }
        Update: {
          event_id?: string
          workspace_id?: string
          run_id?: string
          sequence?: number
          observed_at?: string
          stage?: string
          status?: string
          provenance?: string
          source_id?: string
          sample_size?: number | null
          covered?: number | null
          total?: number | null
          dedupe_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "blog_stage_facts_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "conversation_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "blog_stage_facts_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_recovery_approvals: {
        Row: {
          id: string
          workspace_id: string
          case_id: string
          step_kind: string
          payload_fingerprint: string
          case_version: number
          source_message_id: string
          catalog_version: string
          slot_version: number
          approved_by: string
          approved_at: string
          expires_at: string
          consumed_at: string | null
          authorized_case_version: number | null
          consumed_by_step_id: string | null
        }
        Insert: {
          id?: string
          workspace_id: string
          case_id: string
          step_kind: string
          payload_fingerprint: string
          case_version: number
          source_message_id: string
          catalog_version: string
          slot_version: number
          approved_by: string
          approved_at?: string
          expires_at: string
          consumed_at?: string | null
          authorized_case_version?: number | null
          consumed_by_step_id?: string | null
        }
        Update: {
          id?: string
          workspace_id?: string
          case_id?: string
          step_kind?: string
          payload_fingerprint?: string
          case_version?: number
          source_message_id?: string
          catalog_version?: string
          slot_version?: number
          approved_by?: string
          approved_at?: string
          expires_at?: string
          consumed_at?: string | null
          authorized_case_version?: number | null
          consumed_by_step_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "booking_recovery_approvals_case_fk"
            columns: ["workspace_id", "workspace_id", "case_id", "case_id"]
            isOneToOne: false
            referencedRelation: "booking_recovery_cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_recovery_approvals_consumed_step_fk"
            columns: ["workspace_id", "workspace_id", "consumed_by_step_id", "consumed_by_step_id"]
            isOneToOne: false
            referencedRelation: "booking_recovery_steps"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_recovery_approvals_source_msg_fk"
            columns: ["workspace_id", "workspace_id", "source_message_id", "source_message_id"]
            isOneToOne: false
            referencedRelation: "instagram_dm_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_recovery_approvals_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_recovery_cases: {
        Row: {
          id: string
          workspace_id: string
          mission_id: string
          source_thread_id: string
          source_inbound_message_id: string
          customer_ref: string
          stage: string
          version: number
          created_at: string
          updated_at: string
          accepted_inbound_message_id: string | null
        }
        Insert: {
          id?: string
          workspace_id: string
          mission_id: string
          source_thread_id: string
          source_inbound_message_id: string
          customer_ref: string
          stage: string
          version?: number
          created_at?: string
          updated_at?: string
          accepted_inbound_message_id?: string | null
        }
        Update: {
          id?: string
          workspace_id?: string
          mission_id?: string
          source_thread_id?: string
          source_inbound_message_id?: string
          customer_ref?: string
          stage?: string
          version?: number
          created_at?: string
          updated_at?: string
          accepted_inbound_message_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "booking_recovery_cases_accepted_msg_workspace_fk"
            columns: ["workspace_id", "workspace_id", "accepted_inbound_message_id", "accepted_inbound_message_id"]
            isOneToOne: false
            referencedRelation: "instagram_dm_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_recovery_cases_mission_fk"
            columns: ["workspace_id", "workspace_id", "mission_id", "mission_id"]
            isOneToOne: false
            referencedRelation: "marketing_missions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_recovery_cases_source_msg_fk"
            columns: ["workspace_id", "workspace_id", "source_inbound_message_id", "source_inbound_message_id"]
            isOneToOne: false
            referencedRelation: "instagram_dm_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_recovery_cases_thread_fk"
            columns: ["workspace_id", "workspace_id", "source_thread_id", "source_thread_id"]
            isOneToOne: false
            referencedRelation: "instagram_dm_threads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_recovery_cases_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_recovery_outbox: {
        Row: {
          id: string
          workspace_id: string
          case_id: string
          source_event_key: string
          kind: string
          state: string
          lease_until: string | null
          attempt: number
          next_attempt_at: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          workspace_id: string
          case_id: string
          source_event_key: string
          kind: string
          state?: string
          lease_until?: string | null
          attempt?: number
          next_attempt_at?: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          workspace_id?: string
          case_id?: string
          source_event_key?: string
          kind?: string
          state?: string
          lease_until?: string | null
          attempt?: number
          next_attempt_at?: string
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "booking_recovery_outbox_case_fk"
            columns: ["workspace_id", "workspace_id", "case_id", "case_id"]
            isOneToOne: false
            referencedRelation: "booking_recovery_cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_recovery_outbox_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_recovery_proposals: {
        Row: {
          id: string
          workspace_id: string
          case_id: string
          revision: number
          source_inbound_message_id: string
          source_thread_id: string
          service_id: string
          catalog_version: string
          service_name: string
          total_amount_krw: number
          deposit_krw: number
          slot_id: string
          slot_version: number
          starts_at: string
          ends_at: string
          timezone: string
          availability_confirmed_at: string
          valid_until: string
          dm_draft_id: string | null
          reply_text: string
          payload_fingerprint: string
          created_at: string
          approved_reply_snapshot: Json | null
        }
        Insert: {
          id?: string
          workspace_id: string
          case_id: string
          revision?: number
          source_inbound_message_id: string
          source_thread_id: string
          service_id: string
          catalog_version: string
          service_name: string
          total_amount_krw: number
          deposit_krw: number
          slot_id: string
          slot_version: number
          starts_at: string
          ends_at: string
          timezone?: string
          availability_confirmed_at: string
          valid_until: string
          dm_draft_id?: string | null
          reply_text: string
          payload_fingerprint: string
          created_at?: string
          approved_reply_snapshot?: Json | null
        }
        Update: {
          id?: string
          workspace_id?: string
          case_id?: string
          revision?: number
          source_inbound_message_id?: string
          source_thread_id?: string
          service_id?: string
          catalog_version?: string
          service_name?: string
          total_amount_krw?: number
          deposit_krw?: number
          slot_id?: string
          slot_version?: number
          starts_at?: string
          ends_at?: string
          timezone?: string
          availability_confirmed_at?: string
          valid_until?: string
          dm_draft_id?: string | null
          reply_text?: string
          payload_fingerprint?: string
          created_at?: string
          approved_reply_snapshot?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "booking_recovery_proposals_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_recovery_proposals_ws_case_fk"
            columns: ["workspace_id", "workspace_id", "case_id", "case_id"]
            isOneToOne: false
            referencedRelation: "booking_recovery_cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_recovery_proposals_ws_service_fk"
            columns: ["workspace_id", "workspace_id", "service_id", "service_id"]
            isOneToOne: false
            referencedRelation: "workspace_products_services"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_recovery_proposals_ws_slot_fk"
            columns: ["workspace_id", "workspace_id", "slot_id", "slot_id"]
            isOneToOne: false
            referencedRelation: "booking_recovery_slots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_recovery_proposals_ws_source_msg_fk"
            columns: ["workspace_id", "workspace_id", "source_inbound_message_id", "source_inbound_message_id"]
            isOneToOne: false
            referencedRelation: "instagram_dm_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_recovery_proposals_ws_thread_fk"
            columns: ["workspace_id", "workspace_id", "source_thread_id", "source_thread_id"]
            isOneToOne: false
            referencedRelation: "instagram_dm_threads"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_recovery_slots: {
        Row: {
          id: string
          workspace_id: string
          service_id: string
          starts_at: string
          ends_at: string
          deposit_krw: number
          catalog_version: string
          timezone: string
          confirmed_by: string
          confirmed_at: string
          valid_until: string
          version: number
          status: string
        }
        Insert: {
          id?: string
          workspace_id: string
          service_id: string
          starts_at: string
          ends_at: string
          deposit_krw?: number
          catalog_version: string
          timezone?: string
          confirmed_by: string
          confirmed_at?: string
          valid_until: string
          version?: number
          status?: string
        }
        Update: {
          id?: string
          workspace_id?: string
          service_id?: string
          starts_at?: string
          ends_at?: string
          deposit_krw?: number
          catalog_version?: string
          timezone?: string
          confirmed_by?: string
          confirmed_at?: string
          valid_until?: string
          version?: number
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "booking_recovery_slots_service_fk"
            columns: ["workspace_id", "workspace_id", "service_id", "service_id"]
            isOneToOne: false
            referencedRelation: "workspace_products_services"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_recovery_slots_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_recovery_steps: {
        Row: {
          id: string
          workspace_id: string
          case_id: string
          kind: string
          status: string
          input_fingerprint: string
          idempotency_key: string
          attempt: number
          claim_token: string
          actor_id: string
          provider_message_id: string | null
          evidence_ref: string | null
          lease_until: string | null
          occurred_at: string
        }
        Insert: {
          id?: string
          workspace_id: string
          case_id: string
          kind: string
          status: string
          input_fingerprint: string
          idempotency_key: string
          attempt?: number
          claim_token?: string
          actor_id: string
          provider_message_id?: string | null
          evidence_ref?: string | null
          lease_until?: string | null
          occurred_at?: string
        }
        Update: {
          id?: string
          workspace_id?: string
          case_id?: string
          kind?: string
          status?: string
          input_fingerprint?: string
          idempotency_key?: string
          attempt?: number
          claim_token?: string
          actor_id?: string
          provider_message_id?: string | null
          evidence_ref?: string | null
          lease_until?: string | null
          occurred_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "booking_recovery_steps_case_fk"
            columns: ["workspace_id", "workspace_id", "case_id", "case_id"]
            isOneToOne: false
            referencedRelation: "booking_recovery_cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_recovery_steps_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      brand_profiles: {
        Row: {
          workspace_id: string
          voice: string | null
          keywords: string[]
          prohibited_terms: string[]
          created_at: string
          updated_at: string
        }
        Insert: {
          workspace_id: string
          voice?: string | null
          keywords?: string[]
          prohibited_terms?: string[]
          created_at?: string
          updated_at?: string
        }
        Update: {
          workspace_id?: string
          voice?: string | null
          keywords?: string[]
          prohibited_terms?: string[]
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "brand_profiles_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      browser_channel_connections: {
        Row: {
          id: string
          workspace_id: string
          device_id: string
          channel: string
          external_account_label: string
          target_external_id: string
          target_url: string
          target_fingerprint: string
          environment: string
          status: string
          verified_at: string | null
          last_seen_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          workspace_id: string
          device_id: string
          channel: string
          external_account_label: string
          target_external_id: string
          target_url: string
          target_fingerprint: string
          environment: string
          status: string
          verified_at?: string | null
          last_seen_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          workspace_id?: string
          device_id?: string
          channel?: string
          external_account_label?: string
          target_external_id?: string
          target_url?: string
          target_fingerprint?: string
          environment?: string
          status?: string
          verified_at?: string | null
          last_seen_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "browser_channel_connections_workspace_device_fkey"
            columns: ["workspace_id", "workspace_id", "device_id", "device_id"]
            isOneToOne: false
            referencedRelation: "connector_devices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "browser_channel_connections_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      browser_sessions: {
        Row: {
          id: string
          workspace_id: string
          channel: string
          session_type: string
          session_state: string
          target_url: string
          created_by: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          workspace_id: string
          channel: string
          session_type?: string
          session_state: string
          target_url: string
          created_by: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          workspace_id?: string
          channel?: string
          session_type?: string
          session_state?: string
          target_url?: string
          created_by?: string
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "browser_sessions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      browser_tasks: {
        Row: {
          task_id: string
          workspace_id: string
          channel: string
          session_ref: string | null
          action_run_id: string | null
          target_url: string | null
          operation: string
          state: string
          evidence: Json
          payload: Json
          retry_count: number
          error_code: string | null
          error_message: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          task_id: string
          workspace_id: string
          channel: string
          session_ref?: string | null
          action_run_id?: string | null
          target_url?: string | null
          operation: string
          state: string
          evidence?: Json
          payload?: Json
          retry_count?: number
          error_code?: string | null
          error_message?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          task_id?: string
          workspace_id?: string
          channel?: string
          session_ref?: string | null
          action_run_id?: string | null
          target_url?: string | null
          operation?: string
          state?: string
          evidence?: Json
          payload?: Json
          retry_count?: number
          error_code?: string | null
          error_message?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "browser_tasks_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      budget_reservations: {
        Row: {
          reservation_id: string
          workspace_id: string
          run_id: string
          estimated_energy: number
          status: string
          expires_at: string
          created_at: string
        }
        Insert: {
          reservation_id: string
          workspace_id: string
          run_id: string
          estimated_energy?: number
          status?: string
          expires_at: string
          created_at?: string
        }
        Update: {
          reservation_id?: string
          workspace_id?: string
          run_id?: string
          estimated_energy?: number
          status?: string
          expires_at?: string
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "budget_reservations_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      business_profiles: {
        Row: {
          workspace_id: string
          business_name: string
          industry: string | null
          location: string | null
          summary: string | null
          created_at: string
          updated_at: string
          registration_number: string | null
          representative_name: string | null
          category: string | null
          address: string | null
          contact_phone: string | null
          website_url: string | null
          operating_hours: Json | null
          verification_status: string | null
          service_eligibility: string | null
          verified_at: string | null
          reviewed_by: string | null
          rejection_reason: string | null
          evidence_hash: string | null
        }
        Insert: {
          workspace_id: string
          business_name: string
          industry?: string | null
          location?: string | null
          summary?: string | null
          created_at?: string
          updated_at?: string
          registration_number?: string | null
          representative_name?: string | null
          category?: string | null
          address?: string | null
          contact_phone?: string | null
          website_url?: string | null
          operating_hours?: Json | null
          verification_status?: string | null
          service_eligibility?: string | null
          verified_at?: string | null
          reviewed_by?: string | null
          rejection_reason?: string | null
          evidence_hash?: string | null
        }
        Update: {
          workspace_id?: string
          business_name?: string
          industry?: string | null
          location?: string | null
          summary?: string | null
          created_at?: string
          updated_at?: string
          registration_number?: string | null
          representative_name?: string | null
          category?: string | null
          address?: string | null
          contact_phone?: string | null
          website_url?: string | null
          operating_hours?: Json | null
          verification_status?: string | null
          service_eligibility?: string | null
          verified_at?: string | null
          reviewed_by?: string | null
          rejection_reason?: string | null
          evidence_hash?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "business_profiles_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      business_verification_events: {
        Row: {
          id: string
          workspace_id: string
          previous_status: string | null
          new_status: string
          reviewer_id: string | null
          reason: string | null
          evidence_source: string
          evidence_payload: Json | null
          idempotency_key: string | null
          created_at: string
        }
        Insert: {
          id?: string
          workspace_id: string
          previous_status?: string | null
          new_status: string
          reviewer_id?: string | null
          reason?: string | null
          evidence_source?: string
          evidence_payload?: Json | null
          idempotency_key?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          workspace_id?: string
          previous_status?: string | null
          new_status?: string
          reviewer_id?: string | null
          reason?: string | null
          evidence_source?: string
          evidence_payload?: Json | null
          idempotency_key?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "business_verification_events_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      business_verifications: {
        Row: {
          id: string
          workspace_id: string
          business_number: string
          company_name: string
          representative_name: string
          status: string
          rejection_reason: string | null
          document_url: string | null
          verified_at: string | null
          created_at: string
          updated_at: string
          start_date: string | null
        }
        Insert: {
          id?: string
          workspace_id: string
          business_number: string
          company_name: string
          representative_name: string
          status?: string
          rejection_reason?: string | null
          document_url?: string | null
          verified_at?: string | null
          created_at?: string
          updated_at?: string
          start_date?: string | null
        }
        Update: {
          id?: string
          workspace_id?: string
          business_number?: string
          company_name?: string
          representative_name?: string
          status?: string
          rejection_reason?: string | null
          document_url?: string | null
          verified_at?: string | null
          created_at?: string
          updated_at?: string
          start_date?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "business_verifications_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      capability_grants: {
        Row: {
          id: string
          authorization_id: string
          capability_key: string
          status: string
          reason_code: string | null
          derived_from_scope: string | null
          observed_at: string
          expires_at: string | null
          created_at: string
        }
        Insert: {
          id?: string
          authorization_id: string
          capability_key: string
          status?: string
          reason_code?: string | null
          derived_from_scope?: string | null
          observed_at?: string
          expires_at?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          authorization_id?: string
          capability_key?: string
          status?: string
          reason_code?: string | null
          derived_from_scope?: string | null
          observed_at?: string
          expires_at?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "capability_grants_authorization_id_fkey"
            columns: ["authorization_id"]
            isOneToOne: false
            referencedRelation: "channel_authorizations"
            referencedColumns: ["id"]
          },
        ]
      }
      channel_authorizations: {
        Row: {
          id: string
          workspace_id: string
          provider: string
          external_account_id: string | null
          account_label: string | null
          account_type: string | null
          status: string
          granted_scopes: Json | null
          authorized_at: string
          expires_at: string | null
          revoked_at: string | null
          last_validated_at: string
          consent_receipt_id: string | null
          capability_snapshot_version: string | null
          created_at: string
          updated_at: string
          channel: string | null
          account_identifier: string | null
          account_name: string | null
          token_expires_at: string | null
          last_synced_at: string | null
          metadata: Json | null
        }
        Insert: {
          id?: string
          workspace_id: string
          provider: string
          external_account_id?: string | null
          account_label?: string | null
          account_type?: string | null
          status?: string
          granted_scopes?: Json | null
          authorized_at?: string
          expires_at?: string | null
          revoked_at?: string | null
          last_validated_at?: string
          consent_receipt_id?: string | null
          capability_snapshot_version?: string | null
          created_at?: string
          updated_at?: string
          channel?: string | null
          account_identifier?: string | null
          account_name?: string | null
          token_expires_at?: string | null
          last_synced_at?: string | null
          metadata?: Json | null
        }
        Update: {
          id?: string
          workspace_id?: string
          provider?: string
          external_account_id?: string | null
          account_label?: string | null
          account_type?: string | null
          status?: string
          granted_scopes?: Json | null
          authorized_at?: string
          expires_at?: string | null
          revoked_at?: string | null
          last_validated_at?: string
          consent_receipt_id?: string | null
          capability_snapshot_version?: string | null
          created_at?: string
          updated_at?: string
          channel?: string | null
          account_identifier?: string | null
          account_name?: string | null
          token_expires_at?: string | null
          last_synced_at?: string | null
          metadata?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "channel_authorizations_consent_receipt_id_fkey"
            columns: ["consent_receipt_id"]
            isOneToOne: false
            referencedRelation: "consent_receipts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "channel_authorizations_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      channel_capabilities: {
        Row: {
          id: string
          workspace_id: string | null
          channel: string
          capability: string | null
          official_source_url: string | null
          last_verified_at: string | null
          created_at: string
          updated_at: string
          action_type: string | null
          status: string | null
          description: string | null
          execution_plane: string | null
          requires_reauth: boolean | null
          provider_version: string | null
        }
        Insert: {
          id?: string
          workspace_id?: string | null
          channel: string
          capability?: string | null
          official_source_url?: string | null
          last_verified_at?: string | null
          created_at?: string
          updated_at?: string
          action_type?: string | null
          status?: string | null
          description?: string | null
          execution_plane?: string | null
          requires_reauth?: boolean | null
          provider_version?: string | null
        }
        Update: {
          id?: string
          workspace_id?: string | null
          channel?: string
          capability?: string | null
          official_source_url?: string | null
          last_verified_at?: string | null
          created_at?: string
          updated_at?: string
          action_type?: string | null
          status?: string | null
          description?: string | null
          execution_plane?: string | null
          requires_reauth?: boolean | null
          provider_version?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "channel_capabilities_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      channel_connections: {
        Row: {
          id: string
          workspace_id: string
          channel: string
          status: string
          account_label: string | null
          external_account_id: string | null
          created_at: string
          updated_at: string
          connected_by_user_id: string | null
          token_expires_at: string | null
          webhook_status: string
          last_webhook_at: string | null
          last_provider_event_at: string | null
          last_error_code: string | null
          token_vault_ref: string | null
          refresh_token_vault_ref: string | null
          last_refreshed_at: string | null
          provider_account_id: string | null
          profile_metadata: Json | null
          last_verified_at: string | null
          verification_status: string | null
        }
        Insert: {
          id?: string
          workspace_id: string
          channel: string
          status?: string
          account_label?: string | null
          external_account_id?: string | null
          created_at?: string
          updated_at?: string
          connected_by_user_id?: string | null
          token_expires_at?: string | null
          webhook_status?: string
          last_webhook_at?: string | null
          last_provider_event_at?: string | null
          last_error_code?: string | null
          token_vault_ref?: string | null
          refresh_token_vault_ref?: string | null
          last_refreshed_at?: string | null
          provider_account_id?: string | null
          profile_metadata?: Json | null
          last_verified_at?: string | null
          verification_status?: string | null
        }
        Update: {
          id?: string
          workspace_id?: string
          channel?: string
          status?: string
          account_label?: string | null
          external_account_id?: string | null
          created_at?: string
          updated_at?: string
          connected_by_user_id?: string | null
          token_expires_at?: string | null
          webhook_status?: string
          last_webhook_at?: string | null
          last_provider_event_at?: string | null
          last_error_code?: string | null
          token_vault_ref?: string | null
          refresh_token_vault_ref?: string | null
          last_refreshed_at?: string | null
          provider_account_id?: string | null
          profile_metadata?: Json | null
          last_verified_at?: string | null
          verification_status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "channel_connections_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      channel_consents: {
        Row: {
          id: string
          workspace_id: string
          channel: string
          consent_tier: string
          status: string
          capabilities: Json
          policy_version: string
          actor_user_id: string
          granted_at: string
          revoked_at: string | null
          revoked_by: string | null
          revocation_reason: string | null
          signature_sha256: string
          created_at: string
          updated_at: string
          granted_by_user_id: string | null
          revoked_by_user_id: string | null
        }
        Insert: {
          id?: string
          workspace_id: string
          channel: string
          consent_tier: string
          status?: string
          capabilities?: Json
          policy_version?: string
          actor_user_id: string
          granted_at?: string
          revoked_at?: string | null
          revoked_by?: string | null
          revocation_reason?: string | null
          signature_sha256: string
          created_at?: string
          updated_at?: string
          granted_by_user_id?: string | null
          revoked_by_user_id?: string | null
        }
        Update: {
          id?: string
          workspace_id?: string
          channel?: string
          consent_tier?: string
          status?: string
          capabilities?: Json
          policy_version?: string
          actor_user_id?: string
          granted_at?: string
          revoked_at?: string | null
          revoked_by?: string | null
          revocation_reason?: string | null
          signature_sha256?: string
          created_at?: string
          updated_at?: string
          granted_by_user_id?: string | null
          revoked_by_user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "channel_consents_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      channel_credentials: {
        Row: {
          id: string
        }
        Insert: {
          id: string
        }
        Update: {
          id?: string
        }
        Relationships: [
        ]
      }
      channel_delegations: {
        Row: {
          id: string
          workspace_id: string
          channel: string
          status: string
          document_version_id: string
          accepted_by: string | null
          accepted_at: string | null
          withdrawn_by: string | null
          withdrawn_at: string | null
          expires_at: string | null
          reason: string
          created_at: string
        }
        Insert: {
          id?: string
          workspace_id: string
          channel: string
          status: string
          document_version_id: string
          accepted_by?: string | null
          accepted_at?: string | null
          withdrawn_by?: string | null
          withdrawn_at?: string | null
          expires_at?: string | null
          reason: string
          created_at?: string
        }
        Update: {
          id?: string
          workspace_id?: string
          channel?: string
          status?: string
          document_version_id?: string
          accepted_by?: string | null
          accepted_at?: string | null
          withdrawn_by?: string | null
          withdrawn_at?: string | null
          expires_at?: string | null
          reason?: string
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "channel_delegations_document_version_id_fkey"
            columns: ["document_version_id"]
            isOneToOne: false
            referencedRelation: "legal_document_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "channel_delegations_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      channel_delivery_attempts: {
        Row: {
          id: string
          workspace_id: string
          response_job_id: string
          attempt_number: number
          idempotency_key: string
          status: string
          provider_reference: string | null
          error_code: string | null
          started_at: string
          finished_at: string | null
          claim_token_hash: string | null
          provider_request_id: string | null
        }
        Insert: {
          id?: string
          workspace_id: string
          response_job_id: string
          attempt_number: number
          idempotency_key: string
          status: string
          provider_reference?: string | null
          error_code?: string | null
          started_at?: string
          finished_at?: string | null
          claim_token_hash?: string | null
          provider_request_id?: string | null
        }
        Update: {
          id?: string
          workspace_id?: string
          response_job_id?: string
          attempt_number?: number
          idempotency_key?: string
          status?: string
          provider_reference?: string | null
          error_code?: string | null
          started_at?: string
          finished_at?: string | null
          claim_token_hash?: string | null
          provider_request_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "channel_delivery_attempts_response_fkey"
            columns: ["workspace_id", "workspace_id", "response_job_id", "response_job_id"]
            isOneToOne: false
            referencedRelation: "channel_response_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "channel_delivery_attempts_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      channel_drafts: {
        Row: {
          id: string
          workspace_id: string
          request_key: string
          topic: string
          knowledge_version: number
          basis_notes: Json
          image_notice: string | null
          variants: Json
          created_by: string
          created_at: string
        }
        Insert: {
          id?: string
          workspace_id: string
          request_key: string
          topic: string
          knowledge_version: number
          basis_notes?: Json
          image_notice?: string | null
          variants?: Json
          created_by: string
          created_at?: string
        }
        Update: {
          id?: string
          workspace_id?: string
          request_key?: string
          topic?: string
          knowledge_version?: number
          basis_notes?: Json
          image_notice?: string | null
          variants?: Json
          created_by?: string
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "channel_drafts_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      channel_metric_collections: {
        Row: {
          id: string
          workspace_id: string
          publish_attempt_id: string
          request_key: string
          request_fingerprint: string
          period_start: string
          period_end: string
          collected_at: string
          status: string
          error_code: string | null
          next_attempt_at: string | null
          created_at: string
        }
        Insert: {
          id?: string
          workspace_id: string
          publish_attempt_id: string
          request_key: string
          request_fingerprint: string
          period_start: string
          period_end: string
          collected_at: string
          status: string
          error_code?: string | null
          next_attempt_at?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          workspace_id?: string
          publish_attempt_id?: string
          request_key?: string
          request_fingerprint?: string
          period_start?: string
          period_end?: string
          collected_at?: string
          status?: string
          error_code?: string | null
          next_attempt_at?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "channel_metric_collections_attempt_fkey"
            columns: ["workspace_id", "workspace_id", "publish_attempt_id", "publish_attempt_id"]
            isOneToOne: false
            referencedRelation: "publish_attempts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "channel_metric_collections_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      channel_metric_values: {
        Row: {
          workspace_id: string
          collection_id: string
          metric: string
          state: string
          value: number | null
          created_at: string
        }
        Insert: {
          workspace_id: string
          collection_id: string
          metric: string
          state: string
          value?: number | null
          created_at?: string
        }
        Update: {
          workspace_id?: string
          collection_id?: string
          metric?: string
          state?: string
          value?: number | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "channel_metric_values_collection_fkey"
            columns: ["workspace_id", "workspace_id", "collection_id", "collection_id"]
            isOneToOne: false
            referencedRelation: "channel_metric_collections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "channel_metric_values_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      channel_profile_change_proposals: {
        Row: {
          id: string
          workspace_id: string
          snapshot_id: string
          channel: string
          target_external_id: string
          target_label: string
          field: string
          before_value: Json
          after_value: Json
          reason: string
          capability: string
          evidence_url: string
          proposal_fingerprint: string
          status: string
          decided_by: string | null
          decided_at: string | null
          created_by: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          workspace_id: string
          snapshot_id: string
          channel: string
          target_external_id: string
          target_label: string
          field: string
          before_value: Json
          after_value: Json
          reason: string
          capability?: string
          evidence_url: string
          proposal_fingerprint: string
          status?: string
          decided_by?: string | null
          decided_at?: string | null
          created_by: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          workspace_id?: string
          snapshot_id?: string
          channel?: string
          target_external_id?: string
          target_label?: string
          field?: string
          before_value?: Json
          after_value?: Json
          reason?: string
          capability?: string
          evidence_url?: string
          proposal_fingerprint?: string
          status?: string
          decided_by?: string | null
          decided_at?: string | null
          created_by?: string
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "channel_profile_change_proposals_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "channel_profile_change_proposals_workspace_id_snapshot_id_fkey"
            columns: ["workspace_id", "workspace_id", "snapshot_id", "snapshot_id"]
            isOneToOne: false
            referencedRelation: "channel_profile_snapshots"
            referencedColumns: ["id"]
          },
        ]
      }
      channel_profile_snapshots: {
        Row: {
          id: string
          workspace_id: string
          channel: string
          target_external_id: string
          target_label: string
          fields: Json
          observed_at: string
          observed_by: string
          created_at: string
        }
        Insert: {
          id?: string
          workspace_id: string
          channel: string
          target_external_id: string
          target_label: string
          fields: Json
          observed_at: string
          observed_by: string
          created_at?: string
        }
        Update: {
          id?: string
          workspace_id?: string
          channel?: string
          target_external_id?: string
          target_label?: string
          fields?: Json
          observed_at?: string
          observed_by?: string
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "channel_profile_snapshots_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      channel_response_jobs: {
        Row: {
          id: string
          workspace_id: string
          inbound_event_id: string
          channel_connection_id: string
          response_kind: string
          external_target_id: string
          draft_text: string | null
          status: string
          idempotency_key: string
          approved_by: string | null
          approved_at: string | null
          provider_reference: string | null
          last_error_code: string | null
          created_at: string
          updated_at: string
          draft_fingerprint: string | null
        }
        Insert: {
          id?: string
          workspace_id: string
          inbound_event_id: string
          channel_connection_id: string
          response_kind: string
          external_target_id: string
          draft_text?: string | null
          status?: string
          idempotency_key: string
          approved_by?: string | null
          approved_at?: string | null
          provider_reference?: string | null
          last_error_code?: string | null
          created_at?: string
          updated_at?: string
          draft_fingerprint?: string | null
        }
        Update: {
          id?: string
          workspace_id?: string
          inbound_event_id?: string
          channel_connection_id?: string
          response_kind?: string
          external_target_id?: string
          draft_text?: string | null
          status?: string
          idempotency_key?: string
          approved_by?: string | null
          approved_at?: string | null
          provider_reference?: string | null
          last_error_code?: string | null
          created_at?: string
          updated_at?: string
          draft_fingerprint?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "channel_response_jobs_connection_fkey"
            columns: ["workspace_id", "workspace_id", "channel_connection_id", "channel_connection_id"]
            isOneToOne: false
            referencedRelation: "channel_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "channel_response_jobs_event_fkey"
            columns: ["workspace_id", "workspace_id", "inbound_event_id", "inbound_event_id"]
            isOneToOne: false
            referencedRelation: "provider_webhook_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "channel_response_jobs_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      channel_verification_runs: {
        Row: {
          id: string
          workspace_id: string
          channel: string
          verification_code: string
          status: string
          action_request_id: string | null
          external_post_id: string | null
          external_permalink: string | null
          read_after_write_at: string | null
          error_message: string | null
          verified_by: string | null
          created_at: string
        }
        Insert: {
          id?: string
          workspace_id: string
          channel: string
          verification_code: string
          status: string
          action_request_id?: string | null
          external_post_id?: string | null
          external_permalink?: string | null
          read_after_write_at?: string | null
          error_message?: string | null
          verified_by?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          workspace_id?: string
          channel?: string
          verification_code?: string
          status?: string
          action_request_id?: string | null
          external_post_id?: string | null
          external_permalink?: string | null
          read_after_write_at?: string | null
          error_message?: string | null
          verified_by?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "channel_verification_runs_action_request_fkey"
            columns: ["workspace_id", "workspace_id", "action_request_id", "action_request_id"]
            isOneToOne: false
            referencedRelation: "external_action_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "channel_verification_runs_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      checkout_intents: {
        Row: {
          id: string
          workspace_id: string
          billing_plan_id: string
          idempotency_key: string
          state: string
          provider_reference: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          workspace_id: string
          billing_plan_id: string
          idempotency_key: string
          state?: string
          provider_reference?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          workspace_id?: string
          billing_plan_id?: string
          idempotency_key?: string
          state?: string
          provider_reference?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "checkout_intents_billing_plan_id_fkey"
            columns: ["billing_plan_id"]
            isOneToOne: false
            referencedRelation: "billing_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checkout_intents_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      comment_reply_drafts: {
        Row: {
          id: string
          workspace_id: string
          comment_id: string
          draft_text: string
          approved_fingerprint: string | null
          approved_by: string | null
          approved_at: string | null
          is_auto_approved: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          workspace_id: string
          comment_id: string
          draft_text: string
          approved_fingerprint?: string | null
          approved_by?: string | null
          approved_at?: string | null
          is_auto_approved?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          workspace_id?: string
          comment_id?: string
          draft_text?: string
          approved_fingerprint?: string | null
          approved_by?: string | null
          approved_at?: string | null
          is_auto_approved?: boolean
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "comment_reply_drafts_comment_fk"
            columns: ["workspace_id", "workspace_id", "comment_id", "comment_id"]
            isOneToOne: false
            referencedRelation: "social_comments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comment_reply_drafts_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      commercial_plan_versions: {
        Row: {
          plan_version_id: string
          plan_tier: string
          name: string
          price_krw: number
          included_energy: number
          free_taste_cost_budget_krw: number
          target_margin_percent: number
          is_active: boolean
          created_at: string
        }
        Insert: {
          plan_version_id: string
          plan_tier: string
          name: string
          price_krw?: number
          included_energy?: number
          free_taste_cost_budget_krw?: number
          target_margin_percent?: number
          is_active?: boolean
          created_at?: string
        }
        Update: {
          plan_version_id?: string
          plan_tier?: string
          name?: string
          price_krw?: number
          included_energy?: number
          free_taste_cost_budget_krw?: number
          target_margin_percent?: number
          is_active?: boolean
          created_at?: string
        }
        Relationships: [
        ]
      }
      connector_devices: {
        Row: {
          id: string
          workspace_id: string
          display_name: string
          platform: string
          client_kind: string
          client_version: string
          token_digest: string
          status: string
          last_seen_at: string | null
          revoked_at: string | null
          created_by: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          workspace_id: string
          display_name: string
          platform: string
          client_kind?: string
          client_version: string
          token_digest: string
          status?: string
          last_seen_at?: string | null
          revoked_at?: string | null
          created_by: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          workspace_id?: string
          display_name?: string
          platform?: string
          client_kind?: string
          client_version?: string
          token_digest?: string
          status?: string
          last_seen_at?: string | null
          revoked_at?: string | null
          created_by?: string
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "connector_devices_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      consent_receipts: {
        Row: {
          id: string
          workspace_id: string
          document_version_id: string
          consent_type: string
          channel: string | null
          scopes: Json | null
          status: string
          accepted_by: string
          accepted_at: string
          withdrawn_at: string | null
          evidence_hash: string | null
          policy_version: string
          created_at: string
        }
        Insert: {
          id?: string
          workspace_id: string
          document_version_id: string
          consent_type: string
          channel?: string | null
          scopes?: Json | null
          status?: string
          accepted_by: string
          accepted_at?: string
          withdrawn_at?: string | null
          evidence_hash?: string | null
          policy_version?: string
          created_at?: string
        }
        Update: {
          id?: string
          workspace_id?: string
          document_version_id?: string
          consent_type?: string
          channel?: string | null
          scopes?: Json | null
          status?: string
          accepted_by?: string
          accepted_at?: string
          withdrawn_at?: string | null
          evidence_hash?: string | null
          policy_version?: string
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "consent_receipts_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      content_drafts: {
        Row: {
          draft_id: string
          workspace_id: string
          topic: string
          channel: string
          tone: string | null
          content: string
          revisions: Json
          status: string
          created_at: string
          updated_at: string
        }
        Insert: {
          draft_id?: string
          workspace_id: string
          topic: string
          channel: string
          tone?: string | null
          content: string
          revisions?: Json
          status?: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          draft_id?: string
          workspace_id?: string
          topic?: string
          channel?: string
          tone?: string | null
          content?: string
          revisions?: Json
          status?: string
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "content_drafts_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      content_items: {
        Row: {
          id: string
          workspace_id: string
          channel: string
          title: string
          status: string
          current_version_id: string | null
          created_by: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          workspace_id: string
          channel: string
          title: string
          status?: string
          current_version_id?: string | null
          created_by: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          workspace_id?: string
          channel?: string
          title?: string
          status?: string
          current_version_id?: string | null
          created_by?: string
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "content_items_current_version_fkey"
            columns: ["workspace_id", "workspace_id", "current_version_id", "current_version_id"]
            isOneToOne: false
            referencedRelation: "content_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_items_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      content_plan_entries: {
        Row: {
          id: string
          workspace_id: string
          plan_id: string
          channel: string
          post_count: number
          images_per_post: number
          created_at: string
        }
        Insert: {
          id?: string
          workspace_id: string
          plan_id: string
          channel: string
          post_count: number
          images_per_post: number
          created_at?: string
        }
        Update: {
          id?: string
          workspace_id?: string
          plan_id?: string
          channel?: string
          post_count?: number
          images_per_post?: number
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "content_plan_entries_workspace_plan_fkey"
            columns: ["workspace_id", "workspace_id", "plan_id", "plan_id"]
            isOneToOne: false
            referencedRelation: "content_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      content_plans: {
        Row: {
          id: string
          workspace_id: string
          period_start: string
          period_end: string
          timezone: string
          goal: string
          generation_depth: string
          catalog_version: number
          estimated_credits: number
          status: string
          version: number
          idempotency_key: string
          approved_request_key: string | null
          approved_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          workspace_id: string
          period_start: string
          period_end: string
          timezone: string
          goal: string
          generation_depth: string
          catalog_version: number
          estimated_credits: number
          status?: string
          version?: number
          idempotency_key: string
          approved_request_key?: string | null
          approved_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          workspace_id?: string
          period_start?: string
          period_end?: string
          timezone?: string
          goal?: string
          generation_depth?: string
          catalog_version?: number
          estimated_credits?: number
          status?: string
          version?: number
          idempotency_key?: string
          approved_request_key?: string | null
          approved_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "content_plans_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      content_version_harness_rules: {
        Row: {
          workspace_id: string
          version_id: string
          harness_rule_id: string
          position: number
          created_at: string
        }
        Insert: {
          workspace_id: string
          version_id: string
          harness_rule_id: string
          position: number
          created_at?: string
        }
        Update: {
          workspace_id?: string
          version_id?: string
          harness_rule_id?: string
          position?: number
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "content_version_harness_rules_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_version_harness_rules_workspace_id_harness_rule_id_fkey"
            columns: ["workspace_id", "workspace_id", "harness_rule_id", "harness_rule_id"]
            isOneToOne: false
            referencedRelation: "harness_rules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_version_harness_rules_workspace_id_version_id_fkey"
            columns: ["workspace_id", "workspace_id", "version_id", "version_id"]
            isOneToOne: false
            referencedRelation: "content_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      content_version_knowledge: {
        Row: {
          workspace_id: string
          version_id: string
          knowledge_item_id: string
          created_at: string
        }
        Insert: {
          workspace_id: string
          version_id: string
          knowledge_item_id: string
          created_at?: string
        }
        Update: {
          workspace_id?: string
          version_id?: string
          knowledge_item_id?: string
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "content_version_knowledge_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_version_knowledge_workspace_id_knowledge_item_id_fkey"
            columns: ["workspace_id", "workspace_id", "knowledge_item_id", "knowledge_item_id"]
            isOneToOne: false
            referencedRelation: "knowledge_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_version_knowledge_workspace_id_version_id_fkey"
            columns: ["workspace_id", "workspace_id", "version_id", "version_id"]
            isOneToOne: false
            referencedRelation: "content_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      content_version_media: {
        Row: {
          workspace_id: string
          version_id: string
          media_asset_id: string
          position: number
          created_at: string
          role: string
        }
        Insert: {
          workspace_id: string
          version_id: string
          media_asset_id: string
          position: number
          created_at?: string
          role?: string
        }
        Update: {
          workspace_id?: string
          version_id?: string
          media_asset_id?: string
          position?: number
          created_at?: string
          role?: string
        }
        Relationships: [
          {
            foreignKeyName: "content_version_media_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_version_media_workspace_id_media_asset_id_fkey"
            columns: ["workspace_id", "workspace_id", "media_asset_id", "media_asset_id"]
            isOneToOne: false
            referencedRelation: "media_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_version_media_workspace_id_version_id_fkey"
            columns: ["workspace_id", "workspace_id", "version_id", "version_id"]
            isOneToOne: false
            referencedRelation: "content_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      content_versions: {
        Row: {
          id: string
          workspace_id: string
          content_id: string
          version_number: number
          caption: string
          hashtags: string[]
          disclosure: string
          rights: Json
          generation_evidence: Json
          revision_reason: string | null
          fingerprint: string
          created_by: string
          created_at: string
          structured_payload: Json
          harness_rule_ids: string[]
        }
        Insert: {
          id?: string
          workspace_id: string
          content_id: string
          version_number: number
          caption: string
          hashtags?: string[]
          disclosure?: string
          rights?: Json
          generation_evidence?: Json
          revision_reason?: string | null
          fingerprint: string
          created_by: string
          created_at?: string
          structured_payload?: Json
          harness_rule_ids?: string[]
        }
        Update: {
          id?: string
          workspace_id?: string
          content_id?: string
          version_number?: number
          caption?: string
          hashtags?: string[]
          disclosure?: string
          rights?: Json
          generation_evidence?: Json
          revision_reason?: string | null
          fingerprint?: string
          created_by?: string
          created_at?: string
          structured_payload?: Json
          harness_rule_ids?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "content_versions_workspace_content_fkey"
            columns: ["workspace_id", "workspace_id", "content_id", "content_id"]
            isOneToOne: false
            referencedRelation: "content_items"
            referencedColumns: ["id"]
          },
        ]
      }
      conversation_artifacts: {
        Row: {
          id: string
          workspace_id: string
          type: string
          status: string
          source_message_id: string
          work_item_id: string | null
          content_item_id: string | null
          version_id: string | null
          caption: string
          hashtags: string[]
          cta: string
          disclosure: string
          observations: string[]
          limitations: string[]
          evidence: Json
          unresolved_questions: string[]
          idempotency_key: string
          save_request_key: string | null
          created_by_user_id: string
          created_at: string
          updated_at: string
          title: string | null
          structured_payload: Json
        }
        Insert: {
          id?: string
          workspace_id: string
          type: string
          status: string
          source_message_id: string
          work_item_id?: string | null
          content_item_id?: string | null
          version_id?: string | null
          caption: string
          hashtags?: string[]
          cta?: string
          disclosure?: string
          observations?: string[]
          limitations?: string[]
          evidence?: Json
          unresolved_questions?: string[]
          idempotency_key: string
          save_request_key?: string | null
          created_by_user_id: string
          created_at?: string
          updated_at?: string
          title?: string | null
          structured_payload?: Json
        }
        Update: {
          id?: string
          workspace_id?: string
          type?: string
          status?: string
          source_message_id?: string
          work_item_id?: string | null
          content_item_id?: string | null
          version_id?: string | null
          caption?: string
          hashtags?: string[]
          cta?: string
          disclosure?: string
          observations?: string[]
          limitations?: string[]
          evidence?: Json
          unresolved_questions?: string[]
          idempotency_key?: string
          save_request_key?: string | null
          created_by_user_id?: string
          created_at?: string
          updated_at?: string
          title?: string | null
          structured_payload?: Json
        }
        Relationships: [
          {
            foreignKeyName: "conversation_artifacts_content_item_fkey"
            columns: ["workspace_id", "workspace_id", "content_item_id", "content_item_id"]
            isOneToOne: false
            referencedRelation: "content_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_artifacts_source_message_fkey"
            columns: ["workspace_id", "workspace_id", "source_message_id", "source_message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_artifacts_version_fkey"
            columns: ["workspace_id", "workspace_id", "version_id", "version_id"]
            isOneToOne: false
            referencedRelation: "content_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_artifacts_work_item_fkey"
            columns: ["workspace_id", "workspace_id", "work_item_id", "work_item_id"]
            isOneToOne: false
            referencedRelation: "work_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_artifacts_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      conversation_job_steps: {
        Row: {
          id: string
          workspace_id: string
          job_id: string
          provider_call_key: string | null
          operation: string | null
          state: string
          provider_request_id: string | null
          safe_error_code: string | null
          prepared_at: string
          started_at: string | null
          completed_at: string | null
          step_index: number
          capability_id: string | null
          risk_tier: string | null
          status: string | null
          input_payload: Json
          output_payload: Json
          idempotency_key: string | null
          external_receipt_id: string | null
          error: string | null
        }
        Insert: {
          id?: string
          workspace_id: string
          job_id: string
          provider_call_key?: string | null
          operation?: string | null
          state: string
          provider_request_id?: string | null
          safe_error_code?: string | null
          prepared_at?: string
          started_at?: string | null
          completed_at?: string | null
          step_index?: number
          capability_id?: string | null
          risk_tier?: string | null
          status?: string | null
          input_payload?: Json
          output_payload?: Json
          idempotency_key?: string | null
          external_receipt_id?: string | null
          error?: string | null
        }
        Update: {
          id?: string
          workspace_id?: string
          job_id?: string
          provider_call_key?: string | null
          operation?: string | null
          state?: string
          provider_request_id?: string | null
          safe_error_code?: string | null
          prepared_at?: string
          started_at?: string | null
          completed_at?: string | null
          step_index?: number
          capability_id?: string | null
          risk_tier?: string | null
          status?: string | null
          input_payload?: Json
          output_payload?: Json
          idempotency_key?: string | null
          external_receipt_id?: string | null
          error?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "conversation_job_steps_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "conversation_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_job_steps_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      conversation_jobs: {
        Row: {
          id: string
          workspace_id: string
          thread_id: string
          user_message_id: string
          assistant_message_id: string | null
          kind: string
          status: string
          sequence_number: number
          reservation_id: string | null
          worker_id: string | null
          attempt_count: number
          safe_error_code: string | null
          queued_at: string
          queue_dispatched_at: string | null
          dispatch_failed_at: string | null
          started_at: string | null
          heartbeat_at: string | null
          completed_at: string | null
          cancel_requested_at: string | null
          cancel_requested_by: string | null
          attention_resolved_at: string | null
          attention_resolution: string | null
          user_id: string | null
          goal: string | null
          plan_data: Json
          trace_id: string | null
          model_snapshot: Json
          updated_at: string
        }
        Insert: {
          id?: string
          workspace_id: string
          thread_id: string
          user_message_id: string
          assistant_message_id?: string | null
          kind: string
          status?: string
          sequence_number?: number
          reservation_id?: string | null
          worker_id?: string | null
          attempt_count?: number
          safe_error_code?: string | null
          queued_at?: string
          queue_dispatched_at?: string | null
          dispatch_failed_at?: string | null
          started_at?: string | null
          heartbeat_at?: string | null
          completed_at?: string | null
          cancel_requested_at?: string | null
          cancel_requested_by?: string | null
          attention_resolved_at?: string | null
          attention_resolution?: string | null
          user_id?: string | null
          goal?: string | null
          plan_data?: Json
          trace_id?: string | null
          model_snapshot?: Json
          updated_at?: string
        }
        Update: {
          id?: string
          workspace_id?: string
          thread_id?: string
          user_message_id?: string
          assistant_message_id?: string | null
          kind?: string
          status?: string
          sequence_number?: number
          reservation_id?: string | null
          worker_id?: string | null
          attempt_count?: number
          safe_error_code?: string | null
          queued_at?: string
          queue_dispatched_at?: string | null
          dispatch_failed_at?: string | null
          started_at?: string | null
          heartbeat_at?: string | null
          completed_at?: string | null
          cancel_requested_at?: string | null
          cancel_requested_by?: string | null
          attention_resolved_at?: string | null
          attention_resolution?: string | null
          user_id?: string | null
          goal?: string | null
          plan_data?: Json
          trace_id?: string | null
          model_snapshot?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversation_jobs_assistant_message_fkey"
            columns: ["workspace_id", "workspace_id", "workspace_id", "thread_id", "thread_id", "thread_id", "assistant_message_id", "assistant_message_id", "assistant_message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_jobs_reservation_id_fkey"
            columns: ["reservation_id"]
            isOneToOne: false
            referencedRelation: "credit_reservations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_jobs_thread_fkey"
            columns: ["workspace_id", "workspace_id", "thread_id", "thread_id"]
            isOneToOne: false
            referencedRelation: "conversation_threads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_jobs_user_message_fkey"
            columns: ["workspace_id", "workspace_id", "workspace_id", "thread_id", "thread_id", "thread_id", "user_message_id", "user_message_id", "user_message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_jobs_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      conversation_threads: {
        Row: {
          id: string
          workspace_id: string
          kind: string
          title: string
          status: string
          last_message_at: string | null
          created_at: string
          updated_at: string
          creation_request_key: string | null
          model_profile: string
          last_run_id: string | null
          archive_reason: string | null
        }
        Insert: {
          id?: string
          workspace_id: string
          kind: string
          title: string
          status?: string
          last_message_at?: string | null
          created_at?: string
          updated_at?: string
          creation_request_key?: string | null
          model_profile?: string
          last_run_id?: string | null
          archive_reason?: string | null
        }
        Update: {
          id?: string
          workspace_id?: string
          kind?: string
          title?: string
          status?: string
          last_message_at?: string | null
          created_at?: string
          updated_at?: string
          creation_request_key?: string | null
          model_profile?: string
          last_run_id?: string | null
          archive_reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "conversation_threads_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      cost_ledger: {
        Row: {
          ledger_id: string
          workspace_id: string
          run_id: string | null
          category: string
          amount_krw: number
          details: Json
          created_at: string
        }
        Insert: {
          ledger_id: string
          workspace_id: string
          run_id?: string | null
          category: string
          amount_krw?: number
          details?: Json
          created_at?: string
        }
        Update: {
          ledger_id?: string
          workspace_id?: string
          run_id?: string | null
          category?: string
          amount_krw?: number
          details?: Json
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cost_ledger_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      coupons: {
        Row: {
          id: string
          campaign_id: string | null
          code: string
          benefit_type: string
          value_amount: number
          eligible_plans: Json | null
          starts_at: string
          expires_at: string | null
          max_redemptions: number
          redemption_count: number
          status: string
          created_at: string
        }
        Insert: {
          id?: string
          campaign_id?: string | null
          code: string
          benefit_type: string
          value_amount?: number
          eligible_plans?: Json | null
          starts_at?: string
          expires_at?: string | null
          max_redemptions?: number
          redemption_count?: number
          status?: string
          created_at?: string
        }
        Update: {
          id?: string
          campaign_id?: string | null
          code?: string
          benefit_type?: string
          value_amount?: number
          eligible_plans?: Json | null
          starts_at?: string
          expires_at?: string | null
          max_redemptions?: number
          redemption_count?: number
          status?: string
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "coupons_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "benefit_campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      creative_bundle_media: {
        Row: {
          id: string
          bundle_id: string
          media_asset_id: string
          position: number
          role: string
          sha256_digest: string
          crop_data: Json | null
          created_at: string
        }
        Insert: {
          id?: string
          bundle_id: string
          media_asset_id: string
          position: number
          role: string
          sha256_digest: string
          crop_data?: Json | null
          created_at?: string
        }
        Update: {
          id?: string
          bundle_id?: string
          media_asset_id?: string
          position?: number
          role?: string
          sha256_digest?: string
          crop_data?: Json | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "creative_bundle_media_bundle_id_fkey"
            columns: ["bundle_id"]
            isOneToOne: false
            referencedRelation: "creative_bundles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "creative_bundle_media_media_asset_id_fkey"
            columns: ["media_asset_id"]
            isOneToOne: false
            referencedRelation: "media_assets"
            referencedColumns: ["id"]
          },
        ]
      }
      creative_bundles: {
        Row: {
          id: string
          workspace_id: string
          content_id: string
          version_id: string
          channel: string
          caption: string
          hashtags: string[]
          creative_brief_version: string
          bundle_fingerprint: string
          approval_status: string
          approved_fingerprint: string | null
          approved_at: string | null
          approved_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          workspace_id: string
          content_id: string
          version_id: string
          channel: string
          caption: string
          hashtags?: string[]
          creative_brief_version?: string
          bundle_fingerprint: string
          approval_status?: string
          approved_fingerprint?: string | null
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          workspace_id?: string
          content_id?: string
          version_id?: string
          channel?: string
          caption?: string
          hashtags?: string[]
          creative_brief_version?: string
          bundle_fingerprint?: string
          approval_status?: string
          approved_fingerprint?: string | null
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "creative_bundles_content_id_fkey"
            columns: ["content_id"]
            isOneToOne: false
            referencedRelation: "content_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "creative_bundles_version_id_fkey"
            columns: ["version_id"]
            isOneToOne: false
            referencedRelation: "content_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "creative_bundles_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      creative_permissions_pre_ani1116_snapshot: {
        Row: {
          id: string
          snapshot_at: string
          snapshot_type: string
          target_table: string
          entity_name: string
          definition: Json
        }
        Insert: {
          id?: string
          snapshot_at?: string
          snapshot_type: string
          target_table: string
          entity_name: string
          definition: Json
        }
        Update: {
          id?: string
          snapshot_at?: string
          snapshot_type?: string
          target_table?: string
          entity_name?: string
          definition?: Json
        }
        Relationships: [
        ]
      }
      credit_accounts: {
        Row: {
          id: string
          workspace_id: string
          period_start: string
          period_end: string
          timezone: string
          created_at: string
          version: number
        }
        Insert: {
          id?: string
          workspace_id: string
          period_start: string
          period_end: string
          timezone?: string
          created_at?: string
          version?: number
        }
        Update: {
          id?: string
          workspace_id?: string
          period_start?: string
          period_end?: string
          timezone?: string
          created_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "credit_accounts_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      credit_grant_campaigns: {
        Row: {
          id: string
          created_by: string
          audience: string
          recent_days: number | null
          amount_per_workspace: number
          reason: string
          target_count: number
          granted_count: number
          skipped_count: number
          idempotency_key: string
          status: string
          created_at: string
        }
        Insert: {
          id?: string
          created_by: string
          audience: string
          recent_days?: number | null
          amount_per_workspace: number
          reason: string
          target_count: number
          granted_count?: number
          skipped_count?: number
          idempotency_key: string
          status?: string
          created_at?: string
        }
        Update: {
          id?: string
          created_by?: string
          audience?: string
          recent_days?: number | null
          amount_per_workspace?: number
          reason?: string
          target_count?: number
          granted_count?: number
          skipped_count?: number
          idempotency_key?: string
          status?: string
          created_at?: string
        }
        Relationships: [
        ]
      }
      credit_ledger_entries: {
        Row: {
          id: string
          workspace_id: string
          account_id: string
          reservation_id: string | null
          kind: string
          action: string | null
          amount: number
          idempotency_key: string
          occurred_at: string
          balance_after: number | null
          description: string | null
          expires_at: string | null
          created_at: string | null
        }
        Insert: {
          id?: string
          workspace_id: string
          account_id: string
          reservation_id?: string | null
          kind: string
          action?: string | null
          amount: number
          idempotency_key: string
          occurred_at?: string
          balance_after?: number | null
          description?: string | null
          expires_at?: string | null
          created_at?: string | null
        }
        Update: {
          id?: string
          workspace_id?: string
          account_id?: string
          reservation_id?: string | null
          kind?: string
          action?: string | null
          amount?: number
          idempotency_key?: string
          occurred_at?: string
          balance_after?: number | null
          description?: string | null
          expires_at?: string | null
          created_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "credit_ledger_entries_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "credit_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credit_ledger_entries_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credit_ledger_entries_workspace_reservation_fkey"
            columns: ["workspace_id", "workspace_id", "workspace_id", "account_id", "account_id", "account_id", "reservation_id", "reservation_id", "reservation_id"]
            isOneToOne: false
            referencedRelation: "credit_reservations"
            referencedColumns: ["id"]
          },
        ]
      }
      credit_rate_versions: {
        Row: {
          id: string
          catalog_version: number
          rates: Json
          policy_status: string
          created_at: string
        }
        Insert: {
          id?: string
          catalog_version: number
          rates?: Json
          policy_status?: string
          created_at?: string
        }
        Update: {
          id?: string
          catalog_version?: number
          rates?: Json
          policy_status?: string
          created_at?: string
        }
        Relationships: [
        ]
      }
      credit_reservations: {
        Row: {
          id: string
          workspace_id: string
          account_id: string
          action: string
          requested_credits: number
          settled_credits: number
          released_credits: number
          state: string
          idempotency_key: string
          settled_request_key: string | null
          created_at: string
          settled_at: string | null
        }
        Insert: {
          id: string
          workspace_id: string
          account_id: string
          action: string
          requested_credits: number
          settled_credits?: number
          released_credits?: number
          state?: string
          idempotency_key: string
          settled_request_key?: string | null
          created_at?: string
          settled_at?: string | null
        }
        Update: {
          id?: string
          workspace_id?: string
          account_id?: string
          action?: string
          requested_credits?: number
          settled_credits?: number
          released_credits?: number
          state?: string
          idempotency_key?: string
          settled_request_key?: string | null
          created_at?: string
          settled_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "credit_reservations_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "credit_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credit_reservations_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_conversations: {
        Row: {
          id: string
          workspace_id: string
          channel: string
          external_subject_reference_hash: string
          display_label: string
          status: string
          intent: string | null
          summary: string
          latest_message_at: string | null
          inquiry_id: string | null
          booking_id: string | null
          related_content_item_id: string | null
          requires_human_review: boolean
          created_by_user_id: string
          created_at: string
          updated_at: string
          booking_starts_at: string | null
          booking_timezone: string | null
          customer_id: string | null
          content: string | null
          customer_name: string | null
          is_anonymized: boolean
          anonymized_at: string | null
        }
        Insert: {
          id?: string
          workspace_id: string
          channel: string
          external_subject_reference_hash: string
          display_label: string
          status?: string
          intent?: string | null
          summary: string
          latest_message_at?: string | null
          inquiry_id?: string | null
          booking_id?: string | null
          related_content_item_id?: string | null
          requires_human_review?: boolean
          created_by_user_id: string
          created_at?: string
          updated_at?: string
          booking_starts_at?: string | null
          booking_timezone?: string | null
          customer_id?: string | null
          content?: string | null
          customer_name?: string | null
          is_anonymized?: boolean
          anonymized_at?: string | null
        }
        Update: {
          id?: string
          workspace_id?: string
          channel?: string
          external_subject_reference_hash?: string
          display_label?: string
          status?: string
          intent?: string | null
          summary?: string
          latest_message_at?: string | null
          inquiry_id?: string | null
          booking_id?: string | null
          related_content_item_id?: string | null
          requires_human_review?: boolean
          created_by_user_id?: string
          created_at?: string
          updated_at?: string
          booking_starts_at?: string | null
          booking_timezone?: string | null
          customer_id?: string | null
          content?: string | null
          customer_name?: string | null
          is_anonymized?: boolean
          anonymized_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customer_conversations_related_content_fkey"
            columns: ["workspace_id", "workspace_id", "related_content_item_id", "related_content_item_id"]
            isOneToOne: false
            referencedRelation: "content_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_conversations_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_opt_outs: {
        Row: {
          id: string
          workspace_id: string
          customer_id: string
          deletion_request_id: string | null
          reason: string | null
          source: string
          opted_out_at: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          workspace_id: string
          customer_id: string
          deletion_request_id?: string | null
          reason?: string | null
          source?: string
          opted_out_at?: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          workspace_id?: string
          customer_id?: string
          deletion_request_id?: string | null
          reason?: string | null
          source?: string
          opted_out_at?: string
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_opt_outs_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      data_deletion_requests: {
        Row: {
          id: string
          workspace_id: string | null
          requested_by_user_id: string | null
          request_origin: string
          scope: string
          provider: string | null
          external_subject_sha256: string | null
          confirmation_code_sha256: string
          status: string
          requested_at: string
          claimed_at: string | null
          completed_at: string | null
          updated_at: string
        }
        Insert: {
          id?: string
          workspace_id?: string | null
          requested_by_user_id?: string | null
          request_origin: string
          scope: string
          provider?: string | null
          external_subject_sha256?: string | null
          confirmation_code_sha256: string
          status?: string
          requested_at?: string
          claimed_at?: string | null
          completed_at?: string | null
          updated_at?: string
        }
        Update: {
          id?: string
          workspace_id?: string | null
          requested_by_user_id?: string | null
          request_origin?: string
          scope?: string
          provider?: string | null
          external_subject_sha256?: string | null
          confirmation_code_sha256?: string
          status?: string
          requested_at?: string
          claimed_at?: string | null
          completed_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "data_deletion_requests_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      deposit_intents: {
        Row: {
          id: string
          workspace_id: string
          booking_id: string
          booking_version: number
          service_version: string
          customer_id: string
          policy: string
          amount_krw: number
          total_service_price_krw: number
          refund_rule_version: string
          cancellation_terms: string
          merchant_ref: string
          settlement_actor: string
          terms_fingerprint: string
          idempotency_key: string
          status: string
          expires_at: string
          dataset_mode: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          workspace_id: string
          booking_id: string
          booking_version: number
          service_version: string
          customer_id: string
          policy: string
          amount_krw: number
          total_service_price_krw: number
          refund_rule_version: string
          cancellation_terms: string
          merchant_ref: string
          settlement_actor: string
          terms_fingerprint: string
          idempotency_key: string
          status?: string
          expires_at: string
          dataset_mode?: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          workspace_id?: string
          booking_id?: string
          booking_version?: number
          service_version?: string
          customer_id?: string
          policy?: string
          amount_krw?: number
          total_service_price_krw?: number
          refund_rule_version?: string
          cancellation_terms?: string
          merchant_ref?: string
          settlement_actor?: string
          terms_fingerprint?: string
          idempotency_key?: string
          status?: string
          expires_at?: string
          dataset_mode?: string
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "deposit_intents_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      deposit_refunds: {
        Row: {
          id: string
          workspace_id: string
          capture_id: string
          operation_key: string
          amount_krw: number
          reason: string
          rule_version: string
          status: string
          cancellation_ref: string | null
          dataset_mode: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          workspace_id: string
          capture_id: string
          operation_key: string
          amount_krw: number
          reason: string
          rule_version: string
          status: string
          cancellation_ref?: string | null
          dataset_mode?: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          workspace_id?: string
          capture_id?: string
          operation_key?: string
          amount_krw?: number
          reason?: string
          rule_version?: string
          status?: string
          cancellation_ref?: string | null
          dataset_mode?: string
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "deposit_refunds_capture_fk"
            columns: ["workspace_id", "workspace_id", "capture_id", "capture_id"]
            isOneToOne: false
            referencedRelation: "payment_captures"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deposit_refunds_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      energy_grants: {
        Row: {
          grant_id: string
          workspace_id: string
          grant_type: string
          amount_energy: number
          cost_ceiling_krw: number
          idempotency_key: string
          business_verification_id: string | null
          granted_at: string
        }
        Insert: {
          grant_id: string
          workspace_id: string
          grant_type: string
          amount_energy?: number
          cost_ceiling_krw?: number
          idempotency_key: string
          business_verification_id?: string | null
          granted_at?: string
        }
        Update: {
          grant_id?: string
          workspace_id?: string
          grant_type?: string
          amount_energy?: number
          cost_ceiling_krw?: number
          idempotency_key?: string
          business_verification_id?: string | null
          granted_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "energy_grants_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      engagement_audit: {
        Row: {
          id: string
          workspace_id: string
          comment_id: string | null
          channel: string
          actor: string
          actor_user_id: string | null
          action: string
          policy_snapshot: Json | null
          provider_reply_id: string | null
          readback_verified: boolean
          details: Json
          created_at: string
        }
        Insert: {
          id?: string
          workspace_id: string
          comment_id?: string | null
          channel: string
          actor: string
          actor_user_id?: string | null
          action: string
          policy_snapshot?: Json | null
          provider_reply_id?: string | null
          readback_verified?: boolean
          details?: Json
          created_at?: string
        }
        Update: {
          id?: string
          workspace_id?: string
          comment_id?: string | null
          channel?: string
          actor?: string
          actor_user_id?: string | null
          action?: string
          policy_snapshot?: Json | null
          provider_reply_id?: string | null
          readback_verified?: boolean
          details?: Json
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "engagement_audit_comment_fk"
            columns: ["workspace_id", "workspace_id", "comment_id", "comment_id"]
            isOneToOne: false
            referencedRelation: "social_comments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "engagement_audit_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      engagement_policies: {
        Row: {
          id: string
          workspace_id: string
          channel: string
          auto_reply_enabled: boolean
          is_paused: boolean
          allowed_classes: string[]
          min_confidence: number
          daily_cap: number
          quiet_hours_enabled: boolean
          quiet_hours_start: string | null
          quiet_hours_end: string | null
          max_comment_age_days: number
          created_at: string
          updated_at: string
          autonomy_level: string
          default_tone: string
        }
        Insert: {
          id?: string
          workspace_id: string
          channel: string
          auto_reply_enabled?: boolean
          is_paused?: boolean
          allowed_classes?: string[]
          min_confidence?: number
          daily_cap?: number
          quiet_hours_enabled?: boolean
          quiet_hours_start?: string | null
          quiet_hours_end?: string | null
          max_comment_age_days?: number
          created_at?: string
          updated_at?: string
          autonomy_level?: string
          default_tone?: string
        }
        Update: {
          id?: string
          workspace_id?: string
          channel?: string
          auto_reply_enabled?: boolean
          is_paused?: boolean
          allowed_classes?: string[]
          min_confidence?: number
          daily_cap?: number
          quiet_hours_enabled?: boolean
          quiet_hours_start?: string | null
          quiet_hours_end?: string | null
          max_comment_age_days?: number
          created_at?: string
          updated_at?: string
          autonomy_level?: string
          default_tone?: string
        }
        Relationships: [
          {
            foreignKeyName: "engagement_policies_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      external_action_attempts: {
        Row: {
          id: string
          workspace_id: string
          action_request_id: string
          attempt_number: number
          status: string
          failure_code: string | null
          provider_request_id: string | null
          provider_reference: string | null
          started_at: string
          finished_at: string | null
          created_by: string
        }
        Insert: {
          id?: string
          workspace_id: string
          action_request_id: string
          attempt_number: number
          status: string
          failure_code?: string | null
          provider_request_id?: string | null
          provider_reference?: string | null
          started_at?: string
          finished_at?: string | null
          created_by: string
        }
        Update: {
          id?: string
          workspace_id?: string
          action_request_id?: string
          attempt_number?: number
          status?: string
          failure_code?: string | null
          provider_request_id?: string | null
          provider_reference?: string | null
          started_at?: string
          finished_at?: string | null
          created_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "external_action_attempts_workspace_id_action_request_id_fkey"
            columns: ["workspace_id", "workspace_id", "action_request_id", "action_request_id"]
            isOneToOne: false
            referencedRelation: "external_action_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "external_action_attempts_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      external_action_receipts: {
        Row: {
          id: string
          workspace_id: string
          action_request_id: string
          attempt_id: string | null
          receipt_kind: string
          provider_reference: string | null
          result_url: string | null
          observed_payload: Json
          recorded_by: string
          recorded_at: string
          channel: string | null
          channel_id: string | null
          action_kind: string | null
          action_type: string | null
          status: string | null
          receipt_status: string | null
          state: string | null
          reconcile_state: string | null
          external_id: string | null
          external_url: string | null
          provider_post_url: string | null
          verification_method: string | null
          verified: boolean | null
          verified_at: string | null
          evidence_maturity: string | null
          evidence_details: Json | null
          payload: Json | null
          raw_response: Json | null
          additional_evidence: Json | null
          request_id: string | null
          request_payload_digest: string | null
          idempotency_key: string | null
          schedule_id: string | null
          bundle_id: string | null
          observed_at: string | null
          finalized_at: string | null
          created_at: string
        }
        Insert: {
          id?: string
          workspace_id: string
          action_request_id: string
          attempt_id?: string | null
          receipt_kind: string
          provider_reference?: string | null
          result_url?: string | null
          observed_payload?: Json
          recorded_by: string
          recorded_at?: string
          channel?: string | null
          channel_id?: string | null
          action_kind?: string | null
          action_type?: string | null
          status?: string | null
          receipt_status?: string | null
          state?: string | null
          reconcile_state?: string | null
          external_id?: string | null
          external_url?: string | null
          provider_post_url?: string | null
          verification_method?: string | null
          verified?: boolean | null
          verified_at?: string | null
          evidence_maturity?: string | null
          evidence_details?: Json | null
          payload?: Json | null
          raw_response?: Json | null
          additional_evidence?: Json | null
          request_id?: string | null
          request_payload_digest?: string | null
          idempotency_key?: string | null
          schedule_id?: string | null
          bundle_id?: string | null
          observed_at?: string | null
          finalized_at?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          workspace_id?: string
          action_request_id?: string
          attempt_id?: string | null
          receipt_kind?: string
          provider_reference?: string | null
          result_url?: string | null
          observed_payload?: Json
          recorded_by?: string
          recorded_at?: string
          channel?: string | null
          channel_id?: string | null
          action_kind?: string | null
          action_type?: string | null
          status?: string | null
          receipt_status?: string | null
          state?: string | null
          reconcile_state?: string | null
          external_id?: string | null
          external_url?: string | null
          provider_post_url?: string | null
          verification_method?: string | null
          verified?: boolean | null
          verified_at?: string | null
          evidence_maturity?: string | null
          evidence_details?: Json | null
          payload?: Json | null
          raw_response?: Json | null
          additional_evidence?: Json | null
          request_id?: string | null
          request_payload_digest?: string | null
          idempotency_key?: string | null
          schedule_id?: string | null
          bundle_id?: string | null
          observed_at?: string | null
          finalized_at?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "external_action_receipts_workspace_id_action_request_id_fkey"
            columns: ["workspace_id", "workspace_id", "action_request_id", "action_request_id"]
            isOneToOne: false
            referencedRelation: "external_action_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "external_action_receipts_workspace_id_attempt_id_fkey"
            columns: ["workspace_id", "workspace_id", "attempt_id", "attempt_id"]
            isOneToOne: false
            referencedRelation: "external_action_attempts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "external_action_receipts_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      external_action_requests: {
        Row: {
          id: string
          workspace_id: string
          channel: string
          action_kind: string
          target_external_id: string
          target_label: string
          exact_payload: Json
          content_version_id: string | null
          approval_id: string | null
          approval_fingerprint: string | null
          idempotency_key: string
          status: string
          failure_code: string | null
          created_by: string
          claimed_by: string | null
          claimed_at: string | null
          created_at: string
          updated_at: string
          browser_channel_connection_id: string | null
          scheduled_at: string | null
          auto_execute_until: string | null
          reconfirmed_by: string | null
          reconfirmed_at: string | null
          action_type: string | null
          target_channel: string | null
          mission_id: string | null
        }
        Insert: {
          id?: string
          workspace_id: string
          channel: string
          action_kind: string
          target_external_id: string
          target_label: string
          exact_payload: Json
          content_version_id?: string | null
          approval_id?: string | null
          approval_fingerprint?: string | null
          idempotency_key: string
          status?: string
          failure_code?: string | null
          created_by: string
          claimed_by?: string | null
          claimed_at?: string | null
          created_at?: string
          updated_at?: string
          browser_channel_connection_id?: string | null
          scheduled_at?: string | null
          auto_execute_until?: string | null
          reconfirmed_by?: string | null
          reconfirmed_at?: string | null
          action_type?: string | null
          target_channel?: string | null
          mission_id?: string | null
        }
        Update: {
          id?: string
          workspace_id?: string
          channel?: string
          action_kind?: string
          target_external_id?: string
          target_label?: string
          exact_payload?: Json
          content_version_id?: string | null
          approval_id?: string | null
          approval_fingerprint?: string | null
          idempotency_key?: string
          status?: string
          failure_code?: string | null
          created_by?: string
          claimed_by?: string | null
          claimed_at?: string | null
          created_at?: string
          updated_at?: string
          browser_channel_connection_id?: string | null
          scheduled_at?: string | null
          auto_execute_until?: string | null
          reconfirmed_by?: string | null
          reconfirmed_at?: string | null
          action_type?: string | null
          target_channel?: string | null
          mission_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "external_action_requests_browser_connection_fkey"
            columns: ["workspace_id", "workspace_id", "browser_channel_connection_id", "browser_channel_connection_id"]
            isOneToOne: false
            referencedRelation: "browser_channel_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "external_action_requests_workspace_id_approval_id_fkey"
            columns: ["workspace_id", "workspace_id", "approval_id", "approval_id"]
            isOneToOne: false
            referencedRelation: "approvals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "external_action_requests_workspace_id_content_version_id_fkey"
            columns: ["workspace_id", "workspace_id", "content_version_id", "content_version_id"]
            isOneToOne: false
            referencedRelation: "content_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "external_action_requests_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "external_action_requests_workspace_mission_fkey"
            columns: ["workspace_id", "workspace_id", "mission_id", "mission_id"]
            isOneToOne: false
            referencedRelation: "marketing_missions"
            referencedColumns: ["id"]
          },
        ]
      }
      external_ad_spend_ledgers: {
        Row: {
          spend_ledger_id: string
          workspace_id: string
          ad_account_id: string
          channel: string
          spent_krw: number
          budget_limit_krw: number
          updated_at: string
        }
        Insert: {
          spend_ledger_id: string
          workspace_id: string
          ad_account_id?: string
          channel: string
          spent_krw?: number
          budget_limit_krw?: number
          updated_at?: string
        }
        Update: {
          spend_ledger_id?: string
          workspace_id?: string
          ad_account_id?: string
          channel?: string
          spent_krw?: number
          budget_limit_krw?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "external_ad_spend_ledgers_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      external_verification_events: {
        Row: {
          id: string
          action_run_id: string | null
          workspace_id: string
          channel: string
          verification_method: string
          external_id: string | null
          permalink: string | null
          result: string
          evidence_data: Json | null
          created_at: string
        }
        Insert: {
          id?: string
          action_run_id?: string | null
          workspace_id: string
          channel: string
          verification_method?: string
          external_id?: string | null
          permalink?: string | null
          result: string
          evidence_data?: Json | null
          created_at?: string
        }
        Update: {
          id?: string
          action_run_id?: string | null
          workspace_id?: string
          channel?: string
          verification_method?: string
          external_id?: string | null
          permalink?: string | null
          result?: string
          evidence_data?: Json | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "external_verification_events_action_run_id_fkey"
            columns: ["action_run_id"]
            isOneToOne: false
            referencedRelation: "agent_action_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "external_verification_events_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      finops_cost_ledger: {
        Row: {
          id: string
          workspace_id: string
          category: string
          cost_in_won: number
          units_consumed: number
          description: string | null
          created_at: string
        }
        Insert: {
          id?: string
          workspace_id: string
          category: string
          cost_in_won?: number
          units_consumed?: number
          description?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          workspace_id?: string
          category?: string
          cost_in_won?: number
          units_consumed?: number
          description?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "finops_cost_ledger_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      finops_reservations: {
        Row: {
          reservation_id: string
          workspace_id: string
          action_run_id: string
          amount: number
          status: string
          quote_id: string | null
          idempotency_key: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          reservation_id: string
          workspace_id: string
          action_run_id: string
          amount: number
          status?: string
          quote_id?: string | null
          idempotency_key?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          reservation_id?: string
          workspace_id?: string
          action_run_id?: string
          amount?: number
          status?: string
          quote_id?: string | null
          idempotency_key?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "finops_reservations_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      finops_settlements: {
        Row: {
          settlement_id: string
          reservation_id: string
          actual_cost: number
          settled_at: string
        }
        Insert: {
          settlement_id: string
          reservation_id: string
          actual_cost: number
          settled_at?: string
        }
        Update: {
          settlement_id?: string
          reservation_id?: string
          actual_cost?: number
          settled_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "finops_settlements_reservation_id_fkey"
            columns: ["reservation_id"]
            isOneToOne: false
            referencedRelation: "finops_reservations"
            referencedColumns: ["id"]
          },
        ]
      }
      first_post_publish_consumptions: {
        Row: {
          workspace_id: string
          mission_id: string
          approved_fingerprint: string
          provider: string
          account_id: string
          intent_scope: string
          content_fingerprint: string
          claim_token: string
          consumed_at: string
        }
        Insert: {
          workspace_id: string
          mission_id: string
          approved_fingerprint: string
          provider: string
          account_id: string
          intent_scope: string
          content_fingerprint: string
          claim_token: string
          consumed_at?: string
        }
        Update: {
          workspace_id?: string
          mission_id?: string
          approved_fingerprint?: string
          provider?: string
          account_id?: string
          intent_scope?: string
          content_fingerprint?: string
          claim_token?: string
          consumed_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "first_post_publish_consumptions_mission_id_fkey"
            columns: ["mission_id"]
            isOneToOne: false
            referencedRelation: "marketing_missions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "first_post_publish_consumptions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      free_taste_claims: {
        Row: {
          id: string
          business_number: string
          benefit_type: string
          workspace_id: string
          claimed_by: string
          energy_granted: number
          claimed_at: string
        }
        Insert: {
          id?: string
          business_number: string
          benefit_type?: string
          workspace_id: string
          claimed_by: string
          energy_granted?: number
          claimed_at?: string
        }
        Update: {
          id?: string
          business_number?: string
          benefit_type?: string
          workspace_id?: string
          claimed_by?: string
          energy_granted?: number
          claimed_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "free_taste_claims_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      funnel_events: {
        Row: {
          id: string
          workspace_id: string
          user_id: string | null
          event: string
          occurred_at: string
          properties: Json
          dedupe_key: string | null
        }
        Insert: {
          id?: string
          workspace_id: string
          user_id?: string | null
          event: string
          occurred_at?: string
          properties?: Json
          dedupe_key?: string | null
        }
        Update: {
          id?: string
          workspace_id?: string
          user_id?: string | null
          event?: string
          occurred_at?: string
          properties?: Json
          dedupe_key?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "funnel_events_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      generation_batches: {
        Row: {
          id: string
          workspace_id: string
          artifact_id: string | null
          requested_count: number
          started_count: number
          succeeded_count: number
          failed_count: number
          status: string
          idempotency_key: string
          safe_error_code: string | null
          started_at: string | null
          completed_at: string | null
          created_at: string
          updated_at: string
          content_version_id: string | null
        }
        Insert: {
          id?: string
          workspace_id: string
          artifact_id?: string | null
          requested_count: number
          started_count?: number
          succeeded_count?: number
          failed_count?: number
          status: string
          idempotency_key: string
          safe_error_code?: string | null
          started_at?: string | null
          completed_at?: string | null
          created_at?: string
          updated_at?: string
          content_version_id?: string | null
        }
        Update: {
          id?: string
          workspace_id?: string
          artifact_id?: string | null
          requested_count?: number
          started_count?: number
          succeeded_count?: number
          failed_count?: number
          status?: string
          idempotency_key?: string
          safe_error_code?: string | null
          started_at?: string | null
          completed_at?: string | null
          created_at?: string
          updated_at?: string
          content_version_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "generation_batches_artifact_fkey"
            columns: ["workspace_id", "workspace_id", "artifact_id", "artifact_id"]
            isOneToOne: false
            referencedRelation: "conversation_artifacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "generation_batches_content_version_id_fkey"
            columns: ["content_version_id"]
            isOneToOne: false
            referencedRelation: "content_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "generation_batches_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      generation_runs: {
        Row: {
          id: string
          workspace_id: string
          batch_id: string | null
          content_version_id: string | null
          idempotency_key: string
          request_fingerprint: string
          sequence_number: number
          status: string
          prompt_digest: string
          media_asset_id: string | null
          storage_path: string | null
          sha256_digest: string | null
          byte_length: number | null
          error_code: string | null
          error_message: string | null
          usage: Json | null
          is_current: boolean
          superseded_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          workspace_id: string
          batch_id?: string | null
          content_version_id?: string | null
          idempotency_key: string
          request_fingerprint: string
          sequence_number?: number
          status?: string
          prompt_digest: string
          media_asset_id?: string | null
          storage_path?: string | null
          sha256_digest?: string | null
          byte_length?: number | null
          error_code?: string | null
          error_message?: string | null
          usage?: Json | null
          is_current?: boolean
          superseded_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          workspace_id?: string
          batch_id?: string | null
          content_version_id?: string | null
          idempotency_key?: string
          request_fingerprint?: string
          sequence_number?: number
          status?: string
          prompt_digest?: string
          media_asset_id?: string | null
          storage_path?: string | null
          sha256_digest?: string | null
          byte_length?: number | null
          error_code?: string | null
          error_message?: string | null
          usage?: Json | null
          is_current?: boolean
          superseded_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "generation_runs_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "generation_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "generation_runs_content_version_id_fkey"
            columns: ["content_version_id"]
            isOneToOne: false
            referencedRelation: "content_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "generation_runs_media_asset_id_fkey"
            columns: ["media_asset_id"]
            isOneToOne: false
            referencedRelation: "media_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "generation_runs_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      harness_assets: {
        Row: {
          id: string
          workspace_id: string
          asset_type: string
          source_entity_id: string | null
          title: string
          visibility: string
          overall_status: string
          active_version_id: string | null
          active_version_no: number
          platform: string
          source_url: string
          source_handle: string | null
          core_dna: string[]
          module_readiness: Json
          daily_estimated_sc: number
          total_spent_sc: number
          created_by_user_id: string | null
          last_analyzed_at: string | null
          created_at: string
          updated_at: string
          archived_at: string | null
        }
        Insert: {
          id?: string
          workspace_id: string
          asset_type?: string
          source_entity_id?: string | null
          title: string
          visibility?: string
          overall_status?: string
          active_version_id?: string | null
          active_version_no?: number
          platform: string
          source_url: string
          source_handle?: string | null
          core_dna?: string[]
          module_readiness?: Json
          daily_estimated_sc?: number
          total_spent_sc?: number
          created_by_user_id?: string | null
          last_analyzed_at?: string | null
          created_at?: string
          updated_at?: string
          archived_at?: string | null
        }
        Update: {
          id?: string
          workspace_id?: string
          asset_type?: string
          source_entity_id?: string | null
          title?: string
          visibility?: string
          overall_status?: string
          active_version_id?: string | null
          active_version_no?: number
          platform?: string
          source_url?: string
          source_handle?: string | null
          core_dna?: string[]
          module_readiness?: Json
          daily_estimated_sc?: number
          total_spent_sc?: number
          created_by_user_id?: string | null
          last_analyzed_at?: string | null
          created_at?: string
          updated_at?: string
          archived_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "harness_assets_source_entity_id_fkey"
            columns: ["source_entity_id"]
            isOneToOne: false
            referencedRelation: "harness_source_entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "harness_assets_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      harness_channel_assignments: {
        Row: {
          id: string
          workspace_id: string
          channel_connection_id: string
          harness_asset_id: string
          assignment_mode: string
          pinned_version_id: string | null
          desired_autonomy_mode: string
          actual_autonomy_mode: string
          enabled: boolean
          assigned_at: string
        }
        Insert: {
          id?: string
          workspace_id: string
          channel_connection_id: string
          harness_asset_id: string
          assignment_mode?: string
          pinned_version_id?: string | null
          desired_autonomy_mode?: string
          actual_autonomy_mode?: string
          enabled?: boolean
          assigned_at?: string
        }
        Update: {
          id?: string
          workspace_id?: string
          channel_connection_id?: string
          harness_asset_id?: string
          assignment_mode?: string
          pinned_version_id?: string | null
          desired_autonomy_mode?: string
          actual_autonomy_mode?: string
          enabled?: boolean
          assigned_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "harness_channel_assignments_harness_asset_id_fkey"
            columns: ["harness_asset_id"]
            isOneToOne: false
            referencedRelation: "harness_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "harness_channel_assignments_pinned_version_id_fkey"
            columns: ["pinned_version_id"]
            isOneToOne: false
            referencedRelation: "harness_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "harness_channel_assignments_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      harness_override_versions: {
        Row: {
          id: string
          harness_asset_id: string
          workspace_id: string
          base_harness_version_id: string | null
          version_no: number
          override_json: Json
          created_by_user_id: string | null
          created_at: string
        }
        Insert: {
          id?: string
          harness_asset_id: string
          workspace_id: string
          base_harness_version_id?: string | null
          version_no?: number
          override_json?: Json
          created_by_user_id?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          harness_asset_id?: string
          workspace_id?: string
          base_harness_version_id?: string | null
          version_no?: number
          override_json?: Json
          created_by_user_id?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "harness_override_versions_base_harness_version_id_fkey"
            columns: ["base_harness_version_id"]
            isOneToOne: false
            referencedRelation: "harness_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "harness_override_versions_harness_asset_id_fkey"
            columns: ["harness_asset_id"]
            isOneToOne: false
            referencedRelation: "harness_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "harness_override_versions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      harness_rule_evidence: {
        Row: {
          id: string
          rule_id: string
          source_item_id: string | null
          source_url: string | null
          evidence_type: string
          observation_summary: string
          captured_at: string
        }
        Insert: {
          id?: string
          rule_id: string
          source_item_id?: string | null
          source_url?: string | null
          evidence_type: string
          observation_summary: string
          captured_at?: string
        }
        Update: {
          id?: string
          rule_id?: string
          source_item_id?: string | null
          source_url?: string | null
          evidence_type?: string
          observation_summary?: string
          captured_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "harness_rule_evidence_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "harness_rules"
            referencedColumns: ["id"]
          },
        ]
      }
      harness_rules: {
        Row: {
          id: string
          workspace_id: string
          rule_key: string
          rule_type: string
          title: string
          description: string | null
          structured_rule: Json
          applies_to_channels: string[]
          status: string
          version: number
          source_message_id: string | null
          source_knowledge_fact_ids: string[]
          approved_by_user_id: string | null
          approved_at: string | null
          review_reason: string | null
          created_by_user_id: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          workspace_id: string
          rule_key: string
          rule_type: string
          title: string
          description?: string | null
          structured_rule: Json
          applies_to_channels?: string[]
          status?: string
          version?: number
          source_message_id?: string | null
          source_knowledge_fact_ids?: string[]
          approved_by_user_id?: string | null
          approved_at?: string | null
          review_reason?: string | null
          created_by_user_id: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          workspace_id?: string
          rule_key?: string
          rule_type?: string
          title?: string
          description?: string | null
          structured_rule?: Json
          applies_to_channels?: string[]
          status?: string
          version?: number
          source_message_id?: string | null
          source_knowledge_fact_ids?: string[]
          approved_by_user_id?: string | null
          approved_at?: string | null
          review_reason?: string | null
          created_by_user_id?: string
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "harness_rules_source_message_fkey"
            columns: ["workspace_id", "workspace_id", "source_message_id", "source_message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "harness_rules_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      harness_source_entities: {
        Row: {
          id: string
          workspace_id: string
          platform: string
          source_type: string
          source_entity_key: string
          platform_native_entity_id: string | null
          canonical_url_current: string
          source_url_aliases: string[]
          source_handle_current: string
          source_handle_history: string[]
          resolved_at: string
          created_at: string
        }
        Insert: {
          id?: string
          workspace_id: string
          platform: string
          source_type: string
          source_entity_key: string
          platform_native_entity_id?: string | null
          canonical_url_current: string
          source_url_aliases?: string[]
          source_handle_current: string
          source_handle_history?: string[]
          resolved_at?: string
          created_at?: string
        }
        Update: {
          id?: string
          workspace_id?: string
          platform?: string
          source_type?: string
          source_entity_key?: string
          platform_native_entity_id?: string | null
          canonical_url_current?: string
          source_url_aliases?: string[]
          source_handle_current?: string
          source_handle_history?: string[]
          resolved_at?: string
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "harness_source_entities_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      harness_versions: {
        Row: {
          id: string
          harness_asset_id: string
          version_no: number
          schema_version: string
          compiler_version: string
          analyzer_version: string
          created_from_snapshot_id: string | null
          text_json: Json
          visual_json: Json
          operations_json: Json
          community_json: Json
          platform_json: Json
          evidence_score: number
          confidence: number
          immutable: boolean
          created_at: string
        }
        Insert: {
          id?: string
          harness_asset_id: string
          version_no: number
          schema_version?: string
          compiler_version?: string
          analyzer_version?: string
          created_from_snapshot_id?: string | null
          text_json?: Json
          visual_json?: Json
          operations_json?: Json
          community_json?: Json
          platform_json?: Json
          evidence_score?: number
          confidence?: number
          immutable?: boolean
          created_at?: string
        }
        Update: {
          id?: string
          harness_asset_id?: string
          version_no?: number
          schema_version?: string
          compiler_version?: string
          analyzer_version?: string
          created_from_snapshot_id?: string | null
          text_json?: Json
          visual_json?: Json
          operations_json?: Json
          community_json?: Json
          platform_json?: Json
          evidence_score?: number
          confidence?: number
          immutable?: boolean
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "harness_versions_harness_asset_id_fkey"
            columns: ["harness_asset_id"]
            isOneToOne: false
            referencedRelation: "harness_assets"
            referencedColumns: ["id"]
          },
        ]
      }
      hierarchical_kill_switches: {
        Row: {
          id: string
          level: string
          target_identifier: string
          is_engaged: boolean
          engaged_reason: string | null
          engaged_by_admin_id: string | null
          engaged_at: string
          released_at: string | null
        }
        Insert: {
          id: string
          level: string
          target_identifier: string
          is_engaged?: boolean
          engaged_reason?: string | null
          engaged_by_admin_id?: string | null
          engaged_at?: string
          released_at?: string | null
        }
        Update: {
          id?: string
          level?: string
          target_identifier?: string
          is_engaged?: boolean
          engaged_reason?: string | null
          engaged_by_admin_id?: string | null
          engaged_at?: string
          released_at?: string | null
        }
        Relationships: [
        ]
      }
      instagram_dm_audit: {
        Row: {
          id: string
          workspace_id: string
          thread_id: string | null
          actor: string
          actor_user_id: string | null
          action: string
          provider_message_id: string | null
          readback_verified: boolean
          details: Json
          created_at: string
        }
        Insert: {
          id?: string
          workspace_id: string
          thread_id?: string | null
          actor: string
          actor_user_id?: string | null
          action: string
          provider_message_id?: string | null
          readback_verified?: boolean
          details?: Json
          created_at?: string
        }
        Update: {
          id?: string
          workspace_id?: string
          thread_id?: string | null
          actor?: string
          actor_user_id?: string | null
          action?: string
          provider_message_id?: string | null
          readback_verified?: boolean
          details?: Json
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "instagram_dm_audit_thread_fk"
            columns: ["workspace_id", "workspace_id", "thread_id", "thread_id"]
            isOneToOne: false
            referencedRelation: "instagram_dm_threads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "instagram_dm_audit_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      instagram_dm_drafts: {
        Row: {
          id: string
          workspace_id: string
          thread_id: string
          selected_option_id: string | null
          options: Json
          draft_text: string
          approved_fingerprint: string | null
          approved_by: string | null
          approved_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          workspace_id: string
          thread_id: string
          selected_option_id?: string | null
          options?: Json
          draft_text: string
          approved_fingerprint?: string | null
          approved_by?: string | null
          approved_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          workspace_id?: string
          thread_id?: string
          selected_option_id?: string | null
          options?: Json
          draft_text?: string
          approved_fingerprint?: string | null
          approved_by?: string | null
          approved_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "instagram_dm_drafts_thread_fk"
            columns: ["workspace_id", "workspace_id", "thread_id", "thread_id"]
            isOneToOne: false
            referencedRelation: "instagram_dm_threads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "instagram_dm_drafts_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      instagram_dm_messages: {
        Row: {
          id: string
          workspace_id: string
          thread_id: string
          provider_message_id: string
          sender_type: string
          sender_id: string
          text: string
          sent_at: string
          created_at: string
        }
        Insert: {
          id?: string
          workspace_id: string
          thread_id: string
          provider_message_id: string
          sender_type: string
          sender_id: string
          text: string
          sent_at: string
          created_at?: string
        }
        Update: {
          id?: string
          workspace_id?: string
          thread_id?: string
          provider_message_id?: string
          sender_type?: string
          sender_id?: string
          text?: string
          sent_at?: string
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "instagram_dm_messages_thread_fk"
            columns: ["workspace_id", "workspace_id", "thread_id", "thread_id"]
            isOneToOne: false
            referencedRelation: "instagram_dm_threads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "instagram_dm_messages_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      instagram_dm_threads: {
        Row: {
          id: string
          workspace_id: string
          channel_connection_id: string
          channel: string
          provider_thread_id: string
          customer_id: string
          customer_handle: string
          customer_name: string | null
          last_message_at: string
          expires_at: string
          status: string
          last_message_text: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          workspace_id: string
          channel_connection_id: string
          channel?: string
          provider_thread_id: string
          customer_id: string
          customer_handle: string
          customer_name?: string | null
          last_message_at: string
          expires_at: string
          status?: string
          last_message_text: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          workspace_id?: string
          channel_connection_id?: string
          channel?: string
          provider_thread_id?: string
          customer_id?: string
          customer_handle?: string
          customer_name?: string | null
          last_message_at?: string
          expires_at?: string
          status?: string
          last_message_text?: string
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "instagram_dm_threads_connection_fk"
            columns: ["workspace_id", "workspace_id", "channel_connection_id", "channel_connection_id"]
            isOneToOne: false
            referencedRelation: "channel_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "instagram_dm_threads_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      kill_switches: {
        Row: {
          id: string
          scope: string
          target_id: string | null
          reason: string
          engaged_by: string
          engaged_at: string
          is_active: boolean
        }
        Insert: {
          id?: string
          scope: string
          target_id?: string | null
          reason: string
          engaged_by: string
          engaged_at?: string
          is_active?: boolean
        }
        Update: {
          id?: string
          scope?: string
          target_id?: string | null
          reason?: string
          engaged_by?: string
          engaged_at?: string
          is_active?: boolean
        }
        Relationships: [
        ]
      }
      knowledge_candidates: {
        Row: {
          id: string
          workspace_id: string
          knowledge_source_id: string
          category: string
          content: string
          source_excerpt: string | null
          source_location: string | null
          confidence: number | null
          status: string
          conflicts_with_fact_id: string | null
          version: number
          review_reason: string | null
          reviewed_by_user_id: string | null
          reviewed_at: string | null
          created_by_user_id: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          workspace_id: string
          knowledge_source_id: string
          category: string
          content: string
          source_excerpt?: string | null
          source_location?: string | null
          confidence?: number | null
          status?: string
          conflicts_with_fact_id?: string | null
          version?: number
          review_reason?: string | null
          reviewed_by_user_id?: string | null
          reviewed_at?: string | null
          created_by_user_id: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          workspace_id?: string
          knowledge_source_id?: string
          category?: string
          content?: string
          source_excerpt?: string | null
          source_location?: string | null
          confidence?: number | null
          status?: string
          conflicts_with_fact_id?: string | null
          version?: number
          review_reason?: string | null
          reviewed_by_user_id?: string | null
          reviewed_at?: string | null
          created_by_user_id?: string
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_candidates_conflict_fact_fkey"
            columns: ["workspace_id", "workspace_id", "conflicts_with_fact_id", "conflicts_with_fact_id"]
            isOneToOne: false
            referencedRelation: "knowledge_facts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "knowledge_candidates_source_fkey"
            columns: ["workspace_id", "workspace_id", "knowledge_source_id", "knowledge_source_id"]
            isOneToOne: false
            referencedRelation: "knowledge_sources"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "knowledge_candidates_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      knowledge_facts: {
        Row: {
          id: string
          workspace_id: string
          category: string
          content: string
          status: string
          source_candidate_id: string
          approved_by_user_id: string
          approved_at: string
          valid_from: string
          valid_until: string | null
          supersedes_fact_id: string | null
          created_at: string
        }
        Insert: {
          id?: string
          workspace_id: string
          category: string
          content: string
          status?: string
          source_candidate_id: string
          approved_by_user_id: string
          approved_at: string
          valid_from?: string
          valid_until?: string | null
          supersedes_fact_id?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          workspace_id?: string
          category?: string
          content?: string
          status?: string
          source_candidate_id?: string
          approved_by_user_id?: string
          approved_at?: string
          valid_from?: string
          valid_until?: string | null
          supersedes_fact_id?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_facts_source_candidate_fkey"
            columns: ["workspace_id", "workspace_id", "source_candidate_id", "source_candidate_id"]
            isOneToOne: false
            referencedRelation: "knowledge_candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "knowledge_facts_supersedes_fact_fkey"
            columns: ["workspace_id", "workspace_id", "supersedes_fact_id", "supersedes_fact_id"]
            isOneToOne: false
            referencedRelation: "knowledge_facts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "knowledge_facts_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      knowledge_items: {
        Row: {
          id: string
          workspace_id: string
          media_asset_id: string | null
          name: string
          status: string
          evidence: Json
          created_by: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          workspace_id: string
          media_asset_id?: string | null
          name: string
          status?: string
          evidence?: Json
          created_by: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          workspace_id?: string
          media_asset_id?: string | null
          name?: string
          status?: string
          evidence?: Json
          created_by?: string
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_items_media_asset_fkey"
            columns: ["workspace_id", "workspace_id", "media_asset_id", "media_asset_id"]
            isOneToOne: false
            referencedRelation: "media_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "knowledge_items_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      knowledge_sources: {
        Row: {
          id: string
          workspace_id: string
          source_type: string
          provider_mode: string
          channel_type: string | null
          uri: string | null
          file_asset_id: string | null
          display_name: string
          status: string
          refresh_policy: Json
          last_checked_at: string | null
          next_check_at: string | null
          error_code: string | null
          version: number
          created_by_user_id: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          workspace_id: string
          source_type: string
          provider_mode?: string
          channel_type?: string | null
          uri?: string | null
          file_asset_id?: string | null
          display_name: string
          status?: string
          refresh_policy?: Json
          last_checked_at?: string | null
          next_check_at?: string | null
          error_code?: string | null
          version?: number
          created_by_user_id: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          workspace_id?: string
          source_type?: string
          provider_mode?: string
          channel_type?: string | null
          uri?: string | null
          file_asset_id?: string | null
          display_name?: string
          status?: string
          refresh_policy?: Json
          last_checked_at?: string | null
          next_check_at?: string | null
          error_code?: string | null
          version?: number
          created_by_user_id?: string
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_sources_file_asset_fkey"
            columns: ["workspace_id", "workspace_id", "file_asset_id", "file_asset_id"]
            isOneToOne: false
            referencedRelation: "media_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "knowledge_sources_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      legal_document_versions: {
        Row: {
          id: string
          document_type: string
          version: string
          fingerprint: string
          effective_at: string
          expires_at: string | null
          status: string
          created_by: string
          created_at: string
          idempotency_key: string | null
          review_status: string
          reviewed_by: string | null
          reviewed_at: string | null
          review_idempotency_key: string | null
          activation_idempotency_key: string | null
        }
        Insert: {
          id?: string
          document_type: string
          version: string
          fingerprint: string
          effective_at: string
          expires_at?: string | null
          status: string
          created_by: string
          created_at?: string
          idempotency_key?: string | null
          review_status?: string
          reviewed_by?: string | null
          reviewed_at?: string | null
          review_idempotency_key?: string | null
          activation_idempotency_key?: string | null
        }
        Update: {
          id?: string
          document_type?: string
          version?: string
          fingerprint?: string
          effective_at?: string
          expires_at?: string | null
          status?: string
          created_by?: string
          created_at?: string
          idempotency_key?: string | null
          review_status?: string
          reviewed_by?: string | null
          reviewed_at?: string | null
          review_idempotency_key?: string | null
          activation_idempotency_key?: string | null
        }
        Relationships: [
        ]
      }
      marketing_missions: {
        Row: {
          id: string
          workspace_id: string
          trace_id: string
          status: string
          goal: string
          strategy_summary: string | null
          target_channel: string | null
          target_audience: string | null
          source_message_id: string | null
          source_conversation_job_id: string | null
          content_id: string | null
          content_version_id: string | null
          approval_id: string | null
          external_action_request_id: string | null
          external_action_attempt_id: string | null
          external_action_receipt_id: string | null
          customer_id: string | null
          booking_id: string | null
          outcome_id: string | null
          next_action_id: string | null
          metadata: Json
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          workspace_id: string
          trace_id: string
          status?: string
          goal: string
          strategy_summary?: string | null
          target_channel?: string | null
          target_audience?: string | null
          source_message_id?: string | null
          source_conversation_job_id?: string | null
          content_id?: string | null
          content_version_id?: string | null
          approval_id?: string | null
          external_action_request_id?: string | null
          external_action_attempt_id?: string | null
          external_action_receipt_id?: string | null
          customer_id?: string | null
          booking_id?: string | null
          outcome_id?: string | null
          next_action_id?: string | null
          metadata?: Json
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          workspace_id?: string
          trace_id?: string
          status?: string
          goal?: string
          strategy_summary?: string | null
          target_channel?: string | null
          target_audience?: string | null
          source_message_id?: string | null
          source_conversation_job_id?: string | null
          content_id?: string | null
          content_version_id?: string | null
          approval_id?: string | null
          external_action_request_id?: string | null
          external_action_attempt_id?: string | null
          external_action_receipt_id?: string | null
          customer_id?: string | null
          booking_id?: string | null
          outcome_id?: string | null
          next_action_id?: string | null
          metadata?: Json
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "marketing_missions_approval_id_fkey"
            columns: ["approval_id"]
            isOneToOne: false
            referencedRelation: "approvals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marketing_missions_content_id_fkey"
            columns: ["content_id"]
            isOneToOne: false
            referencedRelation: "content_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marketing_missions_content_version_id_fkey"
            columns: ["content_version_id"]
            isOneToOne: false
            referencedRelation: "content_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marketing_missions_source_conversation_job_id_fkey"
            columns: ["source_conversation_job_id"]
            isOneToOne: false
            referencedRelation: "conversation_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marketing_missions_source_message_id_fkey"
            columns: ["source_message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marketing_missions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      media_asset_quarantine_backup: {
        Row: {
          backup_id: string
          asset_id: string
          workspace_id: string
          bucket_id: string
          object_path: string
          mime_type: string
          size_bytes: number
          rights_status: string
          generation_metadata: Json
          sha256_digest: string | null
          original_provenance_kind: string
          original_lifecycle_status: string
          original_publish_eligibility: boolean
          quarantine_reason: string
          backed_up_at: string
        }
        Insert: {
          backup_id?: string
          asset_id: string
          workspace_id: string
          bucket_id: string
          object_path: string
          mime_type: string
          size_bytes: number
          rights_status: string
          generation_metadata: Json
          sha256_digest?: string | null
          original_provenance_kind: string
          original_lifecycle_status: string
          original_publish_eligibility: boolean
          quarantine_reason: string
          backed_up_at?: string
        }
        Update: {
          backup_id?: string
          asset_id?: string
          workspace_id?: string
          bucket_id?: string
          object_path?: string
          mime_type?: string
          size_bytes?: number
          rights_status?: string
          generation_metadata?: Json
          sha256_digest?: string | null
          original_provenance_kind?: string
          original_lifecycle_status?: string
          original_publish_eligibility?: boolean
          quarantine_reason?: string
          backed_up_at?: string
        }
        Relationships: [
        ]
      }
      media_assets: {
        Row: {
          id: string
          workspace_id: string
          bucket_id: string
          object_path: string
          kind: string
          mime_type: string
          size_bytes: number
          rights_status: string
          created_by: string
          created_at: string
          generation_metadata: Json
          sha256_digest: string | null
          provenance_kind: string
          width: number | null
          height: number | null
          lifecycle_status: string
          publish_eligibility: boolean
        }
        Insert: {
          id?: string
          workspace_id: string
          bucket_id: string
          object_path: string
          kind: string
          mime_type: string
          size_bytes: number
          rights_status?: string
          created_by: string
          created_at?: string
          generation_metadata?: Json
          sha256_digest?: string | null
          provenance_kind?: string
          width?: number | null
          height?: number | null
          lifecycle_status?: string
          publish_eligibility?: boolean
        }
        Update: {
          id?: string
          workspace_id?: string
          bucket_id?: string
          object_path?: string
          kind?: string
          mime_type?: string
          size_bytes?: number
          rights_status?: string
          created_by?: string
          created_at?: string
          generation_metadata?: Json
          sha256_digest?: string | null
          provenance_kind?: string
          width?: number | null
          height?: number | null
          lifecycle_status?: string
          publish_eligibility?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "media_assets_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      message_artifacts: {
        Row: {
          workspace_id: string
          message_id: string
          artifact_id: string
          created_at: string
        }
        Insert: {
          workspace_id: string
          message_id: string
          artifact_id: string
          created_at?: string
        }
        Update: {
          workspace_id?: string
          message_id?: string
          artifact_id?: string
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "message_artifacts_workspace_artifact_fkey"
            columns: ["workspace_id", "workspace_id", "artifact_id", "artifact_id"]
            isOneToOne: false
            referencedRelation: "conversation_artifacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_artifacts_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_artifacts_workspace_message_fkey"
            columns: ["workspace_id", "workspace_id", "message_id", "message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
        ]
      }
      message_evidence: {
        Row: {
          id: string
          workspace_id: string
          message_id: string
          evidence_type: string
          evidence_id: string
          label: string
          excerpt: string | null
          source_uri: string | null
          source_timestamp: string | null
          confidence: number | null
          created_at: string
        }
        Insert: {
          id?: string
          workspace_id: string
          message_id: string
          evidence_type: string
          evidence_id: string
          label: string
          excerpt?: string | null
          source_uri?: string | null
          source_timestamp?: string | null
          confidence?: number | null
          created_at?: string
        }
        Update: {
          id?: string
          workspace_id?: string
          message_id?: string
          evidence_type?: string
          evidence_id?: string
          label?: string
          excerpt?: string | null
          source_uri?: string | null
          source_timestamp?: string | null
          confidence?: number | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "message_evidence_message_fkey"
            columns: ["workspace_id", "workspace_id", "message_id", "message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_evidence_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          id: string
          workspace_id: string
          thread_id: string
          role: string
          content: string
          status: string
          client_message_id: string | null
          reply_to_message_id: string | null
          work_item_id: string | null
          artifact_type: string | null
          artifact_id: string | null
          model_name: string | null
          usage_metadata: Json
          error_code: string | null
          created_by_user_id: string | null
          created_at: string
          completed_at: string | null
          content_parts: Json
          tool_calls: Json
          run_id: string | null
          evidence_refs: Json
        }
        Insert: {
          id?: string
          workspace_id: string
          thread_id: string
          role: string
          content: string
          status: string
          client_message_id?: string | null
          reply_to_message_id?: string | null
          work_item_id?: string | null
          artifact_type?: string | null
          artifact_id?: string | null
          model_name?: string | null
          usage_metadata?: Json
          error_code?: string | null
          created_by_user_id?: string | null
          created_at?: string
          completed_at?: string | null
          content_parts?: Json
          tool_calls?: Json
          run_id?: string | null
          evidence_refs?: Json
        }
        Update: {
          id?: string
          workspace_id?: string
          thread_id?: string
          role?: string
          content?: string
          status?: string
          client_message_id?: string | null
          reply_to_message_id?: string | null
          work_item_id?: string | null
          artifact_type?: string | null
          artifact_id?: string | null
          model_name?: string | null
          usage_metadata?: Json
          error_code?: string | null
          created_by_user_id?: string | null
          created_at?: string
          completed_at?: string | null
          content_parts?: Json
          tool_calls?: Json
          run_id?: string | null
          evidence_refs?: Json
        }
        Relationships: [
          {
            foreignKeyName: "messages_reply_to_fkey"
            columns: ["workspace_id", "workspace_id", "workspace_id", "thread_id", "thread_id", "thread_id", "reply_to_message_id", "reply_to_message_id", "reply_to_message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_thread_fkey"
            columns: ["workspace_id", "workspace_id", "thread_id", "thread_id"]
            isOneToOne: false
            referencedRelation: "conversation_threads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_work_item_fkey"
            columns: ["workspace_id", "workspace_id", "work_item_id", "work_item_id"]
            isOneToOne: false
            referencedRelation: "work_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      meta_channel_credentials: {
        Row: {
          id: string
          workspace_id: string
          channel_connection_id: string
          provider: string
          encrypted_access_token: string
          access_token_iv: string
          encryption_algorithm: string
          granted_scopes: string[]
          token_expires_at: string | null
          refresh_after: string | null
          status: string
          last_error_code: string | null
          created_at: string
          updated_at: string
          key_version: number
        }
        Insert: {
          id?: string
          workspace_id: string
          channel_connection_id: string
          provider: string
          encrypted_access_token: string
          access_token_iv: string
          encryption_algorithm?: string
          granted_scopes?: string[]
          token_expires_at?: string | null
          refresh_after?: string | null
          status?: string
          last_error_code?: string | null
          created_at?: string
          updated_at?: string
          key_version?: number
        }
        Update: {
          id?: string
          workspace_id?: string
          channel_connection_id?: string
          provider?: string
          encrypted_access_token?: string
          access_token_iv?: string
          encryption_algorithm?: string
          granted_scopes?: string[]
          token_expires_at?: string | null
          refresh_after?: string | null
          status?: string
          last_error_code?: string | null
          created_at?: string
          updated_at?: string
          key_version?: number
        }
        Relationships: [
          {
            foreignKeyName: "meta_channel_credentials_connection_fkey"
            columns: ["workspace_id", "workspace_id", "channel_connection_id", "channel_connection_id"]
            isOneToOne: false
            referencedRelation: "channel_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meta_channel_credentials_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      mission_action_receipts: {
        Row: {
          id: string
          workspace_id: string
          mission_id: string
          action_request_id: string
          action_receipt_id: string
          action_fingerprint: string
          provider: string
          cost_minor_units: number | null
          verified_at: string | null
          created_at: string
        }
        Insert: {
          id?: string
          workspace_id: string
          mission_id: string
          action_request_id: string
          action_receipt_id: string
          action_fingerprint: string
          provider: string
          cost_minor_units?: number | null
          verified_at?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          workspace_id?: string
          mission_id?: string
          action_request_id?: string
          action_receipt_id?: string
          action_fingerprint?: string
          provider?: string
          cost_minor_units?: number | null
          verified_at?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "mission_action_receipts_mission_fkey"
            columns: ["workspace_id", "workspace_id", "mission_id", "mission_id"]
            isOneToOne: false
            referencedRelation: "marketing_missions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mission_action_receipts_receipt_fkey"
            columns: ["workspace_id", "workspace_id", "action_receipt_id", "action_receipt_id"]
            isOneToOne: false
            referencedRelation: "external_action_receipts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mission_action_receipts_request_fkey"
            columns: ["workspace_id", "workspace_id", "action_request_id", "action_request_id"]
            isOneToOne: false
            referencedRelation: "external_action_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mission_action_receipts_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      mission_events: {
        Row: {
          id: string
          workspace_id: string
          mission_id: string | null
          trace_id: string
          from_status: string | null
          to_status: string
          actor_type: string
          actor_id: string | null
          event_name: string
          payload: Json
          occurred_at: string
        }
        Insert: {
          id?: string
          workspace_id: string
          mission_id?: string | null
          trace_id: string
          from_status?: string | null
          to_status: string
          actor_type: string
          actor_id?: string | null
          event_name: string
          payload?: Json
          occurred_at?: string
        }
        Update: {
          id?: string
          workspace_id?: string
          mission_id?: string | null
          trace_id?: string
          from_status?: string | null
          to_status?: string
          actor_type?: string
          actor_id?: string | null
          event_name?: string
          payload?: Json
          occurred_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "mission_events_mission_id_fkey"
            columns: ["mission_id"]
            isOneToOne: false
            referencedRelation: "marketing_missions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mission_events_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mission_events_workspace_mission_fkey"
            columns: ["workspace_id", "workspace_id", "mission_id", "mission_id"]
            isOneToOne: false
            referencedRelation: "marketing_missions"
            referencedColumns: ["id"]
          },
        ]
      }
      naver_blog_categories: {
        Row: {
          id: string
          workspace_id: string
          browser_channel_connection_id: string
          categories: Json
          synced_at: string
          source_device_id: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          workspace_id: string
          browser_channel_connection_id: string
          categories?: Json
          synced_at?: string
          source_device_id?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          workspace_id?: string
          browser_channel_connection_id?: string
          categories?: Json
          synced_at?: string
          source_device_id?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "naver_blog_categories_browser_channel_connection_id_fkey"
            columns: ["browser_channel_connection_id"]
            isOneToOne: false
            referencedRelation: "browser_channel_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "naver_blog_categories_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      naver_post_jobs: {
        Row: {
          id: string
          workspace_id: string
          request_key: string
          user_id: string
          status: string
          content_id: string | null
          version_id: string | null
          credit_reconcile_needed: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          workspace_id: string
          request_key: string
          user_id: string
          status: string
          content_id?: string | null
          version_id?: string | null
          credit_reconcile_needed?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          workspace_id?: string
          request_key?: string
          user_id?: string
          status?: string
          content_id?: string | null
          version_id?: string | null
          credit_reconcile_needed?: boolean
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "naver_post_jobs_content_id_fkey"
            columns: ["content_id"]
            isOneToOne: false
            referencedRelation: "content_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "naver_post_jobs_version_id_fkey"
            columns: ["version_id"]
            isOneToOne: false
            referencedRelation: "content_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "naver_post_jobs_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      notice_jobs: {
        Row: {
          id: string
          workspace_id: string
          booking_id: string
          booking_version: number
          kind: string
          template_version: string
          recipient_ref_hash: string
          scheduled_at: string
          payload_fingerprint: string
          status: string
          claim_generation: number
          dataset_mode: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          workspace_id: string
          booking_id: string
          booking_version: number
          kind: string
          template_version: string
          recipient_ref_hash: string
          scheduled_at: string
          payload_fingerprint: string
          status?: string
          claim_generation?: number
          dataset_mode?: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          workspace_id?: string
          booking_id?: string
          booking_version?: number
          kind?: string
          template_version?: string
          recipient_ref_hash?: string
          scheduled_at?: string
          payload_fingerprint?: string
          status?: string
          claim_generation?: number
          dataset_mode?: string
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "notice_jobs_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_preferences: {
        Row: {
          workspace_id: string
          user_id: string
          approval_events: boolean
          schedule_events: boolean
          publish_events: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          workspace_id: string
          user_id: string
          approval_events?: boolean
          schedule_events?: boolean
          publish_events?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          workspace_id?: string
          user_id?: string
          approval_events?: boolean
          schedule_events?: boolean
          publish_events?: boolean
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_preferences_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          id: string
          workspace_id: string
          user_id: string
          kind: string
          body: string
          href: string | null
          read_at: string | null
          created_at: string
          event_key: string | null
        }
        Insert: {
          id?: string
          workspace_id: string
          user_id: string
          kind: string
          body: string
          href?: string | null
          read_at?: string | null
          created_at?: string
          event_key?: string | null
        }
        Update: {
          id?: string
          workspace_id?: string
          user_id?: string
          kind?: string
          body?: string
          href?: string | null
          read_at?: string | null
          created_at?: string
          event_key?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notifications_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      oauth_state_nonces: {
        Row: {
          nonce_sha256: string
          workspace_id: string
          actor_user_id: string
          provider: string
          expires_at: string
          consumed_at: string | null
          created_at: string
        }
        Insert: {
          nonce_sha256: string
          workspace_id: string
          actor_user_id: string
          provider: string
          expires_at: string
          consumed_at?: string | null
          created_at?: string
        }
        Update: {
          nonce_sha256?: string
          workspace_id?: string
          actor_user_id?: string
          provider?: string
          expires_at?: string
          consumed_at?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "oauth_state_nonces_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      oauth_transactions: {
        Row: {
          id: string
          workspace_id: string
          user_id: string
          provider: string
          channel: string
          state_hash: string
          code_verifier: string | null
          redirect_uri: string
          requested_scopes: string[]
          return_path: string | null
          correlation_id: string
          expires_at: string
          consumed_at: string | null
          created_at: string | null
        }
        Insert: {
          id?: string
          workspace_id: string
          user_id: string
          provider: string
          channel: string
          state_hash: string
          code_verifier?: string | null
          redirect_uri: string
          requested_scopes?: string[]
          return_path?: string | null
          correlation_id: string
          expires_at: string
          consumed_at?: string | null
          created_at?: string | null
        }
        Update: {
          id?: string
          workspace_id?: string
          user_id?: string
          provider?: string
          channel?: string
          state_hash?: string
          code_verifier?: string | null
          redirect_uri?: string
          requested_scopes?: string[]
          return_path?: string | null
          correlation_id?: string
          expires_at?: string
          consumed_at?: string | null
          created_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "oauth_transactions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      onboarding_answers: {
        Row: {
          id: string
          session_id: string
          workspace_id: string
          user_id: string
          profile_key: string
          content: string
          client_request_id: string
          created_at: string
        }
        Insert: {
          id?: string
          session_id: string
          workspace_id: string
          user_id: string
          profile_key: string
          content: string
          client_request_id: string
          created_at?: string
        }
        Update: {
          id?: string
          session_id?: string
          workspace_id?: string
          user_id?: string
          profile_key?: string
          content?: string
          client_request_id?: string
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "onboarding_answers_session_fkey"
            columns: ["workspace_id", "workspace_id", "session_id", "session_id"]
            isOneToOne: false
            referencedRelation: "onboarding_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "onboarding_answers_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      onboarding_sessions: {
        Row: {
          id: string
          user_id: string
          workspace_id: string
          thread_id: string
          knowledge_source_id: string
          status: string
          active_step: string
          start_client_request_id: string
          completed_at: string | null
          created_at: string
          updated_at: string
          restart_client_request_id: string | null
        }
        Insert: {
          id?: string
          user_id: string
          workspace_id: string
          thread_id: string
          knowledge_source_id: string
          status?: string
          active_step?: string
          start_client_request_id: string
          completed_at?: string | null
          created_at?: string
          updated_at?: string
          restart_client_request_id?: string | null
        }
        Update: {
          id?: string
          user_id?: string
          workspace_id?: string
          thread_id?: string
          knowledge_source_id?: string
          status?: string
          active_step?: string
          start_client_request_id?: string
          completed_at?: string | null
          created_at?: string
          updated_at?: string
          restart_client_request_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "onboarding_sessions_knowledge_source_fkey"
            columns: ["workspace_id", "workspace_id", "knowledge_source_id", "knowledge_source_id"]
            isOneToOne: false
            referencedRelation: "knowledge_sources"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "onboarding_sessions_thread_fkey"
            columns: ["workspace_id", "workspace_id", "thread_id", "thread_id"]
            isOneToOne: false
            referencedRelation: "conversation_threads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "onboarding_sessions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      operation_events: {
        Row: {
          id: string
          workspace_id: string
          event_type: string
          event_key: string
          subject_type: string
          subject_id: string
          payload: Json
          occurred_at: string
          processed_at: string | null
        }
        Insert: {
          id?: string
          workspace_id: string
          event_type: string
          event_key: string
          subject_type: string
          subject_id: string
          payload?: Json
          occurred_at?: string
          processed_at?: string | null
        }
        Update: {
          id?: string
          workspace_id?: string
          event_type?: string
          event_key?: string
          subject_type?: string
          subject_id?: string
          payload?: Json
          occurred_at?: string
          processed_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "operation_events_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      operator_audit_sessions: {
        Row: {
          session_id: string
          operator_id: string
          workspace_id: string
          reason: string
          active_browser_sessions: Json
          provider_tokens_revoked: Json
          audit_receipt_hash: string
          is_active: boolean
          opened_at: string
          closed_at: string | null
        }
        Insert: {
          session_id: string
          operator_id: string
          workspace_id: string
          reason: string
          active_browser_sessions?: Json
          provider_tokens_revoked?: Json
          audit_receipt_hash: string
          is_active?: boolean
          opened_at?: string
          closed_at?: string | null
        }
        Update: {
          session_id?: string
          operator_id?: string
          workspace_id?: string
          reason?: string
          active_browser_sessions?: Json
          provider_tokens_revoked?: Json
          audit_receipt_hash?: string
          is_active?: boolean
          opened_at?: string
          closed_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "operator_audit_sessions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      operator_incident_timeline: {
        Row: {
          id: string
          incident_id: string
          event_type: string
          fact_kind: string
          reason: string
          version: number
          resulting_status: string
          resulting_recovery_state: string
          idempotency_key: string
          occurred_at: string
          assignee_user_id: string | null
          impact_scope: string | null
          recovery_verified_at: string | null
          recovery_evidence_summary: string | null
          remediation_kind: string | null
          remediation_result: string | null
        }
        Insert: {
          id?: string
          incident_id: string
          event_type: string
          fact_kind: string
          reason: string
          version: number
          resulting_status: string
          resulting_recovery_state: string
          idempotency_key: string
          occurred_at?: string
          assignee_user_id?: string | null
          impact_scope?: string | null
          recovery_verified_at?: string | null
          recovery_evidence_summary?: string | null
          remediation_kind?: string | null
          remediation_result?: string | null
        }
        Update: {
          id?: string
          incident_id?: string
          event_type?: string
          fact_kind?: string
          reason?: string
          version?: number
          resulting_status?: string
          resulting_recovery_state?: string
          idempotency_key?: string
          occurred_at?: string
          assignee_user_id?: string | null
          impact_scope?: string | null
          recovery_verified_at?: string | null
          recovery_evidence_summary?: string | null
          remediation_kind?: string | null
          remediation_result?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "operator_incident_timeline_assignee_user_id_fkey"
            columns: ["assignee_user_id"]
            isOneToOne: false
            referencedRelation: "platform_admin_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "operator_incident_timeline_incident_id_fkey"
            columns: ["incident_id"]
            isOneToOne: false
            referencedRelation: "operator_incidents"
            referencedColumns: ["id"]
          },
        ]
      }
      operator_incidents: {
        Row: {
          id: string
          source: string
          source_state: string
          source_freshness: string
          source_observed_at: string | null
          title: string
          severity: string
          status: string
          version: number
          reason: string
          fact_kind: string
          rollback_candidate_code: string | null
          recovery_state: string
          opened_at: string
          updated_at: string
          freshness: string
          assignee_user_id: string | null
          impact_scope: string | null
          recovery_verified_at: string | null
          recovery_evidence_summary: string | null
          remediation_kind: string | null
          remediation_result: string | null
        }
        Insert: {
          id?: string
          source: string
          source_state: string
          source_freshness: string
          source_observed_at?: string | null
          title: string
          severity: string
          status?: string
          version?: number
          reason: string
          fact_kind: string
          rollback_candidate_code?: string | null
          recovery_state?: string
          opened_at?: string
          updated_at?: string
          freshness: string
          assignee_user_id?: string | null
          impact_scope?: string | null
          recovery_verified_at?: string | null
          recovery_evidence_summary?: string | null
          remediation_kind?: string | null
          remediation_result?: string | null
        }
        Update: {
          id?: string
          source?: string
          source_state?: string
          source_freshness?: string
          source_observed_at?: string | null
          title?: string
          severity?: string
          status?: string
          version?: number
          reason?: string
          fact_kind?: string
          rollback_candidate_code?: string | null
          recovery_state?: string
          opened_at?: string
          updated_at?: string
          freshness?: string
          assignee_user_id?: string | null
          impact_scope?: string | null
          recovery_verified_at?: string | null
          recovery_evidence_summary?: string | null
          remediation_kind?: string | null
          remediation_result?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "operator_incidents_assignee_user_id_fkey"
            columns: ["assignee_user_id"]
            isOneToOne: false
            referencedRelation: "platform_admin_members"
            referencedColumns: ["id"]
          },
        ]
      }
      operator_queue_observation_snapshots: {
        Row: {
          kind: string
          state: string
          observed_at: string | null
          safe_code: string | null
          metric_value: number | null
          fact_kind: string
          updated_at: string
        }
        Insert: {
          kind: string
          state: string
          observed_at?: string | null
          safe_code?: string | null
          metric_value?: number | null
          fact_kind?: string
          updated_at?: string
        }
        Update: {
          kind?: string
          state?: string
          observed_at?: string | null
          safe_code?: string | null
          metric_value?: number | null
          fact_kind?: string
          updated_at?: string
        }
        Relationships: [
        ]
      }
      operator_release_observation_snapshots: {
        Row: {
          id: boolean
          version_code: string | null
          commit_sha_prefix: string | null
          deployed_at: string | null
          rollback_candidate_code: string | null
          verification_state: string
          observed_at: string | null
          fact_kind: string
          updated_at: string
        }
        Insert: {
          id?: boolean
          version_code?: string | null
          commit_sha_prefix?: string | null
          deployed_at?: string | null
          rollback_candidate_code?: string | null
          verification_state?: string
          observed_at?: string | null
          fact_kind?: string
          updated_at?: string
        }
        Update: {
          id?: boolean
          version_code?: string | null
          commit_sha_prefix?: string | null
          deployed_at?: string | null
          rollback_candidate_code?: string | null
          verification_state?: string
          observed_at?: string | null
          fact_kind?: string
          updated_at?: string
        }
        Relationships: [
        ]
      }
      operator_support_sessions: {
        Row: {
          id: string
          workspace_id: string
          operator_user_id: string
          mode: string
          status: string
          reason: string
          close_reason: string | null
          idempotency_key: string
          end_idempotency_key: string | null
          expire_idempotency_key: string | null
          revoke_idempotency_key: string | null
          started_at: string
          expires_at: string
          ended_at: string | null
          closed_at: string | null
        }
        Insert: {
          id?: string
          workspace_id: string
          operator_user_id: string
          mode?: string
          status?: string
          reason: string
          close_reason?: string | null
          idempotency_key: string
          end_idempotency_key?: string | null
          expire_idempotency_key?: string | null
          revoke_idempotency_key?: string | null
          started_at?: string
          expires_at: string
          ended_at?: string | null
          closed_at?: string | null
        }
        Update: {
          id?: string
          workspace_id?: string
          operator_user_id?: string
          mode?: string
          status?: string
          reason?: string
          close_reason?: string | null
          idempotency_key?: string
          end_idempotency_key?: string | null
          expire_idempotency_key?: string | null
          revoke_idempotency_key?: string | null
          started_at?: string
          expires_at?: string
          ended_at?: string | null
          closed_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "operator_support_sessions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      operator_system_observation_snapshots: {
        Row: {
          source: string
          state: string
          observed_at: string | null
          safe_code: string | null
          metric_value: number | null
          created_at: string
          updated_at: string
        }
        Insert: {
          source: string
          state: string
          observed_at?: string | null
          safe_code?: string | null
          metric_value?: number | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          source?: string
          state?: string
          observed_at?: string | null
          safe_code?: string | null
          metric_value?: number | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
        ]
      }
      payment_captures: {
        Row: {
          id: string
          workspace_id: string
          provider: string
          payment_ref: string
          intent_id: string
          amount_krw: number
          currency: string
          paid_at: string
          disputed: boolean
          dataset_mode: string
          created_at: string
        }
        Insert: {
          id?: string
          workspace_id: string
          provider: string
          payment_ref: string
          intent_id: string
          amount_krw: number
          currency: string
          paid_at: string
          disputed?: boolean
          dataset_mode?: string
          created_at?: string
        }
        Update: {
          id?: string
          workspace_id?: string
          provider?: string
          payment_ref?: string
          intent_id?: string
          amount_krw?: number
          currency?: string
          paid_at?: string
          disputed?: boolean
          dataset_mode?: string
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_captures_intent_fk"
            columns: ["workspace_id", "workspace_id", "intent_id", "intent_id"]
            isOneToOne: false
            referencedRelation: "deposit_intents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_captures_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_reconciliation_queue: {
        Row: {
          id: string
          workspace_id: string
          intent_id: string
          reason: string
          dataset_mode: string
          created_at: string
          resolved_at: string | null
        }
        Insert: {
          id?: string
          workspace_id: string
          intent_id: string
          reason: string
          dataset_mode?: string
          created_at?: string
          resolved_at?: string | null
        }
        Update: {
          id?: string
          workspace_id?: string
          intent_id?: string
          reason?: string
          dataset_mode?: string
          created_at?: string
          resolved_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payment_reconciliation_queue_intent_fk"
            columns: ["workspace_id", "workspace_id", "intent_id", "intent_id"]
            isOneToOne: false
            referencedRelation: "deposit_intents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_reconciliation_queue_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_webhook_events: {
        Row: {
          id: string
          workspace_id: string
          provider: string
          event_id: string
          payload_digest: string
          intent_id: string
          outcome: string
          dataset_mode: string
          received_at: string
        }
        Insert: {
          id?: string
          workspace_id: string
          provider: string
          event_id: string
          payload_digest: string
          intent_id: string
          outcome: string
          dataset_mode?: string
          received_at?: string
        }
        Update: {
          id?: string
          workspace_id?: string
          provider?: string
          event_id?: string
          payload_digest?: string
          intent_id?: string
          outcome?: string
          dataset_mode?: string
          received_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_webhook_events_intent_fk"
            columns: ["workspace_id", "workspace_id", "intent_id", "intent_id"]
            isOneToOne: false
            referencedRelation: "deposit_intents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_webhook_events_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      performance_learning_candidates: {
        Row: {
          id: string
          workspace_id: string
          source_report_snapshot_id: string | null
          observation: Json
          interpretation: Json
          proposed_impact: Json
          stop_condition: Json
          status: string
          version: number
          decided_by: string | null
          decided_at: string | null
          review_reason: string | null
          created_by: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          workspace_id: string
          source_report_snapshot_id?: string | null
          observation: Json
          interpretation: Json
          proposed_impact: Json
          stop_condition: Json
          status?: string
          version?: number
          decided_by?: string | null
          decided_at?: string | null
          review_reason?: string | null
          created_by: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          workspace_id?: string
          source_report_snapshot_id?: string | null
          observation?: Json
          interpretation?: Json
          proposed_impact?: Json
          stop_condition?: Json
          status?: string
          version?: number
          decided_by?: string | null
          decided_at?: string | null
          review_reason?: string | null
          created_by?: string
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "performance_learning_candidates_source_report_snapshot_id_fkey"
            columns: ["source_report_snapshot_id"]
            isOneToOne: false
            referencedRelation: "report_snapshots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "performance_learning_candidates_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_admin_members: {
        Row: {
          user_id: string
          status: string
          mfa_required: boolean
          last_reviewed_at: string | null
          created_at: string
          updated_at: string
          password_set_at: string | null
          activated_at: string | null
          mfa_exception_until: string | null
          mfa_exception_retired_at: string | null
          version: number
        }
        Insert: {
          user_id: string
          status: string
          mfa_required?: boolean
          last_reviewed_at?: string | null
          created_at?: string
          updated_at?: string
          password_set_at?: string | null
          activated_at?: string | null
          mfa_exception_until?: string | null
          mfa_exception_retired_at?: string | null
          version?: number
        }
        Update: {
          user_id?: string
          status?: string
          mfa_required?: boolean
          last_reviewed_at?: string | null
          created_at?: string
          updated_at?: string
          password_set_at?: string | null
          activated_at?: string | null
          mfa_exception_until?: string | null
          mfa_exception_retired_at?: string | null
          version?: number
        }
        Relationships: [
        ]
      }
      platform_admin_role_assignments: {
        Row: {
          id: string
          user_id: string
          role_key: string
          workspace_id: string | null
          created_at: string
          version: number
        }
        Insert: {
          id?: string
          user_id: string
          role_key: string
          workspace_id?: string | null
          created_at?: string
          version?: number
        }
        Update: {
          id?: string
          user_id?: string
          role_key?: string
          workspace_id?: string | null
          created_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "platform_admin_role_assignments_role_key_fkey"
            columns: ["role_key"]
            isOneToOne: false
            referencedRelation: "platform_roles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "platform_admin_role_assignments_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_audit_events: {
        Row: {
          id: string
          actor_user_id: string
          workspace_id: string | null
          action: string
          target_type: string
          target_id: string
          reason: string
          request_id: string
          result: string
          fact_kind: string
          before: Json
          after: Json
          idempotency_key: string
          approval_request_id: string | null
          actor_role_snapshot: Json | null
          created_at: string
        }
        Insert: {
          id?: string
          actor_user_id: string
          workspace_id?: string | null
          action: string
          target_type: string
          target_id: string
          reason: string
          request_id: string
          result: string
          fact_kind: string
          before?: Json
          after?: Json
          idempotency_key: string
          approval_request_id?: string | null
          actor_role_snapshot?: Json | null
          created_at?: string
        }
        Update: {
          id?: string
          actor_user_id?: string
          workspace_id?: string | null
          action?: string
          target_type?: string
          target_id?: string
          reason?: string
          request_id?: string
          result?: string
          fact_kind?: string
          before?: Json
          after?: Json
          idempotency_key?: string
          approval_request_id?: string | null
          actor_role_snapshot?: Json | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "platform_audit_events_approval_request_id_fkey"
            columns: ["approval_request_id"]
            isOneToOne: false
            referencedRelation: "admin_approval_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "platform_audit_events_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_role_permissions: {
        Row: {
          role_key: string
          permission_key: string
          created_at: string
        }
        Insert: {
          role_key: string
          permission_key: string
          created_at?: string
        }
        Update: {
          role_key?: string
          permission_key?: string
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "platform_role_permissions_role_key_fkey"
            columns: ["role_key"]
            isOneToOne: false
            referencedRelation: "platform_roles"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_roles: {
        Row: {
          role_key: string
          display_name: string
          created_at: string
        }
        Insert: {
          role_key: string
          display_name: string
          created_at?: string
        }
        Update: {
          role_key?: string
          display_name?: string
          created_at?: string
        }
        Relationships: [
        ]
      }
      preflight_runs: {
        Row: {
          id: string
          workspace_id: string
          vault_item_id: string
          run_at: string
          overall: string
          items: Json
          triggered_by: string | null
        }
        Insert: {
          id?: string
          workspace_id: string
          vault_item_id: string
          run_at?: string
          overall: string
          items?: Json
          triggered_by?: string | null
        }
        Update: {
          id?: string
          workspace_id?: string
          vault_item_id?: string
          run_at?: string
          overall?: string
          items?: Json
          triggered_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "preflight_runs_item_fk"
            columns: ["workspace_id", "workspace_id", "vault_item_id", "vault_item_id"]
            isOneToOne: false
            referencedRelation: "vault_items"
            referencedColumns: ["id"]
          },
        ]
      }
      privileged_support_sessions: {
        Row: {
          id: string
          target_workspace_id: string
          admin_user_id: string
          reason: string
          started_at: string
          expires_at: string
          is_active: boolean
          actions_performed: Json | null
        }
        Insert: {
          id?: string
          target_workspace_id: string
          admin_user_id: string
          reason: string
          started_at?: string
          expires_at: string
          is_active?: boolean
          actions_performed?: Json | null
        }
        Update: {
          id?: string
          target_workspace_id?: string
          admin_user_id?: string
          reason?: string
          started_at?: string
          expires_at?: string
          is_active?: boolean
          actions_performed?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "privileged_support_sessions_target_workspace_id_fkey"
            columns: ["target_workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          id: string
          display_name: string | null
          created_at: string
          updated_at: string
          avatar_bucket: string | null
          avatar_path: string | null
          avatar_version: number
        }
        Insert: {
          id: string
          display_name?: string | null
          created_at?: string
          updated_at?: string
          avatar_bucket?: string | null
          avatar_path?: string | null
          avatar_version?: number
        }
        Update: {
          id?: string
          display_name?: string | null
          created_at?: string
          updated_at?: string
          avatar_bucket?: string | null
          avatar_path?: string | null
          avatar_version?: number
        }
        Relationships: [
        ]
      }
      proof_chains: {
        Row: {
          evidence_id: string
          workspace_id: string
          action_id: string
          channel: string
          idempotency_key: string
          stage: string
          request_digest: string
          response_digest: string | null
          readback_digest: string | null
          provider_object_id: string | null
          provider_url: string | null
          verifier_version: string
          timestamps: Json
          reconcile_status: string
          mismatch_detail: string | null
          raw_evidence_payload: Json | null
          blocks: Json
          genesis_hash: string | null
          latest_hash: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          evidence_id: string
          workspace_id: string
          action_id: string
          channel: string
          idempotency_key: string
          stage: string
          request_digest: string
          response_digest?: string | null
          readback_digest?: string | null
          provider_object_id?: string | null
          provider_url?: string | null
          verifier_version: string
          timestamps?: Json
          reconcile_status?: string
          mismatch_detail?: string | null
          raw_evidence_payload?: Json | null
          blocks?: Json
          genesis_hash?: string | null
          latest_hash?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          evidence_id?: string
          workspace_id?: string
          action_id?: string
          channel?: string
          idempotency_key?: string
          stage?: string
          request_digest?: string
          response_digest?: string | null
          readback_digest?: string | null
          provider_object_id?: string | null
          provider_url?: string | null
          verifier_version?: string
          timestamps?: Json
          reconcile_status?: string
          mismatch_detail?: string | null
          raw_evidence_payload?: Json | null
          blocks?: Json
          genesis_hash?: string | null
          latest_hash?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "proof_chains_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      provider_delivery_leases: {
        Row: {
          id: string
          workspace_id: string
          rendition_id: string
          provider: string
          purpose: string
          delivery_url: string
          issued_at: string
          expires_at: string
          status: string
        }
        Insert: {
          id?: string
          workspace_id: string
          rendition_id: string
          provider: string
          purpose: string
          delivery_url: string
          issued_at?: string
          expires_at: string
          status?: string
        }
        Update: {
          id?: string
          workspace_id?: string
          rendition_id?: string
          provider?: string
          purpose?: string
          delivery_url?: string
          issued_at?: string
          expires_at?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "provider_delivery_leases_rendition_id_fkey"
            columns: ["rendition_id"]
            isOneToOne: false
            referencedRelation: "publish_renditions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "provider_delivery_leases_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      provider_observed_media: {
        Row: {
          id: string
          workspace_id: string
          provider: string
          provider_media_id: string
          observed_payload: Json
          observed_at: string
          created_at: string
        }
        Insert: {
          id?: string
          workspace_id: string
          provider: string
          provider_media_id: string
          observed_payload?: Json
          observed_at?: string
          created_at?: string
        }
        Update: {
          id?: string
          workspace_id?: string
          provider?: string
          provider_media_id?: string
          observed_payload?: Json
          observed_at?: string
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "provider_observed_media_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      provider_pricing_versions: {
        Row: {
          id: string
          provider: string
          model: string
          operation: string
          input_price_per_million: number
          cached_input_price_per_million: number
          output_price_per_million: number
          image_unit_price: number
          effective_from: string
          effective_to: string | null
          version_tag: string
          created_at: string
        }
        Insert: {
          id?: string
          provider: string
          model: string
          operation: string
          input_price_per_million?: number
          cached_input_price_per_million?: number
          output_price_per_million?: number
          image_unit_price?: number
          effective_from?: string
          effective_to?: string | null
          version_tag?: string
          created_at?: string
        }
        Update: {
          id?: string
          provider?: string
          model?: string
          operation?: string
          input_price_per_million?: number
          cached_input_price_per_million?: number
          output_price_per_million?: number
          image_unit_price?: number
          effective_from?: string
          effective_to?: string | null
          version_tag?: string
          created_at?: string
        }
        Relationships: [
        ]
      }
      provider_usage: {
        Row: {
          usage_id: string
          workspace_id: string
          run_id: string | null
          provider: string
          model_name: string
          prompt_tokens: number
          completion_tokens: number
          total_tokens: number
          cogs_cost_krw: number
          created_at: string
        }
        Insert: {
          usage_id: string
          workspace_id: string
          run_id?: string | null
          provider: string
          model_name: string
          prompt_tokens?: number
          completion_tokens?: number
          total_tokens?: number
          cogs_cost_krw?: number
          created_at?: string
        }
        Update: {
          usage_id?: string
          workspace_id?: string
          run_id?: string | null
          provider?: string
          model_name?: string
          prompt_tokens?: number
          completion_tokens?: number
          total_tokens?: number
          cogs_cost_krw?: number
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "provider_usage_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      provider_webhook_events: {
        Row: {
          id: string
          workspace_id: string
          channel_connection_id: string
          provider: string
          category: string
          event_key: string
          provider_event_id: string | null
          external_subject_id: string | null
          payload: Json
          payload_sha256: string
          status: string
          attempt_count: number
          next_attempt_at: string | null
          last_error_code: string | null
          occurred_at: string
          received_at: string
          processed_at: string | null
          provider_post_reference: string | null
        }
        Insert: {
          id?: string
          workspace_id: string
          channel_connection_id: string
          provider: string
          category: string
          event_key: string
          provider_event_id?: string | null
          external_subject_id?: string | null
          payload: Json
          payload_sha256: string
          status?: string
          attempt_count?: number
          next_attempt_at?: string | null
          last_error_code?: string | null
          occurred_at: string
          received_at?: string
          processed_at?: string | null
          provider_post_reference?: string | null
        }
        Update: {
          id?: string
          workspace_id?: string
          channel_connection_id?: string
          provider?: string
          category?: string
          event_key?: string
          provider_event_id?: string | null
          external_subject_id?: string | null
          payload?: Json
          payload_sha256?: string
          status?: string
          attempt_count?: number
          next_attempt_at?: string | null
          last_error_code?: string | null
          occurred_at?: string
          received_at?: string
          processed_at?: string | null
          provider_post_reference?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "provider_webhook_events_connection_fkey"
            columns: ["workspace_id", "workspace_id", "channel_connection_id", "channel_connection_id"]
            isOneToOne: false
            referencedRelation: "channel_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "provider_webhook_events_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      publish_attempts: {
        Row: {
          id: string
          workspace_id: string
          schedule_id: string
          attempt_number: number
          idempotency_key: string
          status: string
          provider_reference: string | null
          error_code: string | null
          started_at: string
          finished_at: string | null
          created_by: string
          claim_token_hash: string | null
          lease_expires_at: string | null
          next_attempt_at: string | null
          provider_request_id: string | null
          recovery_status: string | null
          approval_request_id: string | null
        }
        Insert: {
          id?: string
          workspace_id: string
          schedule_id: string
          attempt_number: number
          idempotency_key: string
          status: string
          provider_reference?: string | null
          error_code?: string | null
          started_at?: string
          finished_at?: string | null
          created_by: string
          claim_token_hash?: string | null
          lease_expires_at?: string | null
          next_attempt_at?: string | null
          provider_request_id?: string | null
          recovery_status?: string | null
          approval_request_id?: string | null
        }
        Update: {
          id?: string
          workspace_id?: string
          schedule_id?: string
          attempt_number?: number
          idempotency_key?: string
          status?: string
          provider_reference?: string | null
          error_code?: string | null
          started_at?: string
          finished_at?: string | null
          created_by?: string
          claim_token_hash?: string | null
          lease_expires_at?: string | null
          next_attempt_at?: string | null
          provider_request_id?: string | null
          recovery_status?: string | null
          approval_request_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "publish_attempts_approval_request_id_fkey"
            columns: ["approval_request_id"]
            isOneToOne: false
            referencedRelation: "admin_approval_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "publish_attempts_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "publish_attempts_workspace_id_schedule_id_fkey"
            columns: ["workspace_id", "workspace_id", "schedule_id", "schedule_id"]
            isOneToOne: false
            referencedRelation: "schedules"
            referencedColumns: ["id"]
          },
        ]
      }
      publish_renditions: {
        Row: {
          id: string
          workspace_id: string
          source_media_asset_id: string
          channel: string
          transform_policy_version: string
          crop_data: Json | null
          format: string
          quality: number | null
          width: number
          height: number
          aspect_ratio: string
          storage_bucket: string
          object_path: string
          rendition_sha256: string
          created_at: string
        }
        Insert: {
          id?: string
          workspace_id: string
          source_media_asset_id: string
          channel: string
          transform_policy_version: string
          crop_data?: Json | null
          format: string
          quality?: number | null
          width: number
          height: number
          aspect_ratio: string
          storage_bucket?: string
          object_path: string
          rendition_sha256: string
          created_at?: string
        }
        Update: {
          id?: string
          workspace_id?: string
          source_media_asset_id?: string
          channel?: string
          transform_policy_version?: string
          crop_data?: Json | null
          format?: string
          quality?: number | null
          width?: number
          height?: number
          aspect_ratio?: string
          storage_bucket?: string
          object_path?: string
          rendition_sha256?: string
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "publish_renditions_source_media_asset_id_fkey"
            columns: ["source_media_asset_id"]
            isOneToOne: false
            referencedRelation: "media_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "publish_renditions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      quick_post_credit_reservations: {
        Row: {
          id: string
          workspace_id: string
          account_id: string
          mission_id: string
          revision: number
          scope: string
          credits: number
          operation_key: string
          state: string
          created_at: string
          settled_at: string | null
        }
        Insert: {
          id: string
          workspace_id: string
          account_id: string
          mission_id: string
          revision: number
          scope: string
          credits: number
          operation_key: string
          state?: string
          created_at?: string
          settled_at?: string | null
        }
        Update: {
          id?: string
          workspace_id?: string
          account_id?: string
          mission_id?: string
          revision?: number
          scope?: string
          credits?: number
          operation_key?: string
          state?: string
          created_at?: string
          settled_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "quick_post_credit_reservations_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "credit_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quick_post_credit_reservations_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      raw_webhook_events: {
        Row: {
          id: string
        }
        Insert: {
          id: string
        }
        Update: {
          id?: string
        }
        Relationships: [
        ]
      }
      report_decision_evidence: {
        Row: {
          workspace_id: string
          decision_id: string
          content_version_id: string
          position: number
          created_at: string
        }
        Insert: {
          workspace_id: string
          decision_id: string
          content_version_id: string
          position: number
          created_at?: string
        }
        Update: {
          workspace_id?: string
          decision_id?: string
          content_version_id?: string
          position?: number
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "report_decision_evidence_workspace_id_content_version_id_fkey"
            columns: ["workspace_id", "workspace_id", "content_version_id", "content_version_id"]
            isOneToOne: false
            referencedRelation: "content_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "report_decision_evidence_workspace_id_decision_id_fkey"
            columns: ["workspace_id", "workspace_id", "decision_id", "decision_id"]
            isOneToOne: false
            referencedRelation: "report_decisions"
            referencedColumns: ["id"]
          },
        ]
      }
      report_decisions: {
        Row: {
          id: string
          workspace_id: string
          insight_key: string
          period_start: string
          period_end: string
          observed_facts: Json
          hypothesis: string
          change_variable: string
          invariants: Json
          customer_signal_ids: Json
          owner_note: string | null
          status: string
          conversation_thread_id: string | null
          created_by: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          workspace_id: string
          insight_key: string
          period_start: string
          period_end: string
          observed_facts: Json
          hypothesis: string
          change_variable: string
          invariants: Json
          customer_signal_ids?: Json
          owner_note?: string | null
          status?: string
          conversation_thread_id?: string | null
          created_by?: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          workspace_id?: string
          insight_key?: string
          period_start?: string
          period_end?: string
          observed_facts?: Json
          hypothesis?: string
          change_variable?: string
          invariants?: Json
          customer_signal_ids?: Json
          owner_note?: string | null
          status?: string
          conversation_thread_id?: string | null
          created_by?: string
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "report_decisions_workspace_id_conversation_thread_id_fkey"
            columns: ["workspace_id", "workspace_id", "conversation_thread_id", "conversation_thread_id"]
            isOneToOne: false
            referencedRelation: "conversation_threads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "report_decisions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      report_experiments: {
        Row: {
          id: string
          workspace_id: string
          decision_id: string
          hypothesis: string
          change_variable: string
          invariant_keys: Json
          variant_a_content_version_id: string
          variant_b_content_version_id: string
          variant_a_scheduled_at: string
          variant_b_scheduled_at: string
          primary_metric: string
          secondary_metrics: Json
          guardrail_metrics: Json
          collection_cadence_hours: Json
          review_at: string
          approval_state: string
          status: string
          created_by: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          workspace_id: string
          decision_id: string
          hypothesis: string
          change_variable: string
          invariant_keys: Json
          variant_a_content_version_id: string
          variant_b_content_version_id: string
          variant_a_scheduled_at: string
          variant_b_scheduled_at: string
          primary_metric: string
          secondary_metrics?: Json
          guardrail_metrics?: Json
          collection_cadence_hours?: Json
          review_at: string
          approval_state?: string
          status?: string
          created_by?: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          workspace_id?: string
          decision_id?: string
          hypothesis?: string
          change_variable?: string
          invariant_keys?: Json
          variant_a_content_version_id?: string
          variant_b_content_version_id?: string
          variant_a_scheduled_at?: string
          variant_b_scheduled_at?: string
          primary_metric?: string
          secondary_metrics?: Json
          guardrail_metrics?: Json
          collection_cadence_hours?: Json
          review_at?: string
          approval_state?: string
          status?: string
          created_by?: string
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "report_experiments_workspace_id_decision_id_fkey"
            columns: ["workspace_id", "workspace_id", "decision_id", "decision_id"]
            isOneToOne: false
            referencedRelation: "report_decisions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "report_experiments_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "report_experiments_workspace_id_variant_a_content_version__fkey"
            columns: ["workspace_id", "workspace_id", "variant_a_content_version_id", "variant_a_content_version_id"]
            isOneToOne: false
            referencedRelation: "content_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "report_experiments_workspace_id_variant_b_content_version__fkey"
            columns: ["workspace_id", "workspace_id", "variant_b_content_version_id", "variant_b_content_version_id"]
            isOneToOne: false
            referencedRelation: "content_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      report_snapshots: {
        Row: {
          id: string
          workspace_id: string
          period_start: string
          period_end: string
          status: string
          metrics: Json
          source_ready: boolean
          checked_at: string
          created_at: string
        }
        Insert: {
          id?: string
          workspace_id: string
          period_start: string
          period_end: string
          status: string
          metrics?: Json
          source_ready?: boolean
          checked_at: string
          created_at?: string
        }
        Update: {
          id?: string
          workspace_id?: string
          period_start?: string
          period_end?: string
          status?: string
          metrics?: Json
          source_ready?: boolean
          checked_at?: string
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "report_snapshots_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      reservations: {
        Row: {
          id: string
          workspace_id: string
          mission_id: string | null
          slot_id: string
          customer_id: string
          customer_name: string
          customer_phone: string | null
          service_id: string
          service_name: string
          status: string
          deposit_krw: number
          total_amount_krw: number
          channel_source: string
          proof_id: string | null
          evidence_id: string | null
          confirmed_at: string | null
          cancelled_at: string | null
          cancel_reason: string | null
          metadata: Json
          created_at: string
          updated_at: string
          customer_email: string | null
          pii_redacted: boolean
          anonymized_at: string | null
        }
        Insert: {
          id: string
          workspace_id: string
          mission_id?: string | null
          slot_id: string
          customer_id: string
          customer_name?: string
          customer_phone?: string | null
          service_id?: string
          service_name?: string
          status?: string
          deposit_krw?: number
          total_amount_krw?: number
          channel_source?: string
          proof_id?: string | null
          evidence_id?: string | null
          confirmed_at?: string | null
          cancelled_at?: string | null
          cancel_reason?: string | null
          metadata?: Json
          created_at?: string
          updated_at?: string
          customer_email?: string | null
          pii_redacted?: boolean
          anonymized_at?: string | null
        }
        Update: {
          id?: string
          workspace_id?: string
          mission_id?: string | null
          slot_id?: string
          customer_id?: string
          customer_name?: string
          customer_phone?: string | null
          service_id?: string
          service_name?: string
          status?: string
          deposit_krw?: number
          total_amount_krw?: number
          channel_source?: string
          proof_id?: string | null
          evidence_id?: string | null
          confirmed_at?: string | null
          cancelled_at?: string | null
          cancel_reason?: string | null
          metadata?: Json
          created_at?: string
          updated_at?: string
          customer_email?: string | null
          pii_redacted?: boolean
          anonymized_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "reservations_mission_id_fkey"
            columns: ["mission_id"]
            isOneToOne: false
            referencedRelation: "marketing_missions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reservations_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      runtime_control_versions: {
        Row: {
          id: string
          control_type: string
          key: string
          value: Json
          risk_tier: string
          scope: string
          rollout_percentage: number
          status: string
          created_by: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          control_type: string
          key: string
          value: Json
          risk_tier?: string
          scope?: string
          rollout_percentage?: number
          status?: string
          created_by?: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          control_type?: string
          key?: string
          value?: Json
          risk_tier?: string
          scope?: string
          rollout_percentage?: number
          status?: string
          created_by?: string
          created_at?: string
          updated_at?: string
        }
        Relationships: [
        ]
      }
      safety_intervention_executions: {
        Row: {
          id: string
          workspace_id: string
          idempotency_key: string
          kind: string
          channel: string | null
          active: boolean | null
          amount: number | null
          reason: string
          actor_id: string
          audit_event_id: string
          result: Json
          created_at: string
        }
        Insert: {
          id?: string
          workspace_id: string
          idempotency_key: string
          kind: string
          channel?: string | null
          active?: boolean | null
          amount?: number | null
          reason: string
          actor_id: string
          audit_event_id: string
          result: Json
          created_at?: string
        }
        Update: {
          id?: string
          workspace_id?: string
          idempotency_key?: string
          kind?: string
          channel?: string | null
          active?: boolean | null
          amount?: number | null
          reason?: string
          actor_id?: string
          audit_event_id?: string
          result?: Json
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "safety_intervention_executions_audit_event_id_fkey"
            columns: ["audit_event_id"]
            isOneToOne: false
            referencedRelation: "audit_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "safety_intervention_executions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      schedules: {
        Row: {
          id: string
          workspace_id: string
          approval_id: string
          content_id: string
          version_id: string
          channel_connection_id: string
          publish_at: string
          timezone: string
          status: string
          created_by: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          workspace_id: string
          approval_id: string
          content_id: string
          version_id: string
          channel_connection_id: string
          publish_at: string
          timezone: string
          status?: string
          created_by: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          workspace_id?: string
          approval_id?: string
          content_id?: string
          version_id?: string
          channel_connection_id?: string
          publish_at?: string
          timezone?: string
          status?: string
          created_by?: string
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "schedules_workspace_channel_connection_fkey"
            columns: ["workspace_id", "workspace_id", "channel_connection_id", "channel_connection_id"]
            isOneToOne: false
            referencedRelation: "channel_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedules_workspace_id_approval_id_fkey"
            columns: ["workspace_id", "workspace_id", "approval_id", "approval_id"]
            isOneToOne: false
            referencedRelation: "approvals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedules_workspace_id_content_id_fkey"
            columns: ["workspace_id", "workspace_id", "content_id", "content_id"]
            isOneToOne: false
            referencedRelation: "content_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedules_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedules_workspace_id_version_id_fkey"
            columns: ["workspace_id", "workspace_id", "version_id", "version_id"]
            isOneToOne: false
            referencedRelation: "content_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      signup_applications: {
        Row: {
          id: string
          user_id: string
          workspace_id: string | null
          state: string
          business_number: string | null
          company_name: string | null
          representative_name: string | null
          agreements_completed: boolean
          completed_at: string | null
          created_at: string
          updated_at: string
          start_date: string | null
        }
        Insert: {
          id?: string
          user_id: string
          workspace_id?: string | null
          state?: string
          business_number?: string | null
          company_name?: string | null
          representative_name?: string | null
          agreements_completed?: boolean
          completed_at?: string | null
          created_at?: string
          updated_at?: string
          start_date?: string | null
        }
        Update: {
          id?: string
          user_id?: string
          workspace_id?: string | null
          state?: string
          business_number?: string | null
          company_name?: string | null
          representative_name?: string | null
          agreements_completed?: boolean
          completed_at?: string | null
          created_at?: string
          updated_at?: string
          start_date?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "signup_applications_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      signup_bootstrap_events: {
        Row: {
          id: string
          auth_user_id: string
          provider: string
          workspace_id: string | null
          idempotency_key: string
          status: string
          safe_error_code: string | null
          created_at: string
        }
        Insert: {
          id?: string
          auth_user_id: string
          provider?: string
          workspace_id?: string | null
          idempotency_key: string
          status?: string
          safe_error_code?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          auth_user_id?: string
          provider?: string
          workspace_id?: string | null
          idempotency_key?: string
          status?: string
          safe_error_code?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "signup_bootstrap_events_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      signup_consent_receipts: {
        Row: {
          user_id: string
          terms_version: string
          privacy_version: string
          marketing_consent: boolean
          accepted_at: string
        }
        Insert: {
          user_id: string
          terms_version: string
          privacy_version: string
          marketing_consent?: boolean
          accepted_at?: string
        }
        Update: {
          user_id?: string
          terms_version?: string
          privacy_version?: string
          marketing_consent?: boolean
          accepted_at?: string
        }
        Relationships: [
        ]
      }
      social_attribution_events: {
        Row: {
          id: string
          workspace_id: string
          tracking_id: string
          event_type: string
          anonymous_visitor_hash: string | null
          booking_id: string | null
          reservation_value_krw: number | null
          occurred_at: string
          created_at: string
          customer_id: string | null
          anonymized_at: string | null
        }
        Insert: {
          id?: string
          workspace_id: string
          tracking_id: string
          event_type: string
          anonymous_visitor_hash?: string | null
          booking_id?: string | null
          reservation_value_krw?: number | null
          occurred_at: string
          created_at?: string
          customer_id?: string | null
          anonymized_at?: string | null
        }
        Update: {
          id?: string
          workspace_id?: string
          tracking_id?: string
          event_type?: string
          anonymous_visitor_hash?: string | null
          booking_id?: string | null
          reservation_value_krw?: number | null
          occurred_at?: string
          created_at?: string
          customer_id?: string | null
          anonymized_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "social_attribution_events_tracking_fkey"
            columns: ["tracking_id"]
            isOneToOne: false
            referencedRelation: "social_post_tracking"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "social_attribution_events_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      social_comments: {
        Row: {
          id: string
          workspace_id: string
          channel_connection_id: string
          channel: string
          provider_comment_id: string
          provider_media_id: string
          author_handle: string
          author_id: string | null
          comment_text: string
          comment_created_at: string
          classification: string | null
          confidence: number | null
          status: string
          failure_reason: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          workspace_id: string
          channel_connection_id: string
          channel: string
          provider_comment_id: string
          provider_media_id: string
          author_handle: string
          author_id?: string | null
          comment_text: string
          comment_created_at: string
          classification?: string | null
          confidence?: number | null
          status?: string
          failure_reason?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          workspace_id?: string
          channel_connection_id?: string
          channel?: string
          provider_comment_id?: string
          provider_media_id?: string
          author_handle?: string
          author_id?: string | null
          comment_text?: string
          comment_created_at?: string
          classification?: string | null
          confidence?: number | null
          status?: string
          failure_reason?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "social_comments_connection_fk"
            columns: ["workspace_id", "workspace_id", "channel_connection_id", "channel_connection_id"]
            isOneToOne: false
            referencedRelation: "channel_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "social_comments_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      social_post_tracking: {
        Row: {
          id: string
          workspace_id: string
          publish_attempt_id: string
          tracking_id: string
          destination_url: string | null
          created_at: string
        }
        Insert: {
          id?: string
          workspace_id: string
          publish_attempt_id: string
          tracking_id: string
          destination_url?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          workspace_id?: string
          publish_attempt_id?: string
          tracking_id?: string
          destination_url?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "social_post_tracking_attempt_fkey"
            columns: ["workspace_id", "workspace_id", "publish_attempt_id", "publish_attempt_id"]
            isOneToOne: false
            referencedRelation: "publish_attempts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "social_post_tracking_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      sohee_curiosity_decisions: {
        Row: {
          workspace_id: string
          question_key: string
          status: string
          updated_by: string
          created_at: string
          updated_at: string
        }
        Insert: {
          workspace_id: string
          question_key: string
          status: string
          updated_by: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          workspace_id?: string
          question_key?: string
          status?: string
          updated_by?: string
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sohee_curiosity_decisions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      sohee_goals: {
        Row: {
          id: string
          workspace_id: string
          title: string
          desired_outcome: string
          metric: Json | null
          priority: string
          status: string
          due_at: string | null
          source_message_id: string | null
          version: number
          created_by: string
          updated_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          workspace_id: string
          title: string
          desired_outcome: string
          metric?: Json | null
          priority?: string
          status?: string
          due_at?: string | null
          source_message_id?: string | null
          version?: number
          created_by: string
          updated_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          workspace_id?: string
          title?: string
          desired_outcome?: string
          metric?: Json | null
          priority?: string
          status?: string
          due_at?: string | null
          source_message_id?: string | null
          version?: number
          created_by?: string
          updated_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sohee_goals_source_message_fkey"
            columns: ["workspace_id", "workspace_id", "source_message_id", "source_message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sohee_goals_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      sohee_studio_proposals: {
        Row: {
          id: string
          workspace_id: string
          source_message_id: string
          kind: string
          category: string
          content: string
          replaces_fact_id: string | null
          expected_fact_created_at: string | null
          status: string
          confirmed_target_id: string | null
          idempotency_key: string | null
          created_by: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          workspace_id: string
          source_message_id: string
          kind: string
          category: string
          content: string
          replaces_fact_id?: string | null
          expected_fact_created_at?: string | null
          status?: string
          confirmed_target_id?: string | null
          idempotency_key?: string | null
          created_by: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          workspace_id?: string
          source_message_id?: string
          kind?: string
          category?: string
          content?: string
          replaces_fact_id?: string | null
          expected_fact_created_at?: string | null
          status?: string
          confirmed_target_id?: string | null
          idempotency_key?: string | null
          created_by?: string
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sohee_studio_proposals_replaces_fact_fkey"
            columns: ["workspace_id", "workspace_id", "replaces_fact_id", "replaces_fact_id"]
            isOneToOne: false
            referencedRelation: "knowledge_facts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sohee_studio_proposals_source_message_fkey"
            columns: ["workspace_id", "workspace_id", "source_message_id", "source_message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sohee_studio_proposals_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      trial_entitlements: {
        Row: {
          id: string
          workspace_id: string
          plan_key: string
          starts_at: string
          ends_at: string
          status: string
          initial_credit_grant: number
          created_from_signup_event_id: string | null
          converted_subscription_id: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          workspace_id: string
          plan_key?: string
          starts_at?: string
          ends_at: string
          status?: string
          initial_credit_grant?: number
          created_from_signup_event_id?: string | null
          converted_subscription_id?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          workspace_id?: string
          plan_key?: string
          starts_at?: string
          ends_at?: string
          status?: string
          initial_credit_grant?: number
          created_from_signup_event_id?: string | null
          converted_subscription_id?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "trial_entitlements_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      trial_journey_milestones: {
        Row: {
          id: string
          workspace_id: string
          day_stage: number
          title: string
          description: string
          category: string
          is_completed: boolean
          completed_at: string | null
          evidence_data: Json | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          workspace_id: string
          day_stage: number
          title: string
          description: string
          category?: string
          is_completed?: boolean
          completed_at?: string | null
          evidence_data?: Json | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          workspace_id?: string
          day_stage?: number
          title?: string
          description?: string
          category?: string
          is_completed?: boolean
          completed_at?: string | null
          evidence_data?: Json | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "trial_journey_milestones_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      usage_events: {
        Row: {
          id: string
          workspace_id: string
          mission_id: string | null
          action_run_id: string | null
          provider: string
          model: string
          operation: string
          input_tokens: number
          cached_input_tokens: number
          output_tokens: number
          reasoning_tokens: number
          image_units: number
          cost_cents: number
          cost_status: string
          pricing_version: string
          created_at: string
        }
        Insert: {
          id?: string
          workspace_id: string
          mission_id?: string | null
          action_run_id?: string | null
          provider?: string
          model: string
          operation?: string
          input_tokens?: number
          cached_input_tokens?: number
          output_tokens?: number
          reasoning_tokens?: number
          image_units?: number
          cost_cents?: number
          cost_status?: string
          pricing_version?: string
          created_at?: string
        }
        Update: {
          id?: string
          workspace_id?: string
          mission_id?: string | null
          action_run_id?: string | null
          provider?: string
          model?: string
          operation?: string
          input_tokens?: number
          cached_input_tokens?: number
          output_tokens?: number
          reasoning_tokens?: number
          image_units?: number
          cost_cents?: number
          cost_status?: string
          pricing_version?: string
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "usage_events_action_run_id_fkey"
            columns: ["action_run_id"]
            isOneToOne: false
            referencedRelation: "agent_action_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "usage_events_mission_id_fkey"
            columns: ["mission_id"]
            isOneToOne: false
            referencedRelation: "agent_missions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "usage_events_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      user_agreements: {
        Row: {
          id: string
          workspace_id: string | null
          user_id: string
          agreement_type: string
          version: string
          agreed: boolean
          agreed_at: string
          ip_address: string | null
        }
        Insert: {
          id?: string
          workspace_id?: string | null
          user_id: string
          agreement_type: string
          version: string
          agreed?: boolean
          agreed_at?: string
          ip_address?: string | null
        }
        Update: {
          id?: string
          workspace_id?: string | null
          user_id?: string
          agreement_type?: string
          version?: string
          agreed?: boolean
          agreed_at?: string
          ip_address?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "user_agreements_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      user_feedback: {
        Row: {
          id: string
          workspace_id: string
          screen: string
          kind: string
          rating: number | null
          message: string
          tags: string[]
          status: string
          content_id: string | null
          run_id: string | null
          admin_note: string | null
          created_by: string
          created_at: string
          updated_at: string
          deleted_at: string | null
        }
        Insert: {
          id?: string
          workspace_id: string
          screen: string
          kind?: string
          rating?: number | null
          message: string
          tags?: string[]
          status?: string
          content_id?: string | null
          run_id?: string | null
          admin_note?: string | null
          created_by: string
          created_at?: string
          updated_at?: string
          deleted_at?: string | null
        }
        Update: {
          id?: string
          workspace_id?: string
          screen?: string
          kind?: string
          rating?: number | null
          message?: string
          tags?: string[]
          status?: string
          content_id?: string | null
          run_id?: string | null
          admin_note?: string | null
          created_by?: string
          created_at?: string
          updated_at?: string
          deleted_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "user_feedback_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      vault_events: {
        Row: {
          id: string
          workspace_id: string
          vault_item_id: string
          event_type: string
          actor_id: string | null
          payload: Json
          occurred_at: string
        }
        Insert: {
          id?: string
          workspace_id: string
          vault_item_id: string
          event_type: string
          actor_id?: string | null
          payload?: Json
          occurred_at?: string
        }
        Update: {
          id?: string
          workspace_id?: string
          vault_item_id?: string
          event_type?: string
          actor_id?: string | null
          payload?: Json
          occurred_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "vault_events_item_fk"
            columns: ["workspace_id", "workspace_id", "vault_item_id", "vault_item_id"]
            isOneToOne: false
            referencedRelation: "vault_items"
            referencedColumns: ["id"]
          },
        ]
      }
      vault_image_renditions: {
        Row: {
          id: string
          workspace_id: string
          vault_item_id: string
          source_media_asset_id: string
          channel: string
          spec_version: string
          storage_bucket: string
          object_path: string
          format: string
          width: number
          height: number
          rendition_content_digest: string
          rights_expires_at: string | null
          qc_expires_at: string | null
          created_at: string
        }
        Insert: {
          id?: string
          workspace_id: string
          vault_item_id: string
          source_media_asset_id: string
          channel: string
          spec_version: string
          storage_bucket?: string
          object_path: string
          format: string
          width: number
          height: number
          rendition_content_digest: string
          rights_expires_at?: string | null
          qc_expires_at?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          workspace_id?: string
          vault_item_id?: string
          source_media_asset_id?: string
          channel?: string
          spec_version?: string
          storage_bucket?: string
          object_path?: string
          format?: string
          width?: number
          height?: number
          rendition_content_digest?: string
          rights_expires_at?: string | null
          qc_expires_at?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "vault_image_renditions_asset_fk"
            columns: ["workspace_id", "workspace_id", "source_media_asset_id", "source_media_asset_id"]
            isOneToOne: false
            referencedRelation: "media_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vault_image_renditions_item_fk"
            columns: ["workspace_id", "workspace_id", "vault_item_id", "vault_item_id"]
            isOneToOne: false
            referencedRelation: "vault_items"
            referencedColumns: ["id"]
          },
        ]
      }
      vault_items: {
        Row: {
          id: string
          workspace_id: string
          content_id: string
          version_id: string
          channel: string
          release_gate: string | null
          hold_reason: string | null
          held_at: string | null
          held_by: string | null
          target_date: string | null
          approved_fingerprint: string | null
          fingerprint_schema_version: number | null
          policy_version: string
          spec_version: string
          approval_state: string
          approved_by: string | null
          bundle_id: string | null
          idempotency_key: string
          deleted_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          workspace_id: string
          content_id: string
          version_id: string
          channel: string
          release_gate?: string | null
          hold_reason?: string | null
          held_at?: string | null
          held_by?: string | null
          target_date?: string | null
          approved_fingerprint?: string | null
          fingerprint_schema_version?: number | null
          policy_version: string
          spec_version: string
          approval_state?: string
          approved_by?: string | null
          bundle_id?: string | null
          idempotency_key: string
          deleted_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          workspace_id?: string
          content_id?: string
          version_id?: string
          channel?: string
          release_gate?: string | null
          hold_reason?: string | null
          held_at?: string | null
          held_by?: string | null
          target_date?: string | null
          approved_fingerprint?: string | null
          fingerprint_schema_version?: number | null
          policy_version?: string
          spec_version?: string
          approval_state?: string
          approved_by?: string | null
          bundle_id?: string | null
          idempotency_key?: string
          deleted_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "vault_items_content_fk"
            columns: ["workspace_id", "workspace_id", "content_id", "content_id"]
            isOneToOne: false
            referencedRelation: "content_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vault_items_version_fk"
            columns: ["workspace_id", "workspace_id", "workspace_id", "content_id", "content_id", "content_id", "version_id", "version_id", "version_id"]
            isOneToOne: false
            referencedRelation: "content_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vault_items_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      vault_monitor_access_events: {
        Row: {
          id: string
          actor_id: string
          access_kind: string
          workspace_count: number
          violation_count: number
          disclosed_item_ids: string[]
          created_at: string
        }
        Insert: {
          id?: string
          actor_id: string
          access_kind: string
          workspace_count: number
          violation_count: number
          disclosed_item_ids?: string[]
          created_at?: string
        }
        Update: {
          id?: string
          actor_id?: string
          access_kind?: string
          workspace_count?: number
          violation_count?: number
          disclosed_item_ids?: string[]
          created_at?: string
        }
        Relationships: [
        ]
      }
      vault_published_urls: {
        Row: {
          id: string
          workspace_id: string
          vault_item_id: string
          channel: string
          published_url: string
          verification_status: string
          registered_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          workspace_id: string
          vault_item_id: string
          channel: string
          published_url: string
          verification_status?: string
          registered_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          workspace_id?: string
          vault_item_id?: string
          channel?: string
          published_url?: string
          verification_status?: string
          registered_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "vault_published_urls_item_fk"
            columns: ["workspace_id", "workspace_id", "vault_item_id", "vault_item_id"]
            isOneToOne: false
            referencedRelation: "vault_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vault_published_urls_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      vault_variant_payloads: {
        Row: {
          id: string
          workspace_id: string
          vault_item_id: string
          payload: Json
          preview_artifacts: Json
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          workspace_id: string
          vault_item_id: string
          payload?: Json
          preview_artifacts?: Json
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          workspace_id?: string
          vault_item_id?: string
          payload?: Json
          preview_artifacts?: Json
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "vault_variant_payloads_item_fk"
            columns: ["workspace_id", "workspace_id", "vault_item_id", "vault_item_id"]
            isOneToOne: false
            referencedRelation: "vault_items"
            referencedColumns: ["id"]
          },
        ]
      }
      verified_proof_receipts: {
        Row: {
          proof_receipt_id: string
          execution_run_id: string
          workspace_id: string
          target_channel: string
          external_post_id: string
          read_back_permalink: string
          read_back_text_hash: string
          read_back_timestamp: string
          receipt_checksum_sha256: string
          verification_status: string
          verified_at: string
        }
        Insert: {
          proof_receipt_id: string
          execution_run_id: string
          workspace_id: string
          target_channel: string
          external_post_id: string
          read_back_permalink: string
          read_back_text_hash: string
          read_back_timestamp: string
          receipt_checksum_sha256: string
          verification_status?: string
          verified_at?: string
        }
        Update: {
          proof_receipt_id?: string
          execution_run_id?: string
          workspace_id?: string
          target_channel?: string
          external_post_id?: string
          read_back_permalink?: string
          read_back_text_hash?: string
          read_back_timestamp?: string
          receipt_checksum_sha256?: string
          verification_status?: string
          verified_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "verified_proof_receipts_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      work_items: {
        Row: {
          id: string
          workspace_id: string
          type: string
          title: string
          summary: string | null
          status: string
          priority: string
          owner_type: string
          owner_user_id: string | null
          due_at: string | null
          source_thread_id: string | null
          source_message_id: string | null
          content_item_id: string | null
          created_by: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          workspace_id: string
          type: string
          title: string
          summary?: string | null
          status: string
          priority?: string
          owner_type?: string
          owner_user_id?: string | null
          due_at?: string | null
          source_thread_id?: string | null
          source_message_id?: string | null
          content_item_id?: string | null
          created_by: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          workspace_id?: string
          type?: string
          title?: string
          summary?: string | null
          status?: string
          priority?: string
          owner_type?: string
          owner_user_id?: string | null
          due_at?: string | null
          source_thread_id?: string | null
          source_message_id?: string | null
          content_item_id?: string | null
          created_by?: string
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "work_items_content_item_fkey"
            columns: ["workspace_id", "workspace_id", "content_item_id", "content_item_id"]
            isOneToOne: false
            referencedRelation: "content_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_items_source_message_fkey"
            columns: ["workspace_id", "workspace_id", "workspace_id", "source_thread_id", "source_thread_id", "source_thread_id", "source_message_id", "source_message_id", "source_message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_items_source_thread_fkey"
            columns: ["workspace_id", "workspace_id", "source_thread_id", "source_thread_id"]
            isOneToOne: false
            referencedRelation: "conversation_threads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_items_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      work_proposals: {
        Row: {
          proposal_id: string
          workspace_id: string
          goal_id: string | null
          title: string
          rationale: string
          evidence_context: Json
          expected_outcome: Json
          execution_plan_summary: Json
          required_capabilities: Json
          estimated_agent_energy: number
          proposed_envelope: Json
          status: string
          created_at: string
          expires_at: string | null
        }
        Insert: {
          proposal_id: string
          workspace_id: string
          goal_id?: string | null
          title: string
          rationale: string
          evidence_context?: Json
          expected_outcome?: Json
          execution_plan_summary?: Json
          required_capabilities?: Json
          estimated_agent_energy?: number
          proposed_envelope?: Json
          status?: string
          created_at?: string
          expires_at?: string | null
        }
        Update: {
          proposal_id?: string
          workspace_id?: string
          goal_id?: string | null
          title?: string
          rationale?: string
          evidence_context?: Json
          expected_outcome?: Json
          execution_plan_summary?: Json
          required_capabilities?: Json
          estimated_agent_energy?: number
          proposed_envelope?: Json
          status?: string
          created_at?: string
          expires_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "work_proposals_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_agreements: {
        Row: {
          id: string
          workspace_id: string
          document_version_id: string
          agreement_type: string
          status: string
          accepted_by: string | null
          accepted_at: string | null
          withdrawn_by: string | null
          withdrawn_at: string | null
          expires_at: string | null
          reason: string
          created_at: string
        }
        Insert: {
          id?: string
          workspace_id: string
          document_version_id: string
          agreement_type: string
          status: string
          accepted_by?: string | null
          accepted_at?: string | null
          withdrawn_by?: string | null
          withdrawn_at?: string | null
          expires_at?: string | null
          reason: string
          created_at?: string
        }
        Update: {
          id?: string
          workspace_id?: string
          document_version_id?: string
          agreement_type?: string
          status?: string
          accepted_by?: string | null
          accepted_at?: string | null
          withdrawn_by?: string | null
          withdrawn_at?: string | null
          expires_at?: string | null
          reason?: string
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_agreements_document_version_id_fkey"
            columns: ["document_version_id"]
            isOneToOne: false
            referencedRelation: "legal_document_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_agreements_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_billing_entitlements: {
        Row: {
          id: string
          workspace_id: string
          plan_code: string
          policy_version: string
          state: string
          effective_from: string
          effective_until: string | null
          source_reference: string
          created_at: string
        }
        Insert: {
          id?: string
          workspace_id: string
          plan_code: string
          policy_version: string
          state: string
          effective_from: string
          effective_until?: string | null
          source_reference: string
          created_at?: string
        }
        Update: {
          id?: string
          workspace_id?: string
          plan_code?: string
          policy_version?: string
          state?: string
          effective_from?: string
          effective_until?: string | null
          source_reference?: string
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_billing_entitlements_policy_fkey"
            columns: ["policy_version", "policy_version", "plan_code", "plan_code"]
            isOneToOne: false
            referencedRelation: "billing_plan_entitlement_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_billing_entitlements_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_business_details: {
        Row: {
          workspace_id: string
          business_number: string | null
          representative_name: string | null
          business_start_date: string | null
          business_type: string | null
          business_item: string | null
          phone: string | null
          business_hours: string | null
          closed_days: string | null
          parking_info: string | null
          reservation_method: string | null
          website_url: string | null
          price_range: string | null
          naver_place_url: string | null
          intake_source: string
          created_at: string
          updated_at: string
        }
        Insert: {
          workspace_id: string
          business_number?: string | null
          representative_name?: string | null
          business_start_date?: string | null
          business_type?: string | null
          business_item?: string | null
          phone?: string | null
          business_hours?: string | null
          closed_days?: string | null
          parking_info?: string | null
          reservation_method?: string | null
          website_url?: string | null
          price_range?: string | null
          naver_place_url?: string | null
          intake_source?: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          workspace_id?: string
          business_number?: string | null
          representative_name?: string | null
          business_start_date?: string | null
          business_type?: string | null
          business_item?: string | null
          phone?: string | null
          business_hours?: string | null
          closed_days?: string | null
          parking_info?: string | null
          reservation_method?: string | null
          website_url?: string | null
          price_range?: string | null
          naver_place_url?: string | null
          intake_source?: string
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_business_details_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_conversion_versions: {
        Row: {
          workspace_id: string
          dataset_mode: string
          revision: number
          command_id: string
          command_digest: string
          booking_url: string | null
          booking_expires_at: string | null
          confirmed_at: string
          confirmed_by: string | null
          created_at: string
        }
        Insert: {
          workspace_id: string
          dataset_mode: string
          revision: number
          command_id: string
          command_digest: string
          booking_url?: string | null
          booking_expires_at?: string | null
          confirmed_at: string
          confirmed_by?: string | null
          created_at?: string
        }
        Update: {
          workspace_id?: string
          dataset_mode?: string
          revision?: number
          command_id?: string
          command_digest?: string
          booking_url?: string | null
          booking_expires_at?: string | null
          confirmed_at?: string
          confirmed_by?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_conversion_versions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_credit_states: {
        Row: {
          workspace_id: string
          commercial_state: string
          trial_started_at: string | null
          trial_ends_at: string | null
          activation_credits: number
          agent_credits: number
          protected_wow_credits: number
          purchased_credits: number
          total_available_credits: number
          is_grace_period: boolean
          grace_ends_at: string | null
          updated_at: string
        }
        Insert: {
          workspace_id: string
          commercial_state?: string
          trial_started_at?: string | null
          trial_ends_at?: string | null
          activation_credits?: number
          agent_credits?: number
          protected_wow_credits?: number
          purchased_credits?: number
          total_available_credits?: number
          is_grace_period?: boolean
          grace_ends_at?: string | null
          updated_at?: string
        }
        Update: {
          workspace_id?: string
          commercial_state?: string
          trial_started_at?: string | null
          trial_ends_at?: string | null
          activation_credits?: number
          agent_credits?: number
          protected_wow_credits?: number
          purchased_credits?: number
          total_available_credits?: number
          is_grace_period?: boolean
          grace_ends_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_credit_states_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_entitlements: {
        Row: {
          entitlement_id: string
          workspace_id: string
          plan_version_id: string
          plan_tier: string
          status: string
          source: string
          activated_at: string
          expires_at: string | null
          created_at: string
        }
        Insert: {
          entitlement_id: string
          workspace_id: string
          plan_version_id: string
          plan_tier: string
          status?: string
          source?: string
          activated_at?: string
          expires_at?: string | null
          created_at?: string
        }
        Update: {
          entitlement_id?: string
          workspace_id?: string
          plan_version_id?: string
          plan_tier?: string
          status?: string
          source?: string
          activated_at?: string
          expires_at?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_entitlements_plan_version_id_fkey"
            columns: ["plan_version_id"]
            isOneToOne: false
            referencedRelation: "commercial_plan_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_entitlements_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_knowledge_harnesses: {
        Row: {
          harness_version_id: string
          workspace_id: string
          version_no: number
          compiled_at: string
          is_active: boolean
          business_identity: Json
          offerings: Json
          audience: Json
          brand_voice: Json
          policies: Json
          channel_truth: Json
          created_at: string
        }
        Insert: {
          harness_version_id: string
          workspace_id: string
          version_no?: number
          compiled_at?: string
          is_active?: boolean
          business_identity?: Json
          offerings?: Json
          audience?: Json
          brand_voice?: Json
          policies?: Json
          channel_truth?: Json
          created_at?: string
        }
        Update: {
          harness_version_id?: string
          workspace_id?: string
          version_no?: number
          compiled_at?: string
          is_active?: boolean
          business_identity?: Json
          offerings?: Json
          audience?: Json
          brand_voice?: Json
          policies?: Json
          channel_truth?: Json
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_knowledge_harnesses_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_lifecycles: {
        Row: {
          workspace_id: string
          status: string
          reason: string
          version: number
          changed_by: string
          changed_at: string
          created_at: string
          updated_at: string
        }
        Insert: {
          workspace_id: string
          status: string
          reason: string
          version?: number
          changed_by: string
          changed_at?: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          workspace_id?: string
          status?: string
          reason?: string
          version?: number
          changed_by?: string
          changed_at?: string
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_lifecycles_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_members: {
        Row: {
          workspace_id: string
          user_id: string
          role: string
          status: string
          created_at: string
          updated_at: string
        }
        Insert: {
          workspace_id: string
          user_id: string
          role: string
          status?: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          workspace_id?: string
          user_id?: string
          role?: string
          status?: string
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_members_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_onboarding_gates: {
        Row: {
          workspace_id: string
          onboarding_completed: boolean
          completed_at: string | null
          proof_id: string | null
          draft_id: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          workspace_id: string
          onboarding_completed?: boolean
          completed_at?: string | null
          proof_id?: string | null
          draft_id?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          workspace_id?: string
          onboarding_completed?: boolean
          completed_at?: string | null
          proof_id?: string | null
          draft_id?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_onboarding_gates_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_onboarding_missions: {
        Row: {
          id: string
          workspace_id: string
          mission_id: string
          status: string
          proposal_id: string | null
          proof_id: string | null
          proof_digest: string | null
          draft_id: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          workspace_id: string
          mission_id: string
          status?: string
          proposal_id?: string | null
          proof_id?: string | null
          proof_digest?: string | null
          draft_id?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          workspace_id?: string
          mission_id?: string
          status?: string
          proposal_id?: string | null
          proof_id?: string | null
          proof_digest?: string | null
          draft_id?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_onboarding_missions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_products_services: {
        Row: {
          id: string
          workspace_id: string
          name: string
          price: number | null
          price_formatted: string | null
          description: string | null
          key_benefits: string[]
          priority: number
          is_signature: boolean
          active: boolean
          created_at: string
          updated_at: string
          duration_minutes: number | null
          resource_name: string | null
          cancellation_policy: string | null
          valid_from: string | null
          valid_until: string | null
          knowledge_fact_id: string | null
        }
        Insert: {
          id?: string
          workspace_id: string
          name: string
          price?: number | null
          price_formatted?: string | null
          description?: string | null
          key_benefits?: string[]
          priority?: number
          is_signature?: boolean
          active?: boolean
          created_at?: string
          updated_at?: string
          duration_minutes?: number | null
          resource_name?: string | null
          cancellation_policy?: string | null
          valid_from?: string | null
          valid_until?: string | null
          knowledge_fact_id?: string | null
        }
        Update: {
          id?: string
          workspace_id?: string
          name?: string
          price?: number | null
          price_formatted?: string | null
          description?: string | null
          key_benefits?: string[]
          priority?: number
          is_signature?: boolean
          active?: boolean
          created_at?: string
          updated_at?: string
          duration_minutes?: number | null
          resource_name?: string | null
          cancellation_policy?: string | null
          valid_from?: string | null
          valid_until?: string | null
          knowledge_fact_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "workspace_products_services_knowledge_fact_fkey"
            columns: ["workspace_id", "workspace_id", "knowledge_fact_id", "knowledge_fact_id"]
            isOneToOne: false
            referencedRelation: "knowledge_facts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_products_services_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_profile_candidates: {
        Row: {
          id: string
          session_id: string
          answer_id: string
          workspace_id: string
          user_id: string
          profile_key: string
          original_value: string
          proposed_value: string
          confirmed_value: string | null
          confidence: number
          evidence_quote: string
          source: string
          status: string
          review_decision: string | null
          version: number
          reviewed_by_user_id: string | null
          reviewed_at: string | null
          knowledge_candidate_id: string | null
          knowledge_fact_id: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          session_id: string
          answer_id: string
          workspace_id: string
          user_id: string
          profile_key: string
          original_value: string
          proposed_value: string
          confirmed_value?: string | null
          confidence: number
          evidence_quote: string
          source: string
          status?: string
          review_decision?: string | null
          version?: number
          reviewed_by_user_id?: string | null
          reviewed_at?: string | null
          knowledge_candidate_id?: string | null
          knowledge_fact_id?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          session_id?: string
          answer_id?: string
          workspace_id?: string
          user_id?: string
          profile_key?: string
          original_value?: string
          proposed_value?: string
          confirmed_value?: string | null
          confidence?: number
          evidence_quote?: string
          source?: string
          status?: string
          review_decision?: string | null
          version?: number
          reviewed_by_user_id?: string | null
          reviewed_at?: string | null
          knowledge_candidate_id?: string | null
          knowledge_fact_id?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_profile_candidates_answer_fkey"
            columns: ["workspace_id", "workspace_id", "answer_id", "answer_id"]
            isOneToOne: false
            referencedRelation: "onboarding_answers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_profile_candidates_knowledge_candidate_fkey"
            columns: ["workspace_id", "workspace_id", "knowledge_candidate_id", "knowledge_candidate_id"]
            isOneToOne: false
            referencedRelation: "knowledge_candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_profile_candidates_knowledge_fact_fkey"
            columns: ["workspace_id", "workspace_id", "knowledge_fact_id", "knowledge_fact_id"]
            isOneToOne: false
            referencedRelation: "knowledge_facts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_profile_candidates_session_fkey"
            columns: ["workspace_id", "workspace_id", "session_id", "session_id"]
            isOneToOne: false
            referencedRelation: "onboarding_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_profile_candidates_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_registry: {
        Row: {
          workspace_id: string
          display_name: string
          dataset_mode: string
          actor_kind: string
          created_source: string
          created_at: string
          updated_at: string
        }
        Insert: {
          workspace_id: string
          display_name: string
          dataset_mode?: string
          actor_kind?: string
          created_source: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          workspace_id?: string
          display_name?: string
          dataset_mode?: string
          actor_kind?: string
          created_source?: string
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_registry_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_runtime_control_states: {
        Row: {
          workspace_id: string
          desired_mode: string
          actual_mode: string
          active_plan_id: string | null
          active_action_run_count: number
          blocker_code: string | null
          pause_reason: string | null
          transition_id: string
          snapshot_version: number
          version: number
          kill_switch_active: boolean
          last_heartbeat_at: string | null
          updated_by: string
          created_at: string
          updated_at: string
        }
        Insert: {
          workspace_id: string
          desired_mode?: string
          actual_mode?: string
          active_plan_id?: string | null
          active_action_run_count?: number
          blocker_code?: string | null
          pause_reason?: string | null
          transition_id?: string
          snapshot_version?: number
          version?: number
          kill_switch_active?: boolean
          last_heartbeat_at?: string | null
          updated_by?: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          workspace_id?: string
          desired_mode?: string
          actual_mode?: string
          active_plan_id?: string | null
          active_action_run_count?: number
          blocker_code?: string | null
          pause_reason?: string | null
          transition_id?: string
          snapshot_version?: number
          version?: number
          kill_switch_active?: boolean
          last_heartbeat_at?: string | null
          updated_by?: string
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_runtime_control_states_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspaces: {
        Row: {
          id: string
          name: string
          timezone: string
          created_by: string
          created_at: string
          updated_at: string
          workspace_kind: string
        }
        Insert: {
          id?: string
          name: string
          timezone?: string
          created_by: string
          created_at?: string
          updated_at?: string
          workspace_kind?: string
        }
        Update: {
          id?: string
          name?: string
          timezone?: string
          created_by?: string
          created_at?: string
          updated_at?: string
          workspace_kind?: string
        }
        Relationships: [
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      activate_current_invited_operator: {
        Args: Record<string, unknown>
        Returns: string
      }
      activate_harness_rule_version: {
        Args: Record<string, unknown>
        Returns: Json
      }
      activate_operator_legal_document_version: {
        Args: Record<string, unknown>
        Returns: Json
      }
      admin_verify_business_and_grant_taste: {
        Args: Record<string, unknown>
        Returns: Json
      }
      append_agent_activity: {
        Args: Record<string, unknown>
        Returns: Json[]
      }
      append_blog_stage_fact: {
        Args: Record<string, unknown>
        Returns: Json[]
      }
      apply_approved_admin_deactivate: {
        Args: Record<string, unknown>
        Returns: Json
      }
      apply_approved_admin_invite: {
        Args: Record<string, unknown>
        Returns: Json
      }
      apply_approved_admin_role_change: {
        Args: Record<string, unknown>
        Returns: Json
      }
      apply_approved_credit_adjustment: {
        Args: Record<string, unknown>
        Returns: Json
      }
      apply_approved_publish_retry: {
        Args: Record<string, unknown>
        Returns: Json
      }
      apply_operator_credit_adjustment: {
        Args: Record<string, unknown>
        Returns: Json
      }
      apply_safety_intervention_ani1560: {
        Args: Record<string, unknown>
        Returns: Json
      }
      approve_admin_account_approval: {
        Args: Record<string, unknown>
        Returns: Json
      }
      approve_admin_approval_request: {
        Args: Record<string, unknown>
        Returns: Json
      }
      approve_and_claim_channel_response: {
        Args: Record<string, unknown>
        Returns: Json
      }
      approve_and_dispatch_content_as_actor: {
        Args: Record<string, unknown>
        Returns: Json
      }
      approve_and_dispatch_local_content: {
        Args: Record<string, unknown>
        Returns: Json
      }
      approve_and_dispatch_meta_content: {
        Args: Record<string, unknown>
        Returns: Json
      }
      approve_and_transition_recovery: {
        Args: Record<string, unknown>
        Returns: Json
      }
      approve_channel_response: {
        Args: Record<string, unknown>
        Returns: string
      }
      approve_content_version: {
        Args: Record<string, unknown>
        Returns: string
      }
      approve_period_content_plan: {
        Args: Record<string, unknown>
        Returns: Json
      }
      approve_profile_change_proposal: {
        Args: Record<string, unknown>
        Returns: boolean
      }
      authenticate_connector_device: {
        Args: Record<string, unknown>
        Returns: Json
      }
      authorize_local_publish_execution_scope: {
        Args: Record<string, unknown>
        Returns: Json
      }
      bootstrap_platform_owner: {
        Args: Record<string, unknown>
        Returns: boolean
      }
      bootstrap_workspace_trial: {
        Args: Record<string, unknown>
        Returns: Json
      }
      cancel_schedule: {
        Args: Record<string, unknown>
        Returns: string
      }
      cancel_schedule_guarded: {
        Args: Record<string, unknown>
        Returns: string
      }
      car_checkpoint_graph_execution: {
        Args: Record<string, unknown>
        Returns: Json
      }
      car_claim_graph_execution: {
        Args: Record<string, unknown>
        Returns: Json
      }
      car_graph_approval_fence: {
        Args: Record<string, unknown>
        Returns: Json
      }
      cash_dist: {
        Args: Record<string, unknown>
        Returns: Json
      }
      claim_audit_export_job: {
        Args: Record<string, unknown>
        Returns: Json
      }
      claim_booking_recovery_outbox: {
        Args: Record<string, unknown>
        Returns: Json
      }
      claim_booking_recovery_step: {
        Args: Record<string, unknown>
        Returns: Json
      }
      claim_conversation_job: {
        Args: Record<string, unknown>
        Returns: Json
      }
      claim_data_deletion_request: {
        Args: Record<string, unknown>
        Returns: boolean
      }
      claim_due_v08_automation: {
        Args: Record<string, unknown>
        Returns: Json
      }
      claim_external_action: {
        Args: Record<string, unknown>
        Returns: boolean
      }
      claim_first_post_publish: {
        Args: Record<string, unknown>
        Returns: Json
      }
      claim_local_publish_job: {
        Args: Record<string, unknown>
        Returns: Json
      }
      claim_naver_post_job: {
        Args: Record<string, unknown>
        Returns: Json
      }
      claim_notice_job: {
        Args: Record<string, unknown>
        Returns: Json
      }
      claim_publish_retry: {
        Args: Record<string, unknown>
        Returns: Json
      }
      claim_publish_schedule: {
        Args: Record<string, unknown>
        Returns: Json
      }
      claim_scoped_local_publish_job: {
        Args: Record<string, unknown>
        Returns: Json
      }
      commit_payment_observation: {
        Args: Record<string, unknown>
        Returns: Json
      }
      complete_audit_export_job: {
        Args: Record<string, unknown>
        Returns: Json
      }
      complete_channel_response_delivery: {
        Args: Record<string, unknown>
        Returns: string
      }
      complete_channel_verification_v11: {
        Args: Record<string, unknown>
        Returns: boolean
      }
      complete_channel_verification_v12: {
        Args: Record<string, unknown>
        Returns: boolean
      }
      complete_claimed_publish: {
        Args: Record<string, unknown>
        Returns: string
      }
      complete_conversation_job: {
        Args: Record<string, unknown>
        Returns: Json
      }
      complete_conversation_job_v2: {
        Args: Record<string, unknown>
        Returns: Json
      }
      complete_local_publish_job: {
        Args: Record<string, unknown>
        Returns: boolean
      }
      complete_naver_post_job: {
        Args: Record<string, unknown>
        Returns: undefined
      }
      complete_v08_automation_run: {
        Args: Record<string, unknown>
        Returns: boolean
      }
      confirm_booking_recovery: {
        Args: Record<string, unknown>
        Returns: Json
      }
      confirm_interview_fact: {
        Args: Record<string, unknown>
        Returns: string
      }
      consume_connector_pairing_code: {
        Args: Record<string, unknown>
        Returns: Json
      }
      consume_first_post_publish: {
        Args: Record<string, unknown>
        Returns: Json
      }
      consume_oauth_state_nonce: {
        Args: Record<string, unknown>
        Returns: boolean
      }
      count_admin_actual_vault_items: {
        Args: Record<string, unknown>
        Returns: number
      }
      create_approved_audit_export_job: {
        Args: Record<string, unknown>
        Returns: Json
      }
      create_checkout_intent: {
        Args: Record<string, unknown>
        Returns: Json
      }
      create_connector_pairing_code: {
        Args: Record<string, unknown>
        Returns: string
      }
      create_content_version: {
        Args: Record<string, unknown>
        Returns: string
      }
      create_data_deletion_request: {
        Args: Record<string, unknown>
        Returns: string
      }
      create_initial_workspace: {
        Args: Record<string, unknown>
        Returns: string
      }
      create_mission_with_contract_atomic: {
        Args: Record<string, unknown>
        Returns: Json
      }
      create_naver_block_revision: {
        Args: Record<string, unknown>
        Returns: string
      }
      create_naver_meta_revision: {
        Args: Record<string, unknown>
        Returns: string
      }
      create_operator_incident: {
        Args: Record<string, unknown>
        Returns: Json
      }
      create_operator_legal_document_draft: {
        Args: Record<string, unknown>
        Returns: Json
      }
      create_performance_learning_candidate: {
        Args: Record<string, unknown>
        Returns: string
      }
      create_period_content_plan: {
        Args: Record<string, unknown>
        Returns: Json
      }
      create_report_decision_with_evidence: {
        Args: Record<string, unknown>
        Returns: Json
      }
      create_scoped_content_revision: {
        Args: Record<string, unknown>
        Returns: string
      }
      date_dist: {
        Args: Record<string, unknown>
        Returns: number
      }
      decide_studio_proposal: {
        Args: Record<string, unknown>
        Returns: Json
      }
      decide_studio_proposal_with_validity: {
        Args: Record<string, unknown>
        Returns: Json
      }
      disconnect_meta_channel: {
        Args: Record<string, unknown>
        Returns: boolean
      }
      disconnect_meta_channel_by_provider_account: {
        Args: Record<string, unknown>
        Returns: boolean
      }
      edit_channel_draft_variant_ani1538: {
        Args: Record<string, unknown>
        Returns: Json
      }
      end_operator_support_session: {
        Args: Record<string, unknown>
        Returns: Json
      }
      enforce_booking_recovery_steps_immutable: {
        Args: Record<string, unknown>
        Returns: Json
      }
      enqueue_conversation_job: {
        Args: Record<string, unknown>
        Returns: Json
      }
      ensure_signup_starter_credits: {
        Args: Record<string, unknown>
        Returns: Json
      }
      expire_audit_export_jobs: {
        Args: Record<string, unknown>
        Returns: Json
      }
      expire_operator_support_session: {
        Args: Record<string, unknown>
        Returns: Json
      }
      fail_audit_export_job: {
        Args: Record<string, unknown>
        Returns: Json
      }
      fail_conversation_job_dispatch: {
        Args: Record<string, unknown>
        Returns: boolean
      }
      fail_naver_post_job: {
        Args: Record<string, unknown>
        Returns: undefined
      }
      fence_quick_post_mission_insert: {
        Args: Record<string, unknown>
        Returns: Json
      }
      finalize_channel_draft_ani1538: {
        Args: Record<string, unknown>
        Returns: Json
      }
      finalize_email_signup_atomic: {
        Args: Record<string, unknown>
        Returns: Json
      }
      finalize_signup_and_grant_taste: {
        Args: Record<string, unknown>
        Returns: Json
      }
      finalize_studio_turn: {
        Args: Record<string, unknown>
        Returns: Json
      }
      find_local_publish_execution_candidate: {
        Args: Record<string, unknown>
        Returns: Json
      }
      finish_booking_recovery_step: {
        Args: Record<string, unknown>
        Returns: Json
      }
      float4_dist: {
        Args: Record<string, unknown>
        Returns: number
      }
      float8_dist: {
        Args: Record<string, unknown>
        Returns: number
      }
      fn_generation_runs_atomic_sequence_guard: {
        Args: Record<string, unknown>
        Returns: Json
      }
      gbt_bit_compress: {
        Args: Record<string, unknown>
        Returns: Json
      }
      gbt_bit_consistent: {
        Args: Record<string, unknown>
        Returns: boolean
      }
      gbt_bit_penalty: {
        Args: Record<string, unknown>
        Returns: Json
      }
      gbt_bit_picksplit: {
        Args: Record<string, unknown>
        Returns: Json
      }
      gbt_bit_same: {
        Args: Record<string, unknown>
        Returns: Json
      }
      gbt_bit_union: {
        Args: Record<string, unknown>
        Returns: Json
      }
      gbt_bool_compress: {
        Args: Record<string, unknown>
        Returns: Json
      }
      gbt_bool_consistent: {
        Args: Record<string, unknown>
        Returns: boolean
      }
      gbt_bool_fetch: {
        Args: Record<string, unknown>
        Returns: Json
      }
      gbt_bool_penalty: {
        Args: Record<string, unknown>
        Returns: Json
      }
      gbt_bool_picksplit: {
        Args: Record<string, unknown>
        Returns: Json
      }
      gbt_bool_same: {
        Args: Record<string, unknown>
        Returns: Json
      }
      gbt_bool_union: {
        Args: Record<string, unknown>
        Returns: Json
      }
      gbt_bpchar_compress: {
        Args: Record<string, unknown>
        Returns: Json
      }
      gbt_bpchar_consistent: {
        Args: Record<string, unknown>
        Returns: boolean
      }
      gbt_bytea_compress: {
        Args: Record<string, unknown>
        Returns: Json
      }
      gbt_bytea_consistent: {
        Args: Record<string, unknown>
        Returns: boolean
      }
      gbt_bytea_penalty: {
        Args: Record<string, unknown>
        Returns: Json
      }
      gbt_bytea_picksplit: {
        Args: Record<string, unknown>
        Returns: Json
      }
      gbt_bytea_same: {
        Args: Record<string, unknown>
        Returns: Json
      }
      gbt_bytea_union: {
        Args: Record<string, unknown>
        Returns: Json
      }
      gbt_cash_compress: {
        Args: Record<string, unknown>
        Returns: Json
      }
      gbt_cash_consistent: {
        Args: Record<string, unknown>
        Returns: boolean
      }
      gbt_cash_distance: {
        Args: Record<string, unknown>
        Returns: number
      }
      gbt_cash_fetch: {
        Args: Record<string, unknown>
        Returns: Json
      }
      gbt_cash_penalty: {
        Args: Record<string, unknown>
        Returns: Json
      }
      gbt_cash_picksplit: {
        Args: Record<string, unknown>
        Returns: Json
      }
      gbt_cash_same: {
        Args: Record<string, unknown>
        Returns: Json
      }
      gbt_cash_union: {
        Args: Record<string, unknown>
        Returns: Json
      }
      gbt_date_compress: {
        Args: Record<string, unknown>
        Returns: Json
      }
      gbt_date_consistent: {
        Args: Record<string, unknown>
        Returns: boolean
      }
      gbt_date_distance: {
        Args: Record<string, unknown>
        Returns: number
      }
      gbt_date_fetch: {
        Args: Record<string, unknown>
        Returns: Json
      }
      gbt_date_penalty: {
        Args: Record<string, unknown>
        Returns: Json
      }
      gbt_date_picksplit: {
        Args: Record<string, unknown>
        Returns: Json
      }
      gbt_date_same: {
        Args: Record<string, unknown>
        Returns: Json
      }
      gbt_date_union: {
        Args: Record<string, unknown>
        Returns: Json
      }
      gbt_decompress: {
        Args: Record<string, unknown>
        Returns: Json
      }
      gbt_enum_compress: {
        Args: Record<string, unknown>
        Returns: Json
      }
      gbt_enum_consistent: {
        Args: Record<string, unknown>
        Returns: boolean
      }
      gbt_enum_fetch: {
        Args: Record<string, unknown>
        Returns: Json
      }
      gbt_enum_penalty: {
        Args: Record<string, unknown>
        Returns: Json
      }
      gbt_enum_picksplit: {
        Args: Record<string, unknown>
        Returns: Json
      }
      gbt_enum_same: {
        Args: Record<string, unknown>
        Returns: Json
      }
      gbt_enum_union: {
        Args: Record<string, unknown>
        Returns: Json
      }
      gbt_float4_compress: {
        Args: Record<string, unknown>
        Returns: Json
      }
      gbt_float4_consistent: {
        Args: Record<string, unknown>
        Returns: boolean
      }
      gbt_float4_distance: {
        Args: Record<string, unknown>
        Returns: number
      }
      gbt_float4_fetch: {
        Args: Record<string, unknown>
        Returns: Json
      }
      gbt_float4_penalty: {
        Args: Record<string, unknown>
        Returns: Json
      }
      gbt_float4_picksplit: {
        Args: Record<string, unknown>
        Returns: Json
      }
      gbt_float4_same: {
        Args: Record<string, unknown>
        Returns: Json
      }
      gbt_float4_union: {
        Args: Record<string, unknown>
        Returns: Json
      }
      gbt_float8_compress: {
        Args: Record<string, unknown>
        Returns: Json
      }
      gbt_float8_consistent: {
        Args: Record<string, unknown>
        Returns: boolean
      }
      gbt_float8_distance: {
        Args: Record<string, unknown>
        Returns: number
      }
      gbt_float8_fetch: {
        Args: Record<string, unknown>
        Returns: Json
      }
      gbt_float8_penalty: {
        Args: Record<string, unknown>
        Returns: Json
      }
      gbt_float8_picksplit: {
        Args: Record<string, unknown>
        Returns: Json
      }
      gbt_float8_same: {
        Args: Record<string, unknown>
        Returns: Json
      }
      gbt_float8_union: {
        Args: Record<string, unknown>
        Returns: Json
      }
      gbt_inet_compress: {
        Args: Record<string, unknown>
        Returns: Json
      }
      gbt_inet_consistent: {
        Args: Record<string, unknown>
        Returns: boolean
      }
      gbt_inet_penalty: {
        Args: Record<string, unknown>
        Returns: Json
      }
      gbt_inet_picksplit: {
        Args: Record<string, unknown>
        Returns: Json
      }
      gbt_inet_same: {
        Args: Record<string, unknown>
        Returns: Json
      }
      gbt_inet_union: {
        Args: Record<string, unknown>
        Returns: Json
      }
      gbt_int2_compress: {
        Args: Record<string, unknown>
        Returns: Json
      }
      gbt_int2_consistent: {
        Args: Record<string, unknown>
        Returns: boolean
      }
      gbt_int2_distance: {
        Args: Record<string, unknown>
        Returns: number
      }
      gbt_int2_fetch: {
        Args: Record<string, unknown>
        Returns: Json
      }
      gbt_int2_penalty: {
        Args: Record<string, unknown>
        Returns: Json
      }
      gbt_int2_picksplit: {
        Args: Record<string, unknown>
        Returns: Json
      }
      gbt_int2_same: {
        Args: Record<string, unknown>
        Returns: Json
      }
      gbt_int2_union: {
        Args: Record<string, unknown>
        Returns: Json
      }
      gbt_int4_compress: {
        Args: Record<string, unknown>
        Returns: Json
      }
      gbt_int4_consistent: {
        Args: Record<string, unknown>
        Returns: boolean
      }
      gbt_int4_distance: {
        Args: Record<string, unknown>
        Returns: number
      }
      gbt_int4_fetch: {
        Args: Record<string, unknown>
        Returns: Json
      }
      gbt_int4_penalty: {
        Args: Record<string, unknown>
        Returns: Json
      }
      gbt_int4_picksplit: {
        Args: Record<string, unknown>
        Returns: Json
      }
      gbt_int4_same: {
        Args: Record<string, unknown>
        Returns: Json
      }
      gbt_int4_union: {
        Args: Record<string, unknown>
        Returns: Json
      }
      gbt_int8_compress: {
        Args: Record<string, unknown>
        Returns: Json
      }
      gbt_int8_consistent: {
        Args: Record<string, unknown>
        Returns: boolean
      }
      gbt_int8_distance: {
        Args: Record<string, unknown>
        Returns: number
      }
      gbt_int8_fetch: {
        Args: Record<string, unknown>
        Returns: Json
      }
      gbt_int8_penalty: {
        Args: Record<string, unknown>
        Returns: Json
      }
      gbt_int8_picksplit: {
        Args: Record<string, unknown>
        Returns: Json
      }
      gbt_int8_same: {
        Args: Record<string, unknown>
        Returns: Json
      }
      gbt_int8_union: {
        Args: Record<string, unknown>
        Returns: Json
      }
      gbt_intv_compress: {
        Args: Record<string, unknown>
        Returns: Json
      }
      gbt_intv_consistent: {
        Args: Record<string, unknown>
        Returns: boolean
      }
      gbt_intv_decompress: {
        Args: Record<string, unknown>
        Returns: Json
      }
      gbt_intv_distance: {
        Args: Record<string, unknown>
        Returns: number
      }
      gbt_intv_fetch: {
        Args: Record<string, unknown>
        Returns: Json
      }
      gbt_intv_penalty: {
        Args: Record<string, unknown>
        Returns: Json
      }
      gbt_intv_picksplit: {
        Args: Record<string, unknown>
        Returns: Json
      }
      gbt_intv_same: {
        Args: Record<string, unknown>
        Returns: Json
      }
      gbt_intv_union: {
        Args: Record<string, unknown>
        Returns: Json
      }
      gbt_macad8_compress: {
        Args: Record<string, unknown>
        Returns: Json
      }
      gbt_macad8_consistent: {
        Args: Record<string, unknown>
        Returns: boolean
      }
      gbt_macad8_fetch: {
        Args: Record<string, unknown>
        Returns: Json
      }
      gbt_macad8_penalty: {
        Args: Record<string, unknown>
        Returns: Json
      }
      gbt_macad8_picksplit: {
        Args: Record<string, unknown>
        Returns: Json
      }
      gbt_macad8_same: {
        Args: Record<string, unknown>
        Returns: Json
      }
      gbt_macad8_union: {
        Args: Record<string, unknown>
        Returns: Json
      }
      gbt_macad_compress: {
        Args: Record<string, unknown>
        Returns: Json
      }
      gbt_macad_consistent: {
        Args: Record<string, unknown>
        Returns: boolean
      }
      gbt_macad_fetch: {
        Args: Record<string, unknown>
        Returns: Json
      }
      gbt_macad_penalty: {
        Args: Record<string, unknown>
        Returns: Json
      }
      gbt_macad_picksplit: {
        Args: Record<string, unknown>
        Returns: Json
      }
      gbt_macad_same: {
        Args: Record<string, unknown>
        Returns: Json
      }
      gbt_macad_union: {
        Args: Record<string, unknown>
        Returns: Json
      }
      gbt_numeric_compress: {
        Args: Record<string, unknown>
        Returns: Json
      }
      gbt_numeric_consistent: {
        Args: Record<string, unknown>
        Returns: boolean
      }
      gbt_numeric_penalty: {
        Args: Record<string, unknown>
        Returns: Json
      }
      gbt_numeric_picksplit: {
        Args: Record<string, unknown>
        Returns: Json
      }
      gbt_numeric_same: {
        Args: Record<string, unknown>
        Returns: Json
      }
      gbt_numeric_union: {
        Args: Record<string, unknown>
        Returns: Json
      }
      gbt_oid_compress: {
        Args: Record<string, unknown>
        Returns: Json
      }
      gbt_oid_consistent: {
        Args: Record<string, unknown>
        Returns: boolean
      }
      gbt_oid_distance: {
        Args: Record<string, unknown>
        Returns: number
      }
      gbt_oid_fetch: {
        Args: Record<string, unknown>
        Returns: Json
      }
      gbt_oid_penalty: {
        Args: Record<string, unknown>
        Returns: Json
      }
      gbt_oid_picksplit: {
        Args: Record<string, unknown>
        Returns: Json
      }
      gbt_oid_same: {
        Args: Record<string, unknown>
        Returns: Json
      }
      gbt_oid_union: {
        Args: Record<string, unknown>
        Returns: Json
      }
      gbt_text_compress: {
        Args: Record<string, unknown>
        Returns: Json
      }
      gbt_text_consistent: {
        Args: Record<string, unknown>
        Returns: boolean
      }
      gbt_text_penalty: {
        Args: Record<string, unknown>
        Returns: Json
      }
      gbt_text_picksplit: {
        Args: Record<string, unknown>
        Returns: Json
      }
      gbt_text_same: {
        Args: Record<string, unknown>
        Returns: Json
      }
      gbt_text_union: {
        Args: Record<string, unknown>
        Returns: Json
      }
      gbt_time_compress: {
        Args: Record<string, unknown>
        Returns: Json
      }
      gbt_time_consistent: {
        Args: Record<string, unknown>
        Returns: boolean
      }
      gbt_time_distance: {
        Args: Record<string, unknown>
        Returns: number
      }
      gbt_time_fetch: {
        Args: Record<string, unknown>
        Returns: Json
      }
      gbt_time_penalty: {
        Args: Record<string, unknown>
        Returns: Json
      }
      gbt_time_picksplit: {
        Args: Record<string, unknown>
        Returns: Json
      }
      gbt_time_same: {
        Args: Record<string, unknown>
        Returns: Json
      }
      gbt_time_union: {
        Args: Record<string, unknown>
        Returns: Json
      }
      gbt_timetz_compress: {
        Args: Record<string, unknown>
        Returns: Json
      }
      gbt_timetz_consistent: {
        Args: Record<string, unknown>
        Returns: boolean
      }
      gbt_ts_compress: {
        Args: Record<string, unknown>
        Returns: Json
      }
      gbt_ts_consistent: {
        Args: Record<string, unknown>
        Returns: boolean
      }
      gbt_ts_distance: {
        Args: Record<string, unknown>
        Returns: number
      }
      gbt_ts_fetch: {
        Args: Record<string, unknown>
        Returns: Json
      }
      gbt_ts_penalty: {
        Args: Record<string, unknown>
        Returns: Json
      }
      gbt_ts_picksplit: {
        Args: Record<string, unknown>
        Returns: Json
      }
      gbt_ts_same: {
        Args: Record<string, unknown>
        Returns: Json
      }
      gbt_ts_union: {
        Args: Record<string, unknown>
        Returns: Json
      }
      gbt_tstz_compress: {
        Args: Record<string, unknown>
        Returns: Json
      }
      gbt_tstz_consistent: {
        Args: Record<string, unknown>
        Returns: boolean
      }
      gbt_tstz_distance: {
        Args: Record<string, unknown>
        Returns: number
      }
      gbt_uuid_compress: {
        Args: Record<string, unknown>
        Returns: Json
      }
      gbt_uuid_consistent: {
        Args: Record<string, unknown>
        Returns: boolean
      }
      gbt_uuid_fetch: {
        Args: Record<string, unknown>
        Returns: Json
      }
      gbt_uuid_penalty: {
        Args: Record<string, unknown>
        Returns: Json
      }
      gbt_uuid_picksplit: {
        Args: Record<string, unknown>
        Returns: Json
      }
      gbt_uuid_same: {
        Args: Record<string, unknown>
        Returns: Json
      }
      gbt_uuid_union: {
        Args: Record<string, unknown>
        Returns: Json
      }
      gbt_var_decompress: {
        Args: Record<string, unknown>
        Returns: Json
      }
      gbt_var_fetch: {
        Args: Record<string, unknown>
        Returns: Json
      }
      gbtreekey16_in: {
        Args: Record<string, unknown>
        Returns: Json
      }
      gbtreekey16_out: {
        Args: Record<string, unknown>
        Returns: Json
      }
      gbtreekey2_in: {
        Args: Record<string, unknown>
        Returns: Json
      }
      gbtreekey2_out: {
        Args: Record<string, unknown>
        Returns: Json
      }
      gbtreekey32_in: {
        Args: Record<string, unknown>
        Returns: Json
      }
      gbtreekey32_out: {
        Args: Record<string, unknown>
        Returns: Json
      }
      gbtreekey4_in: {
        Args: Record<string, unknown>
        Returns: Json
      }
      gbtreekey4_out: {
        Args: Record<string, unknown>
        Returns: Json
      }
      gbtreekey8_in: {
        Args: Record<string, unknown>
        Returns: Json
      }
      gbtreekey8_out: {
        Args: Record<string, unknown>
        Returns: Json
      }
      gbtreekey_var_in: {
        Args: Record<string, unknown>
        Returns: Json
      }
      gbtreekey_var_out: {
        Args: Record<string, unknown>
        Returns: Json
      }
      get_applied_migrations: {
        Args: Record<string, unknown>
        Returns: Json
      }
      get_audit_export_download: {
        Args: Record<string, unknown>
        Returns: Json
      }
      get_conversation_work_status: {
        Args: Record<string, unknown>
        Returns: Json
      }
      get_conversation_work_status_v2: {
        Args: Record<string, unknown>
        Returns: Json
      }
      get_current_operator_context: {
        Args: Record<string, unknown>
        Returns: Json
      }
      get_current_operator_setup_context: {
        Args: Record<string, unknown>
        Returns: Json
      }
      get_data_deletion_request_status: {
        Args: Record<string, unknown>
        Returns: Json
      }
      get_local_publish_execution_scope: {
        Args: Record<string, unknown>
        Returns: Json
      }
      get_my_workspace_summary: {
        Args: Record<string, unknown>
        Returns: Json
      }
      get_operator_agent_runs: {
        Args: Record<string, unknown>
        Returns: Json
      }
      get_operator_audit_event_detail: {
        Args: Record<string, unknown>
        Returns: Json
      }
      get_operator_control_tower_summary: {
        Args: Record<string, unknown>
        Returns: Json
      }
      get_operator_onboarding_overview: {
        Args: Record<string, unknown>
        Returns: Json
      }
      get_operator_system_observations: {
        Args: Record<string, unknown>
        Returns: Json
      }
      get_operator_system_observations_v2: {
        Args: Record<string, unknown>
        Returns: Json
      }
      get_operator_workspace_detail: {
        Args: Record<string, unknown>
        Returns: Json
      }
      get_workspace_authoritative_credit_balance: {
        Args: Record<string, unknown>
        Returns: Json
      }
      get_workspace_credit_balance: {
        Args: Record<string, unknown>
        Returns: Json
      }
      get_workspace_credit_usage_detail: {
        Args: Record<string, unknown>
        Returns: Json
      }
      get_workspace_membership_tier: {
        Args: Record<string, unknown>
        Returns: string
      }
      grant_bulk_credits: {
        Args: Record<string, unknown>
        Returns: Json
      }
      grant_sohee_ready_starter_entitlement: {
        Args: Record<string, unknown>
        Returns: Json
      }
      heartbeat_connector_device: {
        Args: Record<string, unknown>
        Returns: boolean
      }
      int2_dist: {
        Args: Record<string, unknown>
        Returns: number
      }
      int4_dist: {
        Args: Record<string, unknown>
        Returns: number
      }
      int8_dist: {
        Args: Record<string, unknown>
        Returns: number
      }
      interval_dist: {
        Args: Record<string, unknown>
        Returns: string
      }
      invalidate_notice_jobs: {
        Args: Record<string, unknown>
        Returns: Json
      }
      issue_local_submit_permit: {
        Args: Record<string, unknown>
        Returns: boolean
      }
      list_audit_export_rows: {
        Args: Record<string, unknown>
        Returns: Json
      }
      list_channel_interactions: {
        Args: Record<string, unknown>
        Returns: Json
      }
      list_checkout_intents: {
        Args: Record<string, unknown>
        Returns: Json
      }
      list_collectable_url_knowledge_sources: {
        Args: Record<string, unknown>
        Returns: Json
      }
      list_due_publish_schedules: {
        Args: Record<string, unknown>
        Returns: Json
      }
      list_due_social_metric_contexts: {
        Args: Record<string, unknown>
        Returns: Json
      }
      list_operator_admin_approval_requests: {
        Args: Record<string, unknown>
        Returns: Json
      }
      list_operator_admin_selector_options: {
        Args: Record<string, unknown>
        Returns: Json
      }
      list_operator_admins: {
        Args: Record<string, unknown>
        Returns: Json
      }
      list_operator_audit_events: {
        Args: Record<string, unknown>
        Returns: Json
      }
      list_operator_audit_export_jobs: {
        Args: Record<string, unknown>
        Returns: Json
      }
      list_operator_billing_overview: {
        Args: Record<string, unknown>
        Returns: Json
      }
      list_operator_channel_connections: {
        Args: Record<string, unknown>
        Returns: Json
      }
      list_operator_channel_connections_v2: {
        Args: Record<string, unknown>
        Returns: Json
      }
      list_operator_document_reconsent_targets: {
        Args: Record<string, unknown>
        Returns: Json
      }
      list_operator_incidents: {
        Args: Record<string, unknown>
        Returns: Json
      }
      list_operator_publish_operations: {
        Args: Record<string, unknown>
        Returns: Json
      }
      list_operator_support_sessions: {
        Args: Record<string, unknown>
        Returns: Json
      }
      list_operator_support_sessions_v2: {
        Args: Record<string, unknown>
        Returns: Json
      }
      list_operator_workspaces: {
        Args: Record<string, unknown>
        Returns: Json
      }
      list_social_post_reports: {
        Args: Record<string, unknown>
        Returns: Json
      }
      list_social_post_reports_v075: {
        Args: Record<string, unknown>
        Returns: Json
      }
      list_social_report_reactions: {
        Args: Record<string, unknown>
        Returns: Json
      }
      list_workspace_credit_ledger: {
        Args: Record<string, unknown>
        Returns: Json
      }
      load_approved_meta_publish_payload: {
        Args: Record<string, unknown>
        Returns: Json
      }
      load_instagram_provider_rejected_retry_media: {
        Args: Record<string, unknown>
        Returns: Json
      }
      load_meta_channel_credential: {
        Args: Record<string, unknown>
        Returns: Json
      }
      load_publish_reconciliation: {
        Args: Record<string, unknown>
        Returns: Json
      }
      load_reconciled_meta_publish_payload: {
        Args: Record<string, unknown>
        Returns: Json
      }
      load_social_metric_context: {
        Args: Record<string, unknown>
        Returns: Json
      }
      mark_conversation_job_dispatched: {
        Args: Record<string, unknown>
        Returns: boolean
      }
      mark_meta_channel_unavailable: {
        Args: Record<string, unknown>
        Returns: boolean
      }
      migrate_legacy_500_trial_cohort: {
        Args: Record<string, unknown>
        Returns: number
      }
      naver_revision_readiness: {
        Args: Record<string, unknown>
        Returns: Json
      }
      oid_dist: {
        Args: Record<string, unknown>
        Returns: Json
      }
      open_booking_recovery: {
        Args: Record<string, unknown>
        Returns: Json
      }
      pause_harness_rule: {
        Args: Record<string, unknown>
        Returns: string
      }
      persist_conversation_job_request: {
        Args: Record<string, unknown>
        Returns: boolean
      }
      persist_planned_content_draft: {
        Args: Record<string, unknown>
        Returns: Json
      }
      prepare_signup_application_atomic: {
        Args: Record<string, unknown>
        Returns: Json
      }
      preview_bulk_credit_grant: {
        Args: Record<string, unknown>
        Returns: Json
      }
      preview_v08_automation_budget: {
        Args: Record<string, unknown>
        Returns: Json
      }
      provision_education_workspace: {
        Args: Record<string, unknown>
        Returns: Json
      }
      provision_signup_workspace: {
        Args: Record<string, unknown>
        Returns: Json
      }
      purge_deleted_user_feedback: {
        Args: Record<string, unknown>
        Returns: number
      }
      purge_deleted_vault_items: {
        Args: Record<string, unknown>
        Returns: Json
      }
      purge_expired_instagram_dm_data: {
        Args: Record<string, unknown>
        Returns: Json
      }
      purge_expired_social_comment_data: {
        Args: Record<string, unknown>
        Returns: Json
      }
      purge_workspace_vault_data: {
        Args: Record<string, unknown>
        Returns: Json
      }
      reconcile_external_action: {
        Args: Record<string, unknown>
        Returns: boolean
      }
      reconcile_local_publish_observed_result: {
        Args: Record<string, unknown>
        Returns: boolean
      }
      reconcile_quick_post_orphan: {
        Args: Record<string, unknown>
        Returns: Json
      }
      reconfirm_local_publish: {
        Args: Record<string, unknown>
        Returns: boolean
      }
      record_admin_invite_provider_result: {
        Args: Record<string, unknown>
        Returns: Json
      }
      record_ai_usage_event: {
        Args: Record<string, unknown>
        Returns: boolean
      }
      record_ai_usage_event_v2: {
        Args: Record<string, unknown>
        Returns: boolean
      }
      record_channel_response_provider_request: {
        Args: Record<string, unknown>
        Returns: string
      }
      record_claimed_publish_request: {
        Args: Record<string, unknown>
        Returns: string
      }
      record_current_invited_operator_password_set: {
        Args: Record<string, unknown>
        Returns: string
      }
      record_external_action_result: {
        Args: Record<string, unknown>
        Returns: boolean
      }
      record_local_publish_checkpoint: {
        Args: Record<string, unknown>
        Returns: boolean
      }
      record_meta_webhook_health: {
        Args: Record<string, unknown>
        Returns: boolean
      }
      record_operator_incident_recovery: {
        Args: Record<string, unknown>
        Returns: Json
      }
      record_publish_attempt: {
        Args: Record<string, unknown>
        Returns: string
      }
      recover_expired_local_publish_before_submit: {
        Args: Record<string, unknown>
        Returns: boolean
      }
      recover_expired_local_publish_jobs: {
        Args: Record<string, unknown>
        Returns: number
      }
      recover_expired_publish_attempt: {
        Args: Record<string, unknown>
        Returns: string
      }
      recover_expired_publish_leases: {
        Args: Record<string, unknown>
        Returns: number
      }
      recover_scoped_local_publish_checkpoint: {
        Args: Record<string, unknown>
        Returns: Json
      }
      register_browser_channel_connection: {
        Args: Record<string, unknown>
        Returns: string
      }
      register_oauth_state_nonce: {
        Args: Record<string, unknown>
        Returns: boolean
      }
      reject_content_version: {
        Args: Record<string, unknown>
        Returns: string
      }
      release_channel_draft_ani1538: {
        Args: Record<string, unknown>
        Returns: undefined
      }
      release_credit_reservation: {
        Args: Record<string, unknown>
        Returns: Json
      }
      release_quick_post_credits: {
        Args: Record<string, unknown>
        Returns: Json
      }
      release_unstarted_conversation_job_credit: {
        Args: Record<string, unknown>
        Returns: boolean
      }
      request_admin_account_approval: {
        Args: Record<string, unknown>
        Returns: Json
      }
      request_admin_approval: {
        Args: Record<string, unknown>
        Returns: Json
      }
      request_conversation_job_cancel: {
        Args: Record<string, unknown>
        Returns: Json
      }
      request_meta_data_deletion: {
        Args: Record<string, unknown>
        Returns: string
      }
      request_operator_workspace_activation: {
        Args: Record<string, unknown>
        Returns: Json
      }
      reschedule_content: {
        Args: Record<string, unknown>
        Returns: string
      }
      reschedule_content_guarded: {
        Args: Record<string, unknown>
        Returns: string
      }
      reserve_channel_draft_ani1538: {
        Args: Record<string, unknown>
        Returns: string
      }
      reserve_deposit_refund: {
        Args: Record<string, unknown>
        Returns: Json
      }
      reserve_publish_attempt: {
        Args: Record<string, unknown>
        Returns: Json
      }
      reserve_publish_retry: {
        Args: Record<string, unknown>
        Returns: Json
      }
      reserve_quick_post_credits: {
        Args: Record<string, unknown>
        Returns: Json
      }
      reserve_workspace_credits: {
        Args: Record<string, unknown>
        Returns: Json
      }
      resolve_conversation_job_attention: {
        Args: Record<string, unknown>
        Returns: Json
      }
      resolve_data_deletion_request: {
        Args: Record<string, unknown>
        Returns: boolean
      }
      resolve_knowledge_conflict: {
        Args: Record<string, unknown>
        Returns: string
      }
      resolve_reconciled_publish: {
        Args: Record<string, unknown>
        Returns: string
      }
      resolve_unstarted_conversation_job_attention: {
        Args: Record<string, unknown>
        Returns: boolean
      }
      restart_v08_onboarding: {
        Args: Record<string, unknown>
        Returns: Json
      }
      restore_naver_version: {
        Args: Record<string, unknown>
        Returns: string
      }
      retire_operator_mfa_exception: {
        Args: Record<string, unknown>
        Returns: Json
      }
      retry_local_publish_before_submit: {
        Args: Record<string, unknown>
        Returns: boolean
      }
      retry_publish_attempt: {
        Args: Record<string, unknown>
        Returns: string
      }
      review_harness_rule: {
        Args: Record<string, unknown>
        Returns: string
      }
      review_knowledge_candidate: {
        Args: Record<string, unknown>
        Returns: string
      }
      review_knowledge_item: {
        Args: Record<string, unknown>
        Returns: string
      }
      review_operator_legal_document_version: {
        Args: Record<string, unknown>
        Returns: Json
      }
      review_performance_learning_candidate: {
        Args: Record<string, unknown>
        Returns: boolean
      }
      review_v08_profile_candidate: {
        Args: Record<string, unknown>
        Returns: Json
      }
      revoke_connector_device: {
        Args: Record<string, unknown>
        Returns: boolean
      }
      revoke_operator_support_session: {
        Args: Record<string, unknown>
        Returns: Json
      }
      rls_auto_enable: {
        Args: Record<string, unknown>
        Returns: Json
      }
      run_mock_automation: {
        Args: Record<string, unknown>
        Returns: Json
      }
      save_automation_rule: {
        Args: Record<string, unknown>
        Returns: string
      }
      save_channel_connection_v11: {
        Args: Record<string, unknown>
        Returns: string
      }
      save_channel_metric_collection: {
        Args: Record<string, unknown>
        Returns: string
      }
      save_channel_profile_snapshot: {
        Args: Record<string, unknown>
        Returns: string
      }
      save_conversation_artifact_to_work: {
        Args: Record<string, unknown>
        Returns: Json
      }
      save_meta_channel_connection: {
        Args: Record<string, unknown>
        Returns: string
      }
      save_mobile_reply_draft: {
        Args: Record<string, unknown>
        Returns: Json
      }
      save_v08_onboarding_answer: {
        Args: Record<string, unknown>
        Returns: Json
      }
      schedule_approved_content: {
        Args: Record<string, unknown>
        Returns: string
      }
      seed_trial_journey_milestones: {
        Args: Record<string, unknown>
        Returns: undefined
      }
      settle_credit_reservation: {
        Args: Record<string, unknown>
        Returns: Json
      }
      settle_quick_post_credits: {
        Args: Record<string, unknown>
        Returns: Json
      }
      sns_release_readiness: {
        Args: Record<string, unknown>
        Returns: Json
      }
      stage_conversation_agent_response: {
        Args: Record<string, unknown>
        Returns: boolean
      }
      start_conversation_with_first_message: {
        Args: Record<string, unknown>
        Returns: Json
      }
      start_operator_support_session: {
        Args: Record<string, unknown>
        Returns: Json
      }
      start_v08_onboarding: {
        Args: Record<string, unknown>
        Returns: Json
      }
      time_dist: {
        Args: Record<string, unknown>
        Returns: string
      }
      transition_booking_recovery: {
        Args: Record<string, unknown>
        Returns: Json
      }
      transition_operator_incident: {
        Args: Record<string, unknown>
        Returns: Json
      }
      trg_on_ddl_end: {
        Args: Record<string, unknown>
        Returns: Json
      }
      ts_dist: {
        Args: Record<string, unknown>
        Returns: string
      }
      tstz_dist: {
        Args: Record<string, unknown>
        Returns: string
      }
      update_mission_snapshot_atomic: {
        Args: Record<string, unknown>
        Returns: Json
      }
      vault_apply_edits: {
        Args: Record<string, unknown>
        Returns: Json
      }
      workspace_membership_overview: {
        Args: Record<string, unknown>
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
}

export type PublicSchema = Database[Extract<keyof Database, "public">]
export type Tables<T extends keyof PublicSchema["Tables"]> = PublicSchema["Tables"][T]["Row"]
export type TablesInsert<T extends keyof PublicSchema["Tables"]> = PublicSchema["Tables"][T]["Insert"]
export type TablesUpdate<T extends keyof PublicSchema["Tables"]> = PublicSchema["Tables"][T]["Update"]
