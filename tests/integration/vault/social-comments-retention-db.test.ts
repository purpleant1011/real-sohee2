import { spawnSync } from 'node:child_process'
import { beforeAll, describe, expect, it } from 'vitest'
import { query } from './pg-client'

const ownerA = '74111111-1111-4111-8111-111111111111'
const ownerB = '74222222-2222-4222-8222-222222222222'
const wsA = '84111111-1111-4111-8111-111111111111'
const wsB = '84222222-2222-4222-8222-222222222222'
const connA = '94111111-1111-4111-8111-111111111111'
const connB = '94222222-2222-4222-8222-222222222222'

// Comments for wsA
const cmSentOld = 'c1111111-1111-4111-8111-111111111111'      // SENT, 35 days ago (should purge)
const cmDismissedOld = 'c2222222-2222-4222-8222-222222222222' // DISMISSED, 32 days ago (should purge)
const cmFailedOld = 'c3333333-3333-4333-8333-333333333333'    // FAILED, 40 days ago (should purge)
const cmSentFresh = 'c4444444-4444-4444-8444-444444444444'    // SENT, 29 days ago (should NOT purge)
const cmReceivedOld = 'c5555555-5555-4555-8555-555555555555'  // RECEIVED, 45 days ago (should NOT purge)
const cmClassifiedOld = 'c6666666-6666-4666-8666-666666666666'// CLASSIFIED, 46 days ago (should NOT purge)
const cmDraftedOld = 'c7777777-7777-4777-8777-777777777777'   // DRAFTED, 47 days ago (should NOT purge)
const cmApprovedOld = 'c8888888-8888-4888-8888-888888888888'  // APPROVED, 48 days ago (should NOT purge)
const cmSendingOld = 'c9999999-9999-4999-8999-999999999999'   // SENDING, 49 days ago (should NOT purge)
const cmNeedsCheckOld = 'caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'// NEEDS_CHECK, 50 days ago (should NOT purge)

// Comment for wsB
const cmWsBOld = 'cb111111-1111-4111-8111-111111111111'        // SENT, 33 days ago in wsB (should purge)

function psql(input: string): { status: number | null; stdout: string; stderr: string } {
  if (!process.env.PGHOST?.includes('sohee-vault-db-')) throw new Error('Isolated PG16 required')
  const run = spawnSync(
    `${process.env.PG16_BIN || '/opt/homebrew/opt/postgresql@16/bin'}/psql`,
    ['-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-d', process.env.PGDATABASE!],
    { input, encoding: 'utf8' }
  )
  return { status: run.status, stdout: run.stdout, stderr: run.stderr }
}

function callRpc(args = '30', role = 'service_role'): {
  comments: number
  drafts: number
  hasMore: boolean
} {
  const run = psql(`begin; set local role ${role}; select public.purge_expired_social_comment_data(${args})::text; commit;`)
  if (run.status !== 0) throw new Error(run.stderr)
  const line = run.stdout.trim().split('\n').find((l) => l.startsWith('{'))
  if (!line) throw new Error(`No json output: ${run.stdout}`)
  return JSON.parse(line)
}

function seedComment(params: {
  id: string
  ws: string
  conn: string
  providerCommentId: string
  providerMediaId: string
  authorHandle: string
  authorId: string | null
  status: string
  ageDays: number
  commentText: string
  withDraft?: boolean
  withAudit?: boolean
}) {
  const {
    id,
    ws,
    conn,
    providerCommentId,
    providerMediaId,
    authorHandle,
    authorId,
    status,
    ageDays,
    commentText,
    withDraft,
    withAudit,
  } = params

  const ageInterval = `now() - interval '${ageDays} days'`
  const authorIdVal = authorId ? `'${authorId}'` : 'null'

  query(`with c as (insert into public.social_comments
    (id, workspace_id, channel_connection_id, channel, provider_comment_id, provider_media_id,
     author_handle, author_id, comment_text, comment_created_at, status, created_at, updated_at)
    values
    ('${id}', '${ws}', '${conn}', 'instagram', '${providerCommentId}', '${providerMediaId}',
     '${authorHandle}', ${authorIdVal}, '${commentText}', ${ageInterval}, '${status}', ${ageInterval}, ${ageInterval})
    returning id) select id from c`)

  if (withDraft) {
    query(`with d as (insert into public.comment_reply_drafts
      (workspace_id, comment_id, draft_text, created_at, updated_at)
      values
      ('${ws}', '${id}', '답글 초안 원문 ${id.slice(0, 8)}', ${ageInterval}, ${ageInterval})
      returning id) select id from d`)
  }

  if (withAudit) {
    query(`with a as (insert into public.engagement_audit
      (workspace_id, comment_id, channel, actor, action, details, created_at)
      values
      ('${ws}', '${id}', 'instagram', 'owner', 'manual_send',
       '{"draftFingerprint":"0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef","draftLength":25}'::jsonb,
       ${ageInterval})
      returning id) select id from a`)
  }
}

