-- ==============================================================================
-- Test: mission-contract-isolation.sql
-- Description: Verifies composite FK tenant isolation on mission_events,
--              mission_action_receipts multi-receipt join table isolation,
--              and optimistic snapshot concurrency update RPC with audit atomicity.
-- ==============================================================================

BEGIN;

-- 1. Ensure test auth.users fixtures exist for foreign key on workspaces.created_by and recorded_by
INSERT INTO auth.users (id, email)
VALUES
  ('00000000-0000-0000-0000-000000000001', 'tenant-a-owner@example.com'),
  ('00000000-0000-0000-0000-000000000002', 'tenant-b-owner@example.com')
ON CONFLICT (id) DO NOTHING;

-- 2. Create two isolated workspaces
INSERT INTO public.workspaces (id, name, created_by)
VALUES
  ('11111111-1111-1111-1111-111111111111', 'Tenant A Workspace', '00000000-0000-0000-0000-000000000001'),
  ('22222222-2222-2222-2222-222222222222', 'Tenant B Workspace', '00000000-0000-0000-0000-000000000002')
ON CONFLICT (id) DO NOTHING;

-- 3. Workspace members
INSERT INTO public.workspace_members (workspace_id, user_id, role, status)
VALUES
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000001', 'owner', 'active'),
  ('22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000002', 'owner', 'active')
ON CONFLICT (workspace_id, user_id) DO NOTHING;

-- 4. Insert external_action_requests fixtures for Tenant A and Tenant B
INSERT INTO public.external_action_requests (
  id,
  workspace_id,
  channel,
  action_kind,
  target_external_id,
  target_label,
  exact_payload,
  idempotency_key,
  created_by
) VALUES
  (
    'aaaaaaaa-1111-1111-1111-aaaaaaaaaaaa',
    '11111111-1111-1111-1111-111111111111',
    'naver_place',
    'news_post',
    'target-naver-a',
    '네이버소식 A',
    '{"text": "소식 내용 A"}'::jsonb,
    'ani1796-idemp-req-a',
    '00000000-0000-0000-0000-000000000001'
  ),
  (
    'bbbbbbbb-2222-2222-2222-bbbbbbbbbbbb',
    '22222222-2222-2222-2222-222222222222',
    'naver_place',
    'news_post',
    'target-naver-b',
    '네이버소식 B',
    '{"text": "소식 내용 B"}'::jsonb,
    'ani1796-idemp-req-b',
    '00000000-0000-0000-0000-000000000002'
  );

-- 5. Insert external_action_receipts fixtures:
-- Tenant A verified receipt
INSERT INTO public.external_action_receipts (
  id,
  workspace_id,
  action_request_id,
  receipt_kind,
  status,
  verification_method,
  verified_at,
  observed_payload,
  recorded_by
) VALUES (
  '33333333-3333-3333-3333-333333333333',
  '11111111-1111-1111-1111-111111111111',
  'aaaaaaaa-1111-1111-1111-aaaaaaaaaaaa',
  'observed_result',
  'VERIFIED',
  'HTTP_READBACK',
  '2026-10-27 10:00:00+00',
  '{"verified":true}'::jsonb,
  '00000000-0000-0000-0000-000000000001'
);

-- Tenant A unverified receipt (verified_at is NULL, status ACCEPTED_BY_PROVIDER)
INSERT INTO public.external_action_receipts (
  id,
  workspace_id,
  action_request_id,
  receipt_kind,
  status,
  verification_method,
  verified_at,
  observed_payload,
  recorded_by
) VALUES (
  '55555555-5555-5555-5555-555555555555',
  '11111111-1111-1111-1111-111111111111',
  'aaaaaaaa-1111-1111-1111-aaaaaaaaaaaa',
  'submission',
  'ACCEPTED_BY_PROVIDER',
  'PROVIDER_SYNC',
  NULL,
  '{}'::jsonb,
  '00000000-0000-0000-0000-000000000001'
);

-- Tenant A third receipt fixture (for stale rollback leak test)
INSERT INTO public.external_action_receipts (
  id,
  workspace_id,
  action_request_id,
  receipt_kind,
  status,
  verification_method,
  verified_at,
  observed_payload,
  recorded_by
) VALUES (
  '66666666-6666-6666-6666-666666666666',
  '11111111-1111-1111-1111-111111111111',
  'aaaaaaaa-1111-1111-1111-aaaaaaaaaaaa',
  'observed_result',
  'VERIFIED',
  'HTTP_READBACK',
  '2026-10-27 12:00:00+00',
  '{"verified":true}'::jsonb,
  '00000000-0000-0000-0000-000000000001'
);

-- Tenant B foreign receipt
INSERT INTO public.external_action_receipts (
  id,
  workspace_id,
  action_request_id,
  receipt_kind,
  status,
  verification_method,
  verified_at,
  observed_payload,
  recorded_by
) VALUES (
  '77777777-7777-7777-7777-777777777777',
  '22222222-2222-2222-2222-222222222222',
  'bbbbbbbb-2222-2222-2222-bbbbbbbbbbbb',
  'observed_result',
  'VERIFIED',
  'HTTP_READBACK',
  '2026-10-27 11:00:00+00',
  '{"verified":true}'::jsonb,
  '00000000-0000-0000-0000-000000000002'
);

