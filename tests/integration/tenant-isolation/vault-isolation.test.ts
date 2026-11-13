import { spawnSync } from 'node:child_process'
import { beforeAll, describe, expect, it } from 'vitest'
import { pgClient, query } from '../vault/pg-client'
import { SupabaseVaultSaveRepository } from '../../../src/features/vault/model/supabase-save-repository'
import { saveToVault } from '../../../src/features/vault/service/save'
import { SupabaseVaultQueryRepository, VaultQueryService } from '../../../src/features/vault/query/vault-query-service'
import { SupabaseVaultEditRepository } from '../../../src/features/vault/edit/repository'
import { applyVaultEdit } from '../../../src/features/vault/edit'
import { SupabaseVaultBundleRepository, createSupabaseRenditionReader } from '../../../src/features/vault/bundle/repository'
import { getCopyBundle, registerManualPublishUrl } from '../../../src/features/vault/bundle/service'
import { PgVaultPreflightPorts } from '../../../src/features/vault/preflight/pg-ports'
import { runPreflight } from '../../../src/features/vault/preflight'
import { readRenditions, signRenditionForDisplay } from '../../../src/features/vault/rendition/repository'

const people = [
  { user: 'aa111111-1111-4111-8111-111111111111', ws: 'aa222222-2222-4222-8222-222222222222', content: 'aa333333-3333-4333-8333-333333333333', version: 'aa444444-4444-4444-8444-444444444444', industry: '꽃집' },
  { user: 'bb111111-1111-4111-8111-111111111111', ws: 'bb222222-2222-4222-8222-222222222222', content: 'bb333333-3333-4333-8333-333333333333', version: 'bb444444-4444-4444-8444-444444444444', industry: '한식당' },
] as const
const [a, b] = people
const client = pgClient()
const rows = new Map<string, { id: string; ref: string; rendition: string; path: string }>()
const encode = (id: string) => Buffer.from(id.replaceAll('-', ''), 'hex').toString('base64url')
const count = (table: string, workspace: string) => query<{ n: number }>(`select count(*)::int n from public.${table} where workspace_id='${workspace}'`)[0].n
/** A real authenticated session: SQLSTATE 42501 or zero rows, never a privileged write. */
function asUser(statement: string, userId: string) {
  if (!process.env.PGHOST?.includes('sohee-vault-db-')) throw new Error('Refusing non-isolated PostgreSQL')
  const input = `begin; set local role authenticated; select set_config('request.jwt.claim.sub', '${userId}', true); ${statement}; rollback;`
  const result = spawnSync(process.env.PG16_BIN ? `${process.env.PG16_BIN}/psql` : '/opt/homebrew/opt/postgresql@16/bin/psql', ['-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-d', process.env.PGDATABASE!], { input, encoding: 'utf8' })
  return result
}

beforeAll(async () => {
  for (const [i, p] of people.entries()) {
    query(`with u as (insert into auth.users(id) values ('${p.user}') returning id) select id from u`)
    query(`with w as (insert into public.workspaces(id,name,created_by,created_at) values ('${p.ws}','같은 상호','${p.user}','2026-0${i + 1}-01T00:00:00Z') returning id) select id from w`)
    query(`with profile as (insert into public.business_profiles(workspace_id,business_name,industry) values ('${p.ws}','같은 상호','${p.industry}') returning workspace_id) select workspace_id from profile`)
    query(`with content as (insert into public.content_items(id,workspace_id,channel,title,created_by) values ('${p.content}','${p.ws}','threads','${p.industry} 소식','${p.user}') returning id) select id from content`)
    query(`with version as (insert into public.content_versions(id,workspace_id,content_id,version_number,caption,fingerprint,created_by) values ('${p.version}','${p.ws}','${p.content}',1,'${p.industry} 이야기','${'a'.repeat(64)}','${p.user}') returning id) select id from version`)
    const saved = await saveToVault({ workspaceId: p.ws, actorId: p.user, contentId: p.content, versionId: p.version, channels: ['threads'], targetDate: '2026-10-11', idempotencyKey: 'same-key' }, { repository: new SupabaseVaultSaveRepository(client as never) })
    expect(saved.saved).toHaveLength(1)
    const id = query<{ id: string }>(`select id from public.vault_items where workspace_id='${p.ws}'`)[0].id
    const digest = (i ? 'b' : 'a').repeat(64)
    const path = `vault-renditions/${p.ws}/${digest}.jpg`
    query(`with asset as (insert into public.media_assets(workspace_id,bucket_id,object_path,kind,mime_type,size_bytes,rights_status,created_by,sha256_digest) values ('${p.ws}','content-media','${p.ws}/source.jpg','content','image/jpeg',1024,'confirmed','${p.user}','${digest}') returning id) select id from asset`)
    const asset = query<{ id: string }>(`select id from public.media_assets where workspace_id='${p.ws}'`)[0].id
    query(`with rendition as (insert into public.vault_image_renditions(workspace_id,vault_item_id,source_media_asset_id,channel,spec_version,object_path,format,width,height,rendition_content_digest) values ('${p.ws}','${id}','${asset}','threads','v1','${path}','jpeg',1080,1080,'${digest}') returning id) select id from rendition`)
    await new PgVaultPreflightPorts(client as never).vault.recordPreflightRun({ workspaceId: p.ws, vaultItemId: id, overall: 'UNKNOWN', items: [], triggeredBy: p.user })
    const repo = new SupabaseVaultBundleRepository(client as never)
    await registerManualPublishUrl({ input: { workspaceId: p.ws, itemRef: encode(id), actorId: p.user, url: `https://www.threads.net/@${i ? 'b' : 'a'}/post/123` }, deps: { repository: repo } })
    rows.set(p.ws, { id, ref: encode(id), rendition: query<{ id: string }>(`select id from public.vault_image_renditions where workspace_id='${p.ws}'`)[0].id, path })
  }
})

