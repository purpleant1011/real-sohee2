begin;

create extension if not exists pgtap with schema extensions;

select plan(41);

insert into auth.users (id, email)
values
  ('10000000-0000-4000-8000-000000000001', 'owner@sohee.test.invalid'),
  ('10000000-0000-4000-8000-000000000002', 'outsider@sohee.test.invalid'),
  ('10000000-0000-4000-8000-000000000003', 'reviewer@sohee.test.invalid');

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);

insert into public.workspaces (id, name, created_by)
values (
  '20000000-0000-4000-8000-000000000001',
  'RPC 검증 작업공간',
  '10000000-0000-4000-8000-000000000001'
);

insert into public.content_items (id, workspace_id, channel, title, created_by)
values (
  '30000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  'instagram',
  '테스트 콘텐츠',
  '10000000-0000-4000-8000-000000000001'
);

insert into public.workspace_members (workspace_id, user_id, role, status)
values (
  '20000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000003',
  'reviewer',
  'active'
);

set local role service_role;
select public.save_meta_channel_connection(
  '20000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  'instagram',
  'fixture-instagram-account',
  '검증 계정',
  'fixture-ciphertext-00000000',
  'fixture-iv-000000',
  array['basic']::text[],
  '2026-12-31T00:00:00Z',
  '2026-12-30T00:00:00Z'
);

reset role;

insert into public.media_assets (
  id, workspace_id, bucket_id, object_path, kind, mime_type, size_bytes,
  rights_status, created_by
)
values (
  '50000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  'content-media',
  '20000000-0000-4000-8000-000000000001/10000000-0000-4000-8000-000000000001/50000000-0000-4000-8000-000000000001/photo.webp',
  'content',
  'image/webp',
  100,
  'confirmed',
  '10000000-0000-4000-8000-000000000001'
);

insert into public.media_assets (
  id, workspace_id, bucket_id, object_path, kind, mime_type, size_bytes,
  rights_status, created_by
)
values (
  '50000000-0000-4000-8000-000000000002',
  '20000000-0000-4000-8000-000000000001',
  'knowledge-files',
  '20000000-0000-4000-8000-000000000001/10000000-0000-4000-8000-000000000001/50000000-0000-4000-8000-000000000002/guide.pdf',
  'knowledge',
  'application/pdf',
  100,
  'confirmed',
  '10000000-0000-4000-8000-000000000001'
);

insert into public.knowledge_items (
  id, workspace_id, media_asset_id, name, status, evidence, created_by
)
values (
  '60000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  '50000000-0000-4000-8000-000000000002',
  '승인된 지식 자료',
  'approved',
  '{"fileValidated":true,"reviewed":true}'::jsonb,
  '10000000-0000-4000-8000-000000000001'
);

insert into storage.objects (bucket_id, name, owner)
values
  (
    'content-media',
    '20000000-0000-4000-8000-000000000001/10000000-0000-4000-8000-000000000001/50000000-0000-4000-8000-000000000001/photo.webp',
    '10000000-0000-4000-8000-000000000001'
  ),
  (
    'knowledge-files',
    '20000000-0000-4000-8000-000000000001/10000000-0000-4000-8000-000000000001/50000000-0000-4000-8000-000000000002/guide.pdf',
    '10000000-0000-4000-8000-000000000001'
  );

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);

select throws_ok(
  $$insert into public.knowledge_items (
      id, workspace_id, name, status, evidence, created_by
    ) values (
      '60000000-0000-4000-8000-000000000099',
      '20000000-0000-4000-8000-000000000001',
      '위조 승인 자료', 'approved', '{}',
      '10000000-0000-4000-8000-000000000001'
    )$$,
  '42501',
  'permission denied for table knowledge_items',
  'authenticated users cannot forge approved knowledge without a validated file'
);

create temporary table rpc_results (
  label text primary key,
  result_id uuid not null
);

select throws_ok(
  $$select public.create_content_version(
    '20000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001',
    '권리 누락 문구', array['#검증'], '광고',
    jsonb_build_object(
      'generationEvidenceConfirmed', true,
      'mediaIds', jsonb_build_array('50000000-0000-4000-8000-000000000001')
    )
  )$$,
  'P0001',
  '권리와 생성 근거를 확인해 주세요.',
  'missing rights confirmation fails closed'
);

