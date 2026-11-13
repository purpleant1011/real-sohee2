-- ANI-1587: real role/RLS/FK execution, never production. All fixtures roll back.
begin;
create temporary table actors (ws uuid, actor uuid);
insert into actors values
 ('a3111111-1111-4111-8111-111111111111','a3222222-2222-4222-8222-222222222222'),
 ('b3111111-1111-4111-8111-111111111111','b3222222-2222-4222-8222-222222222222');
insert into auth.users(id) select actor from actors;
insert into auth.users(id) values ('c3222222-2222-4222-8222-222222222222'),('d3222222-2222-4222-8222-222222222222');
insert into public.workspaces(id,name,created_by) select ws,'격리 fixture',actor from actors;
insert into public.workspace_members(workspace_id,user_id,role,status)
 select ws,actor,'owner','active' from actors on conflict (workspace_id,user_id) do update set status='active';
insert into public.workspace_members(workspace_id,user_id,role,status)
 select ws,'c3222222-2222-4222-8222-222222222222','owner','disabled' from actors;

insert into public.media_assets(id,workspace_id,bucket_id,object_path,kind,mime_type,size_bytes,rights_status,created_by,sha256_digest)
 select ws,ws,'content-media','workspaces/'||ws||'/source.jpg','content','image/jpeg',10,'confirmed',actor,repeat('a',64) from actors;
insert into public.content_drafts(draft_id,workspace_id,topic,channel,content)
 select ws,ws,'격리 fixture','instagram','fixture' from actors;
insert into public.funnel_events(id,workspace_id,event) select ws,ws,'draft_ready' from actors;
insert into public.customer_conversations(id,workspace_id,channel,external_subject_reference_hash,display_label,summary,created_by_user_id)
 select ws,ws,'instagram',repeat('a',64),'fixture','fixture',actor from actors;
insert into public.knowledge_sources(id,workspace_id,source_type,display_name,created_by_user_id)
 select ws,ws,'manual','fixture',actor from actors;
insert into public.knowledge_candidates(id,workspace_id,knowledge_source_id,category,content,created_by_user_id)
 select ws,ws,ws,'fixture','fixture',actor from actors;
insert into public.knowledge_facts(id,workspace_id,category,content,source_candidate_id,approved_by_user_id,approved_at)
 select ws,ws,'fixture','fixture',ws,actor,now() from actors;
insert into public.reservations(id,workspace_id,slot_id,customer_id,total_amount_krw)
 select ws::text,ws,'fixture','fixture',0 from actors;
insert into public.channel_connections(id,workspace_id,channel,status) select ws,ws,'instagram','connected' from actors;
insert into public.instagram_dm_threads(id,workspace_id,channel_connection_id,provider_thread_id,customer_id,customer_handle,last_message_at,expires_at,last_message_text)
 select ws,ws,ws,'fixture','fixture','fixture',now(),now()+interval '1 day','fixture' from actors;
insert into public.instagram_dm_messages(id,workspace_id,thread_id,provider_message_id,sender_type,sender_id,text,sent_at)
 select ws,ws,ws,'fixture','customer','fixture','fixture',now() from actors;
insert into public.instagram_dm_drafts(id,workspace_id,thread_id,draft_text) select ws,ws,ws,'fixture' from actors;
insert into public.marketing_missions(id,workspace_id,trace_id,goal) select ws,ws,'fixture','fixture' from actors;
insert into public.booking_recovery_cases(id,workspace_id,mission_id,source_thread_id,source_inbound_message_id,customer_ref,stage)
 select ws,ws,ws,ws,ws,'fixture','DISCOVERED' from actors;
insert into public.booking_recovery_steps(id,workspace_id,case_id,kind,status,input_fingerprint,idempotency_key,actor_id)
 select ws,ws,ws,'fixture','CLAIMED','fixture','fixture',actor::text from actors;
insert into public.booking_recovery_outbox(id,workspace_id,case_id,source_event_key,kind) select ws,ws,ws,'fixture','SEND' from actors;
insert into public.booking_recovery_approvals(id,workspace_id,case_id,step_kind,payload_fingerprint,case_version,source_message_id,catalog_version,slot_version,approved_by,expires_at)
 select ws,ws,ws,'SEND','fixture',1,ws,'fixture',1,actor,now()+interval '1 day' from actors;
insert into public.workspace_products_services(id,workspace_id,name,price) select ws,ws,'fixture',0 from actors;
insert into public.booking_recovery_slots(id,workspace_id,service_id,starts_at,ends_at,catalog_version,confirmed_by,valid_until)
 select ws,ws,ws,now()+interval '1 day',now()+interval '2 days','fixture',actor,now()+interval '1 day' from actors;
