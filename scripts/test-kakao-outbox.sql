-- 임시 로컬 PostgreSQL 전용. 운영/공유 DB에서 실행 금지.
-- psql -X -v ON_ERROR_STOP=1 -h <임시 socket> -p <port> -U postgres -f scripts/test-kakao-outbox.sql
-- 최소 fixture 스키마로 트리거 및 RPC 계약을 검증하며 운영 전체 스키마 검증을 대체하지 않는다.
\set ON_ERROR_STOP on
begin;
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

-- authenticated 역할에게 reservations 테이블 DML 권한 부여 (실제 서비스 환경 모사)
grant usage on schema public to authenticated;
grant select, insert, update on public.reservations to authenticated;

\ir ../supabase/migrations/20261106040000_kakao_notification_outbox.sql
\ir ../supabase/migrations/20261106050000_kakao_notification_outbox_rpc.sql

do $$
declare
  w uuid := '00000000-0000-4000-8000-000000000001';
  old_version timestamptz;
  j1 uuid;
  j2 uuid;
  j3 uuid;
  j4 uuid;
  j5 uuid;
  token1 uuid := '11111111-1111-4000-8000-000000000001';
  token2 uuid := '22222222-2222-4000-8000-000000000002';
  wrong_token uuid := '99999999-9999-4000-8000-000000000009';
