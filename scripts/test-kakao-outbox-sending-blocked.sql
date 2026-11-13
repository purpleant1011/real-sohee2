-- 임시 로컬 PostgreSQL 전용. 운영/공유 DB에서 실행 금지.
-- psql -X -v ON_ERROR_STOP=1 -f scripts/test-kakao-outbox-sending-blocked.sql
-- SENDING -> BLOCKED 전이 허용 및 RPC 제약조건 검증
\set ON_ERROR_STOP on
begin;

-- 최소 roles guard
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

grant usage on schema public to authenticated;
grant select, insert, update on public.reservations to authenticated;

-- 기존 6개 마이그레이션 순차 적용
\ir ../supabase/migrations/20261106040000_kakao_notification_outbox.sql
\ir ../supabase/migrations/20261106050000_kakao_notification_outbox_rpc.sql
\ir ../supabase/migrations/20261106060000_kakao_notification_policy_evidence.sql
\ir ../supabase/migrations/20261106070000_kakao_outbox_delivery_receipts.sql
\ir ../supabase/migrations/20261106080000_kakao_outbox_delivery_hardening.sql
\ir ../supabase/migrations/20261106090000_kakao_reservation_previous_start.sql

-- 신규 마이그레이션 적용: SENDING -> BLOCKED 허용
\ir ../supabase/migrations/20261109010000_kakao_finish_sending_blocked.sql

do $$
declare
  w uuid := '00000000-0000-4000-8000-000000000001';
  token1 uuid := '11111111-1111-4000-8000-000000000001';
  token2 uuid := '22222222-2222-4000-8000-000000000002';
  wrong_token uuid := '99999999-9999-4000-8000-000000000009';

  j_blocked uuid;
  j_wrong_token uuid;
  j_invalid_status uuid;
  j_sent uuid;
  j_unknown uuid;
  j_claimed_block uuid;
  j_claimed_super uuid;
  j_claimed_sent uuid;
