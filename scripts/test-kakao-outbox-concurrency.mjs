import { execFileSync, execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'

/**
 * 로컬 임시 PostgreSQL 다중 세션 동시성 및 경합 검증 스크립트
 *
 * [재현 환경 조건]
 * - 임시 PostgreSQL 인스턴스 (Unix Domain Socket /tmp/sohee-kakao-pg.iEpdmt, 포트 55439, 유저 postgres)
 * - 운영 DB 연결 원천 차단: 다른 호스트/포트 지정 불가
 *
 * [검증 목적]
 * 1. 10개 독립 세션의 동일 job 동시 claim 시 정확히 1개 세션만 성공(true)하고 9개는 실패(false)
 * 2. Deterministic 순차 제어 2 케이스:
 *    Case A (Mark 먼저 -> 취소): 직전 job은 SENDING 보존, 취소 트리거로 신규 BOOKING_CANCELLED enqueue
 *    Case B (취소 먼저 -> Mark): 직전 job은 SUPERSEDED 처리 및 리스 해제, 뒤늦은 Mark는 false 반환
 * 3. Non-deterministic 실시간 경합 (5회):
 *    모든 SQL은 에러(deadlock 등) 없이 성공 완료해야 하며,
 *    Mark 승자면 status=SENDING, 취소 승자면 status=SUPERSEDED 상태를 엄격히 assert.
 * 4. try / finally 블록을 통한 예외 발생 시에도 잔여 fixture 100% cleanup 보장.
 */

const LOCAL_SOCKET = '/tmp/sohee-kakao-pg.iEpdmt'
const LOCAL_PORT = '55439'
const LOCAL_USER = 'postgres'

if (!existsSync(LOCAL_SOCKET)) {
  console.error(`[FATAL] Local socket ${LOCAL_SOCKET} not found. Refusing to run.`)
  process.exit(1)
}

function runPsql(sql, timeoutMs = 10000) {
  return execFileSync(
    'psql',
    ['-X', '-v', 'ON_ERROR_STOP=1', '-h', LOCAL_SOCKET, '-p', LOCAL_PORT, '-U', LOCAL_USER, '-A', '-t', '-c', sql],
    {
      encoding: 'utf8',
      env: { ...process.env, LC_ALL: 'C' },
      timeout: timeoutMs,
    }
  ).trim()
}

function runPsqlAsync(sql, timeoutMs = 10000) {
  return new Promise((resolve) => {
    execFile(
      'psql',
      ['-X', '-v', 'ON_ERROR_STOP=1', '-h', LOCAL_SOCKET, '-p', LOCAL_PORT, '-U', LOCAL_USER, '-A', '-t', '-c', sql],
      {
        encoding: 'utf8',
        env: { ...process.env, LC_ALL: 'C' },
        timeout: timeoutMs,
      },
      (err, stdout, stderr) => {
        if (err) {
          resolve({ ok: false, error: stderr.trim() || err.message, output: '' })
        } else {
          resolve({ ok: true, output: stdout.trim(), error: '' })
        }
      }
    )
  })
}

function teardownFixture() {
  console.log('[Cleanup] Dropping concurrency test schema and fixtures...')
  const teardownSql = `
    drop trigger if exists trg_kakao_enqueue_reservation_outbox on public.reservations;
    drop trigger if exists trg_kakao_reservation_ensure_monotonic_updated_at on public.reservations;
    drop function if exists public.claim_kakao_notification_job(uuid, uuid);
    drop function if exists public.mark_kakao_notification_sending(uuid, uuid);
    drop function if exists public.finish_kakao_notification_job(uuid, uuid, text, text);
    drop function if exists public.expire_kakao_notification_jobs();
    drop function if exists public.kakao_enqueue_reservation_outbox();
    drop function if exists public.kakao_reservation_ensure_monotonic_updated_at();
    drop table if exists public.kakao_notification_outbox cascade;
    drop table if exists public.reservations cascade;
    drop table if exists public.workspaces cascade;
  `
  runPsql(teardownSql)
}

async function main() {
  console.log('[1/5] Setting up minimal concurrency schema on local PG...')
  teardownFixture()

  try {
    const setupSql = `
      do $$
      begin
        if not exists (select from pg_roles where rolname = 'anon') then create role anon; end if;
        if not exists (select from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
        if not exists (select from pg_roles where rolname = 'service_role') then create role service_role; end if;
      end
      $$;

      create table if not exists public.workspaces (id uuid primary key);
      create table if not exists public.reservations (
        id text primary key,
        workspace_id uuid not null references public.workspaces(id),
        slot_id text not null,
        status text not null,
        metadata jsonb not null default '{}',
        updated_at timestamptz not null default statement_timestamp()
      );
    `
    runPsql(setupSql)

    // 마이그레이션 파일들을 순서대로 적용
    execFileSync(
      'psql',
      ['-X', '-v', 'ON_ERROR_STOP=1', '-h', LOCAL_SOCKET, '-p', LOCAL_PORT, '-U', LOCAL_USER, '-f', 'supabase/migrations/20261106040000_kakao_notification_outbox.sql'],
      { env: { ...process.env, LC_ALL: 'C' } }
    )
    execFileSync(
      'psql',
      ['-X', '-v', 'ON_ERROR_STOP=1', '-h', LOCAL_SOCKET, '-p', LOCAL_PORT, '-U', LOCAL_USER, '-f', 'supabase/migrations/20261106050000_kakao_notification_outbox_rpc.sql'],
      { env: { ...process.env, LC_ALL: 'C' } }
    )

    const workspaceId = randomUUID()
    runPsql(`insert into public.workspaces (id) values ('${workspaceId}');`)

    // -----------------------------------------------------------------------
    // [2/5] 동일 job에 대한 10개 세션 동시 claim 경합 검증
    // -----------------------------------------------------------------------
    console.log('[2/5] Testing concurrent claim on the same job (10 parallel sessions)...')
    const reservationId = `res_conc_${Date.now()}`
    runPsql(`
      insert into public.reservations (id, workspace_id, slot_id, status)
        values ('${reservationId}', '${workspaceId}', 'slot_init', 'CONFIRMED');
    `)

    const jobId = runPsql(`
      select id from public.kakao_notification_outbox
      where reservation_id = '${reservationId}' and status = 'READY'
      limit 1;
    `)
    if (!jobId) {
      throw new Error('Failed to create fixture READY job')
    }

    const CONCURRENCY = 10
    const tokens = Array.from({ length: CONCURRENCY }, () => randomUUID())

    // 10개의 독립 psql 세션에서 동시에 claim_kakao_notification_job 실행
    const claimPromises = tokens.map((token) =>
      runPsqlAsync(`select public.claim_kakao_notification_job('${jobId}', '${token}');`)
    )
    const claimResults = await Promise.all(claimPromises)

    const trueCount = claimResults.filter((r) => r.ok && r.output === 't').length
    const falseCount = claimResults.filter((r) => r.ok && r.output === 'f').length
    const errorCount = claimResults.filter((r) => !r.ok).length

    console.log(`Concurrent claim results: true=${trueCount}, false=${falseCount}, errors=${errorCount}`)
    if (errorCount !== 0) {
      throw new Error(`Encountered ${errorCount} SQL errors during concurrent claim`)
    }
    if (trueCount !== 1) {
      throw new Error(`Expected exactly 1 claim winner, got ${trueCount}`)
    }
    if (falseCount !== CONCURRENCY - 1) {
      throw new Error(`Expected ${CONCURRENCY - 1} claim losers, got ${falseCount}`)
    }

    // 승자 토큰 및 상태 검증
    const winningRow = runPsql(`
      select status || '|' || lease_token
      from public.kakao_notification_outbox
      where id = '${jobId}';
    `)
    const [finalStatus, winningToken] = winningRow.split('|')
    if (finalStatus !== 'CLAIMED' || !tokens.includes(winningToken)) {
      throw new Error(`Job state mismatch: status=${finalStatus}, token=${winningToken}`)
    }
    console.log(`[PASS] Exactly 1 session won the lease: ${winningToken}`)

    // -----------------------------------------------------------------------
    // [3/5] Deterministic 순차 제어 2 케이스 검증
    // -----------------------------------------------------------------------
    console.log('[3/5] Testing deterministic sequential cases (Case A: Mark first, Case B: Cancel first)...')

    // Case A: Mark 먼저 완료된 후 취소
    {
      const resA = `res_seq_a_${Date.now()}`
      runPsql(`
        insert into public.reservations (id, workspace_id, slot_id, status)
          values ('${resA}', '${workspaceId}', 'slot_a', 'CONFIRMED');
      `)
      const jobA = runPsql(`
        select id from public.kakao_notification_outbox where reservation_id = '${resA}' and status = 'READY';
      `)
      const tokenA = randomUUID()
      const claimA = runPsql(`select public.claim_kakao_notification_job('${jobA}', '${tokenA}');`)
      if (claimA !== 't') throw new Error('Case A: claim failed')

      // 1) Mark sending 먼저 실행
      const markA = runPsql(`select public.mark_kakao_notification_sending('${jobA}', '${tokenA}');`)
      if (markA !== 't') throw new Error('Case A: mark_sending failed')

      // 2) 취소 업데이트 실행
      runPsql(`update public.reservations set status = 'CANCELLED' where id = '${resA}';`)

      // Assertions: jobA는 SENDING 상태로 보존되어야 함 (트리거가 SENDING은 건드리지 않음)
      const jobAStatus = runPsql(`select status from public.kakao_notification_outbox where id = '${jobA}';`)
      if (jobAStatus !== 'SENDING') {
        throw new Error(`Case A assertion failed: expected jobA status SENDING, got ${jobAStatus}`)
      }

      // Assertions: 취소 이벤트에 대한 신규 READY outbox 건이 enqueue되어야 함
      const cancelJobCount = runPsql(`
        select count(*) from public.kakao_notification_outbox
        where reservation_id = '${resA}' and event = 'BOOKING_CANCELLED' and status = 'READY';
      `)
      if (cancelJobCount !== '1') {
        throw new Error(`Case A assertion failed: expected 1 BOOKING_CANCELLED job, got ${cancelJobCount}`)
      }
      console.log('[PASS] Case A (Mark first -> Cancel): SENDING preserved, cancel event enqueued')
    }

    // Case B: 취소가 먼저 완료된 후 Mark 시도
    {
      const resB = `res_seq_b_${Date.now()}`
      runPsql(`
        insert into public.reservations (id, workspace_id, slot_id, status)
          values ('${resB}', '${workspaceId}', 'slot_b', 'CONFIRMED');
      `)
      const jobB = runPsql(`
        select id from public.kakao_notification_outbox where reservation_id = '${resB}' and status = 'READY';
      `)
      const tokenB = randomUUID()
      const claimB = runPsql(`select public.claim_kakao_notification_job('${jobB}', '${tokenB}');`)
      if (claimB !== 't') throw new Error('Case B: claim failed')

      // 1) 취소 먼저 실행 -> 트리거가 CLAIMED 상태인 jobB를 SUPERSEDED로 전이시키고 리스 해제
      runPsql(`update public.reservations set status = 'CANCELLED' where id = '${resB}';`)

      const jobBStatus = runPsql(`select status || '|' || coalesce(lease_token::text, 'NULL') from public.kakao_notification_outbox where id = '${jobB}';`)
      if (jobBStatus !== 'SUPERSEDED|NULL') {
        throw new Error(`Case B assertion failed: expected jobB status SUPERSEDED|NULL, got ${jobBStatus}`)
      }

      // 2) 뒤늦게 mark sending 시도 -> false 반환해야 함 (상태가 CLAIMED가 아니고 예약 버전/상태 불일치)
      const markB = runPsql(`select public.mark_kakao_notification_sending('${jobB}', '${tokenB}');`)
      if (markB !== 'f') {
        throw new Error(`Case B assertion failed: expected mark_sending to return false, got ${markB}`)
      }
      console.log('[PASS] Case B (Cancel first -> Mark): superseded with cleared lease, mark rejected (false)')
    }

    // -----------------------------------------------------------------------
    // [4/5] 실시간 비동기 경합 검증 (5회 반복)
    // -----------------------------------------------------------------------
    console.log('[4/5] Testing markSending vs cancellation race condition (5 iterations)...')
    let markWon = 0
    let cancelWon = 0

    for (let i = 0; i < 5; i++) {
      const raceResId = `res_race_${i}_${Date.now()}`
      runPsql(`
        insert into public.reservations (id, workspace_id, slot_id, status)
          values ('${raceResId}', '${workspaceId}', 'slot_race', 'CONFIRMED');
      `)

      const raceJobId = runPsql(`
        select id from public.kakao_notification_outbox
        where reservation_id = '${raceResId}' and status = 'READY'
        limit 1;
      `)

      const workerToken = randomUUID()
      const claimed = runPsql(`select public.claim_kakao_notification_job('${raceJobId}', '${workerToken}');`)
      if (claimed !== 't') throw new Error(`Race ${i}: claim failed`)

      // Worker 세션: mark_kakao_notification_sending 실행
      const workerPromise = runPsqlAsync(`select public.mark_kakao_notification_sending('${raceJobId}', '${workerToken}');`)

      // Client 세션: reservation CANCELLED 업데이트
      const clientPromise = runPsqlAsync(`update public.reservations set status = 'CANCELLED' where id = '${raceResId}';`)

      const [workerRes, clientRes] = await Promise.all([workerPromise, clientPromise])

      // 1) 둘 다 SQL 성공이어야 함 (에러 발생 시 즉시 throw)
      if (!workerRes.ok) {
        throw new Error(`Race ${i}: worker SQL failed: ${workerRes.error}`)
      }
      if (!clientRes.ok) {
        throw new Error(`Race ${i}: client SQL failed: ${clientRes.error}`)
      }

      // 2) 데드락 문자열 감지 시 즉시 throw
      if (workerRes.error.toLowerCase().includes('deadlock') || clientRes.error.toLowerCase().includes('deadlock')) {
        throw new Error(`Race ${i}: deadlock detected between markSending and cancellation!`)
      }

      // 3) 예약 상태는 반드시 CANCELLED여야 함
      const resFinalStatus = runPsql(`select status from public.reservations where id = '${raceResId}';`)
      if (resFinalStatus !== 'CANCELLED') {
        throw new Error(`Race ${i}: reservation status is not CANCELLED, got ${resFinalStatus}`)
      }

      // 4) job 상태 엄격 검증
      const currentJobStatus = runPsql(`
        select status from public.kakao_notification_outbox where id = '${raceJobId}';
      `)

      if (workerRes.output === 't') {
        // Mark가 먼저 이긴 경우: job은 반드시 SENDING이어야 함
        if (currentJobStatus !== 'SENDING') {
          throw new Error(`Race ${i}: worker mark won (true) but job status is ${currentJobStatus} (expected SENDING)`)
        }
        markWon++
      } else if (workerRes.output === 'f') {
        // 취소가 먼저 이긴 경우: job은 반드시 SUPERSEDED이어야 함
        if (currentJobStatus !== 'SUPERSEDED') {
          throw new Error(`Race ${i}: worker mark lost (false) but job status is ${currentJobStatus} (expected SUPERSEDED)`)
        }
        cancelWon++
      } else {
        throw new Error(`Race ${i}: unexpected worker output: ${workerRes.output}`)
      }
    }

    console.log(`Race outcomes (5 runs): markSendingWon=${markWon}, cancelWon=${cancelWon}`)
    console.log('[PASS] No deadlocks, all iterations cleanly resolved into either SENDING or SUPERSEDED with full state assertions.')
  } finally {
    // [5/5] Always cleanup fixtures reliably
    teardownFixture()
  }

  console.log('PASS: local PostgreSQL concurrency and race condition tests complete.')
}

main().catch((err) => {
  console.error('[FATAL]', err)
  process.exit(1)
})
