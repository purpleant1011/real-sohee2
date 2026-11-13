import 'server-only'

import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import type { PreflightQueueGateway } from './service'

type Db = { from(table: string): any }
const EVENT_TYPES = ['operator.reconfirm_requested', 'operator.memo_added', 'operator.hold_kept']
const COLUMNS = 'id,workspace_id,vault_item_id,run_at,overall,items'

/** service-role 클라이언트는 서버에서만, 운영자 권한 확인 뒤에 만든다. vault_items 테이블에는 접근하지 않는다. */
export function createPreflightQueueGateway(client?: Db): PreflightQueueGateway {
  const db = (): Db => client ?? (createAdminSupabaseClient() as unknown as Db)
  return {
    async readRuns(sinceIso) {
      const r = await db().from('preflight_runs').select(COLUMNS).order('run_at', { ascending: false }).limit(5000)
      if (r.error || !Array.isArray(r.data)) throw new Error('RUNS_UNAVAILABLE')
      const since = Date.parse(sinceIso)
      return r.data.filter((row: { run_at: string }) => Date.parse(row.run_at) >= since)
    },
    async readLatestRun(workspaceId, vaultItemId) {
      const r = await db().from('preflight_runs').select(COLUMNS)
        .eq('workspace_id', workspaceId).eq('vault_item_id', vaultItemId).order('run_at', { ascending: false }).limit(1)
      if (r.error || !Array.isArray(r.data)) throw new Error('RUN_UNAVAILABLE')
      return r.data[0] ?? null
    },
    async readOperatorEvents(ids) {
      const r = await db().from('vault_events').select('vault_item_id,event_type,payload,occurred_at').in('vault_item_id', [...ids]).in('event_type', EVENT_TYPES)
      if (r.error || !Array.isArray(r.data)) throw new Error('EVENTS_UNAVAILABLE')
      return r.data
    },
    async appendEvent(event) {
      const r = await db().from('vault_events').insert({
        workspace_id: event.workspaceId, vault_item_id: event.vaultItemId, actor_id: event.actorId, event_type: event.eventType, payload: event.payload,
      })
      if (r.error) throw new Error('EVENT_NOT_RECORDED')
    },
  }
}
