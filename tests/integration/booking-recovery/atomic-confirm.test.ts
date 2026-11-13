import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { asyncQuery, query } from '../vault/pg-client';

function rawSql(sql: string) {
  const run = spawnSync(`${process.env.PG16_BIN || '/opt/homebrew/opt/postgresql@16/bin'}/psql`,
    ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '-d', process.env.PGDATABASE!],
    { input: sql, encoding: 'utf8' });
  if (run.status) throw new Error(`rawSql failed: ${run.stderr}`);
}

function fixture() {
  const workspace = randomUUID();
  const actor = randomUUID();
  const service = randomUUID();
  const slot = randomUUID();
  const connection = randomUUID();
  const externalAccountId = `acct_${workspace}`;
  query(`insert into auth.users (id) values ('${actor}')`);
  query(`insert into workspaces (id, name, created_by) values ('${workspace}', 'Atomic test', '${actor}')`);
  query(`insert into workspace_members (workspace_id, user_id, role, status)
    values ('${workspace}', '${actor}', 'owner', 'active')
    on conflict (workspace_id, user_id) do update set role = excluded.role, status = excluded.status`);
  query(`insert into channel_connections (id, workspace_id, channel, status, external_account_id)
    values ('${connection}', '${workspace}', 'instagram', 'connected', '${externalAccountId}')`);
  query(`insert into workspace_products_services (id, workspace_id, name, price, active)
    values ('${service}', '${workspace}', 'Confirmed service', 40000, true)`);
  query(`insert into booking_recovery_slots
    (id, workspace_id, service_id, starts_at, ends_at, deposit_krw, catalog_version, confirmed_by, valid_until)
    values ('${slot}', '${workspace}', '${service}', now() + interval '1 day', now() + interval '1 day 1 hour',
      0, 'catalog-1', '${actor}', now() + interval '15 minutes')`);

  function customer(options?: { omitReceipt?: boolean; wording?: string; customProof?: any }) {
    const thread = randomUUID();
    const inbound = randomUUID();
    const acceptance = randomUUID();
    const fingerprint = randomUUID().replaceAll('-', '').repeat(2);
    query(`insert into instagram_dm_threads
      (id, workspace_id, channel_connection_id, provider_thread_id, customer_id, customer_handle, last_message_at, expires_at, status, last_message_text)
      values ('${thread}', '${workspace}', '${connection}', '${thread}', '${thread}', 'test', now(), now() + interval '1 day', 'NEEDS_REPLY', '예약 문의')`);
    query(`insert into instagram_dm_messages
      (id, workspace_id, thread_id, provider_message_id, sender_type, sender_id, text, sent_at)
      values ('${inbound}', '${workspace}', '${thread}', '${inbound}', 'customer', '${thread}', '예약 문의', now() - interval '10 minutes')`);
    const caseId = query<{ res: { id: string } }>(`select public.open_booking_recovery('${workspace}', '${inbound}', '${actor}') as res`)[0].res.id;
    query(`insert into booking_recovery_proposals
      (workspace_id, case_id, revision, source_inbound_message_id, source_thread_id, service_id, catalog_version,
       service_name, total_amount_krw, deposit_krw, slot_id, slot_version, starts_at, ends_at, timezone,
       availability_confirmed_at, valid_until, reply_text, payload_fingerprint, created_at)
      select '${workspace}', '${caseId}', 1, '${inbound}', '${thread}', '${service}', 'catalog-1',
        'Confirmed service', 40000, 0, id, version, starts_at, ends_at, timezone,
        confirmed_at, valid_until, '예약 제안', '${fingerprint}', now() - interval '8 minutes' from booking_recovery_slots where id = '${slot}'`);

    const observedAt = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const requestedAt = new Date(Date.now() - 6 * 60 * 1000).toISOString();
    if (!options?.omitReceipt) {
      const proof = JSON.stringify(options?.customProof ?? {
        schemaVersion: 1, channel: 'instagram', providerMessageId: `prov_${acceptance}`,
        payloadFingerprint: fingerprint, senderId: externalAccountId, recipientRef: thread,
        requestedAt, observedAt,
      }).replaceAll("'", "''");
      query(`insert into booking_recovery_steps
        (workspace_id, case_id, kind, status, input_fingerprint, idempotency_key, attempt, actor_id, provider_message_id, evidence_ref, occurred_at)
        values ('${workspace}', '${caseId}', 'SEND_DM_VERIFIED', 'COMPLETED', '${fingerprint}',
          'idemp-step-${randomUUID()}', 1, '${actor}', 'prov_${acceptance}', '${proof}', now() - interval '4 minutes')`);
    }

    const text = options?.wording ?? '네 그 시간으로 예약해주세요';
    query(`insert into instagram_dm_messages
      (id, workspace_id, thread_id, provider_message_id, sender_type, sender_id, text, sent_at)
      values ('${acceptance}', '${workspace}', '${thread}', '${acceptance}', 'customer', '${thread}', '${text}', now() - interval '2 minutes')`);
    query(`update booking_recovery_cases set stage = 'AWAITING_BOOKING_APPROVAL', version = 4,
      accepted_inbound_message_id = '${acceptance}' where id = '${caseId}'`);
    query(`insert into booking_recovery_approvals
      (workspace_id, case_id, step_kind, payload_fingerprint, case_version, source_message_id,
       catalog_version, slot_version, approved_by, expires_at)
      values ('${workspace}', '${caseId}', 'BOOK', '${fingerprint}', 4, '${acceptance}',
        'catalog-1', 1, '${actor}', now() + interval '15 minutes')`);
    const command = (fp = fingerprint, message = acceptance) =>
      `select public.confirm_booking_recovery('${workspace}', '${caseId}', 4, 1, '${actor}', '${message}', '${fp}') as res`;
    return { caseId, thread, acceptance, inbound, fingerprint, command, connection, externalAccountId };
  }
  return { workspace, actor, slot, service, connection, externalAccountId, customer };
}

