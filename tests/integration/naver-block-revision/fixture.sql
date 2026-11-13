-- Isolated wrapper contract fixture, not a replay of production RLS/internal writer.
create schema private;
create role anon;
create role authenticated;
create role service_role;
create table public.content_items (id uuid primary key, workspace_id uuid, channel text, current_version_id uuid, status text);
create table public.content_versions (
  id uuid primary key, workspace_id uuid, content_id uuid, version_number integer,
  fingerprint text, caption text, hashtags text[], disclosure text, structured_payload jsonb,
  rights jsonb, generation_evidence jsonb, harness_rule_ids uuid[]
);
create table public.content_version_media (workspace_id uuid, version_id uuid, media_asset_id uuid, position integer);
create table public.content_version_knowledge (workspace_id uuid, version_id uuid, knowledge_item_id uuid);
create function private.has_workspace_role(uuid, text[]) returns boolean language sql as $$
  select current_setting('test.allowed', true) = 'yes';
$$;
-- Stand-in exposes arguments to the real wrapper. Production fingerprint/rights writer is reused, not tested here.
create function private.create_content_version_internal(uuid, uuid, text, text[], text, jsonb)
returns uuid language plpgsql set search_path = public as $$
declare next_id uuid := gen_random_uuid(); n integer;
begin
  select coalesce(max(version_number), 0) + 1 into n from content_versions where content_id = $2;
  insert into content_versions values (next_id, $1, $2, n, repeat(n::text,64), $3, $4, $5,
    $6 -> 'structuredPayload', $6 -> 'rightsConfirmed', $6 -> 'generationEvidenceConfirmed',
    array(select jsonb_array_elements_text($6 -> 'harnessRuleIds'))::uuid[]);
  insert into content_version_media select $1, next_id, value::uuid, ordinal::integer - 1
    from jsonb_array_elements_text($6 -> 'mediaIds') with ordinality as ids(value, ordinal);
  insert into content_version_knowledge select $1, next_id, value::uuid
    from jsonb_array_elements_text($6 -> 'knowledgeIds') as ids(value);
  update content_items set current_version_id = next_id, status = 'review' where id = $2;
  return next_id;
end;
$$;
select set_config('test.allowed','yes',false);
insert into content_items values ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','naver_blog','30000000-0000-4000-8000-000000000001','approved');
insert into content_versions values (
  '30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',1,repeat('1',64),'old caption',array['#태그'],'고지',
  '{"channel":"naver_blog","title":"제목","introduction":"기존 도입","sections":[{"heading":"구분","body":"기존 본문"}],"keywords":["태그"],"cta":"문의","factBasis":{"snapshotHash":"preserve"},"strategyBrief":{"revision":2},"editorBlocks":[{"kind":"paragraph","text":"첫 문단"},{"kind":"paragraph","text":"둘째 문단"},{"kind":"image","mediaId":"50000000-0000-4000-8000-000000000001","altText":"사진"}],"imagePlacements":[{"mediaId":"50000000-0000-4000-8000-000000000001","placement":"cover","altText":"사진"}]}',
  '{"confirmed":true}','{"confirmed":true}',array['60000000-0000-4000-8000-000000000001']::uuid[]
);
insert into content_version_media values ('10000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000001',0);
insert into content_version_knowledge values ('10000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','70000000-0000-4000-8000-000000000001');
