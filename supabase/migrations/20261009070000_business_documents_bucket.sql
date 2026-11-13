-- 사업자등록증 전용 비공개 버킷.
-- storage.objects 에 이 버킷을 대상으로 하는 정책을 만들지 않는다:
-- 로그인 사용자(anon/authenticated)는 읽기·쓰기 모두 불가, 서버(service role)만 접근한다.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'business-documents',
  'business-documents',
  false,
  8388608,
  array['application/pdf', 'image/jpeg', 'image/png']::text[]
)
on conflict (id) do update
set name = excluded.name,
    public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;
