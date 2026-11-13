import { spawnSync } from 'node:child_process'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { pgClient, query } from './pg-client'
import { saveToVault } from '../../../src/features/vault/service/save'
import { SupabaseVaultSaveRepository } from '../../../src/features/vault/model/supabase-save-repository'
import { createBatchPublishDependencies } from '../../../src/features/vault/publish/pg-dependencies'
import { publishReleasedItems } from '../../../src/features/vault/publish/batch-publish'
import { SupabaseEngagementRepository } from '../../../src/features/engagement/repository'
import { sendCommentReply } from '../../../src/features/engagement/send'
import { classifyComment } from '../../../src/features/engagement/classify'
import { computeApprovalFingerprint } from '../../../src/features/engagement/draft'
import type { MetaFetch } from '../../../src/lib/providers/meta-api'

const db = pgClient()
vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: async () => db,
}))

const user = '77111111-1111-4111-8111-111111111111'
const ws = '87111111-1111-4111-8111-111111111111'
const connId = '97111111-1111-4111-8111-111111111111'
const content = '97222222-2222-4222-8222-222222222222'
const version = '97333333-3333-4333-8333-333333333333'

function psql(input: string): { status: number | null; stdout: string; stderr: string } {
  if (!process.env.PGHOST?.includes('sohee-vault-db-')) throw new Error('Isolated PG16 required')
  const run = spawnSync(
    `${process.env.PG16_BIN || '/opt/homebrew/opt/postgresql@16/bin'}/psql`,
    ['-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-d', process.env.PGDATABASE!],
    { input, encoding: 'utf8' }
  )
  return { status: run.status, stdout: run.stdout, stderr: run.stderr }
}

beforeAll(() => {
  process.env.META_DATA_DELETION_CALLBACK_ENABLED = 'true'
  process.env.META_APP_MODE = 'live'
  process.env.META_ACCESS_TIER = 'advanced'
  process.env.META_APP_REVIEW_STATUS = 'APPROVED'
  process.env.ENGAGEMENT_WORKSPACE_ALLOWLIST = '*'

  psql(`
    alter role service_role bypassrls;
    grant all on all tables in schema public to service_role;
    grant all on all sequences in schema public to service_role;
    grant all on all routines in schema public to service_role;
  `)

  query(`with u as (insert into auth.users (id) values ('${user}') returning id) select id from u`)
  query(`with w as (insert into public.workspaces (id, name, created_by) values ('${ws}', '메타 E2E 매장', '${user}') returning id) select id from w`)
  query(`with c as (insert into public.channel_connections (id, workspace_id, channel, status, account_label, external_account_id) values ('${connId}', '${ws}', 'threads', 'connected', '@meta_flow_store', 'th_acc_777') returning id) select id from c`)
  query(`with c as (insert into public.meta_channel_credentials (workspace_id, channel_connection_id, provider, encrypted_access_token, access_token_iv, granted_scopes, token_expires_at, status) values ('${ws}', '${connId}', 'threads', '${'x'.repeat(32)}', '${'z'.repeat(16)}', array['threads_basic', 'threads_content_publish', 'threads_manage_replies'], now() + interval '30 days', 'active') returning id) select id from c`)
  query(`with r as (insert into public.channel_verification_runs (workspace_id, channel, verification_code, status, read_after_write_at) values ('${ws}', 'threads', 'flow-check', 'VERIFIED', now()) returning id) select id from r`)
  query(`with c as (insert into public.content_items (id, workspace_id, channel, title, created_by) values ('${content}', '${ws}', 'threads', '메타 E2E 테스트', '${user}') returning id) select id from c`)
  query(`with v as (insert into public.content_versions (id, workspace_id, content_id, version_number, caption, fingerprint, created_by) values ('${version}', '${ws}', '${content}', 1, '메타 E2E 본문입니다.', '${'e'.repeat(64)}', '${user}') returning id) select id from v`)
})

