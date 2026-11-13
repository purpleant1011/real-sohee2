import 'server-only'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import type { AudienceInput, GrantInput, GrantResult, PreviewResult, Campaign } from './bulk-grant-schemas'

// Generated database types lag unapplied migrations. Keep the untyped boundary here,
// not in routes or client components; update generated types after operator applies migration.
function bulkGrantDb() {
  return createAdminSupabaseClient() as unknown as {
    rpc(name: string, args: Record<string, string | number | null>): Promise<{ data: unknown; error: { message: string } | null }>
    from(table: string): { select(columns: string): { order(column: string, options: { ascending: boolean }): { limit(n: number): Promise<{ data: unknown; error: unknown }> } } }
  }
}

export async function previewBulkGrant(input: AudienceInput): Promise<PreviewResult> {
  const { data, error } = await bulkGrantDb().rpc('preview_bulk_credit_grant', {
    p_audience: input.audience, p_recent_days: input.recentDays ?? null,
  })
  if (error || !data || typeof data !== 'object' || !('target_count' in data)) throw new Error('대상 확인에 실패했어요. 다시 시도해 주세요.')
  return data as unknown as PreviewResult
}

export async function grantBulkCredits(operatorId: string, input: GrantInput): Promise<GrantResult> {
  const { data, error } = await bulkGrantDb().rpc('grant_bulk_credits', {
    p_operator_id: operatorId, p_audience: input.audience, p_recent_days: input.recentDays ?? null,
    p_amount: input.amount, p_reason: input.reason, p_idempotency_key: input.idempotencyKey,
  })
  if (error || !data || typeof data !== 'object' || !('campaign_id' in data)) {
    if (error?.message?.includes('BULK_GRANT_NO_TARGETS')) throw new Error('지급할 고객사가 없어요. 대상을 다시 확인해 주세요.')
    if (error?.message?.includes('BULK_GRANT_KEY_CONFLICT')) throw new Error('이미 다른 지급에 사용한 요청입니다. 화면을 새로고침해 주세요.')
    throw new Error('지급을 완료하지 못했어요. 같은 화면에서 다시 시도해 주세요.')
  }
  return data as unknown as GrantResult
}

export async function listBulkGrantCampaigns(): Promise<Campaign[]> {
  const { data, error } = await bulkGrantDb().from('credit_grant_campaigns')
    .select('id, created_at, audience, recent_days, amount_per_workspace, granted_count, skipped_count, reason')
    .order('created_at', { ascending: false }).limit(10)
  if (error || !Array.isArray(data)) throw new Error('이전 지급 내역을 불러오지 못했어요.')
  return data as Campaign[]
}
