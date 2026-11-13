-- ==============================================================================
-- 57_booking_recovery.test.sql
-- Validation for Booking Recovery tables, RLS, FK constraints, and security isolation.
-- Executed after full migration replay in one rollback-only transaction.
-- ==============================================================================
\set ON_ERROR_STOP on
begin;

create temporary table recovery_assertions (name text primary key, passed boolean not null);

-- 1. Check all 6 recovery tables exist with RLS enabled
insert into recovery_assertions values
('six recovery tables with RLS', (
  select count(*) = 6 from pg_class
  where relnamespace = 'public'::regnamespace and relname in
    ('booking_recovery_cases', 'booking_recovery_steps', 'booking_recovery_approvals', 'booking_recovery_slots', 'booking_recovery_outbox', 'booking_recovery_proposals')
    and relrowsecurity
)),
('no public write grants on recovery tables', (
  select count(*) = 0 from information_schema.role_table_grants
  where table_schema = 'public' and table_name in
    ('booking_recovery_cases', 'booking_recovery_steps', 'booking_recovery_approvals', 'booking_recovery_slots', 'booking_recovery_outbox', 'booking_recovery_proposals')
    and grantee in ('anon', 'authenticated', 'PUBLIC')
    and privilege_type in ('INSERT','UPDATE','DELETE')
)),
('six server RPCs defined as security definer', (
  select count(*) = 6 from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in ('open_booking_recovery', 'transition_booking_recovery', 'claim_booking_recovery_step', 'claim_booking_recovery_outbox', 'finish_booking_recovery_step', 'confirm_booking_recovery')
    and p.prosecdef = true
)),
('no public execution grants on server RPCs', (
  select count(*) = 0 from information_schema.routine_privileges
  where routine_schema = 'public'
    and routine_name in ('open_booking_recovery', 'transition_booking_recovery', 'claim_booking_recovery_step', 'claim_booking_recovery_outbox', 'finish_booking_recovery_step', 'confirm_booking_recovery')
    and grantee in ('anon', 'authenticated', 'PUBLIC')
));

do $$ begin
 if (select not bool_and(passed) from recovery_assertions) then
   raise exception 'recovery schema assertions failed: %', (select string_agg(name, ', ') from recovery_assertions where not passed);
 end if;
end $$;

-- 2. Fixture Setup
insert into auth.users (id, email) values
 ('e1111111-1111-4111-8111-111111111111', 'rec-a@test.invalid'),
 ('e2222222-2222-4222-8222-222222222222', 'rec-b@test.invalid'),
 ('e3333333-3333-4333-8333-333333333333', 'rec-inactive@test.invalid');

insert into public.workspaces (id, name, created_by) values
 ('a1111111-1111-4111-8111-111111111111', 'Recovery A', 'e1111111-1111-4111-8111-111111111111'),
 ('a2222222-2222-4222-8222-222222222222', 'Recovery B', 'e2222222-2222-4222-8222-222222222222');

insert into public.workspace_members (workspace_id, user_id, role, status) values
 ('a1111111-1111-4111-8111-111111111111', 'e1111111-1111-4111-8111-111111111111', 'owner', 'active'),
 ('a2222222-2222-4222-8222-222222222222', 'e2222222-2222-4222-8222-222222222222', 'owner', 'active'),
 ('a1111111-1111-4111-8111-111111111111', 'e3333333-3333-4333-8333-333333333333', 'owner', 'disabled')
 on conflict (workspace_id, user_id) do update set role = excluded.role, status = excluded.status;

insert into public.channel_connections (id, workspace_id, channel, status) values
 ('c1111111-1111-4111-8111-111111111111', 'a1111111-1111-4111-8111-111111111111', 'instagram', 'connected');

insert into public.instagram_dm_threads (id, workspace_id, channel_connection_id, provider_thread_id, customer_id, customer_handle, last_message_at, expires_at, status, last_message_text)
 values ('11111111-3333-4111-8111-111111111111', 'a1111111-1111-4111-8111-111111111111', 'c1111111-1111-4111-8111-111111111111', 'th_prov_1', 'cust_1', 'cust_1', now(), now() + interval '24 hours', 'NEEDS_REPLY', '예약 문의');

insert into public.instagram_dm_messages (id, workspace_id, thread_id, provider_message_id, sender_type, sender_id, text, sent_at)
 values ('11111111-4444-4111-8111-111111111111', 'a1111111-1111-4111-8111-111111111111', '11111111-3333-4111-8111-111111111111', 'msg_prov_1', 'customer', 'cust_1', '예약되나요?', now());

create function pg_temp.recovery_rejected(query text) returns boolean language plpgsql as $$
begin execute query; return false;
exception when insufficient_privilege or check_violation or foreign_key_violation or unique_violation or exclusion_violation or raise_exception then return true;
end $$;

-- 3. Assertions on Negative Paths
insert into recovery_assertions values
('cross-workspace mission FK denied', pg_temp.recovery_rejected($q$
 insert into public.booking_recovery_cases (workspace_id, mission_id, source_thread_id, source_inbound_message_id, customer_ref, stage)
 values ('a2222222-2222-4222-8222-222222222222', 'a1111111-1111-4111-8111-111111111111', '11111111-3333-4111-8111-111111111111', '11111111-4444-4111-8111-111111111111', 'cust', 'DISCOVERED');
$q$)),
('unauthorized cross-workspace RPC call denied', pg_temp.recovery_rejected($q$
 select public.open_booking_recovery('a1111111-1111-4111-8111-111111111111', '11111111-4444-4111-8111-111111111111', 'e2222222-2222-4222-8222-222222222222');
$q$)),
('disabled member RPC call denied', pg_temp.recovery_rejected($q$
 select public.open_booking_recovery('a1111111-1111-4111-8111-111111111111', '11111111-4444-4111-8111-111111111111', 'e3333333-3333-4333-8333-333333333333');
$q$));

do $$ begin
 if (select not bool_and(passed) from recovery_assertions) then
   raise exception 'recovery security assertions failed: %', (select string_agg(name, ', ') from recovery_assertions where not passed);
 end if;
end $$;

rollback;
