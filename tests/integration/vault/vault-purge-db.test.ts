import { spawnSync } from 'node:child_process'
import { beforeAll, describe, expect, it } from 'vitest'
import { query } from './pg-client'

const owner = '76111111-1111-4111-8111-111111111111'
const otherOwner = '76222222-2222-4222-8222-222222222222'
const ws = '86333333-3333-4333-8333-333333333333'
const otherWs = '86444444-4444-4444-8444-444444444444'
const oldItem = '96555555-5555-4555-8555-555555555555'
const freshItem = '96666666-6666-4666-8666-666666666666'
const activeItem = '96777777-7777-4777-8777-777777777777'
const foreignItem = '96888888-8888-4888-8888-888888888888'

// Real PG sessions, not mock query responses; role changes and GUCs are scoped to this connection.
function psql(input: string): { status: number | null; stdout: string; stderr: string } {
  if (!process.env.PGHOST?.includes('sohee-vault-db-')) throw new Error('Isolated PG16 required')
  const run = spawnSync(`${process.env.PG16_BIN || '/opt/homebrew/opt/postgresql@16/bin'}/psql`,
    ['-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-d', process.env.PGDATABASE!],
    { input, encoding: 'utf8' })
  return { status: run.status, stdout: run.stdout, stderr: run.stderr }
}
function call(sql: string, role = 'service_role'): Record<string, number> {
  const run = psql(`begin; set local role ${role}; select ${sql}::text; commit;`)
  if (run.status !== 0) throw new Error(run.stderr)
  return JSON.parse(run.stdout.trim().split('\n').find(line => line.startsWith('{'))!)
}
function count(table: string, workspace = ws): number {
  return query<{ n: number }>(`select count(*)::int as n from public.${table} where workspace_id = '${workspace}'`)[0].n
}
function insertedId(sql: string): string {
  const run = psql(`${sql} returning id;`)
  if (run.status !== 0) throw new Error(run.stderr)
  const id = run.stdout.match(/[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}/i)?.[0]
  if (!id) throw new Error(`No inserted id: ${run.stdout}`)
  return id
}
function item(id: string, workspace: string, user: string, age: string | null) {
  const content = insertedId(`insert into public.content_items (workspace_id, channel, title, created_by)
    values ('${workspace}', 'threads', 'Vault purge integration', '${user}')`)
  const version = insertedId(`insert into public.content_versions
    (workspace_id, content_id, version_number, caption, fingerprint, created_by)
    values ('${workspace}', '${content}', 1, 'draft', '${'a'.repeat(64)}', '${user}')`)
  query(`with i as (insert into public.vault_items
    (id, workspace_id, content_id, version_id, channel, policy_version, spec_version, idempotency_key, deleted_at)
    values ('${id}', '${workspace}', '${content}', '${version}', 'threads', 'v1', 'v1', '${id}', ${age ? `now() - interval '${age}'` : 'null'}) returning id)
    select id from i`)
  query(`with p as (insert into public.vault_variant_payloads (workspace_id, vault_item_id, payload)
    values ('${workspace}', '${id}', '{"private":"content"}') returning id) select id from p`)
  query(`with e as (insert into public.vault_events (workspace_id, vault_item_id, event_type, payload)
    values ('${workspace}', '${id}', 'vault.saved', '{"private":"content"}') returning id) select id from e`)
  query(`with p as (insert into public.preflight_runs (workspace_id, vault_item_id, overall, items)
    values ('${workspace}', '${id}', 'PASS', '[]') returning id) select id from p`)
  query(`with p as (insert into public.vault_published_urls (workspace_id, vault_item_id, channel, published_url)
    values ('${workspace}', '${id}', 'threads', 'https://example.com/post') returning id) select id from p`)
  query(`with f as (insert into public.funnel_events (workspace_id, event, properties, dedupe_key)
    values ('${workspace}', 'vault_saved', '{"vaultItemId":"${id}","channel":"threads"}', '${id}') returning id) select id from f`)
}

beforeAll(() => {
  query(`with u as (insert into auth.users (id) values ('${owner}'), ('${otherOwner}') returning id) select id from u`)
  query(`with w as (insert into public.workspaces (id, name, created_by)
    values ('${ws}', 'Vault purge', '${owner}'), ('${otherWs}', 'Other workspace', '${otherOwner}') returning id) select id from w`)
  item(oldItem, ws, owner, '33 days')
  item(freshItem, ws, owner, '29 days')
  item(activeItem, ws, owner, null)
  item(foreignItem, otherWs, otherOwner, '31 days')
})

