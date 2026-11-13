begin;

create extension if not exists pgtap with schema extensions;

select plan(33);

select has_table('public', 'channel_metric_collections', 'channel metric collections exist');
select has_table('public', 'channel_metric_values', 'channel metric values exist');
select has_column('public', 'provider_webhook_events', 'provider_post_reference', 'webhooks retain provider post identity');
select ok((select relrowsecurity from pg_class where oid = 'public.channel_metric_collections'::regclass), 'metric collection RLS is enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.channel_metric_values'::regclass), 'metric value RLS is enabled');
select ok(not has_table_privilege('authenticated', 'public.channel_metric_collections', 'INSERT'), 'authenticated users cannot forge metric collections');
select ok(not has_table_privilege('anon', 'public.channel_metric_collections', 'SELECT'), 'anonymous users cannot read metric collections');

insert into auth.users (id, email)
values
  ('14000000-0000-4000-8000-000000000001', 'report-owner@sohee.test.invalid'),
  ('14000000-0000-4000-8000-000000000002', 'report-viewer@sohee.test.invalid'),
  ('14000000-0000-4000-8000-000000000003', 'report-outsider@sohee.test.invalid');

insert into public.workspaces (id, name, created_by)
values ('24000000-0000-4000-8000-000000000001', '소셜 리포트 검증', '14000000-0000-4000-8000-000000000001');

insert into public.workspace_members (workspace_id, user_id, role, status)
values ('24000000-0000-4000-8000-000000000001', '14000000-0000-4000-8000-000000000002', 'viewer', 'active');

insert into public.channel_connections (
  id, workspace_id, channel, status, account_label, external_account_id
) values (
  '34000000-0000-4000-8000-000000000001',
  '24000000-0000-4000-8000-000000000001',
  'instagram', 'connected', '@report', 'ig-account-report'
);

insert into public.content_items (
  id, workspace_id, channel, title, status, created_by
) values (
  '44000000-0000-4000-8000-000000000001',
  '24000000-0000-4000-8000-000000000001',
  'instagram', '대화에서 만든 여름 게시물', 'approved',
  '14000000-0000-4000-8000-000000000001'
);

insert into public.content_versions (
  id, workspace_id, content_id, version_number, caption, fingerprint, created_by
) values (
  '54000000-0000-4000-8000-000000000001',
  '24000000-0000-4000-8000-000000000001',
  '44000000-0000-4000-8000-000000000001',
  3, '승인된 정확한 v3', repeat('a', 64),
  '14000000-0000-4000-8000-000000000001'
);

update public.content_items
set current_version_id = '54000000-0000-4000-8000-000000000001'
where id = '44000000-0000-4000-8000-000000000001';

insert into public.work_items (
  id, workspace_id, type, title, status, content_item_id, created_by
) values (
  '64000000-0000-4000-8000-000000000001',
  '24000000-0000-4000-8000-000000000001',
  'content', '대화에서 만든 여름 게시물', 'publishing',
  '44000000-0000-4000-8000-000000000001',
  '14000000-0000-4000-8000-000000000001'
);

insert into public.approvals (
  id, workspace_id, content_id, version_id, fingerprint, status,
  disclosure_confirmed, rights_confirmed, reason, decided_by, decided_at
) values (
  '74000000-0000-4000-8000-000000000001',
  '24000000-0000-4000-8000-000000000001',
  '44000000-0000-4000-8000-000000000001',
  '54000000-0000-4000-8000-000000000001', repeat('a', 64), 'approved',
  true, true, '게시 승인', '14000000-0000-4000-8000-000000000001',
  '2026-08-10T08:00:00Z'
);

insert into public.schedules (
  id, workspace_id, approval_id, content_id, version_id, channel_connection_id,
  publish_at, timezone, status, created_by
) values (
  '84000000-0000-4000-8000-000000000001',
  '24000000-0000-4000-8000-000000000001',
  '74000000-0000-4000-8000-000000000001',
  '44000000-0000-4000-8000-000000000001',
  '54000000-0000-4000-8000-000000000001',
  '34000000-0000-4000-8000-000000000001',
  '2026-08-11T01:00:00Z', 'Asia/Seoul', 'publishing',
  '14000000-0000-4000-8000-000000000001'
);

insert into public.publish_attempts (
  id, workspace_id, schedule_id, attempt_number, idempotency_key, status, started_at, created_by
) values (
  '94000000-0000-4000-8000-000000000001',
  '24000000-0000-4000-8000-000000000001',
  '84000000-0000-4000-8000-000000000001', 1, repeat('b', 64), 'pending',
  '2026-08-11T01:00:00Z', '14000000-0000-4000-8000-000000000001'
);

