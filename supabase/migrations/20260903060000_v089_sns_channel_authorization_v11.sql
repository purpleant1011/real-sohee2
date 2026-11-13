-- ============================================================================
-- Migration: 20260903060000_v089_sns_channel_authorization_v11.sql
-- Description: SNS Channel Authorization V1.1 (Google Docs V1.1 정본 & ANI-613 ~ ANI-629)
--   1. channel_connections status enum 확장 (not_connected, authorizing, authorized, consent_pending, verifying, connected, verified, reverify_required, reauth_required, scope_incomplete, token_expired)
--   2. oauth_transactions 테이블 (Single-use state hash, TTL, correlation_id, anti-replay)
--   3. channel_consents 테이블 (3층 동의 원장: PLATFORM_AUTH, VERIFICATION_CONSENT, AUTONOMOUS_DELEGATION)
--   4. channel_verification_runs 테이블 (1회 인증 포스팅 및 Read-After-Write 결과 영수증)
--   5. browser_sessions 테이블 (원격 브라우저 세션 참조)
--   6. Legacy fake connected 백필 (reverify_required)
--   7. Server-Owned RPCs: save_channel_connection_v11 & complete_channel_verification_v11 & save_meta_channel_connection 강화
-- ============================================================================

-- 1. Extend channel_connections status check constraint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'channel_connections_status_check'
  ) THEN
    ALTER TABLE public.channel_connections DROP CONSTRAINT channel_connections_status_check;
  END IF;

  ALTER TABLE public.channel_connections
    ADD CONSTRAINT channel_connections_status_check
    CHECK (status IN (
      'not_connected',
      'authorizing',
      'authorized',
      'consent_pending',
      'verifying',
      'connected',
      'verified',
      'reverify_required',
      'reauth_required',
      'scope_incomplete',
      'token_expired',
      'active',
      'configured',
      'disconnected'
    ));
END $$;

-- Add external_account_id column to channel_connections if not exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'channel_connections' AND column_name = 'external_account_id'
  ) THEN
    ALTER TABLE public.channel_connections ADD COLUMN external_account_id TEXT;
  END IF;
END $$;

-- 2. Create oauth_transactions table
CREATE TABLE IF NOT EXISTS public.oauth_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  channel TEXT NOT NULL CHECK (channel IN ('instagram', 'threads')),
  state_hash TEXT NOT NULL UNIQUE,
  requested_scopes TEXT[] NOT NULL DEFAULT '{}',
  return_path TEXT NOT NULL DEFAULT '/app/settings/channels',
  correlation_id TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_oauth_transactions_lookup
  ON public.oauth_transactions(state_hash, workspace_id, user_id);

ALTER TABLE public.oauth_transactions ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'oauth_transactions' AND policyname = 'oauth_transactions_owner_select'
  ) THEN
    CREATE POLICY oauth_transactions_owner_select ON public.oauth_transactions
      FOR SELECT TO authenticated
      USING (
        workspace_id IN (
          SELECT workspace_id FROM public.workspace_members
          WHERE user_id = auth.uid()
        )
      );
  END IF;
END $$;

-- 3. Create channel_consents table
CREATE TABLE IF NOT EXISTS public.channel_consents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  channel TEXT NOT NULL,
  consent_tier TEXT NOT NULL CHECK (consent_tier IN ('PLATFORM_AUTH', 'VERIFICATION_CONSENT', 'AUTONOMOUS_DELEGATION')),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'REVOKED', 'EXPIRED')),
  capabilities JSONB NOT NULL DEFAULT '{}'::jsonb,
  policy_version TEXT NOT NULL DEFAULT 'v1.1',
  actor_user_id UUID NOT NULL REFERENCES auth.users(id),
  granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ,
  revoked_by UUID REFERENCES auth.users(id),
  revocation_reason TEXT,
  signature_sha256 TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_channel_consents_active UNIQUE(workspace_id, channel, consent_tier)
);