begin
  -- -------------------------------------------------------------------------
  -- 1. 트리거 라이프사이클 및 버전 무결성 검증
  -- -------------------------------------------------------------------------
  insert into public.workspaces values(w);
  insert into public.reservations(id,workspace_id,slot_id,status)
    values ('r1',w,'slot1','CONFIRMED');
  assert (select count(*)=1 from public.kakao_notification_outbox), 'confirmed enqueue';
  assert (select event='BOOKING_CONFIRMED' from public.kakao_notification_outbox), 'confirmed event';
  select updated_at into old_version from public.reservations where id='r1';
  update public.reservations set slot_id='slot2' where id='r1';
  assert (select updated_at>old_version from public.reservations where id='r1'), 'monotonic version';
  assert (select count(*)=1 from public.kakao_notification_outbox where status='SUPERSEDED' and lease_token is null and lease_until is null), 'invalidate old event and clear lease';
  assert (select count(*)=1 from public.kakao_notification_outbox where event='BOOKING_CHANGED' and status='READY'), 'changed enqueue';

  -- 진행 중인 외부 발송은 취소로 덮어쓰지 않는다.
  update public.kakao_notification_outbox set status='SENDING' where status='READY';
  update public.reservations set status='CANCELLED' where id='r1';
  assert (select count(*)=1 from public.kakao_notification_outbox where status='SENDING'), 'sending preserved';
  assert (select count(*)=1 from public.kakao_notification_outbox where event='BOOKING_CANCELLED' and status='READY'), 'cancel enqueue';

  -- 일반 메모 수정은 추가 발행하지 않는다.
  update public.reservations set metadata='{"note":"local fixture"}' where id='r1';
  assert (select count(*)=3 from public.kakao_notification_outbox), 'unrelated update not enqueued';

  -- 예약 저장 트랜잭션이 실패하면 outbox도 롤백된다.
  begin
    insert into public.reservations(id,workspace_id,slot_id,status) values('rolledback',w,'slot3','CONFIRMED');
    raise exception 'local rollback sentinel';
  exception when raise_exception then null;
  end;
  assert not exists(select 1 from public.reservations where id='rolledback'), 'reservation rollback';
  assert not exists(select 1 from public.kakao_notification_outbox where reservation_id='rolledback'), 'outbox atomic rollback';

  -- -------------------------------------------------------------------------
  -- 1-1. 반복 slot 변경 시 monotonic 트리거로 인해 unique 충돌 방지 검증 (Point 5)
  -- -------------------------------------------------------------------------
  insert into public.reservations(id,workspace_id,slot_id,status) values('r_mono',w,'slot_init','CONFIRMED');
  for i in 1..5 loop
    update public.reservations set slot_id = 'slot_iter_' || i where id = 'r_mono';
  end loop;
  assert (select count(*) from public.kakao_notification_outbox where reservation_id='r_mono') = 6, 'all 6 outbox events enqueued without unique violation';

  -- -------------------------------------------------------------------------
  -- 1-2. CLAIMED 건이 신규 이벤트로 SUPERSEDED될 때 lease_token/lease_until null 정리 검증 (Point 2)
  -- -------------------------------------------------------------------------
  insert into public.reservations(id,workspace_id,slot_id,status) values('r_sup',w,'slot_init','CONFIRMED');
  select id into j5 from public.kakao_notification_outbox where reservation_id='r_sup' and status='READY';
  assert public.claim_kakao_notification_job(j5, token1), 'claim r_sup job';
  assert (select status='CLAIMED' and lease_token=token1 from public.kakao_notification_outbox where id=j5), 'j5 is CLAIMED';
  -- slot 변경으로 인한 후속 이벤트 발생 -> 직전 CLAIMED 건은 SUPERSEDED 전이되고 lease_token/lease_until null 정리
  update public.reservations set slot_id = 'slot_changed' where id = 'r_sup';
  assert (select status='SUPERSEDED' and reason_code='SUPERSEDED_BY_NEWER_EVENT' and lease_token is null and lease_until is null
          from public.kakao_notification_outbox where id=j5), 'superseded CLAIMED job cleared lease';

  -- -------------------------------------------------------------------------
  -- 2. 신규 RPC: claim_kakao_notification_job 검증
  -- -------------------------------------------------------------------------
  select id into j1 from public.kakao_notification_outbox where reservation_id='r1' and event='BOOKING_CANCELLED' and status='READY';
  assert j1 is not null, 'ready job exists';

  -- null 인자 검증
  assert not public.claim_kakao_notification_job(null, token1), 'claim null job fails';
  assert not public.claim_kakao_notification_job(j1, null), 'claim null token fails';

  -- 미래 due_at 선점 불가
  update public.kakao_notification_outbox set due_at = statement_timestamp() + interval '1 hour' where id = j1;
  assert not public.claim_kakao_notification_job(j1, token1), 'future due_at cannot be claimed';
  update public.kakao_notification_outbox set due_at = statement_timestamp() - interval '1 second' where id = j1;

  -- 정상 claim -> CLAIMED 전이 및 리스 60초 기록
  assert public.claim_kakao_notification_job(j1, token1), 'claim ready job succeeds';
  assert (select status='CLAIMED' and lease_token=token1 and lease_until > statement_timestamp()
          from public.kakao_notification_outbox where id=j1), 'claimed status and lease recorded';

  -- 중복 claim 차단 (활성 리스 보유 중 다른 토큰 선점 불가)
  assert not public.claim_kakao_notification_job(j1, token2), 'active claimed job cannot be re-claimed';

  -- -------------------------------------------------------------------------
  -- 3. 신규 RPC: mark_kakao_notification_sending 검증
  -- -------------------------------------------------------------------------
  -- wrong token 차단
  assert not public.mark_kakao_notification_sending(j1, wrong_token), 'mark sending with wrong token fails';
  assert (select status='CLAIMED' from public.kakao_notification_outbox where id=j1), 'status still CLAIMED after wrong token';

  -- 만료 리스 상태에선 mark sending 불가
  update public.kakao_notification_outbox set lease_until = statement_timestamp() - interval '1 second' where id = j1;
  assert not public.mark_kakao_notification_sending(j1, token1), 'expired lease cannot mark sending';

  -- 만료된 CLAIMED 건은 새로운 토큰으로 재claim 가능
  assert public.claim_kakao_notification_job(j1, token2), 'expired claimed job re-claimed by token2';
  assert (select status='CLAIMED' and lease_token=token2 from public.kakao_notification_outbox where id=j1), 're-claimed by token2';

  -- reservations의 버전(updated_at) 불일치 시 SENDING 전이 거절
  select updated_at into old_version from public.reservations where id='r1';
  update public.reservations set metadata='{"changed":true}', updated_at = old_version + interval '1 second' where id='r1';
  assert not public.mark_kakao_notification_sending(j1, token2), 'stale reservation version rejected from sending';
  -- 버전 일치 복원
  update public.reservations set updated_at = (select reservation_updated_at from public.kakao_notification_outbox where id=j1) where id='r1';

  -- 정상 CAS: CLAIMED -> SENDING 전이 및 60초 리스 갱신 (event CANCELLED & res CANCELLED 부합)
  assert public.mark_kakao_notification_sending(j1, token2), 'mark sending succeeds with matching version and status';
  assert (select status='SENDING' and lease_token=token2 and lease_until > statement_timestamp()
          from public.kakao_notification_outbox where id=j1), 'status is SENDING';

  -- SENDING 상태에서 중복 mark sending 불가
  assert not public.mark_kakao_notification_sending(j1, token2), 'already sending cannot mark sending again';

  -- SENDING 상태는 절대 재claim 불가
  assert not public.claim_kakao_notification_job(j1, token1), 'cannot claim job in SENDING';

  -- 이벤트별 예약 상태 부합 거절 검증 (Point 3): event CONFIRMED인데 res CANCELLED인 불일치 케이스
  insert into public.reservations(id,workspace_id,slot_id,status) values('r_mis',w,'slot_m','CONFIRMED');
  select id into j5 from public.kakao_notification_outbox where reservation_id='r_mis' and status='READY';
  assert public.claim_kakao_notification_job(j5, token1), 'claim j5';
  update public.kakao_notification_outbox set event = 'BOOKING_CANCELLED' where id = j5;
  assert not public.mark_kakao_notification_sending(j5, token1), 'event CANCELLED with res CONFIRMED rejected';
  update public.kakao_notification_outbox set event = 'BOOKING_CONFIRMED' where id = j5;
  assert public.mark_kakao_notification_sending(j5, token1), 'event CONFIRMED with res CONFIRMED succeeds';

  -- -------------------------------------------------------------------------
  -- 4. 신규 RPC: finish_kakao_notification_job 검증
  -- -------------------------------------------------------------------------
  -- reason_code 정규식 및 길이 제약 검증
  assert not public.finish_kakao_notification_job(j1, token2, 'SENT', 'lowercase_bad'), 'lowercase reason code rejected';
  assert not public.finish_kakao_notification_job(j1, token2, 'SENT', 'BAD-HYPHEN'), 'hyphen reason code rejected';
  assert not public.finish_kakao_notification_job(j1, token2, 'SENT', repeat('A', 65)), 'reason code > 64 chars rejected';

  -- SENDING 상태에서 금지된 상태 전이 (BLOCKED, SUPERSEDED 불가)
  assert not public.finish_kakao_notification_job(j1, token2, 'BLOCKED', 'REASON_OK'), 'SENDING cannot finish as BLOCKED';
  assert not public.finish_kakao_notification_job(j1, token2, 'SUPERSEDED', 'REASON_OK'), 'SENDING cannot finish as SUPERSEDED';

  -- wrong token 차단
  assert not public.finish_kakao_notification_job(j1, wrong_token, 'SENT', 'REASON_OK'), 'wrong token cannot finish';

  -- 정상 SENDING -> SENT 전이 및 리스 해제
  assert public.finish_kakao_notification_job(j1, token2, 'SENT', 'SENT_SUCCESS'), 'SENDING finishes as SENT';
  assert (select status='SENT' and reason_code='SENT_SUCCESS' and lease_token is null and lease_until is null
          from public.kakao_notification_outbox where id=j1), 'SENT clears lease';

  -- SENT 상태는 절대 재claim 불가
  assert not public.claim_kakao_notification_job(j1, token1), 'SENT job cannot be re-claimed';

  -- CLAIMED -> BLOCKED 전이 검증 (신규 예약 건)
  insert into public.reservations(id,workspace_id,slot_id,status) values('r2',w,'slot_r2','CONFIRMED');
  select id into j2 from public.kakao_notification_outbox where reservation_id='r2' and status='READY';
  assert public.claim_kakao_notification_job(j2, token1), 'claim j2 succeeds';
  -- CLAIMED 상태에서 SENT/UNKNOWN 직접 종료 불가
  assert not public.finish_kakao_notification_job(j2, token1, 'SENT', 'REASON_OK'), 'CLAIMED cannot finish as SENT';
  assert not public.finish_kakao_notification_job(j2, token1, 'UNKNOWN', 'REASON_OK'), 'CLAIMED cannot finish as UNKNOWN';
  -- CLAIMED -> BLOCKED 종료 및 리스 해제
  assert public.finish_kakao_notification_job(j2, token1, 'BLOCKED', 'INVALID_PHONE'), 'CLAIMED finishes as BLOCKED';
  assert (select status='BLOCKED' and reason_code='INVALID_PHONE' and lease_token is null and lease_until is null
          from public.kakao_notification_outbox where id=j2), 'BLOCKED clears lease';

  -- CLAIMED -> SUPERSEDED 전이 검증 (신규 예약 건)
  insert into public.reservations(id,workspace_id,slot_id,status) values('r3',w,'slot_r3','CONFIRMED');
  select id into j3 from public.kakao_notification_outbox where reservation_id='r3' and status='READY';
  assert public.claim_kakao_notification_job(j3, token1), 'claim j3 succeeds';
  assert public.finish_kakao_notification_job(j3, token1, 'SUPERSEDED', 'STALE_RESERVATION'), 'CLAIMED finishes as SUPERSEDED';
  assert (select status='SUPERSEDED' and reason_code='STALE_RESERVATION' and lease_token is null and lease_until is null
          from public.kakao_notification_outbox where id=j3), 'SUPERSEDED clears lease';

  -- -------------------------------------------------------------------------
  -- 5. 신규 복구 RPC: expire_kakao_notification_jobs 검증
  -- -------------------------------------------------------------------------
  insert into public.reservations(id,workspace_id,slot_id,status) values('r4',w,'slot_r4','CONFIRMED');
  select id into j4 from public.kakao_notification_outbox where reservation_id='r4' and status='READY';
  assert public.claim_kakao_notification_job(j4, token1), 'claim j4 succeeds';
  assert public.mark_kakao_notification_sending(j4, token1), 'j4 marked sending';

  -- 활성 SENDING 건은 expire 대상 아님
  assert (select public.expire_kakao_notification_jobs() = 0), 'active sending is not expired';

  -- SENDING 리스 만료 시뮬레이션
  update public.kakao_notification_outbox set lease_until = statement_timestamp() - interval '5 seconds' where id=j4;
  assert (select public.expire_kakao_notification_jobs() = 1), 'expired sending recovered to unknown';
  assert (select status='UNKNOWN' and reason_code='SENDING_LEASE_EXPIRED' and lease_token is null and lease_until is null
          from public.kakao_notification_outbox where id=j4), 'expired sending transitioned to UNKNOWN, lease cleared';
  -- 복구 RPC는 절대 READY로 되돌리지 않음
  assert not exists (select 1 from public.kakao_notification_outbox where id=j4 and status='READY'), 'never ready';

  -- -------------------------------------------------------------------------
  -- 6. 권한 격리 및 RLS 검증
  -- -------------------------------------------------------------------------
  assert not has_table_privilege('anon','public.kakao_notification_outbox','select'), 'anon denied';
  assert not has_table_privilege('authenticated','public.kakao_notification_outbox','insert'), 'authenticated denied';
  assert (select relrowsecurity from pg_class where oid='public.kakao_notification_outbox'::regclass), 'RLS enabled';

  -- RPC 실행 권한 검증: service_role만 execute 가능, anon 및 authenticated는 불가
  assert not has_function_privilege('anon', 'public.claim_kakao_notification_job(uuid,uuid)', 'execute'), 'anon denied claim RPC';
  assert not has_function_privilege('authenticated', 'public.claim_kakao_notification_job(uuid,uuid)', 'execute'), 'authenticated denied claim RPC';
  assert has_function_privilege('service_role', 'public.claim_kakao_notification_job(uuid,uuid)', 'execute'), 'service_role granted claim RPC';

  assert not has_function_privilege('anon', 'public.mark_kakao_notification_sending(uuid,uuid)', 'execute'), 'anon denied mark_sending RPC';
  assert not has_function_privilege('authenticated', 'public.mark_kakao_notification_sending(uuid,uuid)', 'execute'), 'authenticated denied mark_sending RPC';
  assert has_function_privilege('service_role', 'public.mark_kakao_notification_sending(uuid,uuid)', 'execute'), 'service_role granted mark_sending RPC';

  assert not has_function_privilege('anon', 'public.finish_kakao_notification_job(uuid,uuid,text,text)', 'execute'), 'anon denied finish RPC';
  assert not has_function_privilege('authenticated', 'public.finish_kakao_notification_job(uuid,uuid,text,text)', 'execute'), 'authenticated denied finish RPC';
  assert has_function_privilege('service_role', 'public.finish_kakao_notification_job(uuid,uuid,text,text)', 'execute'), 'service_role granted finish RPC';

  assert not has_function_privilege('anon', 'public.expire_kakao_notification_jobs()', 'execute'), 'anon denied expire RPC';
  assert not has_function_privilege('authenticated', 'public.expire_kakao_notification_jobs()', 'execute'), 'authenticated denied expire RPC';
  assert has_function_privilege('service_role', 'public.expire_kakao_notification_jobs()', 'execute'), 'service_role granted expire RPC';

  -- 트리거 함수 권한 검증: execute 권한은 service_role만 보유, anon/authenticated는 불가
  assert not has_function_privilege('anon', 'public.kakao_enqueue_reservation_outbox()', 'execute'), 'anon denied enqueue trigger function';
  assert not has_function_privilege('authenticated', 'public.kakao_enqueue_reservation_outbox()', 'execute'), 'authenticated denied enqueue trigger function';
  assert has_function_privilege('service_role', 'public.kakao_enqueue_reservation_outbox()', 'execute'), 'service_role granted enqueue trigger function';

  assert not has_function_privilege('anon', 'public.kakao_reservation_ensure_monotonic_updated_at()', 'execute'), 'anon denied monotonic trigger function';
  assert not has_function_privilege('authenticated', 'public.kakao_reservation_ensure_monotonic_updated_at()', 'execute'), 'authenticated denied monotonic trigger function';
  assert has_function_privilege('service_role', 'public.kakao_reservation_ensure_monotonic_updated_at()', 'execute'), 'service_role granted monotonic trigger function';
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. SET LOCAL ROLE authenticated 로 INVOKER 트리거 정상 실행 실증 (Point 1)
-- PostgreSQL은 트리거 실행 시 트리거 함수의 EXECUTE 권한을 검사하지 않음을 실증.
-- authenticated 사용자가 reservations를 UPDATE할 때 kakao_reservation_ensure_monotonic_updated_at(INVOKER)가
-- 에러 없이 완벽히 실행됨을 확인.
-- ---------------------------------------------------------------------------
set local role authenticated;
update public.reservations set slot_id = 'slot_by_auth' where id = 'r1';
reset role;

rollback;
\echo 'PASS: local PostgreSQL trigger lifecycle, RPC contracts, rollback atomicity and grants'
