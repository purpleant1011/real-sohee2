-- ==============================================================================
-- Migration: 20261027100000_ani1796_mission_events_composite_fk.sql
-- Description: Composite FK enforcement on mission_events(workspace_id, mission_id),
--              multi-action receipt join table with composite FKs and RLS,
--              and atomic optimistic concurrency update RPC with snapshot versioning.
-- Traceability: ANI-1796, ANI-1801, ANI-1802, ANI-1877
-- ==============================================================================

-- 1. Ensure composite FK on mission_events for strict tenant boundary
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'mission_events_workspace_mission_fkey'
  ) THEN
    -- Ensure compound constraint on marketing_missions exists first
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = 'marketing_missions_workspace_id_id_key'
    ) THEN
      ALTER TABLE public.marketing_missions
        ADD CONSTRAINT marketing_missions_workspace_id_id_key UNIQUE (workspace_id, id);
    END IF;

    -- Add compound foreign key constraint on mission_events
    -- Since mission_id can be null for pre-mission funnel events (R2-B9),
    -- PostgreSQL automatically allows NULLs in composite foreign keys.
    ALTER TABLE public.mission_events
      ADD CONSTRAINT mission_events_workspace_mission_fkey
      FOREIGN KEY (workspace_id, mission_id)
      REFERENCES public.marketing_missions (workspace_id, id)
      ON DELETE CASCADE;
  END IF;
END $$;

-- 2. Index to accelerate composite lookups on mission_events
CREATE INDEX IF NOT EXISTS idx_mission_events_workspace_mission_compound
  ON public.mission_events (workspace_id, mission_id)
  WHERE mission_id IS NOT NULL;

-- 3. Multi-action receipt join table with strict workspace composite FKs
CREATE TABLE IF NOT EXISTS public.mission_action_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  mission_id uuid NOT NULL,
  action_request_id uuid NOT NULL,
  action_receipt_id uuid NOT NULL,
  action_fingerprint text NOT NULL,
  provider text NOT NULL,
  cost_minor_units bigint DEFAULT 0,
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),

  CONSTRAINT mission_action_receipts_workspace_id_id_key UNIQUE (workspace_id, id),
  CONSTRAINT mission_action_receipts_mission_receipt_unique UNIQUE (workspace_id, mission_id, action_receipt_id),
  CONSTRAINT mission_action_receipts_mission_fingerprint_unique UNIQUE (workspace_id, mission_id, action_fingerprint),
  CONSTRAINT mission_action_receipts_mission_fkey
    FOREIGN KEY (workspace_id, mission_id)
    REFERENCES public.marketing_missions (workspace_id, id)
    ON DELETE CASCADE,
  CONSTRAINT mission_action_receipts_request_fkey
    FOREIGN KEY (workspace_id, action_request_id)
    REFERENCES public.external_action_requests (workspace_id, id)
    ON DELETE CASCADE,
  CONSTRAINT mission_action_receipts_receipt_fkey
    FOREIGN KEY (workspace_id, action_receipt_id)
    REFERENCES public.external_action_receipts (workspace_id, id)
    ON DELETE RESTRICT
);

-- Indexes for mission_action_receipts
CREATE INDEX IF NOT EXISTS idx_mission_action_receipts_workspace_mission
  ON public.mission_action_receipts (workspace_id, mission_id);
CREATE INDEX IF NOT EXISTS idx_mission_action_receipts_workspace_request
  ON public.mission_action_receipts (workspace_id, action_request_id);
CREATE INDEX IF NOT EXISTS idx_mission_action_receipts_workspace_receipt
  ON public.mission_action_receipts (workspace_id, action_receipt_id);
CREATE INDEX IF NOT EXISTS idx_mission_action_receipts_fingerprint
  ON public.mission_action_receipts (workspace_id, action_fingerprint);

-- Enable RLS on mission_action_receipts
ALTER TABLE public.mission_action_receipts ENABLE ROW LEVEL SECURITY;

-- Read policy: tenant members or owner
DROP POLICY IF EXISTS "mission_action_receipts_select_policy" ON public.mission_action_receipts;
CREATE POLICY "mission_action_receipts_select_policy"
  ON public.mission_action_receipts
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.workspace_members wm
      WHERE wm.workspace_id = mission_action_receipts.workspace_id
        AND wm.user_id = auth.uid()
        AND wm.status = 'active'
    )
    OR
    EXISTS (
      SELECT 1 FROM public.workspaces w
      WHERE w.id = mission_action_receipts.workspace_id
        AND w.created_by = auth.uid()
    )
  );

