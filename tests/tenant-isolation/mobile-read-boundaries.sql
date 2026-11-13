-- ANI-1790: 실제 PostgreSQL 역할/RLS 실행. 운영 DB나 외부 Provider를 사용하지 않는다.
begin;
create temporary table mobile_actors (ws uuid, actor uuid);
insert into mobile_actors values
 ('a7900000-0000-4000-8000-000000000001','a7900000-0000-4000-8000-000000000002'),
 ('b7900000-0000-4000-8000-000000000001','b7900000-0000-4000-8000-000000000002');
insert into auth.users(id) select actor from mobile_actors;
insert into auth.users(id) values
 ('c7900000-0000-4000-8000-000000000002'),
 ('d7900000-0000-4000-8000-000000000002');
insert into public.workspaces(id,name,created_by) select ws,'ANI-1790 local fixture',actor from mobile_actors;
insert into public.workspace_members(workspace_id,user_id,role,status)
 select ws,'c7900000-0000-4000-8000-000000000002','reviewer','disabled' from mobile_actors;
insert into public.business_profiles(workspace_id,business_name) select ws,'local tenant fixture' from mobile_actors;
insert into public.channel_connections(id,workspace_id,channel,status) select ws,ws,'instagram','connected' from mobile_actors;
insert into public.social_comments(id,workspace_id,channel_connection_id,channel,provider_comment_id,provider_media_id,author_handle,comment_text,comment_created_at)
 select ws,ws,ws,'instagram','fixture','fixture','fixture','fixture',now() from mobile_actors;
insert into public.comment_reply_drafts(id,workspace_id,comment_id,draft_text) select ws,ws,ws,'fixture' from mobile_actors;
insert into public.instagram_dm_threads(id,workspace_id,channel_connection_id,provider_thread_id,customer_id,customer_handle,last_message_at,expires_at,last_message_text)
 select ws,ws,ws,'fixture','fixture','fixture',now(),now()+interval '1 day','fixture' from mobile_actors;
insert into public.instagram_dm_drafts(id,workspace_id,thread_id,draft_text) select ws,ws,ws,'fixture' from mobile_actors;
insert into public.marketing_missions(id,workspace_id,trace_id,goal) select ws,ws,'fixture','fixture' from mobile_actors;
insert into public.workspace_runtime_control_states(workspace_id) select ws from mobile_actors;
insert into public.agent_energy_ledgers(workspace_id) select ws from mobile_actors;
insert into public.customer_conversations(id,workspace_id,channel,external_subject_reference_hash,display_label,summary,created_by_user_id)
 select ws,ws,'instagram',repeat('a',64),'fixture','fixture',actor from mobile_actors;
insert into public.reservations(id,workspace_id,slot_id,customer_id,total_amount_krw) select ws::text,ws,'fixture','fixture',0 from mobile_actors;
insert into public.content_items(id,workspace_id,channel,title,created_by) select ws,ws,'instagram','fixture',actor from mobile_actors;
insert into public.content_versions(id,workspace_id,content_id,version_number,caption,fingerprint,created_by)
 select ws,ws,ws,1,'fixture',repeat('a',64),actor from mobile_actors;
insert into public.approvals(id,workspace_id,content_id,version_id,fingerprint,status,disclosure_confirmed,rights_confirmed,reason,decided_by)
 select ws,ws,ws,ws,repeat('a',64),'rejected',false,false,'fixture',actor from mobile_actors;
insert into public.schedules(id,workspace_id,approval_id,content_id,version_id,channel_connection_id,publish_at,timezone,status,created_by)
 select ws,ws,ws,ws,ws,ws,now()+interval '1 day','Asia/Seoul','cancelled',actor from mobile_actors;
insert into public.external_action_requests(id,workspace_id,channel,action_kind,target_external_id,target_label,exact_payload,idempotency_key,created_by)
 select ws,ws,'naver_place','profile_edit','fixture','fixture','{}','fixture',actor from mobile_actors;
insert into public.external_action_receipts(id,workspace_id,action_request_id,receipt_kind,recorded_by)
 select ws,ws,ws,'submission',actor from mobile_actors;

create function pg_temp.mobile_assert(ok boolean, label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'ANI-1790 ASSERTION FAILED: %',label; end if; end $$;
create function pg_temp.mobile_count(statement text) returns bigint language plpgsql as $$
declare n bigint; begin execute statement into n; return n;
exception when insufficient_privilege then raise notice 'ANI-1790 denied: %',sqlerrm; return 0; end $$;

-- 정상 경로도 실재 행 1건을 요구한다. 권한 부족을 '안전한 0행'으로 오인해 통과시키지 않는다.
do $$ declare person record; t text; subject uuid;
 tables text[] := array['business_profiles','channel_connections','social_comments','comment_reply_drafts',
 'instagram_dm_threads','instagram_dm_drafts','marketing_missions','workspace_runtime_control_states',
 'agent_energy_ledgers','reservations','customer_conversations','content_items','schedules','external_action_receipts'];
 checked integer := 0;
begin
 for person in select * from mobile_actors loop
  perform set_config('request.jwt.claim.sub',person.actor::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',person.actor,'role','authenticated')::text,true);
  set local role authenticated;
  foreach t in array tables loop
   perform pg_temp.mobile_assert(pg_temp.mobile_count(format('select count(*) from public.%I where workspace_id=%L',t,person.ws))=1,t||' positive own row');
   perform pg_temp.mobile_assert(pg_temp.mobile_count(format('select count(*) from public.%I where workspace_id<>%L',t,person.ws))=0,t||' foreign row');
   checked := checked + 2;
  end loop;
  perform pg_temp.mobile_assert(pg_temp.mobile_count('select count(*) from public.workspace_registry')=0,'registry is service-only');
  reset role;
 end loop;
 foreach subject in array array['c7900000-0000-4000-8000-000000000002'::uuid,'d7900000-0000-4000-8000-000000000002'::uuid] loop
  perform set_config('request.jwt.claim.sub',subject::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',subject,'role','authenticated')::text,true);
  set local role authenticated;
  foreach t in array tables loop
   perform pg_temp.mobile_assert(pg_temp.mobile_count(format('select count(*) from public.%I',t))=0,t||' disabled/nonmember');
   checked := checked + 1;
  end loop;
  reset role;
 end loop;
 perform set_config('request.jwt.claim.sub','',true);
 perform set_config('request.jwt.claims','{"role":"anon"}',true);
 set local role anon;
 foreach t in array tables loop
  perform pg_temp.mobile_assert(pg_temp.mobile_count(format('select count(*) from public.%I',t))=0,t||' anonymous');
  checked := checked + 1;
 end loop;
 reset role;
 set local role service_role;
 perform pg_temp.mobile_assert(pg_temp.mobile_count('select count(*) from public.workspace_registry where workspace_id in (''a7900000-0000-4000-8000-000000000001'',''b7900000-0000-4000-8000-000000000001'') and dataset_mode=''ACTUAL''')=2,'registry service positive control');
 reset role;
 raise notice 'ANI-1790 mobile read RLS: % assertions over % tables',checked,array_length(tables,1);
end $$;
select 'ANI-1790 mobile home/approval/report/inbox/customer/ledger source RLS verified in isolated PostgreSQL';
rollback;
