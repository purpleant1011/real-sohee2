-- Migration: 20261010010000_instagram_dm_retention_purge.sql
-- Description: Service-role only purge for expired Instagram DM threads, messages, and drafts (Go-live gate G-RET).
-- Invariants:
--   1. Only service_role may call this function (42501).
--   2. Minimum retention window is 7 days (fail-closed against accidental wipe), maximum 365 days (22023).
--   3. Only terminal threads ('SENT', 'DISMISSED', 'EXPIRED') older than retention days are purged.
--   4. Ongoing threads ('NEEDS_REPLY', 'NEEDS_CHECK') are strictly preserved regardless of age.
--   5. Append-only audit logs are preserved (never deleted). Thread rows are retained with last_message_text
--      redacted to '[보존 기간 경과로 삭제됨]' to satisfy audit FK integrity and ensure audit traceability.
--   6. Batched at 1000 threads with concurrency-safe row locking (skip locked) and hasMore indicator.

create index if not exists idx_instagram_dm_threads_purge
  on public.instagram_dm_threads (status, last_message_at)
  where status in ('SENT', 'DISMISSED', 'EXPIRED');

create or replace function public.purge_expired_instagram_dm_data(
  p_retention_days integer default 30
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_batch_limit constant integer := 1000;
  v_cutoff timestamptz;
  v_target_threads uuid[];
  v_has_more boolean := false;
  n_drafts integer := 0;
  n_messages integer := 0;
  n_threads integer := 0;
begin
  if current_setting('role', true) is distinct from 'service_role' then
    raise exception 'PURGE_FORBIDDEN' using errcode = '42501';
  end if;

  if p_retention_days is null or p_retention_days < 7 or p_retention_days > 365 then
    raise exception 'INVALID_RETENTION_DAYS' using errcode = '22023';
  end if;

  v_cutoff := pg_catalog.now() - (p_retention_days * interval '1 day');

  -- Select candidate threads up to batch limit + 1 to determine hasMore
  select pg_catalog.array_agg(cand.id) into v_target_threads
  from (
    select t.id
    from public.instagram_dm_threads t
    where t.status in ('SENT', 'DISMISSED', 'EXPIRED')
      and t.last_message_at < v_cutoff
      and (
        t.last_message_text <> '[보존 기간 경과로 삭제됨]'
        or exists (
          select 1 from public.instagram_dm_messages m
          where m.workspace_id = t.workspace_id and m.thread_id = t.id
        )
        or exists (
          select 1 from public.instagram_dm_drafts d
          where d.workspace_id = t.workspace_id and d.thread_id = t.id
        )
      )
    order by t.last_message_at asc, t.id asc
    limit (c_batch_limit + 1)
    for update skip locked
  ) cand;

  if v_target_threads is null or pg_catalog.cardinality(v_target_threads) = 0 then
    return pg_catalog.jsonb_build_object(
      'threads', 0,
      'messages', 0,
      'drafts', 0,
      'hasMore', false
    );
  end if;

  if pg_catalog.cardinality(v_target_threads) > c_batch_limit then
    v_has_more := true;
    v_target_threads := v_target_threads[1:c_batch_limit];
  end if;

  -- 1. Delete drafts belonging to target threads
  delete from public.instagram_dm_drafts
  where thread_id = any(v_target_threads);
  get diagnostics n_drafts = row_count;

  -- 2. Delete messages belonging to target threads
  delete from public.instagram_dm_messages
  where thread_id = any(v_target_threads);
  get diagnostics n_messages = row_count;

  -- 3. Redact last_message_text on target threads
  update public.instagram_dm_threads
  set last_message_text = '[보존 기간 경과로 삭제됨]'
  where id = any(v_target_threads)
    and last_message_text <> '[보존 기간 경과로 삭제됨]';
  get diagnostics n_threads = row_count;

  return pg_catalog.jsonb_build_object(
    'threads', n_threads,
    'messages', n_messages,
    'drafts', n_drafts,
    'hasMore', v_has_more
  );
end;
$$;

revoke all on function public.purge_expired_instagram_dm_data(integer) from public, anon, authenticated;
grant execute on function public.purge_expired_instagram_dm_data(integer) to service_role;
