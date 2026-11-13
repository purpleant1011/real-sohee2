import { spawnSync } from 'node:child_process'
import { beforeAll, describe, expect, it } from 'vitest'
import { pgClient, query, literal } from './pg-client'
import { applyVaultEdit } from '../../../src/features/vault/edit'
import { SupabaseVaultEditRepository } from '../../../src/features/vault/edit/repository'
import { ensureQuickPostVaultVersions, getQuickPostApprovalOptions } from '../../../src/features/quick-start/quick-post-vault-contract'
import { readQuickPostApprovalReadiness } from '../../../src/features/quick-start/quick-post-approval-readiness'
import { saveToVault } from '../../../src/features/vault/service/save'
import { SupabaseVaultSaveRepository } from '../../../src/features/vault/model/supabase-save-repository'

const ws = 'fa111111-1111-4111-8111-111111111111'
const user = 'f9999999-9999-4999-8999-999999999999'
const mission = 'f3333333-3333-4333-8333-333333333333'
const media = 'f4444444-4444-4444-8444-444444444444'
const client = pgClient()
function localPsql(input: string) {
  if (!process.env.PGHOST?.includes('sohee-vault-db-')) throw new Error('Owned isolated PostgreSQL required')
  const result = spawnSync(`${process.env.PG16_BIN || '/opt/homebrew/opt/postgresql@16/bin'}/psql`, ['-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-d', process.env.PGDATABASE!], { input, encoding: 'utf8' })
  if (result.status) throw new Error(result.stderr)
  return result.stdout
}
beforeAll(() => {
  // Match the existing edit-version DB harness: auth.role() honours this test request's claim.
  localPsql(`create or replace function auth.role() returns text language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'authenticated') $$; grant usage on schema auth to service_role;`)
})