insert into public.booking_recovery_proposals(id,workspace_id,case_id,source_inbound_message_id,source_thread_id,service_id,catalog_version,service_name,total_amount_krw,deposit_krw,slot_id,slot_version,starts_at,ends_at,availability_confirmed_at,valid_until,reply_text,payload_fingerprint)
 select ws,ws,ws,ws,ws,ws,'fixture','fixture',0,0,ws,1,now()+interval '1 day',now()+interval '2 days',now(),now()+interval '1 day','fixture','fixture' from actors;
insert into public.conversation_threads(id,workspace_id,kind,title) select ws,ws,'studio','fixture' from actors;
insert into public.messages(id,workspace_id,thread_id,role,content,status,created_by_user_id) select ws,ws,ws,'user','fixture','completed',actor from actors;
insert into public.sohee_studio_proposals(id,workspace_id,source_message_id,kind,category,content,created_by)
 select ws,ws,ws,'fact','fixture','fixture',actor from actors;

-- Helpers run as INVOKER. Only authorization errors count as denied; malformed SQL,
-- bad fixtures and unrelated application errors must fail the harness.
create function pg_temp.assert_true(ok boolean, label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'ASSERTION FAILED: %',label; end if; end $$;
create function pg_temp.visible_count(statement text) returns bigint language plpgsql as $$
declare n bigint; begin execute statement into n; return n;
exception when insufficient_privilege then return 0; end $$;
create function pg_temp.assert_no_write(statement text) returns void language plpgsql as $$
declare n bigint; begin
 execute statement; get diagnostics n = row_count;
 if n <> 0 then raise exception 'UNAUTHORIZED WRITE: %',statement; end if;
exception when insufficient_privilege then return; end $$;

-- Catalog coverage does not silently pass on a missing/renamed table.
do $$ declare t text; begin
 foreach t in array array['media_assets','content_drafts','knowledge_facts','customer_conversations','reservations','instagram_dm_messages','funnel_events','sohee_studio_proposals','booking_recovery_cases','booking_recovery_steps','booking_recovery_outbox','booking_recovery_approvals','booking_recovery_slots','booking_recovery_proposals'] loop
  perform pg_temp.assert_true((select relrowsecurity from pg_class where oid=('public.'||t)::regclass),t||' RLS');
  perform pg_temp.assert_true((select count(*)=2 from actors), 'fixture actors');
 end loop;
end $$;

-- Bidirectional A->B and B->A plus disabled/nonmember/anonymous.
do $$ declare person record; t text; own_count bigint; n bigint; subject uuid; role_name text; own_row jsonb; foreign_ws uuid;
 snapshots jsonb := '{}'::jsonb;
 tables text[] := array['media_assets','content_drafts','knowledge_facts','customer_conversations','reservations','instagram_dm_threads','instagram_dm_messages','instagram_dm_drafts','funnel_events','booking_recovery_cases','booking_recovery_steps','booking_recovery_outbox','booking_recovery_approvals','booking_recovery_slots','booking_recovery_proposals'];
begin
 for person in select * from actors loop
  select ws into foreign_ws from actors where ws<>person.ws;
  foreach t in array tables loop
   execute format('select to_jsonb(row) from public.%I row where workspace_id=%L',t,person.ws) into own_row;
   snapshots := snapshots || jsonb_build_object(t,own_row);
  end loop;
  perform set_config('request.jwt.claim.sub',person.actor::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',person.actor,'role','authenticated','aal','aal2','user_metadata',jsonb_build_object('workspace_id','b3111111-1111-4111-8111-111111111111','role','owner'))::text,true);
  set local role authenticated;
  foreach t in array tables loop
   own_count := pg_temp.visible_count(format('select count(*) from public.%I where workspace_id=%L',t,person.ws));
   -- reservations had no client grants in fresh replay: explicitly classify below.
   if has_table_privilege(current_user,('public.'||t)::regclass,'SELECT') then
    perform pg_temp.assert_true(own_count=1,t||' own positive read control');
   end if;
   n := pg_temp.visible_count(format('select count(*) from public.%I where workspace_id<>%L',t,person.ws));
   perform pg_temp.assert_true(n=0,t||' foreign read');
   perform pg_temp.assert_no_write(format('update public.%I set workspace_id=%L where workspace_id<>%L',t,person.ws,person.ws));
   perform pg_temp.assert_no_write(format('delete from public.%I where workspace_id<>%L',t,person.ws));
   perform pg_temp.assert_no_write(format('update public.%I set workspace_id=%L where workspace_id=%L',t,foreign_ws,person.ws));
   -- Values are captured before SET ROLE: an INSERT cannot pass vacuously because
   -- a SELECT of the foreign fixture was hidden by RLS. Only 42501 counts here.
   perform pg_temp.assert_no_write(format('insert into public.%I select (jsonb_populate_record(null::public.%I,%L::jsonb)).*',
     t,t,(snapshots->t)||jsonb_build_object('workspace_id',foreign_ws,'id',gen_random_uuid(),'draft_id',gen_random_uuid())));
  end loop;
  perform pg_temp.assert_true(pg_temp.visible_count('select count(*) from public.sohee_studio_proposals')=0,'studio server-only');
  reset role;
 end loop;
 foreach role_name in array array['authenticated','anon'] loop
  foreach subject in array array['c3222222-2222-4222-8222-222222222222'::uuid,'d3222222-2222-4222-8222-222222222222'::uuid,null] loop
   perform set_config('request.jwt.claim.sub',coalesce(subject::text,''),true);
   perform set_config('request.jwt.claims',jsonb_build_object('sub',subject,'role',role_name,'aal','aal2')::text,true);
   execute format('set local role %I',role_name);
   foreach t in array tables loop
    perform pg_temp.assert_true(pg_temp.visible_count(format('select count(*) from public.%I',t))=0,t||' inactive/nonmember/anon');
    perform pg_temp.assert_no_write(format('update public.%I set workspace_id=workspace_id',t));
   end loop;
   reset role;
  end loop;
 end loop;
end $$;

-- Every privileged RPC must deny real anon/authenticated execution, not merely hide rows.
do $$ declare p record; role_name text; args text; rejected boolean; count_checked int := 0; begin
 for p in select proc.oid,proc.proname,proc.proargtypes from pg_proc proc join pg_namespace n on n.oid=proc.pronamespace
 where n.nspname='public' and proc.proname in ('open_booking_recovery','transition_booking_recovery','claim_booking_recovery_step','claim_booking_recovery_outbox','finish_booking_recovery_step','confirm_booking_recovery','decide_studio_proposal','finalize_studio_turn') loop
  count_checked := count_checked + 1;
  select string_agg('null::'||format_type(typ,null),',') into args from unnest(p.proargtypes::oid[]) typ;
  perform pg_temp.assert_true(has_function_privilege('service_role',p.oid,'EXECUTE'),p.proname||' service execute');
  foreach role_name in array array['anon','authenticated'] loop
   perform pg_temp.assert_true(not has_function_privilege(role_name,p.oid,'EXECUTE'),p.proname||' no client execute');
   execute format('set local role %I',role_name);
   rejected := false;
   begin execute format('select public.%I(%s)',p.proname,args);
   exception when insufficient_privilege then rejected := true; end;
   reset role;
   perform pg_temp.assert_true(rejected,p.proname||' actual permission denied');
  end loop;
 end loop;
 perform pg_temp.assert_true(count_checked = 8, 'all eight server RPCs tested');
end $$;

-- Service-role requests still cannot splice foreign IDs into workspace-scoped relations.
do $$ declare rejected boolean := false; begin
 begin
  update public.sohee_studio_proposals set replaces_fact_id='b3111111-1111-4111-8111-111111111111' where workspace_id='a3111111-1111-4111-8111-111111111111';
 exception when foreign_key_violation then rejected := true; end;
 perform pg_temp.assert_true(rejected,'studio cross workspace fact FK');
 rejected := false;
 begin
  update public.booking_recovery_cases set source_inbound_message_id='b3111111-1111-4111-8111-111111111111' where workspace_id='a3111111-1111-4111-8111-111111111111';
 exception when foreign_key_violation then rejected := true; end;
 perform pg_temp.assert_true(rejected,'recovery cross workspace source FK');
end $$;
-- An active read-only member is not a collaborator/owner.
insert into auth.users(id) values ('e3222222-2222-4222-8222-222222222222');
insert into public.workspace_members(workspace_id,user_id,role,status) values
 ('a3111111-1111-4111-8111-111111111111','e3222222-2222-4222-8222-222222222222','viewer','active');
do $$ begin
 perform set_config('request.jwt.claim.sub','e3222222-2222-4222-8222-222222222222',true);
 perform set_config('request.jwt.claims','{"sub":"e3222222-2222-4222-8222-222222222222","role":"authenticated"}',true);
 set local role authenticated;
 perform pg_temp.assert_true(pg_temp.visible_count('select count(*) from public.content_drafts')=1,'viewer positive own read');
 perform pg_temp.assert_no_write('update public.content_drafts set content=''unauthorized fixture''');
 reset role;
end $$;
select 'A/B + viewer + disabled + nonmember + anon domain boundaries verified (isolated PG only)';
rollback;
