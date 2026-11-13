-- ==============================================================================
-- 59_email_signup_agreement_ordering.test.sql
-- Issue: P0 이메일 가입 100% 실패 (ANI-1354 불변식)
-- Purpose: 실제 RPC SQL 가드를 그대로 태워서 register-email 의 호출 순서를 증명한다.
--   prepare_signup_application_atomic  -> agreements_completed = false 로만 기록
--   provision_education_workspace      -> agreements_completed = true 를 요구 (P0001)
--   finalize_email_signup_atomic(null) -> 약관·개업일자 저장, workspace 결합 없음
--   finalize_email_signup_atomic(ws)   -> business_verifications·audit 최종 결합
--   순서를 뒤집으면(prepare -> provision) P0001 로 실패해야 한다.
-- Executed after full migration replay in one rollback-only transaction.
-- ==============================================================================
\set ON_ERROR_STOP on
begin;

create temporary table signup_order_assertions (name text primary key, passed boolean not null);

-- ------------------------------------------------------------------------------
-- Fixtures: 두 명의 신규 이메일 가입자 (A = 올바른 순서, B = 순서 역전)
-- ------------------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('c1111111-1111-4111-8111-111111111111', 'order-correct@test.invalid', '{"full_name":"홍길동"}'::jsonb),
  ('c2222222-2222-4222-8222-222222222222', 'order-inverted@test.invalid', '{"full_name":"김철수"}'::jsonb);

-- ------------------------------------------------------------------------------
-- A. 올바른 순서: prepare -> finalize(null) -> provision -> finalize(ws)
-- ------------------------------------------------------------------------------
select public.prepare_signup_application_atomic(
  p_user_id => 'c1111111-1111-4111-8111-111111111111',
  p_business_number => '1208147521',
  p_company_name => '소희카페 강남본점',
  p_representative_name => '홍길동',
  p_is_verified => true
);

insert into signup_order_assertions values
('A1 prepare 는 agreements_completed=false 로 신청서를 만든다', (
  select count(*) = 1 from public.signup_applications
  where user_id = 'c1111111-1111-4111-8111-111111111111'
    and agreements_completed is false
    and workspace_id is null
    and state = 'TASTE_READY'
));

-- 1차 finalize: 워크스페이스 없이 약관·개업일자만 먼저 저장
select public.finalize_email_signup_atomic(
  p_user_id => 'c1111111-1111-4111-8111-111111111111',
  p_workspace_id => null,
  p_business_number => '1208147521',
  p_company_name => '소희카페 강남본점',
  p_representative_name => '홍길동',
  p_start_date => '20240101',
  p_is_verified => true,
  p_marketing_agreed => false,
  p_agreements_version => '2026.09-v1',
  p_ip_address => '127.0.0.1'
);

insert into signup_order_assertions values
('A2 finalize(null) 이 agreements_completed=true 로 만든다', (
  select count(*) = 1 from public.signup_applications
  where user_id = 'c1111111-1111-4111-8111-111111111111'
    and agreements_completed is true
    and workspace_id is null
)),
('A3 필수 약관 4종 + 선택 1종이 저장되고 아직 워크스페이스에 결합되지 않는다', (
  select count(*) = 5
     and count(*) filter (where agreement_type in ('TERMS_OF_SERVICE','PRIVACY_POLICY','AI_DATA_PROCESSING','CHANNEL_OPERATION_DELEGATION') and agreed) = 4
     and count(*) filter (where agreement_type = 'MARKETING_NOTIFICATIONS' and agreed is false) = 1
     and count(*) filter (where workspace_id is not null) = 0
  from public.user_agreements
  where user_id = 'c1111111-1111-4111-8111-111111111111' and version = '2026.09-v1'
)),
('A4 workspace 없이 호출한 finalize 는 business_verifications 를 만들지 않는다(두 번째 호출이 필수인 이유)', (
  select count(*) = 0 from public.business_verifications
  where business_number = '1208147521'
)),
('A5 workspace 없이 호출한 finalize 는 audit 을 남기지 않는다', (
  select count(*) = 0 from public.platform_audit_events
  where actor_user_id = 'c1111111-1111-4111-8111-111111111111'
));

-- 재시도 멱등성: 동일한 finalize(null) 을 다시 호출해도 최초 동의 시각이 보존된다
create temporary table agreement_snapshot as
select agreement_type, agreed_at
from public.user_agreements
where user_id = 'c1111111-1111-4111-8111-111111111111' and version = '2026.09-v1';

select public.finalize_email_signup_atomic(
  p_user_id => 'c1111111-1111-4111-8111-111111111111',
  p_workspace_id => null,
  p_business_number => '1208147521',
  p_company_name => '소희카페 강남본점',
  p_representative_name => '홍길동',
  p_start_date => '20240101',
  p_is_verified => true,
  p_marketing_agreed => false,
  p_agreements_version => '2026.09-v1',
  p_ip_address => '127.0.0.1'
);

insert into signup_order_assertions values
('A6 finalize(null) 재호출은 멱등하다(최초 agreed_at 보존, 행 증가 없음)', (
  (select count(*) from public.user_agreements
   where user_id = 'c1111111-1111-4111-8111-111111111111' and version = '2026.09-v1') = 5
  and not exists (
    select 1 from public.user_agreements a
    join agreement_snapshot s on s.agreement_type = a.agreement_type
    where a.user_id = 'c1111111-1111-4111-8111-111111111111'
      and a.version = '2026.09-v1'
      and a.agreed_at <> s.agreed_at
  )
));

