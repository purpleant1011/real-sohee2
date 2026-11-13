// @vitest-environment node
import { execFileSync } from 'node:child_process'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { readRuntimeControl } from '../../../src/features/marketing-agent/engine/runtime-control-read'
import { checkAutonomyExecutionAdmission } from '../../../src/features/marketing-agent/engine/autonomy-execution-admission'
vi.mock('server-only', () => ({}))

// 이 테스트는 test:tenant-security-db --runtime-control이 소유한 Unix socket DB에서만 실행한다.
if (!process.env.PGHOST?.startsWith('/private/') && !process.env.PGHOST?.startsWith('/var/') && !process.env.PGHOST?.startsWith('/tmp/')) throw new Error('Isolated PostgreSQL socket required')
if (process.env.PGDATABASE !== 'tenant_security') throw new Error('Isolated database required')
const binary = `${process.env.PG16_BIN || '/opt/homebrew/opt/postgresql@16/bin'}/psql`
const WS = 'a7910000-0000-4000-8000-000000000001'
const OTHER = 'b7910000-0000-4000-8000-000000000001'
const ACTOR = 'a7910000-0000-4000-8000-000000000002'
const OTHER_ACTOR = 'b7910000-0000-4000-8000-000000000002'
function sql(statement: string) { return execFileSync(binary, ['-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1'], { input: statement, encoding: 'utf8' }).trim() }
function quote(value: unknown) { return `'${String(value).replaceAll("'", "''")}'` }
function identifier(value: string) { if (!/^[a-z_]+$/.test(value)) throw new Error('Invalid test query identifier'); return `"${value}"` }

/** Supabase transport만 SQL로 대체. 실제 production SELECT·RLS·원장·판정 함수를 그대로 실행한다. */
function database(actor = ACTOR): SupabaseClient {
  return { from(table: string) {
    let columns = '*'
    const filters: string[] = []
    const run = async (single: boolean) => {
      const query = `select ${columns} from public.${identifier(table)}${filters.length ? ` where ${filters.join(' and ')}` : ''}`
      try {
        const output = sql(`begin; select set_config('request.jwt.claim.sub',${quote(actor)},true); select set_config('request.jwt.claims',${quote(JSON.stringify({ sub: actor, role: 'authenticated' }))},true); set local role authenticated; select coalesce(json_agg(r),'[]'::json) from (${query}) r; rollback;`)
        const rows = JSON.parse(output.split('\n').at(-1)!)
        return { data: single ? rows[0] ?? null : rows, error: null }
      } catch { return { data: null, error: { message: 'SQL read failed' } } }
    }
    const chain = {
      select(input: string) { columns = input === '*' ? '*' : input.split(',').map(c => identifier(c.trim())).join(','); return chain },
      eq(key: string, value: unknown) { filters.push(`${identifier(key)}=${quote(value)}`); return chain },
      maybeSingle: () => run(true),
      then: (resolve: (value: unknown) => unknown) => run(false).then(resolve),
    }
    return chain
  } } as unknown as SupabaseClient
}
beforeAll(() => {
  sql(`insert into auth.users(id) values (${quote(ACTOR)}),(${quote(OTHER_ACTOR)});
    insert into public.workspaces(id,name,created_by) values (${quote(WS)},'isolated A',${quote(ACTOR)}),(${quote(OTHER)},'isolated B',${quote(OTHER_ACTOR)});
    insert into public.workspace_runtime_control_states(workspace_id,desired_mode,actual_mode,version) values (${quote(WS)},'RUNNING','PAUSED',3),(${quote(OTHER)},'RUNNING','RUNNING',2);
    insert into public.agent_energy_ledgers(workspace_id,remaining_available_energy) values (${quote(WS)},10),(${quote(OTHER)},10);`)
})
describe('ANI-1791 실제 로컬 PostgreSQL readback', () => {
  it('희망 RUNNING이어도 A의 durable PAUSED는 표시·스케줄러 모두 중지다', async () => {
    expect(await readRuntimeControl(database(), WS)).toMatchObject({ workspaceId: WS, actualMode: 'PAUSED', version: 3 })
    expect(await checkAutonomyExecutionAdmission(database(), WS)).toMatchObject({ admitted: false, code: 'AUTONOMY_PAUSED' })
  })
  it('B 상태가 RUNNING이어도 A 세션에서는 보이지 않는다', async () => {
    await expect(readRuntimeControl(database(), OTHER)).rejects.toThrow()
    expect(await checkAutonomyExecutionAdmission(database(), OTHER)).toMatchObject({ admitted: false })
    expect(await readRuntimeControl(database(OTHER_ACTOR), OTHER)).toMatchObject({ actualMode: 'RUNNING' })
    expect(await checkAutonomyExecutionAdmission(database(OTHER_ACTOR), OTHER)).toEqual({ admitted: true })
  })
  it('독립 SQL 연결에서 변경된 A 상태를 다음 readback이 즉시 읽는다', async () => {
    sql(`update public.workspace_runtime_control_states set actual_mode='RUNNING',version=4 where workspace_id=${quote(WS)};`)
    expect(await readRuntimeControl(database(), WS)).toMatchObject({ actualMode: 'RUNNING', version: 4 })
    sql(`update public.workspace_runtime_control_states set actual_mode='PAUSED',version=5 where workspace_id=${quote(WS)};`)
    expect(await readRuntimeControl(database(), WS)).toMatchObject({ actualMode: 'PAUSED', version: 5 })
    expect(await checkAutonomyExecutionAdmission(database(), WS)).toMatchObject({ admitted: false })
  })
  it('실제 에너지 원장 0은 BLOCKED이며 누락은 UNKNOWN 응답이 아닌 조회 실패다', async () => {
    sql(`update public.workspace_runtime_control_states set actual_mode='RUNNING' where workspace_id=${quote(WS)}; update public.agent_energy_ledgers set remaining_available_energy=0 where workspace_id=${quote(WS)};`)
    expect(await readRuntimeControl(database(), WS)).toMatchObject({ actualMode: 'BLOCKED' })
    expect(await checkAutonomyExecutionAdmission(database(), WS)).toMatchObject({ admitted: false, code: 'AGENT_BLOCKED' })
    sql(`delete from public.agent_energy_ledgers where workspace_id=${quote(WS)};`)
    await expect(readRuntimeControl(database(), WS)).rejects.toThrow('CONTROL_GUARD_UNAVAILABLE')
  })
})