describe('quick post zero-channel approval options on isolated PostgreSQL', () => {
  it('materializes canonical versions, offers vault only, saves one row and no external action', async () => {
    query(`with u as (insert into auth.users(id) values ('${user}') returning id) select id from u`)
    query(`with w as (insert into workspaces(id,name,created_by) values ('${ws}', '매장', '${user}') returning id) select id from w`)
    query(`with a as (insert into media_assets(id,workspace_id,bucket_id,object_path,kind,mime_type,size_bytes,rights_status,created_by,sha256_digest) values ('${media}','${ws}','content-media','test/quick.png','content','image/png',1000,'confirmed','${user}','${'a'.repeat(64)}') returning id) select id from a`)
    const metadata = { lane: 'QUICK_POST', quick: { revision: 1, topic: '첫 인사', createdBy: user }, payload: { copies: { instagram: { caption: '인스타 소개', hashtags: [] }, threads: { content: '스레드 소개' } }, imageIds: [media], channels: [] } }
    query(`with m as (insert into marketing_missions(id,workspace_id,trace_id,status,goal,metadata) values ('${mission}','${ws}','test','AWAITING_APPROVAL','첫 인사','${JSON.stringify(metadata)}'::jsonb) returning id) select id from m`)
    const draftClient = { from(table: string) {
      const builder = pgClient().from(table)
      if (table !== 'content_versions') return builder
      return { ...builder, upsert(row: Record<string, unknown>, options: { onConflict: string; ignoreDuplicates: boolean }) {
        return builder.upsert({ ...row, hashtags: '{}' }, options)
      } }
    } } as any
    const first = await ensureQuickPostVaultVersions(draftClient, ws, user, mission)
    expect(first.revision).toBe(1)
    await ensureQuickPostVaultVersions(draftClient, ws, user, mission)
    expect(query<{ n: number }>(`select count(*)::int as n from content_versions where workspace_id='${ws}'`)[0].n).toBe(2)
    const readiness = await readQuickPostApprovalReadiness(client, ws)
    const options = await getQuickPostApprovalOptions(client, ws, mission, readiness)
    const threads = options.targets.find(t => t.channel === 'threads')!
    expect(threads.actions.VAULT.allowed).toBe(true)
    expect(threads.actions.PUBLISH).toEqual({ allowed: false, message: '채널을 연결하면 발행할 수 있어요' })
    expect(options.targets.find(t => t.channel === 'instagram')?.actions.VAULT.allowed).toBe(false)
    const result = await saveToVault({ workspaceId: ws, actorId: user, contentId: threads.contentId, versionId: threads.versionId, channels: ['threads'], targetDate: null, idempotencyKey: 'quick-post-approval' }, { repository: new SupabaseVaultSaveRepository(client as never) })
    expect(result.saved).toHaveLength(1)
    expect(result.external_posts).toBe(0)
    expect(query<{ n: number }>(`select count(*)::int as n from vault_items where workspace_id='${ws}'`)[0].n).toBe(1)
    expect(query<{ n: number }>(`select count(*)::int as n from external_action_requests where workspace_id='${ws}'`)[0].n).toBe(0)
    // Follow the existing mission -> canonical content/version -> vault mapping.
    // This is not a claim that a marketing_mission id is a vault_item id.
    const stored = () => query<{ id: string; content_id: string; version_id: string; updated_at: string; deleted_at: string | null }>(`select id,content_id,version_id,updated_at,deleted_at from vault_items where workspace_id='${ws}'`)[0]
    expect(stored()).toMatchObject({ content_id: threads.contentId, version_id: threads.versionId, deleted_at: null })
    const editClient = {
      ...client,
      async rpc(name: string, args: { p_workspace_id: string; p_mutations: unknown[] }) {
        expect(name).toBe('vault_apply_edits')
        const output = localPsql(`begin; set local role service_role; select set_config('request.jwt.claim.role','service_role',true); select coalesce(public.vault_apply_edits(${literal(args.p_workspace_id)}::uuid,${literal(args.p_mutations)}::jsonb)::text,'null'); commit;`)
        const encoded = output.trim().split('\n').find(line => line.startsWith('{') || line === 'null')
        return { data: encoded ? JSON.parse(encoded) : null, error: null }
      },
    }
    const edits = new SupabaseVaultEditRepository(editClient as never)
    const itemRef = Buffer.from(stored().id.replaceAll('-', ''), 'hex').toString('base64url')
    const run = (operation: 'edit' | 'delete' | 'restore') => applyVaultEdit(edits, {
      workspaceId: ws, actorId: user, actorRole: 'owner', itemRef, operation,
      expectedVersion: stored().updated_at, now: new Date(),
      ...(operation === 'edit' ? { changes: { text: '실제 DB에서 수정한 보관 본문' } } : {}),
    })
    await run('edit')
    expect(query<{ payload: { text: string } }>(`select payload from vault_variant_payloads where vault_item_id='${stored().id}'`)[0].payload.text).toBe('실제 DB에서 수정한 보관 본문')
    expect(query<{ approval_state: string }>(`select approval_state from vault_items where id='${stored().id}'`)[0].approval_state).toBe('INVALIDATED')
    await run('delete')
    expect(stored().deleted_at).not.toBeNull()
    expect(query<{ n: number }>(`select count(*)::int as n from marketing_missions where id='${mission}'`)[0].n).toBe(1)
    await run('restore')
    expect(stored()).toMatchObject({ content_id: threads.contentId, version_id: threads.versionId, deleted_at: null })
    expect(query<{ n: number }>(`select count(*)::int as n from vault_events where vault_item_id='${stored().id}' and event_type in ('approval_invalidated','vault.deleted','vault.restored')`)[0].n).toBe(3)
    expect(query<{ n: number }>(`select count(*)::int as n from external_action_requests where workspace_id='${ws}'`)[0].n).toBe(0)
    await expect(getQuickPostApprovalOptions(client, 'b1111111-1111-4111-8111-111111111111', mission, readiness)).rejects.toMatchObject({ status: 404 })
  })
})
