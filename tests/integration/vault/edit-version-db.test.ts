import { spawnSync } from 'node:child_process'
import { beforeAll, describe, expect, it } from 'vitest'
import { versionKey } from '../../../src/features/vault/edit'
import { query } from './pg-client'

const user = '73111111-1111-4111-8111-111111111111'
const ws = '83111111-1111-4111-8111-111111111111'
const content = '93111111-1111-4111-8111-111111111111'
const version = '94222222-2222-4222-8222-222222222222'

/** One independent psql session per call, as a service-role request, so two "tabs" really are two transactions. */
function applyEdits(mutations: unknown[]): Record<string, string> | null {
  const json = JSON.stringify(mutations).replaceAll("'", "''")
  const run = spawnSync(`${process.env.PG16_BIN || '/opt/homebrew/opt/postgresql@16/bin'}/psql`, ['-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-d', process.env.PGDATABASE!], {
    input: `begin; select set_config('request.jwt.claim.role','service_role',true); select coalesce(public.vault_apply_edits('${ws}','${json}'::jsonb)::text,'null'); commit;`, encoding: 'utf8',
  })
  if (run.status) throw new Error(`psql: ${run.stderr?.slice(0, 1500)}`)
  const line = run.stdout.trim().split('\n').filter(Boolean).find(l => l === 'null' || l.startsWith('{'))
  return line === 'null' || !line ? null : JSON.parse(line)
}

beforeAll(() => {
  // This file owns its own database copy: let the replay's constant auth.role() stub honour the request claim.
  const stub = spawnSync(`${process.env.PG16_BIN || '/opt/homebrew/opt/postgresql@16/bin'}/psql`, ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '-d', process.env.PGDATABASE!], { input: `create or replace function auth.role() returns text language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'authenticated') $$;`, encoding: 'utf8' })
  if (stub.status) throw new Error(`psql: ${stub.stderr}`)
  query(`with users as (insert into auth.users (id) values ('${user}') returning id) select id from users`)
  query(`with workspaces as (insert into public.workspaces (id,name,created_by) values ('${ws}', '편집 서비스', '${user}') returning id) select id from workspaces`)
  query(`with contents as (insert into public.content_items (id,workspace_id,channel,title,created_by) values ('${content}','${ws}','threads','소식','${user}') returning id) select id from contents`)
  query(`with versions as (insert into public.content_versions (id,workspace_id,content_id,version_number,caption,fingerprint,created_by) values ('${version}','${ws}','${content}',1,'새 소식이에요.','${'b'.repeat(64)}','${user}') returning id) select id from versions`)
})

describe('ANI-1545 vault edit version guard on real PostgreSQL', () => {
  it('rejects the second of two sessions holding the same viewed version, with no extra event, then accepts the latest version', async () => {
    query(`with saved as (insert into public.vault_items (workspace_id,content_id,version_id,channel,policy_version,spec_version,idempotency_key) values ('${ws}','${content}','${version}','threads','vault-save-v1','test','ani1545') returning id) select id from saved`)
    const row = () => query<{ id: string; viewed: string; deleted: string | null }>(`select id, to_char(updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as viewed, deleted_at as deleted from public.vault_items where workspace_id='${ws}'`)[0]
    const events = () => query<{ n: number }>(`select count(*)::int as n from public.vault_events where workspace_id='${ws}' and event_type in ('vault.deleted','vault.restored')`)[0].n
    const { id, viewed } = row()
    const mutation = (expected: string, changes: object, eventType: string) => ({ id, expected_updated_at: expected, actor_id: user, changes, payload: null, expected_payload: null, event_type: eventType, event_payload: {} })

    const tabA = applyEdits([mutation(viewed, { deleted_at: '2026-10-08T00:00:00Z' }, 'vault.deleted')])
    expect(tabA?.[id]).toBeTruthy()
    expect(events()).toBe(1)

    const tabB = applyEdits([mutation(viewed, { deleted_at: null }, 'vault.restored')])
    expect(tabB).toBeNull()
    expect(events()).toBe(1)
    expect(row().deleted).not.toBeNull()

    // The version returned by the commit is the same instant the next read sees, so a follow-up save from the same tab works.
    expect(versionKey(tabA![id])).toBe(versionKey(row().viewed))
    expect(applyEdits([mutation(tabA![id], { deleted_at: null }, 'vault.restored')])?.[id]).toBeTruthy()
    expect(events()).toBe(2)
    expect(row().deleted).toBeNull()
  })
})