-- Service role full access
DROP POLICY IF EXISTS "mission_action_receipts_service_role_policy" ON public.mission_action_receipts;
CREATE POLICY "mission_action_receipts_service_role_policy"
  ON public.mission_action_receipts
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- 4. Atomic optimistic concurrency update RPC
-- Prevents lost updates when concurrent workers attempt state transitions, receipts, or contract updates.
-- Handles multi-action receipt join creation within the same atomic transaction.
CREATE OR REPLACE FUNCTION public.update_mission_snapshot_atomic(
  p_workspace_id uuid,
  p_mission_id uuid,
  p_expected_snapshot_version integer,
  p_new_metadata jsonb,
  p_new_status text DEFAULT NULL,
  p_new_goal text DEFAULT NULL,
  p_new_receipt_id uuid DEFAULT NULL,
  p_actor_type text DEFAULT 'agent',
  p_actor_id text DEFAULT NULL,
  p_event_name text DEFAULT 'MISSION_SNAPSHOT_UPDATED',
  p_event_payload jsonb DEFAULT '{}'::jsonb,
  p_receipt_entry jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mission public.marketing_missions%ROWTYPE;
  v_current_version integer;
  v_next_version integer;
  v_from_status text;
  v_now timestamptz := timezone('utc'::text, now());
  v_result jsonb;
BEGIN
  -- Strict input validation: expected version must be provided
  IF p_expected_snapshot_version IS NULL THEN
    RAISE EXCEPTION '[INVALID_SNAPSHOT_VERSION] expected_snapshot_version cannot be null'
      USING ERRCODE = '22023';
  END IF;

  -- Strict row-level lock within the verified workspace boundary
  SELECT * INTO v_mission
  FROM public.marketing_missions
  WHERE id = p_mission_id AND workspace_id = p_workspace_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '[MISSION_NOT_FOUND] Mission % not found in workspace %', p_mission_id, p_workspace_id
      USING ERRCODE = 'P0002';
  END IF;

  -- Extract current snapshot version (default 1 for historical rows)
  v_current_version := COALESCE((v_mission.metadata->>'snapshot_version')::integer, 1);

  -- Concurrency check: must match expected snapshot version
  IF v_current_version <> p_expected_snapshot_version THEN
    RAISE EXCEPTION '[STALE_SNAPSHOT_VERSION] Concurrency conflict: current snapshot version % does not match expected %',
      v_current_version, p_expected_snapshot_version
      USING ERRCODE = 'P0004';
  END IF;

  -- If a receipt entry is provided, validate against ledger and record join atomically
  IF p_receipt_entry IS NOT NULL THEN
    DECLARE
      v_receipt_id uuid := (p_receipt_entry->>'receipt_id')::uuid;
      v_request_id uuid := (p_receipt_entry->>'action_request_id')::uuid;
      v_fingerprint text := p_receipt_entry->>'action_fingerprint';
      v_provider text := COALESCE(p_receipt_entry->>'provider', 'unknown');
      v_cost bigint := COALESCE((p_receipt_entry->>'cost_minor_units')::bigint, 0);
      v_actual_request_id uuid;
      v_actual_verified_at timestamptz;
      v_final_verified_at timestamptz;
    BEGIN
      IF v_receipt_id IS NULL THEN
        RAISE EXCEPTION '[INVALID_RECEIPT] receipt_id cannot be null' USING ERRCODE = '22023';
      END IF;

      IF v_fingerprint IS NULL OR trim(v_fingerprint) = '' THEN
        RAISE EXCEPTION '[INVALID_RECEIPT] action_fingerprint cannot be null or empty' USING ERRCODE = '22023';
      END IF;

      -- Validate receipt exists within verified workspace and retrieve authoritative request_id and verified_at
      SELECT action_request_id, verified_at
      INTO v_actual_request_id, v_actual_verified_at
      FROM public.external_action_receipts
      WHERE id = v_receipt_id AND workspace_id = p_workspace_id;

      IF NOT FOUND THEN
        RAISE EXCEPTION '[RECEIPT_NOT_FOUND] Receipt % not found in workspace %', v_receipt_id, p_workspace_id
          USING ERRCODE = 'P0002';
      END IF;

      -- If request_id was provided, enforce match with receipt ledger
      IF v_request_id IS NOT NULL AND v_request_id <> v_actual_request_id THEN
        RAISE EXCEPTION '[REQUEST_MISMATCH] action_request_id % does not match receipt ledger request %',
          v_request_id, v_actual_request_id
          USING ERRCODE = '22023';
      END IF;

      v_request_id := v_actual_request_id;
      -- Never forge verified timestamp: only trust actual verified_at from ledger
      v_final_verified_at := v_actual_verified_at;

      INSERT INTO public.mission_action_receipts (
        workspace_id,
        mission_id,
        action_request_id,
        action_receipt_id,
        action_fingerprint,
        provider,
        cost_minor_units,
        verified_at
      ) VALUES (
        p_workspace_id,
        p_mission_id,
        v_request_id,
        v_receipt_id,
        v_fingerprint,
        v_provider,
        v_cost,
        v_final_verified_at
      );

      -- Normalize multi_receipts in p_new_metadata to match authoritative ledger truth
      IF p_new_metadata ? 'multi_receipts' AND jsonb_typeof(p_new_metadata->'multi_receipts') = 'array' THEN
        DECLARE
          v_elem jsonb;
          v_normalized_array jsonb := '[]'::jsonb;
          v_elem_receipt_id text;
        BEGIN
          FOR v_elem IN SELECT * FROM jsonb_array_elements(p_new_metadata->'multi_receipts')
          LOOP
            v_elem_receipt_id := COALESCE(v_elem->>'receipt_id', v_elem->>'receiptId');
            IF v_elem_receipt_id = v_receipt_id::text THEN
              v_elem := v_elem
                || jsonb_build_object(
                     'actionRequestId', to_jsonb(v_actual_request_id),
                     'action_request_id', to_jsonb(v_actual_request_id),
                     'verifiedAt', to_jsonb(v_actual_verified_at),
                     'verified_at', to_jsonb(v_actual_verified_at)
                   );
            END IF;
            v_normalized_array := v_normalized_array || jsonb_build_array(v_elem);
          END LOOP;
          p_new_metadata := jsonb_set(p_new_metadata, '{multi_receipts}', v_normalized_array);
        END;
      END IF;

      -- If receipt is unverified in ledger, execution_state must not be OBSERVING (safeguard)
      IF v_actual_verified_at IS NULL AND (p_new_metadata->>'execution_state') = 'OBSERVING' THEN
        p_new_metadata := jsonb_set(p_new_metadata, '{execution_state}', '"WAITING_EXTERNAL"'::jsonb);
      END IF;
    END;
  END IF;

  v_next_version := v_current_version + 1;
  v_from_status := v_mission.status;

  -- Merge metadata with new snapshot version
  v_mission.metadata := COALESCE(v_mission.metadata, '{}'::jsonb) || p_new_metadata || jsonb_build_object('snapshot_version', v_next_version);

  IF p_new_status IS NOT NULL THEN
    v_mission.status := p_new_status;
  END IF;

  IF p_new_goal IS NOT NULL THEN
    v_mission.goal := p_new_goal;
  END IF;

  IF p_new_receipt_id IS NOT NULL THEN
    v_mission.external_action_receipt_id := p_new_receipt_id;
  END IF;

  v_mission.updated_at := v_now;

  -- Apply update atomically
  UPDATE public.marketing_missions
  SET
    status = v_mission.status,
    goal = v_mission.goal,
    external_action_receipt_id = v_mission.external_action_receipt_id,
    metadata = v_mission.metadata,
    updated_at = v_mission.updated_at
  WHERE id = p_mission_id AND workspace_id = p_workspace_id;

  -- Append audit event atomically within the same transaction preserving from_status
  INSERT INTO public.mission_events (
    workspace_id,
    mission_id,
    trace_id,
    from_status,
    to_status,
    actor_type,
    actor_id,
    event_name,
    payload,
    occurred_at
  ) VALUES (
    p_workspace_id,
    p_mission_id,
    v_mission.trace_id,
    v_from_status,
    v_mission.status,
    p_actor_type,
    p_actor_id,
    p_event_name,
    p_event_payload || jsonb_build_object('applied_snapshot_version', v_next_version),
    v_now
  );

  v_result := to_jsonb(v_mission);
  RETURN v_result;
END;
$$;

-- Grant execution to service_role (server-only boundary)
REVOKE EXECUTE ON FUNCTION public.update_mission_snapshot_atomic FROM public;
GRANT EXECUTE ON FUNCTION public.update_mission_snapshot_atomic TO service_role;
