alter table public.legal_document_versions
  add column idempotency_key uuid;
alter table public.legal_document_versions
  add column review_status text not null default 'draft' check (review_status in ('draft', 'approved'));
alter table public.legal_document_versions
  add column reviewed_by uuid references auth.users(id) on delete restrict;
alter table public.legal_document_versions
  add column reviewed_at timestamptz;
alter table public.legal_document_versions
  add column review_idempotency_key uuid;
alter table public.legal_document_versions
  add column activation_idempotency_key uuid;

update public.legal_document_versions
set review_status = 'approved', reviewed_by = created_by, reviewed_at = created_at
where status in ('active', 'retired');

create unique index legal_document_versions_type_version_key
  on public.legal_document_versions(document_type, version);

create unique index legal_document_versions_idempotency_key
  on public.legal_document_versions(idempotency_key)
  where idempotency_key is not null;
create unique index legal_document_versions_review_idempotency_key
  on public.legal_document_versions(review_idempotency_key)
  where review_idempotency_key is not null;
create unique index legal_document_versions_activation_idempotency_key
  on public.legal_document_versions(activation_idempotency_key)
  where activation_idempotency_key is not null;

alter table public.platform_audit_events drop constraint if exists platform_audit_events_action_check;
alter table public.platform_audit_events add constraint platform_audit_events_action_check check (action in (
  'agreement.verify.requested', 'agreement.verify.approved',
  'channel.disconnect.requested', 'channel.disconnect.approved',
  'publish.retry.requested', 'publish.retry.approved', 'publish.retry.applied',
  'credit.adjust.requested', 'credit.adjust.approved', 'credit.adjust.applied',
  'admin.role.change.workspace.requested', 'admin.role.change.workspace.approved',
  'admin.role.change.global.requested', 'admin.role.change.global.approved',
  'audit.export.workspace.requested', 'audit.export.workspace.approved',
  'audit.export.global.requested', 'audit.export.global.approved',
  'admin.account.activated', 'workspace.activation.requested',
  'document.version.draft_created', 'document.version.reviewed', 'document.version.activated'
));

create or replace function private.prevent_legal_document_content_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE'
    or new.document_type is distinct from old.document_type
    or new.version is distinct from old.version
    or new.fingerprint is distinct from old.fingerprint
    or new.effective_at is distinct from old.effective_at
    or new.expires_at is distinct from old.expires_at
    or new.created_by is distinct from old.created_by
    or new.created_at is distinct from old.created_at
    or new.idempotency_key is distinct from old.idempotency_key
  then
    raise exception 'LEGAL_DOCUMENT_IMMUTABLE' using errcode = 'P0001';
  end if;
  if new.status not in ('draft', 'active', 'retired') then
    raise exception 'DOCUMENT_INPUT_INVALID' using errcode = 'P0001';
  end if;
  if new.status = 'active' and (new.review_status <> 'approved' or new.reviewed_by is null or new.reviewed_at is null) then
    raise exception 'DOCUMENT_REVIEW_REQUIRED' using errcode = 'P0001';
  end if;
  if new.review_status = 'approved' and (new.reviewed_by is null or new.reviewed_at is null) then
    raise exception 'DOCUMENT_REVIEW_REQUIRED' using errcode = 'P0001';
  end if;
  if old.review_status = 'approved'
    and (new.review_status is distinct from old.review_status
      or new.reviewed_by is distinct from old.reviewed_by
      or new.reviewed_at is distinct from old.reviewed_at
      or new.review_idempotency_key is distinct from old.review_idempotency_key)
  then
    raise exception 'DOCUMENT_REVIEW_IMMUTABLE' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger legal_document_versions_immutable
before update or delete on public.legal_document_versions
for each row execute function private.prevent_legal_document_content_mutation();

