import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { asyncQuery, query } from '../vault/pg-client';

// W4 v093-approval-consume-slice AC-01..07 (SQL side): atomic approve+transition and
// approval consumption on SEND_DM lease claim. Isolated PostgreSQL only.

function rawSql(sql: string) {
  const run = spawnSync(`${process.env.PG16_BIN || '/opt/homebrew/opt/postgresql@16/bin'}/psql`,
    ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '-d', process.env.PGDATABASE!],
    { input: sql, encoding: 'utf8' });
  if (run.status) throw new Error(`rawSql failed: ${run.stderr}`);
}

function setup(options?: { proposalValidInterval?: string; stage?: string }) {
  const workspace = randomUUID();
  const otherWorkspace = randomUUID();
  const actor = randomUUID();
  const outsider = randomUUID();
  const disabledManager = randomUUID();
  const service = randomUUID();
  const slot = randomUUID();
  const connection = randomUUID();
  const thread = randomUUID();
  const inbound = randomUUID();
  const fingerprint = randomUUID().replaceAll('-', '').repeat(2);

  query(`insert into auth.users (id) values ('${actor}'), ('${outsider}'), ('${disabledManager}')`);
  query(`insert into workspaces (id, name, created_by) values
    ('${workspace}', 'Approval consume', '${actor}'), ('${otherWorkspace}', 'Other tenant', '${outsider}')`);
  query(`insert into workspace_members (workspace_id, user_id, role, status) values
    ('${workspace}', '${actor}', 'owner', 'active'),
    ('${workspace}', '${disabledManager}', 'manager', 'disabled'),
    ('${otherWorkspace}', '${outsider}', 'owner', 'active')
    on conflict (workspace_id, user_id) do update set role = excluded.role, status = excluded.status`);
  query(`insert into channel_connections (id, workspace_id, channel, status, external_account_id)
    values ('${connection}', '${workspace}', 'instagram', 'connected', 'acct_${workspace}')`);
  query(`insert into workspace_products_services (id, workspace_id, name, price, active)
    values ('${service}', '${workspace}', 'Confirmed service', 40000, true)`);
  query(`insert into booking_recovery_slots
    (id, workspace_id, service_id, starts_at, ends_at, deposit_krw, catalog_version, confirmed_by, valid_until)
    values ('${slot}', '${workspace}', '${service}', now() + interval '1 day', now() + interval '1 day 1 hour',
      0, 'catalog-1', '${actor}', now() + interval '15 minutes')`);
  query(`insert into instagram_dm_threads
    (id, workspace_id, channel_connection_id, provider_thread_id, customer_id, customer_handle, last_message_at, expires_at, status, last_message_text)
    values ('${thread}', '${workspace}', '${connection}', '${thread}', '${thread}', 'test', now(), now() + interval '1 day', 'NEEDS_REPLY', '예약 문의')`);
  query(`insert into instagram_dm_messages
    (id, workspace_id, thread_id, provider_message_id, sender_type, sender_id, text, sent_at)
    values ('${inbound}', '${workspace}', '${thread}', '${inbound}', 'customer', '${thread}', '예약 문의', now() - interval '10 minutes')`);
  const caseId = query<{ res: { id: string } }>(
    `select public.open_booking_recovery('${workspace}', '${inbound}', '${actor}') as res`)[0].res.id;
  query(`insert into booking_recovery_proposals
    (workspace_id, case_id, revision, source_inbound_message_id, source_thread_id, service_id, catalog_version,
     service_name, total_amount_krw, deposit_krw, slot_id, slot_version, starts_at, ends_at, timezone,
     availability_confirmed_at, valid_until, reply_text, payload_fingerprint)
    select '${workspace}', '${caseId}', 1, '${inbound}', '${thread}', '${service}', 'catalog-1',
      'Confirmed service', 40000, 0, id, version, starts_at, ends_at, timezone,
      confirmed_at, now() + interval '${options?.proposalValidInterval ?? '15 minutes'}', '예약 제안', '${fingerprint}'
    from booking_recovery_slots where id = '${slot}'`);
  query(`update booking_recovery_cases set stage = '${options?.stage ?? 'DRAFT_READY'}', version = 2 where id = '${caseId}'`);

  const approve = (key = `approve:${caseId}:2`, expectedVersion = 2, fp = fingerprint, who = actor) =>
    `select public.approve_and_transition_recovery('${workspace}', '${caseId}', ${expectedVersion}, '${who}', '${fp}', '${key}') as res`;
  const claim = (key: string, fp = fingerprint, lease = 60, who = actor) =>
    `select public.claim_booking_recovery_step('${workspace}', '${caseId}', 'SEND_DM', '${key}', '${who}', '${fp}', ${lease}) as res`;
  const counts = () => ({
    approvals: query<{ n: number }>(`select count(*)::int as n from booking_recovery_approvals where case_id = '${caseId}' and step_kind = 'SEND'`)[0].n,
    approveSteps: query<{ n: number }>(`select count(*)::int as n from booking_recovery_steps where case_id = '${caseId}' and kind = 'APPROVE_SEND'`)[0].n,
    sendSteps: query<{ n: number }>(`select count(*)::int as n from booking_recovery_steps where case_id = '${caseId}' and kind = 'SEND_DM'`)[0].n,
  });
  const caseRow = () => query<{ stage: string; version: number }>(`select stage, version from booking_recovery_cases where id = '${caseId}'`)[0];
  const approvalRow = () => query<any>(`select * from booking_recovery_approvals where case_id = '${caseId}' and step_kind = 'SEND'`)[0];
  return { workspace, otherWorkspace, actor, outsider, disabledManager, caseId, inbound, fingerprint, service, slot, approve, claim, counts, caseRow, approvalRow };
}

