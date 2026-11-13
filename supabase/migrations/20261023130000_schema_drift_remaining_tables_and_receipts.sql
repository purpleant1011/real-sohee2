-- ============================================================================
-- Migration: 20261023130000_schema_drift_remaining_tables_and_receipts.sql
-- Description: 스키마–코드 드리프트 잔여분 폐쇄 (ANI-1758)
--   감사: docs/harness/SCHEMA-CODE-DRIFT-AUDIT-2026-10-23.md
--   게이트: scripts/verify-schema-code-drift.mjs
--
--   이 마이그레이션은 "코드가 실제로 쓰는 컬럼"만 담는다. 감사 문서 초안에서
--   코드에 등장하지 않는 별칭 컬럼은 제외했다(추측으로 스키마를 부풀리지 않는다).
--
--   1. external_action_receipts: 구세대 코드가 쓰는 27개 컬럼
--      - 정본 컬럼은 receipt_kind / recorded_at / observed_payload / result_url / provider_reference.
--      - 아래 별칭들은 레거시 호출부가 계속 쓰고 있어 400 을 막기 위해 추가한다.
--        근본 수정은 코드를 정본으로 되돌리는 것이며, 그때 이 컬럼들은 비게 된다.
--   2. 없는 테이블 6종: workspace_onboarding_gates / workspace_onboarding_missions /
--      agent_execution_receipts / agent_energy_reservations / browser_tasks / provider_observed_media
--      - 모두 RLS ON + 테넌트 격리 정책 + service_role grant.
--   3. social_attribution_events: 고객 삭제(익명화) 연쇄용 customer_id / anonymized_at
--      - 코드가 attribution_events 라는 없는 테이블을 쓰고 있었다. 정본 이름으로 고쳤고,
--        익명화 update 가 성립하도록 두 컬럼을 추가한다.
--
-- 원칙: 추가형(additive)만. CREATE TABLE IF NOT EXISTS / ADD COLUMN IF NOT EXISTS.
--       DML·백필·기존 컬럼 변경 없음.
-- ============================================================================

-- 1. external_action_receipts: 레거시 코드가 쓰는 컬럼 ----------------------
alter table public.external_action_receipts
  add column if not exists channel text,
  add column if not exists channel_id text,
  add column if not exists action_kind text,
  add column if not exists action_type text,
  add column if not exists status text,
  add column if not exists receipt_status text,
  add column if not exists state text,
  add column if not exists reconcile_state text,
  add column if not exists external_id text,
  add column if not exists external_url text,
  add column if not exists provider_post_url text,
  add column if not exists verification_method text,
  add column if not exists verified boolean,
  add column if not exists verified_at timestamptz,
  add column if not exists evidence_maturity text,
  add column if not exists evidence_details jsonb,
  add column if not exists payload jsonb,
  add column if not exists raw_response jsonb,
  add column if not exists additional_evidence jsonb,
  add column if not exists request_id text,
  add column if not exists request_payload_digest text,
  add column if not exists idempotency_key text,
  add column if not exists schedule_id uuid,
  add column if not exists bundle_id uuid,
  add column if not exists observed_at timestamptz,
  add column if not exists finalized_at timestamptz,
  add column if not exists created_at timestamptz not null default now();

-- 레거시 호출부가 created_at / observed_at 으로 정렬한다.
create index if not exists idx_external_action_receipts_created_at
  on public.external_action_receipts (workspace_id, created_at desc);

-- 2. 없는 테이블 6종 -------------------------------------------------------

-- 2-1. 온보딩 게이트 (onboarding-flow.tsx)
create table if not exists public.workspace_onboarding_gates (
  workspace_id uuid primary key references public.workspaces (id) on delete cascade,
  onboarding_completed boolean not null default false,
  completed_at timestamptz,
  proof_id text,
  draft_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 2-2. 온보딩 첫 미션 상태 (first-mission-runner.ts)
create table if not exists public.workspace_onboarding_missions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  mission_id text not null,
  status text not null default 'PENDING',
  proposal_id text,
  proof_id text,
  proof_digest text,
  draft_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workspace_onboarding_missions_workspace_mission_key unique (workspace_id, mission_id)
);

