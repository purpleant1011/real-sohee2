-- 알림톡 발송 원장 (Kakao Alimtalk Ledger)
-- 멱등키(idempotency_key)당 단일 레코드, 상태 전이 이력 및 솔라피 messageId 추적.
-- 개인정보 보호 철칙: 수신자 전화번호 원문 컬럼 금지(phone_last4만 저장).
-- 초안(Draft) — DB 직접 적용 금지.

create table public.kakao_alimtalk_ledger (
  idempotency_key text primary key,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  booking_id text not null,
  event text not null,
  template_code text not null,
  phone_last4 text not null check (phone_last4 ~ '^[0-9]{4}$'),
  status text not null check (status in ('PENDING', 'SENT', 'DELIVERED', 'FAILED', 'REJECTED', 'DRY_RUN')),
  provider_message_id text unique,
  error text,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp()
);

-- 인덱스: provider_message_id(솔라피 DLR 웹훅 수신 시 빠른 역조회), workspace_id(워크스페이스별 이력 조회)
create index kakao_alimtalk_ledger_workspace_created_idx
  on public.kakao_alimtalk_ledger (workspace_id, created_at desc);

create index kakao_alimtalk_ledger_provider_message_idx
  on public.kakao_alimtalk_ledger (provider_message_id)
  where provider_message_id is not null;

-- RLS 활성화 및 service_role 전용 정책
alter table public.kakao_alimtalk_ledger enable row level security;

revoke all on public.kakao_alimtalk_ledger from public, anon, authenticated;
grant all on public.kakao_alimtalk_ledger to service_role;

create policy "service role full access on kakao_alimtalk_ledger"
  on public.kakao_alimtalk_ledger
  for all
  to service_role
  using (true)
  with check (true);
