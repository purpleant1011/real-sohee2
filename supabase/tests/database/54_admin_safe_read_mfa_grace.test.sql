begin;
select plan(5);
select ok(pg_get_functiondef('public.list_operator_admin_selector_options()'::regprocedure) ~ 'private\.operator_mfa_required', 'selector read uses effective MFA policy');
select ok(pg_get_functiondef('public.list_operator_admin_approval_requests()'::regprocedure) ~ 'private\.operator_mfa_required', 'approval read uses effective MFA policy');
select ok(pg_get_functiondef('public.list_operator_admin_selector_options()'::regprocedure) ~ 'auth\.jwt\(\) ->> ''aal''', 'selector read checks AAL when MFA is required');
select ok(pg_get_functiondef('public.list_operator_admin_approval_requests()'::regprocedure) ~ 'auth\.jwt\(\) ->> ''aal''', 'approval read checks AAL when MFA is required');
select ok(pg_get_functiondef('public.list_operator_admin_selector_options()'::regprocedure) !~ 'require_current_operator_aal2_actor', 'safe selector read does not force high-risk AAL2 helper');
select * from finish();
rollback;
