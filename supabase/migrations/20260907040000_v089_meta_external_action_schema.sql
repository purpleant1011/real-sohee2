-- Migration: 20260907040000_v089_meta_external_action_schema.sql
-- Description: [ANI-995] Meta External Action Schema · Instagram/Threads Channel & Action Kind & FK Contract

-- 1. Update channel and action_kind check constraints on public.external_action_requests
ALTER TABLE public.external_action_requests
  DROP CONSTRAINT IF EXISTS external_action_requests_channel_check,
  DROP CONSTRAINT IF EXISTS external_action_requests_action_kind_check;

ALTER TABLE public.external_action_requests
  ADD CONSTRAINT external_action_requests_channel_check CHECK (
    channel IN ('instagram', 'threads', 'naver_blog', 'naver_place', 'daangn_business')
  ),
  ADD CONSTRAINT external_action_requests_action_kind_check CHECK (
    action_kind IN (
      'profile_edit',
      'news_post',
      'blog_post',
      'business_news_post',
      'feed_publish',
      'thread_publish',
      'comment_reply',
      'story_publish',
      'dm_reply'
    )
  );

-- 2. Covering indexes for hot lineage queries (workspace-scoped request -> attempt -> receipt)
CREATE INDEX IF NOT EXISTS idx_external_action_requests_ws_channel_status
  ON public.external_action_requests (workspace_id, channel, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_external_action_attempts_ws_request_status
  ON public.external_action_attempts (workspace_id, action_request_id, status);

CREATE INDEX IF NOT EXISTS idx_external_action_receipts_ws_request_kind
  ON public.external_action_receipts (workspace_id, action_request_id, receipt_kind, recorded_at DESC);
