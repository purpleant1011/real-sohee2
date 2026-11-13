-- Provider execution evidence contains hashes/usage only, never raw prompts, credentials or images.
create table public.learning_provider_receipts (
  id text primary key default gen_random_uuid()::text,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  knowledge_source_id uuid not null,
  source_revision integer not null check (source_revision > 0),
  provider_response_id text not null check (char_length(provider_response_id) between 1 and 500),
  model text not null check (char_length(model) between 1 and 120),
  kind text not null check (kind in ('text','vision')),
  input_hash text not null check (input_hash ~ '^[a-f0-9]{64}$'),
  media_refs jsonb not null default '[]'::jsonb check (jsonb_typeof(media_refs)='array'),
  usage jsonb not null check (jsonb_typeof(usage)='object'),
  observed_at timestamptz not null default clock_timestamp(),
  unique(workspace_id,knowledge_source_id,id),
  unique(workspace_id,knowledge_source_id,source_revision,id),
  unique(workspace_id,knowledge_source_id,provider_response_id),
  foreign key(workspace_id,knowledge_source_id) references public.knowledge_sources(workspace_id,id) on delete cascade
);
alter table public.learning_provider_receipts enable row level security;
revoke all on public.learning_provider_receipts from public, anon, authenticated;
grant select,insert,update,delete on public.learning_provider_receipts to service_role;

-- Nullable on legacy/manual candidates. New observed vision candidates must have an actual scoped receipt matching tenant, source and revision.
alter table public.knowledge_candidates add constraint knowledge_candidate_vision_receipt_fkey
  foreign key(workspace_id,knowledge_source_id,source_revision,evidence_vision_receipt_id)
  references public.learning_provider_receipts(workspace_id,knowledge_source_id,source_revision,id) on delete restrict not valid;

create function public.record_learning_provider_receipt(
  p_workspace_id uuid, p_source_id uuid, p_source_revision integer,
  p_provider_response_id text, p_model text, p_kind text, p_input_hash text,
  p_media_refs jsonb, p_usage jsonb
) returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_source public.knowledge_sources%rowtype;
  v_id text;
  v_media jsonb;
  v_existing public.learning_provider_receipts%rowtype;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'FORBIDDEN'; end if;
  if p_kind is null or p_kind not in ('text','vision') or p_input_hash is null
    or p_input_hash !~ '^[a-f0-9]{64}$' or p_provider_response_id is null
    or char_length(p_provider_response_id) not between 1 and 500
    or p_model is null or p_model !~ '^[a-zA-Z0-9._/-]{1,120}$'
    or p_media_refs is null or jsonb_typeof(p_media_refs) <> 'array'
    or jsonb_array_length(p_media_refs) > 10 or p_usage is null
    or jsonb_typeof(p_usage) <> 'object' or octet_length(p_usage::text) > 4096 then
    raise exception 'INVALID_PROVIDER_RECEIPT';
  end if;
  if not (p_usage ?& array['promptTokenCount','candidatesTokenCount','totalTokenCount'])
    or exists(select 1 from jsonb_each(p_usage) u where
      u.key not in ('promptTokenCount','candidatesTokenCount','totalTokenCount','cachedContentTokenCount','thoughtsTokenCount')
      or jsonb_typeof(u.value) <> 'number' or u.value::text !~ '^[0-9]+$')
    or (p_usage->>'totalTokenCount')::bigint <= 0 then raise exception 'INVALID_PROVIDER_USAGE'; end if;
  select * into v_source from public.knowledge_sources s
    where s.workspace_id=p_workspace_id and s.id=p_source_id and s.is_learning_source=true for update;
  if not found or v_source.deleted_at is not null or v_source.status='paused'
    or v_source.lifecycle_revision is distinct from p_source_revision
    or v_source.learning_verification_status is distinct from 'verified'
    or (p_kind='text' and not v_source.consent_text)
    or (p_kind='vision' and not v_source.consent_images)
    or not exists(select 1 from public.learning_evidence_leases l where l.workspace_id=p_workspace_id
      and l.knowledge_source_id=p_source_id and l.evidence_revision=v_source.evidence_revision
      and l.revoked_at is null and l.expires_at>clock_timestamp()) then raise exception 'SOURCE_NOT_ELIGIBLE'; end if;
  if p_kind='vision' then
    if jsonb_array_length(p_media_refs)=0 then raise exception 'MEDIA_EVIDENCE_INVALID'; end if;
    for v_media in select value from jsonb_array_elements(p_media_refs) loop
      if v_media->>'mediaId' is null or (v_media->>'hash') is null
        or (v_media->>'hash') !~ '^[a-f0-9]{64}$'
        or not exists(select 1 from public.learning_documents d,
          lateral jsonb_array_elements(d.images) im where d.workspace_id=p_workspace_id
          and d.knowledge_source_id=p_source_id and d.source_revision=p_source_revision
          and im->>'mediaId'=v_media->>'mediaId') then raise exception 'MEDIA_EVIDENCE_INVALID'; end if;
    end loop;
  end if;
  insert into public.learning_provider_receipts(workspace_id,knowledge_source_id,source_revision,
    provider_response_id,model,kind,input_hash,media_refs,usage)
  values(p_workspace_id,p_source_id,p_source_revision,p_provider_response_id,p_model,p_kind,p_input_hash,p_media_refs,p_usage)
  on conflict(workspace_id,knowledge_source_id,provider_response_id) do nothing returning id into v_id;
  if v_id is null then
    select * into v_existing from public.learning_provider_receipts r where r.workspace_id=p_workspace_id
      and r.knowledge_source_id=p_source_id and r.provider_response_id=p_provider_response_id;
    if v_existing.source_revision is distinct from p_source_revision or v_existing.input_hash is distinct from p_input_hash
      or v_existing.model is distinct from p_model or v_existing.kind is distinct from p_kind
      or v_existing.media_refs is distinct from p_media_refs then raise exception 'PROVIDER_RECEIPT_CONFLICT'; end if;
    v_id := v_existing.id;
  end if;
  return v_id;