-- provision: 약관 동의가 이미 true 이므로 통과해야 한다
create temporary table provision_result as
select public.provision_education_workspace(
  p_user_id => 'c1111111-1111-4111-8111-111111111111',
  p_workspace_name => '소희카페 강남본점',
  p_provider => 'email'
) as payload;

insert into signup_order_assertions values
('A7 약관 저장 후 provision 이 성공하고 신규 워크스페이스를 만든다', (
  select (payload->>'success')::boolean
     and (payload->>'is_new_workspace')::boolean
     and nullif(payload->>'workspace_id', '') is not null
  from provision_result
)),
('A8 provision 은 저장된 약관을 새 워크스페이스로 결합한다', (
  select count(*) = 5 and count(*) filter (where workspace_id is not null) = 5
  from public.user_agreements
  where user_id = 'c1111111-1111-4111-8111-111111111111' and version = '2026.09-v1'
));

-- 2차 finalize: 프로비저닝된 워크스페이스 결합 (business_verifications·audit)
select public.finalize_email_signup_atomic(
  p_user_id => 'c1111111-1111-4111-8111-111111111111',
  p_workspace_id => (select (payload->>'workspace_id')::uuid from provision_result),
  p_business_number => '1208147521',
  p_company_name => '소희카페 강남본점',
  p_representative_name => '홍길동',
  p_start_date => '20240101',
  p_is_verified => true,
  p_marketing_agreed => false,
  p_agreements_version => '2026.09-v1',
  p_ip_address => '127.0.0.1'
) as final_payload \gset

insert into signup_order_assertions values
('A9 최종 finalize 가 개업일자를 보존한다', (
  :'final_payload'::jsonb->>'start_date_saved' = 'true'
  and exists (
    select 1 from public.business_verifications bv
    join provision_result p on bv.workspace_id = (p.payload->>'workspace_id')::uuid
    where bv.start_date = '20240101' and bv.business_number = '1208147521'
  )
)),
('A10 최종 finalize 가 워크스페이스 결합 audit 을 남긴다', (
  select count(*) = 1 from public.platform_audit_events
  where actor_user_id = 'c1111111-1111-4111-8111-111111111111'
    and workspace_id = (select (payload->>'workspace_id')::uuid from provision_result)
    and action = 'agreement.verify.requested'
    and result = 'succeeded'
)),
('A11 신청서가 워크스페이스에 결합되고 COMPLETED 로 종료된다', (
  select count(*) = 1 from public.signup_applications
  where user_id = 'c1111111-1111-4111-8111-111111111111'
    and workspace_id = (select (payload->>'workspace_id')::uuid from provision_result)
    and state = 'COMPLETED'
    and agreements_completed is true
));

-- ------------------------------------------------------------------------------
-- B. 순서 역전: prepare -> provision (finalize 생략) 은 P0001 로 거부되어야 한다
-- ------------------------------------------------------------------------------
select public.prepare_signup_application_atomic(
  p_user_id => 'c2222222-2222-4222-8222-222222222222',
  p_business_number => '2148734023',
  p_company_name => '역전카페',
  p_representative_name => '김철수',
  p_is_verified => false
);

do $$
declare
  v_sqlstate text;
  v_message text;
begin
  begin
    perform public.provision_education_workspace(
      p_user_id => 'c2222222-2222-4222-8222-222222222222',
      p_workspace_name => '역전카페',
      p_provider => 'email'
    );
    v_sqlstate := '00000';
  exception when others then
    v_sqlstate := sqlstate;
    v_message := sqlerrm;
  end;

  insert into signup_order_assertions values
  ('B1 finalize 없이 provision 하면 P0001 로 거부된다', v_sqlstate = 'P0001'),
  ('B2 거부 메시지는 ANI-1354 약관 미완료 사유를 담는다', v_message like '%필수 약관 및 채널 위임 동의가 완료되지 않았습니다%');
end $$;

insert into signup_order_assertions values
('B3 거부 후에도 부분 상태(워크스페이스/멤버십/약관 결합)가 남지 않는다', (
  (select count(*) = 0 from public.workspaces where created_by = 'c2222222-2222-4222-8222-222222222222')
  and (select count(*) = 0 from public.workspace_members where user_id = 'c2222222-2222-4222-8222-222222222222')
  and (select count(*) = 0 from public.user_agreements where user_id = 'c2222222-2222-4222-8222-222222222222')
  and (select count(*) = 1 from public.signup_applications
       where user_id = 'c2222222-2222-4222-8222-222222222222'
         and workspace_id is null
         and agreements_completed is false)
));

-- ------------------------------------------------------------------------------
-- 결과 판정
-- ------------------------------------------------------------------------------
do $$ begin
  if (select not bool_and(passed) from signup_order_assertions) then
    raise exception 'email signup agreement ordering assertions failed: %',
      (select string_agg(name, ' | ') from signup_order_assertions where not passed);
  end if;
end $$;

select name, passed from signup_order_assertions order by name;

rollback;
