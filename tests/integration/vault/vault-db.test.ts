import { beforeAll, describe, expect, it, vi } from 'vitest'
import { SupabaseVaultSaveRepository } from '../../../src/features/vault/model/supabase-save-repository'
import { saveToVault } from '../../../src/features/vault/service/save'
import { SupabaseVaultQueryRepository, VaultQueryService } from '../../../src/features/vault/query/vault-query-service'
import { SupabaseVaultBundleRepository } from '../../../src/features/vault/bundle/repository'
import { runPreflight } from '../../../src/features/vault/preflight'
import { PgVaultPreflightPorts } from '../../../src/features/vault/preflight/pg-ports'
import { literal, pgClient, query } from './pg-client'
import { verifyPostOAuthChannelCapability } from '../../../src/features/channels/dual-channel-verification'

const user = '71111111-1111-4111-8111-111111111111'
const outsider = '72222222-2222-4222-8222-222222222222'
const ws = '81111111-1111-4111-8111-111111111111'
const other = '82222222-2222-4222-8222-222222222222'
const content = '91111111-1111-4111-8111-111111111111'
const version = '92222222-2222-4222-8222-222222222222'
const now = new Date()
const future = new Date(Date.now() + 5 * 86_400_000).toISOString()
const past = new Date(Date.now() - 20 * 86_400_000).toISOString()
const db = pgClient()
const repository = new SupabaseVaultSaveRepository(db as never)
const service = new VaultQueryService(new SupabaseVaultQueryRepository(db))
const actionCounts = () => query<{ requests: number; attempts: number; receipts: number }>(`select (select count(*) from public.external_action_requests where workspace_id = '${ws}')::int as requests, (select count(*) from public.external_action_attempts where workspace_id = '${ws}')::int as attempts, (select count(*) from public.external_action_receipts where workspace_id = '${ws}')::int as receipts`)[0]
const saved = (key: string, channels: string[] = ['threads']) => saveToVault({ workspaceId: ws, actorId: user, contentId: content, versionId: version, channels, targetDate: '2026-10-05', idempotencyKey: key }, { repository })

beforeAll(() => {
  query(`with users as (insert into auth.users (id) values ('${user}'), ('${outsider}') returning id) select id from users`)
  query(`with workspaces as (insert into public.workspaces (id,name,created_by) values ('${ws}', '첫번째 서비스', '${user}'), ('${other}', '다른 서비스', '${outsider}') returning id) select id from workspaces`)
  query(`with contents as (insert into public.content_items (id,workspace_id,channel,title,created_by) values ('${content}','${ws}','threads','서비스 소식','${user}') returning id) select id from contents`)
  query(`with versions as (insert into public.content_versions (id,workspace_id,content_id,version_number,caption,fingerprint,created_by) values ('${version}','${ws}','${content}',1,'사장님의 새로운 소식을 알려드립니다.','${'a'.repeat(64)}','${user}') returning id) select id from versions`)
})

