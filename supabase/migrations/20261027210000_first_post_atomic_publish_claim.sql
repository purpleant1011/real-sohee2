-- Preserve consumption history, but serialize eligibility and the mission claim in ONE transaction.
-- Rollback: restore the previous RPC only after rolling back the application; do not delete history.
do $$
declare constraint_name text;
begin
 select conname into strict constraint_name from pg_constraint
  where conrelid='public.first_post_publish_consumptions'::regclass and contype='u';
 execute format('alter table public.first_post_publish_consumptions drop constraint %I',constraint_name);
end $$;
create index first_post_consumptions_content_idx on public.first_post_publish_consumptions
  (workspace_id,provider,account_id,intent_scope,content_fingerprint);

-- Old application instances cannot safely use the former reserve-then-CAS protocol.
create or replace function public.consume_first_post_publish(p_workspace_id uuid,p_mission_id uuid,p_fingerprint text,p_payload jsonb,p_claim_token uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if (select auth.role()) is distinct from 'service_role' then raise insufficient_privilege; end if;
 return jsonb_build_object('claimed',false,'code','PUBLISH_CLIENT_UPGRADE_REQUIRED');
end $$;

create function private.first_post_channel_definitely_failed(metadata jsonb,provider_name text) returns boolean
language sql immutable set search_path='' as $$
 select coalesce(
   metadata->'executionResult'->'receipts'->provider_name->>'stage' = 'FAILED'
   and nullif(metadata->'executionResult'->'receipts'->provider_name->>'providerPostId','') is null
   and metadata->'executionResult'->>'approvalFingerprint' = metadata->'approvedMission'->>'approvedFingerprint'
   and metadata->'executionResult'->'receipts'->provider_name->>'approvalFingerprint' = metadata->'approvedMission'->>'approvedFingerprint'
   and nullif(metadata->>'retryLock','') is null,
 false)
$$;
revoke all on function private.first_post_channel_definitely_failed(jsonb,text) from public,anon,authenticated,service_role;

create function public.claim_first_post_publish(
 p_workspace_id uuid,p_mission_id uuid,p_fingerprint text,p_payload jsonb,p_claim_token uuid,
 p_expected_metadata jsonb,p_expected_updated_at timestamptz,p_idempotency_key text default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
 m public.marketing_missions%rowtype; target jsonb; provider_name text; account text;
 scope text; content_hash text; stamp timestamptz := statement_timestamp();
 version_no bigint; existing_claim public.first_post_publish_consumptions%rowtype;
begin
 if (select auth.role()) is distinct from 'service_role' then raise insufficient_privilege using message='Server-only publish claim'; end if;
 if p_fingerprint is null or p_fingerprint !~ '^[a-f0-9]{64}$' or p_claim_token is null then
  return jsonb_build_object('claimed',false,'code','INVALID_PUBLISH_CLAIM');
 end if;
 perform pg_advisory_xact_lock(hashtextextended(p_workspace_id::text,1789));
 select * into m from public.marketing_missions where id=p_mission_id and workspace_id=p_workspace_id for update;
 if not found or m.status <> 'APPROVED' or m.metadata is distinct from p_expected_metadata
    or m.updated_at is distinct from p_expected_updated_at
    or p_payload->>'workspaceId' is distinct from p_workspace_id::text
    or p_payload->>'missionId' is distinct from p_mission_id::text
    or m.metadata->'payload' is distinct from p_payload
    or m.metadata->'approvedMission'->>'approvedFingerprint' is distinct from p_fingerprint
    or nullif(m.metadata->>'retryLock','') is not null then
  return jsonb_build_object('claimed',false,'code','STALE_PUBLISH_APPROVAL');
 end if;
 if jsonb_typeof(p_payload->'channels') is distinct from 'array' or jsonb_array_length(p_payload->'channels')=0 then
  return jsonb_build_object('claimed',false,'code','PUBLISH_TARGET_UNAVAILABLE');
 end if;
 version_no := coalesce((m.metadata->>'snapshot_version')::bigint,1);
 if version_no < 1 or version_no >= 9007199254740991 then raise exception 'INVALID_MISSION_SNAPSHOT_VERSION'; end if;
 scope := coalesce(nullif(m.metadata->>'publishIntentId',''),'first-post');
 begin
  for target in select value from jsonb_array_elements(p_payload->'channels') loop
   provider_name := target->>'provider';
   account := null;
   select external_account_id into account from public.channel_connections
    where workspace_id=p_workspace_id and channel=provider_name and status in ('connected','authorized','verified')
      and lower(regexp_replace(account_label,'^@',''))=lower(regexp_replace(target->>'handle','^@',''));
   if provider_name not in ('instagram','threads') or account is null or account='' then
    raise exception using errcode='P1789',message='PUBLISH_TARGET_UNAVAILABLE';
   end if;
   content_hash := private.first_post_publish_key(p_payload,provider_name);
   -- A confirmed rejection does not reserve this content forever. Accepted/unknown/missing evidence does.
   if exists(select 1 from public.first_post_publish_consumptions c
     join public.marketing_missions old on old.id=c.mission_id and old.workspace_id=c.workspace_id
     where c.workspace_id=p_workspace_id and c.provider=provider_name and c.account_id=account
       and c.intent_scope=scope and c.content_fingerprint=content_hash and c.mission_id<>p_mission_id
       and not private.first_post_channel_definitely_failed(old.metadata,provider_name))
    or exists(select 1 from public.marketing_missions old
     where old.workspace_id=p_workspace_id and old.id<>p_mission_id
       and (old.status in ('PUBLISHED_VERIFIED','EXECUTING') or old.metadata->'executionResult' is not null)
       and coalesce(nullif(old.metadata->>'publishIntentId',''),'first-post')=scope
       and private.first_post_publish_key(old.metadata->'payload',provider_name)=content_hash
       and not private.first_post_channel_definitely_failed(old.metadata,provider_name)
       and exists(select 1 from jsonb_array_elements(coalesce(old.metadata->'payload'->'channels','[]')) c
         where c->>'provider'=provider_name and lower(regexp_replace(c->>'handle','^@',''))=lower(regexp_replace(target->>'handle','^@','')))) then
    raise exception using errcode='P1790',message='PUBLISH_CONTENT_ALREADY_CLAIMED';
   end if;
   select * into existing_claim from public.first_post_publish_consumptions
    where workspace_id=p_workspace_id and mission_id=p_mission_id and approved_fingerprint=p_fingerprint and provider=provider_name;
   if found then
    -- Recover only a pre-dispatch reservation: APPROVED + no lock + NO result. The row lock and
    -- snapshot update fence an old worker's CAS before granting this worker execution ownership.
    if m.metadata->'executionResult' is not null or existing_claim.account_id<>account
       or existing_claim.content_fingerprint<>content_hash or existing_claim.intent_scope<>scope then
     raise exception using errcode='P1790',message='PUBLISH_APPROVAL_CONSUMED';
    end if;
   else
    insert into public.first_post_publish_consumptions(workspace_id,mission_id,approved_fingerprint,provider,account_id,intent_scope,content_fingerprint,claim_token)
     values(p_workspace_id,p_mission_id,p_fingerprint,provider_name,account,scope,content_hash,p_claim_token);
   end if;
  end loop;
  -- Both the durable reservation and execution ownership commit or roll back together.
  update public.marketing_missions set status='EXECUTING',updated_at=stamp,
   metadata=m.metadata || jsonb_build_object('snapshot_version',version_no+1,'retryLock',p_claim_token,'lockedAt',stamp)
     || case when p_idempotency_key is null then '{}'::jsonb else jsonb_build_object('publishIdempotencyKey',p_idempotency_key) end
   where id=p_mission_id and workspace_id=p_workspace_id;
 exception
  when sqlstate 'P1789' then return jsonb_build_object('claimed',false,'code',sqlerrm);
  when sqlstate 'P1790' then return jsonb_build_object('claimed',false,'code',sqlerrm);
 end;
 return jsonb_build_object('claimed',true);
end $$;
revoke all on function public.claim_first_post_publish(uuid,uuid,text,jsonb,uuid,jsonb,timestamptz,text) from public,anon,authenticated,service_role;
grant execute on function public.claim_first_post_publish(uuid,uuid,text,jsonb,uuid,jsonb,timestamptz,text) to service_role;