-- 6. Insert Marketing Missions for Tenant A and Tenant B
INSERT INTO public.marketing_missions (
  id,
  workspace_id,
  trace_id,
  status,
  goal,
  metadata
) VALUES
  (
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    '11111111-1111-1111-1111-111111111111',
    'trace-tenant-a-001',
    'RECEIVED',
    'Tenant A marketing goal',
    '{"snapshot_version": 1}'::jsonb
  ),
  (
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    '22222222-2222-2222-2222-222222222222',
    'trace-tenant-b-001',
    'RECEIVED',
    'Tenant B marketing goal',
    '{"snapshot_version": 1}'::jsonb
  );

-- Requests are explicitly bound; immutable receipt fixtures above carry canonical payloads.
UPDATE public.external_action_requests SET mission_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
WHERE id = 'aaaaaaaa-1111-1111-1111-aaaaaaaaaaaa';
UPDATE public.external_action_requests SET mission_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
WHERE id = 'bbbbbbbb-2222-2222-2222-bbbbbbbbbbbb';

-- 7. Attempt cross-tenant mission_event insertion (Tenant B workspace_id with Tenant A mission_id)
-- Must FAIL due to composite FK mission_events_workspace_mission_fkey
DO $$
BEGIN
  BEGIN
    INSERT INTO public.mission_events (
      workspace_id,
      mission_id,
      trace_id,
      from_status,
      to_status,
      actor_type,
      event_name
    ) VALUES (
      '22222222-2222-2222-2222-222222222222', -- Tenant B
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', -- Mission belongs to Tenant A!
      'trace-leak-attempt',
      'RECEIVED',
      'PLANNING',
      'agent',
      'ILLEGAL_CROSS_TENANT_EVENT'
    );
    RAISE EXCEPTION 'TEST_FAILED: Cross-tenant event insertion should have been blocked by composite FK!';
  EXCEPTION WHEN foreign_key_violation THEN
    RAISE NOTICE 'SUCCESS: Composite FK blocked cross-tenant mission event insertion.';
  END;
END $$;

-- 8. Attempt cross-tenant mission_action_receipts insertion:
-- Case A: Tenant B workspace_id with Tenant A mission_id
-- Must FAIL due to composite FK mission_action_receipts_mission_fkey
DO $$
BEGIN
  BEGIN
    INSERT INTO public.mission_action_receipts (
      workspace_id,
      mission_id,
      action_request_id,
      action_receipt_id,
      action_fingerprint,
      provider
    ) VALUES (
      '22222222-2222-2222-2222-222222222222', -- Tenant B
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', -- Tenant A Mission!
      'bbbbbbbb-2222-2222-2222-bbbbbbbbbbbb',
      '77777777-7777-7777-7777-777777777777',
      'fp-cross-mission-attempt',
      'naver_place'
    );
    RAISE EXCEPTION 'TEST_FAILED: Foreign mission insertion should have been blocked by composite FK!';
  EXCEPTION WHEN foreign_key_violation THEN
    RAISE NOTICE 'SUCCESS: Composite FK blocked foreign mission action receipt join.';
  END;
END $$;

-- Case B: Tenant A workspace_id + Tenant A mission_id with Tenant B foreign receipt
-- Must FAIL due to composite FK mission_action_receipts_receipt_fkey
DO $$
BEGIN
  BEGIN
    INSERT INTO public.mission_action_receipts (
      workspace_id,
      mission_id,
      action_request_id,
      action_receipt_id,
      action_fingerprint,
      provider
    ) VALUES (
      '11111111-1111-1111-1111-111111111111', -- Tenant A
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', -- Tenant A
      'aaaaaaaa-1111-1111-1111-aaaaaaaaaaaa', -- Tenant A Request
      '77777777-7777-7777-7777-777777777777', -- Tenant B Receipt!
      'fp-cross-receipt-attempt',
      'naver_place'
    );
    RAISE EXCEPTION 'TEST_FAILED: Foreign receipt insertion should have been blocked by composite FK!';
  EXCEPTION WHEN foreign_key_violation THEN
    RAISE NOTICE 'SUCCESS: Composite FK blocked foreign receipt join in own mission.';
  END;
END $$;

-- Case C: Tenant A workspace_id + Tenant A mission_id with Tenant B foreign request
-- Must FAIL due to composite FK mission_action_receipts_request_fkey
DO $$
BEGIN
  BEGIN
    INSERT INTO public.mission_action_receipts (
      workspace_id,
      mission_id,
      action_request_id,
      action_receipt_id,
      action_fingerprint,
      provider
    ) VALUES (
      '11111111-1111-1111-1111-111111111111', -- Tenant A
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', -- Tenant A
      'bbbbbbbb-2222-2222-2222-bbbbbbbbbbbb', -- Tenant B Request!
      '33333333-3333-3333-3333-333333333333', -- Tenant A Receipt
      'fp-cross-request-attempt',
      'naver_place'
    );
    RAISE EXCEPTION 'TEST_FAILED: Foreign request insertion should have been blocked by composite FK!';
  EXCEPTION WHEN foreign_key_violation THEN
    RAISE NOTICE 'SUCCESS: Composite FK blocked foreign request join.';
  END;
END $$;

