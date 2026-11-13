-- ============================================================================
-- Sohee V0.8.9 ANI-561 (Campaigns) & ANI-562 (14-Day Trial Journey) Migration
-- ============================================================================

-- 1. Trial Journey Milestones (Day0 -> Day14 Journey Engine: ANI-562)
CREATE TABLE IF NOT EXISTS public.trial_journey_milestones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  day_stage INTEGER NOT NULL CHECK (day_stage BETWEEN 0 AND 14),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  category TEXT NOT NULL, -- 'FIRST_WOW', 'CHANNEL_SETUP', 'AUTONOMOUS_RUN', 'COMPETITOR_INSIGHT', 'COMMERCIAL_CONVERSION'
  is_completed BOOLEAN NOT NULL DEFAULT false,
  completed_at TIMESTAMPTZ,
  evidence_data JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_workspace_day_milestone UNIQUE (workspace_id, day_stage)
);

ALTER TABLE public.trial_journey_milestones ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'trial_journey_milestones' AND policyname = 'trial_journey_milestones_select') THEN
    CREATE POLICY "trial_journey_milestones_select" ON public.trial_journey_milestones FOR SELECT TO authenticated
    USING (
      workspace_id IN (
        SELECT workspace_id FROM public.workspace_members WHERE user_id = (SELECT auth.uid())
      )
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'trial_journey_milestones' AND policyname = 'trial_journey_milestones_insert') THEN
    CREATE POLICY "trial_journey_milestones_insert" ON public.trial_journey_milestones FOR INSERT TO authenticated
    WITH CHECK (
      workspace_id IN (
        SELECT workspace_id FROM public.workspace_members WHERE user_id = (SELECT auth.uid())
      )
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'trial_journey_milestones' AND policyname = 'trial_journey_milestones_update') THEN
    CREATE POLICY "trial_journey_milestones_update" ON public.trial_journey_milestones FOR UPDATE TO authenticated
    USING (
      workspace_id IN (
        SELECT workspace_id FROM public.workspace_members WHERE user_id = (SELECT auth.uid())
      )
    )
    WITH CHECK (
      workspace_id IN (
        SELECT workspace_id FROM public.workspace_members WHERE user_id = (SELECT auth.uid())
      )
    );
  END IF;
END $$;

-- 2. Procedure to initialize or seed 14-day trial journey for a workspace
CREATE OR REPLACE FUNCTION public.seed_trial_journey_milestones(p_workspace_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  INSERT INTO public.trial_journey_milestones (workspace_id, day_stage, title, description, category, is_completed, completed_at)
  VALUES
    (p_workspace_id, 0, 'First WOW: 15분 만에 첫 마케팅 시안 승인', '소희와 함께 첫 브랜드 카피와 고화질 이미지를 승인하고 40,000 크레딧을 수령합니다.', 'FIRST_WOW', true, now()),
    (p_workspace_id, 1, 'SNS & 검색 마케팅 채널 연동', '인스타그램, 네이버 블로그 등 매장의 공식 마케팅 채널을 연결합니다.', 'CHANNEL_SETUP', false, null),
    (p_workspace_id, 4, '1주차 주간 캠페인 자율 실행', '7일간의 요일별 타겟 콘텐츠를 자동 생성하고 상권 고객 반응을 감시합니다.', 'AUTONOMOUS_RUN', false, null),
    (p_workspace_id, 8, '상권 성과 분석 & AI 마케팅 고도화', '조회수, 문의율, 예약 전환 데이터를 기반으로 매장 맞춤 키워드를 학습합니다.', 'COMPETITOR_INSIGHT', false, null),
    (p_workspace_id, 13, '14일 성과 요약 & 정식 사원 전환', '14일간 절감한 인건비(약 120만원) 및 총 성과 리포트를 확인하고 정식 플랜으로 전환합니다.', 'COMMERCIAL_CONVERSION', false, null)
  ON CONFLICT (workspace_id, day_stage) DO NOTHING;
END;
$$;

GRANT EXECUTE ON FUNCTION public.seed_trial_journey_milestones TO authenticated, anon, service_role;
