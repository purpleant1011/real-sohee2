-- 임시 로컬 PostgreSQL 전용. 운영/공유 DB에서 실행 금지.
-- psql -X -v ON_ERROR_STOP=1 -h /tmp/sohee-kakao-pg.iEpdmt -p 55439 -U postgres -f scripts/test-kakao-outbox-dlr.sql
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

-- 마이그레이션 적용
\ir ../supabase/migrations/20261106040000_kakao_notification_outbox.sql
\ir ../supabase/migrations/20261106050000_kakao_notification_outbox_rpc.sql
\ir ../supabase/migrations/20261106070000_kakao_outbox_delivery_receipts.sql

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
  v_delivered_at timestamptz;
begin
  insert into public.workspaces values (w);

  -- -------------------------------------------------------------------------
  -- 1. SENDING job early DELIVERED 반영 후 finish_kakao_notification_job(SENT) 해도 delivery 유지
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
  -- 2. 중복 호출 시 idempotent false 반환
  -- -------------------------------------------------------------------------
  assert not public.record_kakao_outbox_delivery(j_sending, 'msg-early-01', 'DELIVERED', '4000'), 'duplicate DELIVERED returns false';

  -- -------------------------------------------------------------------------
  -- 3. late FAILED false (DELIVERED 최종, 늦은 FAILED 퇴행 금지)
  -- -------------------------------------------------------------------------
  assert not public.record_kakao_outbox_delivery(j_sending, 'msg-early-01', 'FAILED', '5000'), 'late FAILED returns false';
  assert (select delivery_status = 'DELIVERED' and delivery_status_code = '4000'
          from public.kakao_notification_outbox where id = j_sending), 'delivery status remains DELIVERED';

  -- -------------------------------------------------------------------------
  -- 4. FAILED -> DELIVERED 승격 허용 (true)
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
  -- 5. 메시지 ID 다른 job 충돌 안전 거부 (false)
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
  -- 6. READY / CLAIMED 상태에서 거부 (false)
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
  -- 7. UNKNOWN job 상태에서 receipt 허용 (true)
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
  -- 8. 권한 검증: service_role만 실행 가능, anon/authenticated는 불가
  -- -------------------------------------------------------------------------
  assert not has_function_privilege('anon', 'public.record_kakao_outbox_delivery(uuid,text,text,text)', 'execute'), 'anon denied record_kakao_outbox_delivery';
  assert not has_function_privilege('authenticated', 'public.record_kakao_outbox_delivery(uuid,text,text,text)', 'execute'), 'authenticated denied record_kakao_outbox_delivery';
  assert has_function_privilege('service_role', 'public.record_kakao_outbox_delivery(uuid,text,text,text)', 'execute'), 'service_role granted record_kakao_outbox_delivery';

end;
$$;

rollback;
\echo 'PASS: kakao outbox delivery receipts SQL verification'
