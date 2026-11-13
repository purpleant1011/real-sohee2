-- ANI-1609 (W5 follow-up): catalog service duration is a first-class, verifiable fact.
-- Forward-only; adding this file does not change any operational database.
--
-- Why: src/features/booking-recovery/{availability,service}.ts read `duration_minutes` to reject a slot that is
-- shorter than the service actually takes (CONTEXT_REQUIRED when unknown, SLOT_CONFLICT when too short). The
-- column never existed, so every read returned NULL and booking-recovery preparation failed closed even for a
-- correctly configured catalog. This migration adds the missing fact; it deliberately backfills nothing.
--
-- Backfill policy: existing rows stay NULL (duration genuinely unknown). The application then answers
-- CONTEXT_REQUIRED and asks the owner to set the duration. Guessing a default would fabricate a booking fact.
--
-- Rollback: drop constraint workspace_products_services_duration_minutes_check, then drop column duration_minutes.
-- No row is deleted; a dropped column only loses the duration values the owner had set.

alter table public.workspace_products_services
  add column if not exists duration_minutes integer;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.workspace_products_services'::regclass
      and conname = 'workspace_products_services_duration_minutes_check'
  ) then
    alter table public.workspace_products_services
      add constraint workspace_products_services_duration_minutes_check
      check (duration_minutes is null or (duration_minutes > 0 and duration_minutes <= 1440));
  end if;
end
$$;

comment on column public.workspace_products_services.duration_minutes is
  'Service duration in minutes. NULL means the owner has not set it yet; booking preparation must then fail closed with CONTEXT_REQUIRED instead of guessing.';

-- Owner-scoped reads already go through RLS on this table; the column needs no separate grant.
