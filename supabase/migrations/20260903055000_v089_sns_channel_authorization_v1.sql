-- ==============================================================================
-- Migration: 20260903050000_v089_sns_channel_authorization_v1.sql
-- Description: SNS Channel Authorization V1 Schema & Invariant Recovery
-- Covers: ANI-601, ANI-612, ANI-614, ANI-617, ANI-625, ANI-628
-- ==============================================================================

-- 1. OAuth Single-Use Transactions Table (ANI-625)
CREATE TABLE IF NOT EXISTS public.oauth_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    provider TEXT NOT NULL,
    channel TEXT NOT NULL,
    state_hash TEXT NOT NULL UNIQUE,
    code_verifier TEXT,
    redirect_uri TEXT NOT NULL,
    requested_scopes TEXT[] NOT NULL DEFAULT '{}',
    return_path TEXT DEFAULT '/app/settings/channels',
    correlation_id TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Autonomous Channel Consent Ledger (ANI-617)
CREATE TABLE IF NOT EXISTS public.channel_consents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    channel TEXT NOT NULL,
    consent_type TEXT NOT NULL CHECK (consent_type IN ('PUBLISH', 'COMMENT_DM', 'BROWSER_DELEGATION', 'AUTONOMOUS_SCHEDULE')),
    is_granted BOOLEAN NOT NULL DEFAULT true,
    granted_at TIMESTAMPTZ DEFAULT now(),
    revoked_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ DEFAULT now(),
    CONSTRAINT uq_channel_consent UNIQUE (workspace_id, channel, consent_type)
);

-- 3. Channel Connections Canonical Extension (ANI-614, ANI-628)
ALTER TABLE public.channel_connections 
    ADD COLUMN IF NOT EXISTS token_vault_ref TEXT,
    ADD COLUMN IF NOT EXISTS token_expires_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS refresh_token_vault_ref TEXT,
    ADD COLUMN IF NOT EXISTS last_refreshed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS provider_account_id TEXT,
    ADD COLUMN IF NOT EXISTS profile_metadata JSONB DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS last_verified_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS verification_status TEXT DEFAULT 'UNVERIFIED';

-- 4. Browser Channel Connections Canonical Table (ANI-620, ANI-627)
CREATE TABLE IF NOT EXISTS public.browser_channel_connections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    channel TEXT NOT NULL,
    session_status TEXT NOT NULL DEFAULT 'DISCONNECTED',
    cookies_vault_ref TEXT,
    account_identifier TEXT,
    user_agent TEXT,
    last_health_checked_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ DEFAULT now(),
    CONSTRAINT uq_browser_conn UNIQUE (workspace_id, channel)
);

-- 5. Foreign Key Performance Indexes (ANI-612)
CREATE INDEX IF NOT EXISTS idx_oauth_tx_workspace_id ON public.oauth_transactions(workspace_id);
CREATE INDEX IF NOT EXISTS idx_oauth_tx_user_id ON public.oauth_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_oauth_tx_state_hash ON public.oauth_transactions(state_hash);
CREATE INDEX IF NOT EXISTS idx_channel_consents_workspace_id ON public.channel_consents(workspace_id);
CREATE INDEX IF NOT EXISTS idx_browser_conns_workspace_id ON public.browser_channel_connections(workspace_id);
CREATE INDEX IF NOT EXISTS idx_channel_conns_provider_account_id ON public.channel_connections(provider_account_id);

-- 6. Supabase Security Closure & RLS Hardening (ANI-601, ANI-628)
-- RLS Enablement
ALTER TABLE public.oauth_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.channel_consents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.browser_channel_connections ENABLE ROW LEVEL SECURITY;

-- Workspace Member Read-Only Policies (Clients can ONLY read their own workspace records)
DROP POLICY IF EXISTS "Members can view oauth_transactions" ON public.oauth_transactions;
CREATE POLICY "Members can view oauth_transactions" ON public.oauth_transactions
    FOR SELECT TO authenticated
    USING (
        workspace_id IN (
            SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS "Members can view channel_consents" ON public.channel_consents;
CREATE POLICY "Members can view channel_consents" ON public.channel_consents
    FOR SELECT TO authenticated
    USING (
        workspace_id IN (
            SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS "Members can view browser_channel_connections" ON public.browser_channel_connections;
CREATE POLICY "Members can view browser_channel_connections" ON public.browser_channel_connections
    FOR SELECT TO authenticated
    USING (
        workspace_id IN (
            SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()
        )
    );

-- Service Role Full Access (All mutations MUST be server-owned via API/service_role)
DROP POLICY IF EXISTS "Service role manage oauth_transactions" ON public.oauth_transactions;
CREATE POLICY "Service role manage oauth_transactions" ON public.oauth_transactions
    FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role manage channel_consents" ON public.channel_consents;
CREATE POLICY "Service role manage channel_consents" ON public.channel_consents
    FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role manage browser_channel_connections" ON public.browser_channel_connections;
CREATE POLICY "Service role manage browser_channel_connections" ON public.browser_channel_connections
    FOR ALL TO service_role USING (true) WITH CHECK (true);