select throws_ok(
  $$select public.create_content_version(
    '20000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001',
    '미디어 목록 누락 문구', array['#검증'], '광고',
    jsonb_build_object(
      'rightsConfirmed', true,
      'generationEvidenceConfirmed', true
    )
  )$$,
  'P0001',
  '미디어 선택을 확인해 주세요.',
  'missing media identifiers fail closed'
);

select throws_ok(
  $$select public.create_content_version(
    '20000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001',
    '미디어 없는 문구', array['#검증'], '광고',
    jsonb_build_object(
      'rightsConfirmed', true,
      'generationEvidenceConfirmed', true,
      'mediaIds', jsonb_build_array('50000000-0000-4000-8000-000000000099')
    )
  )$$,
  'P0001',
  '사용할 수 있는 미디어를 확인해 주세요.',
  'an unregistered media asset cannot be attached to a version'
);

select throws_ok(
  $$select public.create_content_version(
    '20000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001',
    '중복 미디어 문구', array['#검증'], '광고',
    jsonb_build_object(
      'rightsConfirmed', true,
      'generationEvidenceConfirmed', true,
      'mediaIds', jsonb_build_array(
        '50000000-0000-4000-8000-000000000001',
        '50000000-0000-4000-8000-000000000001'
      )
    )
  )$$,
  'P0001',
  '미디어 선택에 중복되거나 잘못된 값이 있습니다.',
  'duplicate media cannot be attached to an immutable version'
);

insert into rpc_results (label, result_id)
select 'version-1', public.create_content_version(
  '20000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001',
  '첫 문구',
  array['#첫번째'],
  '광고',
  jsonb_build_object(
    'rightsConfirmed', true,
    'generationEvidenceConfirmed', true,
    'mediaIds', jsonb_build_array('50000000-0000-4000-8000-000000000001'),
    'knowledgeIds', jsonb_build_array('60000000-0000-4000-8000-000000000001'),
    'revisionReason', '첫 문구를 명확하게 만들었어요.'
  )
);

insert into rpc_results (label, result_id)
select 'version-2', public.create_content_version(
  '20000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001',
  '최신 문구',
  array['#두번째'],
  '광고',
  jsonb_build_object(
    'rightsConfirmed', true,
    'generationEvidenceConfirmed', true,
    'mediaIds', jsonb_build_array('50000000-0000-4000-8000-000000000001'),
    'knowledgeIds', jsonb_build_array('60000000-0000-4000-8000-000000000001'),
    'revisionReason', '두 번째 문구로 다듬었어요.'
  )
);

select is(
  (select count(*)::integer from public.content_versions),
  2,
  'new versions are append-only'
);
select is(
  (
    select revision_reason
    from public.content_versions
    where id = (select result_id from rpc_results where label = 'version-2')
  ),
  '두 번째 문구로 다듬었어요.',
  'the immutable version preserves its revision reason'
);
select is(
  (
    select version_number
    from public.content_versions
    where id = (select result_id from rpc_results where label = 'version-2')
  ),
  2,
  'version numbers increment atomically'
);
select is(
  (
    select current_version_id
    from public.content_items
    where id = '30000000-0000-4000-8000-000000000001'
  ),
  (select result_id from rpc_results where label = 'version-2'),
  'content points to the newest version'
);
select is(
  (select count(*)::integer from public.content_version_media),
  2,
  'each immutable version owns its media links'
);
select is(
  (select count(*)::integer from public.content_version_media where position = 0),
  2,
  'media order is frozen on each version'
);
select is(
  (select count(*)::integer from public.content_version_knowledge),
  2,
  'each immutable version owns its approved knowledge links'
);

select throws_ok(
  $$select public.approve_content_version(
    '20000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001',
    (select result_id from rpc_results where label = 'version-1'),
    (select fingerprint from public.content_versions where id = (select result_id from rpc_results where label = 'version-1')),
    true,
    true,
    'reviewer'
  )$$,
  'P0001',
  '최신 버전만 승인할 수 있습니다.',
  'a superseded version cannot be approved'
);

