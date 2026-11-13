create or replace function public.start_conversation_with_first_message(
  p_workspace_id uuid,
  p_request_key uuid,
  p_user_id uuid,
  p_client_message_id uuid,
  p_content text
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_thread public.conversation_threads%rowtype;
  v_message public.messages%rowtype;
  v_existing_first public.messages%rowtype;
  v_content text := btrim(p_content);
begin
  if (select auth.uid()) is null or (select auth.uid()) <> p_user_id then
    raise exception 'conversation_start_forbidden' using errcode = '42501';
  end if;

  if not (select private.has_workspace_role(
    p_workspace_id,
    array['owner', 'manager', 'reviewer']::text[]
  )) then
    raise exception 'conversation_start_forbidden' using errcode = '42501';
  end if;

  if p_request_key is null
    or p_client_message_id is null
    or char_length(v_content) < 1
    or char_length(v_content) > 8000
  then
    raise exception 'conversation_start_invalid' using errcode = '22023';
  end if;

  insert into public.conversation_threads (
    workspace_id,
    kind,
    title,
    status,
    creation_request_key
  )
  values (
    p_workspace_id,
    'operations',
    '새 대화',
    'active',
    p_request_key
  )
  on conflict (workspace_id, creation_request_key) do nothing
  returning * into v_thread;

  if v_thread.id is null then
    select *
    into v_thread
    from public.conversation_threads
    where workspace_id = p_workspace_id
      and creation_request_key = p_request_key;
  end if;

  if v_thread.id is null or v_thread.status <> 'active' then
    raise exception 'conversation_start_unavailable' using errcode = 'P0001';
  end if;

  select *
  into v_existing_first
  from public.messages
  where workspace_id = p_workspace_id
    and thread_id = v_thread.id
    and role = 'user'
  order by created_at asc, id asc
  limit 1;

  if v_existing_first.id is not null then
    if v_existing_first.client_message_id <> p_client_message_id
      or v_existing_first.created_by_user_id <> p_user_id
      or v_existing_first.content <> v_content
    then
      raise exception 'conversation_start_request_conflict' using errcode = '23505';
    end if;
    v_message := v_existing_first;
  else
    insert into public.messages (
      workspace_id,
      thread_id,
      role,
      content,
      status,
      client_message_id,
      created_by_user_id,
      completed_at
    )
    values (
      p_workspace_id,
      v_thread.id,
      'user',
      v_content,
      'completed',
      p_client_message_id,
      p_user_id,
      statement_timestamp()
    )
    on conflict (workspace_id, client_message_id) do nothing
    returning * into v_message;

    if v_message.id is null then
      select *
      into v_message
      from public.messages
      where workspace_id = p_workspace_id
        and client_message_id = p_client_message_id;
    end if;

    if v_message.id is null
      or v_message.thread_id <> v_thread.id
      or v_message.created_by_user_id <> p_user_id
      or v_message.content <> v_content
    then
      raise exception 'conversation_start_request_conflict' using errcode = '23505';
    end if;
  end if;

  select *
  into v_thread
  from public.conversation_threads
  where workspace_id = p_workspace_id
    and id = v_thread.id;

  return jsonb_build_object(
    'thread', to_jsonb(v_thread),
    'user_message', to_jsonb(v_message)
  );
end;
$$;

revoke all on function public.start_conversation_with_first_message(
  uuid, uuid, uuid, uuid, text
) from public, anon;

grant execute on function public.start_conversation_with_first_message(
  uuid, uuid, uuid, uuid, text
) to authenticated;

comment on function public.start_conversation_with_first_message(
  uuid, uuid, uuid, uuid, text
) is 'V0.7.5 미저장 대화에서 첫 메시지와 스레드를 한 트랜잭션으로 생성한다.';
