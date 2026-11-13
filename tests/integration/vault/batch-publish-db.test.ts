import { beforeAll, describe, expect, it } from 'vitest'
import { SupabaseVaultSaveRepository } from '../../../src/features/vault/model/supabase-save-repository'
import { saveToVault } from '../../../src/features/vault/service/save'
import { createBatchPublishDependencies } from '../../../src/features/vault/publish/pg-dependencies'
import type { VaultItem } from '../../../src/features/vault/types'
import { pgClient, query } from './pg-client'

const user = 'b1111111-1111-4111-8111-111111111111'
const ws = 'b2111111-1111-4111-8111-111111111111'
const content = 'b3111111-1111-4111-8111-111111111111'
const version = 'b4111111-1111-4111-8111-111111111111'
const db = pgClient()
const deps = createBatchPublishDependencies(db)
const row = () => query<Record<string, unknown>>(`select release_gate, hold_reason, held_at, held_by from public.vault_items where workspace_id='${ws}'`)[0]
const request = () => query(`with changed as (update public.vault_items set release_gate='RELEASE_REQUESTED', hold_reason='RELEASE_REQUESTED', held_at=now(), held_by='${user}' where workspace_id='${ws}' returning id) select id from changed`)
let item: VaultItem

beforeAll(async () => {
  query(`with users as (insert into auth.users (id) values ('${user}') returning id) select id from users`)
  query(`with w as (insert into public.workspaces (id,name,created_by) values ('${ws}','발행 서비스','${user}') returning id) select id from w`)
  query(`with c as (insert into public.content_items (id,workspace_id,channel,title,created_by) values ('${content}','${ws}','threads','서비스 소식','${user}') returning id) select id from c`)
  query(`with v as (insert into public.content_versions (id,workspace_id,content_id,version_number,caption,fingerprint,created_by) values ('${version}','${ws}','${content}',1,'사장님의 새로운 소식을 알려드립니다.','${'c'.repeat(64)}','${user}') returning id) select id from v`)
  await saveToVault({ workspaceId: ws, actorId: user, contentId: content, versionId: version, channels: ['threads'], targetDate: '2026-10-05', idempotencyKey: 'batch-publish-db' }, { repository: new SupabaseVaultSaveRepository(db as never) })
  request()
  const [saved] = await deps.listItems(ws)
  item = saved
})

describe('PostgreSQL 16 batch publish adapters', () => {
  it('lists, claims once, holds, and completes within the vault_items hold CHECK', async () => {
    expect(item?.releaseGate).toBe('RELEASE_REQUESTED')
    expect(await deps.claim(ws, item.id)).toBe(true)
    expect(await deps.claim(ws, item.id)).toBe(false)
    expect(row()).toMatchObject({ release_gate: 'HELD_USER', hold_reason: 'USER_HELD' })
    await deps.hold(ws, item.id, 'CHANNEL_NOT_CONNECTED', 'HELD_CONNECTION_PENDING')
    expect(row()).toMatchObject({ release_gate: 'HELD_CONNECTION_PENDING', hold_reason: 'CHANNEL_NOT_CONNECTED' })
    request()
    expect(await deps.claim(ws, item.id)).toBe(true)
    await deps.complete(ws, item.id)
    expect(row()).toEqual({ release_gate: null, hold_reason: null, held_at: null, held_by: null })
  })

  it('records the published address and audit event without any external action row', async () => {
    await deps.recordPublished(item, user, 'https://www.threads.net/@store/post/abc')
    expect(query(`select 1 from public.vault_published_urls where workspace_id='${ws}' and vault_item_id='${item.id}'`)).toHaveLength(1)
    expect(query(`select 1 from public.vault_events where workspace_id='${ws}' and event_type='vault.published'`)).toHaveLength(1)
    expect(query(`select 1 from public.external_action_requests where workspace_id='${ws}'`)).toHaveLength(0)
  })
})