describe('ANI-1551 immutable workspace boundary on actual PG16', () => {
  it('keeps same-named, different-industry workspaces distinct in joins and item/calendar/summary totals', async () => {
    const profiles = query<{ id: string; industry: string; name: string; created_at: string }>(`select w.id, w.name, w.created_at, p.industry from public.workspaces w join public.business_profiles p on p.workspace_id=w.id where w.id in ('${a.ws}','${b.ws}') order by w.created_at`)
    expect(profiles.map(p => [p.id, p.name, p.industry, p.created_at.slice(0, 10)])).toEqual([[a.ws, '같은 상호', '꽃집', '2026-01-01'], [b.ws, '같은 상호', '한식당', '2026-02-01']])
    const service = new VaultQueryService(new SupabaseVaultQueryRepository(client))
    for (const p of people) {
      expect((await service.listItems(p.ws, { period: 'month', ym: '2026-10' })).items).toHaveLength(1)
      expect((await service.getCalendar(p.ws, '2026-10')).days['2026-10-11']).toBeDefined()
      const summary = await service.getSummary(p.ws)
      expect(summary.external_action_count).toBe(0)
      expect(count('vault_items', p.ws)).toBe(1)
      expect(count('vault_events', p.ws)).toBeGreaterThan(0)
    }
    expect(await new SupabaseVaultSaveRepository(client as never).getDraft(b.ws, a.content, a.version)).toBeNull()
    await expect(saveToVault({ workspaceId: b.ws, actorId: b.user, contentId: a.content, versionId: a.version, channels: ['threads'], targetDate: null, idempotencyKey: 'foreign-content' }, { repository: new SupabaseVaultSaveRepository(client as never) })).rejects.toMatchObject({ reason: 'CONTENT_NOT_FOUND' })
    expect(count('vault_items', b.ws)).toBe(1)
  })

  it('enforces authenticated SELECT RLS and denies INSERT/UPDATE/DELETE on all six vault tables and edit RPC', () => {
    const tables = ['vault_items', 'vault_variant_payloads', 'vault_image_renditions', 'vault_published_urls', 'preflight_runs', 'vault_events']
    for (const p of people) {
      const foreign = p === a ? b : a
      for (const table of tables) {
        const visible = query<{ workspace_id: string }>(`select workspace_id from public.${table}`, p.user).map(row => row.workspace_id)
        expect(visible.length, `${table}: own rows exist`).toBeGreaterThan(0)
        expect(new Set(visible), `${table}: own rows only`).toEqual(new Set([p.ws]))
        expect(query(`select id from public.${table} where workspace_id='${foreign.ws}'`, p.user), `${table}: foreign row hidden`).toEqual([])
        for (const statement of [
          `insert into public.${table} (workspace_id) values ('${foreign.ws}')`,
          `update public.${table} set workspace_id='${p.ws}' where workspace_id='${foreign.ws}'`,
          `delete from public.${table} where workspace_id='${foreign.ws}'`,
        ]) {
          const result = asUser(statement, p.user)
          expect(result.status, `${table}: ${statement}: ${result.stderr}`).not.toBe(0)
          expect(result.stderr).toMatch(/permission denied|row-level security|SQL state 42501/i)
        }
      }
      const rpc = asUser(`select public.vault_apply_edits('${foreign.ws}', '[]'::jsonb)`, p.user)
      expect(rpc.status).not.toBe(0)
      expect(rpc.stderr).toMatch(/permission denied|Service role required/)
    }
    expect(count('vault_items', a.ws)).toBe(1)
    expect(count('vault_items', b.ws)).toBe(1)
  })

  it('rejects mismatched workspace and item references for edit/hold/delete, bundle, published URL and preflight', async () => {
    const foreign = rows.get(b.ws)!
    const own = rows.get(a.ws)!
    const edit = new SupabaseVaultEditRepository(client as never)
    const bundleRepo = new SupabaseVaultBundleRepository(client as never)
    for (const operation of ['edit', 'hold', 'delete'] as const) {
      await expect(applyVaultEdit(edit, { workspaceId: a.ws, actorId: a.user, itemRef: foreign.ref, operation, expectedVersion: '2026-01-01T00:00:00.000000Z', ...(operation === 'edit' ? { changes: { title: '탈취 시도' } } : {}), now: new Date() })).rejects.toMatchObject({ status: 404 })
    }
    expect(await bundleRepo.getItem(a.ws, foreign.id)).toBeNull()
    expect(await bundleRepo.getVariantPayload(a.ws, foreign.id)).toBeNull()
    expect(await bundleRepo.getPublishedUrl(a.ws, foreign.id)).toBeNull()
    expect(await new SupabaseVaultSaveRepository(client as never).listEvents(a.ws, foreign.id)).toEqual([])
    await expect(getCopyBundle({ workspaceId: a.ws, itemRef: foreign.ref, deps: { repository: bundleRepo, renditionReader: createSupabaseRenditionReader(client as never), signer: { createSignedUrl: async () => { throw new Error('foreign sign attempted') } } } })).rejects.toMatchObject({ status: 404 })
    await expect(registerManualPublishUrl({ input: { workspaceId: a.ws, actorId: a.user, itemRef: foreign.ref, url: 'https://www.threads.net/@a/post/1' }, deps: { repository: bundleRepo } })).rejects.toMatchObject({ status: 404 })
    expect(await readRenditions(createSupabaseRenditionReader(client as never), a.ws, foreign.id)).toEqual([])
    expect(await new PgVaultPreflightPorts(client as never).vault.getItem(a.ws, foreign.id)).toBeNull()
    await expect(runPreflight(new PgVaultPreflightPorts(client as never), { workspaceId: a.ws, itemId: foreign.id, triggeredBy: a.user, now: new Date() })).rejects.toThrow('Vault item unavailable')
    expect(rows.get(a.ws)?.id).toBe(own.id)
    const marker = new Set<string>()
    const ownBundle = await getCopyBundle({ workspaceId: a.ws, itemRef: own.ref, deps: { repository: bundleRepo, renditionReader: createSupabaseRenditionReader(client as never), signer: { createSignedUrl: async (_bucket, path) => { marker.add(path); return 'https://example.test/short-lived' } } } })
    expect(ownBundle.images).toHaveLength(1)
    expect(marker).toEqual(new Set([own.path]))
    expect(ownBundle.publicationStatus.isPublishedUrlRegistered).toBe(true)
    expect(count('vault_published_urls', b.ws)).toBe(1)
    expect(count('preflight_runs', b.ws)).toBe(1)
    expect(count('vault_events', b.ws)).toBeGreaterThan(0)
    for (const table of ['external_action_requests', 'external_action_attempts', 'external_action_receipts']) {
      expect(count(table, a.ws)).toBe(0)
      expect(count(table, b.ws)).toBe(0)
    }
  })

  it('never signs an object path for another workspace, even when passed a foreign rendition directly', async () => {
    const foreign = rows.get(b.ws)!
    const own = rows.get(a.ws)!
    const [row] = await readRenditions(createSupabaseRenditionReader(client as never), b.ws, foreign.id)
    expect(row.object_path).toBe(foreign.path)
    const signed: string[] = []
    const signer = { createSignedUrl: async (_bucket: string, path: string) => { signed.push(path); return 'https://example.test/?token=ephemeral' } }
    await expect(signRenditionForDisplay(row, signer, 60, a.ws)).rejects.toThrow()
    await expect(signRenditionForDisplay({ ...row, workspace_id: a.ws }, signer, 60, a.ws)).rejects.toThrow()
    expect(signed).toEqual([])
    await expect(getCopyBundle({ workspaceId: a.ws, itemRef: own.ref, deps: { repository: new SupabaseVaultBundleRepository(client as never), renditionReader: { list: async () => [{ ...row, workspace_id: a.ws, vault_item_id: own.id }] }, signer } })).rejects.toThrow('Rendition workspace or object path mismatch')
    expect(signed).toEqual([])
    expect(await signRenditionForDisplay({ ...row, workspace_id: a.ws, vault_item_id: own.id, object_path: own.path, rendition_content_digest: 'a'.repeat(64) }, signer, 60, a.ws)).toContain('ephemeral')
    expect(signed).toEqual([own.path])
  })
})
