-- 본인 채널 기반 지식 학습: 영속 저장소, 임대, 작업, 문서, 계보 및 RLS
--
-- 설계 원칙
--  * 학습 출처는 knowledge_sources 의 is_learning_source = true 행이며 legacy URL 수집기와 분리된다.
--    legacy refresh_policy.collectionState 는 항상 connection_required 로 고정(CHECK)하고 학습 상태는 별도 컬럼이 가진다.
--  * 증거(문서/후보/리스/작업) 쓰기는 모두 SECURITY DEFINER RPC 한 트랜잭션에서 출처 잠금, 리비전 CAS, 동의, 리스,
--    작성자(actor) 멤버십을 함께 검증한다. authenticated 에게는 테이블 쓰기 권한을 주지 않는다.
--  * 문서는 불변 버전(source_revision + content_hash)이며, 승인된 증거 본문은 UPDATE 할 수 없다.

-- 1. knowledge_sources 확장
alter table public.knowledge_sources
  add column if not exists is_learning_source boolean not null default false,
  add column if not exists lifecycle_revision integer not null default 1 check (lifecycle_revision > 0),
  add column if not exists evidence_revision integer not null default 0 check (evidence_revision >= 0),
  add column if not exists consent_revision integer not null default 1 check (consent_revision > 0),
  add column if not exists consent_text boolean not null default false,
  add column if not exists consent_images boolean not null default false,
  add column if not exists learning_verification_status text
    check (learning_verification_status is null or learning_verification_status in ('pending', 'verified', 'expired', 'revoked', 'failed')),
  add column if not exists learning_collection_status text
    check (learning_collection_status is null or learning_collection_status in ('blocked', 'queued', 'collecting', 'extracting', 'review_required', 'partial', 'failed', 'cancelled')),
  add column if not exists deleted_at timestamptz;

-- 학습 출처는 legacy 수집 상태를 항상 connection_required 로 고정하고(수집기 격리),
-- 학습 상태 컬럼은 학습 출처에서만 채워진다.
alter table public.knowledge_sources
  add constraint knowledge_sources_learning_isolation_check check (
    is_learning_source = false
    or (
      source_type = 'url'
      and refresh_policy ->> 'collectionState' = 'connection_required'
      and learning_verification_status is not null
      and learning_collection_status is not null
    )
  ),
  add constraint knowledge_sources_legacy_learning_columns_check check (
    is_learning_source = true
    or (learning_verification_status is null and learning_collection_status is null)
  );

create or replace function public.knowledge_sources_learning_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    if new.is_learning_source then
      -- 사용자 JWT 로 학습 출처를 직접 만들 수 없다(서버 RPC/서비스 롤만).
      if current_user in ('authenticated', 'anon') then
        raise exception 'LEARNING_SOURCE_SERVER_ONLY';
      end if;
      new.learning_verification_status := coalesce(new.learning_verification_status, 'pending');
      new.learning_collection_status := coalesce(new.learning_collection_status, 'queued');
    end if;
  elsif new.is_learning_source is distinct from old.is_learning_source then
    raise exception 'LEARNING_SOURCE_FLAG_IMMUTABLE';
  end if;
  return new;
end;
$$;

create trigger knowledge_sources_learning_guard_trg
  before insert or update on public.knowledge_sources
  for each row execute function public.knowledge_sources_learning_guard();

-- 2. 테넌트 지식 에포크 테이블
create table if not exists public.workspace_knowledge_epochs (
  workspace_id uuid primary key references public.workspaces (id) on delete cascade,
  epoch bigint not null default 1 check (epoch > 0),
  updated_at timestamptz not null default now()
);

-- 3. 소유권 검증 증거 리스 (Evidence Lease) 테이블
create table if not exists public.learning_evidence_leases (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  knowledge_source_id uuid not null,
  evidence_revision integer not null default 1 check (evidence_revision > 0),
  provider_account_id text,
  method text not null check (method in ('oauth', 'profile_marker', 'dns_txt')),
  verified_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  constraint learning_evidence_leases_workspace_id_id_key unique (workspace_id, id),
  constraint learning_evidence_leases_workspace_source_fkey
    foreign key (workspace_id, knowledge_source_id)
    references public.knowledge_sources (workspace_id, id)
    on delete cascade,
  constraint learning_evidence_leases_source_rev_key
    unique (workspace_id, knowledge_source_id, evidence_revision)
);

create index if not exists learning_evidence_leases_lookup_idx
  on public.learning_evidence_leases (workspace_id, knowledge_source_id, evidence_revision);

-- 리스는 불변이다: 철회(revoked_at null -> 값)만 허용하고 철회된 리스를 되살리거나 필드를 바꿀 수 없다.
create or replace function public.learning_evidence_leases_immutable()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if old.revoked_at is not null then
    raise exception 'LEARNING_LEASE_REVOKED_IMMUTABLE';
  end if;
  if (new.id, new.workspace_id, new.knowledge_source_id, new.evidence_revision, new.provider_account_id,
      new.method, new.verified_at, new.expires_at, new.created_at)
     is distinct from
     (old.id, old.workspace_id, old.knowledge_source_id, old.evidence_revision, old.provider_account_id,
      old.method, old.verified_at, old.expires_at, old.created_at) then
    raise exception 'LEARNING_LEASE_IMMUTABLE';
  end if;
  return new;
end;
$$;

create trigger learning_evidence_leases_immutable_trg
  before update on public.learning_evidence_leases
  for each row execute function public.learning_evidence_leases_immutable();

-- 4. 영속 수집·검증·삭제 작업 (Learning Jobs) 테이블 (No Map SSOT)
create table if not exists public.learning_jobs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  knowledge_source_id uuid not null,
  source_revision integer not null check (source_revision > 0),
  job_kind text not null check (job_kind in ('collect', 'verify', 'delete')),
  idempotency_key text not null check (char_length(idempotency_key) between 1 and 300),
  status text not null default 'queued'
    check (status in ('queued', 'running', 'completed', 'failed', 'cancelled')),
  attempt integer not null default 0 check (attempt >= 0),
  lease_owner text check (lease_owner is null or char_length(lease_owner) between 1 and 200),
  lease_expires_at timestamptz,
  checkpoint jsonb not null default '{}'::jsonb
    check (jsonb_typeof(checkpoint) = 'object'),
  error_code text,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint learning_jobs_workspace_id_id_key unique (workspace_id, id),
  constraint learning_jobs_workspace_source_fkey
    foreign key (workspace_id, knowledge_source_id)
    references public.knowledge_sources (workspace_id, id)
    on delete cascade,
  constraint learning_jobs_workspace_idempotency_key
    unique (workspace_id, idempotency_key),
  constraint learning_jobs_running_lease_check check (
    status <> 'running' or (lease_owner is not null and lease_expires_at is not null)
  )
);

create index if not exists learning_jobs_status_idx
  on public.learning_jobs (workspace_id, status, created_at desc);
create index if not exists learning_jobs_source_idx
  on public.learning_jobs (workspace_id, knowledge_source_id, status);

-- 5. 수집된 원문 문서 (Learning Documents) 테이블: 불변 버전
create table if not exists public.learning_documents (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  knowledge_source_id uuid not null,
  source_revision integer not null check (source_revision > 0),
  provider_document_id text not null,
  author_account_id text not null,
  url text not null,
  published_at timestamptz,
  collected_at timestamptz not null default now(),
  text_content text not null,
  content_hash text not null,
  images jsonb not null default '[]'::jsonb
    check (jsonb_typeof(images) = 'array'),
  created_at timestamptz not null default now(),
  constraint learning_documents_workspace_id_id_key unique (workspace_id, id),
  constraint learning_documents_workspace_source_id_key unique (workspace_id, knowledge_source_id, id),
  constraint learning_documents_workspace_source_fkey
    foreign key (workspace_id, knowledge_source_id)
    references public.knowledge_sources (workspace_id, id)
    on delete cascade,
  -- 같은 provider 문서라도 source_revision/content_hash 가 다르면 별개의 불변 버전이다.
  constraint learning_documents_version_key
    unique (workspace_id, knowledge_source_id, provider_document_id, source_revision, content_hash)
);

create index if not exists learning_documents_source_idx
  on public.learning_documents (workspace_id, knowledge_source_id, collected_at desc);