-- 9. Atomic snapshot RPC: record verified action receipt and bump snapshot 1 -> 2
SELECT public.update_mission_snapshot_atomic(
  p_workspace_id => '11111111-1111-1111-1111-111111111111'::uuid,
  p_mission_id => 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
  p_expected_snapshot_version => 1,
  p_new_metadata => '{"execution_state": "OBSERVING", "outcome_state": "PENDING"}'::jsonb,
  p_new_status => 'PUBLISHED_VERIFIED',
  p_actor_type => 'provider',
  p_event_name => 'ACTION_RECEIPT_RECORDED',
  p_event_payload => '{"action_fingerprint": "fp-tenant-a-publish-1"}'::jsonb,
  p_receipt_entry => '{
    "receipt_id": "33333333-3333-3333-3333-333333333333",
    "action_request_id": "aaaaaaaa-1111-1111-1111-aaaaaaaaaaaa",
    "action_fingerprint": "fp-tenant-a-publish-1",
    "provider": "naver_place",
    "cost_minor_units": 50000
  }'::jsonb
);

-- Verify that join table, mission snapshot, and audit event are atomically consistent
DO $$
DECLARE
  v_join RECORD;
  v_mission RECORD;
  v_event RECORD;
BEGIN
  -- Verify join table row
  SELECT * INTO v_join
  FROM public.mission_action_receipts
  WHERE mission_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
    AND action_receipt_id = '33333333-3333-3333-3333-333333333333';

  IF v_join IS NULL THEN
    RAISE EXCEPTION 'TEST_FAILED: mission_action_receipts join row was not inserted!';
  END IF;

  IF v_join.verified_at IS DISTINCT FROM '2026-10-27 10:00:00+00'::timestamptz THEN
    RAISE EXCEPTION 'TEST_FAILED: verified_at should match ledger 2026-10-27 10:00:00+00, got %', v_join.verified_at;
  END IF;

  -- Verify mission snapshot version
  SELECT * INTO v_mission
  FROM public.marketing_missions
  WHERE id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

  IF (v_mission.metadata->>'snapshot_version')::int IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'TEST_FAILED: snapshot_version should be 2, got %', v_mission.metadata->>'snapshot_version';
  END IF;

  -- Verify audit event
  SELECT * INTO v_event
  FROM public.mission_events
  WHERE mission_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
    AND event_name = 'ACTION_RECEIPT_RECORDED'
  ORDER BY occurred_at DESC
  LIMIT 1;

  IF v_event IS NULL THEN
    RAISE EXCEPTION 'TEST_FAILED: Atomic audit event was not inserted!';
  END IF;

  IF v_event.from_status IS DISTINCT FROM 'RECEIVED' THEN
    RAISE EXCEPTION 'TEST_FAILED: from_status should be RECEIVED, got %', v_event.from_status;
  END IF;

  IF v_event.to_status IS DISTINCT FROM 'PUBLISHED_VERIFIED' THEN
    RAISE EXCEPTION 'TEST_FAILED: to_status should be PUBLISHED_VERIFIED, got %', v_event.to_status;
  END IF;

  RAISE NOTICE 'SUCCESS: Atomic receipt record, join row, and audit event verified.';
END $$;

-- 10. Test unverified receipt: verified_at in join row MUST remain NULL (never forged)
SELECT public.update_mission_snapshot_atomic(
  p_workspace_id => '11111111-1111-1111-1111-111111111111'::uuid,
  p_mission_id => 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
  p_expected_snapshot_version => 2,
  p_new_metadata => '{"execution_state": "OBSERVING"}'::jsonb,
  p_actor_type => 'provider',
  p_event_name => 'UNVERIFIED_RECEIPT_RECORDED',
  p_receipt_entry => '{
    "receipt_id": "55555555-5555-5555-5555-555555555555",
    "action_request_id": "aaaaaaaa-1111-1111-1111-aaaaaaaaaaaa",
    "action_fingerprint": "fp-tenant-a-publish-unverified-2",
    "provider": "naver_place",
    "cost_minor_units": 0
  }'::jsonb
);

-- Verify verified_at remains NULL
DO $$
DECLARE
  v_join RECORD;
BEGIN
  SELECT * INTO v_join
  FROM public.mission_action_receipts
  WHERE mission_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
    AND action_receipt_id = '55555555-5555-5555-5555-555555555555';

  IF v_join IS NULL THEN
    RAISE EXCEPTION 'TEST_FAILED: second receipt join row was not inserted!';
  END IF;

  IF v_join.verified_at IS NOT NULL THEN
    RAISE EXCEPTION 'TEST_FAILED: Unverified receipt should have NULL verified_at, got %', v_join.verified_at;
  END IF;

  RAISE NOTICE 'SUCCESS: Unverified receipt preserved NULL verified_at without timestamp forgery.';
END $$;

-- 11. Test duplicate action fingerprint rejection
DO $$
BEGIN
  BEGIN
    SELECT public.update_mission_snapshot_atomic(
      p_workspace_id => '11111111-1111-1111-1111-111111111111'::uuid,
      p_mission_id => 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
      p_expected_snapshot_version => 3,
      p_new_metadata => '{"execution_state": "OBSERVING"}'::jsonb,
      p_actor_type => 'provider',
      p_event_name => 'DUPLICATE_FINGERPRINT_ATTEMPT',
      p_receipt_entry => '{
        "receipt_id": "33333333-3333-3333-3333-333333333333",
        "action_request_id": "aaaaaaaa-1111-1111-1111-aaaaaaaaaaaa",
        "action_fingerprint": "fp-tenant-a-publish-1",
        "provider": "naver_place"
      }'::jsonb
    );
    RAISE EXCEPTION 'TEST_FAILED: Duplicate receipt insertion should have failed!';
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'SUCCESS: Duplicate receipt correctly rejected with unique violation.';
  END;
