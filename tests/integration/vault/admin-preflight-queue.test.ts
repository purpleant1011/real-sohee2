import { beforeAll, describe, expect, it, vi } from 'vitest'
import { pgClient, query } from './pg-client'
import { loadPreflightQueue, recordOperatorAction } from '../../../src/features/admin/preflight-queue/service'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/admin', () => ({ createAdminSupabaseClient: vi.fn() }))
import { createPreflightQueueGateway } from '../../../src/features/admin/preflight-queue/repository'

// ANI-1563 전용 UUID 접두 15630000-
const user = '15630000-0000-4000-8000-0000000000a1'
const ws = '15630000-0000-4000-8000-0000000000b1'
const content = '15630000-0000-4000-8000-0000000000c1'
const version = '15630000-0000-4000-8000-0000000000d1'
const itemId = (n: number) => `15630000-0000-4000-8000-0000000001${String(n).padStart(2, '0')}`
const codes = ['FINGERPRINT', 'CONTENT_EXPIRY', 'HOLD_AGE', 'IMAGE_RIGHTS', 'CONNECTION', 'ACCOUNT', 'POLICY']
const expectedGroups = ['FINGERPRINT_MISMATCH', 'CONTENT_EXPIRED', 'HOLD_OVER_14D', 'RIGHTS_QC_EXPIRED', 'CONNECTION_LOST', 'ACCOUNT_CHANGED', 'POLICY_CHANGED']
const gateway = createPreflightQueueGateway(pgClient() as never)
const itemSnapshot = () => JSON.stringify(query(`select * from public.vault_items where workspace_id='${ws}' order by id`))

beforeAll(() => {
  query(`with u as (insert into auth.users(id) values ('${user}') returning id) select id from u`)
  query(`with w as (insert into workspaces(id,name,created_by) values ('${ws}','재검사 큐 서비스','${user}') returning id) select id from w`)
  query(`with c as (insert into content_items(id,workspace_id,channel,title,created_by) values ('${content}','${ws}','threads','큐 콘텐츠','${user}') returning id) select id from c`)
  query(`with v as (insert into content_versions(id,workspace_id,content_id,version_number,caption,fingerprint,created_by) values ('${version}','${ws}','${content}',1,'큐 원고','${'a'.repeat(64)}','${user}') returning id) select id from v`)
  codes.forEach((code, i) => {
    query(`with i as (insert into vault_items(id,workspace_id,content_id,version_id,channel,release_gate,hold_reason,held_at,policy_version,spec_version,approval_state,approved_fingerprint,fingerprint_schema_version,idempotency_key)
      values ('${itemId(i + 1)}','${ws}','${content}','${version}','threads','HELD_USER','USER_HELD',now(),'v1','v1','APPROVED','${'b'.repeat(64)}',3,'ani1563-${i}') returning id) select id from i`)
    const items = JSON.stringify([{ code, status: 'FAIL', message: `${code} 사유`, action: '조치' }]).replaceAll("'", "''")
    query(`with r as (insert into preflight_runs(workspace_id,vault_item_id,overall,items,run_at) values ('${ws}','${itemId(i + 1)}','FAIL','${items}'::jsonb, now() - interval '1 hour') returning id) select id from r`)
  })
})

describe('ANI-1563 admin preflight queue on a real PostgreSQL', () => {
  it('classifies the seven FAIL fixtures into their reason groups', async () => {
    const result = await loadPreflightQueue(gateway)
    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    expect(result.groups.map(g => g.group)).toEqual(expectedGroups)
    expect(result.groups.every(g => g.count === 1)).toBe(true)
    expect(result.trend.reduce((n, d) => n + d.counts.POLICY_CHANGED, 0)).toBe(1)
  })

  it('records operator actions as append-only events and leaves vault_items untouched', async () => {
    const before = itemSnapshot()
    for (const [kind, id] of [['request_reconfirm', 1], ['add_memo', 2], ['keep_hold', 3]] as const) {
      expect(await recordOperatorAction(gateway, user, { kind, workspaceId: ws, vaultItemId: itemId(id), note: `${kind} 메모` })).toEqual({ ok: true })
    }
    expect(itemSnapshot()).toBe(before)
    const events = query<{ event_type: string; actor_id: string; payload: { note: string; source: string } }>(`select event_type,actor_id,payload from public.vault_events where workspace_id='${ws}' order by occurred_at`)
    expect(events.map(e => e.event_type)).toEqual(['operator.reconfirm_requested', 'operator.memo_added', 'operator.hold_kept'])
    expect(events.every(e => e.actor_id === user && e.payload.source === 'admin_preflight_queue')).toBe(true)
    expect(query<{ n: number }>(`select count(*)::int as n from public.external_action_requests where workspace_id='${ws}'`)[0].n).toBe(0)
    const view = await loadPreflightQueue(gateway)
    expect(view.status === 'ok' && view.groups[0].entries[0].handling).toBe('재확인 요청 기록됨')
    expect(() => query(`update public.vault_events set event_type='x' where workspace_id='${ws}'`)).toThrow()
  })

  it('never writes approval state even for an item outside the queue (rejected, no event)', async () => {
    const before = itemSnapshot()
    const events = query<{ n: number }>(`select count(*)::int as n from public.vault_events where workspace_id='${ws}'`)[0].n
    expect(await recordOperatorAction(gateway, user, { kind: 'keep_hold', workspaceId: ws, vaultItemId: '15630000-0000-4000-8000-0000000001ff', note: '' })).toMatchObject({ ok: false })
    expect(itemSnapshot()).toBe(before)
    expect(query<{ n: number }>(`select count(*)::int as n from public.vault_events where workspace_id='${ws}'`)[0].n).toBe(events)
  })

  it('reports a read failure as an error, not as an empty queue', async () => {
    const broken = createPreflightQueueGateway({ from: () => ({ select: () => ({ order: () => ({ limit: async () => ({ data: null, error: { message: 'down' } }) }) }) }) })
    expect((await loadPreflightQueue(broken)).status).toBe('error')
  })
})
