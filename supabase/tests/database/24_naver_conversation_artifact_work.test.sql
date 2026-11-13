begin;
create extension if not exists pgtap with schema extensions;
select plan(37);

select has_column('public', 'conversation_artifacts', 'structured_payload', 'conversation artifacts retain structured channel copy');

insert into auth.users (id, email)
values ('12000000-0000-4000-8000-000000000024', 'naver-artifact-owner@sohee.test.invalid');

set local role authenticated;
select set_config('request.jwt.claim.sub', '12000000-0000-4000-8000-000000000024', true);

insert into public.workspaces (id, name, created_by)
values ('22000000-0000-4000-8000-000000000024', '네이버 대화 검증', '12000000-0000-4000-8000-000000000024');

insert into public.conversation_threads (id, workspace_id, kind, title)
values ('32000000-0000-4000-8000-000000000024', '22000000-0000-4000-8000-000000000024', 'operations', '네이버 게시물');

insert into public.messages (id, workspace_id, thread_id, role, content, status, created_by_user_id)
values ('42000000-0000-4000-8000-000000000024', '22000000-0000-4000-8000-000000000024', '32000000-0000-4000-8000-000000000024', 'user', '네이버 블로그 글을 만들어줘.', 'completed', '12000000-0000-4000-8000-000000000024');

reset role;

insert into public.media_assets (
  id, workspace_id, bucket_id, object_path, kind, mime_type, size_bytes, rights_status, created_by, sha256_digest
) values (
  '52000000-0000-4000-8000-000000000024', '22000000-0000-4000-8000-000000000024', 'content-media',
  '22000000-0000-4000-8000-000000000024/12000000-0000-4000-8000-000000000024/52000000-0000-4000-8000-000000000024/cover.png',
  'content', 'image/png', 68, 'confirmed', '12000000-0000-4000-8000-000000000024', repeat('a', 64)
);

insert into storage.objects (bucket_id, name, owner, metadata)
values (
  'content-media',
  '22000000-0000-4000-8000-000000000024/12000000-0000-4000-8000-000000000024/52000000-0000-4000-8000-000000000024/cover.png',
  '12000000-0000-4000-8000-000000000024',
  '{"mimetype":"image/png","size":68}'::jsonb
);

select lives_ok($$
  insert into public.conversation_artifacts (
    id, workspace_id, type, status, source_message_id, title, structured_payload,
    caption, hashtags, cta, disclosure, observations, limitations, evidence,
    unresolved_questions, idempotency_key, created_by_user_id
  ) values (
    '62000000-0000-4000-8000-000000000024', '22000000-0000-4000-8000-000000000024',
    'naver_blog_post', 'ready_for_review', '42000000-0000-4000-8000-000000000024',
    '반영구 눈썹 상담 전 확인할 점',
    '{"channel":"naver_blog","title":"반영구 눈썹 상담 전 확인할 점","introduction":"원하는 느낌을 정리해 보세요.","sections":[{"heading":"상담 전 체크","body":"평소 메이크업과 원하는 두께를 알려주세요."}],"editorBlueprint":[{"kind":"paragraph","text":"원하는 느낌을 정리해 보세요."},{"kind":"image_slot","position":1,"altText":"눈썹 상담 표지"}],"keywords":["반영구눈썹","눈썹상담"],"cta":"상담으로 방향을 확인해 보세요.","visibility":"public"}'::jsonb,
    '원하는 느낌을 정리해 보세요.', array['#반영구눈썹',' #눈썹상담'],
    '상담으로 방향을 확인해 보세요.', 'AI 보조 초안', '{}', '{}', '[]'::jsonb, '{}',
    '72000000-0000-4000-8000-000000000024', '12000000-0000-4000-8000-000000000024'
  )
$$, 'a structured Naver Blog artifact can be stored');