END $$;

-- 12. Stale snapshot version retry: atomic rollback must leave 0 join rows
-- Reinforced test: stale request includes an actual new receipt entry to prove rollback leaves NO leaked join rows
DO $$
DECLARE
  v_count_before integer;
  v_count_after integer;
  v_leaked_count integer;
BEGIN
  SELECT count(*) INTO v_count_before
  FROM public.mission_action_receipts
  WHERE mission_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

  BEGIN
    PERFORM public.update_mission_snapshot_atomic(
      p_workspace_id => '11111111-1111-1111-1111-111111111111'::uuid,
      p_mission_id => 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
      p_expected_snapshot_version => 2, -- STALE! Current version is 3
      p_new_metadata => '{"execution_state": "CLOSED"}'::jsonb,
      p_new_status => 'COMPLETED',
      p_actor_type => 'agent',
      p_event_name => 'STALE_SNAPSHOT_UPDATE',
      p_receipt_entry => '{
        "receipt_id": "66666666-6666-6666-6666-666666666666",
        "action_request_id": "aaaaaaaa-1111-1111-1111-aaaaaaaaaaaa",
        "action_fingerprint": "fp-tenant-a-stale-leak-attempt",
        "provider": "naver_place",
        "cost_minor_units": 15000
      }'::jsonb
    );
    RAISE EXCEPTION 'TEST_FAILED: Stale snapshot update with receipt should have failed!';
  EXCEPTION WHEN SQLSTATE 'P0004' THEN
    RAISE NOTICE 'SUCCESS: Stale snapshot update with receipt rejected with P0004.';
  END;

  SELECT count(*) INTO v_count_after
  FROM public.mission_action_receipts
  WHERE mission_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

  IF v_count_before IS DISTINCT FROM v_count_after THEN
    RAISE EXCEPTION 'TEST_FAILED: Failed atomic call leaked join rows! Before: %, After: %', v_count_before, v_count_after;
  END IF;

  SELECT count(*) INTO v_leaked_count
  FROM public.mission_action_receipts
  WHERE action_receipt_id = '66666666-6666-6666-6666-666666666666';

  IF v_leaked_count IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'TEST_FAILED: Stale call leaked candidate receipt 66666666 into join table!';
  END IF;

  RAISE NOTICE 'SUCCESS: Atomic rollback verified - 0 leaked rows on stale conflict with receipt entry.';
END $$;

-- 13. Update with correct expected version 3 succeeds and bumps to 4
SELECT public.update_mission_snapshot_atomic(
  p_workspace_id => '11111111-1111-1111-1111-111111111111'::uuid,
  p_mission_id => 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
  p_expected_snapshot_version => 3,
  p_new_metadata => '{"execution_state": "CLOSED", "outcome_state": "ACHIEVED_VERIFIED"}'::jsonb,
  p_new_status => 'COMPLETED',
  p_actor_type => 'agent',
  p_event_name => 'MISSION_COMPLETED'
);

DO $$
DECLARE
  v_final_version int;
BEGIN
  SELECT (metadata->>'snapshot_version')::int INTO v_final_version
  FROM public.marketing_missions
  WHERE id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

  IF v_final_version IS DISTINCT FROM 4 THEN
    RAISE EXCEPTION 'TEST_FAILED: Final snapshot version should be 4, got %', v_final_version;
  END IF;

  RAISE NOTICE 'SUCCESS: Sequential optimistic snapshot update succeeded (version 4).';
END $$;

-- 14. Create verified join row fixture for Tenant B to enable cross-tenant RLS testing
SELECT public.update_mission_snapshot_atomic(
  p_workspace_id => '22222222-2222-2222-2222-222222222222'::uuid,
  p_mission_id => 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid,
  p_expected_snapshot_version => 1,
  p_new_metadata => '{"execution_state": "OBSERVING"}'::jsonb,
  p_new_status => 'PUBLISHED_VERIFIED',
  p_actor_type => 'provider',
  p_event_name => 'ACTION_RECEIPT_RECORDED',
  p_receipt_entry => '{
    "receipt_id": "77777777-7777-7777-7777-777777777777",
    "action_request_id": "bbbbbbbb-2222-2222-2222-bbbbbbbbbbbb",
    "action_fingerprint": "fp-tenant-b-publish-1",
    "provider": "naver_place",
    "cost_minor_units": 20000
  }'::jsonb
);

-- 15. Real role and RLS verification: authenticated Tenant A / Tenant B / anon SELECT, direct INSERT denial, RPC execution denial
DO $$
DECLARE
  v_count_own integer;
  v_count_foreign integer;
  v_count_all integer;
  v_blocked boolean;
