import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  selectInstagramGenerationContext,
  type InstagramGenerationContext,
} from '@/features/auth/workspace-context'
import type { Database } from '@/lib/supabase/database.types'

export async function loadNaverGenerationContext(
  workspaceId: string,
  admin: SupabaseClient<Database>,
  channel = 'naver_blog',
): Promise<InstagramGenerationContext> {
  const [business, brand, knowledgeSources, harnessRules] = await Promise.all([
    admin
      .from('business_profiles')
      .select('workspace_id, business_name, industry, location, summary')
      .eq('workspace_id', workspaceId)
      .maybeSingle(),
    admin
      .from('brand_profiles')
      .select('workspace_id, voice, keywords, prohibited_terms')
      .eq('workspace_id', workspaceId)
      .maybeSingle(),
    admin
      .from('knowledge_sources')
      .select('workspace_id, channel_type, uri, status, refresh_policy')
      .eq('workspace_id', workspaceId)
      .eq('source_type', 'url')
      .limit(100),
    admin
      .from('harness_rules')
      .select('workspace_id, rule_type, title, description, structured_rule, applies_to_channels, status')
      .eq('workspace_id', workspaceId)
      .eq('status', 'active')
      .eq('rule_type', 'text_generation')
      .contains('applies_to_channels', [channel])
      .limit(20),
  ])

  if (business.error || brand.error || knowledgeSources.error || harnessRules.error) {
    throw new Error('instagram_context_unavailable')
  }

  return selectInstagramGenerationContext({
    workspaceId,
    businessProfile: business.data,
    brandProfile: brand.data,
    knowledgeSources: knowledgeSources.data,
    harnessRules: harnessRules.data,
  })
}
