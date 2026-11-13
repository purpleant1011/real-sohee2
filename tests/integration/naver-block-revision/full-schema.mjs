import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { verifyPostgrest } from './postgrest.mjs'

// Disposable Unix-socket cluster only. Never use DATABASE_URL or production credentials.
const root = process.cwd()
const bin = '/opt/homebrew/opt/postgresql@16/bin'
const temp = mkdtempSync(join(tmpdir(), 'sohee-naver-full-'))
const cluster = join(temp, 'db')
const env = { ...process.env, LC_ALL: 'C' }
for (const key of Object.keys(env)) if (key.startsWith('PG') || key.includes('DATABASE_URL')) delete env[key]
function call(command, args) {
  const result = spawnSync(join(bin, command), args, { env, encoding: 'utf8', timeout: 120000 })
  if (result.status !== 0) throw new Error(`${command}: ${(result.stderr || result.error?.message || '').slice(-4000)}`)
  return result.stdout
}
const sql = text => call('psql', ['-X', '-h', temp, '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-At', '-c', text])
const file = path => call('psql', ['-X', '-h', temp, '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-f', path])
try {
  call('initdb', ['-D', cluster, '-A', 'trust', '-U', 'postgres', '--no-locale'])
  call('pg_ctl', ['-D', cluster, '-l', join(temp, 'server.log'), '-o', `-k ${temp} -c listen_addresses=''`, '-w', 'start'])
  const replay = readFileSync(join(root, 'scripts/verify-fresh-db-replay.mjs'), 'utf8')
  const marker = 'const preambleSql = `'
  const start = replay.indexOf(marker) + marker.length
  const end = replay.indexOf('`;\n  runPsql(preambleSql)', start)
  if (start < marker.length || end < 0) throw new Error('REPLAY_PREAMBLE_CHANGED')
  const preamble = join(temp, 'preamble.sql')
  writeFileSync(preamble, replay.slice(start, end).replaceAll('${DB_NAME}', 'postgres'))
  file(preamble)
  const files = readdirSync(join(root, 'supabase/migrations')).filter(name => name.endsWith('.sql')).sort()
  for (const name of files) file(join(root, 'supabase/migrations', name))
  // Only the hosted auth boundary is emulated. Actual workspace helper/writer/RLS are untouched.
  sql(`create or replace function auth.uid() returns uuid language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid $$;
    create or replace function auth.role() returns text language sql stable as $$ select current_setting('role',true) $$;`)
  console.log(`Full migration replay: ${files.length} PASS`)
  console.log(sql(`select jsonb_build_object('helper',proname,'body_md5',md5(prosrc),'security_definer',prosecdef,'config',proconfig)
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and proname in ('has_workspace_role','create_content_version_internal') order by proname;`))
  console.log('TABLE_CONTRACTS\n' + sql(readFileSync(join(root, 'tests/integration/naver-block-revision/catalog.sql'), 'utf8')))
  if (process.argv.includes('--details')) console.log(sql(`select jsonb_build_object('table',c.relname,'name',k.conname,'definition',pg_get_constraintdef(k.oid)) from pg_constraint k join pg_class c on c.oid=k.conrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in ('content_items','content_versions','media_assets','workspace_members') order by c.relname,k.conname;
    select jsonb_build_object('policy',policyname,'cmd',cmd,'qual',qual,'check',with_check) from pg_policies where schemaname='public' and tablename='content_items' order by policyname;`))
  if (process.argv.includes('--production-media-check')) {
    sql(`alter table public.media_assets add constraint media_assets_generation_metadata_check check (jsonb_typeof(generation_metadata)='object');`)
    console.log('Isolated overlay: production-only media metadata object constraint (not a repo/production migration)')
    console.log('OVERLAY_TABLE_CONTRACTS\n' + sql(readFileSync(join(root, 'tests/integration/naver-block-revision/catalog.sql'), 'utf8')))
  }
  if (process.argv.includes('--production-item-acl')) {
    sql('revoke update on public.content_items from authenticated; grant update(title) on public.content_items to authenticated;')
    console.log('Isolated overlay: table UPDATE revoked; title-only UPDATE granted, matching production')
  }
  console.log(file(resolve(root, 'tests/integration/naver-block-revision/full-schema.sql')))
  const base = JSON.parse(sql(`select json_build_object('id',v.id,'fingerprint',v.fingerprint) from public.content_versions v join public.content_items i on i.current_version_id=v.id where i.id='30000000-0000-4000-8000-000000000001'`))
  const race = label => new Promise(resolveResult => {
    const query = `begin; set local statement_timeout='10s'; set local lock_timeout='5s'; set role authenticated;
      select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
      select public.create_naver_block_revision('20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','${base.id}','${base.fingerprint}',0,'동시 수정 ${label}');
      select pg_sleep(0.15); commit;`
    const child = spawn(join(bin, 'psql'), ['-X','-h',temp,'-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose','-c',query], { env })
    let stderr = ''
    child.stderr.on('data', value => { stderr += value })
    child.on('error', error => resolveResult({ code: -1, stderr: error.message }))
    child.on('close', code => resolveResult({ code, stderr }))
  })
  const outcomes = await Promise.all([race('A'), race('B')])
  if (outcomes.filter(result => result.code === 0).length !== 1 || outcomes.filter(result => result.code !== 0 && result.stderr.includes('40001')).length !== 1) throw new Error('FULL_SCHEMA_RACE_FAILED')
  console.log('PASS: full-schema concurrent sessions: one success, one 40001')
  if (process.argv.includes('--postgrest')) await verifyPostgrest({ sql, temp, env })
} finally {
  spawnSync(join(bin, 'pg_ctl'), ['-D', cluster, '-m', 'immediate', '-w', 'stop'], { env, stdio: 'ignore' })
  rmSync(temp, { recursive: true, force: true })
}