describe('PostgreSQL 16 real vault persistence', () => {
  it('persists a saved item once on replay, rejects only spec FAIL, never writes external actions, and rejects foreign content', async () => {
    const first = await saved('first', ['threads', 'naver_blog'])
    expect(first.saved.map(entry => entry.channel)).toEqual(['threads'])
    expect(first.rejected[0].channel).toBe('naver_blog')
    const again = await saved('first', ['threads', 'naver_blog'])
    expect(again.saved).toHaveLength(1)
    expect(query<{ n: number }>(`select count(*)::int as n from vault_items where workspace_id='${ws}'`)[0].n).toBe(1)
    expect(actionCounts()).toEqual({ requests: 0, attempts: 0, receipts: 0 })
    const cross = await repository.getDraft(other, content, version)
    expect(cross).toBeNull()
    await expect(saveToVault({ workspaceId: other, actorId: outsider, contentId: content, versionId: version, channels: ['threads'], targetDate: null, idempotencyKey: 'foreign' }, { repository })).rejects.toMatchObject({ reason: 'CONTENT_NOT_FOUND' })
  })

  it('queries KST date boundaries and counts actual linked external actions; RLS blocks another workspace', async () => {
    for (const [key, date] of [['sunday', '2026-10-04'], ['monday', '2026-10-05'], ['november', '2026-11-01']]) {
      const result = await saved(key)
      const item = query<{ id: string }>(`select id from vault_items where idempotency_key <> '' order by created_at desc limit 1`)[0]
      query(`with changed as (update vault_items set target_date=${literal(date)} where id='${item.id}' returning id) select id from changed`)
      expect(result.saved).toHaveLength(1)
    }
    const october = await service.listItems(ws, { period: 'month', ym: '2026-10' })
    expect(october.items.length).toBeGreaterThanOrEqual(2)
    const calendar = await service.getCalendar(ws, '2026-10')
    expect(calendar.days['2026-10-04']).toBeDefined()
    expect(calendar.days['2026-10-05']).toBeDefined()
    expect(calendar.days['2026-11-01']).toBeUndefined()
    const before = await service.getSummary(ws)
    expect(before.external_action_count).toBe(0)
    query(`with request as (insert into external_action_requests (workspace_id,channel,action_kind,target_external_id,target_label,exact_payload,content_version_id,idempotency_key,created_by) values ('${ws}','threads','news_post','test','test','{}','${version}','vault-db-count','${user}') returning id) select id from request`)
    const after = await service.getSummary(ws)
    expect(after.external_action_count).toBe(1)
    expect(after.external_action_warning).toContain('1건')
    expect(query(`select id from vault_items where workspace_id='${ws}'`, outsider)).toHaveLength(0)
    expect(query(`select id from vault_items where workspace_id='${other}'`, user)).toHaveLength(0)
  })

  it('fails preflight independently for tampering, expiry, 15-day hold, expired token, account drift and expired rendition', async () => {
    const item = query<{ id: string }>(`select id from vault_items where workspace_id='${ws}' limit 1`)[0].id
    const ports = new PgVaultPreflightPorts(db as never)
    const run = async () => {
      const result = await runPreflight(ports, { workspaceId: ws, itemId: item, triggeredBy: user, now })
      expect(actionCounts().attempts).toBe(0)
      expect(actionCounts().receipts).toBe(0)
      return result
    }
    const set = (table: string, column: string, value: string) => query(`with changed as (update ${table} set ${column}=${literal(value)} where vault_item_id='${item}' returning vault_item_id) select vault_item_id from changed`)
    const result = await run()
    expect(result.canRelease).toBe(false)
    const original = query<{ payload: Record<string, any> }>(`select payload from vault_variant_payloads where vault_item_id='${item}'`)[0].payload
    set('vault_variant_payloads', 'payload', JSON.stringify({ ...original, title: '변조된 제목' }))
    expect((await run()).items.find(check => check.code === 'FINGERPRINT')?.status).toBe('FAIL')
    set('vault_variant_payloads', 'payload', JSON.stringify({ ...original, settings: { ...(original.settings as object), valid_until: past } }))
    expect((await run()).items.find(check => check.code === 'CONTENT_EXPIRY')?.status).toBe('FAIL')
    set('vault_variant_payloads', 'payload', JSON.stringify({ ...original, settings: { ...(original.settings as object), approved_policy_versions: { 'channel-spec': 'old-version', 'vault-save': 'vault-save-v1' } } }))
    expect((await run()).items.find(check => check.code === 'POLICY')?.status).toBe('FAIL')
    query(`with changed as (update vault_items set held_at='${past}' where id='${item}' returning id) select id from changed`)
    expect((await run()).items.find(check => check.code === 'HOLD_AGE')?.status).toBe('FAIL')
    // Independently restore other conditions before each violation.
    query(`with changed as (update vault_items set held_at=now() where id='${item}' returning id) select id from changed`)
    set('vault_variant_payloads', 'payload', JSON.stringify(original))
    query(`with c as (insert into channel_connections(workspace_id,channel,status,external_account_id) values ('${ws}','threads','connected','test-account') returning id) select id from c`)
    // Query the newly inserted row instead of inferring an account ID from a mock.
    const connectionId = query<{ id: string }>(`select id from channel_connections where workspace_id='${ws}' and channel='threads'`)[0].id
    query(`with c as (insert into meta_channel_credentials(workspace_id,channel_connection_id,provider,encrypted_access_token,access_token_iv,granted_scopes,token_expires_at,status) values ('${ws}','${connectionId}','threads','${'x'.repeat(32)}','${'z'.repeat(16)}',array['threads_basic','threads_content_publish'],'${future}','active') returning id) select id from c`)
    query(`with r as (insert into channel_verification_runs(workspace_id,channel,verification_code,status,read_after_write_at) values ('${ws}','threads','local-receipt','VERIFIED',now()) returning id) select id from r`)
    expect((await run()).items.find(check => check.code === 'CONNECTION')?.status).toBe('PASS')
    expect((await run()).items.find(check => check.code === 'ACCOUNT')?.status).toBe('FAIL')
    // The actual credential-expiry case is seeded as a separate connection below;
    // avoid mutating the trigger-bound credential twice in the same second.
    const secondWorkspace = other
    query(`with c as (insert into channel_connections(workspace_id,channel,status,external_account_id) values ('${secondWorkspace}','threads','connected','other-account') returning id) select id from c`)
    const secondConn = query<{ id: string }>(`select id from channel_connections where workspace_id='${secondWorkspace}' and channel='threads'`)[0].id
    query(`with c as (insert into meta_channel_credentials(workspace_id,channel_connection_id,provider,encrypted_access_token,access_token_iv,granted_scopes,token_expires_at,status) values ('${secondWorkspace}','${secondConn}','threads','${'x'.repeat(32)}','${'z'.repeat(16)}',array['threads_basic','threads_content_publish'],'${past}','active') returning id) select id from c`)
    query(`with r as (insert into channel_verification_runs(workspace_id,channel,verification_code,status,read_after_write_at) values ('${secondWorkspace}','threads','expired-receipt','VERIFIED',now()) returning id) select id from r`)
    const expiredHealth = await ports.readConnectionHealth(secondWorkspace, 'threads')
    expect(expiredHealth?.connection).toBe('EXPIRED')
    expect((await runPreflight({ vault: ports.vault, readSnapshot: (...args) => ports.readSnapshot(...args), readConnectionHealth: async () => expiredHealth }, { workspaceId: ws, itemId: item, triggeredBy: user, now })).items.find(check => check.code === 'CONNECTION')?.status).toBe('FAIL')
    // An actual image and rendition in the vault must be rechecked at release time.
    query(`with asset as (insert into media_assets(workspace_id,bucket_id,object_path,kind,mime_type,size_bytes,rights_status,created_by,sha256_digest) values ('${ws}','content-media','test-vault-image.jpg','content','image/jpeg',1024,'confirmed','${user}','${'c'.repeat(64)}') returning id) select id from asset`)
    const imageId = query<{ id: string }>(`select id from media_assets where workspace_id='${ws}'`)[0].id
    const rendition = query<{ id: string }>(`select id from vault_items where workspace_id='${ws}' and id <> '${item}' limit 1`)[0].id
    query(`with r as (insert into vault_image_renditions(workspace_id,vault_item_id,source_media_asset_id,channel,spec_version,object_path,format,width,height,rendition_content_digest,rights_expires_at,qc_expires_at) values ('${ws}','${rendition}','${imageId}','threads','2026.10.1','vault-renditions/${ws}/${'c'.repeat(64)}.jpg','jpeg',1080,1080,'${'c'.repeat(64)}','${past}','${past}') returning id) select id from r`)
    const renditionPayload = query<{ payload: Record<string, any> }>(`select payload from vault_variant_payloads where vault_item_id='${rendition}'`)[0].payload
    query(`with change as (update vault_variant_payloads set payload=${literal(JSON.stringify({ ...renditionPayload, media: [{ position: 0, type: 'image', mimeType: 'image/jpeg', sizeBytes: 1024, renditionContentDigest: 'c'.repeat(64) }] }))} where vault_item_id='${rendition}' returning id) select id from change`)
    const renditionResult = await runPreflight(ports, { workspaceId: ws, itemId: rendition, triggeredBy: user, now })
    expect(renditionResult.items.find(check => check.code === 'IMAGE_RIGHTS')?.status).toBe('FAIL')
    expect(renditionResult.items.find(check => check.code === 'IMAGE_QC')?.status).toBe('FAIL')
    expect(actionCounts()).toEqual({ requests: 1, attempts: 0, receipts: 0 })
  })

  it('reevaluates a pending gate when the channel becomes VERIFIED and requires reapproval for account drift', async () => {
    const pendingWs = 'e1111111-1111-4111-8111-111111111111'
    const pendingContent = 'e2222222-2222-4222-8222-222222222222'
    const pendingVersion = 'e3333333-3333-4333-8333-333333333333'
    query(`with w as (insert into workspaces(id,name,created_by) values ('${pendingWs}','연결 대기 서비스','${user}') returning id) select id from w`)
    query(`with c as (insert into content_items(id,workspace_id,channel,title,created_by) values ('${pendingContent}','${pendingWs}','threads','연결 대기','${user}') returning id) select id from c`)
    query(`with v as (insert into content_versions(id,workspace_id,content_id,version_number,caption,fingerprint,created_by) values ('${pendingVersion}','${pendingWs}','${pendingContent}',1,'연결 대기 원고','${'d'.repeat(64)}','${user}') returning id) select id from v`)
    const result = await saveToVault({ workspaceId: pendingWs, actorId: user, contentId: pendingContent, versionId: pendingVersion, channels: ['threads'], targetDate: null, idempotencyKey: 'pending' }, { repository })
    expect(result.saved[0].release_gate_label).toContain('채널 연결')
    const id = query<{ id: string }>(`select id from vault_items where workspace_id='${pendingWs}'`)[0].id
    expect(query<{ release_gate: string }>(`select release_gate from vault_items where id='${id}'`)[0].release_gate).toBe('HELD_CONNECTION_PENDING')
    query(`with c as (insert into channel_connections(workspace_id,channel,status,external_account_id) values ('${pendingWs}','threads','connected','verified-account') returning id) select id from c`)
    const conn = query<{ id: string }>(`select id from channel_connections where workspace_id='${pendingWs}'`)[0].id
    query(`with c as (insert into meta_channel_credentials(workspace_id,channel_connection_id,provider,encrypted_access_token,access_token_iv,granted_scopes,token_expires_at,status) values ('${pendingWs}','${conn}','threads','${'x'.repeat(32)}','${'z'.repeat(16)}',array['threads_basic','threads_content_publish'],'${future}','active') returning id) select id from c`)
    const verified = await verifyPostOAuthChannelCapability({ workspaceId: pendingWs, channel: 'threads', accessToken: 'test-token', providerAccountId: 'verified-account', adminClient: db, probeFn: async () => ({ success: true, providerAccountId: 'verified-account' }) })
    expect(verified.verified).toBe(true)
    expect(query<{ status: string }>(`select status from channel_verification_runs where workspace_id='${pendingWs}' order by created_at desc limit 1`)[0].status).toBe('VERIFIED')
    expect(query<{ release_gate: string; approval_state: string }>(`select release_gate,approval_state from vault_items where id='${id}'`)[0]).toEqual({ release_gate: 'HELD_USER', approval_state: 'NEEDS_REAPPROVAL' })
    expect(query<{ n: number }>(`select count(*)::int as n from external_action_requests where workspace_id='${pendingWs}'`)[0].n).toBe(0)
  })

  it('ANI-1541: persists manual publish URL as UNVERIFIED, records vault_event, and blocks foreign workspace', async () => {
    const item = query<{ id: string }>(`select id from vault_items where workspace_id='${ws}' limit 1`)[0].id
    const bundleRepo = new SupabaseVaultBundleRepository(db as never)

    // Save URL
    const record = await bundleRepo.savePublishedUrl({
      workspaceId: ws,
      vaultItemId: item,
      channel: 'threads',
      publishedUrl: 'https://threads.net/@my_shop/post/12345',
      verificationStatus: 'UNVERIFIED',
      registeredBy: user,
    })
    expect(record.publishedUrl).toBe('https://threads.net/@my_shop/post/12345')
    expect(record.verificationStatus).toBe('UNVERIFIED')

    // Read back via DB query
    const dbRow = query<{ published_url: string; verification_status: string }>(
      `select published_url, verification_status from vault_published_urls where workspace_id='${ws}' and vault_item_id='${item}'`,
    )[0]
    expect(dbRow.published_url).toBe('https://threads.net/@my_shop/post/12345')
    expect(dbRow.verification_status).toBe('UNVERIFIED')

    // Append audit event
    await bundleRepo.appendEvent({
      workspaceId: ws,
      vaultItemId: item,
      actorId: user,
      eventType: 'vault.manual_publish_url_registered',
      payload: {
        channel: 'threads',
        publishedUrl: 'https://threads.net/@my_shop/post/12345',
        verificationStatus: 'UNVERIFIED',
      },
    })
    const eventRow = query<{ event_type: string }>(
      `select event_type from vault_events where workspace_id='${ws}' and vault_item_id='${item}' and event_type='vault.manual_publish_url_registered'`,
    )[0]
    expect(eventRow.event_type).toBe('vault.manual_publish_url_registered')

    // Check cross-workspace isolation: foreign workspace returns null
    const crossRow = await bundleRepo.getPublishedUrl(other, item)
    expect(crossRow).toBeNull()

    // Non-https constraint check in DB
    expect(() => {
      query(
        `insert into vault_published_urls (workspace_id, vault_item_id, channel, published_url, registered_by) values ('${ws}', '${item}', 'threads', 'http://insecure.test', '${user}')`,
      )
    }).toThrow()
  })

  it('keeps OAuth verification successful if vault gate re-evaluation fails', async () => {
    const failingWorkspace = 'f1111111-1111-4111-8111-111111111111'
    query(`with w as (insert into workspaces(id,name,created_by) values ('${failingWorkspace}','인증 서비스','${user}') returning id) select id from w`)
    query(`with c as (insert into channel_connections(workspace_id,channel,status,external_account_id) values ('${failingWorkspace}','threads','connected','gate-failure-account') returning id) select id from c`)
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const failingClient = { from(table: string) {
      if (table === 'meta_channel_credentials') throw new Error('vault query unavailable')
      return db.from(table)
    } }
    try {
      const result = await verifyPostOAuthChannelCapability({ workspaceId: failingWorkspace, channel: 'threads',
        accessToken: 'test-token', providerAccountId: 'gate-failure-account', adminClient: failingClient,
        probeFn: async () => ({ success: true }) })
      expect(result.verified).toBe(true)
      expect(query<{ status: string }>(`select status from channel_verification_runs where workspace_id='${failingWorkspace}' order by created_at desc limit 1`)[0].status).toBe('VERIFIED')
      expect(log).toHaveBeenCalledWith('[verifyPostOAuthChannelCapability] Vault gate re-evaluation failed:', expect.any(Error))
    } finally { log.mockRestore() }
  })
})
