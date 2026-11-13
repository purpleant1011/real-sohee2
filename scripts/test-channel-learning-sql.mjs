#!/usr/bin/env node
// Focused PostgreSQL 16 test: real CHECK/RLS/RPC execution, disposable Unix-socket-only cluster.
// Uses the repository's actual v07 knowledge DDL + v08 URL CHECK + new learning migration.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const bin = '/opt/homebrew/opt/postgresql@16/bin'
const root = resolve(import.meta.dirname, '..')
if (!existsSync(join(bin, 'initdb')) || process.getuid?.() === 0) throw new Error('LOCAL_POSTGRES_UNAVAILABLE')
const directory = mkdtempSync(join(tmpdir(), 'sohee-learning-sql-'))
const cluster = join(directory, 'cluster')
const env = { ...process.env, PGHOST: directory, PGPORT: '55479', PGDATABASE: 'postgres', PGUSER: process.env.USER, LC_ALL: 'C' }
delete env.PGSERVICE
delete env.PGSERVICEFILE
delete env.PGHOSTADDR
let assertions = 0
function call(command, args, input) {
  const result = spawnSync(join(bin, command), args, { env, input, encoding: 'utf8', timeout: 60_000 })
  if (result.status !== 0) throw new Error(`${command}: ${result.stderr || result.error?.message}`)
  return result.stdout.trim()
}
function sql(text) { return call('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-A', '-t'], text) }
function assert(value, message) { if (!value) throw new Error(message); assertions++ }
function denied(text, code) {
  try { sql(text) } catch (error) { assert(String(error).includes(code), `Expected ${code}, got ${error}`); return }
  throw new Error(`Expected rejected SQL: ${code}`)
}
const wsA = '10000000-0000-4000-8000-000000000001'
const wsB = '10000000-0000-4000-8000-000000000002'
const userA = '20000000-0000-4000-8000-000000000001'
const userB = '20000000-0000-4000-8000-000000000002'
const sourceA = '30000000-0000-4000-8000-000000000001'
const sourceB = '30000000-0000-4000-8000-000000000002'
const auth = (user) => `set role authenticated; set request.jwt.claim.sub='${user}'; set request.jwt.claim.role='authenticated';`
try {
  call('initdb', ['-D', cluster, '-A', 'trust', '--no-locale', '-E', 'UTF8', '--no-sync'])
  call('pg_ctl', ['-D', cluster, '-o', `-k ${directory} -h '' -p 55479 -c fsync=off`, '-l', join(directory, 'postgres.log'), '-w', 'start'])
  sql(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth;
    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
    create function auth.role() returns text language sql stable as $$ select nullif(current_setting('request.jwt.claim.role', true),'') $$;
    grant usage on schema auth, public to authenticated, anon, service_role;
    create table public.workspaces (id uuid primary key);
    create table public.workspace_members (workspace_id uuid references workspaces, user_id uuid references auth.users, role text, status text);
    create table public.media_assets (workspace_id uuid, id uuid, unique(workspace_id,id));
    create table public.channel_connections (id uuid primary key default gen_random_uuid(), workspace_id uuid references workspaces, channel text, status text default 'connected', external_account_id text, unique(workspace_id, channel));
    grant select on public.workspace_members to authenticated, service_role;
    grant select, insert, update, delete on public.channel_connections to authenticated, service_role;
  `)
  const v07 = readFileSync(join(root, 'supabase/migrations/20260810091000_v07_knowledge_harness_customer.sql'), 'utf8')
  sql(v07.slice(0, v07.indexOf('create table public.customer_conversations')))
  const v08 = readFileSync(join(root, 'supabase/migrations/20260818164702_v08_five_channel_harness_content.sql'), 'utf8')
  sql(v08.slice(v08.indexOf('alter table public.knowledge_sources\n  add constraint'), v08.indexOf('create index knowledge_sources_url_collection_state_idx')))
  sql(readFileSync(join(root, 'supabase/migrations/20261110090000_owned_channel_learning.sql'), 'utf8'))
  assertions++ // Actual SQL creation with original CHECK/FK definitions succeeded.
  sql(`insert into auth.users values ('${userA}'),('${userB}');
    insert into public.workspaces values ('${wsA}'),('${wsB}');
    insert into public.workspace_members values ('${wsA}','${userA}','manager','active'),('${wsB}','${userB}','manager','active');
    insert into public.channel_connections (workspace_id, channel, status) values ('${wsA}','instagram','connected'),('${wsB}','instagram','connected');
    insert into public.knowledge_sources (id,workspace_id,source_type,channel_type,uri,display_name,created_by_user_id,is_learning_source,consent_text,consent_images,refresh_policy)
    values ('${sourceA}','${wsA}','url','instagram','https://instagram.com/shop_a/','shop_a','${userA}',true,true,false,'{"ownership":"owned","allowedUse":"business_facts","requestedScope":"posts","collectionState":"connection_required"}'),
    ('${sourceB}','${wsB}','url','instagram','https://instagram.com/shop_b/','shop_b','${userB}',true,true,false,'{"ownership":"owned","allowedUse":"business_facts","requestedScope":"posts","collectionState":"connection_required"}');`)
  const serverOnly = sql(`select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in ('update_learning_verification_lease_atomic','persist_learning_documents_atomic','persist_learning_candidates_atomic')
    and not has_function_privilege('authenticated',p.oid,'EXECUTE') and has_function_privilege('service_role',p.oid,'EXECUTE');`)
  assert(serverOnly === '3', 'Server-proven evidence RPC must deny authenticated callers')
  denied(`${auth(userB)} select * from public.get_approved_learning_context('${wsA}','content',32);`, 'permission')
  denied(`${auth(userB)} select public.revoke_learning_source_atomic('${wsA}','${sourceA}',1,'${userB}');`, 'FORBIDDEN')
  denied(`${auth(userA)} select public.revoke_learning_source_atomic('${wsA}','${sourceA}',1,'${userB}');`, 'ACTOR_MISMATCH')
  const visible = sql(`${auth(userB)} select count(*) from public.learning_evidence_leases where workspace_id='${wsA}';`)
  assert(visible.endsWith('0'), 'Cross-tenant RLS must return no foreign lease rows')
  if (process.argv.includes('--receipts')) {
    const receiptMigration = join(root, 'supabase/migrations/20261110170000_channel_learning_receipts.sql')
    if (existsSync(receiptMigration)) sql(readFileSync(receiptMigration, 'utf8'))
    assert(sql("select to_regclass('public.learning_provider_receipts') is not null;") === 't', 'Provider execution evidence table missing')
    assert(sql("select count(*) from pg_proc p where p.proname in ('record_learning_provider_receipt','purge_learning_source_payloads','purge_expired_learning_payloads') and not has_function_privilege('authenticated',p.oid,'EXECUTE') and has_function_privilege('service_role',p.oid,'EXECUTE');") === '3', 'Provider evidence/purge must be server-only')
    const service = "set role service_role; set request.jwt.claim.role='service_role';"
    const receiptCall = `select public.record_learning_provider_receipt('${wsA}','${sourceA}',1,'provider-fixture-response','gemini-fixture','text','${'a'.repeat(64)}','[]','{\"promptTokenCount\":1,\"candidatesTokenCount\":2,\"totalTokenCount\":3}');`
    denied(`${service} ${receiptCall}`, 'SOURCE_NOT_ELIGIBLE')
    sql(`update public.knowledge_sources set learning_verification_status='verified',evidence_revision=1 where id='${sourceA}'; insert into public.learning_evidence_leases(workspace_id,knowledge_source_id,evidence_revision,provider_account_id,method,verified_at,expires_at) values('${wsA}','${sourceA}',1,'fixture-account','oauth',now(),now()+interval '23 hours');`)
    denied(`${auth(userA)} ${receiptCall}`, 'permission denied')
    const receiptId = sql(`${service} ${receiptCall}`).split('\n').at(-1)
    assert(/^[a-f0-9-]{36}$/.test(receiptId), 'Actual provider receipt must return durable id')
    denied(`${auth(userA)} select public.purge_learning_source_payloads('${wsA}','${sourceA}');`, 'permission denied')
    denied(`${service} select public.purge_learning_source_payloads('${wsA}','${sourceA}');`, 'SOURCE_NOT_DELETED')
    assert(sql(`select count(*) from public.learning_provider_receipts where workspace_id='${wsA}' and knowledge_source_id='${sourceA}';`) === '1', 'Provider receipt must be persisted')
    const documentId='50000000-0000-4000-8000-000000000001'
    const candidateId='60000000-0000-4000-8000-000000000001'
    const visionCandMismatch='60000000-0000-4000-8000-000000000009'
    const manualSource='70000000-0000-4000-8000-000000000001'
    const manualCandidate='70000000-0000-4000-8000-000000000002'
    sql(`insert into public.learning_documents(id,workspace_id,knowledge_source_id,source_revision,provider_document_id,author_account_id,url,collected_at,text_content,content_hash,images)
      values('${documentId}','${wsA}','${sourceA}',1,'fixture-post','fixture-account','https://instagram.com/p/fixture',now()-interval '8 days','fixture private text','${'b'.repeat(64)}','[{"mediaId":"fixture-image","url":"https://cdninstagram.com/fixture.png","mimeType":"image/png"}]');
      insert into public.knowledge_candidates(id,workspace_id,knowledge_source_id,source_revision,category,content,source_excerpt,status,created_by_user_id,reviewed_by_user_id,reviewed_at,evidence_document_id)
      values('${candidateId}','${wsA}','${sourceA}',1,'business','fixture private business','fixture private text','approved','${userA}','${userA}',now(),'${documentId}');
      insert into public.knowledge_facts(workspace_id,category,content,source_candidate_id,approved_by_user_id,approved_at)
      values('${wsA}','business','fixture private business','${candidateId}','${userA}',now());
      insert into public.knowledge_sources(id,workspace_id,source_type,display_name,created_by_user_id)
      values('${manualSource}','${wsA}','manual','manual source','${userA}');
      insert into public.knowledge_candidates(id,workspace_id,knowledge_source_id,category,content,status,created_by_user_id,reviewed_by_user_id,reviewed_at)
      values('${manualCandidate}','${wsA}','${manualSource}','FAQ','manual knowledge survives','approved','${userA}','${userA}',now());
      insert into public.knowledge_facts(workspace_id,category,content,source_candidate_id,approved_by_user_id,approved_at)
      values('${wsA}','FAQ','manual knowledge survives','${manualCandidate}','${userA}',now());`)
    // Revision mismatch between candidate and vision receipt must be rejected by composite FK
    denied(`insert into public.knowledge_candidates(id,workspace_id,knowledge_source_id,source_revision,category,content,status,created_by_user_id,evidence_vision_receipt_id)
      values('${visionCandMismatch}','${wsA}','${sourceA}',2,'visual','brand look','review_required','${userA}','${receiptId}');`, 'knowledge_candidate_vision_receipt_fkey')
    // 5b. F5 & F7: validate_learning_result with purpose and fail-closed null external_account_id
    sql(`update public.channel_connections set external_account_id=null where workspace_id='${wsA}' and channel='instagram';`)
    const epochA = sql(`select coalesce(max(epoch), 1) from public.workspace_knowledge_epochs where workspace_id='${wsA}';`)
    const depA = JSON.stringify([{ workspaceId: wsA, sourceId: sourceA, revision: 1 }])
    const validateCall = (purpose) => sql(`${service} select public.validate_learning_result('${wsA}',${epochA},'${depA}'::jsonb,'${purpose}');`).split('\n').at(-1)
    // F7: When external_account_id is null on instagram, validate_learning_result fails closed
    assert(validateCall('content') === 'f', 'F7: NULL external_account_id must fail closed')
    // When external_account_id matches lease provider_account_id:
    sql(`update public.channel_connections set external_account_id='fixture-account' where workspace_id='${wsA}' and channel='instagram';`)
    // F5: sourceA has consent_text=true, consent_images=false
    assert(validateCall('content') === 't', 'F5: content purpose with consent_text=true must be valid')
    assert(validateCall('image') === 'f', 'F5: image purpose with consent_images=false must fail')
    assert(validateCall('invalid') === 'f', 'F5: invalid purpose must fail closed')
    const ttl=JSON.parse(sql(`${service} select public.purge_expired_learning_payloads('${wsA}');`).split('\n').at(-1))
    assert(ttl.purgedCount===1 && ttl.failedCount===0,'TTL must purge only expired raw payloads')
    assert(sql(`select (text_content='' and images='[]'::jsonb and provider_document_id='fixture-post') from public.learning_documents where id='${documentId}';`)==='t','TTL must preserve immutable evidence manifest')
    const delJobId='80000000-0000-4000-8000-000000000001'
    sql(`insert into public.learning_jobs(id,workspace_id,knowledge_source_id,source_revision,job_kind,idempotency_key,status,attempt,lease_owner,lease_expires_at)
      values('${delJobId}','${wsA}','${sourceA}',2,'delete','fixture-delete-job','running',1,'del-worker',now()+interval '60 seconds');`)
    // Privacy guard: delete job cannot be completed before purging source payloads
    denied(`${service} select public.update_learning_job_atomic('${wsA}','${delJobId}','completed','del-worker');`, 'DELETE_JOB_INCOMPLETE')
    sql(`update public.knowledge_sources set deleted_at=now(),learning_verification_status='revoked',status='paused' where id='${sourceA}';`)
    const purge=JSON.parse(sql(`${service} select public.purge_learning_source_payloads('${wsA}','${sourceA}');`).split('\n').at(-1))
    assert(purge.purgedMedia===0 && purge.purgedCandidates===1,'Source erasure must not claim deleting external SNS images')
    assert(sql(`select count(*) from public.learning_provider_receipts where knowledge_source_id='${sourceA}';`)==='0','Source deletion must erase provider evidence payloads')
    assert(sql(`select content from public.knowledge_facts where source_candidate_id='${manualCandidate}';`)==='manual knowledge survives','Source deletion must preserve unrelated manual knowledge')
    assert(sql(`select content from public.knowledge_facts where source_candidate_id='${candidateId}';`)==='삭제된 학습 자료','Source deletion must remove derived private fact contents')
    // Idempotent second purge must return 0 counts (already purged payloads are not counted again)
    const purge2=JSON.parse(sql(`${service} select public.purge_learning_source_payloads('${wsA}','${sourceA}');`).split('\n').at(-1))
    assert(purge2.purgedDocuments===0 && purge2.purgedCandidates===0 && purge2.purgedMedia===0,'Idempotent purge must report 0 when already purged')
    // Once purged, delete job can transition to completed without false completion
    sql(`${service} select public.update_learning_job_atomic('${wsA}','${delJobId}','completed','del-worker');`)
    assert(sql(`select status from public.learning_jobs where id='${delJobId}';`)==='completed','Delete job completes once payloads are truly purged')
  }
  console.log(`PASS: ${assertions} focused real PostgreSQL assertions; original knowledge CHECK/FKs + new migration. No remote database used.`)
} finally {
  if (existsSync(join(cluster, 'postmaster.pid'))) spawnSync(join(bin, 'pg_ctl'), ['-D', cluster, '-m', 'immediate', '-w', 'stop'], { env, stdio: 'ignore' })
  rmSync(directory, { recursive: true, force: true })
}
