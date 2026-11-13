begin;

create extension if not exists pgtap with schema extensions;

select plan(8);

select has_function(
  'private', 'materialize_naver_editor_blocks', array['jsonb', 'jsonb'],
  'Naver editor blueprint materializer exists'
);

select ok(
  not has_function_privilege('authenticated', 'private.materialize_naver_editor_blocks(jsonb,jsonb)', 'EXECUTE'),
  'authenticated clients cannot call the private blueprint materializer'
);

select is(
  private.materialize_naver_editor_blocks(
    '[{"kind":"paragraph","text":"도입"},{"kind":"image_slot","position":1,"altText":"첫 이미지"},{"kind":"quote","text":"확인 기준"},{"kind":"link","url":"https://example.com/guide","title":"안내"}]'::jsonb,
    '[{"mediaId":"10000000-0000-4000-8000-000000000001","altText":"승인 이미지"}]'::jsonb
  ),
  '[{"kind":"paragraph","text":"도입"},{"kind":"image","mediaId":"10000000-0000-4000-8000-000000000001","altText":"첫 이미지"},{"kind":"quote","text":"확인 기준"},{"kind":"link","url":"https://example.com/guide","title":"안내"}]'::jsonb,
  'image slots become exact ordered approved image blocks'
);

select throws_ok(
  $$select private.materialize_naver_editor_blocks(
    '[{"kind":"image_slot","position":2,"altText":"잘못된 순서"}]'::jsonb,
    '[{"mediaId":"10000000-0000-4000-8000-000000000001","altText":"승인 이미지"}]'::jsonb
  )$$,
  'P0001',
  '네이버 이미지 자리 순서를 확인해 주세요.',
  'out-of-order image slots fail closed'
);

select ok(
  pg_get_functiondef('private.save_conversation_artifact_to_work_internal(uuid,uuid)'::regprocedure)
    like '%private.materialize_naver_editor_blocks%',
  'saving a Naver conversation artifact materializes its rich editor blocks'
);

select ok(
  pg_get_constraintdef((select oid from pg_constraint where conrelid = 'public.generation_batches'::regclass and conname = 'generation_batches_requested_count_check'))
    like '%requested_count%<= 20%',
  'generation batches can hold twenty Naver images'
);

select ok(
  pg_get_constraintdef((select oid from pg_constraint where conrelid = 'public.artifact_slides'::regclass and conname = 'artifact_slides_position_check'))
    like '%position%<= 20%',
  'artifact slides preserve positions through twenty'
);

select ok(
  pg_get_functiondef('private.save_conversation_artifact_to_work_internal(uuid,uuid)'::regprocedure)
    like '%valid_media_count not between 1 and 20%',
  'Naver work saving accepts up to twenty verified images'
);

select * from finish();

rollback;