BEGIN
  -- --------------------------------------------------------------------------
  -- [A] Role: authenticated as Tenant A Owner (user 00000000-...-0001)
  -- --------------------------------------------------------------------------
  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
  PERFORM set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-000000000001", "role": "authenticated"}'::text, true);
  SET LOCAL ROLE authenticated;

  -- Verify SELECT isolation: can see own workspace (2 rows), cannot see Tenant B (0 rows)
  SELECT count(*) INTO v_count_own
  FROM public.mission_action_receipts
  WHERE workspace_id = '11111111-1111-1111-1111-111111111111';

  SELECT count(*) INTO v_count_foreign
  FROM public.mission_action_receipts
  WHERE workspace_id = '22222222-2222-2222-2222-222222222222';

  SELECT count(*) INTO v_count_all
  FROM public.mission_action_receipts;

  IF v_count_own IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'TEST_FAILED: Tenant A should see exactly 2 own receipts, saw %', v_count_own;
  END IF;

  IF v_count_foreign IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'TEST_FAILED: Tenant A should see 0 foreign receipts, saw %', v_count_foreign;
  END IF;

  IF v_count_all IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'TEST_FAILED: Tenant A total visible receipts should be 2, saw %', v_count_all;
  END IF;

  -- Verify direct INSERT denial: authenticated users must not insert directly into join table (server-only RPC path)
  v_blocked := false;
  BEGIN
    INSERT INTO public.mission_action_receipts (
      workspace_id,
      mission_id,
      action_request_id,
      action_receipt_id,
      action_fingerprint,
      provider
    ) VALUES (
      '11111111-1111-1111-1111-111111111111',
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      'aaaaaaaa-1111-1111-1111-aaaaaaaaaaaa',
      '66666666-6666-6666-6666-666666666666',
      'fp-direct-insert-attempt',
      'naver_place'
    );
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN
    v_blocked := true;
  END;

  IF NOT v_blocked THEN
    RAISE EXCEPTION 'TEST_FAILED: Direct INSERT by authenticated user should have been blocked by RLS/privileges!';
  END IF;

  -- Verify RPC execution privilege denial: authenticated user cannot execute update_mission_snapshot_atomic
  v_blocked := false;
  BEGIN
    PERFORM public.update_mission_snapshot_atomic(
      p_workspace_id => '11111111-1111-1111-1111-111111111111'::uuid,
      p_mission_id => 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
      p_expected_snapshot_version => 4,
      p_new_metadata => '{}'::jsonb
    );
  EXCEPTION WHEN insufficient_privilege THEN
    v_blocked := true;
  END;

  IF NOT v_blocked THEN
    RAISE EXCEPTION 'TEST_FAILED: RPC execution by authenticated user should have failed with insufficient_privilege!';
  END IF;

  RESET ROLE;

  -- --------------------------------------------------------------------------
  -- [B] Role: authenticated as Tenant B Owner (user 00000000-...-0002)
  -- --------------------------------------------------------------------------
  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true);
  PERFORM set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-000000000002", "role": "authenticated"}'::text, true);
  SET LOCAL ROLE authenticated;

  SELECT count(*) INTO v_count_own
  FROM public.mission_action_receipts
  WHERE workspace_id = '22222222-2222-2222-2222-222222222222';

  SELECT count(*) INTO v_count_foreign
  FROM public.mission_action_receipts
  WHERE workspace_id = '11111111-1111-1111-1111-111111111111';

  IF v_count_own IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'TEST_FAILED: Tenant B should see exactly 1 own receipt, saw %', v_count_own;
  END IF;

  IF v_count_foreign IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'TEST_FAILED: Tenant B should see 0 foreign receipts, saw %', v_count_foreign;
  END IF;

  RESET ROLE;

  -- --------------------------------------------------------------------------
  -- [C] Role: anon (unauthenticated client)
  -- --------------------------------------------------------------------------
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '{"role": "anon"}'::text, true);
  SET LOCAL ROLE anon;

  -- Anon must see 0 rows
  SELECT count(*) INTO v_count_all
  FROM public.mission_action_receipts;

  IF v_count_all IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'TEST_FAILED: Anon should see 0 receipts under RLS, saw %', v_count_all;
  END IF;

  -- Anon direct INSERT denied
  v_blocked := false;
  BEGIN
    INSERT INTO public.mission_action_receipts (
      workspace_id,
      mission_id,
      action_request_id,
      action_receipt_id,
      action_fingerprint,
      provider
    ) VALUES (
      '11111111-1111-1111-1111-111111111111',
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      'aaaaaaaa-1111-1111-1111-aaaaaaaaaaaa',
      '66666666-6666-6666-6666-666666666666',
      'fp-anon-insert-attempt',
      'naver_place'
    );
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN
    v_blocked := true;
  END;

  IF NOT v_blocked THEN
    RAISE EXCEPTION 'TEST_FAILED: Direct INSERT by anon should have been blocked!';
  END IF;

  -- Anon RPC execution denied
  v_blocked := false;
  BEGIN
    PERFORM public.update_mission_snapshot_atomic(
      p_workspace_id => '11111111-1111-1111-1111-111111111111'::uuid,
      p_mission_id => 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
      p_expected_snapshot_version => 4,
      p_new_metadata => '{}'::jsonb
    );
  EXCEPTION WHEN insufficient_privilege THEN
    v_blocked := true;
  END;

  IF NOT v_blocked THEN
    RAISE EXCEPTION 'TEST_FAILED: RPC execution by anon should have failed with insufficient_privilege!';
  END IF;

  RESET ROLE;

  RAISE NOTICE 'SUCCESS: Real role RLS (Tenant A/B isolation, anon block, direct INSERT denial, RPC execution denial) verified.';
END $$;

-- 16. Pointer-only calls must validate receipt -> request -> workspace/mission.
INSERT INTO public.marketing_missions (id, workspace_id, trace_id, status, goal, metadata)
VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2', '11111111-1111-1111-1111-111111111111',
  'trace-tenant-a-002', 'EXECUTING', 'Second mission',
  '{"snapshot_version":1,"execution_state":"RUNNING","outcome_state":"PENDING","control_epoch":7}');
