import { beforeAll, describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { literal, query } from './pg-client'

const owner = 'f1111111-1111-4111-8111-111111111111'
const outsider = 'f2222222-2222-4222-8222-222222222222'
const w1 = 'f3333333-3333-4333-8333-333333333333'
const w2 = 'f4444444-4444-4444-8444-444444444444'

beforeAll(() => {
  query(`with u as (insert into auth.users(id) values ('${owner}'), ('${outsider}') returning id) select id from u`)
  query(`with w as (insert into public.workspaces (id,name,created_by) values ('${w1}','같은 이름','${owner}'), ('${w2}','같은 이름','${outsider}') returning id) select id from w`)
})

describe('ANI-1555 raw migration replay and registry RLS', () => {
  it('registers two same-name workspaces by UUID and defaults to ACTUAL without guessing the actor kind', () => {
    expect(query<{ workspace_id: string; dataset_mode: string; actor_kind: string; created_source: string }>(`select workspace_id,dataset_mode,actor_kind,created_source from public.workspace_registry where workspace_id in ('${w1}','${w2}') order by workspace_id`)).toEqual([
      { workspace_id: w1, dataset_mode: 'ACTUAL', actor_kind: 'UNCLASSIFIED', created_source: 'workspace_insert' },
      { workspace_id: w2, dataset_mode: 'ACTUAL', actor_kind: 'UNCLASSIFIED', created_source: 'workspace_insert' },
    ])
    expect(query<{ n: number }>(`select count(*)::int as n from public.workspace_registry where display_name='같은 이름'`)[0].n).toBe(2)
  })

  it('denies ordinary owner and outsider even when granted SELECT temporarily (RLS defense in depth)', () => {
    expect(query<{ granted: boolean }>(`select has_table_privilege('authenticated', 'public.workspace_registry', 'select') as granted`)[0].granted).toBe(false)
    expect(query<{ rls: boolean }>(`select relrowsecurity as rls from pg_class where oid='public.workspace_registry'::regclass`)[0].rls).toBe(true)
    const statement = `begin; grant select on public.workspace_registry to authenticated; set local role authenticated; select count(*)::int as visible from public.workspace_registry; rollback;`
    const run = spawnSync('/opt/homebrew/opt/postgresql@16/bin/psql', ['-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-d', process.env.PGDATABASE!], { input: statement, encoding: 'utf8' })
    expect(run.status).toBe(0)
    expect(run.stdout.trim()).toBe('0')
    expect(query<{ granted: boolean }>(`select has_table_privilege('authenticated', 'public.workspace_registry', 'select') as granted`)[0].granted).toBe(false)
  })

  it('service role can classify a row, but cannot change its immutable key', () => {
    query(`with changed as (update public.workspace_registry set dataset_mode='TEST', actor_kind='TESTER' where workspace_id='${w2}' returning workspace_id) select workspace_id from changed`)
    expect(query<{ dataset_mode: string }>(`select dataset_mode from public.workspace_registry where workspace_id='${w2}'`)[0].dataset_mode).toBe('TEST')
    expect(() => query(`with changed as (update public.workspace_registry set workspace_id=${literal(w1)} where workspace_id='${w2}' returning workspace_id) select workspace_id from changed`)).toThrow()
    expect(query<{ n: number }>(`select count(*)::int as n from public.workspace_registry where dataset_mode='ACTUAL' and workspace_id in ('${w1}','${w2}')`)[0].n).toBe(1)
    expect(query<{ n: number }>(`select public.count_admin_actual_vault_items(array['${w1}','${w2}']::uuid[]) as n`)[0].n).toBe(0)
  })
})
