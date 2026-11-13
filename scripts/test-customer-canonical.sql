-- ============================================================================
-- 정규 고객 식별 원장(Customer Canonical) 단위 및 계약 검증 테스트
-- 임시 로컬 PostgreSQL 전용. 운영/공유 DB에서 절대 실행 금지.
--
-- 실행 방법:
-- LC_ALL=C psql -X -v ON_ERROR_STOP=1 -h <소켓경로> -p <포트> -U postgres -d postgres -f scripts/test-customer-canonical.sql
-- ============================================================================
\set ON_ERROR_STOP on
begin;

-- 0. 사전 역할 및 기본 테이블 Fixture 셋업 --------------------------------------
do $$
begin
  if not exists (select from pg_roles where rolname = 'anon') then create role anon; end if;
  if not exists (select from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  if not exists (select from pg_roles where rolname = 'service_role') then create role service_role; end if;
end
$$;

create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid()
);

create table if not exists public.reservations (
  id text primary key,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  slot_id text not null,
  customer_id text not null default 'cust_default',
  customer_name text not null default '고객님',
  customer_phone text,
  status text not null default 'CONFIRMED',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.customer_conversations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  channel text not null,
  external_subject_reference_hash text not null,
  display_label text not null,
  status text not null default 'open',
  summary text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.customer_opt_outs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  customer_id text not null,
  reason text,
  opted_out_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint customer_opt_outs_workspace_customer_key unique (workspace_id, customer_id)
);

-- 백필 검증을 위한 사전 예약 데이터 적재
insert into public.workspaces (id) values ('00000000-0000-4000-a000-000000000001');
insert into public.workspaces (id) values ('00000000-0000-4000-a000-000000000002');

-- 워크스페이스 1: 동일 번호 2건 (오래된 것: '옛날이름', 최신 것: '최신이름')
insert into public.reservations (id, workspace_id, slot_id, customer_name, customer_phone, created_at)
values
  ('r1_old', '00000000-0000-4000-a000-000000000001', 's1', '옛날이름', '01011112222', now() - interval '2 days'),
  ('r1_new', '00000000-0000-4000-a000-000000000001', 's2', '최신이름', '01011112222', now() - interval '1 hour');

-- 워크스페이스 1: 전화번호 없는 예약
insert into public.reservations (id, workspace_id, slot_id, customer_name, customer_phone, created_at)
values
  ('r_no_phone', '00000000-0000-4000-a000-000000000001', 's3', '번호없음', null, now());

-- 워크스페이스 1: 비정상 번호 (10자리 또는 02 국번)
insert into public.reservations (id, workspace_id, slot_id, customer_name, customer_phone, created_at)
values
  ('r_invalid_phone', '00000000-0000-4000-a000-000000000001', 's4', '비정상번호', '0101234567', now());

-- 워크스페이스 2: 워크스페이스 1과 동일 번호 예약 (테넌트 격리 확인용)
insert into public.reservations (id, workspace_id, slot_id, customer_name, customer_phone, created_at)
values
  ('r2_w2', '00000000-0000-4000-a000-000000000002', 's5', '테넌트2고객', '01011112222', now());

-- 1. 마이그레이션 적용 ---------------------------------------------------------
\ir ../supabase/migrations/20261109030000_customer_canonical.sql

-- 2. 마이그레이션 직후 상태 및 백필 결과 검증 -----------------------------------
do $$
declare
  v_c1_id uuid;
  v_c2_id uuid;
  v_r1_old_cid uuid;
  v_r1_new_cid uuid;
  v_r_no_phone_cid uuid;
  v_r_invalid_cid uuid;
  v_c1_name text;
