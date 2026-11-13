create table public.signup_consent_receipts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  terms_version text not null check (terms_version ~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}$'),
  privacy_version text not null check (privacy_version ~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}$'),
  marketing_consent boolean not null default false,
  accepted_at timestamptz not null default statement_timestamp()
);
alter table public.signup_consent_receipts enable row level security;
create policy "users can read own signup consent receipts" on public.signup_consent_receipts for select to authenticated using (user_id = (select auth.uid()));
revoke all on public.signup_consent_receipts from public, anon, authenticated;
grant select on public.signup_consent_receipts to authenticated;
grant all on public.signup_consent_receipts to service_role;

create or replace function private.record_signup_consent_receipt()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  consent jsonb := new.raw_user_meta_data -> 'signup_consent';
  terms_version text := consent ->> 'terms_version';
  privacy_version text := consent ->> 'privacy_version';
  marketing_consent boolean;
begin
  if jsonb_typeof(consent) is distinct from 'object'
    or terms_version !~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}$'
    or privacy_version !~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}$'
    or jsonb_typeof(consent -> 'marketing_consent') is distinct from 'boolean'
  then return new; end if;
  marketing_consent := (consent ->> 'marketing_consent')::boolean;
  insert into public.signup_consent_receipts (user_id, terms_version, privacy_version, marketing_consent)
  values (new.id, terms_version, privacy_version, marketing_consent)
  on conflict (user_id) do nothing;
  return new;
exception when others then return new;
end;
$$;
revoke all on function private.record_signup_consent_receipt() from public, anon, authenticated;
grant execute on function private.record_signup_consent_receipt() to service_role;
create trigger auth_user_signup_consent_receipt after insert on auth.users for each row execute function private.record_signup_consent_receipt();
