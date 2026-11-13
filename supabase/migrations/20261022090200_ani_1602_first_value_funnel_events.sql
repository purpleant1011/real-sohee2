-- ANI-1602: allow first-value funnel observation events in the server-only funnel_events table.
-- New events: photo_uploaded (rights-confirmed upload), generation_cost_settled (verified credit settlement),
-- trial_credit_debited (reserved for trial-credit attribution; no emitter yet, therefore reported as "미관측").
-- Not applied to production by this change. Existing rows stay valid (superset of the ANI-1567 list).

ALTER TABLE public.funnel_events DROP CONSTRAINT funnel_events_event_check;
ALTER TABLE public.funnel_events ADD CONSTRAINT funnel_events_event_check CHECK (event IN (
  'signup_completed', 'quickstart_shop_saved', 'quickstart_tone_saved',
  'channel_connected', 'draft_requested', 'draft_ready',
  'preview_viewed', 'revise_requested', 'publish_confirmed',
  'publish_verified', 'publish_failed', 'vault.saved', 'vault.save_failed',
  'preview_opened', 'vault_saved', 'vault_edited', 'reapproved', 'release_requested',
  'photo_uploaded', 'generation_cost_settled', 'trial_credit_debited'
));

-- Rollback (manual only; first delete rows that use the new events or the constraint re-add fails):
-- DELETE FROM public.funnel_events WHERE event IN ('photo_uploaded', 'generation_cost_settled', 'trial_credit_debited');
-- ALTER TABLE public.funnel_events DROP CONSTRAINT funnel_events_event_check;
-- ALTER TABLE public.funnel_events ADD CONSTRAINT funnel_events_event_check CHECK (event IN (
--   'signup_completed', 'quickstart_shop_saved', 'quickstart_tone_saved',
--   'channel_connected', 'draft_requested', 'draft_ready',
--   'preview_viewed', 'revise_requested', 'publish_confirmed',
--   'publish_verified', 'publish_failed', 'vault.saved', 'vault.save_failed',
--   'preview_opened', 'vault_saved', 'vault_edited', 'reapproved', 'release_requested'
-- ));