begin
  -- 1) 백필 결과: 워크스페이스 1에서 01011112222는 1행만 생성되어야 함
  assert (select count(*) from public.customers where workspace_id = '00000000-0000-4000-a000-000000000001') = 1,
    'Backfill: Workspace 1 must have exactly 1 canonical customer';

  select id, display_name into v_c1_id, v_c1_name
  from public.customers
  where workspace_id = '00000000-0000-4000-a000-000000000001';

  -- display_name 은 가장 최근 예약의 customer_name ('최신이름') 이어야 함
  assert v_c1_name = '최신이름',
    'Backfill: Display name must match the latest reservation name';

  -- reservations 의 customer_uuid 가 올바르게 매핑되었는지 확인
  select customer_uuid into v_r1_old_cid from public.reservations where id = 'r1_old';
  select customer_uuid into v_r1_new_cid from public.reservations where id = 'r1_new';
  select customer_uuid into v_r_no_phone_cid from public.reservations where id = 'r_no_phone';
  select customer_uuid into v_r_invalid_cid from public.reservations where id = 'r_invalid_phone';

  assert v_r1_old_cid = v_c1_id, 'Backfill: r1_old customer_uuid matches c1';
  assert v_r1_new_cid = v_c1_id, 'Backfill: r1_new customer_uuid matches c1';
  assert v_r_no_phone_cid is null, 'Backfill: r_no_phone customer_uuid must be null';
  assert v_r_invalid_cid is null, 'Backfill: r_invalid_phone customer_uuid must be null';

  -- 워크스페이스 2의 테넌트 분리 확인
  assert (select count(*) from public.customers where workspace_id = '00000000-0000-4000-a000-000000000002') = 1,
    'Backfill: Workspace 2 must have exactly 1 canonical customer';

  select id into v_c2_id
  from public.customers
  where workspace_id = '00000000-0000-4000-a000-000000000002';

  assert v_c1_id <> v_c2_id,
    'Backfill: Customers across workspaces must have distinct IDs even with same phone';
end;
$$;

-- 3. 백필 멱등성 재실행 검증 ----------------------------------------------------
-- 마이그레이션 백필 쿼리를 한 번 더 실행했을 때 데이터 오염이나 중복이 없어야 함
with ranked_reservations as (
  select
    r.workspace_id,
    '+82' || substr(r.customer_phone, 2) as calc_phone_e164,
    encode(sha256(convert_to('+82' || substr(r.customer_phone, 2), 'UTF8')), 'hex') as calc_phone_sha256,
    coalesce(nullif(trim(r.customer_name), ''), '고객님') as resolved_name,
    row_number() over (
      partition by r.workspace_id, encode(sha256(convert_to('+82' || substr(r.customer_phone, 2), 'UTF8')), 'hex')
      order by r.created_at desc, r.id desc
    ) as rn
  from public.reservations r
  where r.customer_phone ~ '^010\d{8}$'
    and r.workspace_id is not null
)
insert into public.customers (
  workspace_id,
  display_name,
  phone_e164,
  phone_sha256,
  created_at,
  updated_at
)
select
  workspace_id,
  resolved_name,
  calc_phone_e164,
  calc_phone_sha256,
  statement_timestamp(),
  statement_timestamp()
from ranked_reservations
where rn = 1
on conflict (workspace_id, phone_sha256) where phone_sha256 is not null
do nothing;

update public.reservations r
set customer_uuid = c.id
from public.customers c
where r.customer_phone ~ '^010\d{8}$'
  and r.workspace_id is not null
  and c.workspace_id = r.workspace_id
  and c.phone_sha256 = encode(sha256(convert_to('+82' || substr(r.customer_phone, 2), 'UTF8')), 'hex')
  and (r.customer_uuid is null or r.customer_uuid is distinct from c.id);

do $$
begin
  assert (select count(*) from public.customers) = 2,
    'Idempotency: Re-running backfill must not create duplicate customers';
end;
$$;

-- 4. 테이블 제약조건 및 유니크 인덱스 검증 ---------------------------------------
do $$
declare
  w uuid := '00000000-0000-4000-a000-000000000001';
  valid_e164 text := '+821098765432';
  valid_sha text := encode(sha256(convert_to('+821098765432', 'UTF8')), 'hex');
  v_test_cid uuid;