select lives_ok($$
  insert into public.conversation_artifacts (
    id, workspace_id, type, status, source_message_id, title, structured_payload,
    caption, hashtags, cta, disclosure, observations, limitations, evidence,
    unresolved_questions, idempotency_key, created_by_user_id
  ) values (
    '62000000-0000-4000-8000-000000000025', '22000000-0000-4000-8000-000000000024',
    'naver_blog_post', 'ready_for_review', '42000000-0000-4000-8000-000000000024',
    '네이버 장문 저장 검증', '{}'::jsonb, repeat('가', 3000), '{}', '', '', '{}', '{}', '[]'::jsonb, '{}',
    '72000000-0000-4000-8000-000000000025', '12000000-0000-4000-8000-000000000024'
  )
$$, 'a Naver Blog artifact may retain more than 2,200 caption characters');

select throws_ok($$
  insert into public.conversation_artifacts (
    id, workspace_id, type, status, source_message_id, structured_payload,
    caption, hashtags, cta, disclosure, observations, limitations, evidence,
    unresolved_questions, idempotency_key, created_by_user_id
  ) values (
    '62000000-0000-4000-8000-000000000026', '22000000-0000-4000-8000-000000000024',
    'instagram_post', 'ready_for_review', '42000000-0000-4000-8000-000000000024',
    '{}'::jsonb, repeat('가', 3000), '{}', '', '', '{}', '{}', '[]'::jsonb, '{}',
    '72000000-0000-4000-8000-000000000026', '12000000-0000-4000-8000-000000000024'
  )
$$, '23514', null, 'non-Naver artifacts keep the 2,200 character limit');

insert into public.generation_batches (
  id, workspace_id, artifact_id, requested_count, started_count, succeeded_count, failed_count,
  status, idempotency_key, started_at, completed_at
) values (
  '82000000-0000-4000-8000-000000000024', '22000000-0000-4000-8000-000000000024',
  '62000000-0000-4000-8000-000000000024', 1, 1, 1, 0, 'succeeded',
  '72000000-0000-4000-8000-000000000024', now(), now()
);

insert into public.artifact_slides (
  id, workspace_id, artifact_id, batch_id, position, role, status, media_asset_id,
  alt_text, retryable, rights_status
) values (
  '92000000-0000-4000-8000-000000000024', '22000000-0000-4000-8000-000000000024',
  '62000000-0000-4000-8000-000000000024', '82000000-0000-4000-8000-000000000024',
  1, 'cover', 'succeeded', '52000000-0000-4000-8000-000000000024', '눈썹 상담 표지', false, 'confirmed'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '12000000-0000-4000-8000-000000000024', true);

create temporary table naver_saved_result as
select public.save_conversation_artifact_to_work(
  '62000000-0000-4000-8000-000000000024',
  'a2000000-0000-4000-8000-000000000024'
) as result;

select is(
  (select channel from public.content_items where id = ((select result from naver_saved_result)->>'contentItemId')::uuid),
  'naver_blog',
  'saving the artifact creates a Naver Blog content item'
);

select is(
  (select structured_payload ->> 'visibility' from public.content_versions where id = ((select result from naver_saved_result)->>'versionId')::uuid),
  'public',
  'the saved Naver Blog version preserves the exact public visibility'
);

select is(
  (select structured_payload -> 'imagePlacements' -> 0 ->> 'mediaId' from public.content_versions where id = ((select result from naver_saved_result)->>'versionId')::uuid),
  '52000000-0000-4000-8000-000000000024',
  'the saved version preserves the generated cover image'
);

select ok(
  not (select structured_payload ? 'editorBlueprint' from public.content_versions where id = ((select result from naver_saved_result)->>'versionId')::uuid),
  'the saved version removes the generation-only editor blueprint'
);

reset role;

insert into public.media_assets (
  id, workspace_id, bucket_id, object_path, kind, mime_type, size_bytes, rights_status, created_by, sha256_digest
)
select
  ('52000000-0000-4000-8000-' || lpad(position::text, 12, '0'))::uuid,
  '22000000-0000-4000-8000-000000000024'::uuid, 'content-media',
  '22000000-0000-4000-8000-000000000024/12000000-0000-4000-8000-000000000024/' || position::text || '/asset.png',
  'content', 'image/png', 68, 'confirmed', '12000000-0000-4000-8000-000000000024'::uuid, repeat(position::text, 64)
