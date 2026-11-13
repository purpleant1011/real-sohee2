-- ANI-1511: workspace-scoped, server-authoritative time-to-first-post events.
CREATE TABLE public.funnel_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id uuid,
  event text NOT NULL CHECK (event IN (
    'signup_completed', 'quickstart_shop_saved', 'quickstart_tone_saved',
    'channel_connected', 'draft_requested', 'draft_ready',
    'preview_viewed', 'revise_requested', 'publish_confirmed',
    'publish_verified', 'publish_failed'
  )),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  properties jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(properties) = 'object'),
  dedupe_key text,
  CONSTRAINT funnel_events_workspace_event_dedupe UNIQUE (workspace_id, event, dedupe_key)
);

CREATE INDEX funnel_events_workspace_occurred_idx ON public.funnel_events (workspace_id, occurred_at, id);

ALTER TABLE public.funnel_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.funnel_events FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.funnel_events TO authenticated;
GRANT ALL ON public.funnel_events TO service_role;

CREATE POLICY "workspace_members_select_funnel_events" ON public.funnel_events
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.workspace_members AS member
    WHERE member.workspace_id = funnel_events.workspace_id
      AND member.user_id = (SELECT auth.uid())
      AND member.status = 'active'
  ));
-- No authenticated INSERT/UPDATE/DELETE policies or grants: only the server's service_role writes events.
CREATE POLICY "service_role_all_funnel_events" ON public.funnel_events
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Rollback (manual only; destructive, not executed by this migration):
-- DROP TABLE public.funnel_events;
