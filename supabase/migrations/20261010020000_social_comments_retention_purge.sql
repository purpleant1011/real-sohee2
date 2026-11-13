-- Migration: 20261010020000_social_comments_retention_purge.sql
-- Description: Service-role only purge for expired social comments and reply drafts (Go-live gate G-RET-COMMENT).
-- Invariants:
--   1. Only service_role may call this function (42501).
--   2. Minimum retention window is 7 days (fail-closed against accidental wipe), maximum 365 days (22023).
--   3. Only terminal comments ('SENT', 'DISMISSED', 'FAILED') older than retention days are purged.
--   4. Ongoing comments ('RECEIVED', 'CLASSIFIED', 'DRAFTED', 'APPROVED', 'SENDING', 'NEEDS_CHECK')
--      are strictly preserved regardless of age.
--   5. Append-only engagement_audit logs are preserved. Comment rows are retained with comment_text
--      redacted to '[보존 기간 경과로 삭제됨]', author_handle to '[삭제됨]', author_id to null
--      to satisfy audit FK integrity and prevent audit trigger failure.
--   6. Provider comment ID is retained to prevent duplicate re-ingestion during polling.
--   7. Batched at 1000 comments with concurrency-safe row locking (skip locked) and hasMore indicator.

create index if not exists idx_social_comments_purge
  on public.social_comments (status, updated_at)
  where status in ('SENT', 'DISMISSED', 'FAILED');

create or replace function public.purge_expired_social_comment_data(
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
  v_target_comments uuid[];
  v_has_more boolean := false;
  n_drafts integer := 0;
  n_comments integer := 0;
begin
  if current_setting('role', true) is distinct from 'service_role' then
    raise exception 'PURGE_FORBIDDEN' using errcode = '42501';
  end if;

  if p_retention_days is null or p_retention_days < 7 or p_retention_days > 365 then
    raise exception 'INVALID_RETENTION_DAYS' using errcode = '22023';
  end if;

  v_cutoff := pg_catalog.now() - (p_retention_days * interval '1 day');

  -- Select candidate comments up to batch limit + 1 to determine hasMore
  select pg_catalog.array_agg(cand.id) into v_target_comments
  from (
    select c.id
    from public.social_comments c
    where c.status in ('SENT', 'DISMISSED', 'FAILED')
      and c.updated_at < v_cutoff
      and (
        c.comment_text <> '[보존 기간 경과로 삭제됨]'
        or c.author_handle <> '[삭제됨]'
        or c.author_id is not null
        or exists (
          select 1 from public.comment_reply_drafts d
          where d.workspace_id = c.workspace_id and d.comment_id = c.id
        )
      )
    order by c.updated_at asc, c.id asc
    limit (c_batch_limit + 1)
    for update skip locked
  ) cand;

  if v_target_comments is null or pg_catalog.cardinality(v_target_comments) = 0 then
    return pg_catalog.jsonb_build_object(
      'comments', 0,
      'drafts', 0,
      'hasMore', false
    );
  end if;

  if pg_catalog.cardinality(v_target_comments) > c_batch_limit then
    v_has_more := true;
    v_target_comments := v_target_comments[1:c_batch_limit];
  end if;

  -- 1. Delete reply drafts belonging to target comments
  delete from public.comment_reply_drafts
  where comment_id = any(v_target_comments);
  get diagnostics n_drafts = row_count;

  -- 2. Redact text and personal information on target comments
  update public.social_comments
  set comment_text = '[보존 기간 경과로 삭제됨]',
      author_handle = '[삭제됨]',
      author_id = null
  where id = any(v_target_comments)
    and (
      comment_text <> '[보존 기간 경과로 삭제됨]'
      or author_handle <> '[삭제됨]'
      or author_id is not null
    );
  get diagnostics n_comments = row_count;

  return pg_catalog.jsonb_build_object(
    'comments', n_comments,
    'drafts', n_drafts,
    'hasMore', v_has_more
  );
end;
$$;

revoke all on function public.purge_expired_social_comment_data(integer) from public, anon, authenticated;
grant execute on function public.purge_expired_social_comment_data(integer) to service_role;
