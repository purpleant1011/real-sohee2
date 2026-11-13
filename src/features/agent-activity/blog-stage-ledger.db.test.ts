// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const bin = process.env.PG_BIN ?? '/opt/homebrew/opt/postgresql@16/bin'
const root = mkdtempSync('/tmp/sohee-blogstage-pg-')
const data = join(root, 'data')
const args = ['-h', root, '-U', process.env.USER ?? 'postgres', '-d', 'postgres', '-XAt', '-v', 'ON_ERROR_STOP=1']
const sql = (text: string) => execFileSync(join(bin, 'psql'), [...args, '-c', text], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const RA = '11111111-1111-4111-8111-111111111111'
const RB = '22222222-2222-4222-8222-222222222222'
const append = (ws: string, run: string, key: string, stage = 'keyword_lookup', covered = 'null', total = 'null') =>
  `set role service_role; select sequence from public.append_blog_stage_fact('${ws}','${run}','${stage}','verified','server_record','naver_search',20,${covered},${total},'${key}');`
let started = false

beforeAll(() => {
  execFileSync(join(bin, 'initdb'), ['-D', data, '-A', 'trust', '--no-locale'], { stdio: 'pipe' })
  try {
    execFileSync(join(bin, 'pg_ctl'), ['-D', data, '-l', join(root, 'postgres.log'), '-o', `-k ${root} -h ''`, '-w', 'start'], { stdio: 'pipe', env: { ...process.env, LC_ALL: 'C' } })
  } catch { throw new Error(readFileSync(join(root, 'postgres.log'), 'utf8')) }
  started = true
  sql(`create role authenticated; create role anon; create role service_role bypassrls;
    create schema private;
    create table public.workspaces(id uuid primary key);
    create table public.workspace_members(workspace_id uuid, user_id uuid);
    create function private.is_workspace_member(w uuid) returns boolean language sql security definer set search_path = '' as $$
      select exists(select 1 from public.workspace_members where workspace_id=w and user_id=nullif(current_setting('request.jwt.claim.sub', true),'')::uuid)
    $$;
    grant usage on schema private to authenticated;
    create table public.conversation_jobs(id uuid primary key, workspace_id uuid);
    insert into workspaces values ('${A}'), ('${B}');
    insert into workspace_members values ('${A}', '${A}'), ('${B}', '${B}');
    insert into conversation_jobs values ('${RA}','${A}'), ('${RB}','${B}');`)
  sql(readFileSync(join(process.cwd(), 'supabase/migrations/20261028190000_blog_stage_facts.sql'), 'utf8'))
}, 20000)
afterAll(() => {
  if (started) execFileSync(join(bin, 'pg_ctl'), ['-D', data, '-m', 'immediate', '-w', 'stop'], { stdio: 'pipe' })
  rmSync(root, { recursive: true, force: true })
})

describe('로컬 PostgreSQL 블로그 단계 기록 (운영 DB 변경 없음)', () => {
  it('순번을 이어 붙이고 같은 키 재시도는 같은 행을, 다른 내용은 충돌로 거부한다', () => {
    expect(sql(append(A, RA, 'k1')).split('\n').at(-1)).toBe('1')
    expect(sql(append(A, RA, 'k2', 'draft_writing')).split('\n').at(-1)).toBe('2')
    const id = sql(`select event_id from blog_stage_facts where dedupe_key='k1'`)
    sql(append(A, RA, 'k1'))
    expect(sql(`select event_id from blog_stage_facts where dedupe_key='k1'`)).toBe(id)
    expect(sql('select count(*) from blog_stage_facts')).toBe('2')
    expect(() => sql(append(A, RA, 'k1', 'benchmark'))).toThrow()
  })
  it('다른 workspace run 주입, 잘못된 값, 직접 변경, anon/authenticated 쓰기를 막는다', () => {
    expect(() => sql(append(A, RB, 'x'))).toThrow()
    expect(() => sql(append(A, RA, 'cov', 'keyword_lookup', '5', '3'))).toThrow()
    expect(() => sql(append(A, RA, 'bad', 'free_text'))).toThrow()
    expect(() => sql(`set role service_role; update blog_stage_facts set status='failed'`)).toThrow()
    expect(() => sql(`set role service_role; delete from blog_stage_facts`)).toThrow()
    expect(() => sql(`set role authenticated; select * from append_blog_stage_fact('${A}','${RA}','benchmark','verified','server_record','naver_search',1,null,null,'z')`)).toThrow()
    expect(() => sql(`set role anon; select * from blog_stage_facts`)).toThrow()
  })
  it('멤버는 자기 workspace 기록만 읽는다', () => {
    sql(append(B, RB, 'b1'))
    for (const [user, run] of [[A, RA], [B, RB]]) {
      expect(sql(`set role authenticated; set request.jwt.claim.sub='${user}'; select distinct run_id from blog_stage_facts;`).split('\n').at(-1)).toBe(run)
    }
  })
})