from generate_series(2, 9) as position
union all
select
  ('52000000-0000-4000-8000-' || lpad(position::text, 12, '0'))::uuid,
  '22000000-0000-4000-8000-000000000024'::uuid, 'content-media',
  '22000000-0000-4000-8000-000000000024/12000000-0000-4000-8000-000000000024/' || position::text || '/asset.png',
  'content', 'image/png', 68, 'confirmed', '12000000-0000-4000-8000-000000000024'::uuid, repeat((position % 10)::text, 64)
from generate_series(10, 12) as position;

insert into storage.objects (bucket_id, name, owner, metadata)
select
  'content-media',
  '22000000-0000-4000-8000-000000000024/12000000-0000-4000-8000-000000000024/' || position::text || '/asset.png',
  '12000000-0000-4000-8000-000000000024',
  '{"mimetype":"image/png","size":68}'::jsonb
from generate_series(2, 12) as position;

insert into public.content_version_media (workspace_id, version_id, media_asset_id, position)
select
  '22000000-0000-4000-8000-000000000024',
  ((select result from naver_saved_result)->>'versionId')::uuid,
  ('52000000-0000-4000-8000-' || lpad(position::text, 12, '0'))::uuid,
  (position - 1)::smallint
from generate_series(2, 12) as position;

select ok(
  private.is_content_version_publishable(
    '22000000-0000-4000-8000-000000000024',
    ((select result from naver_saved_result)->>'versionId')::uuid
  ),
  'a Naver Blog version with twelve confirmed stored images is publishable'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '12000000-0000-4000-8000-000000000024', true);

select has_function(
  'public', 'approve_and_dispatch_local_content',
  array['uuid','uuid','uuid','text','text','timestamptz','text','uuid'],
  'local content approval and dispatch RPC exists'
);

reset role;

update public.content_versions
set structured_payload = jsonb_set(structured_payload, '{visibility}', '"public"'::jsonb)
where id = ((select result from naver_saved_result)->>'versionId')::uuid;

insert into public.connector_devices (
  id, workspace_id, display_name, platform, client_version, token_digest, status, created_by
) values (
  'b2000000-0000-4000-8000-000000000024', '22000000-0000-4000-8000-000000000024',
  '네이버 테스트 연결기', 'macos', '0.1.0', repeat('b', 64), 'active',
  '12000000-0000-4000-8000-000000000024'
);

insert into public.browser_channel_connections (
  id, workspace_id, device_id, channel, external_account_label, target_external_id,
  target_url, target_fingerprint, environment, status, verified_at
) values (
  'c2000000-0000-4000-8000-000000000024', '22000000-0000-4000-8000-000000000024',
  'b2000000-0000-4000-8000-000000000024', 'naver_blog', 'findk3', 'findk3',
  'https://blog.naver.com/findk3/postwrite?categoryNo=1', repeat('c', 64), 'test', 'connected', now()
);

-- Regression for ANI-1140: direct user-session execution, not a service-role proxy.
insert into auth.users (id, email) values
  ('12000000-0000-4000-8000-000000000025', 'naver-artifact-reviewer@sohee.test.invalid'),
  ('12000000-0000-4000-8000-000000000026', 'naver-other-owner@sohee.test.invalid');
insert into public.workspace_members (workspace_id, user_id, role, status) values
  ('22000000-0000-4000-8000-000000000024', '12000000-0000-4000-8000-000000000025', 'reviewer', 'active');
insert into public.workspaces (id, name, created_by) values
  ('22000000-0000-4000-8000-000000000026', '다른 작업공간', '12000000-0000-4000-8000-000000000026');

select ok(has_function_privilege('authenticated',
  'public.approve_and_dispatch_local_content(uuid,uuid,uuid,text,text,timestamptz,text,uuid)', 'EXECUTE'),
  'authenticated can call the exact local dispatch signature');
select ok(has_function_privilege('service_role',
  'public.approve_and_dispatch_local_content(uuid,uuid,uuid,text,text,timestamptz,text,uuid)', 'EXECUTE'),
  'service_role retains EXECUTE (but a JWT identity is still required)');