describe('Meta end-to-end flow on PostgreSQL 16', () => {
  const repo = new SupabaseEngagementRepository(db as never)

  it('runs complete positive lifecycle: vault save → zero action rows → release request → batch publish → comments ingest → classify & draft → approved send → SENT & audit', async () => {
    // Step 1: Content saved to vault (Invariance: assert zero external action rows)
    const saveResult = await saveToVault(
      {
        workspaceId: ws,
        actorId: user,
        contentId: content,
        versionId: version,
        channels: ['threads'],
        targetDate: null,
        idempotencyKey: 'meta-flow-save',
      },
      { repository: new SupabaseVaultSaveRepository(db as never) }
    )
    expect(saveResult.saved).toHaveLength(1)

    const actionCounts = query<{ requests: number; attempts: number; receipts: number }>(
      `select (select count(*) from public.external_action_requests where workspace_id = '${ws}')::int as requests,
              (select count(*) from public.external_action_attempts where workspace_id = '${ws}')::int as attempts,
              (select count(*) from public.external_action_receipts where workspace_id = '${ws}')::int as receipts`
    )[0]
    expect(actionCounts).toEqual({ requests: 0, attempts: 0, receipts: 0 })

    // Step 2: Release requested
    query(
      `with changed as (update public.vault_items set release_gate='RELEASE_REQUESTED', hold_reason='RELEASE_REQUESTED', held_at=now(), held_by='${user}' where workspace_id='${ws}' returning id) select id from changed`
    )

    // Step 3: batchPublish with VAULT_PUBLISH_ENABLED=1 and fake provider (create+publish+readback)
    process.env.VAULT_PUBLISH_ENABLED = '1'
    const batchDeps = createBatchPublishDependencies(db)
    const [item] = await batchDeps.listItems(ws)
    expect(item?.releaseGate).toBe('RELEASE_REQUESTED')

    const fakePublishOutcome = {
      success: true,
      verified: true,
      stage: 'EXTERNAL_VERIFIED',
      publishedUrl: 'https://www.threads.net/@meta_flow_store/post/post_flow_101',
    }

    const publishResult = await publishReleasedItems(
      { workspaceId: ws, actorId: user, itemIds: [item.id], now: new Date() },
      { ...batchDeps, publish: async () => fakePublishOutcome }
    )

    expect(publishResult.published).toBe(1)
    expect(publishResult.results[0].status).toBe('published')

    // Verify published url, audit event, funnel event, and gate cleared in real PostgreSQL
    const publishedRows = query<{ published_url: string }>(
      `select published_url from public.vault_published_urls where workspace_id = '${ws}' and vault_item_id = '${item.id}'`
    )
    expect(publishedRows).toHaveLength(1)
    expect(publishedRows[0].published_url).toBe('https://www.threads.net/@meta_flow_store/post/post_flow_101')

    expect(
      query(`select 1 from public.vault_events where workspace_id = '${ws}' and event_type = 'vault.published'`)
    ).toHaveLength(1)
    expect(
      query(`select 1 from public.funnel_events where workspace_id = '${ws}' and event = 'publish_verified'`)
    ).toHaveLength(1)

    const updatedItem = query<{ release_gate: string | null }>(
      `select release_gate from public.vault_items where id = '${item.id}'`
    )[0]
    expect(updatedItem.release_gate).toBeNull()

    // Step 4: Engagement ingest of a fake comment on that post
    const comment = await repo.upsertComment({
      workspace_id: ws,
      channel_connection_id: connId,
      channel: 'threads',
      provider_comment_id: 'prov_comm_101',
      provider_media_id: 'post_flow_101',
      author_handle: 'customer_threader',
      author_id: 'cust_777',
      comment_text: '새로 오픈한 매장 위치가 어디인가요? 축하드립니다!',
      comment_created_at: new Date().toISOString(),
      classification: null,
      confidence: null,
      status: 'RECEIVED',
      failure_reason: null,
    })
    expect(comment.id).toBeDefined()
    expect(comment.status).toBe('RECEIVED')

    // Step 5: Classify + draft with a fake model port
    const fakeModel = {
      generateText: vi.fn().mockImplementation(async (prompt: string) => {
        if (prompt.includes('분류')) {
          return JSON.stringify({ classification: 'QUESTION', confidence: 0.95, reasoning: '위치 문의' })
        }
        return JSON.stringify({ reply: '축하 감사드립니다! 매장은 테헤란로 123에 위치해 있습니다.' })
      }),
    }

    const classification = await classifyComment(comment.comment_text, fakeModel)
    expect(classification.classification).toBe('QUESTION')
    await repo.updateCommentClassification(ws, comment.id, classification.classification, classification.confidence)

    const draftText = '축하 감사드립니다! 매장은 테헤란로 123에 위치해 있습니다.'
    const fingerprint = computeApprovalFingerprint(ws, comment.id, draftText)
    await repo.saveDraft(ws, comment.id, draftText, fingerprint)
    await repo.approveDraft(ws, comment.id, fingerprint, user)

    const readyComment = await repo.findCommentById(ws, comment.id)
    expect(readyComment).not.toBeNull()

    // Step 6: Approve + send with ENGAGEMENT_SEND_ENABLED=1 and fake provider incl. readback
    process.env.ENGAGEMENT_SEND_ENABLED = '1'
    process.env.META_APP_MODE = 'live'
    process.env.META_ACCESS_TIER = 'advanced'
    process.env.META_APP_REVIEW_STATUS = 'APPROVED'

    const fakeMetaFetch: MetaFetch = async (input, init) => {
      const url = String(input)
      if (url.includes('/threads_publish') && init?.method === 'POST') {
        return new Response(JSON.stringify({ id: 'th_reply_pub_999' }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      if (url.endsWith('/threads') && init?.method === 'POST') {
        return new Response(JSON.stringify({ id: 'cnt_rep_1' }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      if (url.includes('status%2Cerror_message')) {
        return new Response(JSON.stringify({ status: 'FINISHED' }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      if (url.includes('/th_reply_pub_999')) {
        return new Response(
          JSON.stringify({
            id: 'th_reply_pub_999',
            text: draftText,
            timestamp: new Date().toISOString(),
            username: 'meta_flow_store',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      }
      return new Response(JSON.stringify({}), { status: 200, headers: { 'content-type': 'application/json' } })
    }

    const sendResult = await sendCommentReply(
      readyComment!,
      { type: 'owner', userId: user },
      {
        repo,
        getChannelCredential: async () => ({
          accessToken: 'valid_test_token_threads_123',
          externalAccountId: 'th_acc_777',
          grantedScopes: ['threads_basic', 'threads_content_publish', 'threads_manage_replies'],
        }),
        fetcher: fakeMetaFetch,
        adminClient: db,
      }
    )

    expect(sendResult.sent).toBe(true)
    expect(sendResult.status).toBe('SENT')

    // Confirm state in DB: SENT + audit log + receipt
    const commentRow = query<{ status: string }>(
      `select status from public.social_comments where id = '${comment.id}'`
    )[0]
    expect(commentRow.status).toBe('SENT')

    const auditRows = query<{ action: string; provider_reply_id: string }>(
      `select action, provider_reply_id from public.engagement_audit where workspace_id = '${ws}' and comment_id = '${comment.id}'`
    )
    expect(auditRows).toHaveLength(1)
    expect(auditRows[0].action).toBe('manual_send')
    expect(auditRows[0].provider_reply_id).toBe('th_reply_pub_999')

    const receiptRows = query<{ provider_reference: string }>(
      `select provider_reference from public.external_action_receipts where workspace_id = '${ws}' and provider_reference = 'th_reply_pub_999'`
    )
    expect(receiptRows).toHaveLength(1)
  })

  it('negative path 1: ENGAGEMENT_SEND_ENABLED=0 halts send and leaves comment unchanged', async () => {
    process.env.ENGAGEMENT_SEND_ENABLED = '0'

    const comment = await repo.upsertComment({
      workspace_id: ws,
      channel_connection_id: connId,
      channel: 'threads',
      provider_comment_id: 'prov_comm_disabled',
      provider_media_id: 'post_flow_101',
      author_handle: 'thread_user_2',
      comment_text: '스위치 꺼짐 테스트',
      comment_created_at: new Date().toISOString(),
      classification: 'THANKS',
      confidence: 1.0,
      status: 'APPROVED',
      failure_reason: null,
    })

    const draftText = '감사합니다!'
    const fp = computeApprovalFingerprint(ws, comment.id, draftText)
    await repo.saveDraft(ws, comment.id, draftText, fp)
    await repo.approveDraft(ws, comment.id, fp, user)

    const result = await sendCommentReply(
      (await repo.findCommentById(ws, comment.id))!,
      { type: 'owner', userId: user },
      {
        repo,
        getChannelCredential: async () => ({ accessToken: 'test_token', grantedScopes: ['threads_manage_replies'] }),
        fetcher: vi.fn(),
        adminClient: db,
      }
    )

    expect(result.sent).toBe(false)
    expect(result.reason).toContain('비활성화')

    const row = query<{ status: string }>(`select status from public.social_comments where id = '${comment.id}'`)[0]
    expect(row.status).toBe('APPROVED')
  })

  it('negative path 2: readback failure marks comment NEEDS_CHECK and a second send attempt is refused', async () => {
    process.env.ENGAGEMENT_SEND_ENABLED = '1'

    const comment = await repo.upsertComment({
      workspace_id: ws,
      channel_connection_id: connId,
      channel: 'threads',
      provider_comment_id: 'prov_comm_readback_fail',
      provider_media_id: 'post_flow_101',
      author_handle: 'thread_user_3',
      comment_text: '읽기 검증 실패 테스트',
      comment_created_at: new Date().toISOString(),
      classification: 'THANKS',
      confidence: 1.0,
      status: 'APPROVED',
      failure_reason: null,
    })

    const draftText = '감사합니다 테스트'
    const fp = computeApprovalFingerprint(ws, comment.id, draftText)
    await repo.saveDraft(ws, comment.id, draftText, fp)
    await repo.approveDraft(ws, comment.id, fp, user)

    // Fetcher succeeds on POST write, but fails on readback GET
    const failingReadbackFetch: MetaFetch = async (input, init) => {
      const url = String(input)
      if (url.includes('/threads') && init?.method === 'POST') {
        return new Response(JSON.stringify({ id: 'cnt_rep_fail' }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      if (url.includes('status%2Cerror_message')) {
        return new Response(JSON.stringify({ status: 'FINISHED' }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      if (url.includes('/threads_publish') && init?.method === 'POST') {
        return new Response(JSON.stringify({ id: 'th_reply_ghost' }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      // Readback GET returns 404
      return new Response(JSON.stringify({ error: { message: 'Not found' } }), { status: 404, headers: { 'content-type': 'application/json' } })
    }

    const firstAttempt = await sendCommentReply(
      (await repo.findCommentById(ws, comment.id))!,
      { type: 'owner', userId: user },
      {
        repo,
        getChannelCredential: async () => ({
          accessToken: 'valid_test_token_threads_123',
          externalAccountId: 'th_acc_777',
          grantedScopes: ['threads_basic', 'threads_content_publish', 'threads_manage_replies'],
        }),
        fetcher: failingReadbackFetch,
        adminClient: db,
      }
    )

    expect(firstAttempt.sent).toBe(false)
    expect(firstAttempt.status).toBe('NEEDS_CHECK')
    expect(firstAttempt.reason).toBe('답글이 올라갔는지 확인해 주세요')

    const dbAfterFirst = query<{ status: string }>(`select status from public.social_comments where id = '${comment.id}'`)[0]
    expect(dbAfterFirst.status).toBe('NEEDS_CHECK')

    // Second attempt on the same comment must be refused (invariant: human must check)
    const secondAttempt = await sendCommentReply(
      (await repo.findCommentById(ws, comment.id))!,
      { type: 'owner', userId: user },
      {
        repo,
        getChannelCredential: async () => ({
          accessToken: 'valid_test_token_threads_123',
          externalAccountId: 'th_acc_777',
          grantedScopes: ['threads_basic', 'threads_content_publish', 'threads_manage_replies'],
        }),
        fetcher: failingReadbackFetch,
        adminClient: db,
      }
    )

    expect(secondAttempt.sent).toBe(false)
    expect(secondAttempt.status).toBe('NEEDS_CHECK')
    expect(secondAttempt.reason).toBe('답글이 올라갔는지 확인해 주세요')
  })
})
