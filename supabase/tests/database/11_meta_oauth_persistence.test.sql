begin;

create extension if not exists pgtap with schema extensions;

select plan(9);

select ok(
  has_function_privilege(
    'service_role',
    'public.save_meta_channel_connection(uuid,uuid,text,text,text,text,text,text[],timestamptz,timestamptz)',
    'EXECUTE'
  ),
  'service role may call the public Meta connection persistence RPC'
);
select ok(
  has_function_privilege(
    'service_role',
    'private.save_meta_channel_connection_internal(uuid,uuid,text,text,text,text,text,text[],timestamptz,timestamptz)',
    'EXECUTE'
  ),
  'service role may cross the invoker wrapper into the private persistence function'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'private.save_meta_channel_connection_internal(uuid,uuid,text,text,text,text,text,text[],timestamptz,timestamptz)',
    'EXECUTE'
  ),
  'authenticated clients cannot call the private persistence function'
);
select ok(
  not has_function_privilege(
    'anon',
    'private.save_meta_channel_connection_internal(uuid,uuid,text,text,text,text,text,text[],timestamptz,timestamptz)',
    'EXECUTE'
  ),
  'anonymous clients cannot call the private persistence function'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.load_meta_channel_credential(uuid,uuid)',
    'EXECUTE'
  ),
  'service role may call the public Meta credential loader RPC'
);
select ok(
  has_function_privilege(
    'service_role',
    'private.load_meta_channel_credential_internal(uuid,uuid)',
    'EXECUTE'
  ),
  'service role may cross the invoker wrapper into the private credential loader'
);
select ok(
  not exists (
    select 1
    from pg_proc as function_definition
    cross join lateral aclexplode(
      coalesce(
        function_definition.proacl,
        acldefault('f', function_definition.proowner)
      )
    ) as function_privilege
    where function_definition.oid =
      'private.load_meta_channel_credential_internal(uuid,uuid)'::regprocedure
      and function_privilege.grantee = 0
      and function_privilege.privilege_type = 'EXECUTE'
  ),
  'PUBLIC cannot execute the private credential loader'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'private.load_meta_channel_credential_internal(uuid,uuid)',
    'EXECUTE'
  ),
  'authenticated clients cannot call the private credential loader'
);
select ok(
  not has_function_privilege(
    'anon',
    'private.load_meta_channel_credential_internal(uuid,uuid)',
    'EXECUTE'
  ),
  'anonymous clients cannot call the private credential loader'
);

select * from finish();

rollback;
