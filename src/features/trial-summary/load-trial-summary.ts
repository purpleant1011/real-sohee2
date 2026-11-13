import 'server-only'

import { createServerSupabaseClient } from '@/lib/supabase/server'
import { SupabaseVaultQueryRepository, VaultQueryService } from '@/features/vault/query/vault-query-service'
import { TRIAL_END_POLICY } from './config'
import { extractPublishedLinks, type ReceiptRow } from './published-links'
import { buildTrialSummary, type Loaded, type TrialSummaryModel } from './summary-model'

async function attempt<T>(run: () => PromiseLike<T>): Promise<Loaded<T>> {
  try { return { status: 'ok', value: await run() } } catch { return { status: 'error' } }
}

/** 조회만 한다. 외부 호출·쓰기 없음. 구역별로 실패를 분리해 빈 값으로 보이지 않게 한다. */
export async function loadTrialSummary(workspaceId: string, now = new Date()): Promise<TrialSummaryModel> {
  const supabase = (await createServerSupabaseClient()) as any

  const [posts, vault, links, ends] = await Promise.all([
    attempt(async () => {
      const { count, error } = await supabase.from('content_items')
        .select('*', { count: 'exact', head: true }).eq('workspace_id', workspaceId)
      if (error || count === null) throw new Error('posts')
      return count as number
    }),
    attempt(async () => {
      const summary = await new VaultQueryService(new SupabaseVaultQueryRepository(supabase)).getSummary(workspaceId)
      return {
        stored: summary.stored_count,
        needsReapproval: summary.needs_reapproval_count,
        externalActions: summary.external_action_count,
      }
    }),
    attempt(async () => {
      const { data, error } = await supabase.from('external_action_receipts')
        .select('*').eq('workspace_id', workspaceId).order('created_at', { ascending: false }).limit(20)
      if (error || !Array.isArray(data)) throw new Error('links')
      return extractPublishedLinks(data as ReceiptRow[])
    }),
    attempt(async () => {
      const { data, error } = await supabase.from('trial_entitlements')
        .select('ends_at').eq('workspace_id', workspaceId).maybeSingle()
      if (error) throw new Error('entitlement')
      return (data?.ends_at as string | undefined) ?? null
    }),
  ])

  return buildTrialSummary({
    now,
    endsAt: ends.status === 'ok' ? ends.value : null,
    posts, vault, links,
    policy: TRIAL_END_POLICY,
  })
}
