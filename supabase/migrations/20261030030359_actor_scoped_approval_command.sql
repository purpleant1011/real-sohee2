-- Browser EXECUTE remains revoked. The authenticated server action supplies the actor,
-- and this service-only adapter preserves the native version/rights/audit/dispatch gates.
create or replace function public.approve_and_dispatch_content_as_actor(
  p_actor_user_id uuid, p_workspace_id uuid, p_content_id uuid, p_version_id uuid,
  p_expected_fingerprint text, p_mode text, p_publish_at timestamptz,
  p_timezone text, p_channel_connection_id uuid, p_lane text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text;
  v_result jsonb;
  v_previous_sub text := current_setting('request.jwt.claim.sub', true);
  v_previous_claims text := current_setting('request.jwt.claims', true);
begin
  if p_actor_user_id is null or p_workspace_id is null or p_mode is null
    or p_mode not in ('approve_only','publish_now','schedule')
    or p_lane is null or p_lane not in ('meta','local') then
    raise exception 'APPROVAL_COMMAND_INVALID' using errcode = '22023';
  end if;
  select role into v_role from public.workspace_members
  where workspace_id=p_workspace_id and user_id=p_actor_user_id and status='active'
  for share;
  if not found or v_role not in ('owner','manager','reviewer')
    or (p_mode <> 'approve_only' and v_role not in ('owner','manager')) then
    raise exception 'APPROVAL_ACTOR_FORBIDDEN' using errcode = '42501';
  end if;
  perform set_config('request.jwt.claim.sub', p_actor_user_id::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub',p_actor_user_id,'role','authenticated')::text, true);
  if p_lane='meta' then
    v_result := public.approve_and_dispatch_meta_content(
      p_workspace_id,p_content_id,p_version_id,p_expected_fingerprint,p_mode,
      p_publish_at,p_timezone,p_channel_connection_id
    );
  else
    v_result := public.approve_and_dispatch_local_content(
      p_workspace_id,p_content_id,p_version_id,p_expected_fingerprint,p_mode,
      p_publish_at,p_timezone,p_channel_connection_id
    );
  end if;
  perform set_config('request.jwt.claim.sub', coalesce(v_previous_sub,''), true);
  perform set_config('request.jwt.claims', coalesce(v_previous_claims,'{}'), true);
  return v_result;
exception when others then
  perform set_config('request.jwt.claim.sub', coalesce(v_previous_sub,''), true);
  perform set_config('request.jwt.claims', coalesce(v_previous_claims,'{}'), true);
  raise;
end;
$$;
revoke all on function public.approve_and_dispatch_content_as_actor(uuid,uuid,uuid,uuid,text,text,timestamptz,text,uuid,text) from public,anon,authenticated;
grant execute on function public.approve_and_dispatch_content_as_actor(uuid,uuid,uuid,uuid,text,text,timestamptz,text,uuid,text) to service_role;
notify pgrst, 'reload schema';
