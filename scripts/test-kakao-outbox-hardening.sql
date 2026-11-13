-- 임시 로컬 PostgreSQL 전용. 운영/공유 DB에서 실행 금지.
-- psql -X -v ON_ERROR_STOP=1 -h /tmp/sohee-kakao-pg.iEpdmt -p 55439 -U postgres -f scripts/test-kakao-outbox-hardening.sql
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

-- 마이그레이션 적용: 0400 -> 0500 -> 0700 -> 0800 순서
\ir ../supabase/migrations/20261106040000_kakao_notification_outbox.sql
\ir ../supabase/migrations/20261106050000_kakao_notification_outbox_rpc.sql
\ir ../supabase/migrations/20261106070000_kakao_outbox_delivery_receipts.sql
\ir ../supabase/migrations/20261106080000_kakao_outbox_delivery_hardening.sql

do $$
declare
  w uuid := '00000000-0000-4000-8000-000000000001';
  token1 uuid := '11111111-1111-4000-8000-000000000001';
  token2 uuid := '22222222-2222-4000-8000-000000000002';
  j_sending uuid;
  j_failed uuid;
  j_conflict_a uuid;
  j_conflict_b uuid;
  j_ready uuid;
  j_claimed uuid;
  j_unknown uuid;
  j_harden uuid;
  v_delivered_at timestamptz;
