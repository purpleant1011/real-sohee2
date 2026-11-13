drop function if exists public.import_byreum_campaign_pair(
  uuid, uuid, text, text, text[], text, text[], text, uuid[], uuid
);
notify pgrst, 'reload schema';