DO $$
DECLARE
  v_before jsonb;
  v_after jsonb;
  v_events integer;
  v_joins integer;
  v_id uuid;
  v_entry jsonb;
  v_case integer;
BEGIN
  SELECT to_jsonb(m) INTO v_before FROM public.marketing_missions m
    WHERE id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
  SELECT count(*) INTO v_events FROM public.mission_events;
  SELECT count(*) INTO v_joins FROM public.mission_action_receipts;
  FOREACH v_id IN ARRAY ARRAY['77777777-7777-7777-7777-777777777777'::uuid,
      '33333333-3333-3333-3333-333333333333'::uuid,
      '66666666-6666-6666-6666-666666666666'::uuid] LOOP
    FOR v_case IN 1..2 LOOP
      v_entry := CASE WHEN v_case = 2 THEN jsonb_build_object('receipt_id', v_id,
        'action_fingerprint', 'foreign-receipt-probe', 'provider', 'meta') ELSE NULL END;
      BEGIN
        PERFORM public.update_mission_snapshot_atomic(
          '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2',
          1, '{}'::jsonb, p_new_receipt_id => v_id, p_receipt_entry => v_entry);
        RAISE EXCEPTION 'TEST_FAILED: foreign tenant/mission pointer accepted';
      EXCEPTION WHEN SQLSTATE 'P0002' OR SQLSTATE '22023' OR unique_violation THEN NULL;
      END;
    END LOOP;
  END LOOP;
  -- A valid entry cannot smuggle a different foreign pointer.
  BEGIN
    PERFORM public.update_mission_snapshot_atomic(
      '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 4,
      '{}'::jsonb, p_new_receipt_id => '77777777-7777-7777-7777-777777777777',
      p_receipt_entry => '{"receipt_id":"66666666-6666-6666-6666-666666666666","action_fingerprint":"mismatch"}');
    RAISE EXCEPTION 'TEST_FAILED: mismatched entry and pointer accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;
  SELECT to_jsonb(m) INTO v_after FROM public.marketing_missions m
    WHERE id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
  IF v_before IS DISTINCT FROM v_after
      OR v_events IS DISTINCT FROM (SELECT count(*) FROM public.mission_events)
      OR v_joins IS DISTINCT FROM (SELECT count(*) FROM public.mission_action_receipts) THEN
    RAISE EXCEPTION 'TEST_FAILED: rejected pointer call leaked changes';
  END IF;
  RAISE NOTICE 'SUCCESS: pointer-only and entry tenant/mission probes rejected atomically.';
END $$;

-- Unbound requests need authoritative mission evidence on both receipt input paths.
DO $$
DECLARE
  v_case integer;
  v_entry jsonb;
BEGIN
  FOR v_case IN 1..2 LOOP
    v_entry := CASE WHEN v_case = 2 THEN
      '{"receipt_id":"66666666-6666-6666-6666-666666666666","action_fingerprint":"binding-probe","provider":"meta"}'::jsonb
      ELSE NULL END;
    BEGIN
      UPDATE public.external_action_requests SET mission_id = NULL
        WHERE id = 'aaaaaaaa-1111-1111-1111-aaaaaaaaaaaa';
      PERFORM public.update_mission_snapshot_atomic(
        '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2',
        1, '{}', p_new_receipt_id => '66666666-6666-6666-6666-666666666666',
        p_receipt_entry => v_entry);
      RAISE EXCEPTION 'TEST_FAILED: unbound request accepted without mission evidence';
    EXCEPTION WHEN SQLSTATE '22023' THEN
      IF SQLERRM IS DISTINCT FROM '[MISSION_ACTION_BINDING_REQUIRED]' THEN
        RAISE;
      END IF;
    END;
    -- A mission's existing request pointer is sufficient authoritative backfill evidence.
    BEGIN
      UPDATE public.external_action_requests SET mission_id = NULL
        WHERE id = 'aaaaaaaa-1111-1111-1111-aaaaaaaaaaaa';
      UPDATE public.marketing_missions
        SET external_action_request_id = 'aaaaaaaa-1111-1111-1111-aaaaaaaaaaaa'
        WHERE id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
      PERFORM public.update_mission_snapshot_atomic(
        '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2',
        1, '{}', p_new_receipt_id => '66666666-6666-6666-6666-666666666666',
        p_receipt_entry => v_entry);
      IF (SELECT mission_id FROM public.external_action_requests
          WHERE id = 'aaaaaaaa-1111-1111-1111-aaaaaaaaaaaa')
          IS DISTINCT FROM 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2'::uuid THEN
        RAISE EXCEPTION 'TEST_FAILED: authoritative request binding was not persisted';
      END IF;
      RAISE EXCEPTION USING ERRCODE = 'P0099', MESSAGE = 'rollback successful binding probe';
    EXCEPTION WHEN SQLSTATE 'P0099' THEN NULL;
    END;
  END LOOP;
  RAISE NOTICE 'SUCCESS: unbound receipt rejection and authoritative binding backfill verified.';
END $$;

-- 17. Terminal state/outcome and epoch guards are independent of receipt-entry presence.
UPDATE public.marketing_missions SET metadata = metadata || '{"control_epoch":7}'::jsonb
WHERE id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
DO $$
DECLARE
  v_patch jsonb;
  v_entry jsonb;
  v_case integer;
  v_before jsonb;
  v_events integer;
  v_joins integer;
