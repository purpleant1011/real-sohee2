-- ANI-1789. Immutable consumption survives timeouts/cold starts; never auto-expire an uncertain external write.
create table public.first_post_publish_consumptions (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  mission_id uuid not null references public.marketing_missions(id) on delete restrict,
  approved_fingerprint text not null check (approved_fingerprint ~ '^[a-f0-9]{64}$'),
  provider text not null check (provider in ('instagram','threads')),
  account_id text not null,
  intent_scope text not null,
  content_fingerprint text not null,
  claim_token uuid not null,
  consumed_at timestamptz not null default statement_timestamp(),
  primary key (workspace_id,mission_id,approved_fingerprint,provider),
  unique (workspace_id,provider,account_id,intent_scope,content_fingerprint)
);
alter table public.first_post_publish_consumptions enable row level security;
revoke all on public.first_post_publish_consumptions from public,anon,authenticated,service_role;
grant select,insert on public.first_post_publish_consumptions to service_role;
create policy first_post_consumptions_service_only on public.first_post_publish_consumptions for all to service_role using (true) with check (true);
create index first_post_consumptions_mission_idx on public.first_post_publish_consumptions(mission_id);

create function private.first_post_publish_key(payload jsonb,provider_name text) returns text
language sql immutable set search_path='' as $$
 select encode(sha256(convert_to(jsonb_build_object(
  'text',coalesce(payload->'copies'->provider_name->>'caption',payload->'copies'->provider_name->>'content',''),
  'cta',coalesce(payload->'copies'->provider_name->>'cta',''),
  'hashtags',coalesce(payload->'copies'->provider_name->'hashtags','[]'),
  'images',(select coalesce(jsonb_agg(value order by value),'[]') from jsonb_array_elements(coalesce(payload->'imageIds','[]'))),
  'rights',payload->'rights')::text,'UTF8')),'hex')
$$;
revoke all on function private.first_post_publish_key(jsonb,text) from public,anon,authenticated,service_role;

create function public.consume_first_post_publish(p_workspace_id uuid,p_mission_id uuid,p_fingerprint text,p_payload jsonb,p_claim_token uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare m public.marketing_missions%rowtype; target jsonb; provider_name text; account text; scope text; content_hash text;
begin
 if (select auth.role()) is distinct from 'service_role' then raise insufficient_privilege using message='Server-only publish consumption'; end if;
 if p_fingerprint is null or p_fingerprint !~ '^[a-f0-9]{64}$' or p_claim_token is null then return jsonb_build_object('claimed',false,'code','INVALID_PUBLISH_CLAIM'); end if;
 -- Serialize this small ledger transaction per tenant, including different R1/R2 mission rows.
 perform pg_advisory_xact_lock(hashtextextended(p_workspace_id::text,1789));
 select * into m from public.marketing_missions where id=p_mission_id and workspace_id=p_workspace_id for update;
 if not found or p_payload->>'workspaceId' is distinct from p_workspace_id::text or p_payload->>'missionId' is distinct from p_mission_id::text or m.status<>'APPROVED' or m.metadata->'payload' is distinct from p_payload
    or m.metadata->'approvedMission'->>'approvedFingerprint' is distinct from p_fingerprint then
  return jsonb_build_object('claimed',false,'code','STALE_PUBLISH_APPROVAL');
 end if;
 if exists(select 1 from public.first_post_publish_consumptions where workspace_id=p_workspace_id and mission_id=p_mission_id and approved_fingerprint=p_fingerprint) then
  return jsonb_build_object('claimed',false,'code','PUBLISH_APPROVAL_CONSUMED');
 end if;
 if jsonb_typeof(p_payload->'channels') is distinct from 'array' or jsonb_array_length(p_payload->'channels')=0 then
  return jsonb_build_object('claimed',false,'code','PUBLISH_TARGET_UNAVAILABLE');
 end if;
 -- A separate server-authored campaign intent permits an explicitly approved new campaign; no arbitrary time window.
 scope:=coalesce(nullif(m.metadata->>'publishIntentId',''),'first-post');
 begin
  for target in select value from jsonb_array_elements(p_payload->'channels') loop
   provider_name:=target->>'provider';
   select external_account_id into account from public.channel_connections
    where workspace_id=p_workspace_id and channel=provider_name and status in ('connected','verified')
      and lower(regexp_replace(account_label,'^@',''))=lower(regexp_replace(target->>'handle','^@',''));
   if provider_name not in ('instagram','threads') or account is null or account='' then
    raise exception using errcode='P1789',message='PUBLISH_TARGET_UNAVAILABLE';
   end if;
   content_hash:=private.first_post_publish_key(p_payload,provider_name);
   if exists(select 1 from public.marketing_missions old
     where old.workspace_id=p_workspace_id and old.id<>p_mission_id
       and (old.status in ('PUBLISHED_VERIFIED','EXECUTING') or old.metadata->'executionResult' is not null)
       and coalesce(nullif(old.metadata->>'publishIntentId',''),'first-post')=scope
       and private.first_post_publish_key(old.metadata->'payload',provider_name)=content_hash
       and exists(select 1 from jsonb_array_elements(coalesce(old.metadata->'payload'->'channels','[]')) c
         where c->>'provider'=provider_name and lower(regexp_replace(c->>'handle','^@',''))=lower(regexp_replace(target->>'handle','^@','')))) then
     raise unique_violation using message='Historical accepted/uncertain content';
   end if;
   insert into public.first_post_publish_consumptions(workspace_id,mission_id,approved_fingerprint,provider,account_id,intent_scope,content_fingerprint,claim_token)
    values(p_workspace_id,p_mission_id,p_fingerprint,provider_name,account,scope,content_hash,p_claim_token);
  end loop;
 exception
  when unique_violation then return jsonb_build_object('claimed',false,'code','PUBLISH_CONTENT_ALREADY_CLAIMED');
  when sqlstate 'P1789' then return jsonb_build_object('claimed',false,'code','PUBLISH_TARGET_UNAVAILABLE');
 end;
 return jsonb_build_object('claimed',true);
end $$;
revoke all on function public.consume_first_post_publish(uuid,uuid,text,jsonb,uuid) from public,anon,authenticated,service_role;
grant execute on function public.consume_first_post_publish(uuid,uuid,text,jsonb,uuid) to service_role;