create or replace function public.create_operator_legal_document_draft(
  p_document_type text,
  p_version text,
  p_fingerprint text,
  p_effective_at timestamptz,
  p_expires_at timestamptz,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  claims jsonb := (select auth.jwt());
  existing public.legal_document_versions%rowtype;
  created public.legal_document_versions%rowtype;
begin
  if actor_id is null or claims ->> 'sub' is distinct from actor_id::text then
    raise exception 'OPERATOR_UNAUTHENTICATED' using errcode = 'P0001';
  end if;
  if claims ->> 'aal' is distinct from 'aal2'
    and coalesce((select member.mfa_required from public.platform_admin_members member where member.user_id = actor_id), true)
  then
    raise exception 'MFA_REQUIRED' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.platform_admin_members member where member.user_id = actor_id and member.status = 'active') then
    raise exception 'OPERATOR_DISABLED' using errcode = 'P0001';
  end if;
  if not private.has_platform_permission('agreement.verify', null) then
    raise exception 'OPERATOR_SCOPE_DENIED' using errcode = 'P0001';
  end if;
  if p_document_type not in ('service_agreement', 'privacy_consent', 'publishing_delegation')
    or p_version is null or char_length(btrim(p_version)) not between 1 and 80
    or p_fingerprint is null or p_fingerprint !~ '^[a-f0-9]{64}$'
    or p_effective_at is null or p_effective_at > statement_timestamp()
    or p_expires_at is not null and p_expires_at <= p_effective_at
    or p_idempotency_key is null
  then
    raise exception 'DOCUMENT_INPUT_INVALID' using errcode = 'P0001';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('legal-document:' || p_document_type, 0));
  select * into existing from public.legal_document_versions where idempotency_key = p_idempotency_key;
  if found then
    if existing.document_type <> p_document_type
      or existing.version <> btrim(p_version)
      or existing.fingerprint <> p_fingerprint
      or existing.effective_at is distinct from p_effective_at
      or existing.expires_at is distinct from p_expires_at
    then
      raise exception 'IDEMPOTENCY_CONFLICT' using errcode = 'P0001';
    end if;
    return jsonb_build_object('document_version_id', existing.id, 'document_type', existing.document_type, 'version', existing.version, 'fingerprint', existing.fingerprint, 'status', existing.status, 'review_status', existing.review_status, 'replayed', true);
  end if;

  insert into public.legal_document_versions(document_type, version, fingerprint, effective_at, expires_at, status, created_by, idempotency_key, review_status)
  values (p_document_type, btrim(p_version), p_fingerprint, p_effective_at, p_expires_at, 'draft', actor_id, p_idempotency_key, 'draft')
  returning * into created;

  perform private.append_platform_audit_event(actor_id, null, 'document.version.draft_created', 'legal_document_version', created.id::text, 'Document version draft created', p_idempotency_key::text, 'succeeded', '{}'::jsonb, jsonb_build_object('document_type', created.document_type, 'version', created.version, 'review_status', created.review_status), encode(extensions.digest('document-draft:' || p_idempotency_key::text, 'sha256'), 'hex'), 'observed', null, null);
  return jsonb_build_object('document_version_id', created.id, 'document_type', created.document_type, 'version', created.version, 'fingerprint', created.fingerprint, 'status', created.status, 'review_status', created.review_status, 'replayed', false);
exception when others then
  if sqlerrm in ('OPERATOR_UNAUTHENTICATED','MFA_REQUIRED','OPERATOR_DISABLED','OPERATOR_SCOPE_DENIED','DOCUMENT_INPUT_INVALID','IDEMPOTENCY_CONFLICT','LEGAL_DOCUMENT_IMMUTABLE','DOCUMENT_REVIEW_REQUIRED') then raise; end if;
  raise exception 'DOCUMENT_WRITE_UNAVAILABLE' using errcode = 'P0001';
end;
$$;

