#!/usr/bin/env node
// Boundary RPC verification for owned-channel learning:
// F3: delete job transient failure -> queued recovery -> re-claim -> payload purge -> completed transition (no infinite terminal-failed stall)
// F5: validate_learning_result purpose-specific consent evaluation (content/conversation vs image, revoke behavior)
// F7: current OAuth account id NULL fails closed for SNS channels without compromising manual knowledge preservation
//
// Disposable PostgreSQL 16 cluster, Unix socket only, always cleaned up in finally.

import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const bin = '/opt/homebrew/opt/postgresql@16/bin'
const root = resolve(import.meta.dirname, '..')

if (!existsSync(join(bin, 'initdb')) || process.getuid?.() === 0) {
  throw new Error('LOCAL_POSTGRES_UNAVAILABLE')
}

const directory = mkdtempSync(join(tmpdir(), 'sohee-learning-boundaries-'))
const cluster = join(directory, 'cluster')
const port = String(57000 + Math.floor(Math.random() * 2000))

const env = {
  PATH: process.env.PATH,
  HOME: process.env.HOME,
  LC_ALL: 'C',
  PGHOST: directory,
  PGPORT: port,
  PGDATABASE: 'postgres',
  PGUSER: process.env.USER,
}
delete env.PGSERVICE
delete env.PGSERVICEFILE
delete env.PGHOSTADDR

function call(command, args, input) {
  const result = spawnSync(join(bin, command), args, { env, input, encoding: 'utf8', timeout: 90_000 })
  if (result.status !== 0) throw new Error(`${command}: ${result.stderr || result.error?.message}`)
  return result.stdout.trim()
}

const psqlArgs = ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '-A', '-t']
const sql = (text) => call('psql', psqlArgs, text)
const svc = (text) => `set role service_role; set request.jwt.claim.role='service_role'; ${text}`
const authAs = (userId, text) => `set role authenticated; set request.jwt.claim.sub='${userId}'; set request.jwt.claim.role='authenticated'; ${text}`
const j = (value) => `$j$${JSON.stringify(value)}$j$::jsonb`
const q = (value) => (value === null || value === undefined ? 'null' : `'${String(value).replaceAll("'", "''")}'`)

let passed = 0
const failures = []

async function check(name, fn) {
  try {
    await fn()
    passed++
    console.log(`  ✓ ${name}`)
  } catch (error) {
    const msg = String(error.message || error).split('\n')[0].slice(0, 300)
    failures.push(`${name}: ${msg}`)
    console.error(`  ✗ ${name}: ${msg}`)
  }
}

function expect(condition, message) {
  if (!condition) throw new Error(message)
}

function equal(actual, expected, message) {
  if (String(actual) !== String(expected)) {
    throw new Error(`${message}: expected [${expected}], got [${actual}]`)
  }
}

function denied(text, expectedCode) {
  let thrown = null
  try {
    sql(text)
  } catch (error) {
    thrown = String(error.message || error)
  }
  if (thrown === null) throw new Error(`Expected SQL error containing [${expectedCode}], but query succeeded`)
  if (!thrown.includes(expectedCode)) {
    throw new Error(`Expected [${expectedCode}], got [${thrown.split('\n')[0]}]`)
  }
}

console.log('--- Initializing Isolated Local PostgreSQL 16 Cluster ---')

