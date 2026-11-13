-- ============================================================================
-- Migration: 20261023120000_schema_drift_pii_optout_closure.sql
-- Description: 스키마–코드 드리프트 폐쇄 (A그룹: 개인정보·수신거부)
--   감사: docs/harness/SCHEMA-CODE-DRIFT-AUDIT-2026-10-23.md (T1, C2, C3)
--
--   1. customer_opt_outs 테이블 신설
--      - 코드가 customer_opt_outs 를 조회/upsert 하는데 어떤 마이그레이션에도 없었다.
--        수신거부 가드(responsive-employee-loop)와 삭제 요청 원장이 이 테이블에 의존한다.
--   2. customer_conversations 익명화 컬럼 추가
--      - customer-data-retention-lineage 가 content/customer_name/is_anonymized/anonymized_at/
--        customer_id 를 update 하는데 스키마에 없어 PII 익명화가 조용히 실패했다.
--   3. reservations PII 마스킹 컬럼 추가
--      - customer_email/pii_redacted/anonymized_at 이 없어 예약 PII 마스킹이 실패했다.
--
-- 원칙: 추가형(additive)만. CREATE TABLE IF NOT EXISTS / ADD COLUMN IF NOT EXISTS.
--       DML·백필·기존 컬럼 변경 없음. 되돌리려면 아래 ROLLBACK 블록을 별도 실행한다.
-- ============================================================================

-- 1. 수신거부(Opt-out) / 삭제 요청 원장 --------------------------------------
create table if not exists public.customer_opt_outs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  customer_id text not null check (char_length(customer_id) between 1 and 200),
  deletion_request_id text,
  reason text,
  source text not null default 'customer_request'
    check (source in ('customer_request', 'manual', 'provider_webhook', 'legal')),
  opted_out_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint customer_opt_outs_workspace_customer_key unique (workspace_id, customer_id)
);

create index if not exists idx_customer_opt_outs_workspace
  on public.customer_opt_outs (workspace_id, opted_out_at desc);

alter table public.customer_opt_outs enable row level security;

-- 테넌트 격리: 워크스페이스 구성원만 자기 워크스페이스 행을 읽고 쓸 수 있다.
drop policy if exists customer_opt_outs_workspace_isolation on public.customer_opt_outs;
create policy customer_opt_outs_workspace_isolation
  on public.customer_opt_outs
  for all
  to authenticated
  using (
    workspace_id in (
      select workspace_id from public.workspace_members
      where user_id = auth.uid()
    )
  )
  with check (
    workspace_id in (
      select workspace_id from public.workspace_members
      where user_id = auth.uid()
    )
  );

-- service_role 은 서버 경로(웹훅·배치)에서 사용한다.
grant select, insert, update, delete on public.customer_opt_outs to service_role;

-- 2. 상담 대화 익명화 컬럼 ------------------------------------------------
alter table public.customer_conversations
  add column if not exists customer_id text,
  add column if not exists content text,
  add column if not exists customer_name text,
  add column if not exists is_anonymized boolean not null default false,
  add column if not exists anonymized_at timestamptz;

create index if not exists idx_customer_conversations_workspace_customer
  on public.customer_conversations (workspace_id, customer_id)
  where customer_id is not null;

-- 3. 예약 PII 마스킹 컬럼 -------------------------------------------------
alter table public.reservations
  add column if not exists customer_email text,
  add column if not exists pii_redacted boolean not null default false,
  add column if not exists anonymized_at timestamptz;

-- ============================================================================
-- ROLLBACK (별도 실행, 자동 적용 아님)
--   drop table if exists public.customer_opt_outs;
--   alter table public.customer_conversations
--     drop column if exists customer_id,
--     drop column if exists content,
--     drop column if exists customer_name,
--     drop column if exists is_anonymized,
--     drop column if exists anonymized_at;
--   alter table public.reservations
--     drop column if exists customer_email,
--     drop column if exists pii_redacted,
--     drop column if exists anonymized_at;
-- ============================================================================