select ok(not has_function_privilege('anon',
  'public.approve_and_dispatch_local_content(uuid,uuid,uuid,text,text,timestamptz,text,uuid)', 'EXECUTE'),
  'anon has no local dispatch EXECUTE');
select ok(not exists (
  select 1 from pg_catalog.aclexplode((select coalesce(proacl, pg_catalog.acldefault('f', proowner))
    from pg_catalog.pg_proc where oid =
      'public.approve_and_dispatch_local_content(uuid,uuid,uuid,text,text,timestamptz,text,uuid)'::regprocedure))
  where grantee = 0 and privilege_type = 'EXECUTE'
), 'PUBLIC has no inherited local dispatch EXECUTE');

set local role anon;
select throws_ok($$
  select public.approve_and_dispatch_local_content(
    '22000000-0000-4000-8000-000000000024', null, null, null, 'approve_only'
  )
$$, '42501', null, 'anon cannot invoke the definer RPC');
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '12000000-0000-4000-8000-000000000025', true);
select throws_ok($$
  select public.approve_and_dispatch_local_content(
    '22000000-0000-4000-8000-000000000024',
    (select (result->>'contentItemId')::uuid from naver_saved_result),
    (select (result->>'versionId')::uuid from naver_saved_result),
    (select fingerprint from public.content_versions where id =
      (select (result->>'versionId')::uuid from naver_saved_result)),
    'approve_only'
  )
$$, 'P0001', 'LOCAL_PUBLISH_DISPATCH_FORBIDDEN',
  'reviewer cannot use approve_only to bypass the dispatch role gate');
select throws_ok($$
  select public.approve_and_dispatch_local_content(
    '22000000-0000-4000-8000-000000000024',
    (select (result->>'contentItemId')::uuid from naver_saved_result),
    (select (result->>'versionId')::uuid from naver_saved_result),
    (select fingerprint from public.content_versions where id =
      (select (result->>'versionId')::uuid from naver_saved_result)),
    'publish_now', null, 'Asia/Seoul', 'c2000000-0000-4000-8000-000000000024'
  )
$$, 'P0001', 'LOCAL_PUBLISH_DISPATCH_FORBIDDEN',
  'reviewer cannot publish_now');
select set_config('request.jwt.claim.sub', '12000000-0000-4000-8000-000000000026', true);
select throws_ok($$
  select public.approve_and_dispatch_local_content(
    '22000000-0000-4000-8000-000000000024',
    (select (result->>'contentItemId')::uuid from naver_saved_result),
    (select (result->>'versionId')::uuid from naver_saved_result),
    (select fingerprint from public.content_versions where id =
      (select (result->>'versionId')::uuid from naver_saved_result)),
    'approve_only'
  )
$$, 'P0001', 'LOCAL_PUBLISH_DISPATCH_FORBIDDEN',
  'owner of another workspace cannot approve_only here');
select throws_ok($$
  select public.approve_and_dispatch_local_content(
    '22000000-0000-4000-8000-000000000024',
    (select (result->>'contentItemId')::uuid from naver_saved_result),
    (select (result->>'versionId')::uuid from naver_saved_result),
    (select fingerprint from public.content_versions where id =
      (select (result->>'versionId')::uuid from naver_saved_result)),
    'publish_now', null, 'Asia/Seoul', 'c2000000-0000-4000-8000-000000000024'
  )
$$, 'P0001', 'LOCAL_PUBLISH_DISPATCH_FORBIDDEN',
  'owner of another workspace cannot dispatch this workspace content');
select set_config('request.jwt.claim.sub', '', true);
select throws_ok($$
  select public.approve_and_dispatch_local_content(
    '22000000-0000-4000-8000-000000000024', null, null, null, 'approve_only'
  )
$$, 'P0001', 'LOCAL_PUBLISH_DISPATCH_FORBIDDEN',
  'authenticated role without JWT subject is rejected before a write');
select set_config('request.jwt.claim.sub', '12000000-0000-4000-8000-000000000024', true);
select ok(not exists (
  select 1 from public.approvals where workspace_id = '22000000-0000-4000-8000-000000000024'
), 'rejected caller attempts left the version unapproved');

