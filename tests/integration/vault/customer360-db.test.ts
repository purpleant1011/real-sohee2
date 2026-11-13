import { beforeAll, describe, expect, it } from 'vitest'
import { readCustomer360 } from '../../../src/features/admin/customer360/service'
import { buildCustomer360Timeline } from '../../../src/features/admin/customer360/timeline'
import { pgClient, query } from './pg-client'

// ANI-1558: unique UUID prefix c3601...
const user = 'c3601001-0000-4000-8000-000000000001'
const user2 = 'c3601001-0000-4000-8000-000000000002'
const op = 'c3601001-0000-4000-8000-0000000000aa'
const ws = 'c3601002-0000-4000-8000-000000000001'
const other = 'c3601002-0000-4000-8000-000000000002'
const content = 'c3601003-0000-4000-8000-000000000001'
const version = 'c3601004-0000-4000-8000-000000000001'
const item = 'c3601005-0000-4000-8000-000000000001'
const otherContent = 'c3601003-0000-4000-8000-000000000002'
const otherVersion = 'c3601004-0000-4000-8000-000000000002'
const otherItem = 'c3601005-0000-4000-8000-000000000002'
const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.c2lnbmF0dXJl'
const real = pgClient()
// The audit writer calls .single(); the raw-psql builder only has maybeSingle().
const db = { from(table: string) { const b: any = real.from(table); if (table === 'audit_events') b.single = () => b.maybeSingle(); return b } }
const run = (sql: string) => query(`with w as (${sql} returning 1) select count(*) from w`)

beforeAll(() => {
  run(`insert into auth.users (id) values ('${user}'), ('${user2}'), ('${op}')`)
  run(`insert into public.workspaces (id,name,created_by,created_at) values ('${ws}','가','${user}','2026-10-01T00:00:00Z'), ('${other}','나','${user2}','2026-10-01T00:00:01Z')`)
  run(`insert into public.content_items (id,workspace_id,channel,title,created_by,created_at) values ('${content}','${ws}','threads','소식','${user}','2026-10-01T12:00:00Z'), ('${otherContent}','${other}','threads','남의 소식','${user2}','2026-10-01T12:00:00Z')`)
  run(`insert into public.content_versions (id,workspace_id,content_id,version_number,caption,fingerprint,created_by) values ('${version}','${ws}','${content}',1,'본문','${'a'.repeat(64)}','${user}'), ('${otherVersion}','${other}','${otherContent}',1,'본문','${'b'.repeat(64)}','${user2}')`)
  run(`insert into public.vault_items (id,workspace_id,content_id,version_id,channel,policy_version,spec_version,idempotency_key) values ('${item}','${ws}','${content}','${version}','threads','p1','s1','c360-a'), ('${otherItem}','${other}','${otherContent}','${otherVersion}','threads','p1','s1','c360-b')`)
  run(`insert into public.vault_events (id,workspace_id,vault_item_id,event_type,payload,occurred_at) values
    ('c3601006-0000-4000-8000-000000000001','${ws}','${item}','vault.saved','{"access_token":"tok-live-1","note":"Bearer ${JWT}"}','2026-10-02T00:00:00Z'),
    ('c3601006-0000-4000-8000-000000000002','${other}','${otherItem}','vault.saved','{"secret":"OTHER_SECRET"}','2026-10-02T00:00:00Z')`)
  run(`insert into public.preflight_runs (id,workspace_id,vault_item_id,run_at,overall,items) values
    ('c3601007-0000-4000-8000-000000000001','${ws}','${item}','2026-10-03T00:00:00Z','FAIL','[{"code":"IMAGE_RIGHTS","status":"FAIL","message":"이미지 사용권이 만료되었습니다","action":null}]'),
    ('c3601007-0000-4000-8000-000000000002','${other}','${otherItem}','2026-10-03T00:00:00Z','FAIL','[{"status":"FAIL","message":"OTHER_REASON"}]')`)
})

describe('ANI-1558 Customer 360 timeline (real PostgreSQL)', () => {
  it('shows signup -> vault -> failed preflight in order with the reason, and only this workspace', async () => {
    const t = await buildCustomer360Timeline(db, ws)
    // The workspace-creation grant (credit ledger, written at insert time) is a real event and sorts last.
    expect(t.events.map(e => e.canonicalId.replace(/^(credit_ledger_entry):.*/, '$1'))).toEqual([
      `workspace:${ws}`, `content:${content}`, 'vault_event:c3601006-0000-4000-8000-000000000001', 'preflight_run:c3601007-0000-4000-8000-000000000001', 'credit_ledger_entry',
    ])
    const pre = t.events.find(e => e.kind === 'preflight')!
    expect(pre).toMatchObject({ outcome: 'fail' })
    expect(pre.detail).toContain('이미지 사용권이 만료되었습니다')
    expect(t.sources.filter(s => s.status === 'error')).toEqual([])
    const text = JSON.stringify(t)
    for (const foreign of [other, otherItem, otherContent, 'OTHER_SECRET', 'OTHER_REASON', 'c3601006-0000-4000-8000-000000000002']) expect(text).not.toContain(foreign)
    expect(t.chains[0].verdict).toContain('재검사 실패')
  })

  it('leaks no token or secret value', async () => {
    const text = JSON.stringify(await buildCustomer360Timeline(db, ws))
    for (const leak of ['tok-live-1', JWT, 'access_token":"']) expect(text).not.toContain(leak)
    expect(text).not.toMatch(/eyJ[A-Za-z0-9_-]{5,}\./)
  })

  it('records the admin view in the audit trail for this workspace only', async () => {
    await readCustomer360(db, { workspaceId: ws, operatorId: op, traceId: 'c360-trace' })
    const rows = query<{ workspace_id: string; event_type: string; actor_id: string }>(`select workspace_id,event_type,actor_id from public.audit_events where event_type='admin.customer360.viewed' and actor_id='${op}'`)
    expect(rows).toEqual([{ workspace_id: ws, event_type: 'admin.customer360.viewed', actor_id: op }])
  })

  it('reports a failed source as an error, not as an empty timeline', async () => {
    const broken = { from: (t: string) => (t === 'preflight_runs' ? real.from('no_such_table') : real.from(t)) }
    const t = await buildCustomer360Timeline(broken, ws)
    expect(t.sources.find(s => s.source === 'preflight')).toMatchObject({ status: 'error' })
    expect(t.sources.find(s => s.source === 'vault')).toMatchObject({ status: 'ok', count: 1 })
  })
})
