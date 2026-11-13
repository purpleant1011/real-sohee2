create or replace function public.get_workspace_credit_usage_detail(
  p_workspace_id uuid,
  p_limit integer default 50
)
returns table (
  occurred_at timestamptz,
  operation text,
  usage_source text,
  text_input_tokens integer,
  cached_text_input_tokens integer,
  text_output_tokens integer,
  image_input_tokens integer,
  image_output_tokens integer,
  provider_total_tokens integer,
  requested_credits integer,
  settled_credits integer,
  released_credits integer,
  policy_version text
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.has_credit_workspace_access(p_workspace_id) then
    raise exception 'CREDIT_FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception 'CREDIT_USAGE_FILTER_INVALID' using errcode = 'P0001';
  end if;

  return query
  select
    usage.occurred_at,
    usage.operation,
    usage.usage_source,
    usage.text_input_tokens,
    usage.cached_text_input_tokens,
    usage.text_output_tokens,
    usage.image_input_tokens,
    usage.image_output_tokens,
    usage.provider_total_tokens,
    reservation.requested_credits,
    reservation.settled_credits,
    reservation.released_credits,
    usage.policy_version
  from public.ai_usage_events usage
  join public.conversation_jobs job
    on job.id = usage.job_id
   and job.workspace_id = usage.workspace_id
  join public.credit_reservations reservation
    on reservation.id = job.reservation_id
   and reservation.workspace_id = usage.workspace_id
  where usage.workspace_id = p_workspace_id
  order by usage.occurred_at desc, usage.id desc
  limit p_limit;
end;
$$;

revoke all on function public.get_workspace_credit_usage_detail(uuid, integer)
from public, anon, authenticated;
grant execute on function public.get_workspace_credit_usage_detail(uuid, integer)
to authenticated, service_role;
