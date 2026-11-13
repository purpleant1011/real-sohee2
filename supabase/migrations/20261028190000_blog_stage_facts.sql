-- ANI-1899: append-only, public-safe facts for blog research/writing stages.
-- No free text, raw JSON, URLs or customer data. Not applied to production by this change.
begin;

create table public.blog_stage_facts (
  event_id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id),
  run_id uuid not null references public.conversation_jobs(id),
  sequence bigint not null check (sequence > 0 and sequence <= 9007199254740991),
  observed_at timestamptz not null default clock_timestamp(),
  stage text not null check (stage in ('keyword_lookup','benchmark','topic_suggestion','draft_writing','image_generation')),
  status text not null check (status in ('started','verified','failed','partial')),
  provenance text not null check (provenance in ('server_record','fixture','simulated')),
  source_id text not null check (source_id in ('naver_search','naver_datalab','naver_searchad','own_blog','business_facts')),
  sample_size integer check (sample_size >= 0),
  covered integer check (covered >= 0),
  total integer check (total > 0),
  dedupe_key text not null check (length(dedupe_key) between 1 and 128),
  check ((covered is null) = (total is null) and (covered is null or covered <= total)),
  unique (run_id, sequence),
  unique (run_id, dedupe_key)
);
create index blog_stage_facts_workspace_run_seq on public.blog_stage_facts(workspace_id, run_id, sequence);
alter table public.blog_stage_facts enable row level security;
revoke all on public.blog_stage_facts from public, anon, authenticated, service_role;
grant select on public.blog_stage_facts to authenticated, service_role;
create policy blog_stage_member_read on public.blog_stage_facts for select to authenticated
  using ((select private.is_workspace_member(workspace_id)));

create function public.append_blog_stage_fact(
  p_workspace_id uuid, p_run_id uuid, p_stage text, p_status text, p_provenance text,
  p_source_id text, p_sample_size integer, p_covered integer, p_total integer, p_dedupe_key text
) returns setof public.blog_stage_facts
language plpgsql security definer set search_path = '' as $$
declare
  v_seq bigint;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_run_id::text, 1899));
  perform 1 from public.conversation_jobs j where j.id=p_run_id and j.workspace_id=p_workspace_id for share;
  if not found then raise exception 'BLOG_STAGE_RUN_NOT_FOUND' using errcode='42501'; end if;
  if exists(select 1 from public.blog_stage_facts f where f.run_id=p_run_id and f.dedupe_key=p_dedupe_key) then
    if not exists(select 1 from public.blog_stage_facts f where f.run_id=p_run_id and f.dedupe_key=p_dedupe_key
      and f.stage=p_stage and f.status=p_status and f.provenance=p_provenance and f.source_id=p_source_id
      and f.sample_size is not distinct from p_sample_size and f.covered is not distinct from p_covered
      and f.total is not distinct from p_total) then
      raise exception 'BLOG_STAGE_IDEMPOTENCY_CONFLICT';
    end if;
    return query select f.* from public.blog_stage_facts f where f.run_id=p_run_id and f.dedupe_key=p_dedupe_key;
    return;
  end if;
  select coalesce(max(f.sequence),0)+1 into v_seq from public.blog_stage_facts f where f.run_id=p_run_id;
  return query insert into public.blog_stage_facts(workspace_id,run_id,sequence,stage,status,provenance,source_id,sample_size,covered,total,dedupe_key)
    values(p_workspace_id,p_run_id,v_seq,p_stage,p_status,p_provenance,p_source_id,p_sample_size,p_covered,p_total,p_dedupe_key) returning *;
end;
$$;
revoke all on function public.append_blog_stage_fact(uuid,uuid,text,text,text,text,integer,integer,integer,text) from public, anon, authenticated;
grant execute on function public.append_blog_stage_fact(uuid,uuid,text,text,text,text,integer,integer,integer,text) to service_role;
commit;
