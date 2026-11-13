alter table public.platform_admin_members
  add column if not exists password_set_at timestamptz,
  add column if not exists activated_at timestamptz;

alter table public.platform_audit_events
  drop constraint if exists platform_audit_events_action_check;

alter table public.platform_audit_events
  add constraint platform_audit_events_action_check check (action in (
    'agreement.verify.requested', 'agreement.verify.approved',
    'channel.disconnect.requested', 'channel.disconnect.approved',
    'publish.retry.requested', 'publish.retry.approved',
    'credit.adjust.requested', 'credit.adjust.approved',
    'admin.role.change.workspace.requested', 'admin.role.change.workspace.approved',
    'admin.role.change.global.requested', 'admin.role.change.global.approved',
    'audit.export.workspace.requested', 'audit.export.workspace.approved',
    'audit.export.global.requested', 'audit.export.global.approved',
    'admin.account.activated'
  ));

create or replace function public.get_current_operator_setup_context()
returns jsonb language plpgsql security definer set search_path = '' stable
as $$
declare
  current_user_id uuid := (select auth.uid());
  member public.platform_admin_members%rowtype;
  confirmed boolean := false;
  verified_totp boolean := false;
  has_role boolean := false;
  current_aal text := case when (select auth.jwt() ->> 'aal') = 'aal2' then 'aal2' else 'aal1' end;
begin
  if current_user_id is null then raise exception 'AUTH_REQUIRED'; end if;
  select email_confirmed_at is not null into confirmed from auth.users where id = current_user_id;
  select exists (select 1 from auth.mfa_factors where user_id = current_user_id and status = 'verified' and factor_type = 'totp') into verified_totp;
  select exists (select 1 from public.platform_admin_role_assignments where user_id = current_user_id) into has_role;
  select * into member from public.platform_admin_members where user_id = current_user_id;
  if not found then
    return jsonb_build_object('status', 'not_invited', 'emailConfirmed', coalesce(confirmed, false), 'passwordSet', false, 'hasVerifiedTotp', verified_totp, 'hasRole', false, 'currentAal', current_aal);
  end if;
  return jsonb_build_object('status', member.status, 'emailConfirmed', coalesce(confirmed, false), 'passwordSet', member.password_set_at is not null, 'hasVerifiedTotp', verified_totp, 'hasRole', has_role, 'currentAal', current_aal);
end;
$$;

create or replace function public.record_current_invited_operator_password_set()
returns timestamptz language plpgsql security definer set search_path = ''
as $$
declare current_user_id uuid := (select auth.uid()); recorded_at timestamptz := statement_timestamp();
begin
  if current_user_id is null then raise exception 'AUTH_REQUIRED'; end if;
  if not exists (select 1 from auth.users where id = current_user_id and email_confirmed_at is not null)
    or not exists (select 1 from public.platform_admin_members where user_id = current_user_id and status = 'invited')
    or not exists (select 1 from public.platform_admin_role_assignments where user_id = current_user_id)
  then raise exception 'ADMIN_SETUP_NOT_ALLOWED'; end if;
  update public.platform_admin_members set password_set_at = coalesce(password_set_at, recorded_at)
    where user_id = current_user_id and status = 'invited';
  return (select password_set_at from public.platform_admin_members where user_id = current_user_id);
end;
$$;

create or replace function public.activate_current_invited_operator()
returns text language plpgsql security definer set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  member_status text;
  was_updated boolean := false;
  activation_key text := encode(extensions.digest(current_user_id::text || ':admin.account.activated', 'sha256'), 'hex');
begin
  if current_user_id is null then raise exception 'AUTH_REQUIRED'; end if;
  select status into member_status from public.platform_admin_members where user_id = current_user_id for update;
  if member_status = 'active' then
    if not exists (select 1 from public.platform_admin_members where user_id = current_user_id and mfa_required = true)
      or not exists (select 1 from auth.users where id = current_user_id and email_confirmed_at is not null)
      or not exists (select 1 from public.platform_admin_role_assignments where user_id = current_user_id)
      or (select auth.jwt() ->> 'aal') is distinct from 'aal2'
      or not exists (select 1 from auth.mfa_factors where user_id = current_user_id and status = 'verified' and factor_type = 'totp')
    then raise exception 'ADMIN_ACTIVATION_FAILED'; end if;
    return 'active';
  end if;
  if member_status is distinct from 'invited'
    or not exists (select 1 from auth.users where id = current_user_id and email_confirmed_at is not null)
    or not exists (select 1 from public.platform_admin_members where user_id = current_user_id and password_set_at is not null)
    or not exists (select 1 from public.platform_admin_members where user_id = current_user_id and mfa_required = true)
    or not exists (select 1 from public.platform_admin_role_assignments where user_id = current_user_id)
    or (select auth.jwt() ->> 'aal') is distinct from 'aal2'
    or not exists (select 1 from auth.mfa_factors where user_id = current_user_id and status = 'verified' and factor_type = 'totp')
  then raise exception 'ADMIN_ACTIVATION_FAILED'; end if;
  update public.platform_admin_members set status = 'active', activated_at = statement_timestamp(), last_reviewed_at = statement_timestamp()
    where user_id = current_user_id and status = 'invited';
  was_updated := found;
  if was_updated then
    perform private.append_platform_audit_event(current_user_id, null, 'admin.account.activated', 'platform_admin_member', current_user_id::text, 'Administrator MFA activation', activation_key, 'succeeded', jsonb_build_object('status', 'invited', 'mfa_required', true), jsonb_build_object('status', 'active', 'mfa_required', true), activation_key, 'observed', null, null);
  end if;
  return 'activated';
end;
$$;

revoke all on function public.get_current_operator_setup_context() from public, anon, service_role;
revoke all on function public.record_current_invited_operator_password_set() from public, anon, service_role;
revoke all on function public.activate_current_invited_operator() from public, anon, service_role;
grant execute on function public.get_current_operator_setup_context() to authenticated;
grant execute on function public.record_current_invited_operator_password_set() to authenticated;
grant execute on function public.activate_current_invited_operator() to authenticated;