select throws_ok(
  $$select public.approve_content_version(
    '20000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001',
    (select result_id from rpc_results where label = 'version-2'),
    repeat('0', 64),
    true,
    true,
    'reviewer'
  )$$,
  'P0001',
  '현재 버전 지문이 일치하지 않습니다.',
  'stale or forged fingerprints are rejected'
);

update public.media_assets
set rights_status = 'rejected'
where id = '50000000-0000-4000-8000-000000000001';
select throws_ok(
  $$select public.approve_content_version(
    '20000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001',
    (select result_id from rpc_results where label = 'version-2'),
    (select fingerprint from public.content_versions where id = (select result_id from rpc_results where label = 'version-2')),
    true,
    true,
    '권리 무효 상태'
  )$$,
  'P0001',
  '승인에 필요한 미디어와 지식 근거를 확인해 주세요.',
  'rejected media rights prevent approval'
);
update public.media_assets
set rights_status = 'confirmed'
where id = '50000000-0000-4000-8000-000000000001';

reset role;
update public.knowledge_items
set status = 'rejected'
where id = '60000000-0000-4000-8000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
select throws_ok(
  $$select public.approve_content_version(
    '20000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001',
    (select result_id from rpc_results where label = 'version-2'),
    (select fingerprint from public.content_versions where id = (select result_id from rpc_results where label = 'version-2')),
    true,
    true,
    '지식 무효 상태'
  )$$,
  'P0001',
  '승인에 필요한 미디어와 지식 근거를 확인해 주세요.',
  'rejected knowledge prevents approval'
);
reset role;
update public.knowledge_items
set status = 'approved'
where id = '60000000-0000-4000-8000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);

reset role;
update public.media_assets
set object_path = '20000000-0000-4000-8000-000000000001/10000000-0000-4000-8000-000000000001/50000000-0000-4000-8000-000000000002/missing.pdf'
where id = '50000000-0000-4000-8000-000000000002';
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
select throws_ok(
  $$select public.approve_content_version(
    '20000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001',
    (select result_id from rpc_results where label = 'version-2'),
    (select fingerprint from public.content_versions where id = (select result_id from rpc_results where label = 'version-2')),
    true,
    true,
    '지식 파일 누락 상태'
  )$$,
  'P0001',
  '승인에 필요한 미디어와 지식 근거를 확인해 주세요.',
  'a missing knowledge storage object prevents approval'
);
reset role;
update public.media_assets
set object_path = '20000000-0000-4000-8000-000000000001/10000000-0000-4000-8000-000000000001/50000000-0000-4000-8000-000000000002/guide.pdf'
where id = '50000000-0000-4000-8000-000000000002';
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);

insert into rpc_results (label, result_id)
select 'approval', public.approve_content_version(
  '20000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001',
  (select result_id from rpc_results where label = 'version-2'),
  (select fingerprint from public.content_versions where id = (select result_id from rpc_results where label = 'version-2')),
  true,
  true,
  '검수 완료'
);

select is(
  (select status from public.content_items where id = '30000000-0000-4000-8000-000000000001'),
  'approved',
  'approving the latest version updates the content state'
);
select is(
  (select status from public.approvals where id = (select result_id from rpc_results where label = 'approval')),
  'approved',
  'the approval record is immutable evidence'
);

select throws_ok(
  $$select public.schedule_approved_content(
    '20000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000099',
    now() + interval '2 hours',
    'Asia/Seoul',
    (select id from public.channel_connections where workspace_id = '20000000-0000-4000-8000-000000000001' and channel = 'instagram')
  )$$,
  'P0001',
  '승인된 버전만 예약할 수 있습니다.',
  'a missing approval cannot be scheduled'
);
select throws_ok(
  $$select public.schedule_approved_content(
    '20000000-0000-4000-8000-000000000001',
    (select result_id from rpc_results where label = 'approval'),
    now() + interval '59 minutes',
    'Asia/Seoul',
    (select id from public.channel_connections where workspace_id = '20000000-0000-4000-8000-000000000001' and channel = 'instagram')
  )$$,
  'P0001',
  '예약 시각은 현재보다 60분 이상 뒤여야 합니다.',
  'the minimum scheduling lead time is enforced'
);