begin
  insert into public.workspaces values (w);

  -- -------------------------------------------------------------------------
  -- 1. [핵심 검증] SENDING -> BLOCKED 성공 및 lease 정리
  -- outbox-processor에서 사전검증 실패(notSent=true) 시 finish(..., 'BLOCKED', 'SEND_PRECHECK_FAILED')
  -- -------------------------------------------------------------------------
  insert into public.reservations(id, workspace_id, slot_id, status) values ('res_block', w, 'slot_1', 'CONFIRMED');
  select id into j_blocked from public.kakao_notification_outbox where reservation_id = 'res_block' and status = 'READY';

  assert public.claim_kakao_notification_job(j_blocked, token1), 'claim j_blocked';
  assert public.mark_kakao_notification_sending(j_blocked, token1), 'mark j_blocked sending';
  assert (select status = 'SENDING' and lease_token = token1 and lease_until is not null
          from public.kakao_notification_outbox where id = j_blocked), 'job is in SENDING status with lease';

  -- SENDING -> BLOCKED 호출 성공 확인
  assert public.finish_kakao_notification_job(j_blocked, token1, 'BLOCKED', 'SEND_PRECHECK_FAILED'),
    'finish_kakao_notification_job(SENDING -> BLOCKED) must succeed';

  assert (select status = 'BLOCKED' and reason_code = 'SEND_PRECHECK_FAILED' and lease_token is null and lease_until is null
          from public.kakao_notification_outbox where id = j_blocked),
    'job must be in BLOCKED status with reason_code and null lease';

  -- 이미 BLOCKED 된 건에 재호출 시 false 반환
  assert not public.finish_kakao_notification_job(j_blocked, token1, 'BLOCKED', 'SEND_PRECHECK_FAILED'),
    'duplicate finish on BLOCKED must return false';

  -- -------------------------------------------------------------------------
  -- 2. 토큰 불일치 시 false 반환 및 SENDING 상태 보존
  -- -------------------------------------------------------------------------
  insert into public.reservations(id, workspace_id, slot_id, status) values ('res_token_err', w, 'slot_2', 'CONFIRMED');
  select id into j_wrong_token from public.kakao_notification_outbox where reservation_id = 'res_token_err' and status = 'READY';

  assert public.claim_kakao_notification_job(j_wrong_token, token1), 'claim j_wrong_token';
  assert public.mark_kakao_notification_sending(j_wrong_token, token1), 'mark j_wrong_token sending';

  assert not public.finish_kakao_notification_job(j_wrong_token, wrong_token, 'BLOCKED', 'SEND_PRECHECK_FAILED'),
    'finish with wrong lease token must return false';

  assert (select status = 'SENDING' and lease_token = token1 from public.kakao_notification_outbox where id = j_wrong_token),
    'status must remain SENDING when token does not match';

  -- -------------------------------------------------------------------------
  -- 3. SENDING -> 금지된 상태(READY, CLAIMED, FAILED, SUPERSEDED) 전이 불가
  -- -------------------------------------------------------------------------
  insert into public.reservations(id, workspace_id, slot_id, status) values ('res_invalid_st', w, 'slot_3', 'CONFIRMED');
  select id into j_invalid_status from public.kakao_notification_outbox where reservation_id = 'res_invalid_st' and status = 'READY';

  assert public.claim_kakao_notification_job(j_invalid_status, token1), 'claim j_invalid_status';
  assert public.mark_kakao_notification_sending(j_invalid_status, token1), 'mark j_invalid_status sending';

  -- READY 전이 시도 불가
  assert not public.finish_kakao_notification_job(j_invalid_status, token1, 'READY', 'SEND_PRECHECK_FAILED'),
    'SENDING -> READY must be rejected';
  -- CLAIMED 전이 시도 불가
  assert not public.finish_kakao_notification_job(j_invalid_status, token1, 'CLAIMED', 'SEND_PRECHECK_FAILED'),
    'SENDING -> CLAIMED must be rejected';
  -- FAILED 전이 시도 불가
  assert not public.finish_kakao_notification_job(j_invalid_status, token1, 'FAILED', 'SEND_PRECHECK_FAILED'),
    'SENDING -> FAILED must be rejected';
  -- SUPERSEDED 전이 시도 불가 (SENDING에서는 SUPERSEDED 불가)
  assert not public.finish_kakao_notification_job(j_invalid_status, token1, 'SUPERSEDED', 'SEND_PRECHECK_FAILED'),
    'SENDING -> SUPERSEDED must be rejected';

  assert (select status = 'SENDING' from public.kakao_notification_outbox where id = j_invalid_status),
    'job must still be in SENDING status after rejected transitions';

  -- -------------------------------------------------------------------------
  -- 4. reason_code 검증: null / 빈문자열 / 비허용 문자 거부
  -- -------------------------------------------------------------------------
  assert not public.finish_kakao_notification_job(j_invalid_status, token1, 'BLOCKED', null),
    'null reason_code must be rejected';
  assert not public.finish_kakao_notification_job(j_invalid_status, token1, 'BLOCKED', ''),
    'empty reason_code must be rejected';
  assert not public.finish_kakao_notification_job(j_invalid_status, token1, 'BLOCKED', 'invalid reason with spaces'),
    'reason_code with invalid characters must be rejected';
  assert not public.finish_kakao_notification_job(j_invalid_status, token1, 'BLOCKED', 'lowercase_not_allowed'),
    'lowercase reason_code must be rejected';

  assert (select status = 'SENDING' from public.kakao_notification_outbox where id = j_invalid_status),
    'job must still be in SENDING status after invalid reason_code attempts';

  -- -------------------------------------------------------------------------
  -- 5. 기존 SENDING -> SENT 및 SENDING -> UNKNOWN 전이 유지
  -- -------------------------------------------------------------------------
  -- 5-A. SENDING -> SENT
  insert into public.reservations(id, workspace_id, slot_id, status) values ('res_sent', w, 'slot_4', 'CONFIRMED');
  select id into j_sent from public.kakao_notification_outbox where reservation_id = 'res_sent' and status = 'READY';

  assert public.claim_kakao_notification_job(j_sent, token1), 'claim j_sent';
  assert public.mark_kakao_notification_sending(j_sent, token1), 'mark j_sent sending';
  assert public.finish_kakao_notification_job(j_sent, token1, 'SENT', 'SENT_SUCCESS'),
    'SENDING -> SENT must succeed';
  assert (select status = 'SENT' and reason_code = 'SENT_SUCCESS' and lease_token is null and lease_until is null
          from public.kakao_notification_outbox where id = j_sent),
    'job must be SENT with cleared lease';

  -- 5-B. SENDING -> UNKNOWN
  insert into public.reservations(id, workspace_id, slot_id, status) values ('res_unknown', w, 'slot_5', 'CONFIRMED');
  select id into j_unknown from public.kakao_notification_outbox where reservation_id = 'res_unknown' and status = 'READY';

  assert public.claim_kakao_notification_job(j_unknown, token1), 'claim j_unknown';
  assert public.mark_kakao_notification_sending(j_unknown, token1), 'mark j_unknown sending';
  assert public.finish_kakao_notification_job(j_unknown, token1, 'UNKNOWN', 'SEND_REJECTED'),
    'SENDING -> UNKNOWN must succeed';
  assert (select status = 'UNKNOWN' and reason_code = 'SEND_REJECTED' and lease_token is null and lease_until is null
          from public.kakao_notification_outbox where id = j_unknown),
    'job must be UNKNOWN with cleared lease';

  -- -------------------------------------------------------------------------
  -- 6. CLAIMED 상태에서의 기존 전이 규칙(BLOCKED/SUPERSEDED 허용, SENT/UNKNOWN 거부) 유지
  -- -------------------------------------------------------------------------
  -- 6-A. CLAIMED -> BLOCKED 성공
  insert into public.reservations(id, workspace_id, slot_id, status) values ('res_claimed_block', w, 'slot_6', 'CONFIRMED');
  select id into j_claimed_block from public.kakao_notification_outbox where reservation_id = 'res_claimed_block' and status = 'READY';
  assert public.claim_kakao_notification_job(j_claimed_block, token2), 'claim j_claimed_block';
  assert public.finish_kakao_notification_job(j_claimed_block, token2, 'BLOCKED', 'WORKSPACE_MISMATCH'),
    'CLAIMED -> BLOCKED must succeed';
  assert (select status = 'BLOCKED' and reason_code = 'WORKSPACE_MISMATCH' and lease_token is null
          from public.kakao_notification_outbox where id = j_claimed_block),
    'CLAIMED -> BLOCKED recorded';

  -- 6-B. CLAIMED -> SUPERSEDED 성공
  insert into public.reservations(id, workspace_id, slot_id, status) values ('res_claimed_super', w, 'slot_7', 'CONFIRMED');
  select id into j_claimed_super from public.kakao_notification_outbox where reservation_id = 'res_claimed_super' and status = 'READY';
  assert public.claim_kakao_notification_job(j_claimed_super, token2), 'claim j_claimed_super';
  assert public.finish_kakao_notification_job(j_claimed_super, token2, 'SUPERSEDED', 'STALE_RESERVATION'),
    'CLAIMED -> SUPERSEDED must succeed';
  assert (select status = 'SUPERSEDED' and reason_code = 'STALE_RESERVATION' and lease_token is null
          from public.kakao_notification_outbox where id = j_claimed_super),
    'CLAIMED -> SUPERSEDED recorded';

  -- 6-C. CLAIMED -> SENT 거부
  insert into public.reservations(id, workspace_id, slot_id, status) values ('res_claimed_sent', w, 'slot_8', 'CONFIRMED');
  select id into j_claimed_sent from public.kakao_notification_outbox where reservation_id = 'res_claimed_sent' and status = 'READY';
  assert public.claim_kakao_notification_job(j_claimed_sent, token2), 'claim j_claimed_sent';
  assert not public.finish_kakao_notification_job(j_claimed_sent, token2, 'SENT', 'SENT_SUCCESS'),
    'CLAIMED -> SENT must be rejected';
  assert (select status = 'CLAIMED' from public.kakao_notification_outbox where id = j_claimed_sent),
    'status must remain CLAIMED';

  -- -------------------------------------------------------------------------
  -- 7. 권한 검증: service_role 만 execute 가능, anon/authenticated 실행 불가
  -- -------------------------------------------------------------------------
  assert has_function_privilege('service_role', 'public.finish_kakao_notification_job(uuid, uuid, text, text)', 'EXECUTE'),
    'service_role has execute privilege';
  assert not has_function_privilege('anon', 'public.finish_kakao_notification_job(uuid, uuid, text, text)', 'EXECUTE'),
    'anon must not have execute privilege';
  assert not has_function_privilege('authenticated', 'public.finish_kakao_notification_job(uuid, uuid, text, text)', 'EXECUTE'),
    'authenticated must not have execute privilege';

  raise notice 'All finish_kakao_notification_job (SENDING -> BLOCKED) test assertions passed successfully.';
end $$;

rollback;

\echo PASS: kakao finish sending blocked migration and RPC verification passed successfully
