create or replace function private.seed_operator_admin_crm_demo_data()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid;
  workspace_record record;
  account_id uuid;
  entitlement_policy text;
begin
  select member.user_id into actor_id
  from public.platform_admin_members member
  where member.status = 'active'
  order by member.created_at, member.user_id
  limit 1;

  if actor_id is null then
    return jsonb_build_object('status', 'skipped', 'reason', 'ACTIVE_OPERATOR_REQUIRED');
  end if;

  insert into public.workspaces (id, name, timezone, created_by, workspace_kind, created_at, updated_at) values
    ('b1000000-0000-4000-8000-000000000001', '바이름', 'Asia/Seoul', actor_id, 'pilot', '2026-08-18T09:00:00+09:00', statement_timestamp()),
    ('d1000000-0000-4000-8000-000000000001', '소담공방', 'Asia/Seoul', actor_id, 'demo', '2026-08-24T09:10:00+09:00', statement_timestamp()),
    ('d1000000-0000-4000-8000-000000000002', '오늘의식탁', 'Asia/Seoul', actor_id, 'demo', '2026-08-24T09:20:00+09:00', statement_timestamp()),
    ('d1000000-0000-4000-8000-000000000003', '라이트스튜디오', 'Asia/Seoul', actor_id, 'demo', '2026-08-24T09:30:00+09:00', statement_timestamp()),
    ('d1000000-0000-4000-8000-000000000004', '모먼트살롱', 'Asia/Seoul', actor_id, 'demo', '2026-08-24T09:40:00+09:00', statement_timestamp()),
    ('d1000000-0000-4000-8000-000000000005', '온기브루', 'Asia/Seoul', actor_id, 'demo', '2026-08-24T09:50:00+09:00', statement_timestamp())
  on conflict (id) do update set
    name = excluded.name,
    timezone = excluded.timezone,
    workspace_kind = excluded.workspace_kind,
    updated_at = statement_timestamp();

  insert into public.business_profiles (workspace_id, business_name, industry, location, summary, created_at, updated_at) values
    ('b1000000-0000-4000-8000-000000000001', '바이름 눈썹 디자인 스튜디오', '뷰티·퍼스널케어', '서울', '소희의 첫 고객 운영 검증을 위한 파일럿 고객사', statement_timestamp(), statement_timestamp()),
    ('d1000000-0000-4000-8000-000000000001', '소담공방', '공예·클래스', '성수', '신규 가입 신청 단계 시연 고객사', statement_timestamp(), statement_timestamp()),
    ('d1000000-0000-4000-8000-000000000002', '오늘의식탁', '식음료', '마포', '사업 정보 확인 단계 시연 고객사', statement_timestamp(), statement_timestamp()),
    ('d1000000-0000-4000-8000-000000000003', '라이트스튜디오', '사진·영상', '용산', '계약 검토 단계 시연 고객사', statement_timestamp(), statement_timestamp()),
    ('d1000000-0000-4000-8000-000000000004', '모먼트살롱', '뷰티·헤어', '강남', '동의 확인 단계 시연 고객사', statement_timestamp(), statement_timestamp()),
    ('d1000000-0000-4000-8000-000000000005', '온기브루', '카페·로컬브랜드', '연남', '채널 연결 단계 시연 고객사', statement_timestamp(), statement_timestamp())
  on conflict (workspace_id) do update set
    business_name = excluded.business_name,
    industry = excluded.industry,
    location = excluded.location,
    summary = excluded.summary,
    updated_at = statement_timestamp();

  insert into public.workspace_members (workspace_id, user_id, role, status, created_at, updated_at)
  select seed.workspace_id, actor_id, 'owner', 'active', statement_timestamp(), statement_timestamp()
  from (values
    ('b1000000-0000-4000-8000-000000000001'::uuid),
    ('d1000000-0000-4000-8000-000000000001'::uuid),
    ('d1000000-0000-4000-8000-000000000002'::uuid),
    ('d1000000-0000-4000-8000-000000000003'::uuid),
    ('d1000000-0000-4000-8000-000000000004'::uuid),
    ('d1000000-0000-4000-8000-000000000005'::uuid)
  ) seed(workspace_id)
  on conflict (workspace_id, user_id) do update set role = excluded.role, status = excluded.status, updated_at = statement_timestamp();

  insert into public.workspace_lifecycles (workspace_id, status, reason, version, changed_by, changed_at, created_at, updated_at) values
    ('b1000000-0000-4000-8000-000000000001', 'ready_for_activation', '바이름 파일럿 고객 운영 시연', 1, actor_id, statement_timestamp(), statement_timestamp(), statement_timestamp()),
    ('d1000000-0000-4000-8000-000000000001', 'applied', '시연 데이터 · 가입 신청', 1, actor_id, statement_timestamp(), statement_timestamp(), statement_timestamp()),
    ('d1000000-0000-4000-8000-000000000002', 'information_pending', '시연 데이터 · 정보 확인', 1, actor_id, statement_timestamp(), statement_timestamp(), statement_timestamp()),
    ('d1000000-0000-4000-8000-000000000003', 'contract_review', '시연 데이터 · 계약 검토', 1, actor_id, statement_timestamp(), statement_timestamp(), statement_timestamp()),
    ('d1000000-0000-4000-8000-000000000004', 'consent_pending', '시연 데이터 · 동의 확인', 1, actor_id, statement_timestamp(), statement_timestamp(), statement_timestamp()),
    ('d1000000-0000-4000-8000-000000000005', 'channel_pending', '시연 데이터 · 채널 연결', 1, actor_id, statement_timestamp(), statement_timestamp(), statement_timestamp())
  on conflict (workspace_id) do update set
    status = excluded.status,
    reason = excluded.reason,
    changed_by = excluded.changed_by,
    changed_at = statement_timestamp(),
    updated_at = statement_timestamp();

  select version.policy_version into entitlement_policy
  from public.billing_plan_entitlement_versions version
  where version.policy_status = 'active' and version.plan_code = 'starter'
  order by version.effective_from desc limit 1;

  if entitlement_policy is not null then
    insert into public.workspace_billing_entitlements (workspace_id, plan_code, policy_version, state, effective_from, effective_until, source_reference)
    select seed.workspace_id, case when seed.workspace_id = 'b1000000-0000-4000-8000-000000000001'::uuid then 'growth' else 'starter' end,
      case when seed.workspace_id = 'b1000000-0000-4000-8000-000000000001'::uuid then (
        select version.policy_version from public.billing_plan_entitlement_versions version where version.policy_status = 'active' and version.plan_code = 'growth' order by version.effective_from desc limit 1
      ) else entitlement_policy end,
      'active', '2026-08-24T00:00:00+09:00', null, 'operator-admin-crm-demo-v1'
    from (values
      ('b1000000-0000-4000-8000-000000000001'::uuid),
      ('d1000000-0000-4000-8000-000000000001'::uuid),
      ('d1000000-0000-4000-8000-000000000002'::uuid),
      ('d1000000-0000-4000-8000-000000000003'::uuid),
      ('d1000000-0000-4000-8000-000000000004'::uuid),
      ('d1000000-0000-4000-8000-000000000005'::uuid)
    ) seed(workspace_id)
    on conflict (workspace_id, source_reference) do nothing;
  end if;

  for workspace_record in
    select workspace.id, case when workspace.workspace_kind = 'pilot' then 2000 else 300 end as grant_amount
    from public.workspaces workspace
    where workspace.id in (
      'b1000000-0000-4000-8000-000000000001',
      'd1000000-0000-4000-8000-000000000001',
      'd1000000-0000-4000-8000-000000000002',
      'd1000000-0000-4000-8000-000000000003',
      'd1000000-0000-4000-8000-000000000004',
      'd1000000-0000-4000-8000-000000000005'
    )
  loop
    insert into public.credit_accounts (workspace_id, period_start, period_end, timezone)
    values (workspace_record.id, '2026-08-24', '2026-08-30', 'Asia/Seoul')
    on conflict (workspace_id) do nothing;
    select account.id into account_id from public.credit_accounts account where account.workspace_id = workspace_record.id;
    insert into public.credit_ledger_entries (workspace_id, account_id, reservation_id, kind, action, amount, idempotency_key, occurred_at)
    values (workspace_record.id, account_id, null, 'grant', null, workspace_record.grant_amount, 'operator-admin-crm-demo-v1', statement_timestamp())
    on conflict (workspace_id, idempotency_key, kind) do nothing;
  end loop;
  return jsonb_build_object('status', 'seeded', 'workspace_count', 6);
end;
$$;

revoke all on function private.seed_operator_admin_crm_demo_data() from public, anon, authenticated;
grant execute on function private.seed_operator_admin_crm_demo_data() to service_role;