BEGIN
  SELECT to_jsonb(m) INTO v_before FROM public.marketing_missions m
    WHERE id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  SELECT count(*) INTO v_events FROM public.mission_events;
  SELECT count(*) INTO v_joins FROM public.mission_action_receipts;
  FOREACH v_patch IN ARRAY ARRAY[
      '{"execution_state":"RUNNING"}'::jsonb, '{"outcome_state":"PENDING"}'::jsonb,
      '{"control_epoch":0}'::jsonb, '{"control_epoch":null}'::jsonb,
      '{"control_epoch":"7"}'::jsonb, '{"control_epoch":7.5}'::jsonb] LOOP
    FOR v_case IN 1..2 LOOP
      v_entry := CASE WHEN v_case = 2 THEN
        '{"receipt_id":"66666666-6666-6666-6666-666666666666","action_fingerprint":"terminal-probe","provider":"meta"}'::jsonb
        ELSE NULL END;
      BEGIN
        PERFORM public.update_mission_snapshot_atomic(
          '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
          4, v_patch, p_receipt_entry => v_entry);
        -- Receipt readback preserves CLOSED rather than failing on a requested RUNNING state.
        IF NOT (v_case = 2 AND v_patch = '{"execution_state":"RUNNING"}'::jsonb) THEN
          RAISE EXCEPTION 'TEST_FAILED: terminal/epoch regression accepted';
        END IF;
        IF (SELECT metadata->>'execution_state' FROM public.marketing_missions
            WHERE id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') IS DISTINCT FROM 'CLOSED' THEN
          RAISE EXCEPTION 'TEST_FAILED: receipt restarted CLOSED mission';
        END IF;
        -- Roll successful late readback back to keep fixtures identical for all probes.
        RAISE EXCEPTION USING ERRCODE = 'P0099', MESSAGE = 'rollback successful preserved readback';
      EXCEPTION WHEN SQLSTATE '22023' OR SQLSTATE 'P0099' THEN NULL;
      END;
    END LOOP;
  END LOOP;
  FOR v_case IN 1..2 LOOP
    BEGIN
      PERFORM public.update_mission_snapshot_atomic(
        '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 4,
        CASE WHEN v_case = 1 THEN '{}'::jsonb ELSE '{"execution_state":"RUNNING","outcome_state":"PENDING","control_epoch":0}'::jsonb END,
        p_new_status => 'EXECUTING');
      RAISE EXCEPTION 'TEST_FAILED: COMPLETED -> EXECUTING accepted';
    EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
    END;
  END LOOP;
  -- A fabricated new contract must not reset a CLOSED mission.
  BEGIN
    PERFORM public.update_mission_snapshot_atomic(
      '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 4,
      '{"contract":{"contract_version":99,"approval_fingerprint":null},"observation_evidence":null,"outcome_state":"PENDING"}',
      p_event_name => 'MISSION_CONTRACT_UPDATED');
    RAISE EXCEPTION 'TEST_FAILED: terminal reset via forged event accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;
  IF v_before IS DISTINCT FROM (SELECT to_jsonb(m) FROM public.marketing_missions m
      WHERE id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')
      OR v_events IS DISTINCT FROM (SELECT count(*) FROM public.mission_events)
      OR v_joins IS DISTINCT FROM (SELECT count(*) FROM public.mission_action_receipts) THEN
    RAISE EXCEPTION 'TEST_FAILED: rejected terminal/epoch calls leaked changes';
  END IF;
  -- Epoch rejection also on a nonterminal mission (not masked by terminal guards).
  BEGIN
    PERFORM public.update_mission_snapshot_atomic(
      '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2',
      1, '{"control_epoch":0}');
    RAISE EXCEPTION 'TEST_FAILED: nonterminal epoch decrease accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;
  RAISE NOTICE 'SUCCESS: terminal/outcome/epoch regressions blocked with and without receipt entries.';
END $$;

-- 18. Canonical whitelist, explicit false, non-string evidence, paused late readback.
DO $$
DECLARE
  v_payload jsonb;
  v_expected boolean;
  v_result jsonb;
  v_receipt_id uuid;
  v_version integer := 1;
  v_index integer := 0;
  v_at timestamptz;
BEGIN
  UPDATE public.external_action_requests SET mission_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2'
    WHERE id = 'aaaaaaaa-1111-1111-1111-aaaaaaaaaaaa';
  FOREACH v_payload IN ARRAY ARRAY[
      '{"verified":true}'::jsonb, '{"readbackVerified":true}'::jsonb,
      '{"readbackRequestId":"read-1"}'::jsonb, '{"readbackDigest":"digest-1"}'::jsonb,
      '{"verified":false,"readbackRequestId":"read-1"}'::jsonb,
      '{"readbackVerified":false,"verified":true}'::jsonb,
      '{"readbackRequestId":123}'::jsonb, '{"readbackDigest":true}'::jsonb,
      '{"readbackRequestId":"  "}'::jsonb, '{}'::jsonb] LOOP
    v_index := v_index + 1;
    v_expected := v_index <= 4;
    v_receipt_id := gen_random_uuid();
    INSERT INTO public.external_action_receipts (id, workspace_id, action_request_id,
      receipt_kind, status, observed_payload, verified_at, recorded_by)
      VALUES (v_receipt_id, '11111111-1111-1111-1111-111111111111',
        'aaaaaaaa-1111-1111-1111-aaaaaaaaaaaa', 'observed_result', 'VERIFIED', v_payload,
        CASE WHEN v_expected THEN NULL ELSE '2026-10-27T10:00:00Z'::timestamptz END,
        '00000000-0000-0000-0000-000000000001');
    IF v_index = 4 THEN
      UPDATE public.marketing_missions SET status = 'PAUSED',
        metadata = metadata || '{"execution_state":"PAUSED"}'::jsonb
        WHERE id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
    END IF;
    v_result := public.update_mission_snapshot_atomic(
      '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2',
      v_version, '{"execution_state":"OBSERVING"}',
      p_receipt_entry => jsonb_build_object('receipt_id', v_receipt_id,
        'action_fingerprint', 'canonical-' || v_index, 'provider', 'meta'));
    v_version := v_version + 1;
    SELECT verified_at INTO v_at FROM public.mission_action_receipts WHERE action_receipt_id = v_receipt_id;
    IF (v_at IS NOT NULL) IS DISTINCT FROM v_expected THEN
      RAISE EXCEPTION 'TEST_FAILED: canonical whitelist result wrong for %', v_payload;
    END IF;
    IF (v_result#>>'{metadata,execution_state}') IS DISTINCT FROM (CASE WHEN v_index >= 4 THEN 'PAUSED' ELSE 'OBSERVING' END) THEN
      RAISE EXCEPTION 'TEST_FAILED: wrong receipt execution state';
    END IF;
  END LOOP;
  -- Pointer-only success on the correct durable binding.
  PERFORM public.update_mission_snapshot_atomic(
    '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2',
    v_version, '{}', p_new_receipt_id => v_receipt_id);
  RAISE NOTICE 'SUCCESS: canonical payload whitelist and paused late readback verified.';
END $$;

-- 19. Legal resume, stop->close, late outcome correction and new contract reset survive.
DO $$
DECLARE
  v_result jsonb;
BEGIN
  v_result := public.update_mission_snapshot_atomic(
    '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2', 12,
    '{"execution_state":"RUNNING","control_epoch":8}', p_new_status => 'EXECUTING');
  IF v_result#>>'{metadata,execution_state}' IS DISTINCT FROM 'RUNNING' THEN
    RAISE EXCEPTION 'TEST_FAILED: legal PAUSED resume lost';
  END IF;
  UPDATE public.marketing_missions SET metadata = metadata ||
    '{"outcome_state":"NOT_OBSERVABLE","contract":{"contract_version":1}}'::jsonb
    WHERE id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
  PERFORM public.update_mission_snapshot_atomic(
    '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2', 13,
    '{"outcome_state":"NOT_ACHIEVED_IN_WINDOW"}');
  PERFORM public.update_mission_snapshot_atomic(
    '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2', 14,
    '{"outcome_state":"ACHIEVED_VERIFIED"}');
  PERFORM public.update_mission_snapshot_atomic(
    '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2', 15,
    '{"contract":{"contract_version":2,"approval_fingerprint":null},"outcome_state":"PENDING","observation_evidence":null}');
  PERFORM public.update_mission_snapshot_atomic(
    '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2', 16,
    '{"execution_state":"STOPPED"}');
  v_result := public.update_mission_snapshot_atomic(
    '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2', 17,
    '{"execution_state":"CLOSED"}');
  IF v_result#>>'{metadata,execution_state}' IS DISTINCT FROM 'CLOSED'
      OR v_result#>>'{metadata,control_epoch}' IS DISTINCT FROM '8' THEN
    RAISE EXCEPTION 'TEST_FAILED: legal closure or epoch preservation lost';
  END IF;
END $$;

-- 20. Origin event and mission are one atomic command, including event-insert failure.
DO $$
DECLARE
  v_created jsonb;
  v_count integer;
  v_role text;
BEGIN
  v_created := public.create_mission_with_contract_atomic(
    '11111111-1111-1111-1111-111111111111', 'atomic-origin-test', 'RECEIVED', 'Atomic goal');
  IF (SELECT count(*) FROM public.mission_events WHERE mission_id = (v_created->>'id')::uuid
      AND event_name = 'MISSION_CONTRACT_INITIALIZED') IS DISTINCT FROM 1::bigint THEN
    RAISE EXCEPTION 'TEST_FAILED: expected exactly one atomic origin event';
  END IF;
  SELECT count(*) INTO v_count FROM public.marketing_missions;
  BEGIN
    PERFORM public.create_mission_with_contract_atomic(
      '11111111-1111-1111-1111-111111111111', 'atomic-event-failure', 'RECEIVED', 'Atomic goal',
      p_actor_type => 'invalid_actor');
    RAISE EXCEPTION 'TEST_FAILED: invalid event actor accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  IF v_count IS DISTINCT FROM (SELECT count(*) FROM public.marketing_missions) THEN
    RAISE EXCEPTION 'TEST_FAILED: origin event failure leaked a mission';
  END IF;
  FOREACH v_role IN ARRAY ARRAY['authenticated', 'anon'] LOOP
    EXECUTE format('SET LOCAL ROLE %I', v_role);
    BEGIN
      PERFORM public.create_mission_with_contract_atomic(
        '11111111-1111-1111-1111-111111111111', 'forbidden-origin', 'RECEIVED', 'Forbidden');
      RAISE EXCEPTION 'TEST_FAILED: client role can execute create atomic RPC';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    RESET ROLE;
  END LOOP;
  RAISE NOTICE 'SUCCESS: origin event atomic rollback and client RPC denial verified.';
END $$;

ROLLBACK;
