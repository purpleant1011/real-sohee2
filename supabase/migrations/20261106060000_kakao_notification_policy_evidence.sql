-- ============================================================================
-- 알림톡 정보성 발송 근거(Evidence) 및 템플릿 심사 승인 원장 (Policy Evidence)
--
-- [운영 및 보안 가이드라인]
-- 1. 초안(Draft) — DB 직접 적용 금지. 본 파일은 설계 검증용 초안(미적용 상태)이며,
--    운영 적용 시 별도 승인이 필요합니다 (Pending explicit operational approval).
-- 2. live 자동 시작 아님 — 마이그레이션이 작성되더라도 자동으로 live 적용되거나 실행되지 않습니다.
-- 3. 개인정보 보호 철칙 (Privacy by Design):
--    - raw phone, customer name, 원문 텍스트 컬럼 저장을 원천 금지합니다.
--    - subject_phone_sha256의 SHA256 해시는 KISA/개인정보보호법상 비식별/익명화(anonymization)가 아니며,
--      원장 조회 시 교차 테넌트 오발송 및 타인 번호 결합을 차단하기 위한 권한 격리 보조(authorization isolation auxiliary) 수단입니다.
-- 4. 템플릿 승인 원칙:
--    - kakao_template_approvals 테이블에 행이 존재한다는 사실 자체만으로 발송이 승인되는 것이 아닙니다.
--    - 카카오 비즈메시지 콘솔 및 솔라피 API를 통해 실제 심사 승인된 증거(evidence_ref)를 운영자가 사후 검증하여 기록해야 합니다.
-- 5. 권한 격리:
--    - 본 테이블들은 service_role 전용이며 public, anon, authenticated의 모든 접근은 원천 차단(revoke)됩니다.
-- ============================================================================

-- 1. 정보성 알림 수신 근거 원장 테이블 -----------------------------------------
-- 예약 생성/확정 시점의 정보성 알림 발송 근거를 기록합니다.
-- raw phone, customer name 저장은 엄격히 금지됩니다.
create table public.kakao_notification_evidence (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  reservation_id text not null references public.reservations (id) on delete cascade,
  -- 주의: SHA256은 익명화(anonymization)가 아니고 권한 격리 보조(authorization isolation auxiliary) 목적입니다.
  subject_phone_sha256 text not null check (subject_phone_sha256 ~ '^[0-9a-f]{64}$'),
  purpose text not null default 'INFO' check (purpose = 'INFO'),
  granted_at timestamptz not null,
  revoked_at timestamptz,
  evidence_ref text not null check (length(trim(evidence_ref)) > 0),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint kakao_notification_evidence_workspace_reservation_key unique (workspace_id, reservation_id)
);

-- 인덱스: 테넌트 및 해시 기반 고속 조회
create index kakao_notification_evidence_lookup_idx
  on public.kakao_notification_evidence (workspace_id, reservation_id, subject_phone_sha256)
  where revoked_at is null;

-- RLS 활성화 및 권한 격리 (service_role 전용)
alter table public.kakao_notification_evidence enable row level security;

revoke all on public.kakao_notification_evidence from public, anon, authenticated;
grant all on public.kakao_notification_evidence to service_role;

create policy "service role full access on kakao_notification_evidence"
  on public.kakao_notification_evidence
  for all
  to service_role
  using (true)
  with check (true);


-- 2. 카카오 알림톡 템플릿 심사 승인 원장 테이블 --------------------------------
-- 카카오 비즈메시지/솔라피 사전 심사 승인 상태를 기록합니다.
-- 주의: 콘솔/API 증거를 나중에 검증 후 저장해야 함; 테이블 존재 = 승인 아님.
create table public.kakao_template_approvals (
  template_code text primary key,
  template_id text not null,
  channel_id text not null,
  body_sha256 text not null check (body_sha256 ~ '^[0-9a-f]{64}$'),
  state text not null check (state in ('APPROVED', 'REJECTED', 'PENDING')),
  verified_at timestamptz not null,
  evidence_ref text not null check (length(trim(evidence_ref)) > 0),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp()
);

-- 인덱스: 승인 상태 및 최근 검증 건 조회 가속
create index kakao_template_approvals_verified_idx
  on public.kakao_template_approvals (state, verified_at desc)
  where state = 'APPROVED';

-- RLS 활성화 및 권한 격리 (service_role 전용)
alter table public.kakao_template_approvals enable row level security;

revoke all on public.kakao_template_approvals from public, anon, authenticated;
grant all on public.kakao_template_approvals to service_role;

create policy "service role full access on kakao_template_approvals"
  on public.kakao_template_approvals
  for all
  to service_role
  using (true)
  with check (true);
