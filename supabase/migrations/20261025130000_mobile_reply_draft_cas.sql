-- Track 2: raw draft editing only. No provider send, acceptance fabrication or reservation creation.
create function public.save_mobile_reply_draft(p_workspace_id uuid,p_kind text,p_parent_id uuid,p_text text,p_expected_updated_at timestamptz,p_expected_text text,p_actor_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare parent_state text; expires timestamptz; current_text text; current_at timestamptz; saved_at timestamptz; actor_role text; provider text; has_draft boolean;
begin
 if (select auth.role()) is distinct from 'service_role' then raise insufficient_privilege; end if;
 select role into actor_role from public.workspace_members where workspace_id=p_workspace_id and user_id=p_actor_id and status='active' and role in ('owner','manager');
 if actor_role is null then return jsonb_build_object('saved',false,'code','FORBIDDEN'); end if;
 if p_kind not in ('dm','comment') or p_text is null or length(btrim(p_text))=0 or length(p_text)>(case when p_kind='dm' then 1000 else 2200 end) then return jsonb_build_object('saved',false,'code','INVALID_DRAFT'); end if;
 if p_kind='dm' then
  select status,expires_at into parent_state,expires from public.instagram_dm_threads where workspace_id=p_workspace_id and id=p_parent_id for update;
 else
  select status,channel into parent_state,provider from public.social_comments where workspace_id=p_workspace_id and id=p_parent_id for update;
 end if;
 if parent_state is null then return jsonb_build_object('saved',false,'code','NOT_FOUND'); end if;
 if parent_state in ('SENT','SENDING','NEEDS_CHECK','FAILED','DISMISSED','EXPIRED') or (p_kind='dm' and (expires is null or expires<=statement_timestamp())) then return jsonb_build_object('saved',false,'code','IMMUTABLE_REPLY_STATE'); end if;
 if p_kind='dm' then
  select draft_text,updated_at into current_text,current_at from public.instagram_dm_drafts where workspace_id=p_workspace_id and thread_id=p_parent_id for update;
 else
  select draft_text,updated_at into current_text,current_at from public.comment_reply_drafts where workspace_id=p_workspace_id and comment_id=p_parent_id for update;
 end if;
 has_draft:=found;
 if current_at is distinct from p_expected_updated_at or current_text is distinct from p_expected_text then return jsonb_build_object('saved',false,'code','DRAFT_CONFLICT'); end if;
 if p_kind='dm' then
  if has_draft then update public.instagram_dm_drafts set draft_text=p_text,approved_fingerprint=null,approved_by=null,approved_at=null where workspace_id=p_workspace_id and thread_id=p_parent_id returning updated_at into saved_at;
  else insert into public.instagram_dm_drafts(workspace_id,thread_id,draft_text) values(p_workspace_id,p_parent_id,p_text) returning updated_at into saved_at; end if;
  insert into public.instagram_dm_audit(workspace_id,thread_id,actor,actor_user_id,action,readback_verified,details) values(p_workspace_id,p_parent_id,actor_role,p_actor_id,'edit_draft',false,jsonb_build_object('draftLength',length(p_text)));
 else
  if has_draft then update public.comment_reply_drafts set draft_text=p_text,approved_fingerprint=null,approved_by=null,approved_at=null where workspace_id=p_workspace_id and comment_id=p_parent_id returning updated_at into saved_at;
  else insert into public.comment_reply_drafts(workspace_id,comment_id,draft_text) values(p_workspace_id,p_parent_id,p_text) returning updated_at into saved_at; end if;
  insert into public.engagement_audit(workspace_id,comment_id,channel,actor,actor_user_id,action,readback_verified,details) values(p_workspace_id,p_parent_id,provider,actor_role,p_actor_id,'edit_draft',false,jsonb_build_object('draftLength',length(p_text)));
 end if;
 return jsonb_build_object('saved',true,'updatedAt',saved_at);
end $$;
revoke all on function public.save_mobile_reply_draft(uuid,text,uuid,text,timestamptz,text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.save_mobile_reply_draft(uuid,text,uuid,text,timestamptz,text,uuid) to service_role;
