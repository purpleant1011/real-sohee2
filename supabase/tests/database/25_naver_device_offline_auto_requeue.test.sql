begin;

create extension if not exists pgtap with schema extensions;

select plan(7);

select function_lang_is(
  'public', 'complete_local_publish_job',
  array['uuid','uuid','uuid','uuid','text','text','text','text'],
  'plpgsql',
  'local completion remains a database function'
);

select ok(
  pg_get_functiondef('public.complete_local_publish_job(uuid,uuid,uuid,uuid,text,text,text,text)'::regprocedure)
    like '%p_failure_code = ''DEVICE_OFFLINE''%',
  'only DEVICE_OFFLINE enters the automatic reconnect path'
);

select ok(
  pg_get_functiondef('public.complete_local_publish_job(uuid,uuid,uuid,uuid,text,text,text,text)'::regprocedure)
    like '%current_attempt_number, 3) < 3%',
  'automatic reconnect retries are bounded to fewer than three attempts'
);

select ok(
  pg_get_functiondef('public.complete_local_publish_job(uuid,uuid,uuid,uuid,text,text,text,text)'::regprocedure)
    like '%submit_permit_digest is not null%submit_permit_issued_at is not null%',
  'a pre-submit failure is rejected after any submit permit exists'
);

select ok(
  pg_get_functiondef('public.complete_local_publish_job(uuid,uuid,uuid,uuid,text,text,text,text)'::regprocedure)
    like '%not exists%external_action_receipts%',
  'automatic reconnect requires that no provider receipt exists'
);

select ok(
  pg_get_functiondef('public.complete_local_publish_job(uuid,uuid,uuid,uuid,text,text,text,text)'::regprocedure)
    like '%reconfirmation_required%DEADLINE_EXPIRED%',
  'an expired schedule requires user reconfirmation instead of automatic posting'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.complete_local_publish_job(uuid,uuid,uuid,uuid,text,text,text,text)',
    'EXECUTE'
  ),
  'authenticated clients cannot complete or requeue connector jobs directly'
);

select * from finish();

rollback;
