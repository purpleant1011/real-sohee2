alter table public.conversation_artifacts
  drop constraint conversation_artifacts_caption_check,
  add constraint conversation_artifacts_caption_check
  check (
    char_length(caption) >= 1
    and char_length(caption) <= case
      when type = 'naver_blog_post' then 20000
      else 2200
    end
  );

comment on constraint conversation_artifacts_caption_check on public.conversation_artifacts is
  '네이버 블로그 장문은 20000자까지, 인스타그램과 스레드는 기존 2200자까지 보존한다.';