describe('W5 approve_and_transition_recovery (contract 3) / isolated PostgreSQL', () => {
  it('케이스 전이와 승인 기록과 감사 step을 한 트랜잭션으로 만들고 두 버전을 분리해 돌려준다', () => {
    const f = setup();
    const res = query<any>(f.approve())[0].res;
    expect(res.reviewed_case_version).toBe(2);
    expect(res.authorized_case_version).toBe(3);
    expect(res.stage).toBe('AWAITING_SEND_APPROVAL');
    expect(res.replayed).toBe(false);
    expect(f.caseRow()).toEqual({ stage: 'AWAITING_SEND_APPROVAL', version: 3 });
    const approval = f.approvalRow();
    expect(approval.id).toBe(res.approval_id);
    expect(approval.case_version).toBe(2);
    expect(approval.authorized_case_version).toBe(3);
    expect(approval.approved_by).toBe(f.actor);
    expect(approval.consumed_at).toBeNull();
    expect(f.counts()).toMatchObject({ approvals: 1, approveSteps: 1 });
  });

  it('원본 메시지·카탈로그 버전·슬롯 버전·만료는 호출자가 아니라 최신 proposal에서 DB가 유도한다', () => {
    const f = setup();
    query(f.approve());
    const approval = f.approvalRow();
    const proposal = query<any>(`select * from booking_recovery_proposals where case_id = '${f.caseId}' and revision = 1`)[0];
    expect(approval.source_message_id).toBe(proposal.source_inbound_message_id);
    expect(approval.catalog_version).toBe(proposal.catalog_version);
    expect(approval.slot_version).toBe(proposal.slot_version);
    expect(new Date(approval.expires_at).getTime()).toBe(new Date(proposal.valid_until).getTime());
  });

  it('같은 멱등키 재시도는 같은 승인을 반환하고 케이스 버전·승인·감사를 더 만들지 않는다', () => {
    const f = setup();
    const first = query<any>(f.approve())[0].res;
    const replay = query<any>(f.approve())[0].res;
    expect(replay.approval_id).toBe(first.approval_id);
    expect(replay.authorized_case_version).toBe(3);
    expect(replay.replayed).toBe(true);
    expect(f.caseRow().version).toBe(3);
    expect(f.counts()).toMatchObject({ approvals: 1, approveSteps: 1 });
  });

  it('같은 멱등키를 다른 지문·다른 사용자에 재사용하면 바인딩 충돌로 거부한다', () => {
    const f = setup();
    query(f.approve());
    expect(() => query(f.approve(undefined, 2, 'f'.repeat(64)))).toThrow(/IDEMPOTENCY_BINDING_CONFLICT|FINGERPRINT_MISMATCH/);
    expect(f.counts()).toMatchObject({ approvals: 1, approveSteps: 1 });
  });

  it('낡은 expectedVersion은 VERSION_CONFLICT이며 아무것도 쓰지 않는다', () => {
    const f = setup();
    expect(() => query(f.approve('stale-key', 1))).toThrow(/VERSION_CONFLICT/);
    expect(f.caseRow()).toEqual({ stage: 'DRAFT_READY', version: 2 });
    expect(f.counts()).toMatchObject({ approvals: 0, approveSteps: 0 });
  });

  it('최신 proposal 지문과 다른 지문은 FINGERPRINT_MISMATCH로 거부한다', () => {
    const f = setup();
    expect(() => query(f.approve('fp-key', 2, 'a'.repeat(64)))).toThrow(/FINGERPRINT_MISMATCH/);
    expect(() => query(f.approve('fp-key-2', 2, 'not-a-sha'))).toThrow(/INVALID_FINGERPRINT/);
    expect(f.counts()).toMatchObject({ approvals: 0, approveSteps: 0 });
  });

  it('승인 가능한 단계가 아니면 INVALID_STAGE_TRANSITION이며 아무것도 쓰지 않는다', () => {
    const f = setup({ stage: 'DISCOVERED' });
    expect(() => query(f.approve())).toThrow(/INVALID_STAGE_TRANSITION/);
    expect(f.caseRow().stage).toBe('DISCOVERED');
    expect(f.counts()).toMatchObject({ approvals: 0, approveSteps: 0 });
  });

  it('이미 만료된 proposal은 승인할 수 없다', () => {
    const f = setup({ proposalValidInterval: '-1 minute' });
    expect(() => query(f.approve())).toThrow(/PROPOSAL_EXPIRED/);
    expect(f.caseRow()).toEqual({ stage: 'DRAFT_READY', version: 2 });
    expect(f.counts()).toMatchObject({ approvals: 0, approveSteps: 0 });
  });

  it('비활성 멤버와 다른 사업장 멤버는 FORBIDDEN이다', () => {
    const f = setup();
    expect(() => query(f.approve('k1', 2, f.fingerprint, f.disabledManager))).toThrow(/FORBIDDEN/);
    expect(() => query(f.approve('k2', 2, f.fingerprint, f.outsider))).toThrow(/FORBIDDEN/);
    expect(f.counts()).toMatchObject({ approvals: 0, approveSteps: 0 });
  });

  it('같은 지문의 승인이 이미 있으면 새 멱등키로는 APPROVAL_ALREADY_EXISTS이다', () => {
    const f = setup();
    query(f.approve());
    query(`update booking_recovery_cases set stage = 'DRAFT_READY' where id = '${f.caseId}'`);
    expect(() => query(f.approve('another-key', 3))).toThrow(/APPROVAL_ALREADY_EXISTS/);
    expect(f.counts()).toMatchObject({ approvals: 1, approveSteps: 1 });
  });

  it('승인 삽입이 실패하면 케이스 전이와 감사 step 전체가 롤백된다', () => {
    const f = setup();
    rawSql(`create or replace function fail_approval_insert() returns trigger language plpgsql as $$
      begin raise exception 'SIMULATED_APPROVAL_WRITE_FAILURE' using errcode = '54000'; end; $$;
      create trigger trg_fail_approval before insert on booking_recovery_approvals
      for each row execute function fail_approval_insert();`);
    try {
      expect(() => query(f.approve())).toThrow(/SIMULATED_APPROVAL_WRITE_FAILURE/);
      expect(f.caseRow()).toEqual({ stage: 'DRAFT_READY', version: 2 });
      expect(f.counts()).toMatchObject({ approvals: 0, approveSteps: 0 });
    } finally {
      rawSql(`drop trigger if exists trg_fail_approval on booking_recovery_approvals; drop function if exists fail_approval_insert();`);
    }
  });

  it('두 승인 요청이 같은 버전에서 경쟁하면 정확히 하나만 성공한다', async () => {
    const f = setup();
    const results = await Promise.allSettled([asyncQuery(f.approve('race-a')), asyncQuery(f.approve('race-b'))]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(f.counts()).toMatchObject({ approvals: 1, approveSteps: 1 });
    expect(f.caseRow().version).toBe(3);
  });

  it('authenticated/anon 역할은 승인 RPC를 직접 실행할 수 없다', () => {
    const f = setup();
    expect(() => query(f.approve(), f.actor)).toThrow(/permission denied for function approve_and_transition_recovery/i);
  });
});

describe('W5 claim_booking_recovery_step SEND_DM approval consumption (contract 4) / isolated PostgreSQL', () => {
  it('승인이 없으면 클레임을 거부하고 step을 만들지 않는다', () => {
    const f = setup();
    const res = query<any>(f.claim('send-1'))[0].res;
    expect(res.claimed).toBe(false);
    expect(res.reason).toBe('APPROVAL_NOT_FOUND_OR_EXPIRED_OR_CONSUMED');
    expect(f.counts().sendSteps).toBe(0);
  });

  it('승인이 있으면 lease 선점과 같은 트랜잭션에서 consumed_at과 consumed_by_step_id를 각인한다', () => {
    const f = setup();
    query(f.approve());
    const res = query<any>(f.claim('send-1'))[0].res;
    expect(res.claimed).toBe(true);
    const approval = f.approvalRow();
    expect(approval.consumed_at).not.toBeNull();
    expect(approval.consumed_by_step_id).toBe(res.step.id);
    expect(f.counts().sendSteps).toBe(1);
  });

  it('같은 멱등키 재시도는 lease가 살아 있으면 LOCKED_BY_ANOTHER_WORKER이며 승인은 한 번만 소비된다', () => {
    const f = setup();
    query(f.approve());
    expect(query<any>(f.claim('send-1'))[0].res.claimed).toBe(true);
    const retry = query<any>(f.claim('send-1'))[0].res;
    expect(retry.claimed).toBe(false);
    expect(retry.reason).toBe('LOCKED_BY_ANOTHER_WORKER');
    expect(f.counts().sendSteps).toBe(1);
  });

  it('소비된 승인에 다른 멱등키로 다시 클레임하면 거부하고 step을 더 만들지 않는다', () => {
    const f = setup();
    query(f.approve());
    expect(query<any>(f.claim('send-1'))[0].res.claimed).toBe(true);
    const second = query<any>(f.claim('send-2'))[0].res;
    expect(second.claimed).toBe(false);
    expect(second.reason).toBe('APPROVAL_NOT_FOUND_OR_EXPIRED_OR_CONSUMED');
    expect(f.counts().sendSteps).toBe(1);
  });

  it('같은 승인으로 두 작업자가 동시에 클레임하면 정확히 하나만 lease를 얻는다', async () => {
    const f = setup();
    query(f.approve());
    const [a, b] = await Promise.all([asyncQuery<any>(f.claim('race-a')), asyncQuery<any>(f.claim('race-b'))]);
    expect([a[0].res.claimed, b[0].res.claimed].filter(Boolean)).toHaveLength(1);
    expect(f.counts().sendSteps).toBe(1);
  });

  it('같은 멱등키로 동시에 클레임해도 step은 하나이고 한쪽만 claimed이다', async () => {
    const f = setup();
    query(f.approve());
    const [a, b] = await Promise.all([asyncQuery<any>(f.claim('same-key')), asyncQuery<any>(f.claim('same-key'))]);
    expect([a[0].res.claimed, b[0].res.claimed].filter(Boolean)).toHaveLength(1);
    expect(f.counts().sendSteps).toBe(1);
  });

  it('만료된 승인은 소비하지 않고 step도 만들지 않는다', () => {
    const f = setup();
    query(f.approve());
    query(`update booking_recovery_approvals set expires_at = now() - interval '1 second' where case_id = '${f.caseId}' and step_kind = 'SEND'`);
    const res = query<any>(f.claim('send-1'))[0].res;
    expect(res.claimed).toBe(false);
    expect(res.reason).toBe('APPROVAL_NOT_FOUND_OR_EXPIRED_OR_CONSUMED');
    expect(f.approvalRow().consumed_at).toBeNull();
    expect(f.counts().sendSteps).toBe(0);
  });

  it('다른 지문의 클레임은 승인을 찾지 못한다', () => {
    const f = setup();
    query(f.approve());
    const res = query<any>(f.claim('send-1', 'b'.repeat(64)))[0].res;
    expect(res.claimed).toBe(false);
    expect(f.approvalRow().consumed_at).toBeNull();
  });

  it('승인자의 멤버십이 비활성이면 FORBIDDEN이며 소비도 step 생성도 없다', () => {
    const f = setup();
    query(f.approve());
    query(`update workspace_members set status = 'disabled' where workspace_id = '${f.workspace}' and user_id = '${f.actor}'`);
    // 승인자와 별개 활성 클레임 주체를 둔다.
    const claimer = randomUUID();
    query(`insert into auth.users (id) values ('${claimer}')`);
    query(`insert into workspace_members (workspace_id, user_id, role, status) values ('${f.workspace}', '${claimer}', 'manager', 'active')`);
    expect(() => query(f.claim('send-1', f.fingerprint, 60, claimer))).toThrow(/FORBIDDEN/);
    expect(f.approvalRow().consumed_at).toBeNull();
    expect(f.counts().sendSteps).toBe(0);
  });

  it('SEND_DM lease가 만료돼도 재선점하지 않고 읽기 대사 전용으로만 응답한다 (이중 발송 방지)', () => {
    const f = setup();
    query(f.approve());
    const first = query<any>(f.claim('send-1', f.fingerprint, 5))[0].res;
    expect(first.claimed).toBe(true);
    query(`update booking_recovery_steps set lease_until = now() - interval '1 second' where idempotency_key = 'send-1'`);
    const retry = query<any>(f.claim('send-1'))[0].res;
    expect(retry.claimed).toBe(false);
    expect(retry.reason).toBe('EXPIRED_LEASE_RECONCILE_ONLY');
    expect(query<any>(`select attempt from booking_recovery_steps where idempotency_key = 'send-1'`)[0].attempt).toBe(1);
    expect(f.approvalRow().consumed_at).not.toBeNull();
  });

  it('SEND_DM이 아닌 단계의 만료 lease 재선점은 기존대로 유지된다', () => {
    const f = setup();
    const lease = (key: string) => `select public.claim_booking_recovery_step('${f.workspace}', '${f.caseId}', 'PREPARE_REPLY', '${key}', '${f.actor}', '${f.fingerprint}', 5) as res`;
    expect(query<any>(lease('prep-1'))[0].res.claimed).toBe(true);
    query(`update booking_recovery_steps set lease_until = now() - interval '1 second' where idempotency_key = 'prep-1'`);
    const reclaim = query<any>(lease('prep-1'))[0].res;
    expect(reclaim.claimed).toBe(true);
    expect(reclaim.reclaimed).toBe(true);
    expect(reclaim.attempt).toBe(2);
  });

  it('이미 완료된 SEND_DM 단계는 ALREADY_COMPLETED를 돌려주고 승인을 다시 소비하지 않는다', () => {
    const f = setup();
    query(f.approve());
    const claimed = query<any>(f.claim('send-1'))[0].res;
    query(`select public.finish_booking_recovery_step('${f.workspace}', '${f.caseId}', '${claimed.step.id}', '${claimed.claim_token}', ${claimed.attempt}, '${f.fingerprint}', 'COMPLETED', 'prov_msg_1', null)`);
    const again = query<any>(f.claim('send-1'))[0].res;
    expect(again.claimed).toBe(false);
    expect(again.reason).toBe('ALREADY_COMPLETED');
  });

  it('소비된 승인과 연결된 케이스를 삭제하면 승인·step이 함께 정리된다 (consumed_by_step_id FK가 삭제를 막지 않는다)', () => {
    const f = setup();
    query(f.approve());
    expect(query<any>(f.claim('send-1'))[0].res.claimed).toBe(true);
    query(`delete from booking_recovery_cases where id = '${f.caseId}'`);
    expect(query(`select 1 from booking_recovery_approvals where case_id = '${f.caseId}'`)).toHaveLength(0);
    expect(query(`select 1 from booking_recovery_steps where case_id = '${f.caseId}'`)).toHaveLength(0);
  });

  it('원자 RPC를 거치지 않은 기존 승인 행(authorized_case_version NULL)도 소비 규칙은 동일하게 적용된다', () => {
    const f = setup();
    query(`insert into booking_recovery_approvals
      (workspace_id, case_id, step_kind, payload_fingerprint, case_version, source_message_id, catalog_version, slot_version, approved_by, expires_at)
      values ('${f.workspace}', '${f.caseId}', 'SEND', '${f.fingerprint}', 2, '${f.inbound}', 'catalog-1', 1, '${f.actor}', now() + interval '10 minutes')`);
    expect(f.approvalRow().authorized_case_version).toBeNull();
    expect(query<any>(f.claim('send-1'))[0].res.claimed).toBe(true);
    expect(f.approvalRow().consumed_at).not.toBeNull();
  });
});
