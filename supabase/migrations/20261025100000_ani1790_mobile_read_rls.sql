-- ANI-1790: 사용자 RLS 읽기 양성 대조에서 확인한 레거시 정책 오류를 닫는다.
-- memberships는 권한 회수된 호환 뷰다. 이 정책의 평가가 42501로 실패하면,
-- 유효한 private.is_workspace_member 정책이 있어도 자기 가게 프로필을 읽지 못한다.
-- 정본 workspace_members 기반 정책·grants·service_role 권한은 변경하지 않는다.
drop policy if exists "Customers view own business_profile" on public.business_profiles;