create temporary table naver_publish_now_result as
select public.approve_and_dispatch_local_content(
  '22000000-0000-4000-8000-000000000024',
  ((select result from naver_saved_result)->>'contentItemId')::uuid,
  ((select result from naver_saved_result)->>'versionId')::uuid,
  (select fingerprint from public.content_versions where id = ((select result from naver_saved_result)->>'versionId')::uuid),
  'publish_now', null, 'Asia/Seoul', 'c2000000-0000-4000-8000-000000000024'
) as result;
select is((select result->>'next' from naver_publish_now_result), 'publishing',
  'authenticated owner can publish_now using a connected Naver connection');
select is((select status from public.external_action_requests
  where id = (select (result->>'actionRequestId')::uuid from naver_publish_now_result)),
  'ready', 'publish_now creates a ready external action request');
select is((select created_by::text from public.external_action_requests
  where id = (select (result->>'actionRequestId')::uuid from naver_publish_now_result)),
  '12000000-0000-4000-8000-000000000024', 'ready request records the JWT caller');

create temporary table naver_dispatch_result as
select public.approve_and_dispatch_local_content(
  '22000000-0000-4000-8000-000000000024',
  ((select result from naver_saved_result)->>'contentItemId')::uuid,
  ((select result from naver_saved_result)->>'versionId')::uuid,
  (select fingerprint from public.content_versions where id = ((select result from naver_saved_result)->>'versionId')::uuid),
  'schedule', now() + interval '2 hours', 'Asia/Seoul',
  'c2000000-0000-4000-8000-000000000024'
) as result;

select is(
  (select status from public.approvals where id = ((select result from naver_dispatch_result)->>'approvalId')::uuid),
  'approved',
  'local dispatch records the exact approved version'
);

select is(
  (select channel from public.external_action_requests where id = ((select result from naver_dispatch_result)->>'actionRequestId')::uuid),
  'naver_blog',
  'local dispatch creates a Naver Blog connector job'
);

select is(
  (select exact_payload ->> 'visibility' from public.external_action_requests
   where id = ((select result from naver_dispatch_result)->>'actionRequestId')::uuid),
  'public',
  'local dispatch binds visibility to the exact approved Naver version'
);

select ok(
  (select scheduled_at is not null and auto_execute_until = scheduled_at + interval '30 minutes'
   from public.external_action_requests where id = ((select result from naver_dispatch_result)->>'actionRequestId')::uuid),
  'scheduled local dispatch keeps the thirty minute grace window'
);

reset role;

select has_function(
  'public', 'retry_local_publish_before_submit', array['uuid','uuid','uuid'],
  'a guarded exact-version pre-submit retry RPC exists'
);

insert into public.external_action_attempts (
  id, workspace_id, action_request_id, attempt_number, status, failure_code, finished_at, created_by
) values (
  'd2000000-0000-4000-8000-000000000024',
  '22000000-0000-4000-8000-000000000024',
  ((select result from naver_dispatch_result)->>'actionRequestId')::uuid,
  1, 'failed', 'UI_DRIFT', statement_timestamp(), '12000000-0000-4000-8000-000000000024'
);

insert into private.local_publish_leases (
  id, workspace_id, action_request_id, attempt_id, device_id, status, current_phase, expires_at
) values (
  'e2000000-0000-4000-8000-000000000024',
  '22000000-0000-4000-8000-000000000024',
  ((select result from naver_dispatch_result)->>'actionRequestId')::uuid,
  'd2000000-0000-4000-8000-000000000024',
  'b2000000-0000-4000-8000-000000000024',
  'released', 'failed_before_submit', statement_timestamp() + interval '2 minutes'
);

update public.external_action_requests
set status = 'failed', failure_code = 'UI_DRIFT'
where id = ((select result from naver_dispatch_result)->>'actionRequestId')::uuid;

select ok(
  public.retry_local_publish_before_submit(
    '22000000-0000-4000-8000-000000000024',
    '12000000-0000-4000-8000-000000000024',
    ((select result from naver_dispatch_result)->>'actionRequestId')::uuid
  ),
  'the same approved version can retry after a proven pre-submit UI failure'
);