update public.publish_attempts
set status = 'succeeded', provider_reference = 'ig-post-123', finished_at = '2026-08-11T01:02:00Z'
where id = '94000000-0000-4000-8000-000000000001';

update public.schedules set status = 'published'
where id = '84000000-0000-4000-8000-000000000001';
update public.content_items set status = 'published'
where id = '44000000-0000-4000-8000-000000000001';

select is((select status from public.work_items where id = '64000000-0000-4000-8000-000000000001'), 'published', 'publish outcome synchronizes the linked work item');
select is((select count(*)::integer from public.operation_events where event_key = 'publish.succeeded:94000000-0000-4000-8000-000000000001'), 1, 'publish outcome creates one idempotent operation event');
select is((select count(*)::integer from public.notifications where event_key = 'publish.succeeded:94000000-0000-4000-8000-000000000001'), 1, 'publish outcome creates one notification');

set local role service_role;
select lives_ok($$
  select public.save_channel_metric_collection(
    '24000000-0000-4000-8000-000000000001', '94000000-0000-4000-8000-000000000001',
    'a4000000-0000-4000-8000-000000000001', '2026-08-11T01:02:00Z', '2026-08-12T01:02:00Z',
    '2026-08-12T01:03:00Z', 'succeeded', null, null,
    '[{"metric":"likes","state":"available","value":0},{"metric":"saved","state":"no_data","value":null},{"metric":"visits","state":"not_supported","value":null}]'::jsonb
  )
$$, 'service role stores provider values and explicit absence states');
select lives_ok($$
  select public.save_channel_metric_collection(
    '24000000-0000-4000-8000-000000000001', '94000000-0000-4000-8000-000000000001',
    'a4000000-0000-4000-8000-000000000001', '2026-08-11T01:02:00Z', '2026-08-12T01:02:00Z',
    '2026-08-12T01:03:00Z', 'succeeded', null, null,
    '[{"metric":"likes","state":"available","value":0},{"metric":"saved","state":"no_data","value":null},{"metric":"visits","state":"not_supported","value":null}]'::jsonb
  )
$$, 'an identical metric request is idempotent');
reset role;

select is((select count(*)::integer from public.channel_metric_collections where request_key = 'a4000000-0000-4000-8000-000000000001'), 1, 'an idempotent request creates one collection');
select is((select value::integer from public.channel_metric_values where metric = 'likes'), 0, 'an actual zero remains an actual zero');
select is((select state from public.channel_metric_values where metric = 'saved'), 'no_data', 'no data is distinct from zero');
select is((select state from public.channel_metric_values where metric = 'visits'), 'not_supported', 'unsupported metrics are not estimated');

set local role service_role;
select throws_ok($$
  select public.save_channel_metric_collection(
    '24000000-0000-4000-8000-000000000001', '94000000-0000-4000-8000-000000000001',
    'a4000000-0000-4000-8000-000000000001', '2026-08-11T01:02:00Z', '2026-08-12T01:02:00Z',
    '2026-08-12T01:03:00Z', 'succeeded', null, null,
    '[{"metric":"likes","state":"available","value":99}]'::jsonb
  )
$$, 'P0001', 'METRIC_REQUEST_KEY_REUSED', 'a reused request key cannot overwrite observed values');
select lives_ok($$
  select public.save_channel_metric_collection(
    '24000000-0000-4000-8000-000000000001', '94000000-0000-4000-8000-000000000001',
    'a4000000-0000-4000-8000-000000000002', '2026-08-11T01:02:00Z', '2026-08-11T02:02:00Z',
    '2026-08-11T02:03:00Z', 'permission_denied', null, null,
    '[{"metric":"likes","state":"permission_denied","value":null}]'::jsonb
  )
$$, 'permission expiry is stored without a fabricated number');
reset role;
select is((select state from public.channel_metric_values where collection_id = (select id from public.channel_metric_collections where request_key = 'a4000000-0000-4000-8000-000000000002')), 'permission_denied', 'permission denied remains distinguishable in storage');

insert into public.provider_webhook_events (
  id, workspace_id, channel_connection_id, provider, category, event_key,
  provider_event_id, external_subject_id, provider_post_reference,
  payload, payload_sha256, occurred_at, received_at
) values
  ('b4000000-0000-4000-8000-000000000001', '24000000-0000-4000-8000-000000000001', '34000000-0000-4000-8000-000000000001', 'instagram', 'comment', 'comment:newer', 'comment-newer', 'customer-1', 'ig-post-123', '{"value":{"text":"예약 가능한가요?"}}', repeat('c', 64), '2026-08-11T02:00:00Z', '2026-08-11T02:00:01Z'),
  ('b4000000-0000-4000-8000-000000000002', '24000000-0000-4000-8000-000000000001', '34000000-0000-4000-8000-000000000001', 'instagram', 'comment', 'comment:older-arrived-late', 'comment-older', 'customer-1', 'ig-post-123', '{"value":{"text":"먼저 남긴 댓글"}}', repeat('d', 64), '2026-08-11T01:30:00Z', '2026-08-11T03:00:00Z'),
  ('b4000000-0000-4000-8000-000000000003', '24000000-0000-4000-8000-000000000001', '34000000-0000-4000-8000-000000000001', 'instagram', 'dm', 'dm:unlinked', 'dm-1', 'customer-1', null, '{"message":{"text":"DM 문의"}}', repeat('e', 64), '2026-08-11T02:30:00Z', '2026-08-11T02:30:01Z');