CREATE INDEX IF NOT EXISTS idx_channel_consents_active
  ON public.channel_consents(workspace_id, channel, status);

ALTER TABLE public.channel_consents ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'channel_consents' AND policyname = 'channel_consents_workspace_members_select'
  ) THEN
    CREATE POLICY channel_consents_workspace_members_select ON public.channel_consents
      FOR SELECT TO authenticated
      USING (
        workspace_id IN (
          SELECT workspace_id FROM public.workspace_members
          WHERE user_id = auth.uid()
        )
      );
  END IF;
END $$;

-- 4. Create channel_verification_runs table
CREATE TABLE IF NOT EXISTS public.channel_verification_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  channel TEXT NOT NULL,
  verification_code TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'POSTED', 'VERIFIED', 'FAILED')),
  action_request_id UUID,
  external_post_id TEXT,
  external_permalink TEXT,
  read_after_write_at TIMESTAMPTZ,
  error_message TEXT,
  verified_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_channel_verification_runs_ws
  ON public.channel_verification_runs(workspace_id, channel, created_at DESC);

ALTER TABLE public.channel_verification_runs ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'channel_verification_runs' AND policyname = 'channel_verification_runs_select'
  ) THEN
    CREATE POLICY channel_verification_runs_select ON public.channel_verification_runs
      FOR SELECT TO authenticated
      USING (
        workspace_id IN (
          SELECT workspace_id FROM public.workspace_members
          WHERE user_id = auth.uid()
        )
      );
  END IF;
END $$;

-- 5. Create browser_sessions table
CREATE TABLE IF NOT EXISTS public.browser_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  channel TEXT NOT NULL,
  session_type TEXT NOT NULL DEFAULT 'REMOTE_BROWSER',
  session_state TEXT NOT NULL CHECK (session_state IN ('CREATED', 'CONNECTED', 'DISCONNECTED', 'EXPIRED')),
  target_url TEXT NOT NULL,
  created_by UUID NOT NULL REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.browser_sessions ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'browser_sessions' AND policyname = 'browser_sessions_select'
  ) THEN
    CREATE POLICY browser_sessions_select ON public.browser_sessions
      FOR SELECT TO authenticated
      USING (
        workspace_id IN (
          SELECT workspace_id FROM public.workspace_members
          WHERE user_id = auth.uid()
        )
      );
  END IF;
END $$;

-- 6. Legacy connected without receipt backfill
UPDATE public.channel_connections cc
SET status = 'reverify_required',
    updated_at = NOW()
WHERE cc.status = 'connected'
  AND NOT EXISTS (
    SELECT 1 FROM public.external_action_receipts r
    WHERE r.workspace_id = cc.workspace_id
      AND r.receipt_kind IN ('INSTAGRAM_FEED_PUBLISH', 'THREADS_POST_PUBLISH')
      AND r.provider_reference IS NOT NULL
  );

