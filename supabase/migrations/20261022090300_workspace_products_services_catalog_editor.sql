-- ANI-1609 (catalog editor): the owner needs somewhere to enter the facts booking confirmation requires.
-- Forward-only; adding this file does not change any operational database.
--
-- Why: `workspace_products_services` only stored name/price/active. `duration_minutes` was added by
-- the W5 follow-up migration. A booking also needs to know who delivers the service, the cancellation rule the owner
-- promised, and when the price applies. Without those columns the owner has no place to state them, and
-- `verifyOffer` fails closed forever. Every column is nullable on purpose: NULL means "the owner has not
-- said yet", which the app reports honestly instead of guessing.
--
-- Backfill policy: nothing is backfilled. No row is given an invented duration, price, resource, or date.
--
-- Rollback: drop the foreign key, then the check constraints, then the five columns. No row is deleted.

alter table public.workspace_products_services
  add column if not exists resource_name text,
  add column if not exists cancellation_policy text,
  add column if not exists valid_from timestamptz,
  add column if not exists valid_until timestamptz,
  add column if not exists knowledge_fact_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.workspace_products_services'::regclass
      and conname = 'workspace_products_services_resource_name_check'
  ) then
    alter table public.workspace_products_services
      add constraint workspace_products_services_resource_name_check
      check (resource_name is null or char_length(resource_name) between 1 and 100);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.workspace_products_services'::regclass
      and conname = 'workspace_products_services_cancellation_policy_check'
  ) then
    alter table public.workspace_products_services
      add constraint workspace_products_services_cancellation_policy_check
      check (cancellation_policy is null or char_length(cancellation_policy) between 1 and 500);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.workspace_products_services'::regclass
      and conname = 'workspace_products_services_valid_range_check'
  ) then
    alter table public.workspace_products_services
      add constraint workspace_products_services_valid_range_check
      check (valid_until is null or valid_from is null or valid_until > valid_from);
  end if;

  -- A catalog row may point at the approved fact that carries its price/duration, so an edit supersedes
  -- that fact instead of creating a parallel copy of the same claim.
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.workspace_products_services'::regclass
      and conname = 'workspace_products_services_knowledge_fact_fkey'
  ) then
    alter table public.workspace_products_services
      add constraint workspace_products_services_knowledge_fact_fkey
      foreign key (workspace_id, knowledge_fact_id)
      references public.knowledge_facts (workspace_id, id)
      on delete set null;
  end if;
end
$$;

comment on column public.workspace_products_services.resource_name is
  'Who delivers this service (owner, stylist, room). NULL means the owner has not set it.';
comment on column public.workspace_products_services.cancellation_policy is
  'Cancellation rule exactly as the owner promised it. NULL means no rule was entered; never invented.';
comment on column public.workspace_products_services.valid_from is
  'First instant this price/service applies. A future value means the change has not taken effect yet.';
comment on column public.workspace_products_services.valid_until is
  'Last instant this price/service applies. Expired rows stay readable but cannot be used to confirm a booking.';
comment on column public.workspace_products_services.knowledge_fact_id is
  'Approved knowledge fact carrying this service price/duration, so edits supersede the old claim.';

-- Owner-scoped reads already go through the table RLS; the new columns need no separate grant.
