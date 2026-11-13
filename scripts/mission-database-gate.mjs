import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
// Deliberately NOT a pending-migration glob. Baseline migrations are never replayed.
export const allowedRevisions = Object.freeze({
  '20261027100000': 'ani1796_mission_events_composite_fk',
  '20261027110000': 'ani1877_mission_contract_hardening',
})
export const allowedVersions = Object.freeze(Object.keys(allowedRevisions))
export const baselineVersions = ['20260818164728', '20260910080000', '20261023130000']
const literal = value => `'${String(value).replaceAll("'", "''")}'`
const assert = (condition, code) => `DO $gate$ BEGIN IF NOT COALESCE((${condition}), false) THEN RAISE EXCEPTION '${code}'; END IF; END $gate$;`

export function loadMigrations(directory = join(root, 'supabase/migrations')) {
  const files = readdirSync(directory).filter(file => file.endsWith('.sql')).sort()
  const versions = new Set()
  return files.map(file => {
    const match = /^(\d+)_([a-zA-Z0-9_]+)\.sql$/.exec(file)
    if (!match || versions.has(match[1])) throw new Error('LOCAL_HISTORY_CONFLICT')
    if (allowedRevisions[match[1]] && allowedRevisions[match[1]] !== match[2]) throw new Error('LOCAL_HISTORY_CONFLICT')
    versions.add(match[1])
    return { version: match[1], name: match[2], sql: readFileSync(join(directory, file), 'utf8') }
  })
}

export function planDigest(migrations = loadMigrations()) {
  // Pin the complete local history as well as the allowlist and baseline policy.
  return createHash('sha256').update(JSON.stringify({ allowedRevisions, baselineVersions, migrations })).digest('hex')
}

function historyChecks(migrations) {
  const values = migrations.map(m => `(${literal(m.version)}, ${literal(m.name)})`).join(',')
  return [
    assert(`NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations GROUP BY version HAVING count(*) <> 1)`, 'REMOTE_HISTORY_DUPLICATE'),
    assert(`NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations r
      LEFT JOIN (VALUES ${values}) AS l(version,name) ON l.version = r.version
      WHERE l.version IS NULL OR r.name IS DISTINCT FROM l.name)`, 'HISTORY_VERSION_OR_NAME_CONFLICT'),
    // No name-based alias inference, even if a historical entry looks familiar.
    ...baselineVersions.map(version => assert(`EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = ${literal(version)})`, 'BASELINE_HISTORY_REQUIRED')),
    ...allowedVersions.map(version => {
      const migration = migrations.find(m => m.version === version)
      if (!migration) throw new Error('ALLOWLIST_FILE_MISSING')
      // Unknown/empty/split or modified ledger statements require human reconciliation.
      // This conservative exact-byte check intentionally never repairs history.
      return assert(`NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations
        WHERE version = ${literal(version)} AND statements IS DISTINCT FROM ARRAY[${literal(migration.sql)}]::text[])`, 'ALLOWLIST_HISTORY_CONTENT_UNCERTAIN')
    }),
    assert(`NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '${allowedVersions[1]}')
      OR EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '${allowedVersions[0]}')`, 'HISTORY_DEPENDENCY_GAP'),
  ].join('\n')
}

const columns = {
  workspaces: { id: 'uuid', created_by: 'uuid' },
  workspace_members: { workspace_id: 'uuid', user_id: 'uuid', status: 'text' },
  marketing_missions: {
    id: 'uuid', workspace_id: 'uuid', trace_id: 'text', status: 'text', goal: 'text',
    strategy_summary: 'text', target_channel: 'text', target_audience: 'text',
    source_message_id: 'uuid', source_conversation_job_id: 'uuid', metadata: 'jsonb',
    external_action_request_id: 'uuid', external_action_receipt_id: 'uuid',
    created_at: 'timestamp with time zone', updated_at: 'timestamp with time zone',
  },
  mission_events: {
    workspace_id: 'uuid', mission_id: 'uuid', trace_id: 'text', from_status: 'text', to_status: 'text',
    actor_type: 'text', actor_id: 'text', event_name: 'text', payload: 'jsonb', occurred_at: 'timestamp with time zone',
  },
  external_action_requests: { id: 'uuid', workspace_id: 'uuid', exact_payload: 'jsonb' },
  external_action_receipts: {
    id: 'uuid', workspace_id: 'uuid', action_request_id: 'uuid', receipt_kind: 'text',
    observed_payload: 'jsonb', status: 'text', verified_at: 'timestamp with time zone',
    recorded_at: 'timestamp with time zone', created_at: 'timestamp with time zone',
  },
}

