-- ANI-1789: local PostgreSQL only, no Provider. Missing feature must fail instead of vacuous PASS.
begin;
do $$ begin
 if to_regprocedure('public.consume_first_post_publish(uuid,uuid,text,jsonb,uuid)') is null then raise exception 'ANI-1789 atomic consumption RPC missing'; end if;
end $$;
rollback;
