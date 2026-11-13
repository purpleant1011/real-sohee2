import { spawnSync } from 'node:child_process'
import { beforeAll, describe, expect, it } from 'vitest'
import { query } from './pg-client'

const ownerA = '73111111-1111-4111-8111-111111111111'
const ownerB = '73222222-2222-4222-8222-222222222222'
const wsA = '83111111-1111-4111-8111-111111111111'
const wsB = '83222222-2222-4222-8222-222222222222'
const connA = '93111111-1111-4111-8111-111111111111'
const connB = '93222222-2222-4222-8222-222222222222'

// Threads for wsA
const thSentOld = 'a1111111-1111-4111-8111-111111111111'      // SENT, 35 days ago (should purge)
const thDismissedOld = 'a2222222-2222-4222-8222-222222222222' // DISMISSED, 31 days ago (should purge)
const thExpiredOld = 'a3333333-3333-4333-8333-333333333333'   // EXPIRED, 40 days ago (should purge)
const thSentFresh = 'a4444444-4444-4444-8444-444444444444'    // SENT, 29 days ago (should NOT purge)
const thNeedsReplyOld = 'a5555555-5555-4555-8555-555555555555'// NEEDS_REPLY, 45 days ago (should NOT purge)
const thNeedsCheckOld = 'a6666666-6666-4666-8666-666666666666'// NEEDS_CHECK, 50 days ago (should NOT purge)

// Thread for wsB
const thWsBOld = 'b1111111-1111-4111-8111-111111111111'        // SENT, 32 days ago in wsB

// Real PG sessions, not mock query responses
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
  threads: number
  messages: number
  drafts: number
  hasMore: boolean
} {
  const run = psql(`begin; set local role ${role}; select public.purge_expired_instagram_dm_data(${args})::text; commit;`)
  if (run.status !== 0) throw new Error(run.stderr)
  const line = run.stdout.trim().split('\n').find((l) => l.startsWith('{'))
  if (!line) throw new Error(`No json output: ${run.stdout}`)
  return JSON.parse(line)
}

function seedThread(params: {
  id: string
  ws: string
  conn: string
  providerThreadId: string
  status: string
  ageDays: number
  lastText: string
  withMessage?: boolean
  withDraft?: boolean
  withAudit?: boolean
}) {
  const { id, ws, conn, providerThreadId, status, ageDays, lastText, withMessage, withDraft, withAudit } = params
  const lastAt = `now() - interval '${ageDays} days'`

  query(`with t as (insert into public.instagram_dm_threads
    (id, workspace_id, channel_connection_id, channel, provider_thread_id, customer_id, customer_handle, last_message_at, expires_at, status, last_message_text)
    values ('${id}', '${ws}', '${conn}', 'instagram', '${providerThreadId}', 'c-${id.slice(0, 8)}', 'user_${id.slice(0, 8)}', ${lastAt}, ${lastAt} + interval '24 hours', '${status}', '${lastText}')
    returning id) select id from t`)

  if (withMessage) {
    query(`with m as (insert into public.instagram_dm_messages
      (workspace_id, thread_id, provider_message_id, sender_type, sender_id, text, sent_at)
      values ('${ws}', '${id}', 'msg-${id.slice(0, 8)}', 'customer', 'c-${id.slice(0, 8)}', '고객 메시지 원문 ${id.slice(0, 8)}', ${lastAt})
      returning id) select id from m`)
  }

  if (withDraft) {
    query(`with d as (insert into public.instagram_dm_drafts
      (workspace_id, thread_id, selected_option_id, options, draft_text)
      values ('${ws}', '${id}', 'opt_1', '[{"id":"opt_1","draftText":"초안 원문 ${id.slice(0, 8)}"}]'::jsonb, '초안 원문 ${id.slice(0, 8)}')
      returning id) select id from d`)
  }

  if (withAudit) {
    query(`with a as (insert into public.instagram_dm_audit
      (workspace_id, thread_id, actor, action, details)
      values ('${ws}', '${id}', 'owner', 'manual_send', '{"draftText":"발송 원문 ${id.slice(0, 8)}"}')
      returning id) select id from a`)
  }
}