describe('ANI-1611 atomic booking / isolated PostgreSQL', () => {
  it('동일 슬롯 두 고객의 동시 확정은 정확히 한 예약만 커밋한다', async () => {
    const f = fixture();
    const a = f.customer();
    const b = f.customer();
    const results = await Promise.allSettled([asyncQuery(a.command()), asyncQuery(b.command())]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find(r => r.status === 'rejected') as PromiseRejectedResult;
    expect(String(rejected.reason)).toMatch(/SLOT_NOT_AVAILABLE|CONFLICT/);
    expect(query<{ n: number }>(`select count(*)::int as n from reservations where workspace_id = '${f.workspace}'`)[0].n).toBe(1);
    expect(query<{ n: number }>(`select count(*)::int as n from booking_recovery_approvals where workspace_id = '${f.workspace}' and consumed_at is not null`)[0].n).toBe(1);
    expect(query<{ n: number }>(`select count(*)::int as n from marketing_missions where workspace_id = '${f.workspace}' and status = 'BOOKED'`)[0].n).toBe(1);
  });

  it('같은 case 중복 클릭은 같은 예약을 반환하고 확정 이벤트는 한 번만 남는다', async () => {
    const f = fixture();
    const a = f.customer();
    const results = await Promise.all([asyncQuery<any>(a.command()), asyncQuery<any>(a.command())]);
    expect(results[0][0].res.reservation_id).toBe(results[1][0].res.reservation_id);
    expect(query<{ n: number }>(`select count(*)::int as n from mission_events where workspace_id = '${f.workspace}' and event_name = 'BOOKING_CONFIRMED'`)[0].n).toBe(1);
  });

  it('SQL timeout으로 트랜잭션이 중단되면 원장이 롤백되고 재시도는 한 번만 확정한다', () => {
    const f = fixture();
    const a = f.customer();
    const timeout = spawnSync(`${process.env.PG16_BIN || '/opt/homebrew/opt/postgresql@16/bin'}/psql`,
      ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '-d', process.env.PGDATABASE!], {
        input: `begin; ${a.command()}; set local statement_timeout = '100ms'; select pg_sleep(1); commit;`,
        encoding: 'utf8',
      });
    expect(timeout.status).not.toBe(0);
    expect(timeout.stderr).toMatch(/statement timeout/);
    expect(query<{ n: number }>(`select count(*)::int as n from reservations where workspace_id = '${f.workspace}'`)[0].n).toBe(0);
    expect(query<{ status: string }>(`select status from booking_recovery_slots where id = '${f.slot}'`)[0].status).toBe('AVAILABLE');
    expect(query<{ n: number }>(`select count(*)::int as n from booking_recovery_approvals where case_id = '${a.caseId}' and consumed_at is not null`)[0].n).toBe(0);
    query(a.command());
    expect(query<{ n: number }>(`select count(*)::int as n from reservations where workspace_id = '${f.workspace}'`)[0].n).toBe(1);
  });

  it('사업장 A 케이스에 사업장 B 고객 수락 메시지를 연결할 수 없다', () => {
    const a = fixture();
    const own = a.customer();
    const b = fixture();
    const foreign = b.customer();
    expect(() => query(`update booking_recovery_cases set accepted_inbound_message_id = '${foreign.acceptance}'
      where workspace_id = '${a.workspace}' and id = '${own.caseId}'`)).toThrow(/foreign key constraint/);
    expect(query<{ accepted_inbound_message_id: string }>(`select accepted_inbound_message_id from booking_recovery_cases
      where workspace_id = '${a.workspace}' and id = '${own.caseId}'`)[0].accepted_inbound_message_id).toBe(own.acceptance);
  });

  it('수락 메시지 보존기간 정리 시 사업장 키는 유지하고 선택적 수락 참조만 비운다', () => {
    const f = fixture();
    const a = f.customer();
    query(`delete from instagram_dm_messages where workspace_id = '${f.workspace}' and id = '${a.acceptance}'`);
    expect(query(`select workspace_id, accepted_inbound_message_id from booking_recovery_cases where id = '${a.caseId}'`))
      .toEqual([{ workspace_id: f.workspace, accepted_inbound_message_id: null }]);
  });

  it('이미 확정된 예약 재시도라도 다른 승인 지문은 거부한다', () => {
    const f = fixture();
    const a = f.customer();
    query(a.command());
    expect(() => query(a.command('0'.repeat(64)))).toThrow(/REPLAY_EVIDENCE_MISMATCH/);
  });

  it('이미 확정된 예약 재시도라도 다른 수락 메시지는 거부한다', () => {
    const f = fixture();
    const a = f.customer();
    query(a.command());
    expect(() => query(a.command(a.fingerprint, a.inbound))).toThrow(/REPLAY_EVIDENCE_MISMATCH/);
  });

  it('독립 전달 영수증이 없는 최종 confirm은 엄격히 거부한다', () => {
    const f = fixture();
    const a = f.customer({ omitReceipt: true });
    expect(() => query(a.command())).toThrow(/VERIFIED_DELIVERY_REQUIRED/);
  });

  it('수락 메시지 이후에 도착한 최신 고객 발화가 존재하면 최종 confirm을 거부한다', () => {
    const f = fixture();
    const a = f.customer();
    // Insert a newer customer message in the same thread
    query(`insert into instagram_dm_messages
      (id, workspace_id, thread_id, provider_message_id, sender_type, sender_id, text, sent_at)
      values ('${randomUUID()}', '${f.workspace}', '${a.thread}', 'prov_newer', 'customer', '${a.thread}', '취소할게요', now())`);
    expect(() => query(a.command())).toThrow(/ACCEPTANCE_SUPERSEDED/);
  });

  it('transition_booking_recovery CUSTOMER_ACCEPTED는 outbox CUSTOMER_ACCEPTED를 원자적으로 적재한다', () => {
    const f = fixture();
    const thread = randomUUID();
    const inbound = randomUUID();
    const acceptance = randomUUID();
    const fingerprint = 'c'.repeat(64);
    query(`insert into instagram_dm_threads
      (id, workspace_id, channel_connection_id, provider_thread_id, customer_id, customer_handle, last_message_at, expires_at, status, last_message_text)
      values ('${thread}', '${f.workspace}', '${f.connection}', '${thread}', '${thread}', 'test', now(), now() + interval '1 day', 'NEEDS_REPLY', '문의')`);
    query(`insert into instagram_dm_messages
      (id, workspace_id, thread_id, provider_message_id, sender_type, sender_id, text, sent_at)
      values ('${inbound}', '${f.workspace}', '${thread}', '${inbound}', 'customer', '${thread}', '문의', now() - interval '10 minutes')`);
    const caseId = query<{ res: { id: string } }>(`select public.open_booking_recovery('${f.workspace}', '${inbound}', '${f.actor}') as res`)[0].res.id;
    query(`update booking_recovery_cases set stage = 'AWAITING_CUSTOMER', version = 2 where id = '${caseId}'`);
    query(`insert into booking_recovery_proposals
      (workspace_id, case_id, revision, source_inbound_message_id, source_thread_id, service_id, catalog_version,
       service_name, total_amount_krw, deposit_krw, slot_id, slot_version, starts_at, ends_at, timezone,
       availability_confirmed_at, valid_until, reply_text, payload_fingerprint, created_at)
      select '${f.workspace}', '${caseId}', 1, '${inbound}', '${thread}', '${f.service}', 'catalog-1',
        'Confirmed service', 40000, 0, id, version, starts_at, ends_at, timezone,
        confirmed_at, valid_until, '제안', '${fingerprint}', now() - interval '8 minutes' from booking_recovery_slots where id = '${f.slot}'`);

    const proof = JSON.stringify({
      schemaVersion: 1, channel: 'instagram', providerMessageId: `prov_${acceptance}`,
      payloadFingerprint: fingerprint, senderId: f.externalAccountId, recipientRef: thread,
      requestedAt: new Date(Date.now() - 6 * 60 * 1000).toISOString(),
      observedAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
    }).replaceAll("'", "''");

    query(`insert into booking_recovery_steps
      (workspace_id, case_id, kind, status, input_fingerprint, idempotency_key, attempt, actor_id, provider_message_id, evidence_ref, occurred_at)
      values ('${f.workspace}', '${caseId}', 'SEND_DM_VERIFIED', 'COMPLETED', '${fingerprint}',
        'step-${randomUUID()}', 1, '${f.actor}', 'prov_${acceptance}', '${proof}', now() - interval '4 minutes')`);

    query(`insert into instagram_dm_messages
      (id, workspace_id, thread_id, provider_message_id, sender_type, sender_id, text, sent_at)
      values ('${acceptance}', '${f.workspace}', '${thread}', '${acceptance}', 'customer', '${thread}', '네 그 시간으로 예약해주세요', now() - interval '2 minutes')`);

    query(`select public.transition_booking_recovery('${f.workspace}', '${caseId}', 2, 'CUSTOMER_ACCEPTED', '${f.actor}', 'CONFIRM_ACCEPTANCE', '${fingerprint}', 'idemp-acc-1', null, '${acceptance}')`);

    const outbox = query<{ id: string; kind: string; state: string }>(`select id, kind, state from booking_recovery_outbox where workspace_id = '${f.workspace}' and case_id = '${caseId}'`);
    expect(outbox).toHaveLength(1);
    expect(outbox[0].kind).toBe('CUSTOMER_ACCEPTED');
    expect(outbox[0].state).toBe('PENDING');
  });

  it('outbox 삽입 실패 시 case stage, version, accepted ID, 감사 step 전체가 원자적으로 롤백된다', () => {
    const f = fixture();
    const thread = randomUUID();
    const inbound = randomUUID();
    const acceptance = randomUUID();
    const fingerprint = 'd'.repeat(64);
    query(`insert into instagram_dm_threads
      (id, workspace_id, channel_connection_id, provider_thread_id, customer_id, customer_handle, last_message_at, expires_at, status, last_message_text)
      values ('${thread}', '${f.workspace}', '${f.connection}', '${thread}', '${thread}', 'test', now(), now() + interval '1 day', 'NEEDS_REPLY', '문의')`);
    query(`insert into instagram_dm_messages
      (id, workspace_id, thread_id, provider_message_id, sender_type, sender_id, text, sent_at)
      values ('${inbound}', '${f.workspace}', '${thread}', '${inbound}', 'customer', '${thread}', '문의', now() - interval '10 minutes')`);
    const caseId = query<{ res: { id: string } }>(`select public.open_booking_recovery('${f.workspace}', '${inbound}', '${f.actor}') as res`)[0].res.id;
    query(`update booking_recovery_cases set stage = 'AWAITING_CUSTOMER', version = 2 where id = '${caseId}'`);
    query(`insert into booking_recovery_proposals
      (workspace_id, case_id, revision, source_inbound_message_id, source_thread_id, service_id, catalog_version,
       service_name, total_amount_krw, deposit_krw, slot_id, slot_version, starts_at, ends_at, timezone,
       availability_confirmed_at, valid_until, reply_text, payload_fingerprint, created_at)
      select '${f.workspace}', '${caseId}', 1, '${inbound}', '${thread}', '${f.service}', 'catalog-1',
        'Confirmed service', 40000, 0, id, version, starts_at, ends_at, timezone,
        confirmed_at, valid_until, '제안', '${fingerprint}', now() - interval '8 minutes' from booking_recovery_slots where id = '${f.slot}'`);

    const proof = JSON.stringify({
      schemaVersion: 1, channel: 'instagram', providerMessageId: `prov_${acceptance}`,
      payloadFingerprint: fingerprint, senderId: f.externalAccountId, recipientRef: thread,
      requestedAt: new Date(Date.now() - 6 * 60 * 1000).toISOString(),
      observedAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
    }).replaceAll("'", "''");

    query(`insert into booking_recovery_steps
      (workspace_id, case_id, kind, status, input_fingerprint, idempotency_key, attempt, actor_id, provider_message_id, evidence_ref, occurred_at)
      values ('${f.workspace}', '${caseId}', 'SEND_DM_VERIFIED', 'COMPLETED', '${fingerprint}',
        'step-${randomUUID()}', 1, '${f.actor}', 'prov_${acceptance}', '${proof}', now() - interval '4 minutes')`);

    query(`insert into instagram_dm_messages
      (id, workspace_id, thread_id, provider_message_id, sender_type, sender_id, text, sent_at)
      values ('${acceptance}', '${f.workspace}', '${thread}', '${acceptance}', 'customer', '${thread}', '네 그 시간으로 예약해주세요', now() - interval '2 minutes')`);

    // Create a temporary failing trigger on booking_recovery_outbox
    rawSql(`create or replace function fail_outbox_insert() returns trigger language plpgsql as $$
      begin raise exception 'SIMULATED_OUTBOX_DISK_FAILURE' using errcode = '54000'; end; $$;`);
    rawSql(`create trigger trg_fail_outbox before insert on booking_recovery_outbox
      for each row execute function fail_outbox_insert();`);

    try {
      expect(() => query(`select public.transition_booking_recovery('${f.workspace}', '${caseId}', 2, 'CUSTOMER_ACCEPTED', '${f.actor}', 'CONFIRM_ACCEPTANCE', '${fingerprint}', 'idemp-fail-1', null, '${acceptance}')`))
        .toThrow(/SIMULATED_OUTBOX_DISK_FAILURE/);

      // Verify case stage and version were rolled back
      const c = query<any>(`select stage, version, accepted_inbound_message_id from booking_recovery_cases where id = '${caseId}'`)[0];
      expect(c.stage).toBe('AWAITING_CUSTOMER');
      expect(c.version).toBe(2);
      expect(c.accepted_inbound_message_id).toBeNull();

      // Verify audit step was rolled back
      const steps = query<any>(`select id from booking_recovery_steps where case_id = '${caseId}' and kind = 'CONFIRM_ACCEPTANCE'`);
      expect(steps).toHaveLength(0);

      // Verify outbox has 0 rows
      const outbox = query<any>(`select id from booking_recovery_outbox where case_id = '${caseId}'`);
      expect(outbox).toHaveLength(0);
    } finally {
      rawSql(`drop trigger if exists trg_fail_outbox on booking_recovery_outbox;`);
      rawSql(`drop function if exists fail_outbox_insert;`);
    }
  });

  it('thread FOR UPDATE는 concurrent message INSERT의 FK KEY SHARE와 충돌하여 신규 발화를 직렬화한다 (2-connection 실측)', async () => {
    const f = fixture();
    const a = f.customer();
    const psqlBin = `${process.env.PG16_BIN || '/opt/homebrew/opt/postgresql@16/bin'}/psql`;
    const dbName = process.env.PGDATABASE!;
    const socketHost = process.env.PGHOST!;
    const socketPort = process.env.PGPORT!;

    // Connection A opens transaction, executes confirm_booking_recovery, but DOES NOT commit yet.
    const { spawn } = await import('node:child_process');
    const psqlA = spawn(psqlBin, ['-X', '-v', 'ON_ERROR_STOP=1', '-h', socketHost, '-p', socketPort, '-d', dbName], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdoutA = '';
    psqlA.stdout.on('data', (d) => { stdoutA += d.toString(); });
    psqlA.stderr.on('data', (d) => { console.error('psqlA stderr:', d.toString()); });

    const newMsgId = randomUUID();
    let psqlB: any = null;

    try {
      // 1. Capture Connection A backend PID
      psqlA.stdin.write(`SET application_name = 'barrier_fwd_A';\n`);
      psqlA.stdin.write(`SELECT 'PIDA:' || pg_backend_pid() as pid_marker;\n`);

      let pidA: number | null = null;
      await new Promise<void>((resolve, reject) => {
        const interval = setInterval(() => {
          const match = stdoutA.match(/PIDA:(\d+)/);
          if (match) {
            pidA = parseInt(match[1], 10);
            clearInterval(interval);
            resolve();
          }
        }, 30);
        setTimeout(() => { clearInterval(interval); reject(new Error('Timeout waiting for pidA: ' + stdoutA)); }, 4000);
      });
      expect(pidA).toBeGreaterThan(0);

      // 2. Start A's transaction and execute confirm
      psqlA.stdin.write(`BEGIN;\n`);
      psqlA.stdin.write(`${a.command()};\n`);
      psqlA.stdin.write(`SELECT 'CONFIRM_EXECUTED_WAITING_COMMIT' as marker;\n`);

      // Wait until A has executed confirm
      await new Promise<void>((resolve, reject) => {
        const interval = setInterval(() => {
          if (stdoutA.includes('CONFIRM_EXECUTED_WAITING_COMMIT')) {
            clearInterval(interval);
            resolve();
          }
        }, 50);
        setTimeout(() => { clearInterval(interval); reject(new Error('Timeout waiting for psqlA confirm execution: ' + stdoutA)); }, 5000);
      });

      // 3. Connection B attempts to insert a new customer message into the same thread
      psqlB = spawn(psqlBin, ['-X', '-v', 'ON_ERROR_STOP=1', '-h', socketHost, '-p', socketPort, '-d', dbName], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let bFinished = false;
      let stdoutB = '';
      psqlB.stdout.on('data', (d: Buffer | string) => { stdoutB += d.toString(); });
      psqlB.on('exit', () => { bFinished = true; });

      psqlB.stdin.write(`SET application_name = 'barrier_fwd_B';\n`);
      psqlB.stdin.write(`SELECT 'PIDB:' || pg_backend_pid() as pid_marker;\n`);

      let pidB: number | null = null;
      await new Promise<void>((resolve, reject) => {
        const interval = setInterval(() => {
          const match = stdoutB.match(/PIDB:(\d+)/);
          if (match) {
            pidB = parseInt(match[1], 10);
            clearInterval(interval);
            resolve();
          }
        }, 30);
        setTimeout(() => { clearInterval(interval); reject(new Error('Timeout waiting for pidB: ' + stdoutB)); }, 4000);
      });
      expect(pidB).toBeGreaterThan(0);

      psqlB.stdin.write(`INSERT INTO instagram_dm_messages (id, workspace_id, thread_id, provider_message_id, sender_type, sender_id, text, sent_at)
        VALUES ('${newMsgId}', '${f.workspace}', '${a.thread}', 'prov_concurrent', 'customer', '${a.thread}', '뒤늦은 문의', now());\n`);
      psqlB.stdin.write(`SELECT 'B_INSERT_FINISHED' as marker;\n`);
      psqlB.stdin.end();

      // Condition wait for B to become blocked specifically by A (blocking_pid === pidA) with wait_event_type = 'Lock'
      let bBlockedByA = false;
      for (let i = 0; i < 60; i++) {
        await new Promise(r => setTimeout(r, 50));
        const blocking = query<{ blocked_pid: number; blocking_pid: number; wait_event_type: string }>(`
          SELECT pid as blocked_pid, unnest(pg_blocking_pids(pid)) as blocking_pid, wait_event_type
          FROM pg_stat_activity
          WHERE pid = ${pidB}
        `);
        if (blocking.length > 0 && blocking.some(r => r.blocking_pid === pidA && r.wait_event_type === 'Lock')) {
          bBlockedByA = true;
          break;
        }
      }
      expect(bBlockedByA).toBe(true);
      expect(bFinished).toBe(false);

      // Now COMMIT connection A
      psqlA.stdin.write(`COMMIT;\n`);
      psqlA.stdin.end();

      // Wait for B to finish after A commits
      await new Promise<void>((resolve, reject) => {
        const interval = setInterval(() => {
          if (bFinished || stdoutB.includes('B_INSERT_FINISHED')) {
            clearInterval(interval);
            resolve();
          }
        }, 50);
        setTimeout(() => { clearInterval(interval); reject(new Error('Timeout waiting for psqlB to unblock after commit: ' + stdoutB)); }, 5000);
      });

      // Both completed! Exactly 1 reservation exists.
      expect(query<{ n: number }>(`select count(*)::int as n from reservations where workspace_id = '${f.workspace}'`)[0].n).toBe(1);
      // And B's message was safely inserted AFTER confirmation
      expect(query<{ n: number }>(`select count(*)::int as n from instagram_dm_messages where id = '${newMsgId}'`)[0].n).toBe(1);
    } finally {
      try { psqlA.kill(); } catch {}
      if (psqlB) { try { psqlB.kill(); } catch {} }
    }
  });

  it('물음표(? 또는 ？)가 포함된 질문형 발화는 수락으로 오인하지 않고 거부한다', () => {
    const f = fixture();
    const a1 = f.customer({ wording: '그 시간으로 예약할게요?' });
    expect(() => query(a1.command())).toThrow(/AMBIGUOUS_ACCEPTANCE/);

    const a2 = f.customer({ wording: '그 시간으로 예약할게요？' });
    expect(() => query(a2.command())).toThrow(/AMBIGUOUS_ACCEPTANCE/);
  });

  it('전송 영수증의 schemaVersion 누락, 문자열 1, 숫자 providerID, offset 없는 시간은 엄격히 거부한다', () => {
    const f = fixture();

    // 1. schemaVersion as string '1' instead of number 1
    const a1 = f.customer({
      customProof: {
        schemaVersion: '1', channel: 'instagram', providerMessageId: 'prov_bad_1',
        payloadFingerprint: 'a'.repeat(64), senderId: f.externalAccountId, recipientRef: 'cust_bad',
        requestedAt: new Date(Date.now() - 6 * 60 * 1000).toISOString(),
        observedAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
      },
    });
    expect(() => query(a1.command())).toThrow(/INVALID_EVIDENCE/);

    // 2. providerMessageId as number instead of string
    const a2 = f.customer({
      customProof: {
        schemaVersion: 1, channel: 'instagram', providerMessageId: 12345,
        payloadFingerprint: 'b'.repeat(64), senderId: f.externalAccountId, recipientRef: 'cust_bad',
        requestedAt: new Date(Date.now() - 6 * 60 * 1000).toISOString(),
        observedAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
      },
    });
    expect(() => query(a2.command())).toThrow(/INVALID_EVIDENCE/);

    // 3. timestamp without offset / date-only
    const a3 = f.customer({
      customProof: {
        schemaVersion: 1, channel: 'instagram', providerMessageId: 'prov_bad_3',
        payloadFingerprint: 'c'.repeat(64), senderId: f.externalAccountId, recipientRef: 'cust_bad',
        requestedAt: '2026-10-22', observedAt: '2026-10-22',
      },
    });
    expect(() => query(a3.command())).toThrow(/INVALID_EVIDENCE/);

    // 4. missing schemaVersion key
    const a4 = f.customer({
      customProof: {
        channel: 'instagram', providerMessageId: 'prov_bad_4',
        payloadFingerprint: 'c'.repeat(64), senderId: f.externalAccountId, recipientRef: 'cust_bad',
        requestedAt: new Date(Date.now() - 6 * 60 * 1000).toISOString(),
        observedAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
      },
    });
    expect(() => query(a4.command())).toThrow(/INVALID_EVIDENCE/);

    // 5. null schemaVersion
    const a5 = f.customer({
      customProof: {
        schemaVersion: null, channel: 'instagram', providerMessageId: 'prov_bad_5',
        payloadFingerprint: 'c'.repeat(64), senderId: f.externalAccountId, recipientRef: 'cust_bad',
        requestedAt: new Date(Date.now() - 6 * 60 * 1000).toISOString(),
        observedAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
      },
    });
    expect(() => query(a5.command())).toThrow(/INVALID_EVIDENCE/);

    // 6. extra disallowed key (strict rejection)
    const a6 = f.customer({
      customProof: {
        schemaVersion: 1, channel: 'instagram', providerMessageId: 'prov_bad_6',
        payloadFingerprint: 'c'.repeat(64), senderId: f.externalAccountId, recipientRef: 'cust_bad',
        requestedAt: new Date(Date.now() - 6 * 60 * 1000).toISOString(),
        observedAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
        extraKey: 'not-allowed',
      },
    });
    expect(() => query(a6.command())).toThrow(/INVALID_EVIDENCE/);
  });

  it('채널의 external_account_id가 NULL이거나 공백이면 confirm은 거부되어야 한다', () => {
    const f = fixture();
    const a1 = f.customer();
    query(`update channel_connections set external_account_id = null where id = '${f.connection}'`);
    expect(() => query(a1.command())).toThrow(/INVALID_EVIDENCE/);

    query(`update channel_connections set external_account_id = '   ' where id = '${f.connection}'`);
    expect(() => query(a1.command())).toThrow(/INVALID_EVIDENCE/);
  });

  it('transition replay 시 다른 fingerprint이거나 감사/outbox 결속이 없으면 거부한다', () => {
    const f = fixture();
    const a = f.customer();
    query(`update booking_recovery_cases set stage = 'CUSTOMER_ACCEPTED' where id = '${a.caseId}'`);
    // Attempt replay with a DIFFERENT fingerprint
    expect(() => query(`select public.transition_booking_recovery(
      '${f.workspace}', '${a.caseId}', 4, 'CUSTOMER_ACCEPTED', '${f.actor}', 'CONFIRM_ACCEPTANCE',
      '${'0'.repeat(64)}', 'replay-idemp-1', null, '${a.acceptance}'
    )`)).toThrow(/VERSION_CONFLICT/);
  });

  it('transition replay 시 감사 step 또는 outbox 부재 시 거부한다', () => {
    const f = fixture();
    const a = f.customer();
    query(`update booking_recovery_cases set stage = 'CUSTOMER_ACCEPTED', accepted_inbound_message_id = '${a.acceptance}' where id = '${a.caseId}'`);
    // No audit step and no outbox exist yet for CUSTOMER_ACCEPTED
    expect(() => query(`select public.transition_booking_recovery(
      '${f.workspace}', '${a.caseId}', 4, 'CUSTOMER_ACCEPTED', '${f.actor}', 'CONFIRM_ACCEPTANCE',
      '${a.fingerprint}', 'replay-no-step', null, '${a.acceptance}'
    )`)).toThrow(/VERSION_CONFLICT/);
  });

  it('transition replay는 동일 fingerprint 및 bound evidence/outbox 존재 시 멱등 성공한다', () => {
    const f = fixture();
    const a = f.customer();
    // 1. Initial transition to CUSTOMER_ACCEPTED
    query(`update booking_recovery_cases set stage = 'AWAITING_CUSTOMER', version = 2 where id = '${a.caseId}'`);
    const res1 = query<any>(`select public.transition_booking_recovery(
      '${f.workspace}', '${a.caseId}', 2, 'CUSTOMER_ACCEPTED', '${f.actor}', 'CONFIRM_ACCEPTANCE',
      '${a.fingerprint}', 'replay-idemp-ok', null, '${a.acceptance}'
    ) as res`)[0].res;
    expect(res1.stage).toBe('CUSTOMER_ACCEPTED');
    expect(res1.version).toBe(3);

    // 2. Exact Replay with same parameters returns existing case without error or extra outbox
    const res2 = query<any>(`select public.transition_booking_recovery(
      '${f.workspace}', '${a.caseId}', 3, 'CUSTOMER_ACCEPTED', '${f.actor}', 'CONFIRM_ACCEPTANCE',
      '${a.fingerprint}', 'replay-idemp-ok', null, '${a.acceptance}'
    ) as res`)[0].res;
    expect(res2.stage).toBe('CUSTOMER_ACCEPTED');
    expect(res2.version).toBe(3);
  });

  it('finalconfirm 호출 시 messageId가 case.accepted_inbound_message_id 또는 approval.source_message_id와 다르면 거부한다', () => {
    const f = fixture();
    const a = f.customer();
    const differentMsgId = randomUUID();
    query(`insert into instagram_dm_messages (id, workspace_id, thread_id, provider_message_id, sender_type, sender_id, text, sent_at)
      values ('${differentMsgId}', '${f.workspace}', '${a.thread}', 'prov_diff', 'customer', '${a.thread}', '네 그 시간으로 예약해주세요', now() - interval '1 minute')`);

    // Call confirm with differentMsgId, which differs from case.accepted_inbound_message_id and approval.source_message_id
    expect(() => query(a.command(a.fingerprint, differentMsgId))).toThrow(/ACCEPTANCE_BINDING_MISMATCH/);
  });

  it('BOOK approval 지문과 proposal reply 지문이 서로 다른 정상 계약도 성공 확정된다', () => {
    const f = fixture();
    const a = f.customer();
    const bookFingerprint = 'f'.repeat(64);
    // Update approval to use the distinct bookFingerprint while proposal keeps a.fingerprint
    query(`update booking_recovery_approvals set payload_fingerprint = '${bookFingerprint}' where case_id = '${a.caseId}'`);

    const result = query<any>(a.command(bookFingerprint))[0].res;
    expect(result.reservation_id).toBeTruthy();
    expect(query<{ n: number }>(`select count(*)::int as n from reservations where id = '${result.reservation_id}' and evidence_id = '${bookFingerprint}'`)[0].n).toBe(1);
  });

  it('slot snapshot 속성(starts_at 등)이 proposal과 불일치하면 same version이어도 거부한다', () => {
    const f = fixture();
    const a = f.customer();
    // Tamper slot starts_at
    query(`update booking_recovery_slots set starts_at = starts_at + interval '10 minutes' where id = '${f.slot}'`);
    expect(() => query(a.command())).toThrow(/SLOT_SNAPSHOT_MISMATCH/);
  });

  it('수락 당시 제안과 현재 제안의 slot_id가 다르면 confirm은 거부한다', () => {
    const f = fixture();
    const a = f.customer();
    const otherSlotId = randomUUID();
    query(`insert into booking_recovery_slots (id, workspace_id, service_id, starts_at, ends_at, deposit_krw, catalog_version, confirmed_by, valid_until)
      values ('${otherSlotId}', '${f.workspace}', '${f.service}', now() + interval '2 days', now() + interval '2 days 1 hour', 0, 'catalog-1', '${f.actor}', now() + interval '15 minutes')`);

    // Proposal revision 2 created with otherSlotId but same other terms
    query(`insert into booking_recovery_proposals
      (workspace_id, case_id, revision, source_inbound_message_id, source_thread_id, service_id, catalog_version,
       service_name, total_amount_krw, deposit_krw, slot_id, slot_version, starts_at, ends_at, timezone,
       availability_confirmed_at, valid_until, reply_text, payload_fingerprint, created_at)
      select '${f.workspace}', '${a.caseId}', 2, '${a.inbound}', '${a.thread}', '${f.service}', 'catalog-1',
        'Confirmed service', 40000, 0, '${otherSlotId}', 1, starts_at, ends_at, timezone,
        confirmed_at, valid_until, '예약 제안 2', '${a.fingerprint}', now() from booking_recovery_slots where id = '${otherSlotId}'`);

    query(`update booking_recovery_approvals set slot_version = 1 where case_id = '${a.caseId}'`);

    // Attempt confirm with revision 2
    expect(() => query(`select public.confirm_booking_recovery('${f.workspace}', '${a.caseId}', 4, 2, '${f.actor}', '${a.acceptance}', '${a.fingerprint}')`))
      .toThrow(/PROPOSAL_TERMS_CHANGED/);
  });

  it('역방향 2-connection barrier: B INSERT 트랜잭션이 A confirm을 막고, B 커밋 후 A는 ACCEPTANCE_SUPERSEDED로 거부된다', async () => {
    const f = fixture();
    const a = f.customer();
    const psqlBin = `${process.env.PG16_BIN || '/opt/homebrew/opt/postgresql@16/bin'}/psql`;
    const dbName = process.env.PGDATABASE!;
    const socketHost = process.env.PGHOST!;
    const socketPort = process.env.PGPORT!;

    const { spawn } = await import('node:child_process');

    // Connection B starts transaction and inserts a newer customer message (holding KEY SHARE on thread)
    const newMsgId = randomUUID();
    const psqlB = spawn(psqlBin, ['-X', '-v', 'ON_ERROR_STOP=1', '-h', socketHost, '-p', socketPort, '-d', dbName], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdoutB = '';
    psqlB.stdout.on('data', (d) => { stdoutB += d.toString(); });

    let psqlA: any = null;

    try {
      psqlB.stdin.write(`SET application_name = 'barrier_B_insert';\n`);
      psqlB.stdin.write(`SELECT 'PIDB:' || pg_backend_pid() as pid_marker;\n`);

      let pidB: number | null = null;
      await new Promise<void>((resolve, reject) => {
        const interval = setInterval(() => {
          const match = stdoutB.match(/PIDB:(\d+)/);
          if (match) {
            pidB = parseInt(match[1], 10);
            clearInterval(interval);
            resolve();
          }
        }, 30);
        setTimeout(() => { clearInterval(interval); reject(new Error('Timeout waiting for pidB in reverse: ' + stdoutB)); }, 4000);
      });
      expect(pidB).toBeGreaterThan(0);

      psqlB.stdin.write(`BEGIN;\n`);
      psqlB.stdin.write(`INSERT INTO instagram_dm_messages (id, workspace_id, thread_id, provider_message_id, sender_type, sender_id, text, sent_at)
        VALUES ('${newMsgId}', '${f.workspace}', '${a.thread}', 'prov_b_reverse', 'customer', '${a.thread}', '새로운 요청입니다', now());\n`);
      psqlB.stdin.write(`SELECT 'B_INSERTED_OPEN_TX' as marker;\n`);

      // Wait for B to execute insert inside open transaction
      await new Promise<void>((resolve, reject) => {
        const interval = setInterval(() => {
          if (stdoutB.includes('B_INSERTED_OPEN_TX')) {
            clearInterval(interval);
            resolve();
          }
        }, 50);
        setTimeout(() => { clearInterval(interval); reject(new Error('Timeout waiting for psqlB insert')); }, 5000);
      });

      // Connection A now attempts confirm_booking_recovery (which tries to acquire thread FOR UPDATE)
      // Because B holds KEY SHARE on the thread, A must be blocked!
      psqlA = spawn(psqlBin, ['-X', '-v', 'ON_ERROR_STOP=1', '-h', socketHost, '-p', socketPort, '-d', dbName], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let aFinished = false;
      let stdoutA = '';
      let stderrA = '';
      psqlA.stdout.on('data', (d: Buffer | string) => { stdoutA += d.toString(); });
      psqlA.stderr.on('data', (d: Buffer | string) => { stderrA += d.toString(); });
      psqlA.on('exit', () => { aFinished = true; });

      psqlA.stdin.write(`SET application_name = 'barrier_A_confirm';\n`);
      psqlA.stdin.write(`SELECT 'PIDA:' || pg_backend_pid() as pid_marker;\n`);

      let pidA: number | null = null;
      await new Promise<void>((resolve, reject) => {
        const interval = setInterval(() => {
          const match = stdoutA.match(/PIDA:(\d+)/);
          if (match) {
            pidA = parseInt(match[1], 10);
            clearInterval(interval);
            resolve();
          }
        }, 30);
        setTimeout(() => { clearInterval(interval); reject(new Error('Timeout waiting for pidA in reverse: ' + stdoutA)); }, 4000);
      });
      expect(pidA).toBeGreaterThan(0);

      psqlA.stdin.write(`${a.command()};\n`);
      psqlA.stdin.write(`SELECT 'A_CONFIRM_FINISHED' as marker;\n`);
      psqlA.stdin.end();

      // Condition wait for A to be blocked specifically by B (blocking_pid === pidB)
      let aBlockedByB = false;
      for (let i = 0; i < 60; i++) {
        await new Promise(r => setTimeout(r, 50));
        const blocking = query<{ blocked_pid: number; blocking_pid: number; wait_event_type: string }>(`
          SELECT pid as blocked_pid, unnest(pg_blocking_pids(pid)) as blocking_pid, wait_event_type
          FROM pg_stat_activity
          WHERE pid = ${pidA}
        `);
        if (blocking.length > 0 && blocking.some(r => r.blocking_pid === pidB && r.wait_event_type === 'Lock')) {
          aBlockedByB = true;
          break;
        }
      }
      expect(aBlockedByB).toBe(true);
      expect(aFinished).toBe(false);

      // Now COMMIT Connection B
      psqlB.stdin.write(`COMMIT;\n`);
      psqlB.stdin.end();

      // Wait for Connection A to unblock and fail with ACCEPTANCE_SUPERSEDED
      await new Promise<void>((resolve, reject) => {
        const interval = setInterval(() => {
          if (aFinished || stderrA.includes('ACCEPTANCE_SUPERSEDED')) {
            clearInterval(interval);
            resolve();
          }
        }, 50);
        setTimeout(() => { clearInterval(interval); reject(new Error('Timeout waiting for A to finish: ' + stderrA)); }, 5000);
      });

      expect(stderrA).toContain('ACCEPTANCE_SUPERSEDED');
      // No reservation created
      expect(query<{ n: number }>(`select count(*)::int as n from reservations where workspace_id = '${f.workspace}'`)[0].n).toBe(0);
    } finally {
      if (psqlA) { try { psqlA.kill(); } catch {} }
      try { psqlB.kill(); } catch {}
    }
  });
});
