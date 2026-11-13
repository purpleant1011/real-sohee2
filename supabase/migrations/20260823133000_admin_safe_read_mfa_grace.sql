-- Safe administrator reads honor the same effective MFA policy as list_operator_admins.
-- High-risk request/approve/apply RPCs intentionally remain AAL2-only.
create or replace function public.list_operator_admin_approval_requests()
returns jsonb language plpgsql security definer stable set search_path = '' as $$
declare actor_id uuid := (select auth.uid()); result jsonb;
begin
  if actor_id is null then raise exception 'AUTH_REQUIRED'; end if;
  if not exists (select 1 from public.platform_admin_members where user_id=actor_id and status='active') then raise exception 'OPERATOR_DISABLED'; end if;
  if private.operator_mfa_required(actor_id) and (select auth.jwt() ->> 'aal') is distinct from 'aal2' then raise exception 'MFA_REQUIRED'; end if;
  if not private.has_platform_permission('admin.read', null) then raise exception 'PERMISSION_DENIED'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'action_type',r.action_type,'status',r.status,'target_label',case when r.action_type='admin.invite' then '초대 대상 해시 확인됨' when r.action_type='admin.deactivate' then '관리자 계정' else '역할 변경 대상' end,'requested_by',r.requested_by,'approved_by',r.approved_by,'requested_at',r.requested_at,'approved_at',r.approved_at,'expires_at',r.expires_at,'expected_version',r.expected_version,'apply_ready',r.status='approved' and statement_timestamp() < r.expires_at) order by r.requested_at desc),'[]'::jsonb) into result from public.admin_approval_requests r where r.action_type in ('admin.invite','admin.deactivate','admin.role.change.workspace','admin.role.change.global') and r.status in ('pending','approved','applied');
  return result;
end;
$$;

create or replace function public.list_operator_admin_selector_options()
returns jsonb language plpgsql security definer stable set search_path = '' as $$
declare actor_id uuid := (select auth.uid()); result jsonb;
begin
  if actor_id is null then raise exception 'AUTH_REQUIRED'; end if;
  if not exists (select 1 from public.platform_admin_members where user_id=actor_id and status='active') then raise exception 'OPERATOR_DISABLED'; end if;
  if private.operator_mfa_required(actor_id) and (select auth.jwt() ->> 'aal') is distinct from 'aal2' then raise exception 'MFA_REQUIRED'; end if;
  if not private.has_platform_permission('admin.read', null) then raise exception 'PERMISSION_DENIED'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('user_id',m.user_id,'email_label',case when u.email is null then '이메일 확인 전' else left(split_part(u.email,'@',1),1)||'***@'||split_part(u.email,'@',2) end,'status',m.status,'version',m.version,'assignments',coalesce((select jsonb_agg(jsonb_build_object('assignment_id',a.id,'role_key',a.role_key,'role_label',r.display_name,'scope_label',case when a.workspace_id is null then '전체 고객사' else '고객사 범위' end,'version',a.version) order by a.role_key) from public.platform_admin_role_assignments a join public.platform_roles r on r.role_key=a.role_key where a.user_id=m.user_id),'[]'::jsonb)) order by m.created_at desc),'[]'::jsonb) into result from public.platform_admin_members m join auth.users u on u.id=m.user_id;
  return result;
end;
$$;

revoke all on function public.list_operator_admin_approval_requests() from public, anon, service_role;
grant execute on function public.list_operator_admin_approval_requests() to authenticated;
revoke all on function public.list_operator_admin_selector_options() from public, anon, service_role;
grant execute on function public.list_operator_admin_selector_options() to authenticated;