beforeAll(() => {
  query(`with u as (insert into auth.users (id) values ('${ownerA}'), ('${ownerB}') returning id) select id from u`)
  query(`with w as (insert into public.workspaces (id, name, created_by) values ('${wsA}', '매장 A', '${ownerA}'), ('${wsB}', '매장 B', '${ownerB}') returning id) select id from w`)
  query(`with c as (insert into public.channel_connections (id, workspace_id, channel, status, external_account_id)
    values ('${connA}', '${wsA}', 'instagram', 'connected', 'ig_acc_a'),
           ('${connB}', '${wsB}', 'instagram', 'connected', 'ig_acc_b') returning id) select id from c`)

  // wsA threads
  seedThread({ id: thSentOld, ws: wsA, conn: connA, providerThreadId: 'p-sent-old', status: 'SENT', ageDays: 35, lastText: '발송완료 원문 A', withMessage: true, withDraft: true, withAudit: true })
  seedThread({ id: thDismissedOld, ws: wsA, conn: connA, providerThreadId: 'p-dism-old', status: 'DISMISSED', ageDays: 31, lastText: '무시된 원문 B', withMessage: true, withDraft: true, withAudit: true })
  seedThread({ id: thExpiredOld, ws: wsA, conn: connA, providerThreadId: 'p-exp-old', status: 'EXPIRED', ageDays: 40, lastText: '만료된 원문 C', withMessage: true, withDraft: true, withAudit: false })
  seedThread({ id: thSentFresh, ws: wsA, conn: connA, providerThreadId: 'p-sent-fresh', status: 'SENT', ageDays: 29, lastText: '신선한 발송완료 D', withMessage: true, withDraft: true, withAudit: true })
  seedThread({ id: thNeedsReplyOld, ws: wsA, conn: connA, providerThreadId: 'p-nr-old', status: 'NEEDS_REPLY', ageDays: 45, lastText: '답변대기 원문 E', withMessage: true, withDraft: true, withAudit: false })
  seedThread({ id: thNeedsCheckOld, ws: wsA, conn: connA, providerThreadId: 'p-nc-old', status: 'NEEDS_CHECK', ageDays: 50, lastText: '확인필요 원문 F', withMessage: true, withDraft: true, withAudit: false })

  // wsB thread (32 days ago)
  seedThread({ id: thWsBOld, ws: wsB, conn: connB, providerThreadId: 'p-wsb-old', status: 'SENT', ageDays: 32, lastText: '매장B 발송완료 G', withMessage: true, withDraft: true, withAudit: true })
})

