-- 20260914150000_r2_b9_mission_events_pre_mission_nullable.sql
-- R2-B9: Allow pre-mission onboarding funnel events to be persisted in mission_events
-- without forging fake zero UUIDs for mission_id.

ALTER TABLE public.mission_events ALTER COLUMN mission_id DROP NOT NULL;