function columnChecks(table, expected) {
  return Object.entries(expected).map(([column, type]) => assert(`EXISTS (
    SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('public.${table}')
      AND attname = '${column}' AND NOT attisdropped AND format_type(atttypid, atttypmod) = '${type}')`, 'SCHEMA_COLUMN_REQUIRED')).join('\n')
}

function keyCheck(table) {
  return assert(`EXISTS (SELECT 1 FROM pg_index i WHERE i.indrelid = to_regclass('public.${table}')
    AND i.indisunique AND i.indisvalid AND i.indisready AND i.indpred IS NULL AND i.indexprs IS NULL
    AND i.indnkeyatts = 2 AND (SELECT array_agg(a.attname::text ORDER BY k.ordinality)
      FROM unnest(i.indkey::smallint[]) WITH ORDINALITY k(num,ordinality)
      JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.num WHERE k.ordinality <= 2)
      = ARRAY['workspace_id','id'])`, 'COMPOSITE_KEY_REQUIRED')
}

function foreignKeyCheck(table, name, target, sourceColumn, deleteAction) {
  return assert(`EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conrelid = to_regclass('public.${table}')
    AND c.conname = '${name}' AND c.contype = 'f' AND c.convalidated
    AND c.confrelid = to_regclass('public.${target}') AND c.confdeltype = '${deleteAction}'
    AND (SELECT array_agg(attname::text ORDER BY k.n) FROM unnest(c.conkey) WITH ORDINALITY k(num,n)
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.num) = ARRAY['workspace_id','${sourceColumn}']
    AND (SELECT array_agg(attname::text ORDER BY k.n) FROM unnest(c.confkey) WITH ORDINALITY k(num,n)
      JOIN pg_attribute a ON a.attrelid = c.confrelid AND a.attnum = k.num) = ARRAY['workspace_id','id'])`, 'TENANT_FOREIGN_KEY_REQUIRED')
}

export function baselineChecks() {
  return [
    ...Object.entries(columns).map(([table, expected]) => columnChecks(table, expected)),
    ...['marketing_missions', 'mission_events', 'external_action_requests', 'external_action_receipts'].map(table =>
      assert(`EXISTS (SELECT 1 FROM pg_class WHERE oid = to_regclass('public.${table}') AND relkind = 'r' AND relrowsecurity)`, 'BASELINE_RLS_REQUIRED')),
    keyCheck('external_action_requests'), keyCheck('external_action_receipts'),
    // Core spine's transitive FK targets must exist, not be silently invented.
    ...['messages', 'conversation_jobs', 'content_items', 'content_versions', 'approvals'].map(table => columnChecks(table, { id: 'uuid' })),
    assert(`to_regprocedure('auth.uid()') IS NOT NULL`, 'AUTH_FUNCTION_REQUIRED'),
  ].join('\n')
}

export function receiptChecks() {
  return [
    keyCheck('marketing_missions'),
    columnChecks('mission_action_receipts', { id: 'uuid', workspace_id: 'uuid', mission_id: 'uuid', action_request_id: 'uuid', action_receipt_id: 'uuid', action_fingerprint: 'text', provider: 'text', cost_minor_units: 'bigint', verified_at: 'timestamp with time zone' }),
    assert(`EXISTS (SELECT 1 FROM pg_class WHERE oid = to_regclass('public.mission_action_receipts') AND relrowsecurity)`, 'RECEIPT_RLS_REQUIRED'),
    foreignKeyCheck('mission_events', 'mission_events_workspace_mission_fkey', 'marketing_missions', 'mission_id', 'c'),
    foreignKeyCheck('mission_action_receipts', 'mission_action_receipts_mission_fkey', 'marketing_missions', 'mission_id', 'c'),
    foreignKeyCheck('mission_action_receipts', 'mission_action_receipts_request_fkey', 'external_action_requests', 'action_request_id', 'c'),
    foreignKeyCheck('mission_action_receipts', 'mission_action_receipts_receipt_fkey', 'external_action_receipts', 'action_receipt_id', 'r'),
  ].join('\n')
}

function rpcChecks(sql) {
  const definitions = [...sql.matchAll(/CREATE OR REPLACE FUNCTION public\.(\w+)\(([\s\S]*?)\) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS \$\$([\s\S]*?)\$\$;/g)]
  if (definitions.length !== 2) throw new Error('RPC_CONTRACT_PARSE_FAILED')
  return definitions.map(([, name, args, body]) => {
    const parameters = args.split(',').map(arg => arg.trim().split(/\s+/))
    const types = parameters.map(p => p[1]).join(',')
    const names = parameters.map(p => literal(p[0])).join(',')
    const defaults = parameters.filter(p => p.includes('DEFAULT')).length
    return assert(`EXISTS (SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
      WHERE p.oid = to_regprocedure('public.${name}(${types})') AND p.prorettype = 'jsonb'::regtype
      AND p.proargnames = ARRAY[${names}]::text[] AND p.pronargdefaults = ${defaults}
      AND p.prosecdef AND NOT p.proretset AND l.lanname = 'plpgsql'
      AND p.proconfig = ARRAY['search_path=public'] AND p.prosrc = ${literal(body)}
      AND has_function_privilege('service_role', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
      AND NOT EXISTS (SELECT 1 FROM aclexplode(COALESCE(p.proacl, acldefault('f',p.proowner))) a
        WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE')
      AND (SELECT count(*) FROM pg_proc other WHERE other.pronamespace = p.pronamespace AND other.proname = p.proname) = 1)`, 'RPC_CONTRACT_OR_PRIVILEGE_DRIFT')
  }).join('\n')
}

