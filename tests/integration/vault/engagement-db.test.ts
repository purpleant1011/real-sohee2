import { beforeAll, describe, expect, it } from 'vitest'
import { pgClient, query } from './pg-client'
import { spawnSync } from 'node:child_process'

const userA = '73111111-1111-4111-8111-111111111111'
const outsider = '73222222-2222-4222-8222-222222222222'
const wsA = '83111111-1111-4111-8111-111111111111'
const wsB = '83222222-2222-4222-8222-222222222222'
const connId = '93111111-1111-4111-8111-111111111111'
const commentId = '93222222-2222-4222-8222-222222222222'

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
  query(`with w as (insert into public.workspaces (id, name, created_by) values ('${wsA}', '매장 A', '${userA}'), ('${wsB}', '매장 B', '${outsider}') returning id) select id from w`)
  query(`with c as (insert into public.channel_connections (id, workspace_id, channel, status, external_account_id) values ('${connId}', '${wsA}', 'instagram', 'connected', 'ig_acc_1') returning id) select id from c`)
})

describe('Engagement DB model on real PostgreSQL 16', () => {
  it('enforces unique constraints and CHECK constraints on social_comments', () => {
    // Insert valid comment
    query(`with c as (insert into public.social_comments
      (id, workspace_id, channel_connection_id, channel, provider_comment_id, provider_media_id, author_handle, comment_text, comment_created_at, status)
      values ('${commentId}', '${wsA}', '${connId}', 'instagram', 'prov-c-1', 'med-1', 'cust_1', '너무 좋아요', now(), 'RECEIVED')
      returning id) select id from c`)

    // Duplicate provider_comment_id for same workspace + channel must fail
    const dupResult = psql(`insert into public.social_comments
      (workspace_id, channel_connection_id, channel, provider_comment_id, provider_media_id, author_handle, comment_text, comment_created_at)
      values ('${wsA}', '${connId}', 'instagram', 'prov-c-1', 'med-1', 'cust_1', '중복', now());`)
    expect(dupResult.status).not.toBe(0)
    expect(dupResult.stderr).toMatch(/unique|duplicate/i)

    // Invalid channel CHECK constraint
    const invalidChannel = psql(`insert into public.social_comments
      (workspace_id, channel_connection_id, channel, provider_comment_id, provider_media_id, author_handle, comment_text, comment_created_at)
      values ('${wsA}', '${connId}', 'youtube', 'prov-c-2', 'med-1', 'cust_1', '유튜브', now());`)
    expect(invalidChannel.status).not.toBe(0)
    expect(invalidChannel.stderr).toMatch(/check constraint/i)

    // Invalid status CHECK constraint
    const invalidStatus = psql(`insert into public.social_comments
      (workspace_id, channel_connection_id, channel, provider_comment_id, provider_media_id, author_handle, comment_text, comment_created_at, status)
      values ('${wsA}', '${connId}', 'instagram', 'prov-c-3', 'med-1', 'cust_1', '체크', now(), 'INVALID_STATUS');`)
    expect(invalidStatus.status).not.toBe(0)
    expect(invalidStatus.stderr).toMatch(/check constraint/i)
  })

  it('enforces uniqueness on comment_reply_drafts and engagement_policies', () => {
    // Valid draft insert
    query(`with d as (insert into public.comment_reply_drafts (workspace_id, comment_id, draft_text)
      values ('${wsA}', '${commentId}', '감사합니다!') returning id) select id from d`)

    // Duplicate draft for same comment must fail
    const dupDraft = psql(`insert into public.comment_reply_drafts (workspace_id, comment_id, draft_text)
      values ('${wsA}', '${commentId}', '중복 초안');`)
    expect(dupDraft.status).not.toBe(0)
    expect(dupDraft.stderr).toMatch(/unique|duplicate/i)

    // Valid policy insert
    query(`with p as (insert into public.engagement_policies (workspace_id, channel, auto_reply_enabled, daily_cap)
      values ('${wsA}', 'instagram', true, 5) returning id) select id from p`)

    // Duplicate policy for same workspace + channel must fail
    const dupPolicy = psql(`insert into public.engagement_policies (workspace_id, channel, auto_reply_enabled, daily_cap)
      values ('${wsA}', 'instagram', false, 10);`)
    expect(dupPolicy.status).not.toBe(0)
    expect(dupPolicy.stderr).toMatch(/unique|duplicate/i)

    // Invalid daily_cap CHECK (e.g. 150 > 100)
    const invalidCap = psql(`insert into public.engagement_policies (workspace_id, channel, daily_cap)
      values ('${wsA}', 'threads', 150);`)
    expect(invalidCap.status).not.toBe(0)
    expect(invalidCap.stderr).toMatch(/check constraint/i)
  })

  it('enforces RLS: workspace member can SELECT, outsider sees zero rows', () => {
    const memberRows = query<{ id: string }>(`select id from public.social_comments where workspace_id='${wsA}'`, userA)
    expect(memberRows.length).toBeGreaterThanOrEqual(1)

    const outsiderRows = query<{ id: string }>(`select id from public.social_comments where workspace_id='${wsA}'`, outsider)
    expect(outsiderRows.length).toBe(0)
  })

  it('prohibits direct mutation on append-only engagement_audit, but cascades when workspace is deleted', () => {
    // Insert audit row
    query(`with a as (insert into public.engagement_audit
      (workspace_id, comment_id, channel, actor, action, details)
      values ('${wsA}', '${commentId}', 'instagram', 'system', 'auto_reply', '{"test":true}')
      returning id) select id from a`)

    // Direct update on engagement_audit must fail with trigger exception
    const updateRes = psql(`update public.engagement_audit set action='manual_send' where workspace_id='${wsA}';`)
    expect(updateRes.status).not.toBe(0)
    expect(updateRes.stderr).toMatch(/ENGAGEMENT_AUDIT_APPEND_ONLY/i)

    // Direct delete while workspace exists must fail
    const deleteRes = psql(`delete from public.engagement_audit where workspace_id='${wsA}';`)
    expect(deleteRes.status).not.toBe(0)
    expect(deleteRes.stderr).toMatch(/ENGAGEMENT_AUDIT_APPEND_ONLY/i)

    // Now delete the workspace: cascade must succeed without trigger error!
    const cascadeRes = psql(`delete from public.workspaces where id='${wsA}';`)
    expect(cascadeRes.status).toBe(0)

    // All engagement tables for wsA must now be 0 rows
    const commentsCount = query<{ count: number }>(`select count(*)::int as count from public.social_comments where workspace_id='${wsA}'`)[0].count
    const draftsCount = query<{ count: number }>(`select count(*)::int as count from public.comment_reply_drafts where workspace_id='${wsA}'`)[0].count
    const policiesCount = query<{ count: number }>(`select count(*)::int as count from public.engagement_policies where workspace_id='${wsA}'`)[0].count
    const auditCount = query<{ count: number }>(`select count(*)::int as count from public.engagement_audit where workspace_id='${wsA}'`)[0].count

    expect(commentsCount).toBe(0)
    expect(draftsCount).toBe(0)
    expect(policiesCount).toBe(0)
    expect(auditCount).toBe(0)
  })

  it('verifies indexes exist on every foreign key column', () => {
    const indexes = query<{ indexname: string }>(`
      select indexname from pg_indexes
      where schemaname = 'public' and tablename in ('social_comments', 'comment_reply_drafts', 'engagement_policies', 'engagement_audit')
    `).map(r => r.indexname)

    expect(indexes).toContain('idx_social_comments_workspace_conn')
    expect(indexes).toContain('idx_comment_reply_drafts_workspace_comment')
    expect(indexes).toContain('idx_comment_reply_drafts_approved_by')
    expect(indexes).toContain('idx_engagement_audit_workspace_comment')
    expect(indexes).toContain('idx_engagement_audit_actor_user')
    expect(indexes).toContain('idx_engagement_audit_workspace_created')
  })
})