begin
  -- 1) customers: phone_e164와 phone_sha256 페어 검증 (둘 다 null 가능)
  insert into public.customers (workspace_id, display_name, phone_e164, phone_sha256)
  values (w, '익명고객', null, null)
  returning id into v_test_cid;
  assert v_test_cid is not null, 'customers allows both phone fields null';

  -- 2) customers: phone_e164만 있고 sha256은 null인 경우 실패해야 함
  begin
    insert into public.customers (workspace_id, display_name, phone_e164, phone_sha256)
    values (w, '실패고객1', valid_e164, null);
    raise exception 'Expected check violation on phone_pair (phone_sha256 null)';
  exception when check_violation then
    -- 정상 거부 확인
  end;

  -- 3) customers: sha256만 있고 e164는 null인 경우 실패해야 함
  begin
    insert into public.customers (workspace_id, display_name, phone_e164, phone_sha256)
    values (w, '실패고객2', null, valid_sha);
    raise exception 'Expected check violation on phone_pair (phone_e164 null)';
  exception when check_violation then
    -- 정상 거부 확인
  end;

  -- 4) customers: 잘못된 e164 포맷 거부
  begin
    insert into public.customers (workspace_id, display_name, phone_e164, phone_sha256)
    values (w, '잘못된번호', '01098765432', valid_sha);
    raise exception 'Expected check violation on phone_e164 format';
  exception when check_violation then
    -- 정상 거부 확인
  end;

  -- 5) customers: 잘못된 sha256 포맷 거부 (길이 63)
  begin
    insert into public.customers (workspace_id, display_name, phone_e164, phone_sha256)
    values (w, '잘못된해시', valid_e164, 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef123456789');
    raise exception 'Expected check violation on phone_sha256 format';
  exception when check_violation then
    -- 정상 거부 확인
  end;

  -- 6) customers: 동일 워크스페이스 내 중복 번호 해시 유니크 제약 거부
  insert into public.customers (workspace_id, display_name, phone_e164, phone_sha256)
  values (w, '정상고객A', valid_e164, valid_sha)
  returning id into v_test_cid;

  begin
    insert into public.customers (workspace_id, display_name, phone_e164, phone_sha256)
    values (w, '중복고객', valid_e164, valid_sha);
    raise exception 'Expected unique violation on (workspace_id, phone_sha256)';
  exception when unique_violation then
    -- 정상 거부 확인
  end;

  -- 7) customer_identities: 올바른 채널 삽입 및 중복 (workspace_id, channel, subject_ref) 거부
  insert into public.customer_identities (workspace_id, customer_id, channel, subject_ref)
  values (w, v_test_cid, 'KAKAO', 'kakao_user_123');

  begin
    insert into public.customer_identities (workspace_id, customer_id, channel, subject_ref)
    values (w, v_test_cid, 'KAKAO', 'kakao_user_123');
    raise exception 'Expected unique violation on customer_identities';
  exception when unique_violation then
    -- 정상 거부 확인
  end;

  -- 잘못된 채널 ('FACEBOOK') 거부 확인
  begin
    insert into public.customer_identities (workspace_id, customer_id, channel, subject_ref)
    values (w, v_test_cid, 'FACEBOOK', 'fb_user_123');
    raise exception 'Expected check violation on channel in customer_identities';
  exception when check_violation then
    -- 정상 거부 확인
  end;

  -- 8) customer 삭제 시 identities cascade 및 reservations set null 검증
  insert into public.reservations (id, workspace_id, slot_id, customer_name, customer_phone, customer_uuid)
  values ('r_test_fk', w, 's_fk', '참조테스트', valid_e164, v_test_cid);

  delete from public.customers where id = v_test_cid;

  -- identities 는 삭제(cascade)되었어야 함
  assert (select count(*) from public.customer_identities where subject_ref = 'kakao_user_123') = 0,
    'customer_identities cascade delete on customer delete';

  -- reservations.customer_uuid 는 set null 되었어야 함
  assert (select customer_uuid is null from public.reservations where id = 'r_test_fk'),
    'reservations.customer_uuid set null on customer delete';

  -- 9) customer_opt_outs: phone_sha256 정규식 체크 검증
  begin
    insert into public.customer_opt_outs (workspace_id, customer_id, phone_sha256)
    values (w, 'opt_user_1', 'bad_sha');
    raise exception 'Expected check violation on customer_opt_outs.phone_sha256';
  exception when check_violation then
    -- 정상 거부 확인
  end;

  insert into public.customer_opt_outs (workspace_id, customer_id, phone_sha256)
  values (w, 'opt_user_1', valid_sha);
  assert (select count(*) from public.customer_opt_outs where customer_id = 'opt_user_1') = 1,
    'customer_opt_outs valid phone_sha256 inserted';
end;
$$;

-- 5. RPC public.upsert_customer_by_phone 검증 ---------------------------------
do $$
declare
  w uuid := '00000000-0000-4000-a000-000000000001';
  e164 text := '+821055556666';
  sha text := encode(sha256(convert_to('+821055556666', 'UTF8')), 'hex');
  cid1 uuid;
  cid2 uuid;
  res_name text;
  null_res uuid;
