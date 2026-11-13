-- 임시 로컬 PostgreSQL 전용. 운영/공유 DB에서 실행 금지.
\set ON_ERROR_STOP on
begin;
do $$ begin
 if not exists (select from pg_roles where rolname='anon') then create role anon; end if;
 if not exists (select from pg_roles where rolname='authenticated') then create role authenticated; end if;
 if not exists (select from pg_roles where rolname='service_role') then create role service_role; end if;
end $$;
create table public.workspaces (id uuid primary key);
create table public.reservations (id text primary key, workspace_id uuid not null references public.workspaces(id), slot_id text not null, status text not null, metadata jsonb not null default '{}', updated_at timestamptz not null default statement_timestamp());
\ir ../supabase/migrations/20261106040000_kakao_notification_outbox.sql
alter table public.kakao_notification_outbox add constraint tmp_break check (false) not valid;
insert into public.workspaces values ('00000000-0000-4000-8000-000000000001');
insert into public.reservations(id,workspace_id,slot_id,status) values ('r1','00000000-0000-4000-8000-000000000001','s','CONFIRMED');
do $$ begin
 assert exists(select 1 from public.reservations where id='r1'), 'reservation must survive enqueue failure';
 assert not exists(select 1 from public.kakao_notification_outbox), 'no outbox row when enqueue fails';
end $$;
rollback;
\echo 'PASS: enqueue failure does not block reservation write'
