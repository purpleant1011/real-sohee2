import 'server-only'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import type { AttemptRow, ReceiptRow, ReconcileStore, RequestRow } from './service'

type Result<T> = Promise<{ data: T | null; error: { message: string } | null }>
type Query<T> = PromiseLike<{ data: T | null; error: { message: string } | null }> & {
  eq(column: string, value: unknown): Query<T>
  in(column: string, values: readonly string[]): Query<T>
  order(column: string, options: { ascending: boolean }): Query<T>
  limit(value: number): Query<T>
  maybeSingle(): Result<T>
}
type Gateway = { from(table: string): { select(columns: string): Query<unknown>; insert(row: Record<string, unknown>): Query<unknown> } }
function required<T>(result: { data: T | null; error: { message: string } | null }): T {
  if (result.error || result.data === null) throw new Error('운영 기록 조회 또는 저장에 실패했습니다.')
  return result.data
}

export class SupabaseReconcileStore implements ReconcileStore {
  constructor(private readonly client: Gateway = createAdminSupabaseClient() as unknown as Gateway) {}

  async listRequests(scopes: 'all' | readonly string[]): Promise<RequestRow[]> {
    let statement = this.client.from('external_action_requests')
      .select('id,workspace_id,channel,status,failure_code,created_at,updated_at') as Query<RequestRow[]>
    if (scopes !== 'all') statement = statement.in('workspace_id', scopes)
    return required(await statement.order('created_at', { ascending: false }).limit(200))
  }
  async listAttempts(workspaceIds: readonly string[], requestIds: readonly string[]): Promise<AttemptRow[]> {
    return required(await (this.client.from('external_action_attempts')
      .select('id,action_request_id,workspace_id,status,provider_request_id,provider_reference,started_at,finished_at') as Query<AttemptRow[]>)
      .in('workspace_id', workspaceIds).in('action_request_id', requestIds).limit(1000))
  }
  async listReceipts(workspaceIds: readonly string[], requestIds: readonly string[]): Promise<ReceiptRow[]> {
    return required(await (this.client.from('external_action_receipts')
      .select('id,action_request_id,workspace_id,receipt_kind,provider_reference,result_url,observed_payload,recorded_at') as Query<ReceiptRow[]>)
      .in('workspace_id', workspaceIds).in('action_request_id', requestIds).limit(1000))
  }
  async loadRequest(workspaceId: string, requestId: string): Promise<RequestRow | null> {
    const result = await (this.client.from('external_action_requests')
      .select('id,workspace_id,channel,status,failure_code,created_at,updated_at') as Query<RequestRow>)
      .eq('workspace_id', workspaceId).eq('id', requestId).maybeSingle()
    if (result.error) throw new Error('운영 기록 조회에 실패했습니다.')
    return result.data
  }
  async loadProviderReference(workspaceId: string, requestId: string): Promise<string | null> {
    const result = await (this.client.from('external_action_attempts')
      .select('provider_reference') as Query<Pick<AttemptRow, 'provider_reference'>[]>)
      .eq('workspace_id', workspaceId).eq('action_request_id', requestId)
      .order('started_at', { ascending: false }).limit(1)
    return required(result)[0]?.provider_reference ?? null
  }
  async appendAudit(record: Parameters<ReconcileStore['appendAudit']>[0]): Promise<void> {
    required(await this.client.from('audit_events').insert(record))
  }
}
