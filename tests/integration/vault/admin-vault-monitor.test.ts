import { beforeAll, describe, expect, it } from 'vitest'
import { SupabaseVaultSaveRepository } from '../../../src/features/vault/model/supabase-save-repository'
import { saveToVault } from '../../../src/features/vault/service/save'
import { VaultQueryService, SupabaseVaultQueryRepository } from '../../../src/features/vault/query/vault-query-service'
import { buildVaultMonitor } from '../../../src/features/admin/vault-monitor/monitor'
import { SupabaseVaultMonitorRepository } from '../../../src/features/admin/vault-monitor/repository'
import { pgClient, query } from './pg-client'

// ANI-1557 fixtures use the c1557 UUID prefix so they cannot collide with other suites.
const user = 'c1557a01-1111-4111-8111-111111111111'
const ws = 'c1557a02-1111-4111-8111-111111111111'
const content = 'c1557a03-1111-4111-8111-111111111111'
const version = 'c1557a04-1111-4111-8111-111111111111'
const db = pgClient()
const repository = new SupabaseVaultMonitorRepository(db as never)

beforeAll(async () => {
  query(`with u as (insert into auth.users (id) values ('${user}') returning id) select id from u`)
  query(`with w as (insert into public.workspaces (id,name,created_by) values ('${ws}','모니터 검증','${user}') returning id) select id from w`)
  query(`with c as (insert into public.content_items (id,workspace_id,channel,title,created_by) values ('${content}','${ws}','threads','모니터 소식','${user}') returning id) select id from c`)
  query(`with v as (insert into public.content_versions (id,workspace_id,content_id,version_number,caption,fingerprint,created_by) values ('${version}','${ws}','${content}',1,'사장님의 새로운 소식을 알려드립니다.','${'a'.repeat(64)}','${user}') returning id) select id from v`)
  await saveToVault({ workspaceId: ws, actorId: user, contentId: content, versionId: version, channels: ['threads'], targetDate: null, idempotencyKey: 'c1557-save' }, { repository: new SupabaseVaultSaveRepository(db as never) })
})

const mine = async () => {
  const r = await buildVaultMonitor({ repository, actorId: 'c1557-operator' })
  if (r.kind !== 'ok') throw new Error('monitor failed')
  return r
}

describe('ANI-1557 admin vault monitor on real PostgreSQL', () => {
  it('counts a real zero normally, matching the user summary, and writes an immutable view record', async () => {
    const r = await mine()
    const row = r.workspaces.find((w) => w.workspaceId === ws)!
    const summary = await new VaultQueryService(new SupabaseVaultQueryRepository(db)).getSummary(ws)
    expect(row.status).toBe('OK')
    expect(row.storedCount).toBe(summary.stored_count)
    expect(r.violations.filter((v) => v.workspaceId === ws)).toHaveLength(0)
    expect(query<{ n: number }>(`select count(*)::int as n from public.vault_monitor_access_events where actor_id='c1557-operator' and violation_count=${r.violations.length}`)[0].n).toBeGreaterThan(0)
    expect(() => query(`with c as (update public.vault_monitor_access_events set violation_count=9 where actor_id='c1557-operator' returning id) select id from c`)).toThrow()
  })

  it('flags an injected external action with the fingerprint/action id chain and audits the disclosure', async () => {
    query(`with request as (insert into external_action_requests (workspace_id,channel,action_kind,target_external_id,target_label,exact_payload,content_version_id,idempotency_key,created_by) values ('${ws}','threads','news_post','t','t','{}','${version}','c1557-injected','${user}') returning id) select id from request`)
    const r = await mine()
    const violations = r.violations.filter((v) => v.workspaceId === ws)
    expect(violations).toHaveLength(1)
    expect(violations[0].externalActions).toHaveLength(1)
    expect(r.cards.violations.value).toBeGreaterThanOrEqual(1)
    const logged = query<{ n: number }>(`select count(*)::int as n from public.vault_monitor_access_events where access_kind='INVARIANT_DETAIL_VIEW' and '${violations[0].itemId}'::uuid = any(disclosed_item_ids)`)[0].n
    expect(logged).toBe(1)
  })
})
