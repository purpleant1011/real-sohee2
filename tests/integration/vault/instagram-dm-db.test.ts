import { beforeAll, describe, expect, it } from 'vitest'
import { pgClient, query } from './pg-client'
import { spawnSync } from 'node:child_process'

const userA = '63111111-1111-4111-8111-111111111111'
const outsider = '63222222-2222-4222-8222-222222222222'
const wsA = '73111111-1111-4111-8111-111111111111'
const wsB = '73222222-2222-4222-8222-222222222222'
const connId = '83111111-1111-4111-8111-111111111111'
const threadId = '93111111-1111-4111-8111-111111111111'
const msgId = '93222222-2222-4222-8222-222222222222'

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
  query(`with u as (insert into auth.users (id) values ('${userA}'), ('${outsider}') returning id) select id from u`)
  query(`with w as (insert into public.workspaces (id, name, created_by) values ('${wsA}', 'DM 매장 A', '${userA}'), ('${wsB}', 'DM 매장 B', '${outsider}') returning id) select id from w`)
  query(`with c as (insert into public.channel_connections (id, workspace_id, channel, status, external_account_id) values ('${connId}', '${wsA}', 'instagram', 'connected', 'ig_acc_dm_1') returning id) select id from c`)
})

describe('Instagram DM DB model on real PostgreSQL 16 (ANI-DM Phase 2)', () => {
  it('enforces channel and status constraints on instagram_dm_threads (Hard Invariant 1)', () => {
    // Valid insert
    query(`with t as (insert into public.instagram_dm_threads
      (id, workspace_id, channel_connection_id, channel, provider_thread_id, customer_id, customer_handle, last_message_at, expires_at, status, last_message_text)
      values ('${threadId}', '${wsA}', '${connId}', 'instagram', 'prov-th-1', 'c-1', 'cust_1', now(), now() + interval '24 hours', 'NEEDS_REPLY', '예약 문의')
      returning id) select id from t`)

    // Channel must be 'instagram' ONLY (Threads does not have DM API)
    const invalidChannel = psql(`insert into public.instagram_dm_threads
      (workspace_id, channel_connection_id, channel, provider_thread_id, customer_id, customer_handle, last_message_at, expires_at, status, last_message_text)
      values ('${wsA}', '${connId}', 'threads', 'prov-th-2', 'c-2', 'cust_2', now(), now() + interval '24 hours', 'NEEDS_REPLY', '스레드 DM 시도');`)
    expect(invalidChannel.status).not.toBe(0)
    expect(invalidChannel.stderr).toMatch(/check constraint/i)

    // Invalid status CHECK constraint
    const invalidStatus = psql(`insert into public.instagram_dm_threads
      (workspace_id, channel_connection_id, channel, provider_thread_id, customer_id, customer_handle, last_message_at, expires_at, status, last_message_text)
      values ('${wsA}', '${connId}', 'instagram', 'prov-th-3', 'c-3', 'cust_3', now(), now() + interval '24 hours', 'INVALID_STATUS', '체크');`)
    expect(invalidStatus.status).not.toBe(0)
    expect(invalidStatus.stderr).toMatch(/check constraint/i)

    // Duplicate provider_thread_id within workspace must fail
    const dupThread = psql(`insert into public.instagram_dm_threads
      (workspace_id, channel_connection_id, channel, provider_thread_id, customer_id, customer_handle, last_message_at, expires_at, status, last_message_text)
      values ('${wsA}', '${connId}', 'instagram', 'prov-th-1', 'c-4', 'cust_4', now(), now() + interval '24 hours', 'NEEDS_REPLY', '중복');`)
    expect(dupThread.status).not.toBe(0)
    expect(dupThread.stderr).toMatch(/unique|duplicate/i)
  })

  it('enforces sender_type constraint and uniqueness on instagram_dm_messages', () => {
    // Valid message insert
    query(`with m as (insert into public.instagram_dm_messages
      (id, workspace_id, thread_id, provider_message_id, sender_type, sender_id, text, sent_at)
      values ('${msgId}', '${wsA}', '${threadId}', 'prov-m-1', 'customer', 'c-1', '안녕하세요!', now())
      returning id) select id from m`)

    // Invalid sender_type CHECK constraint
    const invalidSender = psql(`insert into public.instagram_dm_messages
      (workspace_id, thread_id, provider_message_id, sender_type, sender_id, text, sent_at)
      values ('${wsA}', '${threadId}', 'prov-m-2', 'unknown_bot', 'c-1', '봇 메시지', now());`)
    expect(invalidSender.status).not.toBe(0)
    expect(invalidSender.stderr).toMatch(/check constraint/i)

    // Duplicate provider_message_id must fail
    const dupMsg = psql(`insert into public.instagram_dm_messages
      (workspace_id, thread_id, provider_message_id, sender_type, sender_id, text, sent_at)
      values ('${wsA}', '${threadId}', 'prov-m-1', 'business', 'b-1', '중복 메시지', now());`)
    expect(dupMsg.status).not.toBe(0)
    expect(dupMsg.stderr).toMatch(/unique|duplicate/i)
  })

  it('enforces uniqueness and option checks on instagram_dm_drafts', () => {
    // Valid draft insert
    query(`with d as (insert into public.instagram_dm_drafts
      (workspace_id, thread_id, selected_option_id, options, draft_text)
      values ('${wsA}', '${threadId}', 'opt_1', '[{"id":"opt_1","label":"예약 안내","draftText":"예약 안내 문안"}]'::jsonb, '예약 안내 문안')
      returning id) select id from d`)

    // Duplicate draft for same thread must fail
    const dupDraft = psql(`insert into public.instagram_dm_drafts
      (workspace_id, thread_id, draft_text)
      values ('${wsA}', '${threadId}', '중복 초안');`)
    expect(dupDraft.status).not.toBe(0)
    expect(dupDraft.stderr).toMatch(/unique|duplicate/i)
  })

  it('enforces RLS: workspace member can SELECT, outsider sees zero rows', () => {
    const memberThreads = query<{ id: string }>(`select id from public.instagram_dm_threads where workspace_id='${wsA}'`, userA)
    expect(memberThreads.length).toBeGreaterThanOrEqual(1)

    const outsiderThreads = query<{ id: string }>(`select id from public.instagram_dm_threads where workspace_id='${wsA}'`, outsider)
    expect(outsiderThreads.length).toBe(0)
  })

  it('prohibits direct mutation on append-only instagram_dm_audit, but cascades when workspace is deleted', () => {
    // Insert audit log row
    query(`with a as (insert into public.instagram_dm_audit
      (workspace_id, thread_id, actor, action, details)
      values ('${wsA}', '${threadId}', 'owner', 'manual_send', '{"test":true}')
      returning id) select id from a`)

    // Direct UPDATE must fail with INSTAGRAM_DM_AUDIT_APPEND_ONLY
    const updateRes = psql(`update public.instagram_dm_audit set action='dismiss' where workspace_id='${wsA}';`)
    expect(updateRes.status).not.toBe(0)
    expect(updateRes.stderr).toMatch(/INSTAGRAM_DM_AUDIT_APPEND_ONLY/i)

    // Direct DELETE while workspace exists must fail
    const deleteRes = psql(`delete from public.instagram_dm_audit where workspace_id='${wsA}';`)
    expect(deleteRes.status).not.toBe(0)
    expect(deleteRes.stderr).toMatch(/INSTAGRAM_DM_AUDIT_APPEND_ONLY/i)

    // Delete workspace: cascade must delete all DM tables cleanly without trigger error
    const cascadeRes = psql(`delete from public.workspaces where id='${wsA}';`)
    expect(cascadeRes.status).toBe(0)

    const threadsCount = query<{ count: number }>(`select count(*)::int as count from public.instagram_dm_threads where workspace_id='${wsA}'`)[0].count
    const msgsCount = query<{ count: number }>(`select count(*)::int as count from public.instagram_dm_messages where workspace_id='${wsA}'`)[0].count
    const draftsCount = query<{ count: number }>(`select count(*)::int as count from public.instagram_dm_drafts where workspace_id='${wsA}'`)[0].count
    const auditCount = query<{ count: number }>(`select count(*)::int as count from public.instagram_dm_audit where workspace_id='${wsA}'`)[0].count

    expect(threadsCount).toBe(0)
    expect(msgsCount).toBe(0)
    expect(draftsCount).toBe(0)
    expect(auditCount).toBe(0)
  })
})
