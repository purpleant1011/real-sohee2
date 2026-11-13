-- ANI-1538: fast author-scoped draft maintenance; existing migration stays immutable.
create index if not exists channel_drafts_created_by_idx on public.channel_drafts (created_by);
-- Rollback: drop index if exists public.channel_drafts_created_by_idx;