beforeAll(() => {
  query(`with u as (insert into auth.users (id) values ('${ownerA}'), ('${ownerB}') returning id) select id from u`)
  query(`with w as (insert into public.workspaces (id, name, created_by) values ('${wsA}', '매장 A', '${ownerA}'), ('${wsB}', '매장 B', '${ownerB}') returning id) select id from w`)
  query(`with c as (insert into public.channel_connections (id, workspace_id, channel, status, external_account_id)
    values ('${connA}', '${wsA}', 'instagram', 'connected', 'ig_acc_a'),
           ('${connB}', '${wsB}', 'instagram', 'connected', 'ig_acc_b') returning id) select id from c`)

  // wsA comments
  seedComment({ id: cmSentOld, ws: wsA, conn: connA, providerCommentId: 'p-sent-old', providerMediaId: 'm-1', authorHandle: 'cust_sent_old', authorId: 'id_sent_old', status: 'SENT', ageDays: 35, commentText: '발송완료 원문 A', withDraft: true, withAudit: true })
  seedComment({ id: cmDismissedOld, ws: wsA, conn: connA, providerCommentId: 'p-dism-old', providerMediaId: 'm-1', authorHandle: 'cust_dism_old', authorId: 'id_dism_old', status: 'DISMISSED', ageDays: 32, commentText: '무시된 원문 B', withDraft: true, withAudit: true })
  seedComment({ id: cmFailedOld, ws: wsA, conn: connA, providerCommentId: 'p-fail-old', providerMediaId: 'm-1', authorHandle: 'cust_fail_old', authorId: null, status: 'FAILED', ageDays: 40, commentText: '실패한 원문 C', withDraft: false, withAudit: false })
  seedComment({ id: cmSentFresh, ws: wsA, conn: connA, providerCommentId: 'p-sent-fresh', providerMediaId: 'm-1', authorHandle: 'cust_fresh', authorId: 'id_fresh', status: 'SENT', ageDays: 29, commentText: '신선한 발송완료 D', withDraft: true, withAudit: true })
  seedComment({ id: cmReceivedOld, ws: wsA, conn: connA, providerCommentId: 'p-recv-old', providerMediaId: 'm-1', authorHandle: 'cust_recv', authorId: 'id_recv', status: 'RECEIVED', ageDays: 45, commentText: '수신 원문 E', withDraft: false, withAudit: false })
  seedComment({ id: cmClassifiedOld, ws: wsA, conn: connA, providerCommentId: 'p-clas-old', providerMediaId: 'm-1', authorHandle: 'cust_clas', authorId: 'id_clas', status: 'CLASSIFIED', ageDays: 46, commentText: '분류 원문 F', withDraft: false, withAudit: false })
  seedComment({ id: cmDraftedOld, ws: wsA, conn: connA, providerCommentId: 'p-draf-old', providerMediaId: 'm-1', authorHandle: 'cust_draf', authorId: 'id_draf', status: 'DRAFTED', ageDays: 47, commentText: '초안 원문 G', withDraft: true, withAudit: false })
  seedComment({ id: cmApprovedOld, ws: wsA, conn: connA, providerCommentId: 'p-appr-old', providerMediaId: 'm-1', authorHandle: 'cust_appr', authorId: 'id_appr', status: 'APPROVED', ageDays: 48, commentText: '승인 원문 H', withDraft: true, withAudit: false })
  seedComment({ id: cmSendingOld, ws: wsA, conn: connA, providerCommentId: 'p-send-old', providerMediaId: 'm-1', authorHandle: 'cust_send', authorId: 'id_send', status: 'SENDING', ageDays: 49, commentText: '전송중 원문 I', withDraft: true, withAudit: false })
  seedComment({ id: cmNeedsCheckOld, ws: wsA, conn: connA, providerCommentId: 'p-chk-old', providerMediaId: 'm-1', authorHandle: 'cust_chk', authorId: 'id_chk', status: 'NEEDS_CHECK', ageDays: 50, commentText: '확인필요 원문 J', withDraft: false, withAudit: false })

  // wsB comment (33 days ago)
  seedComment({ id: cmWsBOld, ws: wsB, conn: connB, providerCommentId: 'p-wsb-old', providerMediaId: 'm-2', authorHandle: 'cust_wsb', authorId: 'id_wsb', status: 'SENT', ageDays: 33, commentText: '매장B 발송완료 K', withDraft: true, withAudit: true })
})

