-- ============================================================================
-- Migration: 20261023120100_schema_drift_external_action_request_columns.sql
-- Description: 스키마–코드 드리프트 폐쇄 (B그룹: 첫 발행 승인 500)
--   감사: docs/harness/SCHEMA-CODE-DRIFT-AUDIT-2026-10-23.md (C1)
--
--   first-wow-approve 라우트가 external_action_requests 에 action_type/target_channel 을
--   넣어 insert 하는데 스키마에 그 컬럼이 없어 PostgREST 가 400 을 돌려주고, 라우트가
--   에러를 검사해 500 을 반환했다(온보딩 첫 발행 승인 불가).
--
-- 원칙: 추가형(additive)만. ADD COLUMN IF NOT EXISTS. DML·백필·기존 컬럼 변경 없음.
--       기존 정본 컬럼(action_kind/target_external_id)은 그대로 둔다.
-- ============================================================================

alter table public.external_action_requests
  add column if not exists action_type text,
  add column if not exists target_channel text;

comment on column public.external_action_requests.action_type is
  '레거시 코드(first-wow-approve)가 쓰는 동작 유형. 정본은 action_kind.';
comment on column public.external_action_requests.target_channel is
  '레거시 코드(first-wow-approve)가 쓰는 대상 채널. 정본은 channel.';

-- ============================================================================
-- ROLLBACK (별도 실행, 자동 적용 아님)
--   alter table public.external_action_requests
--     drop column if exists action_type,
--     drop column if exists target_channel;
-- ============================================================================