begin
  -- 1) 신규 고객 upsert 성공 및 ID 반환
  cid1 := public.upsert_customer_by_phone(w, '홍길동', e164, sha);
  assert cid1 is not null, 'RPC must return non-null uuid on new customer insert';

  -- 2) 동일 번호 재호출 시 기존과 동일한 ID 반환 및 기존 display_name 유지 검증
  cid2 := public.upsert_customer_by_phone(w, '변경된이름', e164, sha);
  assert cid2 = cid1, 'RPC must return the same uuid on subsequent calls for same phone';

  select display_name into res_name from public.customers where id = cid1;
  assert res_name = '홍길동', 'RPC must preserve original display_name on conflict';

  -- 3) 잘못된 입력에 대해 null 반환 검증
  -- (a) workspace_id is null
  null_res := public.upsert_customer_by_phone(null, '홍길동', e164, sha);
  assert null_res is null, 'RPC must return null on null workspace_id';

  -- (b) display_name 빈값 / 공백만 있음
  null_res := public.upsert_customer_by_phone(w, '   ', e164, sha);
  assert null_res is null, 'RPC must return null on empty/whitespace display_name';

  -- (c) display_name 100자 초과
  null_res := public.upsert_customer_by_phone(w, repeat('A', 101), e164, sha);
  assert null_res is null, 'RPC must return null on display_name > 100 chars';

  -- (d) 잘못된 e164 포맷
  null_res := public.upsert_customer_by_phone(w, '홍길동', '01055556666', sha);
  assert null_res is null, 'RPC must return null on invalid e164';

  -- (e) 잘못된 sha256 포맷
  null_res := public.upsert_customer_by_phone(w, '홍길동', e164, 'bad_sha');
  assert null_res is null, 'RPC must return null on invalid sha256';
end;
$$;

-- 6. RLS 및 권한 격리 검증 -----------------------------------------------------
-- 6-1. anon 역할: 테이블 접근 거부 및 RPC 실행 거부
set role anon;

do $$
begin
  begin
    perform * from public.customers;
    raise exception 'anon must NOT be able to select from customers';
  exception when insufficient_privilege then
    -- 정상 거부
  end;

  begin
    perform * from public.customer_identities;
    raise exception 'anon must NOT be able to select from customer_identities';
  exception when insufficient_privilege then
    -- 정상 거부
  end;

  begin
    perform public.upsert_customer_by_phone(
      '00000000-0000-4000-a000-000000000001',
      '익명공격',
      '+821099998888',
      encode(sha256(convert_to('+821099998888', 'UTF8')), 'hex')
    );
    raise exception 'anon must NOT be able to execute upsert_customer_by_phone';
  exception when insufficient_privilege then
    -- 정상 거부
  end;
end;
$$;

-- 6-2. authenticated 역할: 테이블 접근 거부 및 RPC 실행 거부
set role authenticated;

do $$
begin
  begin
    perform * from public.customers;
    raise exception 'authenticated must NOT be able to select from customers';
  exception when insufficient_privilege then
    -- 정상 거부
  end;

  begin
    perform * from public.customer_identities;
    raise exception 'authenticated must NOT be able to select from customer_identities';
  exception when insufficient_privilege then
    -- 정상 거부
  end;

  begin
    perform public.upsert_customer_by_phone(
      '00000000-0000-4000-a000-000000000001',
      '인증사용자공격',
      '+821099998888',
      encode(sha256(convert_to('+821099998888', 'UTF8')), 'hex')
    );
    raise exception 'authenticated must NOT be able to execute upsert_customer_by_phone';
  exception when insufficient_privilege then
    -- 정상 거부
  end;
end;
$$;

-- 6-3. service_role 역할: 테이블 접근 허용 및 RPC 실행 허용
set role service_role;

do $$
declare
  w uuid := '00000000-0000-4000-a000-000000000001';
  e164 text := '+821099998888';
  sha text := encode(sha256(convert_to('+821099998888', 'UTF8')), 'hex');
  cid uuid;
begin
  -- 테이블 조회 가능 확인
  perform count(*) from public.customers;
  perform count(*) from public.customer_identities;

  -- RPC 실행 가능 확인
  cid := public.upsert_customer_by_phone(w, '서비스롤고객', e164, sha);
  assert cid is not null, 'service_role must be able to execute upsert_customer_by_phone';
end;
$$;

-- postgres 수퍼유저로 복원
reset role;

-- 검증 완료: 변경사항 롤백
rollback;
