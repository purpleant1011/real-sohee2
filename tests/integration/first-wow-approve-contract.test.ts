import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'

/**
 * ANI-1762 후속 — first-wow-approve 실 DB 계약 테스트 (mock 금지).
 *
 * 배경: tests/unit/first-wow-approve-route.test.ts 는 admin 클라이언트를 mock 으로 대체해
 * insert 가 항상 { data: null, error: null } 을 돌려준다. 그래서 라우트가 정본 NOT NULL
 * 컬럼을 비운 채 insert 해도 초록이었다. 실제 DB 에서는
 *   null value in column "channel" ... violates not-null constraint
 * 로 500 이 났고, 그 사실이 mock 테스트로는 드러나지 않았다.
 *
 * 이 테스트는 그 구멍을 닫는다. mock 을 쓰지 않고 실제 PostgreSQL 에 insert 해서
 * 라우트가 만드는 payload 형태가 정본 스키마 계약을 만족하는지 확인한다.
 *
 * 실행 조건: SOHEE_CONTRACT_PG_CONTAINER (예: supabase_db_sohee-e2e-r2) 가 설정된 경우에만
 * 실제 DB 로 돈다. 없으면 skip 하되, skip 이 통과를 뜻하지 않음을 이름에 명시한다.
 */

const CONTAINER = process.env.SOHEE_CONTRACT_PG_CONTAINER
const runSql = (sql: string): { status: number | null; stdout: string; stderr: string } => {
  const out = spawnSync('docker', ['exec', '-i', CONTAINER as string, 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1'], {
    input: sql,
    encoding: 'utf8',
  })
  return { status: out.status, stdout: out.stdout ?? '', stderr: out.stderr ?? '' }
}

describe.skipIf(!CONTAINER)('first-wow-approve 실 DB 계약 (PostgreSQL)', () => {
  it('정본 컬럼을 모두 채운 payload 는 external_action_requests 에 실제로 저장된다', () => {
    const suffix = Date.now().toString(36)
    const userId = randomUUID()
    const workspaceId = randomUUID()
    const sql = `
begin;
insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
values ('${userId}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'contract-${suffix}@example.test', now(), now())
on conflict (id) do nothing;
insert into public.workspaces (id, name, created_by, created_at, updated_at)
values ('${workspaceId}', 'contract-${suffix}', '${userId}', now(), now())
on conflict (id) do nothing;
insert into public.external_action_requests
  (workspace_id, channel, action_kind, target_external_id, target_label, exact_payload,
   idempotency_key, status, created_by)
values
  ('${workspaceId}', 'instagram', 'feed_publish',
   'instagram:@contract_target', '@contract_target', '{"source":"first_wow_approval"}'::jsonb,
   'first_wow:contract-${suffix}', 'prepared', '${userId}')
returning channel, action_kind, status;
rollback;
`
    const result = runSql(sql)
    expect(result.stderr).toBe('')
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('instagram|feed_publish|prepared')
  })

  it('레거시 payload(action_type/target_channel만 채움)는 실 DB 에서 거부된다 — #1922 이전 500 의 원인', () => {
    const suffix = Date.now().toString(36)
    const userId = randomUUID()
    const workspaceId = randomUUID()
    const sql = `
begin;
insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
values ('${userId}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'legacy-${suffix}@example.test', now(), now())
on conflict (id) do nothing;
insert into public.workspaces (id, name, created_by, created_at, updated_at)
values ('${workspaceId}', 'legacy-${suffix}', '${userId}', now(), now())
on conflict (id) do nothing;
insert into public.external_action_requests
  (workspace_id, action_type, target_channel, status, created_by)
values
  ('${workspaceId}', 'PUBLISH_CONTENT', 'instagram', 'QUEUED', '${userId}');
rollback;
`
    const result = runSql(sql)
    // 실 DB 는 반드시 실패해야 한다. 이 실패를 mock 테스트가 가리고 있었다.
    expect(result.status).not.toBe(0)
    expect(result.stderr).toMatch(/null value in column "(channel|action_kind)"/)
  })
})
