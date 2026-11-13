-- ANI-1567: extend funnel_events CHECK constraint to include vault funnel lifecycle events
-- (preview_opened, vault_saved, vault_edited, reapproved, release_requested, publish_verified).
-- publish_verified is already allowed.

ALTER TABLE public.funnel_events DROP CONSTRAINT funnel_events_event_check;
ALTER TABLE public.funnel_events ADD CONSTRAINT funnel_events_event_check CHECK (event IN (
  'signup_completed', 'quickstart_shop_saved', 'quickstart_tone_saved',
  'channel_connected', 'draft_requested', 'draft_ready',
  'preview_viewed', 'revise_requested', 'publish_confirmed',
  'publish_verified', 'publish_failed', 'vault.saved', 'vault.save_failed',
  'preview_opened', 'vault_saved', 'vault_edited', 'reapproved', 'release_requested'
));

-- Index to accelerate cohort queries filtered by workspace, channel (inside properties jsonb), and occurred_at
CREATE INDEX IF NOT EXISTS funnel_events_vault_channel_occurred_idx
  ON public.funnel_events (workspace_id, (properties->>'channel'), occurred_at DESC);

-- Rollback (manual only):
-- DROP INDEX IF EXISTS public.funnel_events_vault_channel_occurred_idx;
-- ALTER TABLE public.funnel_events DROP CONSTRAINT funnel_events_event_check;
-- ALTER TABLE public.funnel_events ADD CONSTRAINT funnel_events_event_check CHECK (event IN (
--   'signup_completed', 'quickstart_shop_saved', 'quickstart_tone_saved',
--   'channel_connected', 'draft_requested', 'draft_ready',
--   'preview_viewed', 'revise_requested', 'publish_confirmed',
--   'publish_verified', 'publish_failed', 'vault.saved', 'vault.save_failed'
-- ));
