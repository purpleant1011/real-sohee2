begin;

create extension if not exists pgtap with schema extensions;

select plan(6);

select has_column(
  'public', 'content_versions', 'structured_payload',
  'immutable versions persist the validated structured payload'
);
select has_column(
  'public', 'content_versions', 'harness_rule_ids',
  'immutable versions persist active harness identifiers'
);
select col_type_is(
  'public', 'content_versions', 'structured_payload', 'jsonb',
  'structured payload is structured JSON'
);
select col_type_is(
  'public', 'content_versions', 'harness_rule_ids', 'uuid[]',
  'harness identifiers preserve their explicit order'
);
select ok(
  exists (
    select 1
    from pg_constraint
    where conrelid = 'public.content_items'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) like '%daangn_business%'
  ),
  'content items accept the Daangn Business channel'
);
select ok(
  exists (
    select 1
    from pg_constraint
    where conrelid = 'public.harness_rules'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) like '%daangn_business%'
  ),
  'harness rules may explicitly apply to Daangn Business'
);

select * from finish();
rollback;
