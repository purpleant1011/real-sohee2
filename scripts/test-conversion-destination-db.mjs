import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir, userInfo } from 'node:os'
import { join, resolve } from 'node:path'

// Only a fresh, socket-only cluster owned by this invocation. No database URLs or ambient PG settings.
if (process.getuid?.() === 0) throw new Error('Run isolated PostgreSQL as an unprivileged user')
const bin = process.env.PG16_BIN || '/opt/homebrew/opt/postgresql@16/bin'
for (const command of ['initdb', 'pg_ctl', 'createdb', 'psql']) {
  if (!existsSync(join(bin, command))) throw new Error(`PostgreSQL 16 tool missing: ${command}`)
}
const root = resolve(import.meta.dirname, '..')
const temporary = mkdtempSync(join(tmpdir(), 'sohee-w7-conversion-'))
const cluster = join(temporary, 'cluster')
const database = 'sohee_conversion_test'
const port = String(54000 + Math.floor(Math.random() * 10000))
const env = { PATH: process.env.PATH, HOME: process.env.HOME, USER: userInfo().username, LC_ALL: 'C', PGHOST: temporary, PGPORT: port, PGDATABASE: database, PGUSER: userInfo().username }
function call(command, args) {
  const result = spawnSync(join(bin, command), args, { encoding: 'utf8', env })
  if (result.status !== 0) throw new Error(`${command} failed: ${result.stderr?.slice(-3000) || result.error?.message}`)
  return result.stdout
}
function cleanup() {
  if (existsSync(join(cluster, 'postmaster.pid'))) spawnSync(join(bin, 'pg_ctl'), ['-D', cluster, '-m', 'immediate', '-w', 'stop'], { env, stdio: 'ignore' })
  rmSync(temporary, { recursive: true, force: true })
}
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => { cleanup(); process.exit(1) })
}
try {
  call('initdb', ['-D', cluster, '-E', 'UTF8', '--no-locale', '-A', 'trust', '--no-sync'])
  call('pg_ctl', ['-D', cluster, '-o', `-p ${port} -k ${temporary} -h '' -c fsync=off -c synchronous_commit=off -c full_page_writes=off`, '-l', join(temporary, 'postgres.log'), '-w', 'start'])
  call('createdb', [database])
  const replay = readFileSync(join(root, 'scripts/verify-fresh-db-replay.mjs'), 'utf8')
  const marker = 'const preambleSql = `'
  const start = replay.indexOf(marker) + marker.length
  const end = replay.indexOf('`;\n  runPsql(preambleSql)', start)
  if (start < marker.length || end < 0) throw new Error('Raw replay preamble changed; inspect before running')
  call('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-d', database, '-c', replay.slice(start, end).replaceAll('${DB_NAME}', database)])
  const migrations = readdirSync(join(root, 'supabase/migrations')).filter(name => name.endsWith('.sql')).sort()
  for (const file of migrations) {
    try { call('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-d', database, '-f', join(root, 'supabase/migrations', file)]) }
    catch (error) { throw new Error(`Migration ${file}: ${error.message}`) }
  }
  console.log(`Replayed ${migrations.length} migrations in a fresh PostgreSQL 16 socket-only cluster.`)
  console.log(call('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-d', database, '-f', join(root, 'tests/integration/conversion-destination/schema.sql')]))
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
} finally {
  cleanup()
}
