-- ==============================================================================
-- Migration: 20261016120000_booking_recovery_runtime.sql
-- Description: Booking Recovery Ledger, Versioned Approval Binding, Verified Slots,
--              Execution Outbox, and Atomic Server RPCs.
-- Tenancy: Strict workspace-scoped compound foreign keys, no process-memory SSOT.
-- ==============================================================================

-- 1. Prerequisites: Ensure btree_gist extension and marketing_missions compound key
CREATE EXTENSION IF NOT EXISTS btree_gist;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'marketing_missions_workspace_id_id_key'
  ) THEN
    ALTER TABLE public.marketing_missions ADD CONSTRAINT marketing_missions_workspace_id_id_key UNIQUE (workspace_id, id);
  END IF;
END $$;

-- 2. booking_recovery_cases table
CREATE TABLE IF NOT EXISTS public.booking_recovery_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  mission_id uuid NOT NULL,
  source_thread_id uuid NOT NULL,
  source_inbound_message_id uuid NOT NULL,
  customer_ref text NOT NULL,
  stage text NOT NULL,
  version int NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT chk_booking_recovery_cases_stage CHECK (
    stage IN (
      'DISCOVERED', 'NEEDS_CONTEXT', 'DRAFT_READY',
      'AWAITING_SEND_APPROVAL', 'SEND_REQUESTED', 'PROVIDER_ACCEPTED',
      'SEND_VERIFIED', 'AWAITING_CUSTOMER', 'CUSTOMER_ACCEPTED',
      'AWAITING_BOOKING_APPROVAL', 'BOOKING_CONFIRMED',
      'RESULT_UNKNOWN', 'NEEDS_RECONCILIATION',
      'HUMAN_REVIEW', 'BLOCKED', 'DECLINED', 'EXPIRED'
    )
  ),
  CONSTRAINT booking_recovery_cases_ws_source_msg_uniq UNIQUE (workspace_id, source_inbound_message_id),
  CONSTRAINT booking_recovery_cases_ws_id_uniq UNIQUE (workspace_id, id),
  CONSTRAINT booking_recovery_cases_mission_fk FOREIGN KEY (workspace_id, mission_id)
    REFERENCES public.marketing_missions (workspace_id, id) ON DELETE CASCADE,
  CONSTRAINT booking_recovery_cases_thread_fk FOREIGN KEY (workspace_id, source_thread_id)
    REFERENCES public.instagram_dm_threads (workspace_id, id) ON DELETE CASCADE,
  CONSTRAINT booking_recovery_cases_source_msg_fk FOREIGN KEY (workspace_id, source_inbound_message_id)
    REFERENCES public.instagram_dm_messages (workspace_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_booking_recovery_cases_ws_stage
  ON public.booking_recovery_cases (workspace_id, stage, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_booking_recovery_cases_ws_customer
  ON public.booking_recovery_cases (workspace_id, customer_ref);

-- 3. booking_recovery_steps audit event ledger (append-only)
CREATE TABLE IF NOT EXISTS public.booking_recovery_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  case_id uuid NOT NULL,
  kind text NOT NULL,
  status text NOT NULL CHECK (status IN ('CLAIMED', 'COMPLETED', 'FAILED')),
  input_fingerprint text NOT NULL,
  idempotency_key text NOT NULL,
  attempt int NOT NULL DEFAULT 1,
  claim_token uuid NOT NULL DEFAULT gen_random_uuid(),
  actor_id text NOT NULL,
  provider_message_id text,
  evidence_ref text,
  lease_until timestamptz,
  occurred_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT booking_recovery_steps_ws_idempotency_uniq UNIQUE (workspace_id, idempotency_key),
  CONSTRAINT booking_recovery_steps_ws_id_uniq UNIQUE (workspace_id, id),
  CONSTRAINT booking_recovery_steps_case_fk FOREIGN KEY (workspace_id, case_id)
    REFERENCES public.booking_recovery_cases (workspace_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_booking_recovery_steps_case_time
  ON public.booking_recovery_steps (workspace_id, case_id, occurred_at ASC);

-- Append-only trigger for booking_recovery_steps
CREATE OR REPLACE FUNCTION public.enforce_booking_recovery_steps_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    -- Only allow transition from CLAIMED to COMPLETED/FAILED, or extending lease on expired claim.
    -- Strict immutability for core identity columns.
    IF OLD.id != NEW.id OR OLD.workspace_id != NEW.workspace_id OR OLD.case_id != NEW.case_id
       OR OLD.idempotency_key != NEW.idempotency_key OR OLD.input_fingerprint != NEW.input_fingerprint THEN
      RAISE EXCEPTION 'booking_recovery_steps identity fields are strictly immutable'
        USING ERRCODE = '42501';
    END IF;

    IF OLD.status != 'CLAIMED' THEN
      RAISE EXCEPTION 'booking_recovery_steps in status % cannot be updated (immutable ledger)', OLD.status
        USING ERRCODE = '42501';
    END IF;

    IF NEW.status NOT IN ('CLAIMED', 'COMPLETED', 'FAILED') THEN
      RAISE EXCEPTION 'Invalid status transition for booking_recovery_steps: %', NEW.status
        USING ERRCODE = '22000';
    END IF;

    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    -- Prohibit direct DELETE if parent case still exists.
    -- Allows cascade deletion when parent case is deleted.
    IF EXISTS (
      SELECT 1 FROM public.booking_recovery_cases WHERE id = OLD.case_id
    ) THEN
      RAISE EXCEPTION 'Direct deletion of booking_recovery_steps is forbidden'
        USING ERRCODE = '42501';
    END IF;
    RETURN OLD;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_booking_recovery_steps_immutable ON public.booking_recovery_steps;
CREATE TRIGGER trg_booking_recovery_steps_immutable
  BEFORE UPDATE OR DELETE ON public.booking_recovery_steps
  FOR EACH ROW EXECUTE FUNCTION public.enforce_booking_recovery_steps_immutable();

-- 4. booking_recovery_approvals table (server-only authority)
CREATE TABLE IF NOT EXISTS public.booking_recovery_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  case_id uuid NOT NULL,
  step_kind text NOT NULL CHECK (step_kind IN ('SEND', 'BOOK')),
  payload_fingerprint text NOT NULL,
  case_version int NOT NULL CHECK (case_version > 0),
  source_message_id uuid NOT NULL,
  catalog_version text NOT NULL,
  slot_version int NOT NULL CHECK (slot_version > 0),
  approved_by uuid NOT NULL REFERENCES auth.users(id),
  approved_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,

  CONSTRAINT booking_recovery_approvals_ws_case_step_fp_uniq
    UNIQUE (workspace_id, case_id, step_kind, payload_fingerprint),
  CONSTRAINT booking_recovery_approvals_case_fk FOREIGN KEY (workspace_id, case_id)
    REFERENCES public.booking_recovery_cases (workspace_id, id) ON DELETE CASCADE,
  CONSTRAINT booking_recovery_approvals_source_msg_fk FOREIGN KEY (workspace_id, source_message_id)
    REFERENCES public.instagram_dm_messages (workspace_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_booking_recovery_approvals_ws_case
  ON public.booking_recovery_approvals (workspace_id, case_id, approved_at DESC);

-- 5. booking_recovery_slots table (owner confirmed availability)
CREATE TABLE IF NOT EXISTS public.booking_recovery_slots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  service_id uuid NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  deposit_krw int NOT NULL DEFAULT 0 CHECK (deposit_krw >= 0),
  catalog_version text NOT NULL,
  timezone text NOT NULL DEFAULT 'Asia/Seoul',
  confirmed_by uuid NOT NULL REFERENCES auth.users(id),
  confirmed_at timestamptz NOT NULL DEFAULT now(),
  valid_until timestamptz NOT NULL,
  version int NOT NULL DEFAULT 1 CHECK (version > 0),
  status text NOT NULL DEFAULT 'AVAILABLE' CHECK (status IN ('AVAILABLE', 'BOOKED', 'WITHDRAWN')),

  CONSTRAINT booking_recovery_slots_duration_chk CHECK (ends_at > starts_at),
  CONSTRAINT booking_recovery_slots_ws_id_uniq UNIQUE (workspace_id, id),
  CONSTRAINT booking_recovery_slots_service_fk FOREIGN KEY (workspace_id, service_id)
    REFERENCES public.workspace_products_services (workspace_id, id) ON DELETE CASCADE,
  CONSTRAINT booking_recovery_slots_no_overlap
    EXCLUDE USING gist (
      workspace_id WITH =,
      tstzrange(starts_at, ends_at) WITH &&
    ) WHERE (status IN ('AVAILABLE', 'BOOKED'))
);

CREATE INDEX IF NOT EXISTS idx_booking_recovery_slots_ws_status_starts
  ON public.booking_recovery_slots (workspace_id, status, starts_at ASC);

-- 6. booking_recovery_outbox table (reliable async state worker)
CREATE TABLE IF NOT EXISTS public.booking_recovery_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  case_id uuid NOT NULL,
  source_event_key text NOT NULL,
  kind text NOT NULL,
  state text NOT NULL DEFAULT 'PENDING' CHECK (state IN ('PENDING', 'CLAIMED', 'FINISHED', 'UNKNOWN')),
  lease_until timestamptz,
  attempt int NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT booking_recovery_outbox_ws_event_kind_uniq
    UNIQUE (workspace_id, source_event_key, kind),
  CONSTRAINT booking_recovery_outbox_case_fk FOREIGN KEY (workspace_id, case_id)
    REFERENCES public.booking_recovery_cases (workspace_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_booking_recovery_outbox_claim
  ON public.booking_recovery_outbox (workspace_id, state, next_attempt_at ASC)
  WHERE (state IN ('PENDING', 'UNKNOWN', 'CLAIMED'));

-- 7. Row Level Security (RLS)
DO $$
DECLARE
  rec_table text;
  tables text[] := ARRAY[
    'booking_recovery_cases',
    'booking_recovery_steps',
    'booking_recovery_approvals',
    'booking_recovery_slots',
    'booking_recovery_outbox'
  ];
BEGIN
  FOREACH rec_table IN ARRAY tables LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', rec_table);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated', rec_table);
    EXECUTE format('GRANT SELECT ON TABLE public.%I TO authenticated', rec_table);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO service_role', rec_table);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING ((SELECT private.is_workspace_member(workspace_id)))',
      rec_table || '_members_select', rec_table
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true)',
      rec_table || '_service_all', rec_table
    );
  END LOOP;
END $$;

-- 8. Atomic Server RPCs

-- RPC 1: open_booking_recovery
CREATE OR REPLACE FUNCTION public.open_booking_recovery(
  p_workspace_id uuid,
  p_source_inbound_message_id uuid,
  p_actor_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_msg record;
  v_thread record;
  v_existing_case record;
  v_mission_id uuid;
  v_case record;
  v_customer_stable_id text;
BEGIN
  -- 1. Caller Authorization Check (Workspace Member with manager/owner role and active status)
  IF NOT EXISTS (
    SELECT 1 FROM public.workspace_members
    WHERE workspace_id = p_workspace_id
      AND user_id = p_actor_id
      AND role IN ('owner', 'manager')
      AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'FORBIDDEN: Caller is not an authorized manager/owner of workspace %', p_workspace_id
      USING ERRCODE = '42501';
  END IF;

  -- 2. Advisory lock for serialized open on same inbound message
  PERFORM pg_advisory_xact_lock(hashtext('booking_recovery_open:' || p_source_inbound_message_id::text));

  -- 3. Lock & Inspect Inbound Message Row
  SELECT * INTO v_msg
  FROM public.instagram_dm_messages
  WHERE workspace_id = p_workspace_id
    AND id = p_source_inbound_message_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: Inbound message % not found in workspace %', p_source_inbound_message_id, p_workspace_id
      USING ERRCODE = 'P0002';
  END IF;

  IF v_msg.sender_type != 'customer' THEN
    RAISE EXCEPTION 'INVALID_SOURCE: Only customer messages can initiate a booking recovery case'
      USING ERRCODE = '22000';
  END IF;

  -- 4. Locate Thread & Validate Stable Customer Identity
  SELECT * INTO v_thread
  FROM public.instagram_dm_threads
  WHERE workspace_id = p_workspace_id
    AND id = v_msg.thread_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: Thread % not found in workspace %', v_msg.thread_id, p_workspace_id
      USING ERRCODE = 'P0002';
  END IF;

  IF v_msg.sender_id != v_thread.customer_id THEN
    RAISE EXCEPTION 'INVALID_SOURCE: Message sender_id (%) does not match thread customer_id (%)', v_msg.sender_id, v_thread.customer_id
      USING ERRCODE = '22000';
  END IF;

  v_customer_stable_id := v_thread.customer_id;

  -- 5. Idempotency Check: Existing case for this message
  SELECT * INTO v_existing_case
  FROM public.booking_recovery_cases
  WHERE workspace_id = p_workspace_id
    AND source_inbound_message_id = p_source_inbound_message_id;

  IF FOUND THEN
    RETURN to_jsonb(v_existing_case);
  END IF;

  -- 6. Atomically Create Marketing Mission Spine & Case with Exception Guard
  BEGIN
    INSERT INTO public.marketing_missions (
      workspace_id,
      trace_id,
      status,
      goal,
      metadata
    ) VALUES (
      p_workspace_id,
      'recovery_' || gen_random_uuid(),
      'RECEIVED',
      '예약 문의 회수 및 확정',
      jsonb_build_object(
        'recovery', true,
        'sourceInboundMessageId', p_source_inbound_message_id,
        'sourceThreadId', v_msg.thread_id,
        'customerRef', v_customer_stable_id
      )
    ) RETURNING id INTO v_mission_id;

    INSERT INTO public.booking_recovery_cases (
      workspace_id,
      mission_id,
      source_thread_id,
      source_inbound_message_id,
      customer_ref,
      stage,
      version
    ) VALUES (
      p_workspace_id,
      v_mission_id,
      v_msg.thread_id,
      p_source_inbound_message_id,
      v_customer_stable_id,
      'DISCOVERED',
      1
    ) RETURNING * INTO v_case;

    -- 7. Audit Step Log (status = COMPLETED)
    INSERT INTO public.booking_recovery_steps (
      workspace_id,
      case_id,
      kind,
      status,
      input_fingerprint,
      idempotency_key,
      attempt,
      actor_id
    ) VALUES (
      p_workspace_id,
      v_case.id,
      'OPEN_CASE',
      'COMPLETED',
      encode(sha256(convert_to(p_source_inbound_message_id::text, 'utf8')), 'hex'),
      'open:' || v_case.id || ':1',
      1,
      p_actor_id::text
    );

    RETURN to_jsonb(v_case);
  EXCEPTION
    WHEN unique_violation THEN
      SELECT * INTO v_existing_case
      FROM public.booking_recovery_cases
      WHERE workspace_id = p_workspace_id
        AND source_inbound_message_id = p_source_inbound_message_id;

      IF FOUND THEN
        RETURN to_jsonb(v_existing_case);
      ELSE
        RAISE;
      END IF;
  END;
END;
$$;

-- RPC 2: transition_booking_recovery (Atomic Version CAS with State Matrix Guard)
CREATE OR REPLACE FUNCTION public.transition_booking_recovery(
  p_workspace_id uuid,
  p_case_id uuid,
  p_expected_version int,
  p_next_stage text,
  p_actor_id uuid,
  p_step_kind text,
  p_fingerprint text,
  p_idempotency_key text,
  p_provider_msg_id text DEFAULT NULL,
  p_evidence_ref text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_case record;
  v_updated record;
  v_is_valid_transition boolean := false;
BEGIN
  -- 1. Caller Authorization Check
  IF NOT EXISTS (
    SELECT 1 FROM public.workspace_members
    WHERE workspace_id = p_workspace_id
      AND user_id = p_actor_id
      AND role IN ('owner', 'manager')
      AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'FORBIDDEN: Caller is not an authorized manager/owner of workspace %', p_workspace_id
      USING ERRCODE = '42501';
  END IF;

  -- 2. Explicit prohibition of generic transition to BOOKING_CONFIRMED
  IF p_next_stage = 'BOOKING_CONFIRMED' THEN
    RAISE EXCEPTION 'FORBIDDEN_TRANSITION: BOOKING_CONFIRMED cannot be set via generic transition; requires confirm_booking_recovery RPC'
      USING ERRCODE = '42501';
  END IF;

  -- 3. Lock Case Row & Verify Optimistic Version
  SELECT * INTO v_case
  FROM public.booking_recovery_cases
  WHERE workspace_id = p_workspace_id
    AND id = p_case_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: Case % not found in workspace %', p_case_id, p_workspace_id
      USING ERRCODE = 'P0002';
  END IF;

  IF v_case.version != p_expected_version THEN
    RAISE EXCEPTION 'VERSION_CONFLICT: Expected version % but found % for case %', p_expected_version, v_case.version, p_case_id
      USING ERRCODE = '40001';
  END IF;

  -- 4. Validate Stage Transition Matrix
  CASE v_case.stage
    WHEN 'DISCOVERED' THEN
      v_is_valid_transition := p_next_stage IN ('NEEDS_CONTEXT', 'DRAFT_READY', 'BLOCKED', 'EXPIRED', 'HUMAN_REVIEW');
    WHEN 'NEEDS_CONTEXT' THEN
      v_is_valid_transition := p_next_stage IN ('DRAFT_READY', 'BLOCKED', 'EXPIRED', 'HUMAN_REVIEW');
    WHEN 'DRAFT_READY' THEN
      v_is_valid_transition := p_next_stage IN ('AWAITING_SEND_APPROVAL', 'BLOCKED', 'EXPIRED', 'HUMAN_REVIEW');
    WHEN 'AWAITING_SEND_APPROVAL' THEN
      v_is_valid_transition := p_next_stage IN ('SEND_REQUESTED', 'DRAFT_READY', 'BLOCKED', 'EXPIRED', 'HUMAN_REVIEW');
    WHEN 'SEND_REQUESTED' THEN
      v_is_valid_transition := p_next_stage IN ('PROVIDER_ACCEPTED', 'SEND_VERIFIED', 'RESULT_UNKNOWN', 'BLOCKED', 'HUMAN_REVIEW');
    WHEN 'PROVIDER_ACCEPTED' THEN
      v_is_valid_transition := p_next_stage IN ('SEND_VERIFIED', 'RESULT_UNKNOWN', 'BLOCKED', 'HUMAN_REVIEW');
    WHEN 'SEND_VERIFIED' THEN
      v_is_valid_transition := p_next_stage IN ('AWAITING_CUSTOMER', 'BLOCKED', 'EXPIRED', 'HUMAN_REVIEW');
    WHEN 'AWAITING_CUSTOMER' THEN
      v_is_valid_transition := p_next_stage IN ('CUSTOMER_ACCEPTED', 'DECLINED', 'EXPIRED', 'HUMAN_REVIEW');
    WHEN 'CUSTOMER_ACCEPTED' THEN
      v_is_valid_transition := p_next_stage IN ('AWAITING_BOOKING_APPROVAL', 'BLOCKED', 'EXPIRED', 'HUMAN_REVIEW');
    WHEN 'AWAITING_BOOKING_APPROVAL' THEN
      v_is_valid_transition := p_next_stage IN ('BLOCKED', 'EXPIRED', 'HUMAN_REVIEW');
    WHEN 'RESULT_UNKNOWN' THEN
      v_is_valid_transition := p_next_stage IN ('NEEDS_RECONCILIATION', 'HUMAN_REVIEW');
    WHEN 'NEEDS_RECONCILIATION' THEN
      v_is_valid_transition := p_next_stage IN ('SEND_VERIFIED', 'RESULT_UNKNOWN', 'HUMAN_REVIEW');
    WHEN 'HUMAN_REVIEW' THEN
      v_is_valid_transition := p_next_stage IN ('DRAFT_READY', 'AWAITING_SEND_APPROVAL', 'AWAITING_CUSTOMER', 'AWAITING_BOOKING_APPROVAL', 'BLOCKED', 'DECLINED', 'EXPIRED');
    ELSE
      v_is_valid_transition := false;
  END CASE;

  IF NOT v_is_valid_transition THEN
    RAISE EXCEPTION 'INVALID_STAGE_TRANSITION: Cannot transition case % from % to %', p_case_id, v_case.stage, p_next_stage
      USING ERRCODE = '22000';
  END IF;

  -- 5. Evidence & Fingerprint Guards
  IF p_next_stage IN ('AWAITING_SEND_APPROVAL', 'SEND_REQUESTED') THEN
    IF p_fingerprint IS NULL OR p_fingerprint !~ '^[a-f0-9]{64}$' THEN
      RAISE EXCEPTION 'INVALID_FINGERPRINT: A valid 64-character hex fingerprint is required for stage %', p_next_stage
        USING ERRCODE = '22000';
    END IF;
  END IF;

  IF p_next_stage IN ('PROVIDER_ACCEPTED', 'SEND_VERIFIED') THEN
    IF p_provider_msg_id IS NULL OR length(trim(p_provider_msg_id)) = 0 THEN
      RAISE EXCEPTION 'EVIDENCE_REQUIRED: provider_message_id is required for stage %', p_next_stage
        USING ERRCODE = '22000';
    END IF;
  END IF;

  -- 6. Update Case Stage and Increment Version
  UPDATE public.booking_recovery_cases
  SET stage = p_next_stage,
      version = v_case.version + 1,
      updated_at = now()
  WHERE id = p_case_id
  RETURNING * INTO v_updated;

  -- 7. Record Audit Step
  INSERT INTO public.booking_recovery_steps (
    workspace_id,
    case_id,
    kind,
    status,
    input_fingerprint,
    idempotency_key,
    attempt,
    actor_id,
    provider_message_id,
    evidence_ref
  ) VALUES (
    p_workspace_id,
    p_case_id,
    p_step_kind,
    'COMPLETED',
    p_fingerprint,
    p_idempotency_key,
    1,
    p_actor_id::text,
    p_provider_msg_id,
    p_evidence_ref
  );

  RETURN to_jsonb(v_updated);
END;
$$;

-- RPC 3: claim_booking_recovery_step (Execution lease CAS & idempotency)
CREATE OR REPLACE FUNCTION public.claim_booking_recovery_step(
  p_workspace_id uuid,
  p_case_id uuid,
  p_kind text,
  p_idempotency_key text,
  p_actor_id uuid,
  p_input_fingerprint text,
  p_lease_seconds int DEFAULT 60
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_step record;
  v_lease_until timestamptz;
  v_new_claim_token uuid;
BEGIN
  -- 1. Caller Authorization Check
  IF NOT EXISTS (
    SELECT 1 FROM public.workspace_members
    WHERE workspace_id = p_workspace_id
      AND user_id = p_actor_id
      AND role IN ('owner', 'manager')
      AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'FORBIDDEN: Caller is not an authorized manager/owner of workspace %', p_workspace_id
      USING ERRCODE = '42501';
  END IF;

  -- 2. Validate lease duration bounds (1 to 3600 seconds)
  IF p_lease_seconds IS NULL OR p_lease_seconds < 1 OR p_lease_seconds > 3600 THEN
    RAISE EXCEPTION 'INVALID_LEASE_DURATION: lease_seconds must be between 1 and 3600'
      USING ERRCODE = '22000';
  END IF;

  -- 3. Verify Case exists
  IF NOT EXISTS (
    SELECT 1 FROM public.booking_recovery_cases
    WHERE workspace_id = p_workspace_id AND id = p_case_id
  ) THEN
    RAISE EXCEPTION 'NOT_FOUND: Case % not found in workspace %', p_case_id, p_workspace_id
      USING ERRCODE = 'P0002';
  END IF;

  -- 4. Validate Fingerprint format
  IF p_input_fingerprint IS NULL OR p_input_fingerprint !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'INVALID_FINGERPRINT: Valid 64-char hex SHA256 required'
      USING ERRCODE = '22000';
  END IF;

  v_lease_until := now() + (p_lease_seconds || ' seconds')::interval;

  -- 5. Check if Step row already exists with row lock
  SELECT * INTO v_step
  FROM public.booking_recovery_steps
  WHERE workspace_id = p_workspace_id
    AND idempotency_key = p_idempotency_key
  FOR UPDATE;

  IF FOUND THEN
    -- Invariant: Reject logical operation binding conflict (different case, kind, or fingerprint)
    IF v_step.case_id != p_case_id OR v_step.kind != p_kind OR v_step.input_fingerprint != p_input_fingerprint THEN
      RAISE EXCEPTION 'IDEMPOTENCY_BINDING_CONFLICT: Step % is already bound to a different case/kind/fingerprint', p_idempotency_key
        USING ERRCODE = '22000';
    END IF;

    IF v_step.status = 'COMPLETED' THEN
      RETURN jsonb_build_object('claimed', false, 'reason', 'ALREADY_COMPLETED', 'step', to_jsonb(v_step));
    ELSIF v_step.status = 'CLAIMED' AND v_step.lease_until IS NOT NULL AND v_step.lease_until > now() THEN
      RETURN jsonb_build_object('claimed', false, 'reason', 'LOCKED_BY_ANOTHER_WORKER', 'lease_until', v_step.lease_until);
    ELSIF v_step.status = 'CLAIMED' AND (v_step.lease_until IS NULL OR v_step.lease_until <= now()) THEN
      -- Reclaim expired lease with fresh claim_token and incremented attempt
      v_new_claim_token := gen_random_uuid();
      UPDATE public.booking_recovery_steps
      SET attempt = attempt + 1,
          claim_token = v_new_claim_token,
          lease_until = v_lease_until,
          actor_id = p_actor_id::text
      WHERE id = v_step.id
      RETURNING * INTO v_step;

      RETURN jsonb_build_object(
        'claimed', true,
        'reclaimed', true,
        'claim_token', v_new_claim_token,
        'attempt', v_step.attempt,
        'step', to_jsonb(v_step)
      );
    ELSE
      RETURN jsonb_build_object('claimed', false, 'reason', 'STEP_FINALIZED', 'status', v_step.status);
    END IF;
  ELSE
    -- Initial Claim with concurrency race safety (ON CONFLICT DO NOTHING)
    v_new_claim_token := gen_random_uuid();
    INSERT INTO public.booking_recovery_steps (
      workspace_id,
      case_id,
      kind,
      status,
      input_fingerprint,
      idempotency_key,
      attempt,
      claim_token,
      actor_id,
      lease_until
    ) VALUES (
      p_workspace_id,
      p_case_id,
      p_kind,
      'CLAIMED',
      p_input_fingerprint,
      p_idempotency_key,
      1,
      v_new_claim_token,
      p_actor_id::text,
      v_lease_until
    )
    ON CONFLICT (workspace_id, idempotency_key) DO NOTHING
    RETURNING * INTO v_step;

    IF v_step.id IS NOT NULL THEN
      RETURN jsonb_build_object(
        'claimed', true,
        'reclaimed', false,
        'claim_token', v_new_claim_token,
        'attempt', 1,
        'step', to_jsonb(v_step)
      );
    ELSE
      -- Concurrent insertion happened: re-read locked row
      SELECT * INTO v_step
      FROM public.booking_recovery_steps
      WHERE workspace_id = p_workspace_id
        AND idempotency_key = p_idempotency_key
      FOR UPDATE;

      RETURN jsonb_build_object(
        'claimed', false,
        'reason', 'LOCKED_BY_ANOTHER_WORKER',
        'lease_until', v_step.lease_until
      );
    END IF;
  END IF;
END;
$$;

-- RPC 4: claim_booking_recovery_outbox
CREATE OR REPLACE FUNCTION public.claim_booking_recovery_outbox(
  p_workspace_id uuid,
  p_lease_seconds int DEFAULT 60
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_outbox record;
BEGIN
  -- Validate lease duration bounds
  IF p_lease_seconds IS NULL OR p_lease_seconds < 1 OR p_lease_seconds > 3600 THEN
    RAISE EXCEPTION 'INVALID_LEASE_DURATION: lease_seconds must be between 1 and 3600'
      USING ERRCODE = '22000';
  END IF;

  -- Select either pending jobs due for execution (state = 'PENDING' ONLY, never UNKNOWN) or expired claimed jobs to demote
  SELECT * INTO v_outbox
  FROM public.booking_recovery_outbox
  WHERE workspace_id = p_workspace_id
    AND (
      (state = 'PENDING' AND next_attempt_at <= now())
      OR
      (state = 'CLAIMED' AND lease_until IS NOT NULL AND lease_until < now())
    )
  ORDER BY
    CASE WHEN state = 'CLAIMED' THEN 0 ELSE 1 END,
    next_attempt_at ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- Safety Invariant: If a job was already CLAIMED and its lease expired without finishing,
  -- execution might have started (e.g. provider crash/timeout).
  -- NEVER reissue an execution claim automatically (prevents duplicate sends).
  -- Demote directly to UNKNOWN for readback reconciliation only.
  -- Once in UNKNOWN, it is NEVER eligible for claim_booking_recovery_outbox execution.
  IF v_outbox.state = 'CLAIMED' THEN
    UPDATE public.booking_recovery_outbox
    SET state = 'UNKNOWN',
        lease_until = NULL,
        updated_at = now()
    WHERE id = v_outbox.id
    RETURNING * INTO v_outbox;

    RETURN jsonb_build_object(
      'claimed', false,
      'status', 'MOVED_TO_UNKNOWN_RECONCILE_ONLY',
      'outbox', to_jsonb(v_outbox)
    );
  END IF;

  -- Normal claim for PENDING items only
  UPDATE public.booking_recovery_outbox
  SET state = 'CLAIMED',
      lease_until = now() + (p_lease_seconds || ' seconds')::interval,
      attempt = attempt + 1,
      updated_at = now()
  WHERE id = v_outbox.id
  RETURNING * INTO v_outbox;

  RETURN jsonb_build_object(
    'claimed', true,
    'status', 'CLAIMED',
    'outbox', to_jsonb(v_outbox)
  );
END;
$$;

-- Revoke RPC execution from public/anon/authenticated; grant only to service_role
REVOKE EXECUTE ON FUNCTION public.open_booking_recovery(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.transition_booking_recovery(uuid, uuid, int, text, uuid, text, text, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.claim_booking_recovery_step(uuid, uuid, text, text, uuid, text, int) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.claim_booking_recovery_outbox(uuid, int) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.open_booking_recovery(uuid, uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.transition_booking_recovery(uuid, uuid, int, text, uuid, text, text, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_booking_recovery_step(uuid, uuid, text, text, uuid, text, int) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_booking_recovery_outbox(uuid, int) TO service_role;