describe('vault purge on isolated PostgreSQL 16', () => {
  it('fails closed for direct authenticated and service-role event mutations even if clients set the GUC', () => {
    for (const role of ['authenticated', 'service_role']) {
      const result = psql(`begin; set local role ${role}; select set_config('sohee.vault_purge','on',true);
        delete from public.vault_events where vault_item_id = '${oldItem}'; commit;`)
      expect(result.status).not.toBe(0)
      expect(result.stderr).toMatch(/append-only|permission denied|row-level security/i)
      expect(count('vault_events')).toBe(3)
    }
    // Only the service-role entrypoints may purge; signed-in users cannot call them at all.
    expect(psql(`begin; set local role authenticated; select public.purge_deleted_vault_items(); commit;`).status).not.toBe(0)
    expect(psql(`begin; set local role authenticated; select public.purge_workspace_vault_data('${ws}'); commit;`).status).not.toBe(0)
    expect(psql(`begin; set local role anon; select public.purge_deleted_vault_items(); commit;`).status).not.toBe(0)
  })

  it('rejects invalid bounds, purges at most one eligible workspace batch and emits only aggregate counts', () => {
    expect(() => call("public.purge_deleted_vault_items(interval '29 days', 500)")).toThrow()
    expect(() => call("public.purge_deleted_vault_items(interval '30 days', 0)")).toThrow()
    expect(() => call("public.purge_deleted_vault_items(interval '30 days', 501)")).toThrow()
    const result = call('public.purge_deleted_vault_items()')
    expect(result).toMatchObject({ items: 1, events: 1, preflight_runs: 1, variant_payloads: 1, published_urls: 1, funnel_events: 1 })
    expect(count('vault_items', ws)).toBe(2)
    expect(count('vault_items', otherWs)).toBe(1) // A single aggregate row belongs to only one workspace.
    expect(count('vault_variant_payloads')).toBe(2)
    expect(count('vault_events')).toBe(2)
    expect(count('preflight_runs')).toBe(2)
    expect(count('vault_published_urls')).toBe(2)
    expect(count('funnel_events')).toBe(2)
    expect(query<{ id: string }>(`select id from public.vault_items where id in ('${freshItem}','${activeItem}')`)).toHaveLength(2)
    const audit = query<{ event_type: string; entity_id: string | null; metadata: Record<string, number> }>(
      `select event_type, entity_id, metadata from public.audit_events where event_type='vault.purge.deleted' and workspace_id='${ws}'`)
    expect(audit).toHaveLength(1)
    expect(audit[0].entity_id).toBeNull()
    expect(audit[0].metadata).toEqual(result)
    expect(JSON.stringify(audit)).not.toMatch(/private|content|https:|${oldItem}/)
    expect(count('vault_items', otherWs)).toBe(1) // A separate tenant's eligible item remains until its own batch.
    expect(query<{ n: number }>(`select count(*)::int as n from public.audit_events where event_type='vault.purge.deleted'`)[0].n).toBe(1)
  })

  it('purges every vault child in the chosen workspace, keeps other workspace untouched, and is idempotent', () => {
    const result = call(`public.purge_workspace_vault_data('${ws}')`)
    expect(result).toMatchObject({ items: 2, events: 2, preflight_runs: 2, variant_payloads: 2, published_urls: 2, funnel_events: 2 })
    for (const table of ['vault_items', 'vault_events', 'preflight_runs', 'vault_variant_payloads', 'vault_published_urls', 'vault_image_renditions', 'funnel_events']) {
      expect(count(table)).toBe(0)
    }
    expect(call(`public.purge_workspace_vault_data('${ws}')`)).toMatchObject({ items: 0 })
    expect(count('vault_items', otherWs)).toBe(1)
    expect(count('vault_events', otherWs)).toBe(1)
    expect(call('public.purge_deleted_vault_items()')).toMatchObject({ items: 1 })
    expect(call('public.purge_deleted_vault_items()')).toMatchObject({ items: 0 })
    expect(count('vault_items', otherWs)).toBe(0)
    expect(query<{ n: number }>(`select count(*)::int as n from public.audit_events where event_type='vault.purge.workspace' and workspace_id='${ws}'`)[0].n).toBe(1)
    expect(query<{ n: number }>(`select count(*)::int as n from public.audit_events where event_type='vault.purge.deleted' and workspace_id='${otherWs}'`)[0].n).toBe(1)
  })
})
