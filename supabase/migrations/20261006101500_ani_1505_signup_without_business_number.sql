-- ANI-1505: 번호 없는 신규 가입은 사용자당 한 번만 첫 게시용 300 SC를 지급한다.
-- 비용 근거: INSTAGRAM_POST_GENERATE 100 + IMAGE_STUDIO_HD_RENDER 150 + SNS_DIRECT_PUBLISH 50.
-- 사업자번호 기반 50 Energy / 40,000 SC 무료 맛보기는 별개의 기존 RPC에 남겨 둔다.
-- free_taste_claims는 번호가 검증되기 전에는 절대 기록하지 않는다.
-- Rollback (앱의 RPC 호출을 먼저 되돌린 후): DROP FUNCTION public.provision_signup_workspace(uuid, text);
-- 기존에 생성된 워크스페이스/크레딧은 삭제하지 않으며, 지급분은 별도 운영 절차로 정산한다.
CREATE FUNCTION public.provision_signup_workspace(
  p_user_id uuid,
  p_provider text DEFAULT 'google'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_app public.signup_applications%ROWTYPE;
  v_ws_id uuid;
  v_account_id uuid;
  v_name text;
BEGIN
  -- SECURITY DEFINER는 RLS를 우회한다. authenticated는 반드시 본인 ID만 사용할 수 있다.
  IF (SELECT auth.role()) = 'authenticated' AND (SELECT auth.uid()) IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION '본인의 사용자 계정으로만 가입할 수 있습니다 (AUTHZ_IMPERSONATION_DENIED).'
      USING ERRCODE = '42501';
  END IF;
  IF p_user_id IS NULL OR COALESCE((SELECT auth.role()), '') NOT IN ('authenticated', 'service_role') THEN
    RAISE EXCEPTION '가입을 위한 인증이 필요합니다.' USING ERRCODE = '42501';
  END IF;

  -- 기존 가입/워크스페이스는 그대로 사용한다. 동일 사용자 가입 RPC 호출을 먼저 직렬화한다.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_user_id::text, 534845::bigint)
  );
  INSERT INTO public.signup_applications (user_id, state, agreements_completed)
  VALUES (p_user_id, 'FORM_REQUIRED', false)
  ON CONFLICT (user_id) DO NOTHING;

  SELECT * INTO v_app FROM public.signup_applications WHERE user_id = p_user_id FOR UPDATE;

  IF v_app.workspace_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.workspace_members wm
    WHERE wm.workspace_id = v_app.workspace_id AND wm.user_id = p_user_id AND wm.status = 'active'
  ) THEN
    -- 기존에 완료된 신청은 상태/사업자 정보/혜택을 변경하지 않고 반환한다.
    RETURN pg_catalog.jsonb_build_object('success', true, 'workspace_id', v_app.workspace_id,
      'is_new_workspace', false, 'credits_granted', 0, 'energy_granted', 0);
  END IF;

  SELECT wm.workspace_id INTO v_ws_id
  FROM public.workspace_members wm WHERE wm.user_id = p_user_id AND wm.status = 'active'
  ORDER BY wm.created_at, wm.workspace_id LIMIT 1;
  IF v_ws_id IS NOT NULL THEN
    -- 기존 워크스페이스만 존재하는 가입자도 재지급 없이 반환한다.
    RETURN pg_catalog.jsonb_build_object('success', true, 'workspace_id', v_ws_id,
      'is_new_workspace', false, 'credits_granted', 0, 'energy_granted', 0);
  END IF;

  -- 기존 사업자 인증 진행 중인 신청은 기존 절차를 유지한다. 신규 번호 없는 가입만 대상이다.
  IF v_app.state <> 'FORM_REQUIRED' OR v_app.business_number IS NOT NULL THEN
    RAISE EXCEPTION '기존 가입 절차를 계속 진행해 주세요. (SIGNUP_IN_PROGRESS)'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT pg_catalog.left(COALESCE(NULLIF(pg_catalog.btrim(u.raw_user_meta_data->>'full_name'), ''),
                  NULLIF(pg_catalog.btrim(u.raw_user_meta_data->>'name'), ''),
                  NULLIF(pg_catalog.split_part(u.email, '@', 1), ''), '사장님'), 60)
    INTO v_name FROM auth.users u WHERE u.id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION '인증된 사용자를 찾을 수 없습니다.' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.profiles (id, display_name, updated_at)
  VALUES (p_user_id, v_name, now())
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.workspaces (name, created_by)
  VALUES (v_name || '의 워크스페이스', p_user_id)
  RETURNING id INTO v_ws_id;

  -- A workspace trigger may already have added the creator as owner; make this idempotent.
  INSERT INTO public.workspace_members (workspace_id, user_id, role)
  VALUES (v_ws_id, p_user_id, 'owner')
  ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = 'owner';

  -- 300 SC는 별도 원장 키와 signup_applications.user_id 유니크로 사용자당 한 번만 지급한다.
  -- 사업자번호가 없으므로 FREE_TASTE_50 claim이나 50 Energy는 생성하지 않는다.
  INSERT INTO public.credit_accounts (workspace_id, period_start, period_end, timezone)
  VALUES (v_ws_id, CURRENT_DATE, (CURRENT_DATE + interval '14 days')::date, 'Asia/Seoul')
  RETURNING id INTO v_account_id;

  INSERT INTO public.credit_ledger_entries
    (workspace_id, account_id, kind, action, amount, idempotency_key, occurred_at)
  VALUES (v_ws_id, v_account_id, 'grant', NULL, 300, 'signup-first-post:' || p_user_id::text, now());

  INSERT INTO public.trial_entitlements
    (workspace_id, plan_key, starts_at, ends_at, status, initial_credit_grant)
  VALUES (v_ws_id, 'TRIAL_V1', now(), now() + interval '14 days', 'ACTIVE', 300)
  ON CONFLICT (workspace_id) DO NOTHING;

  INSERT INTO public.workspace_credit_states
    (workspace_id, commercial_state, trial_started_at, trial_ends_at,
     activation_credits, agent_credits, protected_wow_credits, total_available_credits)
  VALUES (v_ws_id, 'TRIAL_ACTIVE', now(), now() + interval '14 days', 300, 0, 0, 300)
  ON CONFLICT (workspace_id) DO NOTHING;

  INSERT INTO public.agent_energy_ledgers
    (workspace_id, plan_tier, monthly_total_energy, used_energy_current_month,
     reserved_energy_active_runs, remaining_available_energy, burn_rate_percentage,
     budget_alert_stage, forecast_run_out_days, updated_at)
  VALUES (v_ws_id, 'FREE_TASTE', 0, 0, 0, 0, 0, 'NORMAL', 30, now())
  ON CONFLICT (workspace_id) DO NOTHING;

  UPDATE public.signup_applications
  SET workspace_id = v_ws_id, state = 'COMPLETED', completed_at = now(), updated_at = now()
  WHERE user_id = p_user_id;

  RETURN pg_catalog.jsonb_build_object('success', true, 'workspace_id', v_ws_id,
    'is_new_workspace', true, 'credits_granted', 300, 'energy_granted', 0);
END;
$function$;

REVOKE ALL ON FUNCTION public.provision_signup_workspace(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.provision_signup_workspace(uuid, text) TO authenticated, service_role;
COMMENT ON FUNCTION public.provision_signup_workspace(uuid, text) IS
  'ANI-1505: one workspace and 300 first-post SC per new auth user, without a business number or free taste claim.';