-- 문서는 불변이다. 유일한 예외는 보존기간 소거(retention purge): text_content 를 '' 로, images 를 [] 로 비우는
-- 소거만 허용하며 관계 id(workspace/source/revision/provider_document_id/author/url/hash)는 감사용으로 남긴다.
-- 본문 재작성이나 소거 후 복원은 허용하지 않는다.
create or replace function public.learning_documents_immutable()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- 출처 삭제 후 비식별 소거: service_role + 삭제된 출처 + 정확히 이 형태일 때만 허용한다.
  -- (본문/이미지 비움, url/author/provider_document_id 비식별화, 나머지 식별·버전 필드 불변)
  if public.learning_is_service_role()
     and exists (
       select 1 from public.knowledge_sources s
       where s.workspace_id = old.workspace_id
         and s.id = old.knowledge_source_id
         and s.deleted_at is not null
     )
     and new.text_content = ''
     and new.images = '[]'::jsonb
     and new.url = 'https://removed.invalid/'
     and new.author_account_id = ''
     and new.provider_document_id = 'purged:' || old.id::text
     and (new.id, new.workspace_id, new.knowledge_source_id, new.source_revision,
          new.published_at, new.collected_at, new.content_hash, new.created_at)
         is not distinct from
         (old.id, old.workspace_id, old.knowledge_source_id, old.source_revision,
          old.published_at, old.collected_at, old.content_hash, old.created_at) then
    return new;
  end if;

  if (new.id, new.workspace_id, new.knowledge_source_id, new.source_revision, new.provider_document_id,
      new.author_account_id, new.url, new.published_at, new.collected_at, new.content_hash, new.created_at)
     is distinct from
     (old.id, old.workspace_id, old.knowledge_source_id, old.source_revision, old.provider_document_id,
      old.author_account_id, old.url, old.published_at, old.collected_at, old.content_hash, old.created_at) then
    raise exception 'LEARNING_DOCUMENT_IMMUTABLE';
  end if;

  if (new.text_content is distinct from old.text_content or new.images is distinct from old.images)
     and not (new.text_content = '' and new.images = '[]'::jsonb) then
    raise exception 'LEARNING_DOCUMENT_IMMUTABLE';
  end if;

  return new;
end;
$$;

create trigger learning_documents_immutable_trg
  before update on public.learning_documents
  for each row execute function public.learning_documents_immutable();

-- 6. knowledge_candidates 확장 (채널 학습 증거 및 계보 보존)
alter table public.knowledge_candidates
  add column if not exists source_revision integer not null default 1 check (source_revision > 0),
  add column if not exists evidence_document_id uuid,
  add column if not exists evidence_vision_receipt_id text,
  add column if not exists evidence_state text not null default 'observed'
    check (evidence_state in ('observed', 'inferred', 'recommended')),
  add column if not exists candidate_fingerprint text;

-- 증거 문서는 (tenant, source, document) 복합 FK 로 실제 존재/동일 출처를 강제한다. legacy manual/file 은 null 허용.
alter table public.knowledge_candidates
  add constraint knowledge_candidates_learning_document_fkey
  foreign key (workspace_id, knowledge_source_id, evidence_document_id)
  references public.learning_documents (workspace_id, knowledge_source_id, id)
  on delete restrict;

-- 동일 출처/문서/카테고리/정규화 본문의 재시도는 중복 후보를 만들지 않는다.
create unique index if not exists knowledge_candidates_learning_fingerprint_key
  on public.knowledge_candidates (workspace_id, knowledge_source_id, candidate_fingerprint)
  where candidate_fingerprint is not null;

-- 7. 지식 계보 및 프로젝션 종속성 (Learning Projection Dependencies) 테이블
create table if not exists public.learning_projection_dependencies (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  projection_fact_id uuid not null,
  knowledge_source_id uuid not null,
  required_revision integer not null check (required_revision > 0),
  created_at timestamptz not null default now(),
  constraint learning_proj_dep_workspace_id_id_key unique (workspace_id, id),
  constraint learning_proj_dep_fact_fkey
    foreign key (workspace_id, projection_fact_id)
    references public.knowledge_facts (workspace_id, id)
    on delete cascade,
  constraint learning_proj_dep_source_fkey
    foreign key (workspace_id, knowledge_source_id)
    references public.knowledge_sources (workspace_id, id)
    on delete cascade,
  constraint learning_proj_dep_unique
    unique (workspace_id, projection_fact_id, knowledge_source_id)
);

create index if not exists learning_proj_dep_lookup_idx
  on public.learning_projection_dependencies (workspace_id, knowledge_source_id);

-- 8. RLS: 모든 학습 테이블은 멤버 조회만 허용하고 쓰기는 SECURITY DEFINER RPC/서비스 롤 전용
alter table public.workspace_knowledge_epochs enable row level security;
alter table public.learning_evidence_leases enable row level security;
alter table public.learning_jobs enable row level security;
alter table public.learning_documents enable row level security;
alter table public.learning_projection_dependencies enable row level security;

create policy workspace_knowledge_epochs_select_policy
  on public.workspace_knowledge_epochs for select to authenticated
  using (
    exists (
      select 1 from public.workspace_members m
      where m.workspace_id = workspace_knowledge_epochs.workspace_id
        and m.user_id = auth.uid()
        and m.status = 'active'
    )
  );

create policy learning_evidence_leases_select_policy
  on public.learning_evidence_leases for select to authenticated
  using (
    exists (
      select 1 from public.workspace_members m
      where m.workspace_id = learning_evidence_leases.workspace_id
        and m.user_id = auth.uid()
        and m.status = 'active'
    )
  );

create policy learning_jobs_select_policy
  on public.learning_jobs for select to authenticated
  using (
    exists (
      select 1 from public.workspace_members m
      where m.workspace_id = learning_jobs.workspace_id
        and m.user_id = auth.uid()
        and m.status = 'active'
    )
  );

create policy learning_documents_select_policy
  on public.learning_documents for select to authenticated
  using (
    exists (
      select 1 from public.workspace_members m
      where m.workspace_id = learning_documents.workspace_id
        and m.user_id = auth.uid()
        and m.status = 'active'
    )
  );

create policy learning_projection_dependencies_select_policy
  on public.learning_projection_dependencies for select to authenticated
  using (
    exists (
      select 1 from public.workspace_members m
      where m.workspace_id = learning_projection_dependencies.workspace_id
        and m.user_id = auth.uid()
        and m.status = 'active'
    )
  );

grant select on public.workspace_knowledge_epochs to authenticated;
grant select on public.learning_evidence_leases to authenticated;
grant select on public.learning_jobs to authenticated;
grant select on public.learning_documents to authenticated;
grant select on public.learning_projection_dependencies to authenticated;

grant select, insert, update, delete on public.workspace_knowledge_epochs to service_role;
grant select, insert, update, delete on public.learning_evidence_leases to service_role;
grant select, insert, update, delete on public.learning_jobs to service_role;
grant select, insert, update, delete on public.learning_documents to service_role;
grant select, insert, update, delete on public.learning_projection_dependencies to service_role;

-- 9. 내부 헬퍼 (직접 호출 불가, SECURITY DEFINER RPC 내부에서만 사용)

create or replace function public.learning_is_service_role()
returns boolean
language sql
stable
set search_path = public, pg_temp
as $$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), auth.role())
    is not distinct from 'service_role'
$$;