describe('Instagram DM retention purge on isolated PostgreSQL 16 (G-RET Gate)', () => {
  it('⑥ rejects calls from non-service_role callers with 42501', () => {
    // authenticated role
    const authRes = psql(`begin; set local role authenticated; select public.purge_expired_instagram_dm_data(30); commit;`)
    expect(authRes.status).not.toBe(0)
    expect(authRes.stderr).toMatch(/42501|PURGE_FORBIDDEN|permission denied/i)

    // anon role
    const anonRes = psql(`begin; set local role anon; select public.purge_expired_instagram_dm_data(30); commit;`)
    expect(anonRes.status).not.toBe(0)
    expect(anonRes.stderr).toMatch(/42501|PURGE_FORBIDDEN|permission denied/i)
  })

  it('⑦ rejects retention days below 7 or above 365 with 22023', () => {
    expect(() => callRpc('6')).toThrow(/22023|INVALID_RETENTION_DAYS/i)
    expect(() => callRpc('0')).toThrow(/22023|INVALID_RETENTION_DAYS/i)
    expect(() => callRpc('-5')).toThrow(/22023|INVALID_RETENTION_DAYS/i)
    expect(() => callRpc('366')).toThrow(/22023|INVALID_RETENTION_DAYS/i)
  })

  it('① ② ③ ④ ⑤ purges expired terminal threads (>30d) while preserving fresh/ongoing threads and audit logs', () => {
    // Pre-check counts
    const preMessages = query<{ count: number }>(`select count(*)::int as count from public.instagram_dm_messages`)[0].count
    const preDrafts = query<{ count: number }>(`select count(*)::int as count from public.instagram_dm_drafts`)[0].count
    const preAudit = query<{ count: number }>(`select count(*)::int as count from public.instagram_dm_audit`)[0].count
    expect(preMessages).toBe(7)
    expect(preDrafts).toBe(7)
    expect(preAudit).toBe(4)

    // Execute purge with default 30 days
    // Eligible terminal threads older than 30d:
    // wsA: thSentOld (35d), thDismissedOld (31d), thExpiredOld (40d) => 3
    // wsB: thWsBOld (32d) => 1
    // Total eligible = 4 threads
    const result = callRpc('30')
    expect(result.threads).toBe(4)
    expect(result.messages).toBe(4)
    expect(result.drafts).toBe(4)
    expect(result.hasMore).toBe(false)

    // ① Expired terminal threads (>30 days) had their messages and drafts deleted, last_message_text redacted
    const purgedThreads = query<{ id: string; last_message_text: string }>(
      `select id, last_message_text from public.instagram_dm_threads where id in ('${thSentOld}', '${thDismissedOld}', '${thExpiredOld}', '${thWsBOld}')`
    )
    expect(purgedThreads).toHaveLength(4)
    for (const t of purgedThreads) {
      expect(t.last_message_text).toBe('[보존 기간 경과로 삭제됨]')
    }

    const purgedMessages = query<{ id: string }>(
      `select id from public.instagram_dm_messages where thread_id in ('${thSentOld}', '${thDismissedOld}', '${thExpiredOld}', '${thWsBOld}')`
    )
    expect(purgedMessages).toHaveLength(0)

    const purgedDrafts = query<{ id: string }>(
      `select id from public.instagram_dm_drafts where thread_id in ('${thSentOld}', '${thDismissedOld}', '${thExpiredOld}', '${thWsBOld}')`
    )
    expect(purgedDrafts).toHaveLength(0)

    // ② 29-day-old terminal thread (thSentFresh) is preserved untouched
    const freshThread = query<{ id: string; last_message_text: string }>(
      `select id, last_message_text from public.instagram_dm_threads where id = '${thSentFresh}'`
    )[0]
    expect(freshThread.last_message_text).toBe('신선한 발송완료 D')

    const freshMessages = query<{ id: string }>(
      `select id from public.instagram_dm_messages where thread_id = '${thSentFresh}'`
    )
    expect(freshMessages).toHaveLength(1)

    const freshDrafts = query<{ id: string }>(
      `select id from public.instagram_dm_drafts where thread_id = '${thSentFresh}'`
    )
    expect(freshDrafts).toHaveLength(1)

    // ③ Ongoing threads (NEEDS_REPLY, NEEDS_CHECK) are preserved even if older than 30 days
    const ongoingThreads = query<{ id: string; last_message_text: string }>(
      `select id, last_message_text from public.instagram_dm_threads where id in ('${thNeedsReplyOld}', '${thNeedsCheckOld}')`
    )
    expect(ongoingThreads).toHaveLength(2)
    expect(ongoingThreads.find((t) => t.id === thNeedsReplyOld)?.last_message_text).toBe('답변대기 원문 E')
    expect(ongoingThreads.find((t) => t.id === thNeedsCheckOld)?.last_message_text).toBe('확인필요 원문 F')

    const ongoingMessages = query<{ id: string }>(
      `select id from public.instagram_dm_messages where thread_id in ('${thNeedsReplyOld}', '${thNeedsCheckOld}')`
    )
    expect(ongoingMessages).toHaveLength(2)

    // ⑤ Audit rows are NOT deleted; thread_id foreign key links remain intact
    const postAudit = query<{ id: string; thread_id: string; action: string }>(
      `select id, thread_id, action from public.instagram_dm_audit order by created_at asc`
    )
    expect(postAudit).toHaveLength(preAudit)
    expect(postAudit.find((a) => a.thread_id === thSentOld)).toBeDefined()
    expect(postAudit.find((a) => a.thread_id === thDismissedOld)).toBeDefined()
    expect(postAudit.find((a) => a.thread_id === thWsBOld)).toBeDefined()

    // Subsequent call: idempotent no-op returns 0s and hasMore: false
    const rerun = callRpc('30')
    expect(rerun).toEqual({
      threads: 0,
      messages: 0,
      drafts: 0,
      hasMore: false,
    })
  })

  it('⑧ handles batch processing limit and reports hasMore correctly', () => {
    // Generate 1005 expired terminal threads in wsB to exceed the 1000 batch limit
    const batchSeed = `
      insert into public.instagram_dm_threads
        (id, workspace_id, channel_connection_id, channel, provider_thread_id, customer_id, customer_handle, last_message_at, expires_at, status, last_message_text)
      select
        gen_random_uuid(),
        '${wsB}',
        '${connB}',
        'instagram',
        'batch-prov-' || i::text,
        'batch-cust-' || i::text,
        'batch_handle_' || i::text,
        now() - interval '40 days',
        now() - interval '39 days',
        'SENT',
        '대량 테스트 원문 ' || i::text
      from generate_series(1, 1005) as s(i);
    `
    const insertRes = psql(batchSeed)
    expect(insertRes.status).toBe(0)

    // Batch 1: should process exactly 1000 items and report hasMore: true
    const batch1 = callRpc('30')
    expect(batch1.threads).toBe(1000)
    expect(batch1.hasMore).toBe(true)

    // Batch 2: should process remaining 5 items and report hasMore: false
    const batch2 = callRpc('30')
    expect(batch2.threads).toBe(5)
    expect(batch2.hasMore).toBe(false)
  })
})
