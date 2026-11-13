do $$ begin
  if public.naver_revision_readiness() <> '{"contract":"naver-revision-v1","ready":false}'::jsonb then
    raise exception 'Missing commands must not be ready';
  end if;
  if has_function_privilege('anon', 'public.naver_revision_readiness()', 'EXECUTE')
    or not has_function_privilege('authenticated', 'public.naver_revision_readiness()', 'EXECUTE') then
    raise exception 'Readiness probe grants are incorrect';
  end if;
end $$;
