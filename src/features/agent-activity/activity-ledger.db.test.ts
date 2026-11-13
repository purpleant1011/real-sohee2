// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { execFileSync, execFile } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'

const bin = process.env.PG_BIN ?? '/opt/homebrew/opt/postgresql@16/bin'
const root = mkdtempSync('/tmp/sohee-activity-pg-')
const data = join(root, 'data')
const args = ['-h', root, '-U', process.env.USER ?? 'postgres', '-d', 'postgres', '-XAt', '-v', 'ON_ERROR_STOP=1']
const sql = (text: string) => execFileSync(join(bin, 'psql'), [...args, '-c', text], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
const asyncExec = promisify(execFile)
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const RA = '11111111-1111-4111-8111-111111111111'
const RB = '22222222-2222-4222-8222-222222222222'
const append = (ws: string, run: string, key: string) => `set role service_role; select sequence from public.append_agent_activity('${ws}', '${run}', '1', 'tool_read_started', '${key}', false);`
let started = false

beforeAll(() => {
  execFileSync(join(bin, 'initdb'), ['-D', data, '-A', 'trust', '--no-locale'], { stdio: 'pipe' })
  try {
    execFileSync(join(bin, 'pg_ctl'), ['-D', data, '-l', join(root, 'postgres.log'), '-o', `-k ${root} -h ''`, '-w', 'start'], { stdio: 'pipe', env: { ...process.env, LC_ALL: 'C' } })
  } catch {
    throw new Error(readFileSync(join(root, 'postgres.log'), 'utf8'))
  }
  started = true
  sql(`create role authenticated; create role anon; create role service_role bypassrls;
    create schema private;
    create table public.workspaces(id uuid primary key);
    create table public.workspace_members(workspace_id uuid, user_id uuid);
    create function private.is_workspace_member(w uuid) returns boolean language sql security definer set search_path = '' as $$
      select exists(select 1 from public.workspace_members where workspace_id=w and user_id=nullif(current_setting('request.jwt.claim.sub', true),'')::uuid)
    $$;
    grant usage on schema private to authenticated;
    create table public.marketing_missions(id uuid primary key, workspace_id uuid);
    create table public.conversation_jobs(id uuid primary key, workspace_id uuid, thread_id uuid, plan_data jsonb default '{}');
    create table public.agent_sessions(workspace_id uuid, session_id text, thread_id uuid);
    insert into workspaces values ('${A}'), ('${B}');
    insert into workspace_members values ('${A}', '${A}'), ('${B}', '${B}');
    insert into conversation_jobs(id,workspace_id) values ('${RA}','${A}'), ('${RB}','${B}');`)
  sql(readFileSync(join(process.cwd(), 'supabase/migrations/20261026170000_agent_activity_events.sql'), 'utf8'))
}, 20000)
afterAll(() => {
  if (started) execFileSync(join(bin, 'pg_ctl'), ['-D', data, '-m', 'immediate', '-w', 'stop'], { stdio: 'pipe' })
  rmSync(root, { recursive: true, force: true })
})

describe('로컬 PostgreSQL 영속 활동 원장 (운영 DB 변경 없음)', () => {
  it('동시 append/retry에도 연속 순번과 동일 event_id를 보존하고 두 사용자 RLS를 격리한다', async () => {
    const results = await Promise.all(Array.from({ length: 8 }, (_, i) =>
      asyncExec(join(bin, 'psql'), [...args, '-c', append(A, RA, `start:${i}`)])))
    expect(results.map(r => Number(r.stdout.trim().split('\n').at(-1))).sort((a,b) => a-b)).toEqual([1,2,3,4,5,6,7,8])
    const before = sql(`select event_id from agent_activity_events where dedupe_key='start:0'`)
    sql(append(A, RA, 'start:0'))
    expect(sql(`select event_id from agent_activity_events where dedupe_key='start:0'`)).toBe(before)
    expect(sql('select count(*) from agent_activity_events')).toBe('8')
    sql(append(B, RB, 'start:0'))
    for (const [user, expected] of [[A, RA], [B, RB]]) {
      expect(sql(`set role authenticated; set request.jwt.claim.sub='${user}'; select distinct run_id from agent_activity_events;`).split('\n').at(-1)).toBe(expected)
    }
    expect(() => sql(append(A, RB, 'tenant-injection'))).toThrow()
    expect(() => sql(`set role authenticated; select * from append_agent_activity('${A}','${RA}','1','tool_read_started','injection',false)`)).toThrow()
    expect(() => sql(`set role service_role; update agent_activity_events set kind='result_unknown'`)).toThrow()
    expect(() => sql(`set role service_role; delete from agent_activity_events`)).toThrow()
    expect(() => sql(`set role anon; select * from agent_activity_events`)).toThrow()
    expect(sql(`select sequence from agent_activity_events where workspace_id='${A}' and run_id='${RA}' and sequence>6 order by sequence`)).toBe('7\n8')
  })

  it('체크포인트가 plan_data를 교체해도 활동의 최초 미션 범위를 보존한다', () => {
    const run = '44444444-4444-4444-8444-444444444444'
    const mission = '55555555-5555-4555-8555-555555555555'
    const replacement = '66666666-6666-4666-8666-666666666666'
    sql(`insert into marketing_missions values ('${mission}','${A}'), ('${replacement}','${A}');
      insert into conversation_jobs(id,workspace_id,plan_data)
        values ('${run}','${A}','{"missionId":"${mission}"}');`)
    sql(append(A, run, 'before-checkpoint'))
    sql(`update conversation_jobs set plan_data='{"actionGraph":{}}' where id='${run}'`)
    sql(append(A, run, 'after-checkpoint'))
    expect(sql(`select mission_id from agent_activity_events where run_id='${run}' order by sequence`))
      .toBe(`${mission}\n${mission}`)

    sql(`update conversation_jobs set plan_data='{"missionId":"${replacement}"}' where id='${run}'`)
    expect(() => sql(append(A, run, 'changed-mission'))).toThrow()
    expect(sql(`select count(*) from agent_activity_events where run_id='${run}'`)).toBe('2')

    sql(`update conversation_jobs set plan_data='{}' where id='${run}';
      update marketing_missions set workspace_id='${B}' where id='${mission}'`)
    expect(() => sql(append(A, run, 'foreign-mission'))).toThrow()
    expect(sql(`select count(*) from agent_activity_events where run_id='${run}'`)).toBe('2')

    // A run initially bound without a mission must not silently acquire one later.
    const unbound = '77777777-7777-4777-8777-777777777777'
    sql(`insert into conversation_jobs(id,workspace_id) values ('${unbound}','${A}')`)
    sql(append(A, unbound, 'without-mission'))
    sql(`update conversation_jobs set plan_data='{"missionId":"${replacement}"}' where id='${unbound}'`)
    expect(() => sql(append(A, unbound, 'late-mission'))).toThrow()
  })

  it('세션이 지정된 실행은 같은 workspace와 대화방에 속한 세션만 활동을 남긴다', () => {
    const run = '33333333-3333-4333-8333-333333333333'
    sql(`insert into conversation_jobs(id,workspace_id,thread_id,plan_data)
      values ('${run}','${A}','${RA}','{"sessionId":"scoped-session"}');`)
    const count = () => sql(`select count(*) from agent_activity_events where run_id='${run}'`)
    expect(() => sql(append(A, run, 'missing-session'))).toThrow()
    expect(count()).toBe('0')

    sql(`insert into agent_sessions values ('${B}','scoped-session','${RA}')`)
    expect(() => sql(append(A, run, 'foreign-session'))).toThrow()
    expect(count()).toBe('0')

    sql(`insert into agent_sessions values ('${A}','scoped-session','${RB}')`)
    expect(() => sql(append(A, run, 'wrong-thread'))).toThrow()
    expect(count()).toBe('0')

    sql(`update agent_sessions set thread_id='${RA}' where workspace_id='${A}'`)
    expect(sql(append(A, run, 'valid-session')).split('\n').at(-1)).toBe('1')
    expect(count()).toBe('1')

    // A session can navigate to another thread without invalidating its already-bound run.
    sql(`update agent_sessions set thread_id='${RB}' where workspace_id='${A}'`)
    expect(sql(append(A, run, 'after-navigation')).split('\n').at(-1)).toBe('2')
  })
})