-- 7. Server-Owned RPC: save_channel_connection_v11
CREATE OR REPLACE FUNCTION public.save_channel_connection_v11(
  p_workspace_id UUID,
  p_actor_user_id UUID,
  p_provider TEXT,
  p_external_account_id TEXT,
  p_account_label TEXT,
  p_encrypted_access_token TEXT,
  p_access_token_iv TEXT,
  p_granted_scopes TEXT[],
  p_token_expires_at TIMESTAMPTZ,
  p_refresh_after TIMESTAMPTZ,
  p_status TEXT DEFAULT 'authorized'
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role TEXT;
  v_existing_ws UUID;
  v_connection_id UUID;
BEGIN
  SELECT role INTO v_role
  FROM public.workspace_members
  WHERE workspace_id = p_workspace_id AND user_id = p_actor_user_id;

  IF v_role IS NULL OR (v_role <> 'owner' AND v_role <> 'manager') THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: User does not have owner or manager role in workspace';
  END IF;

  SELECT workspace_id INTO v_existing_ws
  FROM public.channel_connections
  WHERE channel = p_provider
    AND external_account_id = p_external_account_id
    AND workspace_id <> p_workspace_id
  LIMIT 1;

  IF v_existing_ws IS NOT NULL THEN
    RAISE EXCEPTION 'DUPLICATE_BINDING: Account % is already connected to another workspace', p_external_account_id;
  END IF;

  INSERT INTO public.channel_connections (
    workspace_id,
    channel,
    account_label,
    external_account_id,
    status,
    webhook_status,
    created_at,
    updated_at
  ) VALUES (
    p_workspace_id,
    p_provider,
    p_account_label,
    p_external_account_id,
    COALESCE(p_status, 'authorized'),
    'ready',
    NOW(),
    NOW()
  )
  ON CONFLICT (workspace_id, channel) DO UPDATE
  SET account_label = EXCLUDED.account_label,
      external_account_id = EXCLUDED.external_account_id,
      status = EXCLUDED.status,
      webhook_status = 'ready',
      updated_at = NOW()
  RETURNING id INTO v_connection_id;

  INSERT INTO public.meta_channel_credentials (
    workspace_id,
    connection_id,
    provider,
    external_account_id,
    encrypted_access_token,
    access_token_iv,
    encryption_algorithm,
    granted_scopes,
    token_expires_at,
    refresh_after,
    created_at,
    updated_at
  ) VALUES (
    p_workspace_id,
    v_connection_id,
    p_provider,
    p_external_account_id,
    p_encrypted_access_token,
    p_access_token_iv,
    'AES-GCM-256',
    p_granted_scopes,
    p_token_expires_at,
    p_refresh_after,
    NOW(),
    NOW()
  )
  ON CONFLICT (workspace_id, connection_id) DO UPDATE
  SET external_account_id = EXCLUDED.external_account_id,
      encrypted_access_token = EXCLUDED.encrypted_access_token,
      access_token_iv = EXCLUDED.access_token_iv,
      granted_scopes = EXCLUDED.granted_scopes,
      token_expires_at = EXCLUDED.token_expires_at,
      refresh_after = EXCLUDED.refresh_after,
      updated_at = NOW();

  RETURN v_connection_id;
END;
$$;

-- Backward compatibility upgrade for save_meta_channel_connection
CREATE OR REPLACE FUNCTION public.save_meta_channel_connection(
  p_workspace_id UUID,
  p_actor_user_id UUID,
  p_provider TEXT,
  p_external_account_id TEXT,
  p_account_label TEXT,
  p_encrypted_access_token TEXT,
  p_access_token_iv TEXT,
  p_granted_scopes TEXT[],
  p_token_expires_at TIMESTAMPTZ,
  p_refresh_after TIMESTAMPTZ
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN public.save_channel_connection_v11(
    p_workspace_id,
    p_actor_user_id,
    p_provider,
    p_external_account_id,
    p_account_label,
    p_encrypted_access_token,
    p_access_token_iv,
    p_granted_scopes,
    p_token_expires_at,
    p_refresh_after,
    'authorized'
  );
END;
$$;

-- Complete verification RPC
CREATE OR REPLACE FUNCTION public.complete_channel_verification_v11(
  p_workspace_id UUID,
  p_channel TEXT,
  p_action_request_id UUID,
  p_verification_code TEXT,
  p_external_post_id TEXT,
  p_permalink TEXT,
  p_actor_user_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.channel_verification_runs (
    workspace_id,
    channel,
    verification_code,
    status,
    action_request_id,
    external_post_id,
    external_permalink,
    read_after_write_at,
    verified_by,
    created_at
  ) VALUES (
    p_workspace_id,
    p_channel,
    p_verification_code,
    'VERIFIED',
    p_action_request_id,
    p_external_post_id,
    p_permalink,
    NOW(),
    p_actor_user_id,
    NOW()
  );

  UPDATE public.channel_connections
  SET status = 'connected',
      updated_at = NOW()
  WHERE workspace_id = p_workspace_id AND channel = p_channel;

  RETURN TRUE;
END;
$$;
