-- Disposable local database only. Minimal dependencies for the actual production Studio RPC.
create role anon;
create role authenticated;
create role service_role;
create table public.workspace_members (workspace_id uuid, user_id uuid, status text, role text);
create table public.knowledge_sources (id uuid default gen_random_uuid() primary key, workspace_id uuid, display_name text, source_type text, status text, created_by_user_id uuid, created_at timestamptz, updated_at timestamptz);
create table public.knowledge_candidates (id uuid default gen_random_uuid() primary key, workspace_id uuid, knowledge_source_id uuid, category text, content text, source_location text, confidence numeric, status text, reviewed_by_user_id uuid, reviewed_at timestamptz, created_by_user_id uuid, created_at timestamptz, updated_at timestamptz);
create table public.knowledge_facts (id uuid default gen_random_uuid() primary key, workspace_id uuid, source_candidate_id uuid, approved_by_user_id uuid, approved_at timestamptz, valid_from timestamptz not null, valid_until timestamptz, status text, category text, content text, supersedes_fact_id uuid, created_at timestamptz, check(valid_until is null or valid_until > valid_from));
create table public.sohee_studio_proposals (id uuid default gen_random_uuid() primary key, workspace_id uuid, source_message_id uuid, kind text, category text, content text, replaces_fact_id uuid, expected_fact_created_at timestamptz, status text, confirmed_target_id uuid, created_by uuid, updated_at timestamptz);
create table public.reservations (id uuid primary key, workspace_id uuid, total_amount integer);
insert into public.workspace_members values ('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','active','owner');
insert into public.sohee_studio_proposals (id, workspace_id, kind, category, content, status, created_by) values ('30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','fact','PRICE','서비스 50,000원','proposed','20000000-0000-4000-8000-000000000001');
insert into public.reservations values ('40000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',40000);