-- 2-3. 에이전트 실행 영수증 (external-verification-engine.ts)
create table if not exists public.agent_execution_receipts (
  receipt_id text primary key,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  action_type text not null,
  channel text,
  status text not null,
  external_url text,
  provider_object_id text,
  content_fingerprint text,
  verification_method text,
  verified_at timestamptz,
  created_at timestamptz not null default now()
);

-- 2-4. 에이전트 에너지 예약 (agent/energy/reserve route)
create table if not exists public.agent_energy_reservations (
  reservation_id text primary key,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  run_id text,
  action_type text not null,
  amount integer not null check (amount >= 0),
  status text not null default 'ACTIVE',
  created_at timestamptz not null default now(),
  released_at timestamptz
);

-- 2-5. 브라우저 위임 작업 (browser-task-contract.ts)
create table if not exists public.browser_tasks (
  task_id text primary key,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  channel text not null,
  session_ref text,
  action_run_id text,
  target_url text,
  operation text not null,
  state text not null,
  evidence jsonb not null default '{}'::jsonb,
  payload jsonb not null default '{}'::jsonb,
  retry_count integer not null default 0,
  error_code text,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 2-6. 프로바이더가 관측한 미디어 (admin-truth-snapshot-service.ts)
create table if not exists public.provider_observed_media (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  provider text not null,
  provider_media_id text not null,
  observed_payload jsonb not null default '{}'::jsonb,
  observed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint provider_observed_media_provider_key unique (workspace_id, provider, provider_media_id)
);

-- 3. social_attribution_events: 고객 삭제 익명화 연쇄 ----------------
alter table public.social_attribution_events
  add column if not exists customer_id text,
  add column if not exists anonymized_at timestamptz;

create index if not exists idx_social_attribution_events_workspace_customer
  on public.social_attribution_events (workspace_id, customer_id)
  where customer_id is not null;

-- 4. RLS + 테넌트 격리 정책 + service_role grant ---------------------------
do $$
declare
  target text;
begin
  foreach target in array array[
    'workspace_onboarding_gates',
    'workspace_onboarding_missions',
    'agent_execution_receipts',
    'agent_energy_reservations',
    'browser_tasks',
    'provider_observed_media'
  ]
  loop
    execute format('alter table public.%I enable row level security', target);
    execute format('grant select, insert, update, delete on public.%I to service_role', target);
    execute format('drop policy if exists %I on public.%I', target || '_workspace_isolation', target);
    execute format(
      'create policy %I on public.%I for all to authenticated '
      'using (workspace_id in (select workspace_id from public.workspace_members where user_id = auth.uid())) '
      'with check (workspace_id in (select workspace_id from public.workspace_members where user_id = auth.uid()))',
      target || '_workspace_isolation', target
    );
  end loop;
end $$;

-- ============================================================================
-- ROLLBACK (별도 실행, 자동 적용 아님)
--   drop table if exists public.workspace_onboarding_gates;
--   drop table if exists public.workspace_onboarding_missions;
--   drop table if exists public.agent_execution_receipts;
--   drop table if exists public.agent_energy_reservations;
--   drop table if exists public.browser_tasks;
--   drop table if exists public.provider_observed_media;
--   alter table public.social_attribution_events
--     drop column if exists customer_id, drop column if exists anonymized_at;
--   alter table public.external_action_receipts
--     drop column if exists channel, drop column if exists channel_id,
--     drop column if exists action_kind, drop column if exists action_type,
--     drop column if exists status, drop column if exists receipt_status,
--     drop column if exists state, drop column if exists reconcile_state,
--     drop column if exists external_id, drop column if exists external_url,
--     drop column if exists provider_post_url, drop column if exists verification_method,
--     drop column if exists verified, drop column if exists verified_at,
--     drop column if exists evidence_maturity, drop column if exists evidence_details,
--     drop column if exists payload, drop column if exists raw_response,
--     drop column if exists additional_evidence, drop column if exists request_id,
--     drop column if exists request_payload_digest, drop column if exists idempotency_key,
--     drop column if exists schedule_id, drop column if exists bundle_id,
--     drop column if exists observed_at, drop column if exists finalized_at,
--     drop column if exists created_at;
-- ============================================================================
