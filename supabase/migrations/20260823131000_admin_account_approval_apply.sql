alter table public.admin_approval_requests drop constraint if exists admin_approval_requests_action_type_check;
alter table public.admin_approval_requests add constraint admin_approval_requests_action_type_check check (action_type in ('agreement.verify','channel.disconnect','publish.retry','credit.adjust','admin.role.change.workspace','admin.role.change.global','admin.invite','admin.deactivate','audit.export.workspace','audit.export.global'));

alter table public.platform_audit_events drop constraint if exists platform_audit_events_action_check;
alter table public.platform_audit_events add constraint platform_audit_events_action_check check (action in (
  'agreement.verify.requested','agreement.verify.approved','channel.disconnect.requested','channel.disconnect.approved',
  'publish.retry.requested','publish.retry.approved','publish.retry.applied','credit.adjust.requested','credit.adjust.approved','credit.adjust.applied',
  'admin.role.change.workspace.requested','admin.role.change.workspace.approved','admin.role.change.workspace.applied',
  'admin.role.change.global.requested','admin.role.change.global.approved','admin.role.change.global.applied',
  'admin.invite.requested','admin.invite.approved','admin.invite.applied',
  'admin.deactivate.requested','admin.deactivate.approved','admin.deactivate.applied',
  'audit.export.workspace.requested','audit.export.workspace.approved','audit.export.workspace.applied','audit.export.global.requested','audit.export.global.approved','audit.export.global.applied',
  'admin.account.activated','workspace.activation.requested','document.version.draft_created','document.version.reviewed','document.version.activated',
  'support.session.started','support.session.ended','support.session.expired','support.session.revoked', 'admin.mfa.exception.retired'
));

create table public.admin_invite_intents (
  id uuid primary key default gen_random_uuid(),
  approval_request_id uuid not null unique references public.admin_approval_requests(id) on delete restrict,
  email_hash text not null check (email_hash ~ '^[a-f0-9]{64}$'),
  status text not null check (status in ('provider_pending','provider_succeeded','provider_failed')),
  created_at timestamptz not null default statement_timestamp()
);
alter table public.admin_invite_intents alter column status set default 'provider_pending';
alter table public.admin_invite_intents enable row level security;
revoke all on public.admin_invite_intents from public, anon, authenticated;
grant select on public.admin_invite_intents to service_role;

