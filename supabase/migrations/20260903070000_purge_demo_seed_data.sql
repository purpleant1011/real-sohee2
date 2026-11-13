-- ============================================================================
-- Migration: 20260903070000_purge_demo_seed_data.sql
-- Issue: [ANI-632] [ADM-515] Production DB 데모 시드 데이터 완전 제거 및 실운영 단일 모드 전환
-- Description:
--   1. 20260823170814_operator_admin_crm_demo_seed에 의해 삽입된 5개 가짜 데모 고객사
--      ('소담공방', '오늘의식탁', '라이트스튜디오', '모먼트살롱', '온기브루') 및
--      workspace_kind = 'demo'인 모든 데모 데이터를 영구 삭제(Purge)
--   2. 종속 관계 테이블 레코드 일괄 정리
--   3. 데모 시드 생성 함수 private.seed_operator_admin_crm_demo_data() 폐기
-- ============================================================================

DO $$
DECLARE
  demo_workspace_ids UUID[] := ARRAY[
    'd1000000-0000-4000-8000-000000000001'::uuid,
    'd1000000-0000-4000-8000-000000000002'::uuid,
    'd1000000-0000-4000-8000-000000000003'::uuid,
    'd1000000-0000-4000-8000-000000000004'::uuid,
    'd1000000-0000-4000-8000-000000000005'::uuid
  ];
  extra_demo_ids UUID[];
BEGIN
  -- Collect any additional workspaces marked with kind = 'demo'
  SELECT COALESCE(array_agg(id), '{}'::uuid[])
  INTO extra_demo_ids
  FROM public.workspaces
  WHERE workspace_kind = 'demo' AND NOT (id = ANY(demo_workspace_ids));

  demo_workspace_ids := array_cat(demo_workspace_ids, extra_demo_ids);

  IF array_length(demo_workspace_ids, 1) > 0 THEN
    -- 1. Purge credit ledger entries
    DELETE FROM public.credit_ledger_entries
    WHERE workspace_id = ANY(demo_workspace_ids);

    -- 2. Purge billing entitlements
    DELETE FROM public.workspace_billing_entitlements
    WHERE workspace_id = ANY(demo_workspace_ids);

    -- 3. Purge channel verification runs
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'channel_verification_runs') THEN
      DELETE FROM public.channel_verification_runs
      WHERE workspace_id = ANY(demo_workspace_ids);
    END IF;

    -- 4. Purge channel consents
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'channel_consents') THEN
      DELETE FROM public.channel_consents
      WHERE workspace_id = ANY(demo_workspace_ids);
    END IF;

    -- 5. Purge oauth transactions
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'oauth_transactions') THEN
      DELETE FROM public.oauth_transactions
      WHERE workspace_id = ANY(demo_workspace_ids);
    END IF;

    -- 6. Purge channel connections
    DELETE FROM public.channel_connections
    WHERE workspace_id = ANY(demo_workspace_ids);

    -- 7. Purge business profiles
    DELETE FROM public.business_profiles
    WHERE workspace_id = ANY(demo_workspace_ids);

    -- 8. Purge workspace lifecycles
    DELETE FROM public.workspace_lifecycles
    WHERE workspace_id = ANY(demo_workspace_ids);

    -- 9. Purge workspace members
    DELETE FROM public.workspace_members
    WHERE workspace_id = ANY(demo_workspace_ids);

    -- 10. Purge audit events
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'audit_events') THEN
      DELETE FROM public.audit_events
      WHERE workspace_id = ANY(demo_workspace_ids);
    END IF;

    -- 11. Finally, purge workspaces
    DELETE FROM public.workspaces
    WHERE id = ANY(demo_workspace_ids);
  END IF;
END $$;

-- Drop the demo seed function completely
DROP FUNCTION IF EXISTS private.seed_operator_admin_crm_demo_data();
