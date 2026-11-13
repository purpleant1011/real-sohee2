-- ANI-1528: allow vault telemetry in the existing server-only funnel_events table.
ALTER TABLE public.funnel_events DROP CONSTRAINT funnel_events_event_check;
ALTER TABLE public.funnel_events ADD CONSTRAINT funnel_events_event_check CHECK (event IN (
  'signup_completed', 'quickstart_shop_saved', 'quickstart_tone_saved',
  'channel_connected', 'draft_requested', 'draft_ready',
  'preview_viewed', 'revise_requested', 'publish_confirmed',
  'publish_verified', 'publish_failed', 'vault.saved', 'vault.save_failed'
));
