-- ==============================================================================
-- Purge All Test & Demo Workspaces for Commercial Production Readiness
-- Author: Antigravity Autonomous Engine
-- Description:
--   Permanently purges dummy, demo, and test workspaces (e.g. 모모미싱점, 문지요루,
--   위아트스튜디오, 오월의식탁, 소담공방, 바이올, 스마트스토어작업공간, etc.)
--   and all related ledger/member records.
--   Ensures only REAL user-registered production workspaces remain in the database.
-- ==============================================================================

DO $$
DECLARE
  target_ws_ids uuid[];
BEGIN
  -- 1. Identify all demo and test workspaces
  SELECT array_agg(id) INTO target_ws_ids
  FROM public.workspaces
  WHERE name IN (
    '바이올',
    '문지요루',
    '모모미싱점',
    '위아트스튜디오',
    '오월의식탁',
    '소담공방',
    '스마트스토어작업공간',
    '스타 고객사 작업공간',
    '헬스 & 짐',
    '바이름 청라점',
    '청라 헤어살롱',
    '송도 필라테스',
    '부평 네일아트',
    '소담공방 본점',
    '라온베이커리 역삼점',
    '피트니스온 성수점',
    '도담한의원 판교점',
    '모던헤어살롱 연남점',
    '소희카페 강남본점'
  )
  OR id::text LIKE 'd1000000-%';

  IF target_ws_ids IS NOT NULL AND array_length(target_ws_ids, 1) > 0 THEN
    -- Delete referencing data first
    DELETE FROM public.credit_ledger_entries WHERE workspace_id = ANY(target_ws_ids);
    DELETE FROM public.credit_accounts WHERE workspace_id = ANY(target_ws_ids);
    DELETE FROM public.credit_reservations WHERE workspace_id = ANY(target_ws_ids);
    DELETE FROM public.channel_connections WHERE workspace_id = ANY(target_ws_ids);
    DELETE FROM public.channel_verification_runs WHERE workspace_id = ANY(target_ws_ids);
    DELETE FROM public.workspace_members WHERE workspace_id = ANY(target_ws_ids);
    DELETE FROM public.workspace_profiles WHERE workspace_id = ANY(target_ws_ids);
    DELETE FROM public.invitations WHERE workspace_id = ANY(target_ws_ids);
    DELETE FROM public.operator_audit_logs WHERE target_id = ANY(ARRAY(SELECT unnest(target_ws_ids)::text));

    -- Delete workspaces
    DELETE FROM public.workspaces WHERE id = ANY(target_ws_ids);
  END IF;
END $$;
