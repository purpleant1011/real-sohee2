-- SOHEE Harness Knowledge OS v1.1 Canonical Data Schema
-- Governed by PRD v1.1 Section 9 & Section 27

-- 1. Source Entities Table (Stable Identity & Handle History)
CREATE TABLE IF NOT EXISTS public.harness_source_entities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK (platform IN ('instagram', 'threads', 'naver_blog', 'generic')),
  source_type TEXT NOT NULL CHECK (source_type IN ('PROFILE', 'POST', 'THREAD', 'BLOG_ARTICLE', 'FEED', 'MANUAL')),
  source_entity_key TEXT NOT NULL,
  platform_native_entity_id TEXT,
  canonical_url_current TEXT NOT NULL,
  source_url_aliases TEXT[] NOT NULL DEFAULT '{}',
  source_handle_current TEXT NOT NULL,
  source_handle_history TEXT[] NOT NULL DEFAULT '{}',
  resolved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_harness_source_entity UNIQUE (workspace_id, source_entity_key, source_type)
);

-- 2. Harness Assets Table (Tenant-owned Marketing Execution Asset)
CREATE TABLE IF NOT EXISTS public.harness_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  asset_type TEXT NOT NULL DEFAULT 'ATOMIC_SOURCE' CHECK (asset_type IN ('ATOMIC_SOURCE', 'MANUAL_PRIVATE', 'DERIVED_PRIVATE', 'COMPOSITE_PRIVATE')),
  source_entity_id UUID REFERENCES public.harness_source_entities(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'PRIVATE' CHECK (visibility IN ('PRIVATE', 'SYSTEM_SEED_REFERENCE')),
  overall_status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (overall_status IN ('DRAFT', 'ANALYZING', 'PARTIAL', 'READY', 'STALE', 'ARCHIVED', 'FAILED')),
  active_version_id UUID,
  active_version_no INTEGER NOT NULL DEFAULT 0,
  platform TEXT NOT NULL CHECK (platform IN ('instagram', 'threads', 'naver_blog', 'generic')),
  source_url TEXT NOT NULL,
  source_handle TEXT,
  core_dna TEXT[] NOT NULL DEFAULT '{}',
  module_readiness JSONB NOT NULL DEFAULT '{"text": "PARTIAL", "visual": "PARTIAL", "operations": "PARTIAL", "community": "PARTIAL", "platform": "READY"}',
  daily_estimated_sc INTEGER NOT NULL DEFAULT 100,
  total_spent_sc INTEGER NOT NULL DEFAULT 0,
  created_by_user_id UUID,
  last_analyzed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at TIMESTAMPTZ
);

-- 3. Harness Versions Table (Immutable Snapshots)
CREATE TABLE IF NOT EXISTS public.harness_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  harness_asset_id UUID NOT NULL REFERENCES public.harness_assets(id) ON DELETE CASCADE,
  version_no INTEGER NOT NULL,
  schema_version TEXT NOT NULL DEFAULT '1.1.0',
  compiler_version TEXT NOT NULL DEFAULT 'sohee-luna-5.6',
  analyzer_version TEXT NOT NULL DEFAULT 'sohee-analyzer-1.1',
  created_from_snapshot_id UUID,
  text_json JSONB NOT NULL DEFAULT '{}',
  visual_json JSONB NOT NULL DEFAULT '{}',
  operations_json JSONB NOT NULL DEFAULT '{}',
  community_json JSONB NOT NULL DEFAULT '{}',
  platform_json JSONB NOT NULL DEFAULT '{}',
  evidence_score INTEGER NOT NULL DEFAULT 0,
  confidence INTEGER NOT NULL DEFAULT 0,
  immutable BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_harness_version UNIQUE (harness_asset_id, version_no)
);