try {
  call('initdb', ['-D', cluster, '-A', 'trust', '--no-locale', '-E', 'UTF8', '--no-sync'])
  call('pg_ctl', ['-D', cluster, '-o', `-k ${directory} -h '' -p ${port} -c fsync=off`, '-l', join(directory, 'postgres.log'), '-w', 'start'])

  // Bootstrap mock auth and core tables
  sql(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create schema auth;
    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
    create function auth.role() returns text language sql stable as $$ select nullif(current_setting('request.jwt.claim.role', true),'') $$;
    grant usage on schema auth, public to authenticated, anon, service_role;
    create table public.workspaces (id uuid primary key);
    create table public.workspace_members (workspace_id uuid references workspaces, user_id uuid references auth.users, role text, status text);
    create table public.media_assets (workspace_id uuid, id uuid, unique(workspace_id,id));
    create table public.channel_connections (
      id uuid primary key default gen_random_uuid(),
      workspace_id uuid references workspaces,
      channel text,
      status text default 'connected',
      external_account_id text,
      unique(workspace_id, channel)
    );
    grant select on public.workspace_members to authenticated, service_role;
    grant select, insert, update, delete on public.channel_connections to authenticated, service_role;
  `)

  // v07 & v08 schemas
  const v07 = readFileSync(join(root, 'supabase/migrations/20260810091000_v07_knowledge_harness_customer.sql'), 'utf8')
  sql(v07.slice(0, v07.indexOf('create table public.customer_conversations')))

  const v08 = readFileSync(join(root, 'supabase/migrations/20260818164702_v08_five_channel_harness_content.sql'), 'utf8')
  sql(v08.slice(v08.indexOf('alter table public.knowledge_sources\n  add constraint'), v08.indexOf('create index knowledge_sources_url_collection_state_idx')))
  sql(`grant select, insert on public.knowledge_sources to authenticated; grant select on public.knowledge_candidates, public.knowledge_facts to authenticated;`)

  // Learning core migration
  const learningSql = readFileSync(join(root, 'supabase/migrations/20261110090000_owned_channel_learning.sql'), 'utf8')
  sql(learningSql)

  // Learning receipts and retention purge migration
  const receiptsSqlPath = join(root, 'supabase/migrations/20261110170000_channel_learning_receipts.sql')
  if (existsSync(receiptsSqlPath)) {
    sql(readFileSync(receiptsSqlPath, 'utf8'))
  }

  // =========================================================================
  // F3 Verification: Delete job transient failure -> queued recovery ->
  //                  re-claim -> payload purge -> completed transition
  // =========================================================================
  console.log('\n--- Running F3: Delete Job Transient Failure & Queued Recovery ---')

  const wsF3 = randomUUID()
  const userF3 = randomUUID()
  const srcF3 = randomUUID()
  const docF3 = randomUUID()
  const candF3 = randomUUID()
  const actF3 = 'act_instagram_f3'

  sql(`
    insert into auth.users (id) values ('${userF3}');
    insert into public.workspaces (id) values ('${wsF3}');
    insert into public.workspace_members (workspace_id, user_id, role, status) values ('${wsF3}', '${userF3}', 'manager', 'active');
    insert into public.channel_connections (workspace_id, channel, status, external_account_id) values ('${wsF3}', 'instagram', 'connected', '${actF3}');
    insert into public.knowledge_sources (
      id, workspace_id, source_type, channel_type, uri, display_name, created_by_user_id,
      is_learning_source, consent_text, consent_images, refresh_policy
    ) values (
      '${srcF3}', '${wsF3}', 'url', 'instagram', 'https://instagram.com/shop_f3/', 'shop_f3', '${userF3}',
      true, true, true,
      '{"ownership":"owned","allowedUse":"business_facts","requestedScope":"posts","collectionState":"connection_required"}'
    );
  `)

  // Establish valid lease and documents/candidates
  sql(svc(`select public.update_learning_verification_lease_atomic('${wsF3}', '${srcF3}', 1, 1, '${actF3}', 'oauth', now(), now() + interval '12 hours', '${userF3}');`))
  sql(svc(`select public.persist_learning_documents_atomic('${wsF3}', '${srcF3}', 1, ${j([
    {
      id: docF3,
      source: { workspaceId: wsF3, sourceId: srcF3, revision: 1 },
      providerDocumentId: 'p_f3_1',
      authorAccountId: actF3,
      url: 'https://instagram.com/p/f3_1/',
      publishedAt: null,
      collectedAt: new Date().toISOString(),
      text: 'Business hours Monday to Friday 10am to 8pm',
      contentHash: 'hash_f3_doc',
      images: [{ mediaId: 'img_f3_1', url: 'https://instagram.com/img1.png', mimeType: 'image/png' }],
    }
  ])}, '${userF3}');`))

  sql(svc(`select public.persist_learning_candidates_atomic('${wsF3}', '${srcF3}', 1, ${j([
    {
      id: candF3,
      source: { workspaceId: wsF3, sourceId: srcF3, revision: 1 },
      version: 1,
      category: 'hours',
      content: 'Business hours Monday to Friday 10am to 8pm',
      evidence: { documentId: docF3, excerpt: 'Business hours Monday to Friday 10am to 8pm' },
      evidenceState: 'observed',
      status: 'review_required',
    }
  ])}, '${userF3}');`))

  // Approve candidate to project a fact
  sql(authAs(userF3, `select public.review_learning_candidates_atomic('${wsF3}', '${srcF3}', 1, 1, '${userF3}', ${j([
    { candidateId: candF3, version: 1, decision: 'approved' }
  ])});`))

  // Record a provider receipt
  sql(svc(`select public.record_learning_provider_receipt(
    '${wsF3}', '${srcF3}', 1, 'resp_f3', 'gemini-fixture', 'text',
    '${'c'.repeat(64)}', '[]'::jsonb,
    '{"promptTokenCount":10,"candidatesTokenCount":20,"totalTokenCount":30}'::jsonb
  );`))

  // 1) Trigger source deletion via atomic RPC -> produces delete job with status 'queued'
  const delJobRow = sql(authAs(userF3, `select deletion_job_id, new_revision from public.delete_learning_source_atomic('${wsF3}', '${srcF3}', 1, '${userF3}', 'idemp-del-f3');`))
  const [delJobId, newRevF3] = delJobRow.split('|')

  await check('F3: atomic source delete produces queued delete job at bumped revision', () => {
    expect(delJobId && /^[a-f0-9-]{36}$/.test(delJobId), 'Valid delete job UUID returned')
    equal(newRevF3, '2', 'Source revision bumped to 2')
    const jobStatus = sql(`select status from public.learning_jobs where workspace_id='${wsF3}' and id='${delJobId}';`)
    equal(jobStatus, 'queued', 'Delete job starts in queued status')
  })

  // 2) Worker 1 claims delete job
  await check('F3: worker 1 claims delete job -> status transitions to running', () => {
    const claimed = sql(svc(`select id, attempt, lease_owner, status from public.claim_learning_job_atomic('${wsF3}', '${delJobId}', 'worker-f3-one', 120);`))
    expect(claimed.includes(delJobId), 'Claimed job id matches')
    expect(claimed.includes('worker-f3-one'), 'Lease owner set to worker-f3-one')
    expect(claimed.includes('running'), 'Job status is running')
  })

  // 3) Worker 1 encounters transient failure, transitions back to 'queued' with checkpoint & transient error
  await check('F3: worker 1 transient failure returns job to queued (not terminal failed stall)', () => {
    sql(svc(`select public.update_learning_job_atomic(
      '${wsF3}', '${delJobId}', 'queued', 'worker-f3-one',
      '{"retry":1,"stage":"payload_purge"}'::jsonb,
      'TRANSIENT_NETWORK_TIMEOUT', 'Temporary RPC gateway unreachable'
    );`))

    const row = sql(`select status, lease_owner, lease_expires_at, checkpoint->>'retry' from public.learning_jobs where workspace_id='${wsF3}' and id='${delJobId}';`)
    const [st, owner, expires, retry] = row.split('|')
    equal(st, 'queued', 'Job status safely restored to queued')
    equal(owner, '', 'Lease owner cleared on queued return')
    equal(expires, '', 'Lease expiry cleared on queued return')
    equal(retry, '1', 'Checkpoint preserved across transient recovery')
  })

  // 4) Worker 2 re-claims the job (attempt incremented, lease acquired)
  await check('F3: worker 2 re-claims queued job -> attempt increments to 2', () => {
    const claimed = sql(svc(`select id, attempt, lease_owner, status from public.claim_learning_job_atomic('${wsF3}', '${delJobId}', 'worker-f3-two', 120);`))
    expect(claimed.includes(delJobId), 'Worker 2 claimed the job')
    expect(claimed.includes('worker-f3-two'), 'Worker 2 is lease owner')
    expect(claimed.includes('|2|'), 'Attempt count incremented to 2')
  })

  // 5) Privacy guard prevents false completion before actual purge
  await check('F3: completing delete job before payload purge is rejected with DELETE_JOB_INCOMPLETE', () => {
    denied(
      svc(`select public.update_learning_job_atomic('${wsF3}', '${delJobId}', 'completed', 'worker-f3-two');`),
      'DELETE_JOB_INCOMPLETE'
    )
  })

  // 6) Actual payload purge executes
  await check('F3: purge_learning_source_payloads erases documents, receipts, facts', () => {
    const purgeResult = JSON.parse(sql(svc(`select public.purge_learning_source_payloads('${wsF3}', '${srcF3}');`)))
    expect(purgeResult.purgedDocuments >= 1, 'Documents purged')
    expect(purgeResult.purgedCandidates >= 1, 'Candidates purged')

    // Document text & images empty
    const docClean = sql(`select (text_content = '' and images = '[]'::jsonb) from public.learning_documents where id='${docF3}';`)
    equal(docClean, 't', 'Raw text and images blanked')

    // Receipts deleted
    const receiptCount = sql(`select count(*) from public.learning_provider_receipts where knowledge_source_id='${srcF3}';`)
    equal(receiptCount, '0', 'Provider execution evidence erased')

    // Fact text masked
    const factText = sql(`select content from public.knowledge_facts where workspace_id='${wsF3}' and source_candidate_id='${candF3}';`)
    equal(factText, '삭제된 학습 자료', 'Derived fact masked')
  })

  // 7) Once truly purged, delete job transitions to completed
  await check('F3: post-purge completed transition succeeds without false completion', () => {
    sql(svc(`select public.update_learning_job_atomic('${wsF3}', '${delJobId}', 'completed', 'worker-f3-two');`))
    const status = sql(`select status from public.learning_jobs where workspace_id='${wsF3}' and id='${delJobId}';`)
    equal(status, 'completed', 'Delete job marked completed successfully')
  })


  // =========================================================================
  // F5 Verification: validate_learning_result purpose-specific consent evaluation
  // =========================================================================
  console.log('\n--- Running F5: validate_learning_result Purpose & Consent Boundary ---')

  const wsF5 = randomUUID()
  const userF5 = randomUUID()
  const srcF5 = randomUUID()
  const actF5 = 'act_instagram_f5'

  sql(`
    insert into auth.users (id) values ('${userF5}');
    insert into public.workspaces (id) values ('${wsF5}');
    insert into public.workspace_members (workspace_id, user_id, role, status) values ('${wsF5}', '${userF5}', 'manager', 'active');
    insert into public.channel_connections (workspace_id, channel, status, external_account_id) values ('${wsF5}', 'instagram', 'connected', '${actF5}');
    insert into public.knowledge_sources (
      id, workspace_id, source_type, channel_type, uri, display_name, created_by_user_id,
      is_learning_source, consent_text, consent_images, refresh_policy
    ) values (
      '${srcF5}', '${wsF5}', 'url', 'instagram', 'https://instagram.com/shop_f5/', 'shop_f5', '${userF5}',
      true, true, false,
      '{"ownership":"owned","allowedUse":"business_facts","requestedScope":"posts","collectionState":"connection_required"}'
    );
  `)

  sql(svc(`select public.update_learning_verification_lease_atomic('${wsF5}', '${srcF5}', 1, 1, '${actF5}', 'oauth', now(), now() + interval '12 hours', '${userF5}');`))

  const epochF5 = sql(`select coalesce(max(epoch), 1::bigint) from public.workspace_knowledge_epochs where workspace_id='${wsF5}';`)
  const depsF5 = JSON.stringify([{ workspaceId: wsF5, sourceId: srcF5, revision: 1 }])
  const validateF5 = (purpose) => sql(svc(`select public.validate_learning_result('${wsF5}', ${epochF5}, '${depsF5}'::jsonb, '${purpose}');`))

  await check('F5: consent_text=true, consent_images=false -> content purpose valid (t)', () => {
    equal(validateF5('content'), 't', 'content purpose passes with consent_text=true')
  })

  await check('F5: consent_text=true, consent_images=false -> conversation purpose valid (t)', () => {
    equal(validateF5('conversation'), 't', 'conversation purpose passes with consent_text=true')
  })

  await check('F5: consent_text=true, consent_images=false -> image purpose invalid (f)', () => {
    equal(validateF5('image'), 'f', 'image purpose fails when consent_images=false')
  })

  await check('F5: consent_text revoked (false, false) -> content purpose invalid (f)', () => {
    sql(`update public.knowledge_sources set consent_text=false where id='${srcF5}';`)
    equal(validateF5('content'), 'f', 'content purpose fails immediately upon consent_text revocation')
    equal(validateF5('conversation'), 'f', 'conversation purpose fails immediately upon consent_text revocation')
  })

  await check('F5: consent_images=true, consent_text=false -> image purpose valid (t), content invalid (f)', () => {
    sql(`update public.knowledge_sources set consent_text=false, consent_images=true where id='${srcF5}';`)
    equal(validateF5('image'), 't', 'image purpose passes when consent_images=true')
    equal(validateF5('content'), 'f', 'content purpose remains invalid when consent_text=false')
  })

  await check('F5: unsupported purpose fails closed (f)', () => {
    equal(validateF5('unsupported_purpose'), 'f', 'invalid purpose string fails closed')
  })


  // =========================================================================
  // F7 Verification: current OAuth account id NULL fails closed for SNS
  //                  without compromising manual knowledge preservation
  // =========================================================================
  console.log('\n--- Running F7: NULL OAuth Account Fail-Closed & Manual Knowledge Preservation ---')

  const wsF7 = randomUUID()
  const userF7 = randomUUID()
  const srcF7Sns = randomUUID()
  const srcF7Manual = randomUUID()
  const docF7 = randomUUID()
  const candF7Sns = randomUUID()
  const candF7Manual = randomUUID()
  const actF7 = 'act_instagram_f7'

  sql(`
    insert into auth.users (id) values ('${userF7}');
    insert into public.workspaces (id) values ('${wsF7}');
    insert into public.workspace_members (workspace_id, user_id, role, status) values ('${wsF7}', '${userF7}', 'manager', 'active');
    insert into public.channel_connections (workspace_id, channel, status, external_account_id) values ('${wsF7}', 'instagram', 'connected', '${actF7}');

    -- SNS Learning source
    insert into public.knowledge_sources (
      id, workspace_id, source_type, channel_type, uri, display_name, created_by_user_id,
      is_learning_source, consent_text, consent_images, refresh_policy
    ) values (
      '${srcF7Sns}', '${wsF7}', 'url', 'instagram', 'https://instagram.com/shop_f7/', 'shop_f7_sns', '${userF7}',
      true, true, false,
      '{"ownership":"owned","allowedUse":"business_facts","requestedScope":"posts","collectionState":"connection_required"}'
    );

    -- Manual non-learning source
    insert into public.knowledge_sources (
      id, workspace_id, source_type, display_name, created_by_user_id, is_learning_source
    ) values (
      '${srcF7Manual}', '${wsF7}', 'manual', 'Manual Shop Profile', '${userF7}', false
    );
  `)

  // SNS lease and document
  sql(svc(`select public.update_learning_verification_lease_atomic('${wsF7}', '${srcF7Sns}', 1, 1, '${actF7}', 'oauth', now(), now() + interval '12 hours', '${userF7}');`))
  sql(svc(`select public.persist_learning_documents_atomic('${wsF7}', '${srcF7Sns}', 1, ${j([
    {
      id: docF7,
      source: { workspaceId: wsF7, sourceId: srcF7Sns, revision: 1 },
      providerDocumentId: 'p_f7_1',
      authorAccountId: actF7,
      url: 'https://instagram.com/p/f7_1/',
      publishedAt: null,
      collectedAt: new Date().toISOString(),
      text: 'SNS learned fact content',
      contentHash: 'hash_f7_doc',
      images: [],
    }
  ])}, '${userF7}');`))

  // SNS candidate & approved fact
  sql(svc(`select public.persist_learning_candidates_atomic('${wsF7}', '${srcF7Sns}', 1, ${j([
    {
      id: candF7Sns,
      source: { workspaceId: wsF7, sourceId: srcF7Sns, revision: 1 },
      version: 1,
      category: 'business',
      content: 'SNS learned fact content',
      evidence: { documentId: docF7, excerpt: 'SNS learned fact content' },
      evidenceState: 'observed',
      status: 'review_required',
    }
  ])}, '${userF7}');`))

  sql(authAs(userF7, `select public.review_learning_candidates_atomic('${wsF7}', '${srcF7Sns}', 1, 1, '${userF7}', ${j([
    { candidateId: candF7Sns, version: 1, decision: 'approved' }
  ])});`))

  // Manual candidate & approved fact
  sql(`
    insert into public.knowledge_candidates (id, workspace_id, knowledge_source_id, category, content, status, created_by_user_id, reviewed_by_user_id, reviewed_at)
    values ('${candF7Manual}', '${wsF7}', '${srcF7Manual}', 'policy', 'Precious handcrafted refund policy', 'approved', '${userF7}', '${userF7}', now());
    insert into public.knowledge_facts (workspace_id, category, content, source_candidate_id, approved_by_user_id, approved_at)
    values ('${wsF7}', 'policy', 'Precious handcrafted refund policy', '${candF7Manual}', '${userF7}', now());
  `)

  // Initial state: both SNS fact and manual fact are visible
  const initialContext = sql(authAs(userF7, `select category, content, source_type from public.get_approved_learning_context('${wsF7}', 'content', 10);`))
  await check('F7: initially both channel knowledge and manual knowledge are returned', () => {
    expect(initialContext.includes('SNS learned fact content'), 'Channel knowledge present')
    expect(initialContext.includes('Precious handcrafted refund policy'), 'Manual knowledge present')
  })

  const epochF7 = sql(`select coalesce(max(epoch), 1::bigint) from public.workspace_knowledge_epochs where workspace_id='${wsF7}';`)
  const depsF7Sns = JSON.stringify([{ workspaceId: wsF7, sourceId: srcF7Sns, revision: 1 }])
  const depsF7Manual = JSON.stringify([])

  await check('F7: initial validate_learning_result succeeds for connected SNS', () => {
    const valid = sql(svc(`select public.validate_learning_result('${wsF7}', ${epochF7}, '${depsF7Sns}'::jsonb, 'content');`))
    equal(valid, 't', 'Valid when external_account_id matches lease')
  })

  // Disable disconnect trigger temporarily to test the exact SQL query-level boundary of NULL external_account_id:
  // even if lease was not yet marked revoked, a NULL current external_account_id must NEVER pass as a match.
  sql(`alter table public.channel_connections disable trigger channel_connections_learning_disconnect_trg;`)
  sql(`update public.channel_connections set external_account_id = null where workspace_id='${wsF7}' and channel='instagram';`)
  sql(`alter table public.channel_connections enable trigger channel_connections_learning_disconnect_trg;`)

  await check('F7: current OAuth account id NULL causes validate_learning_result to fail-closed (f)', () => {
    const valid = sql(svc(`select public.validate_learning_result('${wsF7}', ${epochF7}, '${depsF7Sns}'::jsonb, 'content');`))
    equal(valid, 'f', 'NULL external_account_id does NOT pass as matching lease provider_account_id')
  })

  await check('F7: empty dependencies (pure manual knowledge) remains valid (t) even with NULL OAuth account', () => {
    const valid = sql(svc(`select public.validate_learning_result('${wsF7}', ${epochF7}, '${depsF7Manual}'::jsonb, 'content');`))
    equal(valid, 't', 'Pure manual knowledge validation succeeds independent of SNS connection state')
  })

  await check('F7: get_approved_learning_context filters out SNS channel fact while preserving manual knowledge', () => {
    const context = sql(authAs(userF7, `select category, content, source_type from public.get_approved_learning_context('${wsF7}', 'content', 10);`))
    expect(!context.includes('SNS learned fact content'), 'SNS channel knowledge excluded when external_account_id is NULL')
    expect(context.includes('Precious handcrafted refund policy'), 'Manual knowledge survives and remains accessible')
    expect(context.includes('manual'), 'Source type is manual')
  })

  await check('F7: restoring matching external_account_id re-enables channel knowledge', () => {
    sql(`update public.channel_connections set external_account_id='${actF7}' where workspace_id='${wsF7}' and channel='instagram';`)
    const context = sql(authAs(userF7, `select category, content, source_type from public.get_approved_learning_context('${wsF7}', 'content', 10);`))
    expect(context.includes('SNS learned fact content'), 'Channel knowledge restored')
    expect(context.includes('Precious handcrafted refund policy'), 'Manual knowledge still intact')
  })

  await check('F7: get_approved_learning_context returns created_at and candidate source_location', () => {
    const context = sql(authAs(userF7, `select content, (created_at is not null)::text, coalesce(source_location, 'NULL') from public.get_approved_learning_context('${wsF7}', 'content', 10);`))
    expect(context.includes('SNS learned fact content|true|NULL'), 'SNS fact has valid created_at and null source_location')
    expect(context.includes('Precious handcrafted refund policy|true|NULL'), 'Manual fact has valid created_at')
  })

  console.log(`\n========================================`)
  console.log(`RESULTS: ${passed} passed, ${failures.length} failed`)
  console.log(`========================================`)

  if (failures.length > 0) {
    for (const f of failures) console.error(`FAIL: ${f}`)
    process.exit(1)
  }
} finally {
  console.log('--- Cleaning up Disposable Cluster ---')
  if (existsSync(join(cluster, 'postmaster.pid'))) {
    spawnSync(join(bin, 'pg_ctl'), ['-D', cluster, '-m', 'immediate', '-w', 'stop'], { env, stdio: 'ignore' })
  }
  rmSync(directory, { recursive: true, force: true })
}
