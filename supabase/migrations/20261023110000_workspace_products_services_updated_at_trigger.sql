-- ==============================================================================
-- Migration: 20261023110000_workspace_products_services_updated_at_trigger.sql
-- Description: Keep workspace_products_services.updated_at moving on real content edits.
--
-- Why: `updated_at` doubles as the catalog version. Booking slots bind it into
-- `booking_recovery_slots.catalog_version`, and `verifyOffer` refuses a slot whose
-- catalog version no longer matches. The catalog editor also uses it as the
-- optimistic-lock token (`expectedUpdatedAt`). Neither worked, because nothing ever
-- advanced the column: there was no trigger, and the writer never sets it.
--
-- Scope of this file: a trigger only. No backfill, no column change, no data rewrite.
--
-- The `when` clause is the important part: it lists the owner-editable content
-- columns and deliberately EXCLUDES `knowledge_fact_id`. Recording the service↔fact
-- link is bookkeeping, not a content change; if it bumped the version, every save
-- would invalidate the owner's confirmed availability slots and force a false
-- re-confirmation. Keep that column out of this list.
-- ==============================================================================

drop trigger if exists workspace_products_services_set_updated_at on public.workspace_products_services;

create trigger workspace_products_services_set_updated_at
before update on public.workspace_products_services
for each row
when (
  old.name is distinct from new.name
  or old.price is distinct from new.price
  or old.duration_minutes is distinct from new.duration_minutes
  or old.resource_name is distinct from new.resource_name
  or old.cancellation_policy is distinct from new.cancellation_policy
  or old.valid_from is distinct from new.valid_from
  or old.valid_until is distinct from new.valid_until
  or old.active is distinct from new.active
)
execute function private.set_updated_at();

comment on trigger workspace_products_services_set_updated_at on public.workspace_products_services is
  'Advances updated_at (the catalog version) only when owner-editable content changes. knowledge_fact_id is excluded on purpose: the service<->fact link must not invalidate confirmed booking slots.';