-- 4. Harness Rules Table (5-State Rule-level Provenance)
CREATE TABLE IF NOT EXISTS public.harness_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  harness_version_id UUID NOT NULL REFERENCES public.harness_versions(id) ON DELETE CASCADE,
  module TEXT NOT NULL CHECK (module IN ('text', 'visual', 'operations', 'community', 'platform')),
  rule_key TEXT NOT NULL,
  rule_title TEXT NOT NULL,
  rule_value JSONB NOT NULL,
  evidence_state TEXT NOT NULL CHECK (evidence_state IN ('OBSERVED', 'INFERRED', 'RECOMMENDED_DEFAULT', 'USER_OVERRIDE', 'PERFORMANCE_LEARNED')),
  supporting_sample_count INTEGER NOT NULL DEFAULT 0,
  contradictory_sample_count INTEGER NOT NULL DEFAULT 0,
  confidence INTEGER NOT NULL DEFAULT 80,
  confidence_basis TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 5. Harness Rule Evidence Table (Snapshot Lineage)
CREATE TABLE IF NOT EXISTS public.harness_rule_evidence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id UUID NOT NULL REFERENCES public.harness_rules(id) ON DELETE CASCADE,
  source_item_id TEXT,
  source_url TEXT,
  evidence_type TEXT NOT NULL,
  observation_summary TEXT NOT NULL,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 6. Harness User Override Versions Table
CREATE TABLE IF NOT EXISTS public.harness_override_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  harness_asset_id UUID NOT NULL REFERENCES public.harness_assets(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  base_harness_version_id UUID REFERENCES public.harness_versions(id) ON DELETE SET NULL,
  version_no INTEGER NOT NULL DEFAULT 1,
  override_json JSONB NOT NULL DEFAULT '{}',
  created_by_user_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 7. Harness Channel Assignments Table
CREATE TABLE IF NOT EXISTS public.harness_channel_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  channel_connection_id TEXT NOT NULL,
  harness_asset_id UUID NOT NULL REFERENCES public.harness_assets(id) ON DELETE CASCADE,
  assignment_mode TEXT NOT NULL DEFAULT 'FOLLOW_ACTIVE' CHECK (assignment_mode IN ('FOLLOW_ACTIVE', 'PINNED_VERSION')),
  pinned_version_id UUID REFERENCES public.harness_versions(id) ON DELETE SET NULL,
  desired_autonomy_mode TEXT NOT NULL DEFAULT 'FULL_AUTONOMOUS',
  actual_autonomy_mode TEXT NOT NULL DEFAULT 'FULL_AUTONOMOUS',
  enabled BOOLEAN NOT NULL DEFAULT true,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_channel_harness UNIQUE (workspace_id, channel_connection_id)
);

-- 8. Enable Row Level Security (RLS) on all Harness tables
ALTER TABLE public.harness_source_entities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.harness_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.harness_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.harness_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.harness_override_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.harness_channel_assignments ENABLE ROW LEVEL SECURITY;

-- 9. RLS Policies (Workspace Isolation)
CREATE POLICY "Workspace Members can view harness source entities"
  ON public.harness_source_entities FOR SELECT
  USING (workspace_id IN (SELECT workspace_id FROM public.workspace_memberships WHERE user_id = auth.uid()));

CREATE POLICY "Workspace Members can view harness assets"
  ON public.harness_assets FOR SELECT
  USING (
    visibility = 'SYSTEM_SEED_REFERENCE' OR
    workspace_id IN (SELECT workspace_id FROM public.workspace_memberships WHERE user_id = auth.uid())
  );

CREATE POLICY "Workspace Editors can modify harness assets"
  ON public.harness_assets FOR ALL
  USING (workspace_id IN (SELECT workspace_id FROM public.workspace_memberships WHERE user_id = auth.uid()));

CREATE POLICY "Workspace Members can view channel assignments"
  ON public.harness_channel_assignments FOR SELECT
  USING (workspace_id IN (SELECT workspace_id FROM public.workspace_memberships WHERE user_id = auth.uid()));
