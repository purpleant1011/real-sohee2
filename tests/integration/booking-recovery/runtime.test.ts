import { describe, it, expect, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { query, asyncQuery } from '../vault/pg-client';
import { BookingRecoveryRepository } from '@/features/booking-recovery/repository';
import { ReservationCanonicalService } from '@/features/reservations/reservation-canonical-service';

describe('Booking Recovery Runtime Isolated PostgreSQL Integration (Task 3)', () => {
  // Helper to create fully isolated, unique fixture per test
  function createTestFixture(prefix = 'tst') {
    const wsA = randomUUID();
    const wsB = randomUUID();
    const userA = randomUUID();
    const userB = randomUUID();
    const userInactive = randomUUID();

    const threadA = randomUUID();
    const msgA1 = randomUUID();
    const msgA2 = randomUUID();

    const channelConnA = randomUUID();
    const serviceA = randomUUID();

    // 1. Setup Users
    query(`insert into auth.users (id) values ('${userA}'), ('${userB}'), ('${userInactive}')`);

    // 2. Setup Workspaces & Memberships
    query(`insert into workspaces (id, name, created_by) values ('${wsA}', '${prefix} 매장 A', '${userA}'), ('${wsB}', '${prefix} 매장 B', '${userB}')`);

    query(`insert into workspace_members (workspace_id, user_id, role, status) values
      ('${wsA}', '${userA}', 'owner', 'active'),
      ('${wsB}', '${userB}', 'owner', 'active'),
      ('${wsA}', '${userInactive}', 'owner', 'disabled')
      on conflict (workspace_id, user_id) do update set role = excluded.role, status = excluded.status`);

    // 3. Setup Channel Connections & Threads
    query(`insert into channel_connections (id, workspace_id, channel, status, external_account_id) values ('${channelConnA}', '${wsA}', 'instagram', 'connected', 'business-account-${prefix}')`);

    query(`insert into instagram_dm_threads (id, workspace_id, channel_connection_id, provider_thread_id, customer_id, customer_handle, last_message_at, expires_at, status, last_message_text)
      values ('${threadA}', '${wsA}', '${channelConnA}', 'prov_th_${prefix}', 'cust_${prefix}', 'cust_handle_${prefix}', now(), now() + interval '24 hours', 'NEEDS_REPLY', '예약 문의합니다')`);

    // 4. Setup Inbound Customer Messages (sender_id matches thread.customer_id)
    query(`insert into instagram_dm_messages (id, workspace_id, thread_id, provider_message_id, sender_type, sender_id, text, sent_at) values
      ('${msgA1}', '${wsA}', '${threadA}', 'prov_msg_1_${prefix}', 'customer', 'cust_${prefix}', '목요일 예약 가능한가요?', now() - interval '10 minutes'),
      ('${msgA2}', '${wsA}', '${threadA}', 'prov_msg_2_${prefix}', 'customer', 'cust_${prefix}', '가격도 알려주세요', now() - interval '5 minutes')`);

    // 5. Setup Catalog Service
    query(`insert into workspace_products_services (id, workspace_id, name, price, active) values ('${serviceA}', '${wsA}', '맞춤 펌 ${prefix}', 120000, true)`);

    return { wsA, wsB, userA, userB, userInactive, threadA, msgA1, msgA2, channelConnA, serviceA, customerId: `cust_${prefix}` };
  }

  it('open_booking_recovery는 원자적으로 marketing_missions와 case를 만들고 customer_id 안정 식별자를 기록한다', () => {
    const f = createTestFixture('open_basic');

    const rows1 = query<any>(`select public.open_booking_recovery('${f.wsA}', '${f.msgA1}', '${f.userA}') as res`);
    const case1 = rows1[0].res;

    expect(case1.workspace_id).toBe(f.wsA);
    expect(case1.source_inbound_message_id).toBe(f.msgA1);
    expect(case1.customer_ref).toBe(f.customerId);
    expect(case1.stage).toBe('DISCOVERED');
    expect(case1.version).toBe(1);

    // Verify marketing mission was durably linked
    const missions = query<any>(`select * from public.marketing_missions where id = '${case1.mission_id}'`);
    expect(missions).toHaveLength(1);
    expect(missions[0].workspace_id).toBe(f.wsA);
    expect(missions[0].goal).toContain('예약 문의');
    expect(missions[0].metadata.customerRef).toBe(f.customerId);

    // 2nd open with same inbound message (Idempotency)
    const rows2 = query<any>(`select public.open_booking_recovery('${f.wsA}', '${f.msgA1}', '${f.userA}') as res`);
    const case2 = rows2[0].res;
    expect(case2.id).toBe(case1.id);
    expect(case2.mission_id).toBe(case1.mission_id);
    expect(case2.version).toBe(1);

    // Verify exactly one case exists
    const totalCases = query<{ n: number }>(`select count(*)::int as n from public.booking_recovery_cases where workspace_id = '${f.wsA}'`);
    expect(totalCases[0].n).toBe(1);

    // Verify exactly one marketing mission exists
    const totalMissions = query<{ n: number }>(`select count(*)::int as n from public.marketing_missions where workspace_id = '${f.wsA}'`);
    expect(totalMissions[0].n).toBe(1);
  });

  it('동시성: 실제 별도 2개 PG connection에서 동일 source message open 동시 실행 시 양쪽 동일 caseId와 mission 1개 보장', async () => {
    const f = createTestFixture('concurrent_open');

    // Run two actual psql processes concurrently using asyncQuery
    const [res1, res2] = await Promise.all([
      asyncQuery<any>(`select public.open_booking_recovery('${f.wsA}', '${f.msgA1}', '${f.userA}') as res`),
      asyncQuery<any>(`select public.open_booking_recovery('${f.wsA}', '${f.msgA1}', '${f.userA}') as res`)
    ]);

    const case1 = res1[0].res;
    const case2 = res2[0].res;

    expect(case1.id).toBe(case2.id);
    expect(case1.mission_id).toBe(case2.mission_id);

    // Ensure exactly 1 case and 1 mission created despite concurrent execution
    const totalCases = query<{ n: number }>(`select count(*)::int as n from public.booking_recovery_cases where workspace_id = '${f.wsA}'`);
    expect(totalCases[0].n).toBe(1);

    const totalMissions = query<{ n: number }>(`select count(*)::int as n from public.marketing_missions where workspace_id = '${f.wsA}'`);
    expect(totalMissions[0].n).toBe(1);
  });

  it('비활성(suspended) 멤버 및 타 테넌트 멤버는 RPC 호출 시 FORBIDDEN 예외를 받는다', () => {
    const f = createTestFixture('forbidden_actor');

    // Suspended member in wsA
    expect(() => {
      query<any>(`select public.open_booking_recovery('${f.wsA}', '${f.msgA1}', '${f.userInactive}') as res`);
    }).toThrow(/FORBIDDEN/);

    // User B from wsB attempting to open in wsA
    expect(() => {
      query<any>(`select public.open_booking_recovery('${f.wsA}', '${f.msgA1}', '${f.userB}') as res`);
    }).toThrow(/FORBIDDEN/);
  });

  it('RLS 및 권한: authenticated/anon 역할에서 RPC execute 및 recovery 테이블 직접 CUD가 PostgreSQL 레벨에서 거부된다', () => {
    const f = createTestFixture('auth_perm');

    // Create a case via service role first
    const rows = query<any>(`select public.open_booking_recovery('${f.wsA}', '${f.msgA1}', '${f.userA}') as res`);
    const caseId = rows[0].res.id;

    // 1. Direct RPC execution as authenticated role should be blocked by PostgreSQL GRANT
    expect(() => {
      query<any>(`select public.open_booking_recovery('${f.wsA}', '${f.msgA2}', '${f.userA}') as res`, f.userA);
    }).toThrow(/permission denied for function open_booking_recovery/i);

    // 2. Direct table INSERT as authenticated role should be blocked
    expect(() => {
      query<any>(`insert into public.booking_recovery_cases (workspace_id, mission_id, source_thread_id, source_inbound_message_id, customer_ref, stage)
        values ('${f.wsA}', '${randomUUID()}', '${f.threadA}', '${f.msgA2}', 'cust', 'DISCOVERED')`, f.userA);
    }).toThrow(/permission denied for table booking_recovery_cases/i);

    // 3. Direct table UPDATE as authenticated role should be blocked
    expect(() => {
      query<any>(`update public.booking_recovery_cases set stage = 'BLOCKED' where id = '${caseId}'`, f.userA);
    }).toThrow(/permission denied for table booking_recovery_cases/i);

    // 4. Authenticated member CAN select own workspace cases via RLS
    const ownCases = query<any>(`select * from public.booking_recovery_cases where workspace_id = '${f.wsA}'`, f.userA);
    expect(ownCases).toHaveLength(1);
    expect(ownCases[0].id).toBe(caseId);

    // 5. Authenticated member of wsB CANNOT select wsA cases (RLS returns 0 rows)
    const otherCases = query<any>(`select * from public.booking_recovery_cases where workspace_id = '${f.wsA}'`, f.userB);
    expect(otherCases).toHaveLength(0);
  });

  it('transition_booking_recovery는 낙관적 잠금(expected_version) 충돌 시 40001 예외를 발생시킨다', () => {
    const f = createTestFixture('trans_cas');
    const rows = query<any>(`select public.open_booking_recovery('${f.wsA}', '${f.msgA1}', '${f.userA}') as res`);
    const caseId = rows[0].res.id;

    // Transition version 1 -> 2
    const t1 = query<any>(`select public.transition_booking_recovery(
      '${f.wsA}', '${caseId}', 1, 'DRAFT_READY', '${f.userA}', 'PREPARE', '${'a'.repeat(64)}', 'idem-1'
    ) as res`);
    expect(t1[0].res.version).toBe(2);
    expect(t1[0].res.stage).toBe('DRAFT_READY');

    // Stale transition using version 1 should fail with VERSION_CONFLICT
    expect(() => {
      query<any>(`select public.transition_booking_recovery(
        '${f.wsA}', '${caseId}', 1, 'AWAITING_SEND_APPROVAL', '${f.userA}', 'APPROVE', '${'b'.repeat(64)}', 'idem-2'
      ) as res`);
    }).toThrow(/VERSION_CONFLICT/);
  });

  it('transition_booking_recovery는 유효하지 않은 전이 및 BOOKING_CONFIRMED 직행을 엄격히 거부한다', () => {
    const f = createTestFixture('trans_matrix');
    const rows = query<any>(`select public.open_booking_recovery('${f.wsA}', '${f.msgA1}', '${f.userA}') as res`);
    const caseId = rows[0].res.id;

    // 1. Generic transition directly to BOOKING_CONFIRMED is prohibited
    expect(() => {
      query<any>(`select public.transition_booking_recovery(
        '${f.wsA}', '${caseId}', 1, 'BOOKING_CONFIRMED', '${f.userA}', 'CONFIRM', '${'a'.repeat(64)}', 'idem-confirm'
      ) as res`);
    }).toThrow(/FORBIDDEN_TRANSITION: BOOKING_CONFIRMED cannot be set via generic transition/);

    // 2. Invalid jump from DISCOVERED to PROVIDER_ACCEPTED is rejected
    expect(() => {
      query<any>(`select public.transition_booking_recovery(
        '${f.wsA}', '${caseId}', 1, 'PROVIDER_ACCEPTED', '${f.userA}', 'EXEC', '${'a'.repeat(64)}', 'idem-invalid', 'prov_msg_xyz'
      ) as res`);
    }).toThrow(/INVALID_STAGE_TRANSITION/);

    // 3. Transition to AWAITING_SEND_APPROVAL requires valid 64-char hex fingerprint
    // First valid move: DISCOVERED -> DRAFT_READY
    query<any>(`select public.transition_booking_recovery(
      '${f.wsA}', '${caseId}', 1, 'DRAFT_READY', '${f.userA}', 'PREPARE', '${'a'.repeat(64)}', 'idem-draft'
    ) as res`);

    // Invalid fingerprint (too short)
    expect(() => {
      query<any>(`select public.transition_booking_recovery(
        '${f.wsA}', '${caseId}', 2, 'AWAITING_SEND_APPROVAL', '${f.userA}', 'APPROVE', 'invalid_short_fp', 'idem-fp'
      ) as res`);
    }).toThrow(/INVALID_FINGERPRINT/);
  });

  it('steps append-only trigger는 완료된 단계의 UPDATE 및 직접 DELETE를 차단하되 부모 case 삭제 시 cascade를 허용한다', () => {
    const f = createTestFixture('steps_immutable');
    const rows = query<any>(`select public.open_booking_recovery('${f.wsA}', '${f.msgA1}', '${f.userA}') as res`);
    const caseId = rows[0].res.id;

    const steps = query<any>(`select * from public.booking_recovery_steps where case_id = '${caseId}'`);
    expect(steps).toHaveLength(1);
    const stepId = steps[0].id;

    // 1. Direct UPDATE on completed step is blocked
    expect(() => {
      query(`update public.booking_recovery_steps set status = 'FAILED' where id = '${stepId}'`);
    }).toThrow(/immutable ledger/);

    // 2. Direct DELETE of step while case exists is blocked
    expect(() => {
      query(`delete from public.booking_recovery_steps where id = '${stepId}'`);
    }).toThrow(/Direct deletion of booking_recovery_steps is forbidden/);

    // 3. Cascade deletion works when parent case is deleted
    query(`delete from public.booking_recovery_cases where id = '${caseId}'`);
    const stepsAfterCascade = query<any>(`select * from public.booking_recovery_steps where id = '${stepId}'`);
    expect(stepsAfterCascade).toHaveLength(0);
  });

  it('claim_booking_recovery_step은 execution lease 선점 및 만료 재선점(CAS)을 검증한다', () => {
    const f = createTestFixture('claim_step');
    const rows = query<any>(`select public.open_booking_recovery('${f.wsA}', '${f.msgA1}', '${f.userA}') as res`);
    const caseId = rows[0].res.id;
    const fp = 'c'.repeat(64);
    const idemKey = 'step_claim_test_1';

    // 1. Initial claim succeeds
    const res1 = query<any>(`select public.claim_booking_recovery_step(
      '${f.wsA}', '${caseId}', 'PREPARE_REPLY', '${idemKey}', '${f.userA}', '${fp}', 2
    ) as res`);
    expect(res1[0].res.claimed).toBe(true);
    expect(res1[0].res.reclaimed).toBe(false);

    // 2. Immediate second claim while lease is active is rejected
    const res2 = query<any>(`select public.claim_booking_recovery_step(
      '${f.wsA}', '${caseId}', 'PREPARE_REPLY', '${idemKey}', '${f.userA}', '${fp}', 2
    ) as res`);
    expect(res2[0].res.claimed).toBe(false);
    expect(res2[0].res.reason).toBe('LOCKED_BY_ANOTHER_WORKER');

    // 3. Wait for lease expiry or artificially expire lease
    query(`update public.booking_recovery_steps set lease_until = now() - interval '1 second' where idempotency_key = '${idemKey}'`);

    // 4. Reclaim after lease expiration succeeds (CAS with fresh claim_token and attempt=2)
    const res3 = query<any>(`select public.claim_booking_recovery_step(
      '${f.wsA}', '${caseId}', 'PREPARE_REPLY', '${idemKey}', '${f.userA}', '${fp}', 10
    ) as res`);
    expect(res3[0].res.claimed).toBe(true);
    expect(res3[0].res.reclaimed).toBe(true);
    expect(res3[0].res.claim_token).toBeDefined();
    expect(res3[0].res.attempt).toBe(2);

    // 5. Logical operation binding conflict (different fingerprint) is rejected
    expect(() => {
      query<any>(`select public.claim_booking_recovery_step(
        '${f.wsA}', '${caseId}', 'PREPARE_REPLY', '${idemKey}', '${f.userA}', '${'d'.repeat(64)}', 10
      ) as res`);
    }).toThrow(/IDEMPOTENCY_BINDING_CONFLICT/);

    // 6. Invalid lease duration (< 1 or > 3600) is rejected
    expect(() => {
      query<any>(`select public.claim_booking_recovery_step(
        '${f.wsA}', '${caseId}', 'PREPARE_REPLY', 'another-key', '${f.userA}', '${fp}', 0
      ) as res`);
    }).toThrow(/INVALID_LEASE_DURATION/);

    // 7. Finalize step as COMPLETED
    query(`update public.booking_recovery_steps set status = 'COMPLETED' where idempotency_key = '${idemKey}'`);

    // 8. Attempt to claim completed step returns ALREADY_COMPLETED
    const res4 = query<any>(`select public.claim_booking_recovery_step(
      '${f.wsA}', '${caseId}', 'PREPARE_REPLY', '${idemKey}', '${f.userA}', '${fp}', 10
    ) as res`);
    expect(res4[0].res.claimed).toBe(false);
    expect(res4[0].res.reason).toBe('ALREADY_COMPLETED');
  });

  it('claim_booking_recovery_outbox는 due 미래 작업을 claim하지 않고, lease 만료 작업은 UNKNOWN(대사 전용)으로 격리한다', async () => {
    const f = createTestFixture('outbox_rules');
    const rows = query<any>(`select public.open_booking_recovery('${f.wsA}', '${f.msgA1}', '${f.userA}') as res`);
    const caseId = rows[0].res.id;

    // 1. Future job (next_attempt_at in +1 hour) should NOT be claimed
    query(`insert into public.booking_recovery_outbox (workspace_id, case_id, source_event_key, kind, state, next_attempt_at)
      values ('${f.wsA}', '${caseId}', 'evt_future', 'SEND_DM', 'PENDING', now() + interval '1 hour')`);

    const claimFuture = query<any>(`select public.claim_booking_recovery_outbox('${f.wsA}', 60) as res`);
    expect(claimFuture[0].res).toBeNull();

    // 2. Due job (next_attempt_at in the past) should be claimed
    query(`insert into public.booking_recovery_outbox (workspace_id, case_id, source_event_key, kind, state, next_attempt_at)
      values ('${f.wsA}', '${caseId}', 'evt_due', 'SEND_DM', 'PENDING', now() - interval '1 minute')`);

    const claimDue = query<any>(`select public.claim_booking_recovery_outbox('${f.wsA}', 60) as res`);
    expect(claimDue[0].res).not.toBeNull();
    expect(claimDue[0].res.outbox.source_event_key).toBe('evt_due');
    expect(claimDue[0].res.outbox.state).toBe('CLAIMED');

    // 3. Immediately claiming again returns null because the due job is locked/CLAIMED
    const claimAgain = query<any>(`select public.claim_booking_recovery_outbox('${f.wsA}', 60) as res`);
    expect(claimAgain[0].res).toBeNull();

    // 4. Safety Invariant: If lease expires, CLAIMED job is NOT re-dispatched but demoted to UNKNOWN for readback only
    query(`update public.booking_recovery_outbox set lease_until = now() - interval '1 second' where source_event_key = 'evt_due'`);
    const expiredClaim = query<any>(`select public.claim_booking_recovery_outbox('${f.wsA}', 60) as res`);
    expect(expiredClaim[0].res).not.toBeNull();
    expect(expiredClaim[0].res.claimed).toBe(false);
    expect(expiredClaim[0].res.status).toBe('MOVED_TO_UNKNOWN_RECONCILE_ONLY');
    expect(expiredClaim[0].res.outbox.state).toBe('UNKNOWN');

    // 5. Subsequent 2nd and 3rd claim calls: execute permission is NEVER re-issued (returns null because UNKNOWN is strictly excluded)
    const secondClaim = query<any>(`select public.claim_booking_recovery_outbox('${f.wsA}', 60) as res`);
    expect(secondClaim[0].res).toBeNull();

    const thirdClaim = query<any>(`select public.claim_booking_recovery_outbox('${f.wsA}', 60) as res`);
    expect(thirdClaim[0].res).toBeNull();
  });

  it('동시성: 2개 connection에서 동시 outbox claim 시 SKIP LOCKED에 의해 단 하나만 claim 성공한다', async () => {
    const f = createTestFixture('outbox_race');
    const rows = query<any>(`select public.open_booking_recovery('${f.wsA}', '${f.msgA1}', '${f.userA}') as res`);
    const caseId = rows[0].res.id;

    // Insert exactly 1 due outbox item
    query(`insert into public.booking_recovery_outbox (workspace_id, case_id, source_event_key, kind, state, next_attempt_at)
      values ('${f.wsA}', '${caseId}', 'evt_single', 'SEND_DM', 'PENDING', now() - interval '10 seconds')`);

    // Concurrently invoke claim from two processes
    const [c1, c2] = await Promise.all([
      asyncQuery<any>(`select public.claim_booking_recovery_outbox('${f.wsA}', 60) as res`),
      asyncQuery<any>(`select public.claim_booking_recovery_outbox('${f.wsA}', 60) as res`)
    ]);

    const res1 = c1[0].res;
    const res2 = c2[0].res;

    // Exactly one must succeed and the other must get null
    const successCount = (res1 !== null ? 1 : 0) + (res2 !== null ? 1 : 0);
    expect(successCount).toBe(1);

    const successfulClaim = res1 !== null ? res1 : res2;
    expect(successfulClaim.outbox.source_event_key).toBe('evt_single');
  });

  it('booking_recovery_slots는 gist exclusion에 의해 동시간 슬롯 겹침을 방어한다', () => {
    const f = createTestFixture('slots_overlap');
    const slot1 = randomUUID();
    const slot2 = randomUUID();

    const start = '2026-10-20T14:00:00+09:00';
    const end = '2026-10-20T15:00:00+09:00';

    // 1st slot: 14:00 ~ 15:00
    query(`insert into public.booking_recovery_slots (id, workspace_id, service_id, starts_at, ends_at, deposit_krw, catalog_version, confirmed_by, valid_until)
      values ('${slot1}', '${f.wsA}', '${f.serviceA}', '${start}', '${end}', 10000, 'v1', '${f.userA}', now() + interval '1 hour')`);

    // 2nd slot overlapping: 14:30 ~ 15:30 -> exclusion violation
    expect(() => {
      query(`insert into public.booking_recovery_slots (id, workspace_id, service_id, starts_at, ends_at, deposit_krw, catalog_version, confirmed_by, valid_until)
        values ('${slot2}', '${f.wsA}', '${f.serviceA}', '2026-10-20T14:30:00+09:00', '2026-10-20T15:30:00+09:00', 10000, 'v1', '${f.userA}', now() + interval '1 hour')`);
    }).toThrow(/exclusion constraint|exclusion_violation/);
  });

  it('BookingRecoveryRepository: 실제 PostgreSQL 위에서 openCase, claimStep, claimOutbox envelope DTO를 파싱한다', async () => {
    const f = createTestFixture('repo_pg');

    // Create minimal PG-backed adapter for repository that routes rpc calls through query
    const pgClientAdapter = {
      rpc: vi.fn().mockImplementation(async (fnName: string, args: Record<string, unknown>) => {
        try {
          const argEntries = Object.entries(args);
          const sqlArgs = argEntries
            .map(([, v]) => (v === null || v === undefined ? 'null' : typeof v === 'number' ? v : `'${String(v).replaceAll("'", "''")}'`))
            .join(', ');
          const rows = query<any>(`select public.${fnName}(${sqlArgs}) as res`);
          return { data: rows[0]?.res ?? null, error: null };
        } catch (err: any) {
          return { data: null, error: { message: err.message, code: err.message.includes('42501') ? '42501' : '500' } };
        }
      }),
      from: vi.fn(),
    } as any;

    const repo = new BookingRecoveryRepository(pgClientAdapter);
    const actor = { workspaceId: f.wsA, userId: f.userA, role: 'owner' as const };

    // 1. openCase via repo
    const recoveryCase = await repo.openCase(actor, f.msgA1);
    expect(recoveryCase.workspace_id).toBe(f.wsA);
    expect(recoveryCase.source_inbound_message_id).toBe(f.msgA1);
    expect(recoveryCase.version).toBe(1);

    // 2. claimStep via repo
    const stepClaim = await repo.claimStep(actor, {
      caseId: recoveryCase.id,
      kind: 'PREPARE_REPLY',
      idempotencyKey: 'repo-pg-idem-1',
      inputFingerprint: 'e'.repeat(64),
      leaseSeconds: 60,
    });
    expect(stepClaim.claimed).toBe(true);
    if (stepClaim.claimed) {
      expect(stepClaim.claim_token).toBeDefined();
      expect(stepClaim.attempt).toBe(1);
    }

    // 3. claimOutbox via repo
    query(`insert into public.booking_recovery_outbox (workspace_id, case_id, source_event_key, kind, state, next_attempt_at)
      values ('${f.wsA}', '${recoveryCase.id}', 'repo_evt_1', 'SEND_DM', 'PENDING', now() - interval '5 seconds')`);

    const outboxClaim = await repo.claimOutbox(f.wsA, 60);
    expect(outboxClaim).not.toBeNull();
    expect(outboxClaim?.claimed).toBe(true);
    if (outboxClaim?.claimed) {
      expect(outboxClaim.status).toBe('CLAIMED');
      expect(outboxClaim.outbox.source_event_key).toBe('repo_evt_1');
    }
  });

  it('finish_booking_recovery_step: 올바른 claim_token/attempt/input_fingerprint CAS 하에서만 COMPLETED로 전이하고 stale worker는 거부한다', () => {
    const f = createTestFixture('finish_step_cas');
    const rows = query<any>(`select public.open_booking_recovery('${f.wsA}', '${f.msgA1}', '${f.userA}') as res`);
    const caseId = rows[0].res.id;
    const fp = 'f'.repeat(64);
    const idemKey = 'step-finish-test-1';

    // 1. Claim step
    const claimRes = query<any>(`select public.claim_booking_recovery_step(
      '${f.wsA}', '${caseId}', 'PREPARE_REPLY', '${idemKey}', '${f.userA}', '${fp}', 60
    ) as res`);
    expect(claimRes[0].res.claimed).toBe(true);
    const stepId = claimRes[0].res.step.id;
    const claimToken = claimRes[0].res.claim_token;
    const attempt = claimRes[0].res.attempt;

    // 2. Stale worker finish attempt with wrong claim_token fails (CAS rejection)
    expect(() => {
      query(`select public.finish_booking_recovery_step(
        '${f.wsA}', '${caseId}', '${stepId}', '${randomUUID()}', ${attempt}, '${fp}', 'COMPLETED', 'prov_msg_fail', null
      )`);
    }).toThrow(/STEP_FINISH_CAS_FAILED/);

    // 3. Stale worker finish attempt with wrong fingerprint fails
    expect(() => {
      query(`select public.finish_booking_recovery_step(
        '${f.wsA}', '${caseId}', '${stepId}', '${claimToken}', ${attempt}, '${'0'.repeat(64)}', 'COMPLETED', 'prov_msg_fail', null
      )`);
    }).toThrow(/STEP_FINISH_CAS_FAILED/);

    // 4. Legitimate worker finish succeeds
    const finishRes = query<any>(`select public.finish_booking_recovery_step(
      '${f.wsA}', '${caseId}', '${stepId}', '${claimToken}', ${attempt}, '${fp}', 'COMPLETED', 'prov_msg_ok', 'evidence_ref_ok'
    ) as res`);
    expect(finishRes[0].res.status).toBe('COMPLETED');
    expect(finishRes[0].res.provider_message_id).toBe('prov_msg_ok');
  });

  it('confirm_booking_recovery RPC: 한 트랜잭션 내에서 case, slot, mission, reservation, steps를 원자적으로 커밋한다', () => {
    const f = createTestFixture('confirm_atomic');
    const openRes = query<any>(`select public.open_booking_recovery('${f.wsA}', '${f.msgA1}', '${f.userA}') as res`);
    const caseItem = openRes[0].res;
    const caseId = caseItem.id;
    const slotId = randomUUID();
    const fp = 'c'.repeat(64);

    // 1. Create confirmed slot
    const start = '2026-10-21T10:00:00+09:00';
    const end = '2026-10-21T11:00:00+09:00';
    query(`insert into public.booking_recovery_slots (id, workspace_id, service_id, starts_at, ends_at, deposit_krw, catalog_version, confirmed_by, valid_until, status, version)
      values ('${slotId}', '${f.wsA}', '${f.serviceA}', '${start}', '${end}', 20000, 'cat_v1', '${f.userA}', now() + interval '1 hour', 'AVAILABLE', 1)`);

    // 2. Create proposal snapshot (revision 1)
    query(`insert into public.booking_recovery_proposals (workspace_id, case_id, revision, source_inbound_message_id, source_thread_id, service_id, catalog_version, service_name, total_amount_krw, deposit_krw, slot_id, slot_version, starts_at, ends_at, timezone, availability_confirmed_at, valid_until, reply_text, payload_fingerprint, created_at)
      values ('${f.wsA}', '${caseId}', 1, '${f.msgA1}', '${f.threadA}', '${f.serviceA}', 'cat_v1', '맞춤 펌', 120000, 20000, '${slotId}', 1, '${start}', '${end}', 'Asia/Seoul', now(), now() + interval '1 hour', '답장 문안', '${fp}', now() - interval '8 minutes')`);

    // 5. Inbound customer acceptance message
    const acceptMsgId = randomUUID();
    query(`insert into public.instagram_dm_messages (id, workspace_id, thread_id, provider_message_id, sender_type, sender_id, text, sent_at, created_at)
      values ('${acceptMsgId}', '${f.wsA}', '${f.threadA}', 'prov_accept_1', 'customer', '${f.customerId}', '네 그 시간으로 확정할게요', now() - interval '2 minutes', now() - interval '2 minutes')`);

    // 3. Transition case to AWAITING_BOOKING_APPROVAL (bound to acceptMsgId)
    query(`update public.booking_recovery_cases set stage = 'AWAITING_BOOKING_APPROVAL', version = 4, accepted_inbound_message_id = '${acceptMsgId}' where id = '${caseId}'`);

    // 4. Save owner BOOK approval (bound to acceptMsgId)
    query(`insert into public.booking_recovery_approvals (workspace_id, case_id, step_kind, payload_fingerprint, case_version, source_message_id, catalog_version, slot_version, approved_by, expires_at)
      values ('${f.wsA}', '${caseId}', 'BOOK', '${fp}', 4, '${acceptMsgId}', 'cat_v1', 1, '${f.userA}', now() + interval '1 hour')`);

    // 4.5 Record verified DM send evidence
    const proof = JSON.stringify({
      schemaVersion: 1, channel: 'instagram', providerMessageId: 'prov_accept_1',
      payloadFingerprint: fp, senderId: `business-account-${f.customerId.replace('cust_', '')}`,
      recipientRef: f.customerId, requestedAt: new Date(Date.now() - 6 * 60 * 1000).toISOString(),
      observedAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
    }).replaceAll("'", "''");
    query(`insert into public.booking_recovery_steps
      (workspace_id, case_id, kind, status, input_fingerprint, idempotency_key, attempt, actor_id, provider_message_id, evidence_ref, occurred_at)
      values ('${f.wsA}', '${caseId}', 'SEND_DM_VERIFIED', 'COMPLETED', '${fp}',
        'step-runtime-${randomUUID()}', 1, '${f.userA}', 'prov_accept_1', '${proof}', now() - interval '4 minutes')`);

    // 6. Execute atomic confirm RPC
    const confirmRows = query<any>(`select public.confirm_booking_recovery(
      '${f.wsA}', '${caseId}', 4, 1, '${f.userA}', '${acceptMsgId}', '${fp}'
    ) as res`);

    const result = confirmRows[0].res;
    expect(result.case.stage).toBe('BOOKING_CONFIRMED');
    expect(result.case.version).toBe(5);
    expect(result.reservation_id).toMatch(/^bk_/);

    // 7. Verify reservation row created with identical metadata and proof
    const reservations = query<any>(`select * from public.reservations where id = '${result.reservation_id}'`);
    expect(reservations).toHaveLength(1);
    expect(reservations[0].workspace_id).toBe(f.wsA);
    expect(reservations[0].slot_id).toBe(slotId);
    expect(reservations[0].status).toBe('CONFIRMED');
    expect(reservations[0].deposit_krw).toBe(20000);
    expect(reservations[0].total_amount_krw).toBe(120000);

    // 8. Verify slot transitioned to BOOKED
    const slots = query<any>(`select * from public.booking_recovery_slots where id = '${slotId}'`);
    expect(slots[0].status).toBe('BOOKED');

    // 9. Verify marketing mission transitioned to BOOKED with bookingId metadata and mission_events
    const missions = query<any>(`select * from public.marketing_missions where id = '${caseItem.mission_id}'`);
    expect(missions[0].status).toBe('BOOKED');
    expect(missions[0].metadata.bookingId).toBe(result.reservation_id);

    const mEvents = query<any>(`select * from public.mission_events where mission_id = '${caseItem.mission_id}' and event_name = 'BOOKING_CONFIRMED'`);
    expect(mEvents).toHaveLength(1);
    expect(mEvents[0].to_status).toBe('BOOKED');
    expect(mEvents[0].payload.reservationId).toBe(result.reservation_id);

    // 10. Verify owner approval was atomically consumed (consumed_at is NOT NULL)
    const approvals = query<any>(`select * from public.booking_recovery_approvals where case_id = '${caseId}' and step_kind = 'BOOK'`);
    expect(approvals[0].consumed_at).not.toBeNull();

    // 11. Idempotent re-call: Returns the same confirmed reservation without duplicating or throwing 409
    const replayRows = query<any>(`select public.confirm_booking_recovery(
      '${f.wsA}', '${caseId}', 5, 1, '${f.userA}', '${acceptMsgId}', '${fp}'
    ) as res`);
    expect(replayRows[0].res.reservation_id).toBe(result.reservation_id);
    expect(replayRows[0].res.case.stage).toBe('BOOKING_CONFIRMED');
  });

  it('confirm_booking_recovery RPC: 카탈로그 가격 변경, 늦은 수신 과거 발화, 기존 장부 기간 겹침을 fail-closed 차단한다', () => {
    const f = createTestFixture('confirm_guards');
    const openRes = query<any>(`select public.open_booking_recovery('${f.wsA}', '${f.msgA1}', '${f.userA}') as res`);
    const caseId = openRes[0].res.id;
    const slotId = randomUUID();
    const fp = 'e'.repeat(64);

    const start = '2026-10-22T14:00:00+09:00';
    const end = '2026-10-22T15:00:00+09:00';

    query(`insert into public.booking_recovery_slots (id, workspace_id, service_id, starts_at, ends_at, deposit_krw, catalog_version, confirmed_by, valid_until, status, version)
      values ('${slotId}', '${f.wsA}', '${f.serviceA}', '${start}', '${end}', 20000, 'cat_v1', '${f.userA}', now() + interval '1 hour', 'AVAILABLE', 1)`);

    query(`insert into public.booking_recovery_proposals (workspace_id, case_id, revision, source_inbound_message_id, source_thread_id, service_id, catalog_version, service_name, total_amount_krw, deposit_krw, slot_id, slot_version, starts_at, ends_at, timezone, availability_confirmed_at, valid_until, reply_text, payload_fingerprint, created_at)
      values ('${f.wsA}', '${caseId}', 1, '${f.msgA1}', '${f.threadA}', '${f.serviceA}', 'cat_v1', '맞춤 펌', 120000, 20000, '${slotId}', 1, '${start}', '${end}', 'Asia/Seoul', now(), now() + interval '1 hour', '답장 문안', '${fp}', now() - interval '8 minutes')`);

    // Guard 1: Ancient customer message (sent_at before proposal creation) is strictly rejected
    const ancientMsgId = randomUUID();
    query(`insert into public.instagram_dm_messages (id, workspace_id, thread_id, provider_message_id, sender_type, sender_id, text, sent_at, created_at)
      values ('${ancientMsgId}', '${f.wsA}', '${f.threadA}', 'prov_ancient', 'customer', '${f.customerId}', '예약해주세요', now() - interval '1 hour', now())`);

    query(`update public.booking_recovery_cases set stage = 'AWAITING_BOOKING_APPROVAL', version = 4, accepted_inbound_message_id = '${ancientMsgId}' where id = '${caseId}'`);
    query(`insert into public.booking_recovery_approvals (workspace_id, case_id, step_kind, payload_fingerprint, case_version, source_message_id, catalog_version, slot_version, approved_by, expires_at)
      values ('${f.wsA}', '${caseId}', 'BOOK', '${fp}', 4, '${ancientMsgId}', 'cat_v1', 1, '${f.userA}', now() + interval '1 hour')`);

    expect(() => {
      query(`select public.confirm_booking_recovery(
        '${f.wsA}', '${caseId}', 4, 1, '${f.userA}', '${ancientMsgId}', '${fp}'
      )`);
    }).toThrow(/INVALID_ACCEPTANCE: Acceptance message sent_at.*is earlier than.*proposal creation/);

    // Record verified DM send evidence
    const proofGuards = JSON.stringify({
      schemaVersion: 1, channel: 'instagram', providerMessageId: 'prov_valid_acc',
      payloadFingerprint: fp, senderId: `business-account-${f.customerId.replace('cust_', '')}`,
      recipientRef: f.customerId, requestedAt: new Date(Date.now() - 6 * 60 * 1000).toISOString(),
      observedAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
    }).replaceAll("'", "''");
    query(`insert into public.booking_recovery_steps
      (workspace_id, case_id, kind, status, input_fingerprint, idempotency_key, attempt, actor_id, provider_message_id, evidence_ref, occurred_at)
      values ('${f.wsA}', '${caseId}', 'SEND_DM_VERIFIED', 'COMPLETED', '${fp}',
        'step-guards-${randomUUID()}', 1, '${f.userA}', 'prov_valid_acc', '${proofGuards}', now() - interval '4 minutes')`);

    // Create valid acceptance message
    const validAcceptMsgId = randomUUID();
    query(`insert into public.instagram_dm_messages (id, workspace_id, thread_id, provider_message_id, sender_type, sender_id, text, sent_at, created_at)
      values ('${validAcceptMsgId}', '${f.wsA}', '${f.threadA}', 'prov_valid_acc', 'customer', '${f.customerId}', '네 그 시간으로 확정할게요', now() - interval '2 minutes', now() - interval '2 minutes')`);

    query(`update public.booking_recovery_cases set accepted_inbound_message_id = '${validAcceptMsgId}' where id = '${caseId}'`);
    query(`update public.booking_recovery_approvals set source_message_id = '${validAcceptMsgId}' where case_id = '${caseId}' and step_kind = 'BOOK'`);

    // Guard 2: Price changed in catalog invalidates confirmation
    query(`update public.workspace_products_services set price = 150000 where id = '${f.serviceA}'`);
    expect(() => {
      query(`select public.confirm_booking_recovery(
        '${f.wsA}', '${caseId}', 4, 1, '${f.userA}', '${validAcceptMsgId}', '${fp}'
      )`);
    }).toThrow(/CATALOG_PRICE_CHANGED/);

    // Restore catalog price
    query(`update public.workspace_products_services set price = 120000 where id = '${f.serviceA}'`);

    // Guard 3: Overlapping confirmed reservation in existing ledger fails closed
    query(`insert into public.reservations (id, workspace_id, slot_id, customer_id, customer_name, service_id, service_name, status, deposit_krw, total_amount_krw, channel_source, confirmed_at, metadata)
      values ('bk_existing_overlap', '${f.wsA}', 'slot_other', 'cust_other', '다른고객', '${f.serviceA}', '맞춤 펌', 'CONFIRMED', 0, 120000, 'MANUAL', now(),
      jsonb_build_object('startsAt', '${start}', 'endsAt', '${end}'))`);

    expect(() => {
      query(`select public.confirm_booking_recovery(
        '${f.wsA}', '${caseId}', 4, 1, '${f.userA}', '${validAcceptMsgId}', '${fp}'
      )`);
    }).toThrow(/SLOT_INTERVAL_CONFLICT/);

    // Remove overlapping reservation to test Guard 4
    query(`delete from public.reservations where id = 'bk_existing_overlap'`);

    // Guard 4: Offer terms changed in revision 2 (price changed to 140000) rejects customer's previous acceptance from revision 1
    // Proposal revision 1 was created 10 minutes ago
    query(`update public.booking_recovery_proposals set created_at = now() - interval '10 minutes' where case_id = '${caseId}' and revision = 1`);

    // Customer accepted revision 1 5 minutes ago (sent_at between rev 1 and rev 2)
    const prevTermsAcceptMsgId = randomUUID();
    query(`insert into public.instagram_dm_messages (id, workspace_id, thread_id, provider_message_id, sender_type, sender_id, text, sent_at, created_at)
      values ('${prevTermsAcceptMsgId}', '${f.wsA}', '${f.threadA}', 'prov_prev_terms_acc', 'customer', '${f.customerId}', '네 그 시간으로 확정할게요', now() - interval '5 minutes', now() - interval '5 minutes')`);

    // Owner creates proposal revision 2 with price 140,000 at now()
    const rev2Fp = 'f'.repeat(64);
    query(`insert into public.booking_recovery_proposals (workspace_id, case_id, revision, source_inbound_message_id, source_thread_id, service_id, catalog_version, service_name, total_amount_krw, deposit_krw, slot_id, slot_version, starts_at, ends_at, timezone, availability_confirmed_at, valid_until, reply_text, payload_fingerprint, created_at)
      values ('${f.wsA}', '${caseId}', 2, '${f.msgA1}', '${f.threadA}', '${f.serviceA}', 'cat_v1', '맞춤 펌', 140000, 20000, '${slotId}', 1, '${start}', '${end}', 'Asia/Seoul', now(), now() + interval '1 hour', '답장 문안 2', '${rev2Fp}', now())`);

    // Update catalog price to match revision 2
    query(`update public.workspace_products_services set price = 140000 where id = '${f.serviceA}'`);

    query(`update public.booking_recovery_cases set accepted_inbound_message_id = '${prevTermsAcceptMsgId}' where id = '${caseId}'`);
    query(`insert into public.booking_recovery_approvals (workspace_id, case_id, step_kind, payload_fingerprint, case_version, source_message_id, catalog_version, slot_version, approved_by, expires_at)
      values ('${f.wsA}', '${caseId}', 'BOOK', '${rev2Fp}', 4, '${prevTermsAcceptMsgId}', 'cat_v1', 1, '${f.userA}', now() + interval '1 hour')`);

    expect(() => {
      query(`select public.confirm_booking_recovery(
        '${f.wsA}', '${caseId}', 4, 2, '${f.userA}', '${prevTermsAcceptMsgId}', '${rev2Fp}'
      )`);
    }).toThrow(/PROPOSAL_TERMS_CHANGED/);
  });

  it('ReservationCanonicalService: 회수 관리 슬롯에 대해 직접 확정 write 시도를 fail-closed 403 차단한다', async () => {
    const f = createTestFixture('canonical_bypass_guard');
    const slotId = randomUUID();
    process.env.BOOKING_RECOVERY_ENABLED = 'true';
    process.env.BOOKING_RECOVERY_WORKSPACE_ALLOWLIST = '*';

    // Insert recovery-managed slot
    query(`insert into public.booking_recovery_slots (id, workspace_id, service_id, starts_at, ends_at, deposit_krw, catalog_version, confirmed_by, valid_until, status, version)
      values ('${slotId}', '${f.wsA}', '${f.serviceA}', '2026-10-23T10:00:00+09:00', '2026-10-23T11:00:00+09:00', 10000, 'cat_v1', '${f.userA}', now() + interval '1 hour', 'AVAILABLE', 1)`);

    // Minimal pg adapter for ReservationCanonicalService
    const mockPgSupabase = {
      from: vi.fn().mockImplementation((table: string) => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockImplementation(async () => {
          if (table === 'booking_recovery_slots') {
            return { data: { id: slotId, status: 'AVAILABLE' }, error: null };
          }
          return { data: null, error: null };
        }),
      })),
    } as any;


    await expect(
      ReservationCanonicalService.createReservation(
        {
          workspaceId: f.wsA,
          slotId: slotId,
          customerId: 'cust_direct',
          serviceId: f.serviceA,
          serviceName: '직접우회시술',
          depositKrw: 10000,
          totalAmountKrw: 120000,
        },
        mockPgSupabase
      )
    ).rejects.toThrow(/DIRECT_CONFIRM_FORBIDDEN/);
  });
});
