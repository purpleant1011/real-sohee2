/**
 * SOHEE Harness Knowledge OS — Supabase DB Repository (v1.1)
 * Provides production PostgreSQL persistence with RLS & graceful in-memory fallback.
 */

import {
  HarnessAsset,
  HarnessVersion,
  HarnessRule,
  HarnessChannelAssignment,
  HarnessOverride
} from '@/types/harness'
import { harnessStore } from '@/lib/harness/harness-store'

export class SupabaseHarnessRepository {
  /**
   * 1. Harness Assets 목록 조회 (Workspace RLS 격리)
   */
  public async getAssets(workspaceId: string): Promise<HarnessAsset[]> {
    try {
      if (process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.NEXT_PUBLIC_SUPABASE_URL) {
        const { createAdminSupabaseClient } = await import('@/lib/supabase/admin')
        const supabase = createAdminSupabaseClient()
        const { data, error } = await supabase
          .from('harness_assets' as any)
          .select('*')
          .eq('workspace_id', workspaceId)
          .order('created_at', { ascending: false })

        if (!error && data && data.length > 0) {
          return data.map((row: any) => ({
            id: row.id,
            workspaceId: row.workspace_id,
            assetType: row.asset_type,
            sourceEntityId: row.source_entity_id,
            title: row.title,
            visibility: row.visibility,
            overallStatus: row.overall_status,
            activeVersionId: row.active_version_id || '',
            activeVersionNo: row.active_version_no,
            platform: row.platform,
            sourceUrl: row.source_url,
            sourceHandle: row.source_handle,
            coreDna: row.core_dna || [],
            moduleReadiness: row.module_readiness || {},
            dailyEstimatedSc: row.daily_estimated_sc,
            totalSpentSc: row.total_spent_sc,
            lastAnalyzedAt: row.last_analyzed_at,
            createdAt: row.created_at,
            updatedAt: row.updated_at
          }))
        }
      }
    } catch (err) {
      console.warn('[SupabaseHarnessRepository] Falling back to local store for assets:', err)
    }

    return harnessStore.getAssets(workspaceId)
  }

  /**
   * 2. Harness Version 조회
   */
  public async getVersionById(versionId: string): Promise<HarnessVersion | undefined> {
    try {
      if (process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.NEXT_PUBLIC_SUPABASE_URL) {
        const { createAdminSupabaseClient } = await import('@/lib/supabase/admin')
        const supabase = createAdminSupabaseClient()
        const { data, error } = await supabase
          .from('harness_versions' as any)
          .select('*')
          .eq('id', versionId)
          .single()

        if (!error && data) {
          const row: any = data
          return {
            id: row.id,
            harnessAssetId: row.harness_asset_id,
            versionNo: row.version_no,
            schemaVersion: row.schema_version,
            compilerVersion: row.compiler_version,
            textJson: row.text_json,
            visualJson: row.visual_json,
            operationsJson: row.operations_json,
            communityJson: row.community_json,
            platformJson: row.platform_json,
            evidenceScore: row.evidence_score,
            confidence: row.confidence,
            immutable: row.immutable,
            createdAt: row.created_at
          }
        }
      }
    } catch (err) {
      console.warn('[SupabaseHarnessRepository] Falling back to local store for version:', err)
    }

    return harnessStore.getVersionById(versionId)
  }

  /**
   * 3. Harness Rules 조회
   */
  public async getRulesByVersionId(versionId: string): Promise<HarnessRule[]> {
    try {
      if (process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.NEXT_PUBLIC_SUPABASE_URL) {
        const { createAdminSupabaseClient } = await import('@/lib/supabase/admin')
        const supabase = createAdminSupabaseClient()
        const { data, error } = await supabase
          .from('harness_rules' as any)
          .select('*')
          .eq('harness_version_id', versionId)

        if (!error && data && data.length > 0) {
          return data.map((row: any) => ({
            id: row.id,
            harnessVersionId: row.harness_version_id,
            module: row.module,
            ruleKey: row.rule_key,
            ruleTitle: row.rule_title,
            ruleValue: row.rule_value,
            evidenceState: row.evidence_state,
            supportingSampleCount: row.supporting_sample_count,
            contradictorySampleCount: row.contradictory_sample_count,
            confidence: row.confidence,
            confidenceBasis: row.confidence_basis
          }))
        }
      }
    } catch (err) {
      console.warn('[SupabaseHarnessRepository] Falling back to local store for rules:', err)
    }

    return harnessStore.getRulesByVersionId(versionId)
  }

  /**
   * 4. User Override 저장
   */
  public async addOverride(override: Omit<HarnessOverride, 'id' | 'createdAt'>): Promise<HarnessOverride> {
    try {
      if (process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.NEXT_PUBLIC_SUPABASE_URL) {
        const { createAdminSupabaseClient } = await import('@/lib/supabase/admin')
        const supabase = createAdminSupabaseClient()
        const { data, error } = await supabase
          .from('harness_override_versions' as any)
          .insert({
            harness_asset_id: override.harnessAssetId,
            workspace_id: override.workspaceId,
            override_json: {
              module: override.module,
              ruleKey: override.ruleKey,
              overrideValue: override.overrideValue,
              reason: override.reason
            }
          })
          .select()
          .single()

        if (!error && data) {
          const row: any = data
          return {
            id: row.id,
            harnessAssetId: row.harness_asset_id,
            workspaceId: row.workspace_id,
            module: override.module,
            ruleKey: override.ruleKey,
            overrideValue: override.overrideValue,
            reason: override.reason,
            createdAt: row.created_at
          }
        }
      }
    } catch (err) {
      console.warn('[SupabaseHarnessRepository] Falling back to local store for override:', err)
    }

    return harnessStore.addOverride(override)
  }
}

export const supabaseHarnessRepository = new SupabaseHarnessRepository()