describe('Social comments retention purge on isolated PostgreSQL 16 (G-RET-COMMENT Gate)', () => {
  it('⑥ rejects calls from non-service_role callers with 42501', () => {
    const authRes = psql(`begin; set local role authenticated; select public.purge_expired_social_comment_data(30); commit;`)
    expect(authRes.status).not.toBe(0)
    expect(authRes.stderr).toMatch(/42501|PURGE_FORBIDDEN|permission denied/i)

    const anonRes = psql(`begin; set local role anon; select public.purge_expired_social_comment_data(30); commit;`)
    expect(anonRes.status).not.toBe(0)
    expect(anonRes.stderr).toMatch(/42501|PURGE_FORBIDDEN|permission denied/i)
  })

  it('⑦ rejects retention days below 7 or above 365 with 22023', () => {
    expect(() => callRpc('6')).toThrow(/22023|INVALID_RETENTION_DAYS/i)
    expect(() => callRpc('0')).toThrow(/22023|INVALID_RETENTION_DAYS/i)
    expect(() => callRpc('-5')).toThrow(/22023|INVALID_RETENTION_DAYS/i)
    expect(() => callRpc('366')).toThrow(/22023|INVALID_RETENTION_DAYS/i)
  })

  it('① ② ③ ④ ⑤ purges expired terminal comments (>30d) while preserving fresh/ongoing comments and audit logs', () => {
    const preDrafts = query<{ count: number }>(`select count(*)::int as count from public.comment_reply_drafts`)[0].count
    const preAudit = query<{ count: number }>(`select count(*)::int as count from public.engagement_audit`)[0].count
    expect(preDrafts).toBe(7)
    expect(preAudit).toBe(4)

    // Eligible terminal comments older than 30d:
    // wsA: cmSentOld (35d), cmDismissedOld (32d), cmFailedOld (40d) => 3 comments, 2 drafts
    // wsB: cmWsBOld (33d) => 1 comment, 1 draft
    // Total eligible = 4 comments, 3 drafts
    const result = callRpc('30')
    expect(result.comments).toBe(4)
    expect(result.drafts).toBe(3)
    expect(result.hasMore).toBe(false)

    // ① Expired terminal comments (>30 days) have comment_text & author redacted, provider_comment_id preserved, drafts deleted
    const purgedComments = query<{
      id: string
      comment_text: string
      author_handle: string
      author_id: string | null
      provider_comment_id: string
    }>(
      `select id, comment_text, author_handle, author_id, provider_comment_id from public.social_comments where id in ('${cmSentOld}', '${cmDismissedOld}', '${cmFailedOld}', '${cmWsBOld}') order by id asc`
    )
    expect(purgedComments).toHaveLength(4)
    for (const c of purgedComments) {
      expect(c.comment_text).toBe('[보존 기간 경과로 삭제됨]')
      expect(c.author_handle).toBe('[삭제됨]')
      expect(c.author_id).toBeNull()
      expect(c.provider_comment_id).toBeTruthy()
    }

    const purgedDrafts = query<{ id: string }>(
      `select id from public.comment_reply_drafts where comment_id in ('${cmSentOld}', '${cmDismissedOld}', '${cmFailedOld}', '${cmWsBOld}')`
    )
    expect(purgedDrafts).toHaveLength(0)

    // ② 29-day-old terminal comment (cmSentFresh) is preserved untouched
    const freshComment = query<{
      id: string
      comment_text: string
      author_handle: string
      author_id: string | null
    }>(
      `select id, comment_text, author_handle, author_id from public.social_comments where id = '${cmSentFresh}'`
    )[0]
    expect(freshComment.comment_text).toBe('신선한 발송완료 D')
    expect(freshComment.author_handle).toBe('cust_fresh')
    expect(freshComment.author_id).toBe('id_fresh')

    const freshDrafts = query<{ id: string }>(
      `select id from public.comment_reply_drafts where comment_id = '${cmSentFresh}'`
    )
    expect(freshDrafts).toHaveLength(1)

    // ③ Ongoing comments (RECEIVED, CLASSIFIED, DRAFTED, APPROVED, SENDING, NEEDS_CHECK) are preserved even if older than 30 days
    const ongoingComments = query<{
      id: string
      comment_text: string
      author_handle: string
      status: string
    }>(
      `select id, comment_text, author_handle, status from public.social_comments where id in ('${cmReceivedOld}', '${cmClassifiedOld}', '${cmDraftedOld}', '${cmApprovedOld}', '${cmSendingOld}', '${cmNeedsCheckOld}') order by status asc`
    )
    expect(ongoingComments).toHaveLength(6)
    expect(ongoingComments.find((c) => c.id === cmReceivedOld)?.comment_text).toBe('수신 원문 E')
    expect(ongoingComments.find((c) => c.id === cmClassifiedOld)?.comment_text).toBe('분류 원문 F')
    expect(ongoingComments.find((c) => c.id === cmDraftedOld)?.comment_text).toBe('초안 원문 G')
    expect(ongoingComments.find((c) => c.id === cmApprovedOld)?.comment_text).toBe('승인 원문 H')
    expect(ongoingComments.find((c) => c.id === cmSendingOld)?.comment_text).toBe('전송중 원문 I')
    expect(ongoingComments.find((c) => c.id === cmNeedsCheckOld)?.comment_text).toBe('확인필요 원문 J')

    // Ongoing comments' drafts are also preserved
    const ongoingDrafts = query<{ id: string }>(
      `select id from public.comment_reply_drafts where comment_id in ('${cmDraftedOld}', '${cmApprovedOld}')`
    )
    expect(ongoingDrafts).toHaveLength(2)

    // ⑤ Audit rows are NOT deleted; comment_id foreign key links remain intact
    const postAudit = query<{ id: string; comment_id: string; action: string }>(
      `select id, comment_id, action from public.engagement_audit order by created_at asc`
    )
    expect(postAudit).toHaveLength(preAudit)
    expect(postAudit.find((a) => a.comment_id === cmSentOld)).toBeDefined()
    expect(postAudit.find((a) => a.comment_id === cmDismissedOld)).toBeDefined()
    expect(postAudit.find((a) => a.comment_id === cmWsBOld)).toBeDefined()

    // ⑨ Subsequent call: idempotent no-op returns 0s and hasMore: false
    const rerun = callRpc('30')
    expect(rerun).toEqual({
      comments: 0,
      drafts: 0,
      hasMore: false,
    })
  })

  it('⑧ handles batch processing limit and reports hasMore correctly', () => {
    // Generate 1005 expired terminal comments in wsB to exceed the 1000 batch limit
    const batchSeed = `
      insert into public.social_comments
        (id, workspace_id, channel_connection_id, channel, provider_comment_id, provider_media_id,
         author_handle, author_id, comment_text, comment_created_at, status, created_at, updated_at)
      select
        gen_random_uuid(),
        '${wsB}',
        '${connB}',
        'instagram',
        'batch-comm-' || i::text,
        'batch-media-' || i::text,
        'batch_handle_' || i::text,
        'batch_cust_' || i::text,
        '대량 댓글 원문 ' || i::text,
        now() - interval '40 days',
        'SENT',
        now() - interval '40 days',
        now() - interval '40 days'
      from generate_series(1, 1005) as s(i);
    `
    const insertRes = psql(batchSeed)
    expect(insertRes.status).toBe(0)

    // Batch 1: should process exactly 1000 items and report hasMore: true
    const batch1 = callRpc('30')
    expect(batch1.comments).toBe(1000)
    expect(batch1.hasMore).toBe(true)

    // Batch 2: should process remaining 5 items and report hasMore: false
    const batch2 = callRpc('30')
    expect(batch2.comments).toBe(5)
    expect(batch2.hasMore).toBe(false)
  })
})
