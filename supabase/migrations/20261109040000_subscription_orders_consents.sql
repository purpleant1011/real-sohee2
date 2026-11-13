-- 20261106040000_subscription_orders_consents.sql
-- 구독 주문·동의·웹훅 이벤트 원장 (운영 DB 미적용 상태, 파일 정의만 포함)
-- 금지 제약 준수: 민감 결제 인증정보 및 키 원문 컬럼 저장 금지
-- 권한 제약 준수: anon/authenticated 쓰기 grant 없음 (revoke all 후 select 전용 정책만 부여)

-- 1. 구독 주문 테이블
create table if not exists public.subscription_orders (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  offer_code text not null check (offer_code in ('STARTER_150K', 'GROWTH_300K', 'SCALE_500K')),
  amount_krw integer not null check (amount_krw in (150000, 300000, 500000)),
  currency text not null check (currency = 'KRW'),
  status text not null check (status in ('created', 'payment_pending', 'paid', 'cancelled', 'failed')),
  idempotency_key text not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint subscription_orders_workspace_idempotency_uniq unique (workspace_id, idempotency_key)
);

create index if not exists subscription_orders_workspace_idx
  on public.subscription_orders (workspace_id, created_at desc);

-- 2. 구독 동의 기록 테이블 (필수 3종 및 마케팅 동의 버전/시각 보관)
create table if not exists public.subscription_consents (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.subscription_orders(id) on delete cascade,
  kind text not null check (kind in ('terms', 'privacy', 'refund_auto_renewal', 'marketing')),
  policy_version text not null,
  accepted_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint subscription_consents_order_kind_uniq unique (order_id, kind)
);

create index if not exists subscription_consents_order_idx
  on public.subscription_consents (order_id);

-- 3. 구독 웹훅 수신 이벤트 테이블 (제공사 이벤트 중복 방지 및 멱등 추적)
create table if not exists public.subscription_webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider_event_id text not null unique,
  order_id uuid references public.subscription_orders(id) on delete set null,
  received_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists subscription_webhook_events_order_idx
  on public.subscription_webhook_events (order_id);

-- 4. Row Level Security 활성화 (3개 테이블 전원)
alter table public.subscription_orders enable row level security;
alter table public.subscription_consents enable row level security;
alter table public.subscription_webhook_events enable row level security;

-- 5. 기본 권한 완전 회수 (public, anon, authenticated 쓰기 권한 전면 차단)
revoke all on table public.subscription_orders from public, anon, authenticated;
revoke all on table public.subscription_consents from public, anon, authenticated;
revoke all on table public.subscription_webhook_events from public, anon, authenticated;

-- 6. 읽기 권한(select)만 authenticated 에 부여
grant select on table public.subscription_orders to authenticated;
grant select on table public.subscription_consents to authenticated;
grant select on table public.subscription_webhook_events to authenticated;

-- 7. 백엔드 처리(service_role) 전용 전체 권한 부여
grant select, insert, update, delete on table public.subscription_orders to service_role;
grant select, insert, update, delete on table public.subscription_consents to service_role;
grant select, insert, update, delete on table public.subscription_webhook_events to service_role;

-- 8. RLS 정책: 워크스페이스 멤버만 자신의 주문 및 동의, 연계 웹훅 조회 가능
create policy subscription_orders_select_member on public.subscription_orders
  for select to authenticated
  using ((select private.is_workspace_member(workspace_id)));

create policy subscription_consents_select_member on public.subscription_consents
  for select to authenticated
  using (
    exists (
      select 1
      from public.subscription_orders o
      where o.id = subscription_consents.order_id
        and (select private.is_workspace_member(o.workspace_id))
    )
  );

create policy subscription_webhook_events_select_member on public.subscription_webhook_events
  for select to authenticated
  using (
    order_id is not null
    and exists (
      select 1
      from public.subscription_orders o
      where o.id = subscription_webhook_events.order_id
        and (select private.is_workspace_member(o.workspace_id))
    )
  );
