import { spawn, spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { constants as osConstants, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'

// Every run owns a new cluster; never connect to (or clean up) an existing database.
const bin = process.env.PG16_BIN || '/opt/homebrew/opt/postgresql@16/bin'
const root = resolve(import.meta.dirname, '..')
const tenantIsolation = process.argv.includes('--tenant-isolation')
const naverPostJobs = process.argv.includes('--naver-post-jobs')
const naverCategories = process.argv.includes('--naver-categories')
const localPublishDispatch = process.argv.includes('--local-publish-dispatch')
const bookingRecovery = process.argv.includes('--booking-recovery')
const depositRefundNotice = process.argv.includes('--deposit-refund-notice')
const emailSignup = process.argv.includes('--email-signup')
const ledgerAdapter = process.argv.includes('--ledger-adapter')
// initdb refuses root; CI runners invoke this as their unprivileged user.
if (process.getuid?.() === 0) throw new Error('Run isolated PostgreSQL harness as an unprivileged user')
const temporary = mkdtempSync(join(tmpdir(), 'sohee-vault-db-'))
const cluster = join(temporary, 'cluster')
const db = 'sohee_vault_test'
let activeChild = null
// Stop this run's own cluster and delete this run's own temp dir. Never throws, never touches
// another run's cluster: the socket dir and data dir are unique per process (mkdtemp).
function cleanup() {
  if (existsSync(join(cluster, 'postmaster.pid'))) {
    spawnSync(join(bin, 'pg_ctl'), ['-D', cluster, '-m', 'immediate', '-w', 'stop'], { stdio: 'ignore' })
  }
  rmSync(temporary, { recursive: true, force: true })
}
// `timeout 600 npm run test:vault-db`, CI cancellation and Ctrl-C all deliver a signal that skips
// `finally`; without this the postgres process and temp dir of an aborted run would leak.
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => {
    activeChild?.kill(signal)
    cleanup()
    process.exit(128 + (osConstants.signals[signal] ?? 1))
  })
}
function call(name, args, options = {}) {
  const result = spawnSync(join(bin, name), args, { encoding: 'utf8', env: process.env, ...options })
  if (result.status !== 0) throw new Error(`${name} ${args.at(-1)}: ${result.stderr?.slice(-3000) || result.error?.message}${name === 'pg_ctl' && args.includes('start') ? `\n${readFileSync(join(temporary, 'postgres.log'), 'utf8').slice(-3000)}` : ''}`)
  return result.stdout
}
function sql(text) { return call('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-d', db, '-c', text]) }
// UNIX socket-only cluster: no TCP port or remote connection is exposed.
const port = 54000 + Math.floor(Math.random() * 10000)
// start 와 restart 가 같은 소켓/포트 설정을 쓰도록 한 곳에 둔다(restart 는 -o 를 기억하지 않는다).
const clusterOptions = `-p ${port} -k ${temporary} -h '' -c fsync=off -c synchronous_commit=off -c full_page_writes=off`
const clusterLog = join(temporary, 'postgres.log')
const env = { ...process.env, LC_ALL: 'C', PGHOST: temporary, PGPORT: String(port), PGDATABASE: db, PGUSER: process.env.USER, META_APP_REVIEW_STATUS: 'APPROVED', META_LIVE_WORKSPACE_ALLOWLIST: '*', ENGAGEMENT_WORKSPACE_ALLOWLIST: '*' }
try {
  Object.assign(process.env, env)
  call('initdb', ['-D', cluster, '-E', 'UTF8', '--no-locale', '-A', 'trust', '--no-sync'])
  // Throwaway cluster: durability settings off (replaying hundreds of migrations is otherwise fsync-bound).
  // The socket dir doubles as the lock dir, so the random port can never clash with another run.
  call('pg_ctl', ['-D', cluster, '-o', clusterOptions, '-l', clusterLog, '-w', 'start'])
  Object.assign(process.env, env)
  call('createdb', [db])
  // Reuse the legacy raw replay's full Supabase infrastructure stubs, without
  // running its fixed-port/destructive cleanup/report-writing main function.
  const replay = readFileSync(join(root, 'scripts/verify-fresh-db-replay.mjs'), 'utf8')
  const start = replay.indexOf('const preambleSql = `') + 'const preambleSql = `'.length
  const end = replay.indexOf('`;\n  runPsql(preambleSql)', start)
  if (start < 25 || end < 0) throw new Error('Replay preamble changed; update isolated harness')
  sql(replay.slice(start, end).replaceAll('${DB_NAME}', db))
  const files = readdirSync(join(root, 'supabase/migrations')).filter(name => name.endsWith('.sql')).sort()
  for (const file of files) {
    try { call('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-d', db, '-f', join(root, 'supabase/migrations', file)]) }
    catch (error) { throw new Error(`Migration ${file}: ${error.message}`) }
  }
  // The reused preamble's constant auth.uid() must not make every test user the same.
  sql(`create or replace function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
  grant usage on schema public, auth, private to authenticated;
  grant select on public.workspace_members to authenticated;`)
  console.log(`Replayed ${files.length} raw migrations in isolated PostgreSQL 16.`)

  if (bookingRecovery) {
    const testSqlPath = join(root, 'supabase/tests/database/57_booking_recovery.test.sql')
    if (existsSync(testSqlPath)) {
      call('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-d', db, '-f', testSqlPath])
      console.log('57_booking_recovery.test.sql PASSED in isolated PostgreSQL 16.')
    }
  }
  if (depositRefundNotice) {
    const testSqlPath = join(root, 'supabase/tests/database/58_deposit_refund_notice.test.sql')
    if (existsSync(testSqlPath)) {
      call('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-d', db, '-f', testSqlPath])
      console.log('58_deposit_refund_notice.test.sql PASSED in isolated PostgreSQL 16.')
    }
  }
  if (emailSignup) {
    // P0 이메일 가입 순서 계약: 실제 RPC 가드를 태운다(누락 시 통과로 위장하지 않고 실패).
    const testSqlPath = join(root, 'supabase/tests/database/59_email_signup_agreement_ordering.test.sql')
    if (!existsSync(testSqlPath)) throw new Error('59_email_signup_agreement_ordering.test.sql missing')
    const assertionRows = call('psql', ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '-d', db, '-f', testSqlPath])
    console.log(assertionRows.trimEnd())
    console.log('59_email_signup_agreement_ordering.test.sql PASSED in isolated PostgreSQL 16.')
  }
  const require = createRequire(join(root, 'package.json'))
  const runner = require.resolve('vitest/vitest.mjs')
  // Each test file gets its own copy of the replayed database so fixture ids
  // (users, workspaces) can never collide across files or concurrent authors.
  // The deposit/refund/notice contract is SQL-only: it ships no Vitest application suite.
  // The email signup ordering contract is SQL-only as well (59_email_signup_agreement_ordering).
  const testDir = ledgerAdapter
    ? 'tests/integration/ledger-adapter'
    : depositRefundNotice || emailSignup
    ? null
    : bookingRecovery
    ? 'tests/integration/booking-recovery'
    : naverCategories
      ? 'tests/integration/naver-categories'
      : naverPostJobs
        ? 'tests/integration/naver-post-jobs'
        : localPublishDispatch
          ? 'tests/integration/local-publish-dispatch'
          : tenantIsolation
            ? 'tests/integration/tenant-isolation'
            : 'tests/integration/vault'
  const testFiles = testDir
    ? readdirSync(join(root, testDir)).filter(name => name.endsWith('.test.ts') && (!process.env.VAULT_DB_ONLY || name.includes(process.env.VAULT_DB_ONLY))).sort()
    : []
  if (testDir && !testFiles.length) throw new Error(`No integration tests found in ${testDir}`)
  let status = 0
  for (const [index, file] of testFiles.entries()) {
    const copy = `${db}_${index}`
    call('createdb', ['-T', db, copy])
    const child = activeChild = spawn(process.execPath, [runner, 'run', `${testDir}/${file}`, '--testTimeout=30000'], { cwd: root, env: { ...env, PGDATABASE: copy, ...(ledgerAdapter ? { SOHEE_LEDGER_PG: '1' } : {}) }, stdio: 'inherit' })
    const code = await new Promise((resolveStatus, reject) => { child.on('error', reject); child.on('exit', (exit, signal) => resolveStatus(exit ?? (signal ? 1 : 0))) })
    activeChild = null
    if (code) status = code
  }
  // 재시작 내구성: 원장이 process-memory Map 이 아니라 DB 임을 증명한다.
  // RPC 로 intent/event/capture 1세트를 만들고 → 클러스터 재시작 → 같은 행이 남아 있는지 다시 센다.
  if (ledgerAdapter && status === 0) {
    const scalar = (text) => call('psql', ['-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-d', db, '-c', text]).trim()
    const owner = randomUUID()
    const workspace = randomUUID()
    const intent = randomUUID()
    const event = `evt-restart-${randomUUID().slice(0, 8)}`
    const paymentRef = `pay-restart-${randomUUID().slice(0, 8)}`
    sql(`insert into auth.users (id) values ('${owner}')`)
    sql(`insert into public.workspaces (id, name, created_by) values ('${workspace}', 'Restart durability', '${owner}')`)
    sql(`insert into public.deposit_intents (
      id, workspace_id, booking_id, booking_version, service_version, customer_id, policy,
      amount_krw, total_service_price_krw, refund_rule_version, cancellation_terms,
      merchant_ref, settlement_actor, terms_fingerprint, idempotency_key, status, expires_at)
    values ('${intent}', '${workspace}', 'bk_restart', 1, 'svc_v1', 'cust_1', 'REQUIRED',
      30000, 120000, 'rr_v1', '취소 규정 v1', 'merchant_test', 'SHOP',
      repeat('a', 64), 'idem-${intent.slice(0, 8)}', 'PREPARED', now() + interval '1 hour')`)
    const committed = JSON.parse(scalar(`select public.commit_payment_observation(
      p_workspace_id => '${workspace}'::uuid, p_event_id => '${event}', p_payload_digest => repeat('b', 64),
      p_intent_id => '${intent}'::uuid, p_payment_ref => '${paymentRef}', p_amount_krw => 30000,
      p_currency => 'KRW', p_paid_at => now(), p_outcome => 'MATCHED')::text`))
    if (committed.kind !== 'MATCHED') throw new Error(`restart durability setup failed: ${committed.kind}`)
    const counts = () => scalar(`select concat(
      (select count(*) from public.deposit_intents where workspace_id = '${workspace}' and status = 'TEST_PAID_MATCHED'), ':',
      (select count(*) from public.payment_webhook_events where workspace_id = '${workspace}' and event_id = '${event}'), ':',
      (select count(*) from public.payment_captures where workspace_id = '${workspace}' and payment_ref = '${paymentRef}'))`)
    const before = counts()
    if (before !== '1:1:1') throw new Error(`restart durability precondition failed: ${before}`)
    call('pg_ctl', ['-D', cluster, '-m', 'fast', '-w', '-o', clusterOptions, '-l', clusterLog, 'restart'])
    const after = counts()
    if (after !== before) throw new Error(`ledger rows lost across restart: before=${before} after=${after}`)
    console.log('ledger adapter restart durability PASSED')
  }
  process.exitCode = status
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
} finally {
  cleanup()
}
