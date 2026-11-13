import { beforeAll, describe, expect, it } from 'vitest'
import { SupabaseVaultSaveRepository } from '../../../src/features/vault/model/supabase-save-repository'
import { saveToVault } from '../../../src/features/vault/service/save'
import { buildCostValue } from '../../../src/features/admin/cost-value/cost-value'
import { SupabaseCostValueRepository } from '../../../src/features/admin/cost-value/repository'
import { pgClient, query } from './pg-client'

// ANI-1565 fixtures use the c1565 UUID prefix so they cannot collide with other suites.
const user = 'c1565a01-1111-4111-8111-111111111111'
const ws = 'c1565a02-1111-4111-8111-111111111111'
const wsEmpty = 'c1565a05-1111-4111-8111-111111111111'
const content = 'c1565a03-1111-4111-8111-111111111111'
const version = 'c1565a04-1111-4111-8111-111111111111'
const account = 'c1565a06-1111-4111-8111-111111111111'
const db = pgClient()

beforeAll(async () => {
  query(`with u as (insert into auth.users (id) values ('${user}') returning id) select id from u`)
  query(`with w as (insert into public.workspaces (id,name,created_by) values ('${ws}','가치 검증','${user}'),('${wsEmpty}','기록 없음','${user}') returning id) select id from w`)
  query(`with c as (insert into public.content_items (id,workspace_id,channel,title,created_by) values ('${content}','${ws}','threads','가치 소식','${user}') returning id) select id from c`)
  query(`with v as (insert into public.content_versions (id,workspace_id,content_id,version_number,caption,fingerprint,created_by) values ('${version}','${ws}','${content}',1,'사장님의 새로운 소식을 알려드립니다.','${'c'.repeat(64)}','${user}') returning id) select id from v`)
  query(`with a as (insert into public.credit_accounts (id,workspace_id,period_start,period_end) values ('${account}','${ws}',current_date,current_date + 7) returning id) select id from a`)
  query(`with l as (insert into public.credit_ledger_entries (workspace_id,account_id,kind,action,amount,idempotency_key,occurred_at) values
    ('${ws}','${account}','consume','text_generation',100,'c1565-before-1', now() - interval '2 hours'),
    ('${ws}','${account}','consume','image_generation',150,'c1565-before-2', now() - interval '1 hour'),
    ('${ws}','${account}','consume','text_generation',250,'c1565-after', now() + interval '1 day'),
    ('${ws}','${account}','grant',null,600,'c1565-grant', now() - interval '3 hours') returning id) select id from l`)
  await saveToVault({ workspaceId: ws, actorId: user, contentId: content, versionId: version, channels: ['threads'], targetDate: null, idempotencyKey: 'c1565-save' }, { repository: new SupabaseVaultSaveRepository(db as never) })
})

describe('ANI-1565 admin cost value on real PostgreSQL', () => {
  it('matches the ledger and shows no cost number', async () => {
    const result = await buildCostValue(new SupabaseCostValueRepository(db as never))
    if (result.kind !== 'ok') throw new Error('cost value failed')
    const row = result.rows.find((r) => r.workspaceId === ws)!
    const ledger = query<{ n: number }>(`select coalesce(sum(l.amount),0)::int as n from public.credit_ledger_entries l where l.workspace_id='${ws}' and l.kind='consume' and l.occurred_at <= (select min(created_at) from public.vault_items where workspace_id='${ws}' and deleted_at is null)`)[0].n
    expect(ledger).toBe(250)
    expect(row.creditsToFirstValue).toBe(ledger)
    expect(row.reachedFirstValue).toBe(true)
    expect(row.costToFirstValue).toBe('집계 전')
    expect(result.transformTrend).toBe('집계 전')
  })

  it('keeps a workspace with no records as a real zero without a first value', async () => {
    const result = await buildCostValue(new SupabaseCostValueRepository(db as never))
    if (result.kind !== 'ok') throw new Error('cost value failed')
    const row = result.rows.find((r) => r.workspaceId === wsEmpty)!
    expect(row).toMatchObject({ creditsToFirstValue: 0, reachedFirstValue: false, firstValueAt: null, measuredCallCount: 0 })
  })
})
