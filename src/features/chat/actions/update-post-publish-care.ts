'use server'

import { SupabaseEngagementRepository } from '@/features/engagement/repository'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import {
  mapPostPublishCareState,
  type PostPublishCareResult,
  type RawAutomationRuleRow,
  type RawCredentialRow,
  type RawEngagementPolicyRow,
  updatePostPublishCareInputSchema,
} from './post-publish-care-helpers'

export async function updatePostPublishCare(input: unknown): Promise<PostPublishCareResult> {
  const parsed = updatePostPublishCareInputSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, code: 'invalid_input' }
  }

  const { workspaceId, channel, key, enabled } = parsed.data

  try {
    const serverSupabase = await createServerSupabaseClient()
    const { data: userData, error: userError } = await serverSupabase.auth.getUser()
    const userId = userData?.user?.id
    if (userError || typeof userId !== 'string') {
      return { ok: false, code: 'unauthenticated' }
    }

    const { data: membership, error: membershipError } = await serverSupabase
      .from('workspace_members')
      .select('workspace_id, role, status')
      .eq('workspace_id', workspaceId)
      .eq('user_id', userId)
      .maybeSingle()

    if (membershipError || !membership || membership.status !== 'active') {
      return { ok: false, code: 'forbidden' }
    }

    if (membership.role !== 'owner' && membership.role !== 'manager') {
      return { ok: false, code: 'forbidden' }
    }

    const admin = createAdminSupabaseClient()
    const nowIso = new Date().toISOString()

    if (key === 'comment_watch') {
      const { data: existingPolicy } = await admin
        .from('engagement_policies')
        .select('id')
        .eq('workspace_id', workspaceId)
        .eq('channel', channel)
        .maybeSingle()

      if (existingPolicy) {
        await admin
          .from('engagement_policies')
          .update({
            is_paused: !enabled,
            autonomy_level: 'L1_MANUAL',
            auto_reply_enabled: false,
            updated_at: nowIso,
          })
          .eq('workspace_id', workspaceId)
          .eq('channel', channel)
      } else {
        const repo = new SupabaseEngagementRepository(admin as any)
        await repo.upsertPolicy(workspaceId, {
          channel,
          is_paused: !enabled,
          autonomy_level: 'L1_MANUAL',
          auto_reply_enabled: false,
        })
      }
    } else if (key === 'reaction_report') {
      const { data: existingRule } = await admin
        .from('automation_rules')
        .select('id')
        .eq('workspace_id', workspaceId)
        .eq('kind', 'daily_performance_report')
        .maybeSingle()

      if (!existingRule) {
        return { ok: false, code: 'needs_setup' }
      }

      await admin
        .from('automation_rules')
        .update({
          active: enabled,
          updated_at: nowIso,
        })
        .eq('workspace_id', workspaceId)
        .eq('kind', 'daily_performance_report')
    }

    // Read back fresh authoritative state
    const [policyResult, rulesResult, credentialResult] = await Promise.all([
      admin
        .from('engagement_policies')
        .select('is_paused, auto_reply_enabled, autonomy_level')
        .eq('workspace_id', workspaceId)
        .eq('channel', channel)
        .maybeSingle(),
      admin
        .from('automation_rules')
        .select('kind, active')
        .eq('workspace_id', workspaceId)
        .eq('kind', 'daily_performance_report'),
      admin
        .from('meta_channel_credentials')
        .select('status, granted_scopes')
        .eq('workspace_id', workspaceId)
        .eq('provider', channel)
        .maybeSingle(),
    ])

    const state = mapPostPublishCareState({
      workspaceId,
      channel,
      policy: (policyResult.data as RawEngagementPolicyRow | null) ?? null,
      rules: (rulesResult.data as readonly RawAutomationRuleRow[] | null) ?? null,
      credential: (credentialResult.data as RawCredentialRow | null) ?? null,
    })

    return { ok: true, state }
  } catch {
    return { ok: false, code: 'internal_error' }
  }
}
