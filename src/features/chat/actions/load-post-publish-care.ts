'use server'

import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import {
  loadPostPublishCareInputSchema,
  mapPostPublishCareState,
  type PostPublishCareResult,
  type RawAutomationRuleRow,
  type RawCredentialRow,
  type RawEngagementPolicyRow,
} from './post-publish-care-helpers'

export async function loadPostPublishCare(input: unknown): Promise<PostPublishCareResult> {
  const parsed = loadPostPublishCareInputSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, code: 'invalid_input' }
  }

  try {
    const supabase = await createServerSupabaseClient()
    const { data: userData, error: userError } = await supabase.auth.getUser()
    const userId = userData?.user?.id
    if (userError || typeof userId !== 'string') {
      return { ok: false, code: 'unauthenticated' }
    }

    const { data: membership, error: membershipError } = await supabase
      .from('workspace_members')
      .select('workspace_id, role, status')
      .eq('workspace_id', parsed.data.workspaceId)
      .eq('user_id', userId)
      .maybeSingle()

    if (membershipError || !membership || membership.status !== 'active') {
      return { ok: false, code: 'forbidden' }
    }

    const admin = createAdminSupabaseClient()

    const [policyResult, rulesResult, credentialResult] = await Promise.all([
      admin
        .from('engagement_policies')
        .select('is_paused, auto_reply_enabled, autonomy_level')
        .eq('workspace_id', parsed.data.workspaceId)
        .eq('channel', parsed.data.channel)
        .maybeSingle(),
      admin
        .from('automation_rules')
        .select('kind, active')
        .eq('workspace_id', parsed.data.workspaceId)
        .eq('kind', 'daily_performance_report'),
      admin
        .from('meta_channel_credentials')
        .select('status, granted_scopes')
        .eq('workspace_id', parsed.data.workspaceId)
        .eq('provider', parsed.data.channel)
        .maybeSingle(),
    ])

    const state = mapPostPublishCareState({
      workspaceId: parsed.data.workspaceId,
      channel: parsed.data.channel,
      policy: (policyResult.data as RawEngagementPolicyRow | null) ?? null,
      rules: (rulesResult.data as readonly RawAutomationRuleRow[] | null) ?? null,
      credential: (credentialResult.data as RawCredentialRow | null) ?? null,
    })

    return { ok: true, state }
  } catch {
    return { ok: false, code: 'internal_error' }
  }
}