create or replace function public.learning_normalize_text(p_text text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select btrim(regexp_replace(coalesce(p_text, ''), '\s+', ' ', 'g'))
$$;

-- 사용자/서비스 두 분기 모두 실제 활성 owner/manager(또는 member) 멤버십을 검증한다.
-- 서비스 롤 분기에서는 p_actor_user_id 가 반드시 필요하고 NULL 이면 통과시키지 않는다.
create or replace function public.check_learning_actor_authorization(
  p_workspace_id uuid,
  p_actor_user_id uuid,
  p_require_role text default 'manager'
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_actor uuid;
begin
  if p_require_role not in ('member', 'manager') then
    raise exception 'INVALID_ROLE_REQUIREMENT';
  end if;

  if v_uid is not null then
    if p_actor_user_id is not null and p_actor_user_id is distinct from v_uid then
      raise exception 'ACTOR_MISMATCH';
    end if;
    v_actor := v_uid;
  elsif public.learning_is_service_role() then
    if p_actor_user_id is null then
      raise exception 'ACTOR_REQUIRED';
    end if;
    v_actor := p_actor_user_id;
  else
    raise exception 'FORBIDDEN_UNAUTHENTICATED';
  end if;

  if not exists (
    select 1 from public.workspace_members m
    where m.workspace_id = p_workspace_id
      and m.user_id = v_actor
      and m.status = 'active'
      and (
        p_require_role = 'member'
        or (p_require_role = 'manager' and m.role in ('owner', 'manager'))
      )
  ) then
    raise exception 'FORBIDDEN_WORKSPACE_MEMBER';
  end if;
end;
$$;

create or replace function public.learning_require_service_role()
returns void
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if not public.learning_is_service_role() then
    raise exception 'FORBIDDEN_SERVER_ONLY';
  end if;
end;
$$;

-- 활성 학습 출처를 잠그고 상태/리비전을 CAS 로 검증한다.
create or replace function public.learning_lock_active_source(
  p_workspace_id uuid,
  p_source_id uuid,
  p_expected_revision integer
)
returns public.knowledge_sources
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_source public.knowledge_sources;
begin
  select * into v_source
  from public.knowledge_sources
  where workspace_id = p_workspace_id
    and id = p_source_id
    and is_learning_source = true
    and deleted_at is null
  for update;

  if not found then
    raise exception 'SOURCE_NOT_FOUND';
  end if;

  if v_source.status = 'paused'
     or v_source.learning_collection_status = 'cancelled'
     or v_source.learning_verification_status = 'revoked' then
    raise exception 'SOURCE_PAUSED';
  end if;

  if v_source.lifecycle_revision is distinct from p_expected_revision then
    raise exception 'STALE_SOURCE_REVISION';
  end if;

  return v_source;
end;
$$;

-- 현재 evidence_revision 과 일치하는 비철회/비만료 리스를 요구한다.
create or replace function public.learning_require_valid_lease(
  p_source public.knowledge_sources
)
returns public.learning_evidence_leases
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_lease public.learning_evidence_leases;
begin
  if p_source.learning_verification_status is distinct from 'verified' then
    raise exception 'SOURCE_NOT_VERIFIED';
  end if;

  select * into v_lease
  from public.learning_evidence_leases
  where workspace_id = p_source.workspace_id
    and knowledge_source_id = p_source.id
    and evidence_revision = p_source.evidence_revision
    and revoked_at is null
    and expires_at > now();

  if not found then
    raise exception 'VALID_LEASE_REQUIRED';
  end if;

  return v_lease;
end;
$$;

create or replace function public.learning_bump_epoch(p_workspace_id uuid)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  insert into public.workspace_knowledge_epochs (workspace_id, epoch, updated_at)
  values (p_workspace_id, 2, now())
  on conflict (workspace_id)
  do update set epoch = public.workspace_knowledge_epochs.epoch + 1, updated_at = now();
$$;

-- 출처 철회/삭제 시 미완료 수집·검증 작업을 취소한다.
create or replace function public.learning_cancel_open_jobs(
  p_workspace_id uuid,
  p_source_id uuid,
  p_error_code text
)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.learning_jobs
  set status = 'cancelled',
      error_code = p_error_code,
      lease_owner = null,
      lease_expires_at = null,
      updated_at = now()
  where workspace_id = p_workspace_id
    and knowledge_source_id = p_source_id
    and job_kind in ('collect', 'verify')
    and status in ('queued', 'running');
$$;

-- 10. 서버 전용 검증 리스 갱신 RPC - service_role 전용
create or replace function public.update_learning_verification_lease_atomic(
  p_workspace_id uuid,
  p_source_id uuid,
  p_expected_source_revision integer,
  p_evidence_revision integer,
  p_provider_account_id text,
  p_method text,
  p_verified_at timestamptz,
  p_expires_at timestamptz,
  p_actor_user_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_source public.knowledge_sources;
begin
  perform public.learning_require_service_role();

  if p_method not in ('oauth', 'profile_marker', 'dns_txt') then
    raise exception 'INVALID_VERIFICATION_METHOD';
  end if;

  if p_method = 'oauth' and (p_provider_account_id is null or btrim(p_provider_account_id) = '') then
    raise exception 'PROVIDER_ACCOUNT_REQUIRED';
  end if;

  if p_verified_at < (now() - interval '5 minutes') or p_verified_at > (now() + interval '5 minutes') then
    raise exception 'INVALID_VERIFIED_AT_TIMESTAMP';
  end if;

  if p_expires_at <= now() or p_expires_at > (p_verified_at + interval '24 hours') then
    raise exception 'INVALID_LEASE_EXPIRY';
  end if;

  v_source := public.learning_lock_active_source(p_workspace_id, p_source_id, p_expected_source_revision);

  if p_actor_user_id is not null then
    perform public.check_learning_actor_authorization(p_workspace_id, p_actor_user_id, 'manager');
  end if;

  if p_evidence_revision is distinct from (v_source.evidence_revision + 1) then
    raise exception 'STALE_EVIDENCE_REVISION';
  end if;

  insert into public.learning_evidence_leases (
    workspace_id, knowledge_source_id, evidence_revision, provider_account_id,
    method, verified_at, expires_at, revoked_at
  ) values (
    p_workspace_id, p_source_id, p_evidence_revision, p_provider_account_id,
    p_method, p_verified_at, p_expires_at, null
  );

  update public.knowledge_sources
  set evidence_revision = p_evidence_revision,
      learning_verification_status = 'verified',
      updated_at = now()
  where workspace_id = p_workspace_id
    and id = p_source_id;
end;
$$;

-- 11. 서버 전용 원자적 문서 저장 RPC - service_role 전용, 불변 버전
create or replace function public.persist_learning_documents_atomic(
  p_workspace_id uuid,
  p_source_id uuid,
  p_expected_revision integer,
  p_documents jsonb,
  p_actor_user_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_source public.knowledge_sources;
  v_lease public.learning_evidence_leases;
  v_actor uuid;
  v_doc jsonb;
  v_doc_id uuid;
  v_existing public.learning_documents;
begin
  perform public.learning_require_service_role();

  if p_documents is null or jsonb_typeof(p_documents) <> 'array' then
    raise exception 'INVALID_DOCUMENTS';
  end if;

  v_source := public.learning_lock_active_source(p_workspace_id, p_source_id, p_expected_revision);

  v_actor := coalesce(p_actor_user_id, v_source.created_by_user_id);
  perform public.check_learning_actor_authorization(p_workspace_id, v_actor, 'manager');

  if not v_source.consent_text then
    raise exception 'CONSENT_REQUIRED';
  end if;

  v_lease := public.learning_require_valid_lease(v_source);

  if v_lease.provider_account_id is null or btrim(v_lease.provider_account_id) = '' then
    raise exception 'LEASE_ACCOUNT_REQUIRED';
  end if;

  for v_doc in select * from jsonb_array_elements(p_documents)
  loop
    if v_doc->>'id' is null
       or coalesce(v_doc->>'providerDocumentId', '') = ''
       or coalesce(v_doc->>'authorAccountId', '') = ''
       or coalesce(v_doc->>'url', '') = ''
       or coalesce(v_doc->>'contentHash', '') = ''
       or v_doc->>'text' is null then
      raise exception 'INVALID_DOCUMENT';
    end if;
    v_doc_id := (v_doc->>'id')::uuid;

    -- 문서가 선언한 출처/리비전은 호출 인자와 정확히 일치해야 한다(교차 출처/stale 문서 차단).
    if v_doc->'source'->>'workspaceId' is distinct from p_workspace_id::text
       or v_doc->'source'->>'sourceId' is distinct from p_source_id::text
       or (v_doc->'source'->>'revision')::integer is distinct from p_expected_revision then
      raise exception 'DOCUMENT_SOURCE_MISMATCH';
    end if;

    -- 문서는 검증된 계정이 작성한 것이어야 한다.
    if v_doc->>'authorAccountId' is distinct from v_lease.provider_account_id then
      raise exception 'DOCUMENT_AUTHOR_MISMATCH';
    end if;

    if jsonb_array_length(coalesce(v_doc->'images', '[]'::jsonb)) > 0 and not v_source.consent_images then
      raise exception 'IMAGE_CONSENT_REQUIRED';
    end if;

    select * into v_existing from public.learning_documents where id = v_doc_id;
    if found then
      if v_existing.workspace_id is distinct from p_workspace_id
         or v_existing.knowledge_source_id is distinct from p_source_id
         or v_existing.source_revision is distinct from p_expected_revision
         or v_existing.provider_document_id is distinct from v_doc->>'providerDocumentId'
         or v_existing.content_hash is distinct from v_doc->>'contentHash' then
        raise exception 'DOCUMENT_VERSION_CONFLICT';
      end if;
      continue; -- 동일 불변 버전 재수집: 변경 없음
    end if;

    if exists (
      select 1 from public.learning_documents d
      where d.workspace_id = p_workspace_id
        and d.knowledge_source_id = p_source_id
        and d.provider_document_id = v_doc->>'providerDocumentId'
        and d.source_revision = p_expected_revision
        and d.content_hash = v_doc->>'contentHash'
    ) then
      -- 같은 버전인데 문서 id 가 다르면 후보 증거 id 가 어긋난다. 안정적 문서 id 를 요구한다.
      raise exception 'DOCUMENT_ID_MISMATCH';
    end if;

    insert into public.learning_documents (
      id, workspace_id, knowledge_source_id, source_revision, provider_document_id,
      author_account_id, url, published_at, collected_at, text_content, content_hash, images
    ) values (
      v_doc_id,
      p_workspace_id,
      p_source_id,
      p_expected_revision,
      v_doc->>'providerDocumentId',
      v_doc->>'authorAccountId',
      v_doc->>'url',
      nullif(v_doc->>'publishedAt', '')::timestamptz,
      coalesce(nullif(v_doc->>'collectedAt', '')::timestamptz, now()),
      v_doc->>'text',
      v_doc->>'contentHash',
      coalesce(v_doc->'images', '[]'::jsonb)
    );
  end loop;
end;
$$;

-- 12. 서버 전용 원자적 후보 저장 RPC - service_role 전용, 승인/반려 보존
create or replace function public.persist_learning_candidates_atomic(
  p_workspace_id uuid,
  p_source_id uuid,
  p_expected_revision integer,
  p_candidates jsonb,
  p_actor_user_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_source public.knowledge_sources;
  v_lease public.learning_evidence_leases;
  v_actor uuid;
  v_cand jsonb;
  v_cand_id uuid;
  v_doc_id uuid;
  v_doc public.learning_documents;
  v_existing public.knowledge_candidates;
  v_category text;
  v_content text;
  v_excerpt text;
  v_receipt text;
  v_state text;
  v_conflict_fact uuid;
  v_status text;
  v_fingerprint text;
  v_visual boolean;
begin
  perform public.learning_require_service_role();

  if p_candidates is null or jsonb_typeof(p_candidates) <> 'array' then
    raise exception 'INVALID_CANDIDATES';
  end if;

  v_source := public.learning_lock_active_source(p_workspace_id, p_source_id, p_expected_revision);

  v_actor := coalesce(p_actor_user_id, v_source.created_by_user_id);
  perform public.check_learning_actor_authorization(p_workspace_id, v_actor, 'manager');

  v_lease := public.learning_require_valid_lease(v_source);

  for v_cand in select * from jsonb_array_elements(p_candidates)
  loop
    v_cand_id := (v_cand->>'id')::uuid;
    v_doc_id := (v_cand->'evidence'->>'documentId')::uuid;
    v_category := v_cand->>'category';
    v_content := v_cand->>'content';
    v_excerpt := v_cand->'evidence'->>'excerpt';
    v_receipt := nullif(v_cand->'evidence'->>'visionReceiptId', '');
    v_state := coalesce(v_cand->>'evidenceState', 'observed');
    v_conflict_fact := nullif(v_cand->>'conflictsWithFactId', '')::uuid;

    if v_cand_id is null then
      raise exception 'INVALID_CANDIDATE';
    end if;
    if v_category is null or v_category not in
       ('business', 'offering', 'price', 'location', 'hours', 'policy', 'faq', 'tone', 'content', 'visual') then
      raise exception 'INVALID_CANDIDATE_CATEGORY';
    end if;
    if v_content is null or char_length(btrim(v_content)) = 0 or char_length(v_content) > 12000 then
      raise exception 'INVALID_CANDIDATE_CONTENT';
    end if;
    if v_state not in ('observed', 'inferred', 'recommended') then
      raise exception 'INVALID_EVIDENCE_STATE';
    end if;
    if v_doc_id is null then
      raise exception 'DOCUMENT_EVIDENCE_REQUIRED';
    end if;

    -- 동의: 이미지/시각 근거는 이미지 동의, 그 외 텍스트는 텍스트 동의
    v_visual := v_category = 'visual' or v_receipt is not null;
    if v_visual and not v_source.consent_images then
      raise exception 'CONSENT_REQUIRED';
    end if;
    if not v_visual and not v_source.consent_text then
      raise exception 'CONSENT_REQUIRED';
    end if;

    -- 증거 문서: 동일 테넌트/출처의 실존 문서, 현재 리비전, 검증된 작성자
    select * into v_doc
    from public.learning_documents d
    where d.workspace_id = p_workspace_id
      and d.knowledge_source_id = p_source_id
      and d.id = v_doc_id;
    if not found then
      raise exception 'INVALID_DOCUMENT_EVIDENCE';
    end if;
    if v_doc.source_revision is distinct from p_expected_revision then
      raise exception 'STALE_DOCUMENT_REVISION';
    end if;
    if v_lease.provider_account_id is null
       or v_doc.author_account_id is distinct from v_lease.provider_account_id then
      raise exception 'DOCUMENT_AUTHOR_MISMATCH';
    end if;

    -- 본문 인용: 발췌문은 실제 문서 본문에 포함되어야 한다(공백 정규화 비교).
    if v_excerpt is null or public.learning_normalize_text(v_excerpt) = '' then
      if v_receipt is null then
        raise exception 'EVIDENCE_QUOTE_REQUIRED';
      end if;
      v_excerpt := null;
    else
      if char_length(v_excerpt) > 2000 then
        raise exception 'INVALID_EVIDENCE_EXCERPT';
      end if;
      if position(public.learning_normalize_text(v_excerpt) in public.learning_normalize_text(v_doc.text_content)) = 0 then
        raise exception 'EVIDENCE_QUOTE_NOT_IN_DOCUMENT';
      end if;
    end if;

    v_status := 'review_required';
    if v_conflict_fact is not null then
      if not exists (
        select 1 from public.knowledge_facts f
        where f.workspace_id = p_workspace_id and f.id = v_conflict_fact
      ) then
        raise exception 'INVALID_CONFLICT_FACT';
      end if;
      v_status := 'conflict';
    elsif v_category in ('price', 'hours', 'policy', 'location') then
      -- 보수적 충돌 검출: AI 모델이 conflict fact를 지정하지 않았더라도,
      -- 가격·주소·시간·정책 등 중요 정본과 내용이 다르면 자동으로 conflict로 마킹하여
      -- 수동 정본을 보호하고 검토자의 명시적 편집 없이 approve되는 것을 차단한다.
      select f.id into v_conflict_fact
      from public.knowledge_facts f
      where f.workspace_id = p_workspace_id
        and f.category = v_category
        and f.status = 'active'
        and (f.valid_until is null or f.valid_until > now())
        and public.learning_normalize_text(f.content) is distinct from public.learning_normalize_text(v_content)
      order by f.created_at desc
      limit 1;

      if v_conflict_fact is not null then
        v_status := 'conflict';
      end if;
    end if;

    v_fingerprint := md5(
      v_category || E'\n' || public.learning_normalize_text(v_content) || E'\n' || v_doc_id::text
    );

    select * into v_existing
    from public.knowledge_candidates c
    where c.workspace_id = p_workspace_id
      and c.id = v_cand_id
    for update;

    if found then
      -- 다른 출처의 후보 id 로 변조해 덮어쓰는 것을 차단
      if v_existing.knowledge_source_id is distinct from p_source_id then
        raise exception 'CANDIDATE_SOURCE_MISMATCH';
      end if;

      -- 검토 대기 상태만 갱신 가능(승인/반려/충돌은 절대 덮어쓰지 않음)
      if v_existing.status <> 'review_required' then
        continue;
      end if;

      -- 동일 내용 재시도는 버전을 올리지 않는다.
      if v_existing.content is not distinct from v_content
         and v_existing.category is not distinct from v_category
         and v_existing.source_excerpt is not distinct from v_excerpt
         and v_existing.evidence_document_id is not distinct from v_doc_id
         and v_existing.evidence_vision_receipt_id is not distinct from v_receipt
         and v_existing.evidence_state is not distinct from v_state
         and v_existing.conflicts_with_fact_id is not distinct from v_conflict_fact then
        continue;
      end if;

      if exists (
        select 1 from public.knowledge_candidates o
        where o.workspace_id = p_workspace_id
          and o.knowledge_source_id = p_source_id
          and o.candidate_fingerprint = v_fingerprint
          and o.id <> v_cand_id
      ) then
        continue;
      end if;

      update public.knowledge_candidates
      set category = v_category,
          content = v_content,
          source_excerpt = v_excerpt,
          source_revision = p_expected_revision,
          evidence_document_id = v_doc_id,
          evidence_vision_receipt_id = v_receipt,
          evidence_state = v_state,
          conflicts_with_fact_id = v_conflict_fact,
          status = v_status,
          candidate_fingerprint = v_fingerprint,
          confidence = null,
          version = version + 1,
          updated_at = now()
      where workspace_id = p_workspace_id
        and id = v_cand_id
        and knowledge_source_id = p_source_id;
    else
      -- 동일 문서/카테고리/본문의 재시도는 새 id 라도 중복 후보를 만들지 않는다.
      if exists (
        select 1 from public.knowledge_candidates o
        where o.workspace_id = p_workspace_id
          and o.knowledge_source_id = p_source_id
          and o.candidate_fingerprint = v_fingerprint
      ) then
        continue;
      end if;

      insert into public.knowledge_candidates (
        id, workspace_id, knowledge_source_id, source_revision, category, content,
        source_excerpt, evidence_document_id, evidence_vision_receipt_id, evidence_state,
        conflicts_with_fact_id, candidate_fingerprint, confidence, status, version, created_by_user_id
      ) values (
        v_cand_id, p_workspace_id, p_source_id, p_expected_revision, v_category, v_content,
        v_excerpt, v_doc_id, v_receipt, v_state,
        v_conflict_fact, v_fingerprint, null, v_status, 1, v_actor
      );
    end if;
  end loop;
end;
$$;

-- 13. 작업 생성/클레임/전이 RPC - service_role 전용 (CAS + lease)
create or replace function public.create_learning_job_atomic(
  p_workspace_id uuid,
  p_source_id uuid,
  p_source_revision integer,
  p_job_kind text,
  p_idempotency_key text
)
returns setof public.learning_jobs
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_source public.knowledge_sources;
  v_job public.learning_jobs;
begin
  perform public.learning_require_service_role();

  if p_job_kind not in ('collect', 'verify', 'delete') then
    raise exception 'INVALID_JOB_KIND';
  end if;
  if p_idempotency_key is null or char_length(p_idempotency_key) not between 1 and 300 then
    raise exception 'INVALID_IDEMPOTENCY_KEY';
  end if;

  -- 출처를 공유 잠금으로 읽어 동시 revoke/delete 와 직렬화한다.
  select * into v_source
  from public.knowledge_sources
  where workspace_id = p_workspace_id
    and id = p_source_id
    and is_learning_source = true
  for share;

  if not found then
    raise exception 'SOURCE_NOT_FOUND';
  end if;

  select * into v_job
  from public.learning_jobs
  where workspace_id = p_workspace_id
    and idempotency_key = p_idempotency_key;

  if found then
    if v_job.knowledge_source_id is distinct from p_source_id
       or v_job.job_kind is distinct from p_job_kind
       or v_job.source_revision is distinct from p_source_revision then
      raise exception 'IDEMPOTENCY_CONFLICT';
    end if;
    return next v_job;
    return;
  end if;

  if p_job_kind in ('collect', 'verify') then
    if v_source.deleted_at is not null then
      raise exception 'SOURCE_NOT_FOUND';
    end if;
    if v_source.status = 'paused'
       or v_source.learning_collection_status = 'cancelled'
       or v_source.learning_verification_status = 'revoked' then
      raise exception 'SOURCE_PAUSED';
    end if;
  end if;

  if v_source.lifecycle_revision is distinct from p_source_revision then
    raise exception 'STALE_SOURCE_REVISION';
  end if;

  insert into public.learning_jobs (
    workspace_id, knowledge_source_id, source_revision, job_kind, idempotency_key, status
  ) values (
    p_workspace_id, p_source_id, p_source_revision, p_job_kind, p_idempotency_key, 'queued'
  )
  on conflict (workspace_id, idempotency_key) do nothing
  returning * into v_job;

  if not found then
    select * into v_job
    from public.learning_jobs
    where workspace_id = p_workspace_id
      and idempotency_key = p_idempotency_key;
    if v_job.knowledge_source_id is distinct from p_source_id
       or v_job.job_kind is distinct from p_job_kind
       or v_job.source_revision is distinct from p_source_revision then
      raise exception 'IDEMPOTENCY_CONFLICT';
    end if;
  end if;

  return next v_job;
end;
$$;

create or replace function public.claim_learning_job_atomic(
  p_workspace_id uuid,
  p_job_id uuid,
  p_worker_id text,
  p_lease_seconds integer default 300
)
returns setof public.learning_jobs
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_source_id uuid;
  v_source public.knowledge_sources;
  v_job public.learning_jobs;
begin
  perform public.learning_require_service_role();

  if p_worker_id is null or char_length(btrim(p_worker_id)) not between 1 and 200 then
    raise exception 'INVALID_WORKER_ID';
  end if;
  if p_lease_seconds is null or p_lease_seconds not between 10 and 3600 then
    raise exception 'INVALID_LEASE_SECONDS';
  end if;

  select knowledge_source_id into v_source_id
  from public.learning_jobs
  where workspace_id = p_workspace_id and id = p_job_id;
  if not found then
    return;
  end if;

  -- 잠금 순서: 출처(공유) -> 작업. revoke/delete 도 출처 -> 작업 순서라 교착이 없다.
  select * into v_source
  from public.knowledge_sources
  where workspace_id = p_workspace_id and id = v_source_id
  for share;

  select * into v_job
  from public.learning_jobs
  where workspace_id = p_workspace_id and id = p_job_id
  for update;

  if not found then
    return;
  end if;

  if not (
    v_job.status = 'queued'
    or (v_job.status = 'running' and v_job.lease_expires_at is not null and v_job.lease_expires_at <= now())
  ) then
    return;
  end if;

  if v_job.job_kind in ('collect', 'verify') and (
    v_source.id is null
    or not v_source.is_learning_source
    or v_source.deleted_at is not null
    or v_source.status = 'paused'
    or v_source.learning_collection_status = 'cancelled'
    or v_source.learning_verification_status = 'revoked'
    or v_source.lifecycle_revision is distinct from v_job.source_revision
  ) then
    update public.learning_jobs
    set status = 'cancelled',
        error_code = 'SOURCE_NOT_ACTIVE',
        lease_owner = null,
        lease_expires_at = null,
        updated_at = now()
    where workspace_id = p_workspace_id and id = p_job_id;
    return;
  end if;

  if v_job.attempt >= 5 then
    update public.learning_jobs
    set status = 'failed',
        error_code = 'MAX_ATTEMPTS_EXCEEDED',
        lease_owner = null,
        lease_expires_at = null,
        updated_at = now()
    where workspace_id = p_workspace_id and id = p_job_id;
    return;
  end if;

  update public.learning_jobs
  set status = 'running',
      attempt = attempt + 1,
      lease_owner = btrim(p_worker_id),
      lease_expires_at = now() + make_interval(secs => p_lease_seconds),
      updated_at = now()
  where workspace_id = p_workspace_id and id = p_job_id
  returning * into v_job;

  return next v_job;
end;
$$;

create or replace function public.update_learning_job_atomic(
  p_workspace_id uuid,
  p_job_id uuid,
  p_status text,
  p_lease_owner text default null,
  p_checkpoint jsonb default null,
  p_error_code text default null,
  p_error_message text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_job public.learning_jobs;
  v_terminal boolean;
begin
  perform public.learning_require_service_role();

  if p_status not in ('queued', 'running', 'completed', 'failed', 'cancelled') then
    raise exception 'INVALID_JOB_STATUS';
  end if;
  if p_checkpoint is not null and jsonb_typeof(p_checkpoint) <> 'object' then
    raise exception 'INVALID_CHECKPOINT';
  end if;

  select * into v_job
  from public.learning_jobs
  where workspace_id = p_workspace_id and id = p_job_id
  for update;

  if not found then
    raise exception 'JOB_NOT_FOUND';
  end if;

  -- 종료 상태는 불변. 동일 종료 상태 재시도만 멱등으로 허용한다.
  if v_job.status in ('completed', 'failed', 'cancelled') then
    if v_job.status = p_status then
      return;
    end if;
    raise exception 'JOB_STATE_CONFLICT';
  end if;

  if p_lease_owner is null then
    -- 소유자 없이 가능한 전이: 아직 클레임되지 않은 작업의 취소/실패 처리뿐
    if not (v_job.status = 'queued' and p_status in ('cancelled', 'failed')) then
      raise exception 'JOB_LEASE_REQUIRED';
    end if;
  else
    if v_job.status <> 'running'
       or v_job.lease_owner is distinct from p_lease_owner
       or v_job.lease_expires_at is null
       or v_job.lease_expires_at <= now() then
      raise exception 'JOB_LEASE_MISMATCH';
    end if;
  end if;

  v_terminal := p_status in ('completed', 'failed', 'cancelled', 'queued');

  update public.learning_jobs
  set status = p_status,
      checkpoint = case when p_checkpoint is null then checkpoint else checkpoint || p_checkpoint end,
      error_code = case when p_status in ('failed', 'cancelled') then coalesce(p_error_code, error_code) else error_code end,
      error_message = case when p_status in ('failed', 'cancelled') then coalesce(p_error_message, error_message) else error_message end,
      lease_owner = case when v_terminal then null else lease_owner end,
      lease_expires_at = case
        when v_terminal then null
        when p_status = 'running' then now() + interval '300 seconds'
        else lease_expires_at
      end,
      updated_at = now()
  where workspace_id = p_workspace_id and id = p_job_id;
end;
$$;

-- 14. 단일 원자적 출처 삭제 RPC - 단일 revision bump 보장
create or replace function public.delete_learning_source_atomic(
  p_workspace_id uuid,
  p_source_id uuid,
  p_expected_revision integer,
  p_actor_user_id uuid,
  p_idempotency_key text
)
returns table (
  deletion_job_id uuid,
  new_revision integer
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_source public.knowledge_sources;
  v_new_rev integer;
  v_job_id uuid;
begin
  perform public.check_learning_actor_authorization(p_workspace_id, p_actor_user_id, 'manager');

  select * into v_source
  from public.knowledge_sources
  where workspace_id = p_workspace_id
    and id = p_source_id
    and is_learning_source = true
    and deleted_at is null
  for update;

  if not found then
    raise exception 'SOURCE_NOT_FOUND';
  end if;

  if v_source.lifecycle_revision is distinct from p_expected_revision then
    raise exception 'STALE_SOURCE_REVISION';
  end if;

  v_new_rev := v_source.lifecycle_revision + 1;

  update public.knowledge_sources
  set deleted_at = now(),
      status = 'paused',
      learning_verification_status = 'revoked',
      learning_collection_status = 'cancelled',
      lifecycle_revision = v_new_rev,
      updated_at = now()
  where workspace_id = p_workspace_id
    and id = p_source_id;

  update public.learning_evidence_leases
  set revoked_at = now()
  where workspace_id = p_workspace_id
    and knowledge_source_id = p_source_id
    and revoked_at is null;

  perform public.learning_cancel_open_jobs(p_workspace_id, p_source_id, 'SOURCE_DELETED');
  perform public.learning_bump_epoch(p_workspace_id);

  update public.knowledge_facts
  set status = 'superseded'
  where workspace_id = p_workspace_id
    and id in (
      select projection_fact_id
      from public.learning_projection_dependencies
      where workspace_id = p_workspace_id
        and knowledge_source_id = p_source_id
    );

  insert into public.learning_jobs (
    workspace_id, knowledge_source_id, source_revision, job_kind, idempotency_key, status
  ) values (
    p_workspace_id, p_source_id, v_new_rev, 'delete', p_idempotency_key, 'queued'
  )
  on conflict (workspace_id, idempotency_key)
  do update set updated_at = now()
  returning id into v_job_id;

  return query select v_job_id, v_new_rev;
end;
$$;

-- 15. 단일 원자적 출처 철회 RPC (이미 철회된 출처는 멱등 no-op)
create or replace function public.revoke_learning_source_atomic(
  p_workspace_id uuid,
  p_source_id uuid,
  p_expected_revision integer,
  p_actor_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_source public.knowledge_sources;
begin
  perform public.check_learning_actor_authorization(p_workspace_id, p_actor_user_id, 'manager');

  select * into v_source
  from public.knowledge_sources
  where workspace_id = p_workspace_id
    and id = p_source_id
    and is_learning_source = true
    and deleted_at is null
  for update;

  if not found then
    raise exception 'SOURCE_NOT_FOUND';
  end if;

  if p_expected_revision is not null and v_source.lifecycle_revision is distinct from p_expected_revision then
    raise exception 'STALE_SOURCE_REVISION';
  end if;

  if v_source.learning_verification_status = 'revoked' then
    return;
  end if;

  update public.knowledge_sources
  set lifecycle_revision = lifecycle_revision + 1,
      learning_verification_status = 'revoked',
      learning_collection_status = 'cancelled',
      status = 'paused',
      updated_at = now()
  where workspace_id = p_workspace_id
    and id = p_source_id;

  update public.learning_evidence_leases
  set revoked_at = now()
  where workspace_id = p_workspace_id
    and knowledge_source_id = p_source_id
    and revoked_at is null;

  perform public.learning_cancel_open_jobs(p_workspace_id, p_source_id, 'SOURCE_REVOKED');
  perform public.learning_bump_epoch(p_workspace_id);

  update public.knowledge_facts
  set status = 'superseded'
  where workspace_id = p_workspace_id
    and id in (
      select projection_fact_id
      from public.learning_projection_dependencies
      where workspace_id = p_workspace_id
        and knowledge_source_id = p_source_id
    );
end;
$$;

-- 16. 원자적 검토 승인 RPC
create or replace function public.review_learning_candidates_atomic(
  p_workspace_id uuid,
  p_source_id uuid,
  p_expected_source_revision integer,
  p_expected_evidence_revision integer,
  p_actor_user_id uuid,
  p_decisions jsonb
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_source public.knowledge_sources;
  v_lease public.learning_evidence_leases;
  v_decision jsonb;
  v_candidate_id uuid;
  v_decision_type text;
  v_candidate_version integer;
  v_edited_content text;
  v_candidate public.knowledge_candidates;
  v_fact_id uuid;
  v_any_approved boolean := false;
begin
  perform public.check_learning_actor_authorization(p_workspace_id, p_actor_user_id, 'manager');

  if p_decisions is null or jsonb_typeof(p_decisions) <> 'array' then
    raise exception 'INVALID_DECISIONS';
  end if;

  v_source := public.learning_lock_active_source(p_workspace_id, p_source_id, p_expected_source_revision);

  if not v_source.consent_text and not v_source.consent_images then
    raise exception 'CONSENT_REVOKED';
  end if;

  begin
    v_lease := public.learning_require_valid_lease(v_source);
  exception when others then
    raise exception 'STALE_EVIDENCE_REVISION';
  end;

  if v_lease.evidence_revision is distinct from p_expected_evidence_revision then
    raise exception 'STALE_EVIDENCE_REVISION';
  end if;

  for v_decision in select * from jsonb_array_elements(p_decisions)
  loop
    v_candidate_id := (v_decision->>'candidateId')::uuid;
    v_candidate_version := (v_decision->>'version')::integer;
    v_decision_type := v_decision->>'decision';
    v_edited_content := v_decision->>'editedContent';

    if v_decision_type not in ('approved', 'rejected') then
      raise exception 'INVALID_DECISION';
    end if;

    select * into v_candidate
    from public.knowledge_candidates
    where workspace_id = p_workspace_id
      and id = v_candidate_id
      and knowledge_source_id = p_source_id
    for update;

    if not found then
      raise exception 'CANDIDATE_NOT_FOUND';
    end if;

    if v_candidate.version <> v_candidate_version then
      raise exception 'STALE_CANDIDATE_VERSION';
    end if;

    if v_candidate.status not in ('review_required', 'conflict') then
      raise exception 'INVALID_CANDIDATE_STATUS';
    end if;

    if v_candidate.evidence_document_id is null then
      raise exception 'DOCUMENT_EVIDENCE_REQUIRED';
    end if;

    if v_candidate.source_revision is distinct from v_source.lifecycle_revision then
      raise exception 'STALE_CANDIDATE_REVISION';
    end if;

    if v_decision_type = 'approved' then
      if (v_candidate.status = 'conflict' or v_candidate.conflicts_with_fact_id is not null)
         and (v_edited_content is null or char_length(trim(v_edited_content)) = 0) then
        raise exception 'CONFLICT_RESOLUTION_REQUIRED';
      end if;

      v_any_approved := true;

      update public.knowledge_candidates
      set status = 'approved',
          version = version + 1,
          content = coalesce(v_edited_content, content),
          reviewed_by_user_id = p_actor_user_id,
          reviewed_at = now(),
          updated_at = now()
      where workspace_id = p_workspace_id
        and id = v_candidate_id;

      insert into public.knowledge_facts (
        workspace_id, category, content, status, source_candidate_id, approved_by_user_id, approved_at
      ) values (
        p_workspace_id, v_candidate.category, coalesce(v_edited_content, v_candidate.content),
        'active', v_candidate_id, p_actor_user_id, now()
      )
      on conflict (workspace_id, source_candidate_id)
      do update set
        content = excluded.content,
        status = 'active',
        approved_by_user_id = excluded.approved_by_user_id,
        approved_at = excluded.approved_at
      returning id into v_fact_id;

      insert into public.learning_projection_dependencies (
        workspace_id, projection_fact_id, knowledge_source_id, required_revision
      ) values (
        p_workspace_id, v_fact_id, p_source_id, v_source.lifecycle_revision
      )
      on conflict (workspace_id, projection_fact_id, knowledge_source_id)
      do update set required_revision = excluded.required_revision;

    else
      update public.knowledge_candidates
      set status = 'rejected',
          version = version + 1,
          reviewed_by_user_id = p_actor_user_id,
          reviewed_at = now(),
          updated_at = now()
      where workspace_id = p_workspace_id
        and id = v_candidate_id;

      update public.knowledge_facts
      set status = 'superseded'
      where workspace_id = p_workspace_id
        and source_candidate_id = v_candidate_id;
    end if;
  end loop;

  if v_any_approved then
    perform public.learning_bump_epoch(p_workspace_id);
  end if;
end;
$$;

-- 17. 목적별 권위 승인 지식 조회 RPC (단일 signature 유지)
drop function if exists public.get_approved_learning_context(uuid, text, integer);
drop function if exists public.get_approved_learning_context(uuid, text, integer, text);
create or replace function public.get_approved_learning_context(
  p_workspace_id uuid,
  p_purpose text,
  p_max_facts integer default 32,
  p_query text default ''
)
returns table (
  id uuid,
  category text,
  content text,
  source_type text,
  source_id uuid,
  source_revision integer,
  epoch bigint,
  dependencies jsonb,
  created_at timestamptz,
  source_location text
)
language plpgsql
security definer
set search_path = public, pg_temp
stable
as $$
declare
  v_clean_query text := substring(btrim(coalesce(p_query, '')) from 1 for 300);
  v_has_query boolean := char_length(v_clean_query) > 0;
  v_tokens text[] := '{}';
  v_has_price_alias boolean := false;
  v_has_hours_alias boolean := false;
  v_has_location_alias boolean := false;
  v_has_policy_alias boolean := false;
  v_tok text;
begin
  if p_purpose is null or p_purpose not in ('conversation', 'content', 'image') then
    raise exception 'INVALID_PURPOSE';
  end if;

  if auth.uid() is not null then
    if not exists (
      select 1 from public.workspace_members m
      where m.workspace_id = p_workspace_id
        and m.user_id = auth.uid()
        and m.status = 'active'
    ) then
      raise exception 'permission denied for workspace %', p_workspace_id;
    end if;
  elsif not public.learning_is_service_role() then
    raise exception 'FORBIDDEN_UNAUTHENTICATED';
  end if;

  if v_has_query then
    select array_agg(distinct lower(t)) into v_tokens
    from unnest(regexp_split_to_array(lower(v_clean_query), E'[[:space:][:punct:]]+')) as t
    where char_length(t) >= 1;

    foreach v_tok in array coalesce(v_tokens, '{}') loop
      if v_tok in ('가격', '얼마', '비용', '메뉴', '원', '단가', '금액', '할인', 'price') or v_clean_query ~ '(가격|얼마|비용|메뉴|원|단가)' then
        v_has_price_alias := true;
      end if;
      if v_tok in ('영업', '시간', '오픈', '마감', '휴무', '휴일', '요일', '주말', '몇시', '운영', 'hours') or v_clean_query ~ '(영업|시간|오픈|마감|휴무|휴일|몇시)' then
        v_has_hours_alias := true;
      end if;
      if v_tok in ('주소', '위치', '어디', '찾아', '길', '지도', '매장', '오시는', 'location') or v_clean_query ~ '(주소|위치|어디|찾아|지도|매장)' then
        v_has_location_alias := true;
      end if;
      if v_tok in ('정책', '환불', '취소', '예약', '규정', '노쇼', '이용', 'policy') or v_clean_query ~ '(정책|환불|취소|예약|규정|노쇼)' then
        v_has_policy_alias := true;
      end if;
    end loop;
  end if;

  return query
  with current_epoch as (
    select coalesce(max(e.epoch), 1::bigint) as epoch
    from public.workspace_knowledge_epochs e
    where e.workspace_id = p_workspace_id
  ),
  eligible_facts as (
    select
      f.id,
      f.category,
      f.content,
      case
        when exists (
          select 1 from public.learning_projection_dependencies d
          where d.workspace_id = f.workspace_id and d.projection_fact_id = f.id
        ) then 'channel'
        else 'manual'
      end as source_type,
      (
        select d.knowledge_source_id
        from public.learning_projection_dependencies d
        where d.workspace_id = f.workspace_id and d.projection_fact_id = f.id
        order by d.knowledge_source_id
        limit 1
      ) as source_id,
      (
        select d.required_revision
        from public.learning_projection_dependencies d
        where d.workspace_id = f.workspace_id and d.projection_fact_id = f.id
        order by d.knowledge_source_id
        limit 1
      ) as source_revision,
      ce.epoch,
      -- 모든 리프 출처/리비전을 반환해야 캐시가 어떤 리프 변경에도 무효화된다.
      (
        select coalesce(
          jsonb_agg(
            jsonb_build_object('sourceId', d.knowledge_source_id, 'revision', d.required_revision)
            order by d.knowledge_source_id
          ),
          '[]'::jsonb
        )
        from public.learning_projection_dependencies d
        where d.workspace_id = f.workspace_id and d.projection_fact_id = f.id
      ) as dependencies,
      f.created_at,
      c.source_location,
      case when not v_has_query then 1.0::double precision
           else (
             (case when position(lower(v_clean_query) in lower(f.content)) > 0 then 50.0 else 0.0 end) +
             (case when v_has_price_alias and f.category in ('price', 'offering') then 25.0 else 0.0 end) +
             (case when v_has_hours_alias and f.category = 'hours' then 25.0 else 0.0 end) +
             (case when v_has_location_alias and f.category = 'location' then 25.0 else 0.0 end) +
             (case when v_has_policy_alias and f.category = 'policy' then 25.0 else 0.0 end) +
             (
               select coalesce(sum(case when position(tok in lower(f.content)) > 0 then 10.0 else 0.0 end), 0.0)
               from unnest(v_tokens) as tok
               where char_length(tok) >= 2
             )
           )
      end as relevance_score
    from public.knowledge_facts f
    cross join current_epoch ce
    left join public.knowledge_candidates c
      on c.workspace_id = f.workspace_id and c.id = f.source_candidate_id
    left join public.knowledge_sources direct_src
      on direct_src.workspace_id = c.workspace_id and direct_src.id = c.knowledge_source_id
    where f.workspace_id = p_workspace_id
      and f.status = 'active'
      and (f.valid_until is null or f.valid_until > now())
      and (p_purpose is distinct from 'image' or f.category = 'visual')
      and (
        exists (
          select 1 from public.learning_projection_dependencies dep
          where dep.workspace_id = f.workspace_id and dep.projection_fact_id = f.id
        )
        or (
          direct_src.source_type in ('manual', 'file')
          and direct_src.is_learning_source = false
          and direct_src.deleted_at is null
        )
      )
      -- 복합 종속성 전수 검증: 삭제/일시중지/리비전불일치/동의철회/리스결여/현재OAuth계정불일치 시 제외
      and not exists (
        select 1
        from public.learning_projection_dependencies dep
        join public.knowledge_sources src
          on src.workspace_id = dep.workspace_id and src.id = dep.knowledge_source_id
        where dep.workspace_id = f.workspace_id
          and dep.projection_fact_id = f.id
          and (
            src.deleted_at is not null
            or src.status = 'paused'
            or src.learning_collection_status = 'cancelled'
            or src.learning_verification_status is distinct from 'verified'
            or src.lifecycle_revision != dep.required_revision
            or (case when p_purpose = 'image' then not src.consent_images else not src.consent_text end)
            or not exists (
              select 1 from public.learning_evidence_leases l
              where l.workspace_id = src.workspace_id
                and l.knowledge_source_id = src.id
                and l.evidence_revision = src.evidence_revision
                and l.revoked_at is null
                and l.expires_at > clock_timestamp()
                -- OAuth 계정 바인딩 및 credential 활성 검증 (SNS 출처의 경우 현재 연결된 계정과 리스의 provider_account_id 일치 필수)
                and (
                  src.channel_type not in ('instagram', 'threads')
                  or exists (
                    select 1 from public.channel_connections cc
                    where cc.workspace_id = src.workspace_id
                      and cc.channel = src.channel_type
                      and cc.status = 'connected'
                      and cc.external_account_id is not null
                      and cc.external_account_id = l.provider_account_id
                  )
                )
            )
          )
      )
  )
  select ef.id, ef.category, ef.content, ef.source_type, ef.source_id, ef.source_revision, ef.epoch, ef.dependencies, ef.created_at, ef.source_location
  from eligible_facts ef
  where (not v_has_query or ef.relevance_score > 0.0)
  order by
    case when p_purpose = 'image' then (case when ef.source_type = 'manual' then 100.0 else 50.0 end) else 0.0 end desc,
    (case when v_has_query then ef.relevance_score else 0.0 end) desc,
    ef.created_at desc
  limit greatest(1, least(coalesce(p_max_facts, 32), 200));
end;
$$;

-- 18. 만료 임박(18시간) 리스 조회 RPC - service_role 전용 (current lease 1:1 join & oldest-first 기아 방지)
drop function if exists public.list_due_learning_verifications(integer);
create or replace function public.list_due_learning_verifications(
  p_limit integer default 50
)
returns table (
  workspace_id uuid,
  source_id uuid,
  lifecycle_revision integer,
  evidence_revision integer
)
language plpgsql
security definer
set search_path = public, pg_temp
stable
as $$
begin
  perform public.learning_require_service_role();

  return query
  select
    s.workspace_id,
    s.id as source_id,
    s.lifecycle_revision,
    s.evidence_revision
  from public.knowledge_sources s
  -- 오직 현재 evidence_revision과 일치하는 current lease만 1:1 JOIN (과거 이력 lease로 인한 limit 기아 방지)
  join public.learning_evidence_leases l
    on l.workspace_id = s.workspace_id
   and l.knowledge_source_id = s.id
   and l.evidence_revision = s.evidence_revision
  where s.is_learning_source = true
    and s.deleted_at is null
    and s.status <> 'paused'
    and s.learning_verification_status is distinct from 'revoked'
    and l.revoked_at is null
    -- verified_at이 18시간 이전이거나 cron 장애 등으로 이미 만료된 경우 갱신 대상
    and (l.verified_at <= clock_timestamp() - interval '18 hours' or l.expires_at <= clock_timestamp())
    -- 현재 OAuth 관리권 활성 상태 검사 (instagram, threads: 연결 상태 및 계정 일치)
    and (
      s.channel_type not in ('instagram', 'threads')
      or exists (
        select 1 from public.channel_connections cc
        where cc.workspace_id = s.workspace_id
          and cc.channel = s.channel_type
          and cc.status = 'connected'
          and cc.external_account_id is not null
          and cc.external_account_id = l.provider_account_id
      )
    )
  order by l.verified_at asc
  limit greatest(1, least(coalesce(p_limit, 50), 200));
end;
$$;

-- 19. SQL↔consumer 필수 RPC 계약: 단일 DB snapshot에서 epoch 및 모든 종속성 검증 (F5: purpose 동의 분기 + F7: SNS external_account_id fail-closed)
drop function if exists public.validate_learning_result(uuid, bigint, jsonb);
create or replace function public.validate_learning_result(
  p_workspace_id uuid,
  p_expected_epoch bigint,
  p_dependencies jsonb,
  p_purpose text default 'content'
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
stable
as $$
declare
  v_current_epoch bigint;
  v_dep jsonb;
  v_dep_ws uuid;
  v_dep_source_id uuid;
  v_dep_rev integer;
  v_source public.knowledge_sources%rowtype;
begin
  -- 인가 검증: active 멤버이거나 strict service_role
  if auth.uid() is not null then
    if not exists (
      select 1 from public.workspace_members m
      where m.workspace_id = p_workspace_id
        and m.user_id = auth.uid()
        and m.status = 'active'
    ) then
      return false;
    end if;
  elsif not public.learning_is_service_role() then
    return false;
  end if;

  if p_workspace_id is null or p_expected_epoch is null or p_dependencies is null then
    return false;
  end if;
  if p_purpose is null or p_purpose not in ('content', 'conversation', 'image') then
    return false;
  end if;
  if jsonb_typeof(p_dependencies) <> 'array' then
    return false;
  end if;

  -- 1. Snapshot Epoch 일치 검증
  select coalesce(max(e.epoch), 1::bigint) into v_current_epoch
  from public.workspace_knowledge_epochs e
  where e.workspace_id = p_workspace_id;

  if v_current_epoch is distinct from p_expected_epoch then
    return false;
  end if;

  -- 빈 dependencies (수동 manual 지식만 있는 결과 등): valid
  if jsonb_array_length(p_dependencies) = 0 then
    return true;
  end if;

  -- 2. 모든 종속성 전수 검증
  for v_dep in select * from jsonb_array_elements(p_dependencies)
  loop
    begin
      v_dep_ws := (v_dep->>'workspaceId')::uuid;
      v_dep_source_id := (v_dep->>'sourceId')::uuid;
      v_dep_rev := (v_dep->>'revision')::integer;
    exception when others then
      return false;
    end;

    if v_dep_ws is distinct from p_workspace_id or v_dep_source_id is null or v_dep_rev is null then
      return false;
    end if;

    select * into v_source
    from public.knowledge_sources s
    where s.workspace_id = p_workspace_id
      and s.id = v_dep_source_id
      and s.is_learning_source = true
      and s.deleted_at is null
      and s.status <> 'paused'
      and s.learning_collection_status <> 'cancelled'
      and s.learning_verification_status = 'verified'
      and s.lifecycle_revision = v_dep_rev
      and (case when p_purpose = 'image' then s.consent_images = true else s.consent_text = true end);

    if not found then
      return false;
    end if;

    -- 현재 evidence lease 유효성 검증
    if not exists (
      select 1 from public.learning_evidence_leases l
      where l.workspace_id = p_workspace_id
        and l.knowledge_source_id = v_dep_source_id
        and l.evidence_revision = v_source.evidence_revision
        and l.revoked_at is null
        and l.expires_at > clock_timestamp()
    ) then
      return false;
    end if;

    -- 현재 OAuth binding 검증 (instagram/threads: 현재 연결된 계정과 리스의 provider_account_id 일치 - fail closed on null external_account_id)
    if v_source.channel_type in ('instagram', 'threads') then
      if not exists (
        select 1 from public.channel_connections cc
        join public.learning_evidence_leases l
          on l.workspace_id = v_source.workspace_id
         and l.knowledge_source_id = v_source.id
         and l.evidence_revision = v_source.evidence_revision
        where cc.workspace_id = p_workspace_id
          and cc.channel = v_source.channel_type
          and cc.status = 'connected'
          and cc.external_account_id is not null
          and cc.external_account_id = l.provider_account_id
      ) then
        return false;
      end if;
    end if;
  end loop;

  return true;
exception when others then
  return false;
end;
$$;

-- 20. 채널 연동 해제 및 계정 재바인딩 시 학습 리스/출처 원자적 동기화 트리거
create or replace function public.channel_connections_learning_disconnect_sync()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- 1) disconnected 전이, delete, 또는 external_account_id 변경(rebind)
  if TG_OP = 'DELETE'
     or (TG_OP = 'UPDATE' and new.status <> 'connected' and old.status = 'connected')
     or (TG_OP = 'UPDATE' and new.external_account_id is distinct from old.external_account_id and old.external_account_id is not null) then

    -- 이전 계정에 바인딩된 리스 즉시 철회 (F7: SNS는 external_account_id 일치 필수, null은 바인딩 없음)
    update public.learning_evidence_leases
    set revoked_at = clock_timestamp()
    where workspace_id = old.workspace_id
      and knowledge_source_id in (
        select id from public.knowledge_sources
        where workspace_id = old.workspace_id and channel_type = old.channel and is_learning_source = true
      )
      and (
        case when old.channel in ('instagram', 'threads') then
          (old.external_account_id is not null and provider_account_id = old.external_account_id)
        else
          (old.external_account_id is null or provider_account_id = old.external_account_id)
        end
      )
      and revoked_at is null;

    -- 이전 계정에 속한 출처 상태 revoked 처리 (F7: SNS는 external_account_id 일치 필수)
    update public.knowledge_sources s
    set learning_verification_status = 'revoked',
        status = 'paused',
        updated_at = clock_timestamp()
    where s.workspace_id = old.workspace_id
      and s.channel_type = old.channel
      and s.is_learning_source = true
      and (
        case when old.channel in ('instagram', 'threads') then
          (old.external_account_id is not null and exists (
            select 1 from public.learning_evidence_leases l
            where l.workspace_id = s.workspace_id and l.knowledge_source_id = s.id
              and l.evidence_revision = s.evidence_revision and l.provider_account_id = old.external_account_id
          ))
        else
          (old.external_account_id is null or exists (
            select 1 from public.learning_evidence_leases l
            where l.workspace_id = s.workspace_id and l.knowledge_source_id = s.id
              and l.evidence_revision = s.evidence_revision and l.provider_account_id = old.external_account_id
          ))
        end
      )
      and s.learning_verification_status is distinct from 'revoked';

    perform public.learning_bump_epoch(old.workspace_id);
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists channel_connections_learning_disconnect_trg on public.channel_connections;
create trigger channel_connections_learning_disconnect_trg
  after update or delete on public.channel_connections
  for each row execute function public.channel_connections_learning_disconnect_sync();

-- RPC 실행 권한: 내부 헬퍼는 누구도 직접 실행할 수 없고, 서버 증거 RPC 는 service_role 만 실행한다.
revoke all on function public.knowledge_sources_learning_guard() from public, anon, authenticated, service_role;
revoke all on function public.learning_evidence_leases_immutable() from public, anon, authenticated, service_role;
revoke all on function public.learning_documents_immutable() from public, anon, authenticated, service_role;
revoke all on function public.learning_is_service_role() from public, anon, authenticated, service_role;
revoke all on function public.learning_normalize_text(text) from public, anon, authenticated, service_role;
revoke all on function public.learning_require_service_role() from public, anon, authenticated, service_role;
revoke all on function public.learning_lock_active_source(uuid, uuid, integer) from public, anon, authenticated, service_role;
revoke all on function public.learning_require_valid_lease(public.knowledge_sources) from public, anon, authenticated, service_role;
revoke all on function public.learning_bump_epoch(uuid) from public, anon, authenticated, service_role;
revoke all on function public.learning_cancel_open_jobs(uuid, uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.check_learning_actor_authorization(uuid, uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.channel_connections_learning_disconnect_sync() from public, anon, authenticated, service_role;

revoke all on function public.update_learning_verification_lease_atomic(uuid, uuid, integer, integer, text, text, timestamptz, timestamptz, uuid) from public, anon, authenticated;
revoke all on function public.persist_learning_documents_atomic(uuid, uuid, integer, jsonb, uuid) from public, anon, authenticated;
revoke all on function public.persist_learning_candidates_atomic(uuid, uuid, integer, jsonb, uuid) from public, anon, authenticated;
revoke all on function public.create_learning_job_atomic(uuid, uuid, integer, text, text) from public, anon, authenticated;
revoke all on function public.claim_learning_job_atomic(uuid, uuid, text, integer) from public, anon, authenticated;
revoke all on function public.update_learning_job_atomic(uuid, uuid, text, text, jsonb, text, text) from public, anon, authenticated;
revoke all on function public.list_due_learning_verifications(integer) from public, anon, authenticated;
revoke all on function public.delete_learning_source_atomic(uuid, uuid, integer, uuid, text) from public, anon;
revoke all on function public.revoke_learning_source_atomic(uuid, uuid, integer, uuid) from public, anon;
revoke all on function public.review_learning_candidates_atomic(uuid, uuid, integer, integer, uuid, jsonb) from public, anon;
revoke all on function public.get_approved_learning_context(uuid, text, integer, text) from public, anon;
revoke all on function public.validate_learning_result(uuid, bigint, jsonb, text) from public, anon;

-- 서버 전용 RPC (service_role 전용)
grant execute on function public.update_learning_verification_lease_atomic(uuid, uuid, integer, integer, text, text, timestamptz, timestamptz, uuid) to service_role;
grant execute on function public.persist_learning_documents_atomic(uuid, uuid, integer, jsonb, uuid) to service_role;
grant execute on function public.persist_learning_candidates_atomic(uuid, uuid, integer, jsonb, uuid) to service_role;
grant execute on function public.create_learning_job_atomic(uuid, uuid, integer, text, text) to service_role;
grant execute on function public.claim_learning_job_atomic(uuid, uuid, text, integer) to service_role;
grant execute on function public.update_learning_job_atomic(uuid, uuid, text, text, jsonb, text, text) to service_role;
grant execute on function public.list_due_learning_verifications(integer) to service_role;

-- 사용자 인가 RPC (authenticated + service_role, 내부에서 멤버십/역할 fail-closed 검증)
grant execute on function public.delete_learning_source_atomic(uuid, uuid, integer, uuid, text) to authenticated, service_role;
grant execute on function public.revoke_learning_source_atomic(uuid, uuid, integer, uuid) to authenticated, service_role;
grant execute on function public.review_learning_candidates_atomic(uuid, uuid, integer, integer, uuid, jsonb) to authenticated, service_role;
grant execute on function public.get_approved_learning_context(uuid, text, integer, text) to authenticated, service_role;
grant execute on function public.validate_learning_result(uuid, bigint, jsonb, text) to authenticated, service_role;