create or replace function public.review_operator_legal_document_version(
  p_document_version_id uuid,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  claims jsonb := (select auth.jwt());
  document_row public.legal_document_versions%rowtype;
begin
  if actor_id is null or claims ->> 'sub' is distinct from actor_id::text then raise exception 'OPERATOR_UNAUTHENTICATED' using errcode = 'P0001'; end if;
  if claims ->> 'aal' is distinct from 'aal2' and coalesce((select member.mfa_required from public.platform_admin_members member where member.user_id = actor_id), true) then raise exception 'MFA_REQUIRED' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.platform_admin_members member where member.user_id = actor_id and member.status = 'active') then raise exception 'OPERATOR_DISABLED' using errcode = 'P0001'; end if;
  if not private.has_platform_permission('agreement.verify', null) or p_document_version_id is null or p_idempotency_key is null then raise exception 'DOCUMENT_INPUT_INVALID' using errcode = 'P0001'; end if;
  select * into document_row from public.legal_document_versions where id = p_document_version_id for update;
  if not found then raise exception 'DOCUMENT_NOT_FOUND' using errcode = 'P0001'; end if;
  if document_row.created_by = actor_id then raise exception 'DOCUMENT_REVIEWER_MUST_DIFFER' using errcode = 'P0001'; end if;
  if document_row.review_idempotency_key = p_idempotency_key and document_row.review_status = 'approved' then
    return jsonb_build_object('document_version_id', document_row.id, 'review_status', document_row.review_status, 'reviewed_by', document_row.reviewed_by, 'reviewed_at', document_row.reviewed_at, 'replayed', true);
  end if;
  if document_row.status <> 'draft' or document_row.review_status <> 'draft' then raise exception 'DOCUMENT_REVIEW_STATE_CONFLICT' using errcode = 'P0001'; end if;
  update public.legal_document_versions
  set review_status = 'approved', reviewed_by = actor_id, reviewed_at = statement_timestamp(), review_idempotency_key = p_idempotency_key
  where id = document_row.id
  returning * into document_row;
  perform private.append_platform_audit_event(actor_id, null, 'document.version.reviewed', 'legal_document_version', document_row.id::text, 'Document version reviewed', p_idempotency_key::text, 'succeeded', jsonb_build_object('review_status', 'draft'), jsonb_build_object('review_status', 'approved', 'reviewed_by', actor_id, 'reviewed_at', document_row.reviewed_at), encode(extensions.digest('document-review:' || p_idempotency_key::text, 'sha256'), 'hex'), 'observed', null, null);
  return jsonb_build_object('document_version_id', document_row.id, 'review_status', document_row.review_status, 'reviewed_by', document_row.reviewed_by, 'reviewed_at', document_row.reviewed_at, 'replayed', false);
exception when others then
  if sqlerrm in ('OPERATOR_UNAUTHENTICATED','MFA_REQUIRED','OPERATOR_DISABLED','DOCUMENT_INPUT_INVALID','DOCUMENT_NOT_FOUND','DOCUMENT_REVIEWER_MUST_DIFFER','DOCUMENT_REVIEW_STATE_CONFLICT','DOCUMENT_REVIEW_IMMUTABLE') then raise; end if;
  raise exception 'DOCUMENT_REVIEW_UNAVAILABLE' using errcode = 'P0001';
end;
$$;

create or replace function public.activate_operator_legal_document_version(
  p_document_version_id uuid,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  claims jsonb := (select auth.jwt());
  document_row public.legal_document_versions%rowtype;
begin
  if actor_id is null or claims ->> 'sub' is distinct from actor_id::text then raise exception 'OPERATOR_UNAUTHENTICATED' using errcode = 'P0001'; end if;
  if claims ->> 'aal' is distinct from 'aal2' and coalesce((select member.mfa_required from public.platform_admin_members member where member.user_id = actor_id), true) then raise exception 'MFA_REQUIRED' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.platform_admin_members member where member.user_id = actor_id and member.status = 'active') then raise exception 'OPERATOR_DISABLED' using errcode = 'P0001'; end if;
  if not private.has_platform_permission('agreement.verify', null) or p_document_version_id is null or p_idempotency_key is null then raise exception 'DOCUMENT_INPUT_INVALID' using errcode = 'P0001'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('legal-document-activate', 0));
  select * into document_row from public.legal_document_versions where id = p_document_version_id for update;
  if not found then raise exception 'DOCUMENT_NOT_FOUND' using errcode = 'P0001'; end if;
  if document_row.created_by = actor_id then raise exception 'DOCUMENT_REVIEWER_MUST_DIFFER' using errcode = 'P0001'; end if;
  if document_row.activation_idempotency_key = p_idempotency_key and document_row.status = 'active' then
    return jsonb_build_object('document_version_id', document_row.id, 'status', document_row.status, 'review_status', document_row.review_status, 'replayed', true);
  end if;
  if document_row.status <> 'draft' or document_row.review_status <> 'approved' then raise exception 'DOCUMENT_ACTIVATION_REQUIRES_REVIEW' using errcode = 'P0001'; end if;
  update public.legal_document_versions set status = 'retired' where document_type = document_row.document_type and status = 'active';
  update public.legal_document_versions set status = 'active', activation_idempotency_key = p_idempotency_key where id = document_row.id returning * into document_row;
  perform private.append_platform_audit_event(actor_id, null, 'document.version.activated', 'legal_document_version', document_row.id::text, 'Document version activated', p_idempotency_key::text, 'succeeded', jsonb_build_object('status', 'draft', 'review_status', 'approved'), jsonb_build_object('status', 'active', 'review_status', 'approved', 'document_type', document_row.document_type, 'version', document_row.version), encode(extensions.digest('document-activate:' || p_idempotency_key::text, 'sha256'), 'hex'), 'observed', null, null);
  return jsonb_build_object('document_version_id', document_row.id, 'status', document_row.status, 'review_status', document_row.review_status, 'replayed', false);
