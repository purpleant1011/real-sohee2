-- ============================================================================
-- Migration: 20261022080000_workspace_business_details.sql
-- Project: ANI-1649 / 첫 가입 '우리 가게' 단계 사업자·운영 정보 직접 입력
-- Purpose:
--   네이버 플레이스 링크가 없는 사장님도 가입 첫 화면에서 사업자 정보와
--   운영 정보를 직접 입력할 수 있게 한다. 이 테이블은 **사장님이 직접 적은
--   자가 입력 기록**이며, 국세청 검증·운영팀 승인을 거친 정본은 아니다.
--   검증된 정본은 public.business_verifications 이다(진실 원천 분리 유지).
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.workspace_business_details (
  workspace_id uuid PRIMARY KEY REFERENCES public.workspaces (id) ON DELETE CASCADE,

  -- 사업자 정보 (자가 입력 · 미검증)
  business_number varchar(10) CHECK (business_number IS NULL OR business_number ~ '^[0-9]{10}$'),
  representative_name text CHECK (representative_name IS NULL OR char_length(representative_name) <= 60),
  business_start_date varchar(8) CHECK (business_start_date IS NULL OR business_start_date ~ '^[0-9]{8}$'),
  business_type text CHECK (business_type IS NULL OR char_length(business_type) <= 60),
  business_item text CHECK (business_item IS NULL OR char_length(business_item) <= 60),

  -- 운영 정보
  phone text CHECK (phone IS NULL OR char_length(phone) <= 30),
  business_hours text CHECK (business_hours IS NULL OR char_length(business_hours) <= 120),
  closed_days text CHECK (closed_days IS NULL OR char_length(closed_days) <= 60),
  parking_info text CHECK (parking_info IS NULL OR char_length(parking_info) <= 120),
  reservation_method text CHECK (reservation_method IS NULL OR char_length(reservation_method) <= 120),
  website_url text CHECK (website_url IS NULL OR char_length(website_url) <= 300),
  price_range text CHECK (price_range IS NULL OR char_length(price_range) <= 60),
  naver_place_url text CHECK (naver_place_url IS NULL OR char_length(naver_place_url) <= 300),

  intake_source text NOT NULL DEFAULT 'manual' CHECK (intake_source IN ('manual', 'naver_sync')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.workspace_business_details IS
  '가입 첫 화면에서 사장님이 직접 입력한 사업자·운영 정보(자가 입력, 미검증). 검증 정본은 business_verifications.';

CREATE INDEX IF NOT EXISTS workspace_business_details_business_number_idx
  ON public.workspace_business_details (business_number)
  WHERE business_number IS NOT NULL;

DROP TRIGGER IF EXISTS workspace_business_details_set_updated_at ON public.workspace_business_details;
CREATE TRIGGER workspace_business_details_set_updated_at
BEFORE UPDATE ON public.workspace_business_details
FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();

ALTER TABLE public.workspace_business_details ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "workspace members can read business details" ON public.workspace_business_details;
CREATE POLICY "workspace members can read business details"
ON public.workspace_business_details FOR SELECT
TO authenticated
USING ((SELECT private.is_workspace_member(workspace_id)));

DROP POLICY IF EXISTS "workspace managers can insert business details" ON public.workspace_business_details;
CREATE POLICY "workspace managers can insert business details"
ON public.workspace_business_details FOR INSERT
TO authenticated
WITH CHECK ((SELECT private.has_workspace_role(workspace_id, ARRAY['owner', 'manager']::text[])));

DROP POLICY IF EXISTS "workspace managers can update business details" ON public.workspace_business_details;
CREATE POLICY "workspace managers can update business details"
ON public.workspace_business_details FOR UPDATE
TO authenticated
USING ((SELECT private.has_workspace_role(workspace_id, ARRAY['owner', 'manager']::text[])))
WITH CHECK ((SELECT private.has_workspace_role(workspace_id, ARRAY['owner', 'manager']::text[])));

REVOKE ALL ON public.workspace_business_details FROM anon, authenticated;
GRANT SELECT, INSERT ON public.workspace_business_details TO authenticated;
GRANT UPDATE (
  business_number, representative_name, business_start_date, business_type, business_item,
  phone, business_hours, closed_days, parking_info, reservation_method,
  website_url, price_range, naver_place_url, intake_source
) ON public.workspace_business_details TO authenticated;