update public.media_assets
set rights_status = 'rejected'
where id = '50000000-0000-4000-8000-000000000001';
select throws_ok(
  $$select public.schedule_approved_content(
    '20000000-0000-4000-8000-000000000001',
    (select result_id from rpc_results where label = 'approval'),
    now() + interval '2 hours',
    'Asia/Seoul',
    (select id from public.channel_connections where workspace_id = '20000000-0000-4000-8000-000000000001' and channel = 'instagram')
  )$$,
  'P0001',
  '승인 근거가 변경되어 다시 승인해야 합니다.',
  'changed rights invalidate an approval before scheduling'
);
update public.media_assets
set rights_status = 'confirmed'
where id = '50000000-0000-4000-8000-000000000001';

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000003', true);
select throws_ok(
  $$select public.schedule_approved_content(
    '20000000-0000-4000-8000-000000000001',
    (select result_id from rpc_results where label = 'approval'),
    now() + interval '2 hours',
    'Asia/Seoul',
    (select id from public.channel_connections where workspace_id = '20000000-0000-4000-8000-000000000001' and channel = 'instagram')
  )$$,
  'P0001',
  'schedule_permission_denied',
  'a reviewer cannot schedule or recover publishing'
);
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);

insert into rpc_results (label, result_id)
select 'schedule', public.schedule_approved_content(
  '20000000-0000-4000-8000-000000000001',
  (select result_id from rpc_results where label = 'approval'),
  now() + interval '2 hours',
  'Asia/Seoul',
  (select id from public.channel_connections where workspace_id = '20000000-0000-4000-8000-000000000001' and channel = 'instagram')
);

insert into rpc_results (label, result_id)
select 'schedule-idempotent', public.schedule_approved_content(
  '20000000-0000-4000-8000-000000000001',
  (select result_id from rpc_results where label = 'approval'),
  now() + interval '3 hours',
  'Asia/Seoul',
  (select id from public.channel_connections where workspace_id = '20000000-0000-4000-8000-000000000001' and channel = 'instagram')
);

select is(
  (select status from public.schedules where id = (select result_id from rpc_results where label = 'schedule')),
  'scheduled',
  'the exact approved version is scheduled'
);
select is(
  (select result_id from rpc_results where label = 'schedule-idempotent'),
  (select result_id from rpc_results where label = 'schedule'),
  'the same approval returns the existing active schedule'
);

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000003', true);
select throws_ok(
  $$select public.schedule_approved_content(
    '20000000-0000-4000-8000-000000000001',
    (select result_id from rpc_results where label = 'approval'),
    now() + interval '3 hours',
    'Asia/Seoul',
    (select id from public.channel_connections where workspace_id = '20000000-0000-4000-8000-000000000001' and channel = 'instagram')
  )$$,
  'P0001',
  'schedule_permission_denied',
  'a reviewer cannot discover an existing active schedule through idempotency'
);
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);

reset role;
insert into rpc_results (label, result_id)
select 'attempt-reserved', (public.reserve_publish_attempt(
  '20000000-0000-4000-8000-000000000001',
  (select result_id from rpc_results where label = 'schedule'),
  repeat('a', 64)
)->>'attemptId')::uuid;

insert into rpc_results (label, result_id)
select 'attempt-reserved-idempotent', (public.reserve_publish_attempt(
  '20000000-0000-4000-8000-000000000001',
  (select result_id from rpc_results where label = 'schedule'),
  repeat('a', 64)
)->>'attemptId')::uuid;

select is(
  (select result_id from rpc_results where label = 'attempt-reserved'),
  (select result_id from rpc_results where label = 'attempt-reserved-idempotent'),
  'the provider boundary is reserved once before the external mock call'
);
select is(
  (select status from public.schedules where id = (select result_id from rpc_results where label = 'schedule')),
  'publishing',
  'a reserved mock publish is visibly in progress'
);

insert into rpc_results (label, result_id)
select 'attempt-1', public.record_publish_attempt(
  '20000000-0000-4000-8000-000000000001',
  (select result_id from rpc_results where label = 'schedule'),
  repeat('a', 64),
  'failed',
  null,
  'TEMPORARY_NETWORK'
);