exception when others then
  if sqlerrm in ('OPERATOR_UNAUTHENTICATED','MFA_REQUIRED','OPERATOR_DISABLED','DOCUMENT_INPUT_INVALID','DOCUMENT_NOT_FOUND','DOCUMENT_REVIEWER_MUST_DIFFER','DOCUMENT_ACTIVATION_REQUIRES_REVIEW') then raise; end if;
  raise exception 'DOCUMENT_ACTIVATION_UNAVAILABLE' using errcode = 'P0001';
end;
$$;

create or replace function public.list_operator_document_reconsent_targets(
  p_document_type text,
  p_workspace_id uuid default null,
  p_limit integer default 100
)
returns jsonb
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  claims jsonb := (select auth.jwt());
  active public.legal_document_versions%rowtype;
  items jsonb;
begin
  if actor_id is null or claims ->> 'sub' is distinct from actor_id::text then raise exception 'OPERATOR_UNAUTHENTICATED' using errcode = 'P0001'; end if;
  if claims ->> 'aal' is distinct from 'aal2' and coalesce((select member.mfa_required from public.platform_admin_members member where member.user_id = actor_id), true) then raise exception 'MFA_REQUIRED' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.platform_admin_members member where member.user_id = actor_id and member.status = 'active') then raise exception 'OPERATOR_DISABLED' using errcode = 'P0001'; end if;
  if p_document_type not in ('service_agreement', 'privacy_consent', 'publishing_delegation') or p_limit is null or p_limit < 1 or p_limit > 500 then raise exception 'DOCUMENT_INPUT_INVALID' using errcode = 'P0001'; end if;
  if p_workspace_id is not null and not private.has_platform_permission('agreement.read', p_workspace_id) then raise exception 'OPERATOR_SCOPE_DENIED' using errcode = 'P0001'; end if;
  if p_workspace_id is null and not exists (
    select 1 from public.platform_admin_role_assignments assignment
    join public.platform_role_permissions permission on permission.role_key = assignment.role_key
    where assignment.user_id = actor_id and permission.permission_key = 'agreement.read'
  ) then raise exception 'OPERATOR_PERMISSION_DENIED' using errcode = 'P0001'; end if;

  select * into active from public.legal_document_versions where document_type = p_document_type and status = 'active';
  if not found then
    return jsonb_build_object('document_type', p_document_type, 'active_document', null, 'state', 'empty', 'items', '[]'::jsonb);
  end if;

  if p_document_type in ('service_agreement', 'privacy_consent') then
    with candidates as (
      select w.id as workspace_id, w.name as workspace_name, latest.document_version_id, latest.accepted_at, latest.status, latest.expires_at
      from public.workspaces w
      left join lateral (
        select a.document_version_id, a.accepted_at, a.status, a.expires_at
        from public.workspace_agreements a
        where a.workspace_id = w.id and a.agreement_type = p_document_type
        order by a.created_at desc, a.id desc limit 1
      ) latest on true
      where (p_workspace_id is null or w.id = p_workspace_id)
        and private.has_platform_permission('agreement.read', w.id)
    ), targets as (
      select *, case
        when document_version_id is null then 'missing_acceptance'
        when status = 'withdrawn' then 'withdrawn'
        when status = 'expired' or (expires_at is not null and expires_at <= statement_timestamp()) then 'expired'
        when document_version_id <> active.id then 'document_version_outdated'
        else null end as reason
      from candidates
    )
    select coalesce(jsonb_agg(jsonb_build_object('workspace_id', workspace_id, 'workspace_name', workspace_name, 'document_type', p_document_type, 'channel', null, 'active_version', active.version, 'active_fingerprint', active.fingerprint, 'prior_accepted_at', accepted_at, 'reason', reason) order by workspace_name, workspace_id), '[]'::jsonb) into items from (select * from targets where reason is not null limit p_limit) filtered;
  else
    with candidates as (
      select w.id as workspace_id, w.name as workspace_name, c.channel, latest.document_version_id, latest.accepted_at, latest.status, latest.expires_at
      from public.workspaces w
      join public.channel_connections c on c.workspace_id = w.id
      left join lateral (
        select d.document_version_id, d.accepted_at, d.status, d.expires_at
        from public.channel_delegations d
        where d.workspace_id = w.id and d.channel = c.channel
        order by d.created_at desc, d.id desc limit 1
      ) latest on true
      where (p_workspace_id is null or w.id = p_workspace_id)
        and private.has_platform_permission('agreement.read', w.id)
    ), targets as (
      select *, case
        when document_version_id is null then 'missing_acceptance'
        when status = 'withdrawn' then 'withdrawn'
        when status = 'expired' or (expires_at is not null and expires_at <= statement_timestamp()) then 'expired'
        when document_version_id <> active.id then 'document_version_outdated'
        else null end as reason
      from candidates
    )
    select coalesce(jsonb_agg(jsonb_build_object('workspace_id', workspace_id, 'workspace_name', workspace_name, 'document_type', p_document_type, 'channel', channel, 'active_version', active.version, 'active_fingerprint', active.fingerprint, 'prior_accepted_at', accepted_at, 'reason', reason) order by workspace_name, workspace_id, channel), '[]'::jsonb) into items from (select * from targets where reason is not null limit p_limit) filtered;
  end if;
  return jsonb_build_object('document_type', p_document_type, 'active_document', jsonb_build_object('id', active.id, 'version', active.version, 'fingerprint', active.fingerprint, 'review_status', active.review_status, 'effective_at', active.effective_at, 'expires_at', active.expires_at), 'state', 'fresh', 'items', items);
