alter table public.conversation_threads
  add column creation_request_key uuid;

alter table public.conversation_threads
  add constraint conversation_threads_workspace_creation_request_key_key
  unique (workspace_id, creation_request_key);

drop index if exists public.conversation_threads_workspace_last_message_idx;
create index conversation_threads_workspace_activity_idx
  on public.conversation_threads (
    workspace_id,
    last_message_at desc nulls last,
    created_at desc,
    id desc
  );

create or replace function private.touch_conversation_thread()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.conversation_threads
  set last_message_at = greatest(
        coalesce(last_message_at, '-infinity'::timestamptz),
        new.created_at
      ),
      title = case
        when title = '새 대화' and new.role = 'user'
          then left(regexp_replace(new.content, '\s+', ' ', 'g'), 60)
        else title
      end,
      updated_at = statement_timestamp()
  where workspace_id = new.workspace_id
    and id = new.thread_id;
  return new;
end;
$$;

revoke all on function private.touch_conversation_thread() from public, anon, authenticated;

comment on column public.conversation_threads.creation_request_key is
  '새 대화 재시도 중 중복 스레드 생성을 막는 작업공간 범위 요청 키';