export function readyChecks(migrations, { requireHistory = true } = {}) {
  const hardening = migrations.find(m => m.version === allowedVersions[1])
  return [
    ...(requireHistory ? allowedVersions.map(version => assert(`EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '${version}')`, 'MIGRATION_NOT_APPLIED')) : []),
    receiptChecks(), columnChecks('external_action_requests', { mission_id: 'uuid' }),
    foreignKeyCheck('external_action_requests', 'external_action_requests_workspace_mission_fkey', 'marketing_missions', 'mission_id', 'r'),
    assert(`EXISTS (SELECT 1 FROM pg_index WHERE indexrelid = to_regclass('public.idx_mission_action_receipts_workspace_receipt_unique')
      AND indisunique AND indisvalid AND indisready AND indpred IS NULL AND indexprs IS NULL
      AND indrelid = to_regclass('public.mission_action_receipts') AND indnkeyatts = 2
      AND (SELECT array_agg(a.attname::text ORDER BY k.n) FROM unnest(indkey::smallint[]) WITH ORDINALITY k(num,n)
        JOIN pg_attribute a ON a.attrelid = indrelid AND a.attnum = k.num) = ARRAY['workspace_id','action_receipt_id'])`, 'RECEIPT_UNIQUENESS_REQUIRED'),
    rpcChecks(hardening.sql),
  ].join('\n')
}

function partialStateChecks(migrations) {
  return `SELECT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '${allowedVersions[0]}') AS first_applied \\gset
\\if :first_applied
${receiptChecks()}
${assert(`NOT EXISTS (SELECT 1 FROM public.mission_action_receipts GROUP BY workspace_id,action_receipt_id HAVING count(*) > 1)`, 'DUPLICATE_RECEIPT_BINDING')}
\\else
${assert(`to_regclass('public.mission_action_receipts') IS NULL AND NOT EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'update_mission_snapshot_atomic') AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = to_regclass('public.mission_events') AND conname = 'mission_events_workspace_mission_fkey')`, 'UNTRACKED_FIRST_REVISION')}
\\endif
SELECT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '${allowedVersions[1]}') AS second_applied \\gset
\\if :second_applied
${readyChecks(migrations)}
\\else
${assert(`NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('public.external_action_requests') AND attname = 'mission_id' AND NOT attisdropped) AND to_regclass('public.idx_mission_action_receipts_workspace_receipt_unique') IS NULL AND NOT EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'create_mission_with_contract_atomic')`, 'UNTRACKED_HARDENING_REVISION')}
\\endif
${assert(`NOT EXISTS (SELECT 1 FROM public.mission_events e LEFT JOIN public.marketing_missions m ON m.id = e.mission_id AND m.workspace_id = e.workspace_id WHERE e.mission_id IS NOT NULL AND m.id IS NULL)`, 'CROSS_TENANT_EVENT_DATA')}
`
}

export function buildGateSql(mode, migrations = loadMigrations()) {
  if (!['preflight', 'ready', 'apply'].includes(mode)) throw new Error('INVALID_GATE_MODE')
  for (const [version, name] of Object.entries(allowedRevisions)) {
    if (migrations.filter(m => m.version === version && m.name === name).length !== 1 ||
        migrations.filter(m => m.version === version).length !== 1) throw new Error('ALLOWLIST_FILE_MISSING')
  }
  let sql = `BEGIN${mode === 'apply' ? '' : ' READ ONLY'};\nSET LOCAL statement_timeout = '60s';\nSET LOCAL lock_timeout = '5s';\n`
  if (mode === 'apply') sql += 'SELECT pg_advisory_xact_lock(17761877);\nLOCK TABLE supabase_migrations.schema_migrations IN EXCLUSIVE MODE;\n'
  sql += historyChecks(migrations) + '\n' + baselineChecks() + '\n' + partialStateChecks(migrations)
  if (mode === 'preflight') {
    // Check existing partial schemas instead of assuming ledger presence proves readiness.
    sql += `SELECT version FROM supabase_migrations.schema_migrations WHERE version IN ('${allowedVersions.join("','")}') ORDER BY version;\n`
  }
  if (mode === 'apply') {
    for (const version of allowedVersions) {
      const m = migrations.find(migration => migration.version === version)
      // psql condition is driven only by our fixed version, never external input.
      sql += `SELECT NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '${version}') AS pending \\gset\n\\if :pending\n${m.sql}\nINSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES ('${version}',${literal(m.name)},ARRAY[${literal(m.sql)}]);\n\\endif\n`
    }
  }
  if (mode !== 'preflight') sql += readyChecks(migrations) + '\n'
  return sql + 'COMMIT;\n'
}