select throws_ok($$
  insert into public.provider_webhook_events (
    workspace_id, channel_connection_id, provider, category, event_key,
    payload, payload_sha256, occurred_at
  ) values (
    '24000000-0000-4000-8000-000000000001', '34000000-0000-4000-8000-000000000001',
    'instagram', 'comment', 'comment:newer', '{}', repeat('f', 64), '2026-08-11T02:00:00Z'
  )
$$, '23505', 'duplicate key value violates unique constraint "provider_webhook_events_workspace_event_key"', 'duplicate webhook delivery is rejected');

set local role authenticated;
select set_config('request.jwt.claim.sub', '14000000-0000-4000-8000-000000000001', true);
select is((select version_number from public.list_social_post_reports('24000000-0000-4000-8000-000000000001', '2026-08-01', '2026-08-31', null)), 3, 'report returns the exact published content version');
select is((select provider_post_reference from public.list_social_post_reports('24000000-0000-4000-8000-000000000001', '2026-08-01', '2026-08-31', null)), 'ig-post-123', 'report returns the real provider post reference');
select is((select metrics -> 0 ->> 'metric' from public.list_social_post_reports('24000000-0000-4000-8000-000000000001', '2026-08-01', '2026-08-31', null)), 'likes', 'latest actual metric collection is selected');
select is((select (metrics -> 0 ->> 'value')::integer from public.list_social_post_reports('24000000-0000-4000-8000-000000000001', '2026-08-01', '2026-08-31', null)), 0, 'report preserves the actual zero');
select is((select count(*)::integer from public.list_social_report_reactions('24000000-0000-4000-8000-000000000001', '2026-08-01', '2026-08-31', '44000000-0000-4000-8000-000000000001')), 2, 'both normal and reverse-order comments link to the same post and work');
select is((select publish_attempt_id from public.list_social_report_reactions('24000000-0000-4000-8000-000000000001', '2026-08-01', '2026-08-31', '44000000-0000-4000-8000-000000000001') where event_id = 'b4000000-0000-4000-8000-000000000002'), '94000000-0000-4000-8000-000000000001'::uuid, 'a late-arriving older event links by provider identity rather than arrival order');
select is((select inbound_text from public.list_social_report_reactions('24000000-0000-4000-8000-000000000001', '2026-08-01', '2026-08-31', null) where event_id = 'b4000000-0000-4000-8000-000000000001'), '예약 가능한가요?', 'owners can inspect customer text inside the report');
select is((select count(*)::integer from public.list_social_report_reactions('24000000-0000-4000-8000-000000000001', '2026-08-01', '2026-08-31', null) where publish_attempt_id is null), 1, 'unlinked DM remains visible by channel and period without inferred work');
select is((select count(*)::integer from public.list_social_report_reactions('24000000-0000-4000-8000-000000000001', '2026-08-01', '2026-08-31', '44000000-0000-4000-8000-000000000001') where publish_attempt_id is null), 0, 'work-filtered report does not invent a link for an unlinked DM');

select set_config('request.jwt.claim.sub', '14000000-0000-4000-8000-000000000002', true);
select is((select inbound_text from public.list_social_report_reactions('24000000-0000-4000-8000-000000000001', '2026-08-01', '2026-08-31', null) where event_id = 'b4000000-0000-4000-8000-000000000001'), null, 'viewer role can see the reaction record but not raw customer text');

select set_config('request.jwt.claim.sub', '14000000-0000-4000-8000-000000000003', true);
select is((select count(*)::integer from public.channel_metric_collections), 0, 'a non-member cannot read another workspace metric rows');
select throws_ok($$
  select * from public.list_social_post_reports('24000000-0000-4000-8000-000000000001', '2026-08-01', '2026-08-31', null)
$$, 'P0001', 'SOCIAL_REPORT_FORBIDDEN', 'a non-member cannot invoke the workspace report');
reset role;

select is((select count(*)::integer from public.channel_response_jobs where status in ('sending', 'sent')), 0, 'collecting reactions never executes an external customer reply');

select * from finish();
rollback;
