create or replace function private.guard_channel_response_sending_transition()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.status = 'sending'
    and old.status not in ('needs_draft', 'draft', 'approved', 'failed')
  then
    raise exception '현재 응답 작업 상태에서는 전송을 시작할 수 없습니다.';
  end if;
  return new;
end;
$$;

drop trigger if exists channel_response_jobs_sending_transition_guard
  on public.channel_response_jobs;
create trigger channel_response_jobs_sending_transition_guard
before update of status on public.channel_response_jobs
for each row
execute function private.guard_channel_response_sending_transition();