select is(
  (select status from public.external_action_requests
   where id = ((select result from naver_dispatch_result)->>'actionRequestId')::uuid),
  'prepared',
  'a safe retry returns a future scheduled exact action to prepared'
);

update public.external_action_requests
set status = 'failed', failure_code = 'UI_DRIFT'
where id = ((select result from naver_dispatch_result)->>'actionRequestId')::uuid;
update private.local_publish_leases
set submit_permit_digest = repeat('f', 64), submit_permit_issued_at = statement_timestamp()
where id = 'e2000000-0000-4000-8000-000000000024';

select is(
  public.retry_local_publish_before_submit(
    '22000000-0000-4000-8000-000000000024',
    '12000000-0000-4000-8000-000000000024',
    ((select result from naver_dispatch_result)->>'actionRequestId')::uuid
  ),
  false,
  'an action that received any submit permit can never use pre-submit retry'
);

update private.local_publish_leases
set submit_permit_digest = null, submit_permit_issued_at = null
where id = 'e2000000-0000-4000-8000-000000000024';
update public.external_action_attempts
set failure_code = 'CONTENT_MISMATCH'
where id = 'd2000000-0000-4000-8000-000000000024';
update public.external_action_requests
set status = 'failed', failure_code = 'CONTENT_MISMATCH'
where id = ((select result from naver_dispatch_result)->>'actionRequestId')::uuid;

select ok(
  public.retry_local_publish_before_submit(
    '22000000-0000-4000-8000-000000000024',
    '12000000-0000-4000-8000-000000000024',
    ((select result from naver_dispatch_result)->>'actionRequestId')::uuid
  ),
  'an exact read-back mismatch before any permit may retry after the comparator is fixed'
);

update public.external_action_attempts
set failure_code = 'DEVICE_OFFLINE'
where id = 'd2000000-0000-4000-8000-000000000024';
update public.external_action_requests
set status = 'failed', failure_code = 'DEVICE_OFFLINE'
where id = ((select result from naver_dispatch_result)->>'actionRequestId')::uuid;

select ok(
  public.retry_local_publish_before_submit(
    '22000000-0000-4000-8000-000000000024',
    '12000000-0000-4000-8000-000000000024',
    ((select result from naver_dispatch_result)->>'actionRequestId')::uuid
  ),
  'a disconnected native bridge before any permit may retry after reconnecting'
);

select has_function(
  'public', 'reconcile_local_publish_observed_result', array['uuid','uuid','text','text'],
  'an observed local result has a guarded reconciliation RPC'
);

update public.external_action_requests
set status = 'unknown_result', failure_code = 'UNKNOWN_RESULT'
where id = ((select result from naver_dispatch_result)->>'actionRequestId')::uuid;
update public.external_action_attempts
set status = 'unknown_result', failure_code = 'UNKNOWN_RESULT'
where id = 'd2000000-0000-4000-8000-000000000024';
update private.local_publish_leases
set status = 'submitted', current_phase = 'unknown_after_submit',
    submit_permit_digest = repeat('a', 64), submit_permit_issued_at = statement_timestamp()
where id = 'e2000000-0000-4000-8000-000000000024';
insert into public.external_action_receipts (
  workspace_id, action_request_id, attempt_id, receipt_kind, recorded_by
) values (
  '22000000-0000-4000-8000-000000000024',
  ((select result from naver_dispatch_result)->>'actionRequestId')::uuid,
  'd2000000-0000-4000-8000-000000000024', 'submission',
  '12000000-0000-4000-8000-000000000024'
);

select ok(
  public.reconcile_local_publish_observed_result(
    '22000000-0000-4000-8000-000000000024',
    ((select result from naver_dispatch_result)->>'actionRequestId')::uuid,
    'https://blog.naver.com/PostView.naver?blogId=findk3&logNo=224384788447',
    '224384788447'
  ),
  'an authenticated observed Naver result reconciles the submitted unknown action'
);

select is(
  (select status from public.external_action_requests
   where id = ((select result from naver_dispatch_result)->>'actionRequestId')::uuid),
  'succeeded',
  'observed result reconciliation marks the exact action succeeded'
);

select * from finish();
rollback;
