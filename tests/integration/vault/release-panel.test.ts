import { beforeAll, describe, expect, it } from 'vitest'
import { pgClient, query, literal } from './pg-client'
import { saveToVault } from '../../../src/features/vault/service/save'
import { SupabaseVaultSaveRepository } from '../../../src/features/vault/model/supabase-save-repository'
import { createReleaseDependencies } from '../../../src/features/vault/ui/release-panel/pg-dependencies'
import { preflightRelease, releaseRef, requestRelease, releaseStatus } from '../../../src/features/vault/ui/release-panel/release-service'

const ws = 'aa111111-1111-4111-8111-111111111111'
const user = 'aa222222-2222-4222-8222-222222222222'
const content = 'aa333333-3333-4333-8333-333333333333'
const version = 'aa444444-4444-4444-8444-444444444444'
const db = pgClient()
const base = () => createReleaseDependencies(db, db)
const deps = () => ({ ...base(), readiness: async () => 'PUBLISH_READY' as const })
const count = () => query<{ n: number }>(`select (select count(*) from external_action_requests where workspace_id='${ws}') + (select count(*) from external_action_attempts where workspace_id='${ws}') + (select count(*) from external_action_receipts where workspace_id='${ws}') as n`)[0].n
beforeAll(async () => {
  query(`with u as (insert into auth.users(id) values ('${user}') returning id) select id from u`)
  query(`with w as (insert into workspaces(id,name,created_by) values ('${ws}','발행 검증','${user}') returning id) select id from w`)
  query(`with c as (insert into content_items(id,workspace_id,channel,title,created_by) values ('${content}','${ws}','threads','발행 검증 글','${user}') returning id) select id from c`)
  query(`with v as (insert into content_versions(id,workspace_id,content_id,version_number,caption,fingerprint,created_by) values ('${version}','${ws}','${content}',1,'안전한 게시 글입니다.','${'b'.repeat(64)}','${user}') returning id) select id from v`)
  query(`with c as (insert into channel_connections(workspace_id,channel,status,external_account_id) values ('${ws}','threads','connected','release-panel-account') returning id) select id from c`)
  const connectionId = query<{ id: string }>(`select id from channel_connections where workspace_id='${ws}'`)[0].id
  query(`with c as (insert into meta_channel_credentials(workspace_id,channel_connection_id,provider,encrypted_access_token,access_token_iv,granted_scopes,token_expires_at,status) values ('${ws}','${connectionId}','threads','${'x'.repeat(32)}','${'z'.repeat(16)}',array['threads_basic','threads_content_publish'],now() + interval '10 days','active') returning id) select id from c`)
  query(`with r as (insert into channel_verification_runs(workspace_id,channel,verification_code,status,read_after_write_at) values ('${ws}','threads','release-check','VERIFIED',now()) returning id) select id from r`)
  for (const key of ['pass', 'fail']) await saveToVault({ workspaceId: ws, actorId: user, contentId: content, versionId: version, channels: ['threads'], targetDate: null, idempotencyKey: key }, { repository: new SupabaseVaultSaveRepository(db as never) })
})
describe('real PG release transition', () => {
  it('rejects locked channel and writes no external actions', async () => {
    const locked = { ...deps(), readConnectionHealth: async () => ({ connection: 'DISCONNECTED' as const, providerReview: 'APPROVED' as const, accountId: null, tokenExpiresAt: null }) }
    expect((await releaseStatus(ws, locked)).open).toBe(false)
    await expect(preflightRelease(ws, user, locked)).rejects.toThrow('지금은 열 수 없어요')
    const id = query<{ id: string }>(`select id from vault_items where workspace_id='${ws}' limit 1`)[0].id
    await expect(requestRelease(ws, [releaseRef(id)], locked, user)).rejects.toThrow('지금은 열 수 없어요')
    expect(count()).toBe(0)
  })
  it('rechecks persisted evidence and transitions only the passing row without external actions', async () => {
    const id = query<{ id: string }>(`select id from vault_items where workspace_id='${ws}' and idempotency_key <> '' order by id`)
    const passing = id[0].id
    const failing = id[1].id
    const original = query<{ payload: Record<string, unknown> }>(`select payload from vault_variant_payloads where vault_item_id='${failing}'`)[0].payload
    query(`with v as (update vault_variant_payloads set payload=${literal(JSON.stringify({ ...original, title: '변조된 글' }))} where vault_item_id='${failing}' returning id) select id from v`)
    const summary = await preflightRelease(ws, user, deps())
    expect(summary.items.find(row => row.item_ref === releaseRef(failing))?.checks.some(check => check.message === '승인 후 내용이 달라졌어요')).toBe(true)
    expect(summary.items.find(row => row.item_ref === releaseRef(passing))?.can_release).toBe(true)
    const outcome = await requestRelease(ws, [releaseRef(passing), releaseRef(failing)], deps(), user)
    expect(outcome.requested).toBe(1)
    expect(query<{ id: string; release_gate: string }>(`select id, release_gate from vault_items where workspace_id='${ws}' and release_gate='RELEASE_REQUESTED'`)).toEqual([{ id: passing, release_gate: 'RELEASE_REQUESTED' }])
    expect(count()).toBe(0)
  })
})
