// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const bin = process.env.PG_BIN ?? '/opt/homebrew/opt/postgresql@16/bin'
const root = mkdtempSync('/tmp/sohee-run-repair-pg-')
const data = join(root, 'data')
const args = ['-h', root, '-U', process.env.USER ?? 'postgres', '-d', 'postgres', '-XAt', '-v', 'ON_ERROR_STOP=1']
const sql = (text: string) => execFileSync(join(bin, 'psql'), [...args, '-c', text], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
const workspace = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const run = '11111111-1111-4111-8111-111111111111'
const snapshot = '2026-10-26T16:06:59.89488Z'
const script = join(process.cwd(), 'scripts/repair-interrupted-agent-run.sql')
let started = false

beforeAll(() => {
  execFileSync(join(bin, 'initdb'), ['-D', data, '-A', 'trust', '--no-locale'], { stdio: 'pipe' })
  execFileSync(join(bin, 'pg_ctl'), ['-D', data, '-l', join(root, 'postgres.log'), '-o', `-k ${root} -h ''`, '-w', 'start'], { stdio: 'pipe', env: { ...process.env, LC_ALL: 'C' } })
  started = true
  sql(`create table conversation_jobs (
    id uuid primary key, workspace_id uuid, kind text default 'chat', status text default 'running',
    updated_at timestamptz, queued_at timestamptz, started_at timestamptz, heartbeat_at timestamptz,
    completed_at timestamptz, assistant_message_id uuid, worker_id uuid, reservation_id uuid,
    queue_dispatched_at timestamptz, attempt_count integer default 0, safe_error_code text,
    plan_data jsonb default '{}',
    check ((status in ('running','cancel_requested') and completed_at is null)
      or (status in ('succeeded','cancelled','needs_attention') and completed_at is not null)));
    create table conversation_job_steps (job_id uuid references conversation_jobs(id));
    create table agent_activity_events (run_id uuid references conversation_jobs(id));`)
}, 20000)
afterAll(() => {
  if (started) execFileSync(join(bin, 'pg_ctl'), ['-D', data, '-m', 'immediate', '-w', 'stop'], { stdio: 'pipe' })
  rmSync(root, { recursive: true, force: true })
})

function reset() {
  sql(`truncate conversation_job_steps, agent_activity_events, conversation_jobs;
    insert into conversation_jobs(id,workspace_id,updated_at,queued_at,plan_data)
    values ('${run}','${workspace}','${snapshot}','${snapshot}','{"missionId":"preserve-me"}');`)
}
function repair(overrides: Record<string, string> = {}) {
  const variables = { workspace_id: workspace, run_id: run, expected_updated_at: snapshot, executor_stopped: 'confirmed', ...overrides }
  return execFileSync(join(bin, 'psql'), [...args, ...Object.entries(variables).flatMap(([key, value]) => ['-v', `${key}=${value}`]), '-f', script], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}
const state = () => sql(`select status || ':' || coalesce(safe_error_code,'none') || ':' || (completed_at is not null)::text from conversation_jobs where id='${run}'`)

describe('중단이 확인된 미실행 run의 명시적 운영 정리 (로컬 DB만)', () => {
  it('기본 dry-run은 롤백하고 명시 apply만 안전 종료하며 데이터·목표를 보존한다', () => {
    reset()
    repair()
    expect(state()).toBe('running:none:false')
    repair({ apply: 'true' })
    expect(state()).toBe('needs_attention:AGENT_INTAKE_INTERRUPTED:true')
    expect(sql(`select plan_data->>'missionId' from conversation_jobs`)).toBe('preserve-me')
    expect(sql('select count(*) from conversation_jobs')).toBe('1')
    expect(sql('select count(*) from conversation_job_steps')).toBe('0')
    expect(sql('select count(*) from agent_activity_events')).toBe('0')
    const completed = sql('select completed_at from conversation_jobs')
    repair({ apply: 'true' })
    expect(sql('select completed_at from conversation_jobs')).toBe(completed)
  })

  it.each([
    ['중단 확인 없음', '', { executor_stopped: 'no' }],
    ['다른 테넌트', '', { workspace_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }],
    ['상태 스냅샷 변경', "update conversation_jobs set updated_at=now()", {}],
    ['최근 heartbeat', "update conversation_jobs set heartbeat_at=now()", {}],
    ['기존 오류 근거', "update conversation_jobs set safe_error_code='RESULT_UNKNOWN'", {}],
    ['실행 시작됨', "update conversation_jobs set started_at=now()", {}],
    ['worker 소유', "update conversation_jobs set worker_id=id", {}],
    ['예약 크레딧 존재', "update conversation_jobs set reservation_id=id", {}],
    ['큐 전송됨', "update conversation_jobs set queue_dispatched_at=now()", {}],
    ['재시도 존재', "update conversation_jobs set attempt_count=1", {}],
    ['assistant 존재', "update conversation_jobs set assistant_message_id=id", {}],
    ['단계 존재', `insert into conversation_job_steps values ('${run}')`, {}],
    ['활동 존재', `insert into agent_activity_events values ('${run}')`, {}],
    ['성공 실행', "update conversation_jobs set status='succeeded',completed_at=now()", {}],
    ['취소 실행', "update conversation_jobs set status='cancelled',completed_at=now()", {}],
  ] as const)('%s이면 정리하지 않는다', (_name, setup, overrides) => {
    reset()
    if (setup) sql(setup)
    const before = state()
    expect(() => repair({ ...overrides, apply: 'true' })).toThrow('AGENT_REPAIR_BLOCKED')
    expect(state()).toBe(before)
  })
})