insert into rpc_results (label, result_id)
select 'attempt-idempotent', public.record_publish_attempt(
  '20000000-0000-4000-8000-000000000001',
  (select result_id from rpc_results where label = 'schedule'),
  repeat('a', 64),
  'failed',
  null,
  'TEMPORARY_NETWORK'
);

select is(
  (select result_id from rpc_results where label = 'attempt-1'),
  (select result_id from rpc_results where label = 'attempt-idempotent'),
  'an idempotency key returns the original publish attempt'
);
select is(
  (select count(*)::integer from public.publish_attempts where idempotency_key = repeat('a', 64)),
  1,
  'idempotent recording creates exactly one row'
);
select throws_ok(
  $$select public.record_publish_attempt(
    '20000000-0000-4000-8000-000000000001',
    (select result_id from rpc_results where label = 'schedule'),
    repeat('a', 64),
    'succeeded',
    'different-provider-reference',
    null
  )$$,
  'P0001',
  '발행 식별자가 다른 요청에 이미 사용되었습니다.',
  'an idempotency key cannot hide a different publish outcome'
);

insert into rpc_results (label, result_id)
select 'attempt-2', (public.reserve_publish_retry(
  '20000000-0000-4000-8000-000000000001',
  (select result_id from rpc_results where label = 'attempt-1'),
  repeat('b', 64)
)->>'attemptId')::uuid;

select is(
  (select attempt_number from public.publish_attempts where id = (select result_id from rpc_results where label = 'attempt-2')),
  2,
  'a failed attempt creates the next controlled retry'
);
select is(
  (select status from public.publish_attempts where id = (select result_id from rpc_results where label = 'attempt-2')),
  'pending',
  'a retry starts pending without making an external call'
);
select throws_ok(
  $$select public.record_publish_attempt(
    '20000000-0000-4000-8000-000000000001',
    (select result_id from rpc_results where label = 'schedule'),
    'publish:three',
    'failed',
    null,
    'LATE_RESULT'
  )$$,
  'P0001',
  '대기 중인 재시도 결과를 먼저 기록해 주세요.',
  'a different key cannot overtake a pending retry'
);

insert into rpc_results (label, result_id)
select 'attempt-2-result', public.record_publish_attempt(
  '20000000-0000-4000-8000-000000000001',
  (select result_id from rpc_results where label = 'schedule'),
  repeat('b', 64),
  'succeeded',
  'provider-post-2',
  null
);

select is(
  (select result_id from rpc_results where label = 'attempt-2-result'),
  (select result_id from rpc_results where label = 'attempt-2'),
  'a retry result completes the existing pending attempt'
);
select is(
  (select status from public.publish_attempts where id = (select result_id from rpc_results where label = 'attempt-2')),
  'succeeded',
  'a pending retry transitions to the recorded terminal result'
);
select is(
  public.record_publish_attempt(
    '20000000-0000-4000-8000-000000000001',
    (select result_id from rpc_results where label = 'schedule'),
    repeat('b', 64),
    'succeeded',
    'provider-post-2',
    null
  ),
  (select result_id from rpc_results where label = 'attempt-2'),
  'an exact retry result replay returns the same attempt'
);
select throws_ok(
  $$select public.retry_publish_attempt(
    '20000000-0000-4000-8000-000000000001',
    (select result_id from rpc_results where label = 'attempt-2'),
    'publish:three'
  )$$,
  'P0001',
  '실패한 발행 시도만 재시도할 수 있습니다.',
  'non-failed attempts cannot be retried'
);

select is(
  (select count(*)::integer from public.audit_events),
  7,
  'successful state transitions write metadata-only audit events'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);
select is(
  (select count(*)::integer from public.content_items),
  0,
  'an outsider cannot read another workspace content'
);
select throws_ok(
  $$select public.create_content_version(
    '20000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001',
    '침입 문구', array['#침입'], '', '{}'::jsonb
  )$$,
  'P0001',
  '콘텐츠 버전을 만들 권한이 없습니다.',
  'an outsider cannot invoke a workspace mutation RPC'
);

select * from finish();
rollback;
