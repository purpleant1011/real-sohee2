insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('audit-exports', 'audit-exports', false, 52428800, array['text/csv']::text[])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create table public.audit_export_jobs (
  id uuid primary key default gen_random_uuid(),
  approval_request_id uuid not null unique references public.admin_approval_requests(id) on delete restrict,
  workspace_id uuid references public.workspaces(id) on delete restrict,
  scope text not null check (scope in ('workspace', 'global')),
  export_from timestamptz not null,
  export_to timestamptz not null,
  format text not null check (format = 'csv'),
  status text not null check (status in ('queued', 'running', 'succeeded', 'failed', 'expired')),
  storage_bucket text check (storage_bucket is null or storage_bucket = 'audit-exports'),
  storage_path text,
  content_sha256 text check (content_sha256 is null or content_sha256 ~ '^[a-f0-9]{64}$'),
  row_count integer,
  byte_size bigint,
  error_code text,
  created_at timestamptz not null default statement_timestamp(),
  expires_at timestamptz not null,
  check (export_from < export_to and export_to - export_from <= interval '31 days'),
  check (status <> 'succeeded' or (storage_bucket = 'audit-exports' and storage_path is not null and content_sha256 is not null and row_count is not null and byte_size is not null))
);
create index audit_export_jobs_scope_status_idx on public.audit_export_jobs(workspace_id, status, created_at desc);
alter table public.audit_export_jobs add column filter_fingerprint text;
alter table public.audit_export_jobs add column generated_at timestamptz;
alter table public.audit_export_jobs add column integrity_state text not null default 'verification_pending' check (integrity_state in ('hash_recorded', 'verification_pending', 'verified', 'failed'));
alter table public.audit_export_jobs add column event_chain_state text not null default 'unknown' check (event_chain_state in ('verified', 'unknown', 'error'));
alter table public.audit_export_jobs add constraint audit_export_jobs_storage_path_check check (storage_path is null or storage_path ~ '^(workspace|global)/[0-9a-f-]{36}/audit\\.csv$');
alter table public.audit_export_jobs add constraint audit_export_jobs_error_code_check check (error_code is null or error_code ~ '^[A-Z0-9_]{1,80}$');
alter table public.audit_export_jobs add constraint audit_export_jobs_counts_nonnegative check ((row_count is null or row_count >= 0) and (byte_size is null or byte_size >= 0));
create or replace function private.prevent_audit_export_job_invalid_transition() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.approval_request_id is distinct from old.approval_request_id or new.workspace_id is distinct from old.workspace_id or new.scope is distinct from old.scope or new.export_from is distinct from old.export_from or new.export_to is distinct from old.export_to or new.format is distinct from old.format then raise exception 'AUDIT_EXPORT_IMMUTABLE'; end if;
  if old.status = 'queued' and new.status not in ('queued', 'running', 'failed', 'expired') then raise exception 'AUDIT_EXPORT_STATE_CONFLICT'; end if;
  if old.status = 'running' and new.status not in ('running', 'succeeded', 'failed', 'expired') then raise exception 'AUDIT_EXPORT_STATE_CONFLICT'; end if;
  if old.status = 'succeeded' and new.status not in ('succeeded', 'expired') then raise exception 'AUDIT_EXPORT_STATE_CONFLICT'; end if;
  if old.status in ('failed', 'expired') and new.status is distinct from old.status then raise exception 'AUDIT_EXPORT_STATE_CONFLICT'; end if;
  return new;
end; $$;
create trigger audit_export_jobs_transition before update on public.audit_export_jobs for each row execute function private.prevent_audit_export_job_invalid_transition();
alter table public.audit_export_jobs enable row level security;
revoke all on public.audit_export_jobs from public, anon, authenticated;
grant select on public.audit_export_jobs to service_role;

alter table public.platform_audit_events drop constraint if exists platform_audit_events_action_check;
alter table public.platform_audit_events add constraint platform_audit_events_action_check check (action in (
  'agreement.verify.requested', 'agreement.verify.approved', 'channel.disconnect.requested', 'channel.disconnect.approved',
  'publish.retry.requested', 'publish.retry.approved', 'credit.adjust.requested', 'credit.adjust.approved',
  'admin.role.change.workspace.requested', 'admin.role.change.workspace.approved', 'admin.role.change.global.requested', 'admin.role.change.global.approved',
  'audit.export.workspace.requested', 'audit.export.workspace.approved', 'audit.export.workspace.applied',
  'audit.export.global.requested', 'audit.export.global.approved', 'audit.export.global.applied',
  'admin.account.activated', 'workspace.activation.requested', 'document.version.draft_created', 'document.version.reviewed', 'document.version.activated',
  'publish.retry.applied', 'credit.adjust.applied',
  'support.session.started', 'support.session.ended', 'support.session.expired', 'support.session.revoked'
));