begin
  insert into public.workspaces values (w);

  -- -------------------------------------------------------------------------
  -- 0. 테이블 컬럼 CHECK 제약조건 존재 검증
  -- -------------------------------------------------------------------------
  assert exists (
    select 1 from pg_constraint
    where conname = 'kakao_notification_outbox_delivery_status_code_check'
  ), 'delivery_status_code constraint exists';

  assert exists (
    select 1 from pg_constraint
    where conname = 'kakao_notification_outbox_provider_message_id_check'
  ), 'provider_message_id constraint exists';

  -- -------------------------------------------------------------------------
  -- 1. [기존 시나리오 1] SENDING job early DELIVERED 반영 후 finish SENT 해도 유지
  -- -------------------------------------------------------------------------
  insert into public.reservations(id, workspace_id, slot_id, status) values ('res_send', w, 's1', 'CONFIRMED');
  select id into j_sending from public.kakao_notification_outbox where reservation_id = 'res_send' and status = 'READY';

  assert public.claim_kakao_notification_job(j_sending, token1), 'claim j_sending';
  assert public.mark_kakao_notification_sending(j_sending, token1), 'mark j_sending sending';

  -- early DLR 수신: SENDING 상태에서 DELIVERED 반영
  assert public.record_kakao_outbox_delivery(j_sending, 'msg-early-01', 'DELIVERED', '4000'), 'early DELIVERED in SENDING';
  assert (select delivery_status = 'DELIVERED' and provider_message_id = 'msg-early-01' and delivery_status_code = '4000' and delivered_at is not null
          from public.kakao_notification_outbox where id = j_sending), 'early delivery recorded';
  assert (select status = 'SENDING' from public.kakao_notification_outbox where id = j_sending), 'outbox status is still SENDING';

  select delivered_at into v_delivered_at from public.kakao_notification_outbox where id = j_sending;

  -- 워커가 나중에 finish_kakao_notification_job('SENT')를 호출해도 delivery_status 및 delivered_at 불변 유지
  assert public.finish_kakao_notification_job(j_sending, token1, 'SENT', 'SENT_SUCCESS'), 'finish job as SENT';
  assert (select status = 'SENT' and delivery_status = 'DELIVERED' and provider_message_id = 'msg-early-01' and delivered_at = v_delivered_at
          from public.kakao_notification_outbox where id = j_sending), 'delivery preserved after finish SENT';

  -- -------------------------------------------------------------------------
  -- 2. [기존 시나리오 2] 중복 호출 시 idempotent false 반환
  -- -------------------------------------------------------------------------
  assert not public.record_kakao_outbox_delivery(j_sending, 'msg-early-01', 'DELIVERED', '4000'), 'duplicate DELIVERED returns false';

  -- -------------------------------------------------------------------------
  -- 3. [기존 시나리오 3] late FAILED false (DELIVERED 최종, 늦은 FAILED 퇴행 금지)
  -- -------------------------------------------------------------------------
  assert not public.record_kakao_outbox_delivery(j_sending, 'msg-early-01', 'FAILED', '5000'), 'late FAILED returns false';
  assert (select delivery_status = 'DELIVERED' and delivery_status_code = '4000'
          from public.kakao_notification_outbox where id = j_sending), 'delivery status remains DELIVERED';

  -- -------------------------------------------------------------------------
  -- 4. [기존 시나리오 4] FAILED -> DELIVERED 승격 허용 (true)
  -- -------------------------------------------------------------------------
  insert into public.reservations(id, workspace_id, slot_id, status) values ('res_fail', w, 's2', 'CONFIRMED');
  select id into j_failed from public.kakao_notification_outbox where reservation_id = 'res_fail' and status = 'READY';

  assert public.claim_kakao_notification_job(j_failed, token1), 'claim j_failed';
  assert public.mark_kakao_notification_sending(j_failed, token1), 'mark j_failed sending';
  assert public.finish_kakao_notification_job(j_failed, token1, 'SENT', 'SENT_SUCCESS'), 'finish j_failed as SENT';

  -- 1차 DLR: FAILED 도착
  assert public.record_kakao_outbox_delivery(j_failed, 'msg-fail-01', 'FAILED', '5000'), 'initial FAILED recorded';
  assert (select delivery_status = 'FAILED' and delivery_status_code = '5000' and delivered_at is null
          from public.kakao_notification_outbox where id = j_failed), 'delivery status is FAILED';

  -- 2차 DLR: 통신사 지연 후 DELIVERED 도착 -> DELIVERED로 승격 성공
  assert public.record_kakao_outbox_delivery(j_failed, 'msg-fail-01', 'DELIVERED', '4000'), 'upgrade FAILED to DELIVERED succeeds';
  assert (select delivery_status = 'DELIVERED' and delivery_status_code = '4000' and delivered_at is not null
          from public.kakao_notification_outbox where id = j_failed), 'delivery status upgraded to DELIVERED';

  -- -------------------------------------------------------------------------
  -- 5. [기존 시나리오 5] 메시지 ID 다른 job 충돌 안전 거부 (false)
  -- -------------------------------------------------------------------------
  insert into public.reservations(id, workspace_id, slot_id, status) values ('res_conf_a', w, 's3', 'CONFIRMED');
  select id into j_conflict_a from public.kakao_notification_outbox where reservation_id = 'res_conf_a' and status = 'READY';
  assert public.claim_kakao_notification_job(j_conflict_a, token1), 'claim j_conflict_a';
  assert public.mark_kakao_notification_sending(j_conflict_a, token1), 'mark j_conflict_a sending';
  assert public.record_kakao_outbox_delivery(j_conflict_a, 'msg-unique-conflict', 'DELIVERED', '4000'), 'j_conflict_a registers message id';

  insert into public.reservations(id, workspace_id, slot_id, status) values ('res_conf_b', w, 's4', 'CONFIRMED');
  select id into j_conflict_b from public.kakao_notification_outbox where reservation_id = 'res_conf_b' and status = 'READY';
  assert public.claim_kakao_notification_job(j_conflict_b, token2), 'claim j_conflict_b';
  assert public.mark_kakao_notification_sending(j_conflict_b, token2), 'mark j_conflict_b sending';

  -- job B가 이미 job A에 등록된 동일 message_id로 수신확인을 시도할 때 충돌 거부
  assert not public.record_kakao_outbox_delivery(j_conflict_b, 'msg-unique-conflict', 'DELIVERED', '4000'), 'message ID conflict returns false';
  assert (select delivery_status is null from public.kakao_notification_outbox where id = j_conflict_b), 'j_conflict_b delivery remains null';

  -- -------------------------------------------------------------------------
  -- 6. [기존 시나리오 6] READY / CLAIMED 상태에서 거부 (false)
  -- -------------------------------------------------------------------------
  insert into public.reservations(id, workspace_id, slot_id, status) values ('res_ready', w, 's5', 'CONFIRMED');
  select id into j_ready from public.kakao_notification_outbox where reservation_id = 'res_ready' and status = 'READY';
  assert not public.record_kakao_outbox_delivery(j_ready, 'msg-ready-reject', 'DELIVERED', '4000'), 'READY status rejected';
  assert (select delivery_status is null from public.kakao_notification_outbox where id = j_ready), 'READY job delivery remains null';

  assert public.claim_kakao_notification_job(j_ready, token1), 'claim j_ready';
  select id into j_claimed from public.kakao_notification_outbox where id = j_ready and status = 'CLAIMED';
  assert not public.record_kakao_outbox_delivery(j_claimed, 'msg-claimed-reject', 'DELIVERED', '4000'), 'CLAIMED status rejected';
  assert (select delivery_status is null from public.kakao_notification_outbox where id = j_claimed), 'CLAIMED job delivery remains null';

  -- -------------------------------------------------------------------------
  -- 7. [기존 시나리오 7] UNKNOWN job 상태에서 receipt 허용 (true)
  -- -------------------------------------------------------------------------
  insert into public.reservations(id, workspace_id, slot_id, status) values ('res_unk', w, 's6', 'CONFIRMED');
  select id into j_unknown from public.kakao_notification_outbox where reservation_id = 'res_unk' and status = 'READY';
  assert public.claim_kakao_notification_job(j_unknown, token1), 'claim j_unknown';
  assert public.mark_kakao_notification_sending(j_unknown, token1), 'mark j_unknown sending';
  assert public.finish_kakao_notification_job(j_unknown, token1, 'UNKNOWN', 'NETWORK_TIMEOUT'), 'finish as UNKNOWN';

  assert public.record_kakao_outbox_delivery(j_unknown, 'msg-unk-recovered', 'DELIVERED', '4000'), 'receipt for UNKNOWN job succeeds';
  assert (select delivery_status = 'DELIVERED' and provider_message_id = 'msg-unk-recovered' and status = 'UNKNOWN'
          from public.kakao_notification_outbox where id = j_unknown), 'UNKNOWN job records delivery';

  -- -------------------------------------------------------------------------
  -- 8. [하드닝 검증: p_status_code 위반 케이스 (모두 false, 예외 발생 없음)]
  -- -------------------------------------------------------------------------
  insert into public.reservations(id, workspace_id, slot_id, status) values ('res_harden', w, 's7', 'CONFIRMED');
  select id into j_harden from public.kakao_notification_outbox where reservation_id = 'res_harden' and status = 'READY';
  assert public.claim_kakao_notification_job(j_harden, token1), 'claim j_harden';
  assert public.mark_kakao_notification_sending(j_harden, token1), 'mark j_harden sending';

  -- 8-1. status_code IS NULL -> false
  assert not public.record_kakao_outbox_delivery(j_harden, 'msg-harden-01', 'DELIVERED', null), 'null status_code rejected';
  -- 8-2. status_code = '' (빈 문자열) -> false
  assert not public.record_kakao_outbox_delivery(j_harden, 'msg-harden-01', 'DELIVERED', ''), 'empty status_code rejected';
  -- 8-3. status_code 공백만 있는 문자열 -> false
  assert not public.record_kakao_outbox_delivery(j_harden, 'msg-harden-01', 'DELIVERED', '   '), 'whitespace status_code rejected';
  -- 8-4. status_code 33자 (32자 초과) -> false
  assert not public.record_kakao_outbox_delivery(j_harden, 'msg-harden-01', 'DELIVERED', repeat('a', 33)), '33-char status_code rejected';
  -- 8-5. status_code 허용문자([A-Za-z0-9_.-]) 외 특수문자 포함 -> false
  assert not public.record_kakao_outbox_delivery(j_harden, 'msg-harden-01', 'DELIVERED', '4000#bad'), 'status_code with # rejected';
  assert not public.record_kakao_outbox_delivery(j_harden, 'msg-harden-01', 'DELIVERED', '4000;drop'), 'status_code with ; rejected';
  assert not public.record_kakao_outbox_delivery(j_harden, 'msg-harden-01', 'DELIVERED', '40 00'), 'status_code with space rejected';
  assert not public.record_kakao_outbox_delivery(j_harden, 'msg-harden-01', 'DELIVERED', '성공코드'), 'status_code with korean rejected';

  -- -------------------------------------------------------------------------
  -- 9. [하드닝 검증: p_message_id 위반 케이스 (모두 false, 예외 발생 없음)]
  -- -------------------------------------------------------------------------
  -- 9-1. message_id IS NULL -> false
  assert not public.record_kakao_outbox_delivery(j_harden, null, 'DELIVERED', '4000'), 'null message_id rejected';
  -- 9-2. message_id = '' (빈 문자열) -> false
  assert not public.record_kakao_outbox_delivery(j_harden, '', 'DELIVERED', '4000'), 'empty message_id rejected';
  -- 9-3. message_id 공백만 있는 문자열 -> false
  assert not public.record_kakao_outbox_delivery(j_harden, '   ', 'DELIVERED', '4000'), 'whitespace message_id rejected';
  -- 9-4. message_id 129자 (128자 초과) -> false
  assert not public.record_kakao_outbox_delivery(j_harden, repeat('m', 129), 'DELIVERED', '4000'), '129-char message_id rejected';
  -- 9-5. message_id 허용문자([A-Za-z0-9_.-]) 외 특수문자 포함 -> false
  assert not public.record_kakao_outbox_delivery(j_harden, 'msg 01', 'DELIVERED', '4000'), 'message_id with space rejected';
  assert not public.record_kakao_outbox_delivery(j_harden, 'msg#01', 'DELIVERED', '4000'), 'message_id with # rejected';
  assert not public.record_kakao_outbox_delivery(j_harden, 'msg;drop', 'DELIVERED', '4000'), 'message_id with ; rejected';
  assert not public.record_kakao_outbox_delivery(j_harden, '메시지ID', 'DELIVERED', '4000'), 'message_id with korean rejected';

  -- 하드닝 위반 시도 후에도 outbox 레코드는 여전히 delivery 미반영 상태여야 함
  assert (select delivery_status is null and provider_message_id is null and delivery_status_code is null
          from public.kakao_notification_outbox where id = j_harden), 'j_harden still untouched after rejections';

  -- -------------------------------------------------------------------------
  -- 10. [하드닝 검증: 정상 입력 케이스 (trim 처리 및 경계값 true)]
  -- -------------------------------------------------------------------------
  -- 10-1. trim 전후 공백이 있는 정상 입력 -> trim되어 정상 반영 (true)
  assert public.record_kakao_outbox_delivery(j_harden, '  msg-harden-01  ', 'DELIVERED', '  4000  '), 'trimmed valid delivery accepted';
  assert (select delivery_status = 'DELIVERED'
             and provider_message_id = 'msg-harden-01'
             and delivery_status_code = '4000'
          from public.kakao_notification_outbox where id = j_harden), 'trimmed values correctly stored';

  -- 10-2. 경계값 검증: status_code 1자('A') 및 32자, message_id 1자('m') 및 128자
  insert into public.reservations(id, workspace_id, slot_id, status) values ('res_bound', w, 's8', 'CONFIRMED');
  declare
    j_bound uuid;
    v_max_msg text := repeat('M', 128);
    v_max_code text := repeat('C', 32);
  begin
    select id into j_bound from public.kakao_notification_outbox where reservation_id = 'res_bound' and status = 'READY';
    assert public.claim_kakao_notification_job(j_bound, token1), 'claim j_bound';
    assert public.mark_kakao_notification_sending(j_bound, token1), 'mark j_bound sending';

    -- 128자 message_id, 32자 status_code 허용문자 조합(대소문자, 숫자, 밑줄, 점, 하이픈)
    assert public.record_kakao_outbox_delivery(j_bound, v_max_msg, 'DELIVERED', v_max_code), '128-char msg and 32-char code accepted';
    assert (select provider_message_id = v_max_msg and delivery_status_code = v_max_code
            from public.kakao_notification_outbox where id = j_bound), 'max boundary values stored';
  end;

  -- 10-3. 복합 허용문자 검증: [A-Za-z0-9_.-] 조합
  insert into public.reservations(id, workspace_id, slot_id, status) values ('res_chars', w, 's9', 'CONFIRMED');
  declare
    j_chars uuid;
  begin
    select id into j_chars from public.kakao_notification_outbox where reservation_id = 'res_chars' and status = 'READY';
    assert public.claim_kakao_notification_job(j_chars, token1), 'claim j_chars';
    assert public.mark_kakao_notification_sending(j_chars, token1), 'mark j_chars sending';

    assert public.record_kakao_outbox_delivery(j_chars, 'M4V-2026_test.v1', 'FAILED', 'ERR_NET.01-v2'), 'allowed symbols accepted';
    assert (select provider_message_id = 'M4V-2026_test.v1' and delivery_status_code = 'ERR_NET.01-v2'
            from public.kakao_notification_outbox where id = j_chars), 'allowed symbols correctly stored';
  end;

  -- -------------------------------------------------------------------------
  -- 11. [기존 시나리오 8] 권한 검증: service_role만 실행 가능, anon/authenticated 불가
  -- -------------------------------------------------------------------------
  assert not has_function_privilege('anon', 'public.record_kakao_outbox_delivery(uuid,text,text,text)', 'execute'), 'anon denied record_kakao_outbox_delivery';
  assert not has_function_privilege('authenticated', 'public.record_kakao_outbox_delivery(uuid,text,text,text)', 'execute'), 'authenticated denied record_kakao_outbox_delivery';
  assert has_function_privilege('service_role', 'public.record_kakao_outbox_delivery(uuid,text,text,text)', 'execute'), 'service_role granted record_kakao_outbox_delivery';

end;
$$;

rollback;
\echo 'PASS: kakao outbox delivery hardening verification'
