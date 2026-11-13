-- ============================================================================
-- 정규 고객 식별 원장 (Canonical Customers & Identities) 및 예약/상담/수신거부 연결
--
-- [운영 및 보안 가이드라인]
-- 1. 초안(Draft) — DB 직접 적용 금지. 본 파일은 설계 검증용 초안 상태이며, 운영 적용 시 별도 승인이 필요합니다.
-- 2. 개인정보 보호 철칙 (Privacy by Design)
--    - 전화번호 원문(phone_e164)과 SHA-256 해시(phone_sha256)를 함께 관리하며, 워크스페이스 내 해시 고유성을 보장합니다.
--    - anon/authenticated 역할의 직접 조회를 원천 차단(RLS & 권한 격리)하고 service_role 만 접근하도록 제어합니다.
-- 3. 하위 호환성 (Backward Compatibility)
--    - reservations, customer_conversations, customer_opt_outs 의 기존 컬럼과 RLS 정책은 전혀 건드리지 않고
--      신규 customer_uuid 및 phone_sha256 컬럼만 추가합니다.
-- 4. 멱등 백필 (Idempotent Backfill)
--    - 기존 reservations 중 11자리 010 휴대전화가 존재하는 행을 워크스페이스별로 단일 customer 로 집계하여 생성하고
--      reservations.customer_uuid 에 연결합니다.
-- ============================================================================

-- 1. public.customers 테이블 생성 ---------------------------------------------
create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  display_name text not null,
  phone_e164 text,
  phone_sha256 text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint customers_phone_pair_check check (
    (phone_e164 is null and phone_sha256 is null)
    or (phone_e164 is not null and phone_sha256 is not null)
  ),
  constraint customers_phone_e164_check check (
    phone_e164 is null or phone_e164 ~ '^\+8210\d{8}$'
  ),
  constraint customers_phone_sha256_check check (
    phone_sha256 is null or phone_sha256 ~ '^[0-9a-f]{64}$'
  )
);

-- 전화번호 고유성: 워크스페이스 내에서 phone_sha256 은 유일 (null 제외)
create unique index if not exists customers_workspace_phone_sha256_idx
  on public.customers (workspace_id, phone_sha256)
  where phone_sha256 is not null;

create index if not exists customers_workspace_id_idx
  on public.customers (workspace_id);

-- 2. public.customer_identities 테이블 생성 ------------------------------------
create table if not exists public.customer_identities (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  customer_id uuid not null references public.customers (id) on delete cascade,
  channel text not null check (channel in ('INSTAGRAM', 'THREADS', 'KAKAO', 'MANUAL')),
  subject_ref text not null,
  created_at timestamptz default now(),
  constraint customer_identities_unique_identity unique (workspace_id, channel, subject_ref)
);

create index if not exists customer_identities_customer_id_idx
  on public.customer_identities (customer_id);

-- 3. 기존 테이블 외래키 및 컬럼 추가 -------------------------------------------
-- reservations: customer_uuid 추가 (on delete set null)
alter table public.reservations
  add column if not exists customer_uuid uuid references public.customers (id) on delete set null;

create index if not exists idx_reservations_customer_uuid
  on public.reservations (customer_uuid);

-- customer_conversations: customer_uuid 추가 (on delete set null)
alter table public.customer_conversations
  add column if not exists customer_uuid uuid references public.customers (id) on delete set null;

create index if not exists idx_customer_conversations_customer_uuid
  on public.customer_conversations (customer_uuid);

-- customer_opt_outs: phone_sha256 추가 및 인덱스
alter table public.customer_opt_outs
  add column if not exists phone_sha256 text check (phone_sha256 is null or phone_sha256 ~ '^[0-9a-f]{64}$');

create index if not exists idx_customer_opt_outs_workspace_phone_sha256
  on public.customer_opt_outs (workspace_id, phone_sha256)
  where phone_sha256 is not null;

-- 4. RPC: upsert_customer_by_phone ------------------------------------------
create or replace function public.upsert_customer_by_phone(
  p_workspace_id uuid,
  p_display_name text,
  p_phone_e164 text,
  p_phone_sha256 text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_display_name text;
  v_customer_id uuid;
begin
  -- 1) 입력 유효성 검증 (실패 시 null 반환)
  if p_workspace_id is null or p_display_name is null or p_phone_e164 is null or p_phone_sha256 is null then
    return null;
  end if;

  v_display_name := trim(p_display_name);
  if char_length(v_display_name) < 1 or char_length(v_display_name) > 100 then
    return null;
  end if;

  if p_phone_e164 !~ '^\+8210\d{8}$' then
    return null;
  end if;

  if p_phone_sha256 !~ '^[0-9a-f]{64}$' then
    return null;
  end if;

  -- 2) Upsert 수행
  -- 충돌 시 updated_at만 갱신하며 기존 display_name 은 보존
  insert into public.customers (
    workspace_id,
    display_name,
    phone_e164,
    phone_sha256,
    created_at,
    updated_at
  )
  values (
    p_workspace_id,
    v_display_name,
    p_phone_e164,
    p_phone_sha256,
    statement_timestamp(),
    statement_timestamp()
  )
  on conflict (workspace_id, phone_sha256) where phone_sha256 is not null
  do update set updated_at = statement_timestamp()
  returning id into v_customer_id;

  return v_customer_id;
end;
$$;

revoke all on function public.upsert_customer_by_phone(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.upsert_customer_by_phone(uuid, text, text, text) to service_role;

-- 5. RLS 활성화 및 권한 격리 (service_role 전용) -------------------------------
alter table public.customers enable row level security;
revoke all on public.customers from public, anon, authenticated;
grant all on public.customers to service_role;
drop policy if exists "service role full access on customers" on public.customers;
create policy "service role full access on customers"
  on public.customers
  for all
  to service_role
  using (true)
  with check (true);

alter table public.customer_identities enable row level security;
revoke all on public.customer_identities from public, anon, authenticated;
grant all on public.customer_identities to service_role;
drop policy if exists "service role full access on customer_identities" on public.customer_identities;
create policy "service role full access on customer_identities"
  on public.customer_identities
  for all
  to service_role
  using (true)
  with check (true);

-- 6. 기존 예약 데이터 멱등 백필 -----------------------------------------------
-- 6-1. 전화번호가 있는 예약을 기반으로 customers 레코드 생성 (가장 최근 예약의 customer_name 사용)
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

-- 6-2. reservations.customer_uuid 채우기
update public.reservations r
set customer_uuid = c.id
from public.customers c
where r.customer_phone ~ '^010\d{8}$'
  and r.workspace_id is not null
  and c.workspace_id = r.workspace_id
  and c.phone_sha256 = encode(sha256(convert_to('+82' || substr(r.customer_phone, 2), 'UTF8')), 'hex')
  and (r.customer_uuid is null or r.customer_uuid is distinct from c.id);
