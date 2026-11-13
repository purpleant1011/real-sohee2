import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { constants, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createServer } from 'node:net'

// Own a fresh socket-only cluster on every run. Never reuse an existing database.
const root = resolve(import.meta.dirname, '..')
const args = process.argv.slice(2)
if (args.some(arg => arg !== '--conversation')) throw new Error('Only --conversation is supported')
const testFile = args.includes('--conversation')
  ? 'tests/integration/conversation/canonical-turn.db.test.ts'
  : 'tests/integration/memory/long-term-memory-service.db.test.ts'
const bin = process.env.PG16_BIN || '/opt/homebrew/opt/postgresql@16/bin'
if (process.getuid?.() === 0) throw new Error('Run the isolated memory harness as an unprivileged user')
const directory = mkdtempSync(join(tmpdir(), 'sohee-memory-db-'))
const cluster = join(directory, 'cluster')
const log = join(directory, 'postgres.log')
const db = 'sohee_car_memory_test'
const port = String(54000 + Math.floor(Math.random() * 10000))
let child
const env = {
  ...process.env, LC_ALL: 'C', PGHOST: directory, PGPORT: port, PGDATABASE: db,
  PGUSER: process.env.USER, PG16_BIN: bin, SOHEE_MEMORY_DB_SOCKET: directory,
  SOHEE_MEMORY_DB_TEST: '1',
}
// libpq overrides must not redirect a disposable socket connection to a remote host.
delete env.PGHOSTADDR
delete env.PGSERVICE
delete env.PGSERVICEFILE
function cleanup() {
  if (child?.pid) {
    try { process.kill(-child.pid, 'SIGTERM') } catch (error) { if (error.code !== 'ESRCH') console.warn(error.message) }
  }
  if (existsSync(join(cluster, 'postmaster.pid'))) {
    spawnSync(join(bin, 'pg_ctl'), ['-D', cluster, '-m', 'immediate', '-w', 'stop'], { env, stdio: 'ignore' })
  }
  rmSync(directory, { recursive: true, force: true })
}
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => {
    child?.kill(signal)
    cleanup()
    process.exit(128 + (constants.signals[signal] ?? 1))
  })
}
function call(name, args) {
  const result = spawnSync(join(bin, name), args, { env, encoding: 'utf8' })
  if (result.status !== 0) {
    const detail = existsSync(log) ? readFileSync(log, 'utf8').slice(-3000) : ''
    throw new Error(`${name} failed: ${result.error?.message || result.stderr}\n${detail}`)
  }
}
async function freePort() {
  const listener = createServer()
  await new Promise((resolveReady, reject) => {
    listener.once('error', reject)
    listener.listen(0, '127.0.0.1', resolveReady)
  })
  const address = listener.address()
  await new Promise((resolveClosed, reject) => listener.close(error => error ? reject(error) : resolveClosed()))
  return address.port
}
try {
  const postgrest = spawnSync('postgrest', ['--version'], { encoding: 'utf8' })
  if (postgrest.status !== 0) throw new Error('PostgREST is required on PATH for the local HTTP integration test')
  console.log(postgrest.stdout.trim())
  call('initdb', ['-D', cluster, '-E', 'UTF8', '--no-locale', '-A', 'trust', '--no-sync'])
  call('pg_ctl', ['-D', cluster, '-o', `-p ${port} -k ${directory} -h ''`, '-l', log, '-w', 'start'])
  call('createdb', [db])
  env.SOHEE_MEMORY_API_PORT = String(await freePort())
  child = spawn(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', testFile], { cwd: root, env, stdio: 'inherit', detached: true })
  process.exitCode = await new Promise((resolveStatus, reject) => {
    child.once('error', reject)
    child.once('exit', (code, signal) => resolveStatus(code ?? (signal ? 1 : 0)))
  })
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
} finally {
  cleanup()
}
