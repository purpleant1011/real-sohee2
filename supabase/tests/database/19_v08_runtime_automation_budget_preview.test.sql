begin;

select plan(7);

insert into auth.users (id, email)
values ('61000000-0000-4000-8000-000000000001', 'runtime-budget-owner@sohee.test.invalid');
insert into public.workspaces (id, name, created_by)
values ('62000000-0000-4000-8000-000000000001', 'runtime budget preview', '61000000-0000-4000-8000-000000000001');
insert into public.workspace_members (workspace_id, user_id, role, status)
values ('62000000-0000-4000-8000-000000000001', '61000000-0000-4000-8000-000000000001', 'owner', 'active')
on conflict (workspace_id, user_id) do nothing;

select private.ensure_v08_preview_credit_account('62000000-0000-4000-8000-000000000001', '2026-08-19T00:00:00Z');
-- The workspace trigger and ensure helper already provision the current weekly policy allowance.
select is(
  (select count(*)::integer from public.credit_accounts where workspace_id = '62000000-0000-4000-8000-000000000001' and period_start <= '2026-08-19' and period_end >= '2026-08-19'),
  1,
  'the preview uses exactly one current weekly credit account'
);
insert into public.automation_rules (id, workspace_id, kind, active, approval_required, configuration, created_by, timezone, next_run_at)
values ('64000000-0000-4000-8000-000000000001', '62000000-0000-4000-8000-000000000001', 'daily_performance_report', true, true, '{"perRunCreditCap":0,"dailyCreditCap":2,"weeklyCreditCap":7,"localTimes":["09:00"],"quietHours":{"start":"22:00","end":"07:00"},"channels":["instagram"],"approvalRequired":true}'::jsonb, '61000000-0000-4000-8000-000000000001', 'Asia/Seoul', '2026-08-19T00:00:00Z');

set local role service_role;

select ok(has_function_privilege('service_role', 'public.preview_v08_automation_budget(uuid,uuid,timestamptz)', 'EXECUTE'), 'service role may preview runtime automation budget');
select ok(not has_function_privilege('anon', 'public.preview_v08_automation_budget(uuid,uuid,timestamptz)', 'EXECUTE'), 'anonymous clients cannot preview runtime automation budget');
select is((select public.preview_v08_automation_budget('62000000-0000-4000-8000-000000000001', '64000000-0000-4000-8000-000000000001', '2026-08-19T00:00:00Z') ->> 'reason'), 'per_run_cap', 'per-run cap is enforced before reserve');

reset role;
update public.automation_rules set configuration = '{"perRunCreditCap":1,"dailyCreditCap":1,"weeklyCreditCap":7,"localTimes":["09:00"],"quietHours":{"start":"22:00","end":"07:00"},"channels":["instagram"],"approvalRequired":true}'::jsonb where id = '64000000-0000-4000-8000-000000000001';
insert into public.credit_reservations (id, workspace_id, account_id, action, requested_credits, settled_credits, state, idempotency_key, created_at)
select '65000000-0000-4000-8000-000000000001', '62000000-0000-4000-8000-000000000001', id, 'performance_report', 1, 1, 'settled', 'runtime-budget-settled-today', '2026-08-19T00:00:00Z'
from public.credit_accounts where workspace_id = '62000000-0000-4000-8000-000000000001' and period_start <= '2026-08-19' and period_end >= '2026-08-19';
set local role service_role;
select is((select public.preview_v08_automation_budget('62000000-0000-4000-8000-000000000001', '64000000-0000-4000-8000-000000000001', '2026-08-19T00:00:00Z') ->> 'reason'), 'daily_cap', 'settled same-day usage reaches the daily cap');

reset role;
update public.automation_rules set configuration = '{"perRunCreditCap":1,"dailyCreditCap":2,"weeklyCreditCap":2,"localTimes":["09:00"],"quietHours":{"start":"22:00","end":"07:00"},"channels":["instagram"],"approvalRequired":true}'::jsonb where id = '64000000-0000-4000-8000-000000000001';
insert into public.credit_reservations (id, workspace_id, account_id, action, requested_credits, settled_credits, state, idempotency_key, created_at)
select '65000000-0000-4000-8000-000000000002', '62000000-0000-4000-8000-000000000001', id, 'performance_report', 1, 1, 'settled', 'runtime-budget-settled-earlier', '2026-08-18T00:00:00Z'
from public.credit_accounts where workspace_id = '62000000-0000-4000-8000-000000000001' and period_start <= '2026-08-19' and period_end >= '2026-08-19';
set local role service_role;
select is((select public.preview_v08_automation_budget('62000000-0000-4000-8000-000000000001', '64000000-0000-4000-8000-000000000001', '2026-08-19T00:00:00Z') ->> 'reason'), 'weekly_cap', 'settled current-week usage reaches the weekly cap');

reset role;
update public.automation_rules set configuration = '{"perRunCreditCap":1,"dailyCreditCap":2,"weeklyCreditCap":7,"localTimes":["09:00"],"quietHours":{"start":"22:00","end":"07:00"},"channels":["instagram"],"approvalRequired":true}'::jsonb where id = '64000000-0000-4000-8000-000000000001';
insert into public.credit_reservations (id, workspace_id, account_id, action, requested_credits, released_credits, state, idempotency_key, created_at)
select '65000000-0000-4000-8000-000000000003', '62000000-0000-4000-8000-000000000001', id, 'performance_report', 5, 5, 'released', 'runtime-budget-released', '2026-08-19T00:00:00Z'
from public.credit_accounts where workspace_id = '62000000-0000-4000-8000-000000000001' and period_start <= '2026-08-19' and period_end >= '2026-08-19';
set local role service_role;
select is((select public.preview_v08_automation_budget('62000000-0000-4000-8000-000000000001', '64000000-0000-4000-8000-000000000001', '2026-08-19T00:00:00Z') ->> 'allowed')::boolean, true, 'released reservations do not count twice against current usage');

select * from finish();

rollback;
