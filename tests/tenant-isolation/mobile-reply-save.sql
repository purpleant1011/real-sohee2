-- Track 2 real transactional reply draft save, local PostgreSQL only.
begin;
do $$ begin
 if to_regprocedure('public.save_mobile_reply_draft(uuid,text,uuid,text,timestamp with time zone,text,uuid)') is null then raise exception 'Track 2 atomic reply save missing'; end if;
end $$;
rollback;