export function connectionEnvironment(env) {
  if (!env.MISSION_DATABASE_URL || !env.MISSION_DATABASE_HOST || !env.MISSION_DATABASE_NAME) throw new Error('DATABASE_CONFIGURATION_REQUIRED')
  let url
  try { url = new URL(env.MISSION_DATABASE_URL) } catch { throw new Error('DATABASE_CONFIGURATION_INVALID') }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.hostname !== env.MISSION_DATABASE_HOST || decodeURIComponent(url.pathname.slice(1)) !== env.MISSION_DATABASE_NAME || url.search || !url.username || !url.password) throw new Error('DATABASE_TARGET_MISMATCH')
  // Never inherit PGOPTIONS, service files, dotenv or Keychain. Never put credentials in argv/logs.
  return {
    PATH: env.PATH, HOME: '/nonexistent', PGSYSCONFDIR: '/nonexistent', PGPASSFILE: '/nonexistent',
    PGHOST: url.hostname, PGPORT: url.port || '5432', PGDATABASE: env.MISSION_DATABASE_NAME,
    PGUSER: decodeURIComponent(url.username), PGPASSWORD: decodeURIComponent(url.password),
    PGSSLMODE: ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ? 'disable' : 'verify-full',
    // Ubuntu runner system trust; local operators may supply an explicit CA file.
    PGSSLROOTCERT: env.MISSION_DATABASE_SSL_ROOT_CERT || '/etc/ssl/certs/ca-certificates.crt',
    PGCONNECT_TIMEOUT: '10', PGAPPNAME: 'sohee-mission-database-gate',
  }
}

export function validateApplyApproval(env, digest) {
  if (env.GITHUB_ACTIONS !== 'true' || env.GITHUB_REF !== 'refs/heads/main' ||
      env.MISSION_MIGRATION_APPLY_ENABLED !== 'true' || env.MISSION_MIGRATION_APPROVAL !== 'apply-mission-contract' ||
      !/^[a-f0-9]{40}$/.test(env.GITHUB_SHA || '') || env.MISSION_APPROVED_SHA !== env.GITHUB_SHA ||
      env.MISSION_APPROVED_PLAN !== digest) throw new Error('MANUAL_APPROVAL_REQUIRED')
}

export function runGate(mode = 'preflight', env = process.env) {
  const migrations = loadMigrations()
  const digest = planDigest(migrations)
  if (mode === 'apply') validateApplyApproval(env, digest)
  const connection = connectionEnvironment(env)
  const result = spawnSync('psql', ['-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-f', '-'], {
    cwd: root, env: connection, input: buildGateSql(mode, migrations), encoding: 'utf8', timeout: 180_000,
    maxBuffer: 2 * 1024 * 1024,
  })
  // psql errors may include SQL, payloads, usernames, URLs: do not forward stdout/stderr.
  if (result.error || result.status !== 0) throw new Error('DATABASE_GATE_FAILED_REQUIRES_REVIEW')
  console.log(`Mission database ${mode}: PASS; plan=${digest}`)
  if (mode === 'preflight') {
    const applied = result.stdout.trim().split(/\s+/).filter(Boolean)
    console.log(`Allowlisted pending versions: ${allowedVersions.filter(v => !applied.includes(v)).join(',') || 'none'}; preflight is NOT release readiness`)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length > 3) throw new Error('INVALID_GATE_MODE')
    runGate(process.argv[2] || 'preflight')
  } catch (error) {
    // Only fixed codes are safe to print; never print connection-library exceptions.
    const safe = new Set(['LOCAL_HISTORY_CONFLICT', 'ALLOWLIST_FILE_MISSING', 'RPC_CONTRACT_PARSE_FAILED', 'INVALID_GATE_MODE', 'DATABASE_CONFIGURATION_REQUIRED', 'DATABASE_CONFIGURATION_INVALID', 'DATABASE_TARGET_MISMATCH', 'MANUAL_APPROVAL_REQUIRED', 'DATABASE_GATE_FAILED_REQUIRES_REVIEW'])
    console.error(safe.has(error.message) ? error.message : 'DATABASE_GATE_FAILED')
    process.exitCode = 1
  }
}