end $$;
revoke all on function public.record_learning_provider_receipt(uuid,uuid,integer,text,text,text,text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.record_learning_provider_receipt(uuid,uuid,integer,text,text,text,text,jsonb,jsonb) to service_role;

create function public.purge_learning_source_payloads(p_workspace_id uuid,p_source_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_documents integer; v_candidates integer;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'FORBIDDEN'; end if;
  perform 1 from public.knowledge_sources s where s.workspace_id=p_workspace_id and s.id=p_source_id
    and s.is_learning_source=true and s.deleted_at is not null for update;
  if not found then raise exception 'SOURCE_NOT_DELETED'; end if;
  -- Keep only relationship/audit identifiers required by existing restrict FKs; erase user content.
  update public.knowledge_facts f set content='삭제된 학습 자료',status='expired'
    where f.workspace_id=p_workspace_id and f.source_candidate_id in
      (select c.id from public.knowledge_candidates c where c.workspace_id=p_workspace_id and c.knowledge_source_id=p_source_id)
      and (f.content is distinct from '삭제된 학습 자료' or f.status is distinct from 'expired');
  update public.knowledge_candidates c set content='삭제된 학습 자료',source_excerpt=null,
    evidence_vision_receipt_id=null,confidence=null
    where c.workspace_id=p_workspace_id and c.knowledge_source_id=p_source_id
      and (c.content is distinct from '삭제된 학습 자료' or c.source_excerpt is not null or c.evidence_vision_receipt_id is not null or c.confidence is not null);
  get diagnostics v_candidates=row_count;
  update public.learning_documents d set text_content='',images='[]'::jsonb,url='https://removed.invalid/',
    author_account_id='',provider_document_id='purged:'||d.id::text
    where d.workspace_id=p_workspace_id and d.knowledge_source_id=p_source_id
      and (d.text_content is distinct from '' or d.images is distinct from '[]'::jsonb or d.url is distinct from 'https://removed.invalid/' or d.author_account_id is distinct from '' or d.provider_document_id is distinct from ('purged:'||d.id::text));
  get diagnostics v_documents=row_count;
  delete from public.learning_provider_receipts r where r.workspace_id=p_workspace_id and r.knowledge_source_id=p_source_id;
  update public.knowledge_sources s set uri='https://removed.invalid/',display_name='삭제된 출처'
    where s.workspace_id=p_workspace_id and s.id=p_source_id
      and (s.uri is distinct from 'https://removed.invalid/' or s.display_name is distinct from '삭제된 출처');
  update public.learning_jobs j set error_message=null,
    checkpoint=case when j.checkpoint ? 'billing' then jsonb_build_object('billing',j.checkpoint->'billing') else '{}'::jsonb end
    where j.workspace_id=p_workspace_id and j.knowledge_source_id=p_source_id and j.job_kind<>'delete';
  -- SNS originals are never deleted. There are no owned media blobs in this collector.
  return jsonb_build_object('purgedDocuments',v_documents,'purgedCandidates',v_candidates,'purgedMedia',0);
end $$;
revoke all on function public.purge_learning_source_payloads(uuid,uuid) from public,anon,authenticated;
grant execute on function public.purge_learning_source_payloads(uuid,uuid) to service_role;

create function public.purge_expired_learning_payloads(p_workspace_id uuid default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_count integer;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'FORBIDDEN'; end if;
  with due as (select d.id from public.learning_documents d where
    (p_workspace_id is null or d.workspace_id=p_workspace_id)
    and d.collected_at < clock_timestamp()-interval '7 days'
    and (d.text_content<>'' or d.images<>'[]'::jsonb)
    order by d.collected_at limit 500 for update skip locked)
  update public.learning_documents d set text_content='',images='[]'::jsonb
    from due where d.id=due.id;
  get diagnostics v_count=row_count;
  return jsonb_build_object('purgedCount',v_count,'failedCount',0);
end $$;
revoke all on function public.purge_expired_learning_payloads(uuid) from public,anon,authenticated;
grant execute on function public.purge_expired_learning_payloads(uuid) to service_role;

-- Enforce zero false-completed privacy delete jobs: completion requires all receipts and raw document payloads to be fully purged.
create function public.learning_jobs_delete_completion_guard()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.job_kind = 'delete' and new.status = 'completed' and old.status is distinct from 'completed' then
    if exists (
      select 1 from public.learning_provider_receipts r
      where r.workspace_id = new.workspace_id
        and r.knowledge_source_id = new.knowledge_source_id
    ) or exists (
      select 1 from public.learning_documents d
      where d.workspace_id = new.workspace_id
        and d.knowledge_source_id = new.knowledge_source_id
        and (d.text_content is distinct from '' or d.images is distinct from '[]'::jsonb)
    ) or exists (
      select 1 from public.knowledge_candidates c
      where c.workspace_id = new.workspace_id
        and c.knowledge_source_id = new.knowledge_source_id
        and c.content is distinct from '삭제된 학습 자료'
    ) then
      raise exception 'DELETE_JOB_INCOMPLETE';
    end if;
  end if;
  return new;
end $$;
revoke all on function public.learning_jobs_delete_completion_guard() from public, anon, authenticated;
grant execute on function public.learning_jobs_delete_completion_guard() to service_role;

create trigger learning_jobs_delete_completion_guard_trg
  before update on public.learning_jobs
  for each row execute function public.learning_jobs_delete_completion_guard();