create or replace function public.create_approved_audit_export_job(p_approval_request_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor_id uuid := private.require_current_operator_aal2_actor(); request_row public.admin_approval_requests%rowtype; existing_job public.audit_export_jobs%rowtype; job_row public.audit_export_jobs%rowtype; export_payload jsonb; scope_value text; audit_key text;
begin
  if p_approval_request_id is null then raise exception 'AUDIT_EXPORT_INPUT_INVALID'; end if;
  if not exists (select 1 from public.platform_admin_members where user_id = actor_id and status = 'active') then raise exception 'OPERATOR_DISABLED'; end if;
  select * into request_row from public.admin_approval_requests where id = p_approval_request_id for update;
  if not found or request_row.action_type not in ('audit.export.workspace', 'audit.export.global') then raise exception 'APPROVAL_NOT_FOUND'; end if;
  scope_value := case when request_row.action_type = 'audit.export.workspace' then 'workspace' else 'global' end;
  if not private.has_platform_permission('audit.export.request', request_row.workspace_id) then raise exception 'PERMISSION_DENIED'; end if;
  if (request_row.action_type = 'audit.export.workspace' and request_row.workspace_id is null) or (request_row.action_type = 'audit.export.global' and request_row.workspace_id is not null) then raise exception 'AUDIT_EXPORT_INPUT_INVALID'; end if;
  select * into existing_job from public.audit_export_jobs where approval_request_id = request_row.id;
  if found then return jsonb_build_object('export_job_id', existing_job.id, 'status', existing_job.status, 'expires_at', existing_job.expires_at); end if;
  if request_row.status <> 'approved' or request_row.target_type <> 'platform_audit_export' then raise exception 'APPROVAL_STATE_CONFLICT'; end if;
  if statement_timestamp() >= request_row.expires_at then raise exception 'APPROVAL_EXPIRED'; end if;
  export_payload := request_row.request_payload;
  if (select count(*) from jsonb_object_keys(export_payload)) <> 3 or not export_payload ?& array['from', 'to', 'format'] or export_payload ->> 'format' <> 'csv' then raise exception 'AUDIT_EXPORT_INPUT_INVALID'; end if;
  insert into public.audit_export_jobs (approval_request_id, workspace_id, scope, export_from, export_to, format, status, expires_at, filter_fingerprint)
  values (request_row.id, request_row.workspace_id, scope_value, (export_payload ->> 'from')::timestamptz, (export_payload ->> 'to')::timestamptz, 'csv', 'queued', least(request_row.expires_at, statement_timestamp() + interval '24 hours'), encode(extensions.digest(export_payload::text, 'sha256'), 'hex')) returning * into job_row;
  update public.admin_approval_requests set status = 'applied', applied_at = statement_timestamp(), result_summary = jsonb_build_object('export_job_id', job_row.id) where id = request_row.id;
  audit_key := encode(extensions.digest('audit-export-applied:' || request_row.id::text, 'sha256'), 'hex');
  perform private.append_platform_audit_event(actor_id, request_row.workspace_id, request_row.action_type || '.applied', 'platform_audit_export', job_row.id::text, request_row.reason, request_row.id::text, 'succeeded', jsonb_build_object('status', 'approved'), jsonb_build_object('status', 'queued', 'expires_at', job_row.expires_at), audit_key, 'observed', request_row.id, null);
  return jsonb_build_object('export_job_id', job_row.id, 'status', job_row.status, 'expires_at', job_row.expires_at);
exception when others then
  if sqlerrm in ('AUTH_REQUIRED', 'MFA_REQUIRED', 'OPERATOR_DISABLED', 'PERMISSION_DENIED', 'APPROVAL_NOT_FOUND', 'APPROVAL_STATE_CONFLICT', 'APPROVAL_EXPIRED', 'AUDIT_EXPORT_INPUT_INVALID') then raise; end if;
  raise exception 'AUDIT_EXPORT_UNAVAILABLE';
end; $$;
revoke all on function public.create_approved_audit_export_job(uuid) from public, anon, service_role;
grant execute on function public.create_approved_audit_export_job(uuid) to authenticated;

create or replace function public.complete_audit_export_job(p_export_job_id uuid, p_storage_path text, p_content_sha256 text, p_row_count integer, p_byte_size bigint)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare job public.audit_export_jobs%rowtype;
begin
  select * into job from public.audit_export_jobs where id = p_export_job_id for update;
  if not found or statement_timestamp() >= job.expires_at then raise exception 'AUDIT_EXPORT_EXPIRED'; end if;
  if p_storage_path <> (job.scope || '/' || job.id::text || '/audit.csv') or p_content_sha256 !~ '^[a-f0-9]{64}$' or p_row_count < 0 or p_byte_size < 0 then raise exception 'AUDIT_EXPORT_INPUT_INVALID'; end if;
  if job.status = 'succeeded' then
    if job.storage_path = p_storage_path and job.content_sha256 = p_content_sha256 and job.row_count = p_row_count and job.byte_size = p_byte_size then return jsonb_build_object('status', 'succeeded'); end if;
    raise exception 'AUDIT_EXPORT_WRITE_CONFLICT';
  end if;
  if job.status <> 'running' then raise exception 'AUDIT_EXPORT_STATE_CONFLICT'; end if;
  update public.audit_export_jobs set status = 'succeeded', storage_bucket = 'audit-exports', storage_path = p_storage_path, content_sha256 = p_content_sha256, row_count = p_row_count, byte_size = p_byte_size, generated_at = statement_timestamp(), integrity_state = 'hash_recorded', event_chain_state = 'unknown' where id = job.id;
  return jsonb_build_object('status', 'succeeded');
end; $$;
revoke all on function public.complete_audit_export_job(uuid,text,text,integer,bigint) from public, anon, authenticated;
grant execute on function public.complete_audit_export_job(uuid,text,text,integer,bigint) to service_role;

create or replace function public.get_audit_export_download(p_export_job_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare actor_id uuid := private.require_current_operator_aal2_actor(); job public.audit_export_jobs%rowtype;
begin
  if not exists (select 1 from public.platform_admin_members where user_id = actor_id and status = 'active') then raise exception 'OPERATOR_DISABLED'; end if;
  select * into job from public.audit_export_jobs where id = p_export_job_id;
  if not found or job.status <> 'succeeded' or job.expires_at <= statement_timestamp() then raise exception 'AUDIT_EXPORT_EXPIRED'; end if;
  if not private.has_platform_permission('audit.read', job.workspace_id) or not private.has_platform_permission('audit.export.request', job.workspace_id) then raise exception 'PERMISSION_DENIED'; end if;
  return jsonb_build_object('workspace_id', job.workspace_id, 'storage_path', job.storage_path, 'expires_at', job.expires_at);
end; $$;
revoke all on function public.get_audit_export_download(uuid) from public, anon, service_role;
grant execute on function public.get_audit_export_download(uuid) to authenticated;

create or replace function public.expire_audit_export_jobs(p_now timestamptz default statement_timestamp()) returns jsonb language plpgsql security definer set search_path = '' as $$
declare expired_rows jsonb;
begin
  update public.audit_export_jobs set status = 'expired' where status in ('queued', 'running', 'succeeded') and expires_at <= p_now;
  select coalesce(jsonb_agg(jsonb_build_object('job_id', id, 'storage_bucket', storage_bucket, 'storage_path', storage_path)), '[]'::jsonb) into expired_rows from public.audit_export_jobs where status = 'expired' and expires_at <= p_now and storage_path is not null;
  return expired_rows;
end; $$;
revoke all on function public.expire_audit_export_jobs(timestamptz) from public, anon, authenticated;
grant execute on function public.expire_audit_export_jobs(timestamptz) to service_role;

create or replace function public.fail_audit_export_job(p_export_job_id uuid, p_error_code text)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if p_error_code !~ '^[A-Z0-9_]{1,80}$' then raise exception 'AUDIT_EXPORT_INPUT_INVALID'; end if;
  update public.audit_export_jobs set status = 'failed', error_code = p_error_code where id = p_export_job_id and status in ('queued', 'running');
  if not found then raise exception 'AUDIT_EXPORT_STATE_CONFLICT'; end if;
  return jsonb_build_object('status', 'failed');
end; $$;
revoke all on function public.fail_audit_export_job(uuid,text) from public, anon, authenticated;
grant execute on function public.fail_audit_export_job(uuid,text) to service_role;

create or replace function public.list_operator_audit_export_jobs(p_limit integer default 20)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare actor_id uuid := private.require_current_operator_aal2_actor(); rows jsonb;
begin
  if p_limit < 1 or p_limit > 100 then raise exception 'AUDIT_EXPORT_INPUT_INVALID'; end if;
  if not exists (select 1 from public.platform_admin_members where user_id = actor_id and status = 'active') then raise exception 'OPERATOR_DISABLED'; end if;
  if not exists (select 1 from public.platform_admin_role_assignments a join public.platform_role_permissions p on p.role_key = a.role_key where a.user_id = actor_id and p.permission_key = 'audit.read')
    or not exists (select 1 from public.platform_admin_role_assignments a join public.platform_role_permissions p on p.role_key = a.role_key where a.user_id = actor_id and p.permission_key = 'audit.export.request') then raise exception 'PERMISSION_DENIED'; end if;
  select jsonb_build_object('items', coalesce(jsonb_agg(jsonb_build_object('id', job.id, 'status', job.status, 'scope', job.scope, 'workspace_name', workspace.name, 'export_from', job.export_from, 'export_to', job.export_to, 'filter_fingerprint_prefix', left(job.filter_fingerprint, 8), 'filter_fingerprint_present', job.filter_fingerprint is not null, 'generated_at', job.generated_at, 'row_count', job.row_count, 'expires_at', job.expires_at, 'created_at', job.created_at, 'integrity_state', job.integrity_state, 'event_chain_state', job.event_chain_state, 'freshness', case when job.created_at > statement_timestamp() then 'unknown' when job.created_at >= statement_timestamp() - interval '24 hours' then 'fresh' else 'stale' end) order by job.created_at desc), '[]'::jsonb)) into rows
  from (select * from public.audit_export_jobs candidate where private.has_platform_permission('audit.read', candidate.workspace_id) and private.has_platform_permission('audit.export.request', candidate.workspace_id) order by candidate.created_at desc limit p_limit) job left join public.workspaces workspace on workspace.id = job.workspace_id;
  return rows;
end; $$;
revoke all on function public.list_operator_audit_export_jobs(integer) from public, anon, service_role;
grant execute on function public.list_operator_audit_export_jobs(integer) to authenticated;

create or replace function public.claim_audit_export_job(p_export_job_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare job public.audit_export_jobs%rowtype;
begin
  select * into job from public.audit_export_jobs where id = p_export_job_id for update;
  if not found or job.expires_at <= statement_timestamp() then raise exception 'AUDIT_EXPORT_EXPIRED'; end if;
  if job.status = 'running' then raise exception 'AUDIT_EXPORT_ALREADY_RUNNING'; end if;
  if job.status <> 'queued' then raise exception 'AUDIT_EXPORT_STATE_CONFLICT'; end if;
  update public.audit_export_jobs set status = 'running' where id = job.id returning * into job;
  return jsonb_build_object('job_id', job.id, 'scope', job.scope, 'workspace_id', job.workspace_id, 'from', job.export_from, 'to', job.export_to, 'status', job.status);
end; $$;
revoke all on function public.claim_audit_export_job(uuid) from public, anon, authenticated;
grant execute on function public.claim_audit_export_job(uuid) to service_role;

create or replace function public.list_audit_export_rows(p_export_job_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare job public.audit_export_jobs%rowtype; rows jsonb; total integer;
begin
  select * into job from public.audit_export_jobs where id = p_export_job_id;
  if not found or job.status <> 'running' or job.expires_at <= statement_timestamp() then raise exception 'AUDIT_EXPORT_STATE_CONFLICT'; end if;
  select count(*)::integer into total from public.platform_audit_events event where (job.scope = 'global' or event.workspace_id = job.workspace_id) and event.created_at >= job.export_from and event.created_at < job.export_to;
  if total > 50000 then raise exception 'AUDIT_EXPORT_TOO_LARGE'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('created_at', event.created_at, 'workspace_name', workspace.name, 'action', event.action, 'target_type', event.target_type, 'result', event.result, 'fact_kind', event.fact_kind, 'reason', event.reason, 'approval_status', coalesce(request.status, 'none')) order by event.created_at, event.id), '[]'::jsonb) into rows
  from public.platform_audit_events event left join public.workspaces workspace on workspace.id = event.workspace_id left join public.admin_approval_requests request on request.id = event.approval_request_id
  where (job.scope = 'global' or event.workspace_id = job.workspace_id) and event.created_at >= job.export_from and event.created_at < job.export_to;
  return rows;
end; $$;
revoke all on function public.list_audit_export_rows(uuid) from public, anon, authenticated;
grant execute on function public.list_audit_export_rows(uuid) to service_role;