create or replace function public.apply_approved_admin_role_change(p_approval_request_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor_id uuid := private.require_current_operator_aal2_actor(); request_row public.admin_approval_requests%rowtype; assignment public.platform_admin_role_assignments%rowtype; next_role text;
begin
  if not exists (select 1 from public.platform_admin_members where user_id = actor_id and status = 'active') then raise exception 'OPERATOR_DISABLED'; end if;
  select * into request_row from public.admin_approval_requests where id = p_approval_request_id for update;
  if not found or request_row.action_type not in ('admin.role.change.workspace','admin.role.change.global') then raise exception 'APPROVAL_NOT_FOUND'; end if;
  if not private.has_platform_permission('admin.role.change.request', request_row.workspace_id) then raise exception 'PERMISSION_DENIED'; end if;
  if request_row.status = 'applied' then return jsonb_build_object('approval_request_id',request_row.id,'status','applied','replayed',true); end if;
  if request_row.status <> 'approved' then raise exception 'APPROVAL_STATE_CONFLICT'; end if;
  if statement_timestamp() >= request_row.expires_at then raise exception 'APPROVAL_EXPIRED'; end if;
  if request_row.requested_by = actor_id then raise exception 'APPROVER_MUST_DIFFER'; end if;
  if not private.has_platform_permission('admin.role.change.request', request_row.workspace_id) then raise exception 'PERMISSION_DENIED'; end if;
  select * into assignment from public.platform_admin_role_assignments where id::text = request_row.target_id for update;
  if not found then raise exception 'ADMIN_TARGET_NOT_FOUND'; end if;
  if request_row.expected_version is null or assignment.version <> request_row.expected_version then raise exception 'EXPECTED_VERSION_CONFLICT'; end if;
  if assignment.user_id = actor_id then raise exception 'SELF_ROLE_CHANGE_FORBIDDEN'; end if;
  next_role := request_row.request_payload ->> 'next_role_key';
  if next_role is null or next_role not in ('platform_owner','operations_admin','customer_support','content_operator','billing_admin','system_admin','audit_viewer') then raise exception 'ADMIN_INPUT_INVALID'; end if;
  perform private.lock_platform_owner_quorum();
  if assignment.role_key = 'platform_owner' and assignment.workspace_id is null and next_role <> 'platform_owner' and (select count(*) from public.platform_admin_members m join public.platform_admin_role_assignments a on a.user_id=m.user_id where m.status='active' and a.role_key='platform_owner' and a.workspace_id is null) <= 2 then raise exception 'LAST_OWNER_FORBIDDEN'; end if;
  update public.platform_admin_role_assignments set role_key = next_role, version = version + 1 where id = assignment.id and version = request_row.expected_version;
  if not found then raise exception 'EXPECTED_VERSION_CONFLICT'; end if;
  update public.admin_approval_requests set status='applied', applied_at=statement_timestamp(), result_summary=jsonb_build_object('status','applied','next_role_key',next_role) where id=request_row.id;
  perform private.append_platform_audit_event(actor_id, request_row.workspace_id, request_row.action_type || '.applied', 'platform_admin_role_assignment', assignment.id::text, request_row.reason, request_row.id::text, 'succeeded', jsonb_build_object('role_key',assignment.role_key), jsonb_build_object('role_key',next_role), encode(extensions.digest('admin-role-applied:'||request_row.id::text,'sha256'),'hex'), 'observed', request_row.id, null);
  return jsonb_build_object('approval_request_id',request_row.id,'status','applied','replayed',false);
exception when others then
  if sqlerrm in ('OPERATOR_DISABLED','APPROVAL_NOT_FOUND','APPROVAL_STATE_CONFLICT','APPROVER_MUST_DIFFER','PERMISSION_DENIED','ADMIN_TARGET_NOT_FOUND','SELF_ROLE_CHANGE_FORBIDDEN','ADMIN_INPUT_INVALID','LAST_OWNER_FORBIDDEN','APPROVAL_EXPIRED','EXPECTED_VERSION_CONFLICT') then raise; end if;
  raise exception 'ADMIN_ROLE_APPLY_UNAVAILABLE';
end; $$;

create or replace function public.apply_approved_admin_deactivate(p_approval_request_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor_id uuid := private.require_current_operator_aal2_actor(); request_row public.admin_approval_requests%rowtype; target_id uuid; owner_count integer;
begin
  if not exists (select 1 from public.platform_admin_members where user_id=actor_id and status='active') then raise exception 'OPERATOR_DISABLED'; end if;
  select * into request_row from public.admin_approval_requests where id=p_approval_request_id for update;
  if not found or request_row.action_type <> 'admin.deactivate' then raise exception 'APPROVAL_STATE_CONFLICT'; end if;
  if request_row.requested_by=actor_id then raise exception 'APPROVER_MUST_DIFFER'; end if;
  if not private.has_platform_permission('admin.role.change.request', null) then raise exception 'PERMISSION_DENIED'; end if;
  if request_row.status = 'applied' then return jsonb_build_object('approval_request_id',request_row.id,'status','applied','session_state','revocation_pending','replayed',true); end if;
  if request_row.status <> 'approved' then raise exception 'APPROVAL_STATE_CONFLICT'; end if;
  if statement_timestamp() >= request_row.expires_at then raise exception 'APPROVAL_EXPIRED'; end if;
  target_id := request_row.target_id::uuid;
  if target_id=actor_id then raise exception 'SELF_DEACTIVATE_FORBIDDEN'; end if;
  perform private.lock_platform_owner_quorum();
  select count(*) into owner_count from public.platform_admin_members m join public.platform_admin_role_assignments a on a.user_id=m.user_id where m.status='active' and a.user_id=target_id and a.role_key='platform_owner' and a.workspace_id is null;
  if owner_count > 0 and (select count(*) from public.platform_admin_members m join public.platform_admin_role_assignments a on a.user_id=m.user_id where m.status='active' and a.role_key='platform_owner' and a.workspace_id is null) <= 2 then raise exception 'LAST_OWNER_FORBIDDEN'; end if;
  update public.platform_admin_members set status='disabled', version=version+1 where user_id=target_id and status='active' and version=request_row.expected_version;
  if not found then raise exception 'EXPECTED_VERSION_CONFLICT'; end if;
  update public.admin_approval_requests set status='applied', applied_at=statement_timestamp(), result_summary='{"status":"disabled","session_state":"revocation_pending"}'::jsonb where id=request_row.id;
  perform private.append_platform_audit_event(actor_id, null, 'admin.deactivate.applied', 'platform_admin_member', target_id::text, request_row.reason, request_row.id::text, 'succeeded', jsonb_build_object('status','active'), jsonb_build_object('status','disabled','session_state','revocation_pending'), encode(extensions.digest('admin-deactivate-applied:'||request_row.id::text,'sha256'),'hex'), 'observed', request_row.id, null);
  return jsonb_build_object('approval_request_id',request_row.id,'status','applied','session_state','revocation_pending','replayed',false);
exception when others then
  if sqlerrm in ('OPERATOR_DISABLED','APPROVAL_STATE_CONFLICT','APPROVER_MUST_DIFFER','SELF_DEACTIVATE_FORBIDDEN','LAST_OWNER_FORBIDDEN','EXPECTED_VERSION_CONFLICT','PERMISSION_DENIED','APPROVAL_EXPIRED') then raise; end if;
  raise exception 'ADMIN_DEACTIVATE_APPLY_UNAVAILABLE';
end; $$;

revoke all on function public.apply_approved_admin_role_change(uuid), public.apply_approved_admin_deactivate(uuid) from public, anon, service_role;
grant execute on function public.apply_approved_admin_role_change(uuid), public.apply_approved_admin_deactivate(uuid) to authenticated;

alter table public.platform_admin_members add column if not exists version bigint not null default 1;
alter table public.platform_admin_role_assignments add column if not exists version bigint not null default 1;

create or replace function public.request_admin_account_approval(
  p_action_type text,
  p_target_id text,
  p_reason text,
  p_idempotency_key text,
  p_expected_version bigint default null,
  p_request_payload jsonb default '{}'::jsonb
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid := private.require_current_operator_aal2_actor();
  request_row public.admin_approval_requests%rowtype;
  fingerprint text;
  audit_key text;
begin
  if not exists (select 1 from public.platform_admin_members where user_id = actor_id and status = 'active') then raise exception 'OPERATOR_DISABLED'; end if;
  perform private.lock_platform_owner_quorum();
  if (select count(*) from public.platform_admin_members m join public.platform_admin_role_assignments a on a.user_id=m.user_id where m.status='active' and a.role_key='platform_owner' and a.workspace_id is null) < 2 then raise exception 'OWNER_QUORUM_REQUIRED'; end if;
  if p_action_type not in ('admin.invite','admin.deactivate') or p_reason is null or char_length(btrim(p_reason)) not between 1 and 2000 or p_idempotency_key !~ '^[a-f0-9]{64}$' or p_request_payload is null or jsonb_typeof(p_request_payload) <> 'object' then raise exception 'AUDIT_INPUT_INVALID'; end if;
  if p_action_type = 'admin.invite' then
    if not private.has_platform_permission('admin.invite', null) or p_target_id !~ '^[a-f0-9]{64}$' or p_expected_version is not null or (select count(*) from jsonb_object_keys(p_request_payload)) <> 1 or p_request_payload->>'email_hash' <> p_target_id then raise exception 'AUDIT_INPUT_INVALID'; end if;
  else
    if not private.has_platform_permission('admin.role.change.request', null) or p_target_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' or p_expected_version is null or p_expected_version < 1 or p_request_payload <> '{}'::jsonb then raise exception 'AUDIT_INPUT_INVALID'; end if;
    if not exists (select 1 from public.platform_admin_members where user_id=p_target_id::uuid and status='active') then raise exception 'AUDIT_INPUT_INVALID'; end if;
  end if;
  fingerprint := encode(extensions.digest(jsonb_build_object('action_type',p_action_type,'target_id',p_target_id,'reason',btrim(p_reason),'expected_version',p_expected_version,'request_payload',p_request_payload)::text,'sha256'),'hex');
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('admin-approval:'||p_idempotency_key,0));
  select * into request_row from public.admin_approval_requests where idempotency_key=p_idempotency_key;
  if found then
    if request_row.semantic_fingerprint <> fingerprint then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
    return jsonb_build_object('approval_request_id',request_row.id,'action_type',request_row.action_type,'status',request_row.status,'expires_at',request_row.expires_at);
  end if;
  insert into public.admin_approval_requests(workspace_id,action_type,target_type,target_id,reason,requested_by,status,expected_version,request_payload,result_summary,semantic_fingerprint,idempotency_key,requested_at,expires_at)
  values(null,p_action_type,case when p_action_type='admin.invite' then 'admin_account' else 'platform_admin_member' end,p_target_id,btrim(p_reason),actor_id,'pending',p_expected_version,p_request_payload,'{}'::jsonb,fingerprint,p_idempotency_key,statement_timestamp(),statement_timestamp()+interval '24 hours') returning * into request_row;
  audit_key := encode(extensions.digest('approval-requested:'||p_idempotency_key,'sha256'),'hex');
  perform private.append_platform_audit_event(actor_id,null,p_action_type||'.requested',request_row.target_type,p_target_id,btrim(p_reason),request_row.id::text,'succeeded','{}'::jsonb,jsonb_build_object('status','pending'),audit_key,'observed',request_row.id,null);
  return jsonb_build_object('approval_request_id',request_row.id,'action_type',request_row.action_type,'status',request_row.status,'expires_at',request_row.expires_at);
end;
$$;

create or replace function public.approve_admin_account_approval(p_approval_request_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor_id uuid := private.require_current_operator_aal2_actor(); request_row public.admin_approval_requests%rowtype; audit_key text;
begin
  if not exists (select 1 from public.platform_admin_members where user_id=actor_id and status='active') then raise exception 'OPERATOR_DISABLED'; end if;
  perform private.lock_platform_owner_quorum();
  if (select count(*) from public.platform_admin_members m join public.platform_admin_role_assignments a on a.user_id=m.user_id where m.status='active' and a.role_key='platform_owner' and a.workspace_id is null) < 2 then raise exception 'OWNER_QUORUM_REQUIRED'; end if;
  if not exists (select 1 from public.platform_admin_members m join public.platform_admin_role_assignments a on a.user_id=m.user_id where m.user_id=actor_id and m.status='active' and a.role_key='platform_owner' and a.workspace_id is null) then raise exception 'PLATFORM_OWNER_REQUIRED'; end if;
  select * into request_row from public.admin_approval_requests where id=p_approval_request_id for update;
  if not found or request_row.action_type not in ('admin.invite','admin.deactivate') then raise exception 'APPROVAL_NOT_FOUND'; end if;
  if request_row.requested_by=actor_id then raise exception 'APPROVER_MUST_DIFFER'; end if;
  if request_row.status <> 'pending' then raise exception 'APPROVAL_STATE_CONFLICT'; end if;
  if statement_timestamp() >= request_row.expires_at then raise exception 'APPROVAL_EXPIRED'; end if;
  update public.admin_approval_requests set status='approved', approved_by=actor_id, approved_at=statement_timestamp() where id=request_row.id returning * into request_row;
  audit_key := encode(extensions.digest('approval-approved:'||request_row.id::text,'sha256'),'hex');
  perform private.append_platform_audit_event(actor_id,null,request_row.action_type||'.approved',request_row.target_type,request_row.target_id,request_row.reason,request_row.id::text,'succeeded',jsonb_build_object('status','pending'),jsonb_build_object('status','approved'),audit_key,'observed',request_row.id,null);
  return jsonb_build_object('approval_request_id',request_row.id,'status',request_row.status,'action_type',request_row.action_type);
end;
$$;

create or replace function public.apply_approved_admin_invite(p_approval_request_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor_id uuid := private.require_current_operator_aal2_actor(); request_row public.admin_approval_requests%rowtype; intent_row public.admin_invite_intents%rowtype;
begin
  if not exists (select 1 from public.platform_admin_members where user_id=actor_id and status='active') then raise exception 'OPERATOR_DISABLED'; end if;
  select * into request_row from public.admin_approval_requests where id=p_approval_request_id for update;
  if not found or request_row.action_type <> 'admin.invite' then raise exception 'APPROVAL_STATE_CONFLICT'; end if;
  if not private.has_platform_permission('admin.invite', null) then raise exception 'PERMISSION_DENIED'; end if;
  if request_row.status = 'applied' then
    select * into intent_row from public.admin_invite_intents where approval_request_id=request_row.id;
    return jsonb_build_object('approval_request_id',request_row.id,'provider_state',coalesce(intent_row.status,'provider_pending'),'replayed',true);
  end if;
  if request_row.status <> 'approved' or request_row.approved_by=actor_id then raise exception 'APPROVAL_STATE_CONFLICT'; end if;
  if statement_timestamp() >= request_row.expires_at then raise exception 'APPROVAL_EXPIRED'; end if;
  insert into public.admin_invite_intents(approval_request_id,email_hash) values(request_row.id,request_row.target_id) on conflict (approval_request_id) do update set email_hash=excluded.email_hash returning * into intent_row;
  update public.admin_approval_requests set status='applied', result_summary=jsonb_build_object('provider_state','pending') where id=request_row.id;
  perform private.append_platform_audit_event(actor_id,null,'admin.invite.applied','admin_account',request_row.target_id,request_row.reason,request_row.id::text,'succeeded',jsonb_build_object('status','approved'),jsonb_build_object('status','applied','provider_state','pending'),encode(extensions.digest('admin-invite-applied:'||request_row.id::text,'sha256'),'hex'),'observed',request_row.id,null);
  return jsonb_build_object('approval_request_id',request_row.id,'provider_state',intent_row.status);
end;
$$;

revoke all on function public.request_admin_account_approval(text,text,text,text,bigint,jsonb), public.approve_admin_account_approval(uuid), public.apply_approved_admin_invite(uuid) from public, anon, service_role;
grant execute on function public.request_admin_account_approval(text,text,text,text,bigint,jsonb), public.approve_admin_account_approval(uuid), public.apply_approved_admin_invite(uuid) to authenticated;

create or replace function public.record_admin_invite_provider_result(p_approval_request_id uuid, p_provider_state text)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if p_provider_state not in ('provider_succeeded','provider_failed') then raise exception 'AUDIT_INPUT_INVALID'; end if;
  update public.admin_invite_intents set status=p_provider_state where approval_request_id=p_approval_request_id and status='provider_pending';
  if not found then raise exception 'APPROVAL_STATE_CONFLICT'; end if;
  return jsonb_build_object('approval_request_id',p_approval_request_id,'provider_state',p_provider_state);
end;
$$;
revoke all on function public.record_admin_invite_provider_result(uuid,text) from public, anon, authenticated;
grant execute on function public.record_admin_invite_provider_result(uuid,text) to service_role;

create or replace function public.list_operator_admin_approval_requests()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor_id uuid := private.require_current_operator_aal2_actor(); result jsonb;
begin
  if not exists (select 1 from public.platform_admin_members where user_id=actor_id and status='active') then raise exception 'OPERATOR_DISABLED'; end if;
  if not private.has_platform_permission('admin.read', null) then raise exception 'PERMISSION_DENIED'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'action_type',r.action_type,'status',r.status,'target_label',case when r.action_type='admin.invite' then '초대 대상 해시 확인됨' when r.action_type='admin.deactivate' then '관리자 계정' else '역할 변경 대상' end,'requested_by',r.requested_by,'approved_by',r.approved_by,'requested_at',r.requested_at,'approved_at',r.approved_at,'expires_at',r.expires_at,'expected_version',r.expected_version,'apply_ready',r.status='approved' and statement_timestamp() < r.expires_at) order by r.requested_at desc),'[]'::jsonb) into result from public.admin_approval_requests r where r.action_type in ('admin.invite','admin.deactivate','admin.role.change.workspace','admin.role.change.global') and r.status in ('pending','approved','applied');
  return result;
end;
$$;
revoke all on function public.list_operator_admin_approval_requests() from public, anon, service_role;
grant execute on function public.list_operator_admin_approval_requests() to authenticated;

create or replace function public.list_operator_admin_selector_options()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor_id uuid := private.require_current_operator_aal2_actor(); result jsonb;
begin
  if not exists (select 1 from public.platform_admin_members where user_id=actor_id and status='active') then raise exception 'OPERATOR_DISABLED'; end if;
  if not private.has_platform_permission('admin.read', null) then raise exception 'PERMISSION_DENIED'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('user_id',m.user_id,'email_label',case when u.email is null then '이메일 확인 전' else left(split_part(u.email,'@',1),1)||'***@'||split_part(u.email,'@',2) end,'status',m.status,'version',m.version,'assignments',coalesce((select jsonb_agg(jsonb_build_object('assignment_id',a.id,'role_key',a.role_key,'role_label',r.display_name,'scope_label',case when a.workspace_id is null then '전체 고객사' else '고객사 범위' end,'version',a.version) order by a.role_key) from public.platform_admin_role_assignments a join public.platform_roles r on r.role_key=a.role_key where a.user_id=m.user_id),'[]'::jsonb)) order by m.created_at desc),'[]'::jsonb) into result from public.platform_admin_members m join auth.users u on u.id=m.user_id;
  return result;
end;
$$;
revoke all on function public.list_operator_admin_selector_options() from public, anon, service_role;
grant execute on function public.list_operator_admin_selector_options() to authenticated;