exception when others then
  if sqlerrm in ('OPERATOR_UNAUTHENTICATED','MFA_REQUIRED','OPERATOR_DISABLED','DOCUMENT_INPUT_INVALID','OPERATOR_PERMISSION_DENIED','OPERATOR_SCOPE_DENIED') then raise; end if;
  raise exception 'DOCUMENT_READ_UNAVAILABLE' using errcode = 'P0001';
end;
$$;

revoke all on function private.prevent_legal_document_content_mutation() from public, anon, authenticated, service_role;
revoke all on function public.create_operator_legal_document_draft(text,text,text,timestamptz,timestamptz,uuid) from public, anon, service_role;
grant execute on function public.create_operator_legal_document_draft(text,text,text,timestamptz,timestamptz,uuid) to authenticated;
revoke all on function public.review_operator_legal_document_version(uuid,uuid) from public, anon, service_role;
grant execute on function public.review_operator_legal_document_version(uuid,uuid) to authenticated;
revoke all on function public.activate_operator_legal_document_version(uuid,uuid) from public, anon, service_role;
grant execute on function public.activate_operator_legal_document_version(uuid,uuid) to authenticated;
revoke all on function public.list_operator_document_reconsent_targets(text,uuid,integer) from public, anon, service_role;
grant execute on function public.list_operator_document_reconsent_targets(text,uuid,integer) to authenticated;
