#!/usr/bin/env node
// Real-RPC behavior test for the owned-channel learning migration.
// Disposable PostgreSQL 16 cluster, Unix socket only (no TCP, no remote env vars), always cleaned up.
// Bootstraps: stub auth/roles + repository's real v07 knowledge DDL + v08 URL CHECK + the learning migration.
// Every assertion executes the real SQL RPCs/triggers/constraints. No mocks.
//
// LEARNING_MIGRATION_PATH may point at a mutated copy (mutation check: a guard removed => this script must FAIL).
import { spawn, spawnSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const bin = '/opt/homebrew/opt/postgresql@16/bin'
const root = resolve(import.meta.dirname, '..')
if (!existsSync(join(bin, 'initdb')) || process.getuid?.() === 0) throw new Error('LOCAL_POSTGRES_UNAVAILABLE')
const migrationPath = process.env.LEARNING_MIGRATION_PATH || join(root, 'supabase/migrations/20261110090000_owned_channel_learning.sql')
const directory = mkdtempSync(join(tmpdir(), 'sohee-learning-atomic-'))
const cluster = join(directory, 'cluster')
const port = String(56000 + Math.floor(Math.random() * 3000))
const env = {
  PATH: process.env.PATH, HOME: process.env.HOME, LC_ALL: 'C',
  PGHOST: directory, PGPORT: port, PGDATABASE: 'postgres', PGUSER: process.env.USER,
}

function call(command, args, input) {
  const result = spawnSync(join(bin, command), args, { env, input, encoding: 'utf8', timeout: 90_000 })
  if (result.status !== 0) throw new Error(`${command}: ${result.stderr || result.error?.message}`)
  return result.stdout.trim()
}
const psqlArgs = ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '-A', '-t']
const sql = (text) => call('psql', psqlArgs, text)
const svc = (text) => `set role service_role; set request.jwt.claim.role='service_role'; ${text}`
const authAs = (user, text) => `set role authenticated; set request.jwt.claim.sub='${user}'; set request.jwt.claim.role='authenticated'; ${text}`
const j = (value) => `$j$${JSON.stringify(value)}$j$::jsonb`
const q = (value) => (value === null || value === undefined ? 'null' : `'${String(value).replaceAll("'", "''")}'`)

let passed = 0
const failures = []
async function check(name, fn) {
  try { await fn(); passed++ } catch (error) { failures.push(`${name}: ${String(error.message || error).split('\n')[0].slice(0, 300)}`) }
}
function expect(value, message) { if (!value) throw new Error(message) }
function equal(actual, expected, message) { if (String(actual) !== String(expected)) throw new Error(`${message}: expected ${expected}, got ${actual}`) }
function denied(text, code) {
  let thrown = null
  try { sql(text) } catch (error) { thrown = String(error.message || error) }
  if (thrown === null) throw new Error(`Expected rejection with ${code}, but SQL succeeded`)
  if (!thrown.includes(code)) throw new Error(`Expected ${code}, got ${thrown.split('\n')[0]}`)
}

const ws = { A: randomUUID(), B: randomUUID() }
const user = { mgrA: randomUUID(), ownerA: randomUUID(), viewerA: randomUUID(), removedA: randomUUID(), mgrB: randomUUID() }

function insertLearningSource({ workspace = ws.A, creator = user.mgrA, text = true, images = false, id = randomUUID(), url } = {}) {
  sql(`insert into public.knowledge_sources (id, workspace_id, source_type, channel_type, uri, display_name, created_by_user_id,
      is_learning_source, consent_text, consent_images, refresh_policy)
    values ('${id}', '${workspace}', 'url', 'instagram', ${q(url ?? `https://instagram.com/${id}/`)}, 'shop', '${creator}', true, ${text}, ${images},
      '{"ownership":"owned","allowedUse":"business_facts","requestedScope":"posts","collectionState":"connection_required"}');`)
  return id
}
function verify(sourceId, { workspace = ws.A, revision = 1, evidenceRevision = 1, account = 'act_1', expires = `now() + interval '1 hour'` } = {}) {
  sql(svc(`select public.update_learning_verification_lease_atomic('${workspace}','${sourceId}',${revision},${evidenceRevision},${q(account)},'oauth',now(),${expires});`))
}
const stableDocId = (workspace, sourceId, revision, provider, hash) => {
  const h = createHash('md5').update(`${workspace}|${sourceId}|${revision}|${provider}|${hash}`).digest('hex')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`
}
function doc(sourceId, { workspace = ws.A, revision = 1, provider = 'post_1', hash = 'h1', text = 'Mon-Fri   10:00 - 20:00 reservation only salon.', author = 'act_1', images = [], id } = {}) {
  return {
    id: id ?? stableDocId(workspace, sourceId, revision, provider, hash),
    source: { workspaceId: workspace, sourceId, revision },
    providerDocumentId: provider, authorAccountId: author, url: `https://instagram.com/p/${provider}/`,
    publishedAt: null, collectedAt: new Date().toISOString(), text, contentHash: hash, images,
  }
}
const persistDocs = (sourceId, docs, { workspace = ws.A, revision = 1, actor = user.mgrA } = {}) =>
  svc(`select public.persist_learning_documents_atomic('${workspace}','${sourceId}',${revision},${j(docs)},${q(actor)});`)
function cand(sourceId, documentId, { workspace = ws.A, revision = 1, id = randomUUID(), category = 'hours', content = 'Mon-Fri 10:00 - 20:00', excerpt = 'Mon-Fri 10:00 - 20:00 reservation', receipt = null, state = 'observed', conflict = null } = {}) {
  return {
    id, source: { workspaceId: workspace, sourceId, revision }, version: 1, category, content,
    evidence: { documentId, excerpt, visionReceiptId: receipt }, evidenceState: state, status: 'review_required', conflictsWithFactId: conflict,
  }
}
const persistCands = (sourceId, cands, { workspace = ws.A, revision = 1, actor = user.mgrA } = {}) =>
  svc(`select public.persist_learning_candidates_atomic('${workspace}','${sourceId}',${revision},${j(cands)},${q(actor)});`)
const count = (table, where) => Number(sql(`select count(*) from public.${table} where ${where};`))

try {
  call('initdb', ['-D', cluster, '-A', 'trust', '--no-locale', '-E', 'UTF8', '--no-sync'])
  call('pg_ctl', ['-D', cluster, '-o', `-k ${directory} -h '' -p ${port} -c fsync=off`, '-l', join(directory, 'postgres.log'), '-w', 'start'])
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
  sql(`grant select, insert on public.knowledge_sources to authenticated; grant select on public.knowledge_candidates, public.knowledge_facts to authenticated;`)
  sql(readFileSync(migrationPath, 'utf8'))
  sql(`insert into auth.users values ${Object.values(user).map((id) => `('${id}')`).join(',')};
    insert into public.workspaces values ('${ws.A}'),('${ws.B}');
    insert into public.workspace_members values
      ('${ws.A}','${user.mgrA}','manager','active'),('${ws.A}','${user.ownerA}','owner','active'),
      ('${ws.A}','${user.viewerA}','member','active'),('${ws.A}','${user.removedA}','manager','removed'),
      ('${ws.B}','${user.mgrB}','manager','active');
    insert into public.channel_connections (workspace_id, channel, status, external_account_id) values
      ('${ws.A}','instagram','connected','act_1'),('${ws.B}','instagram','connected','act_1');`)

  // ---------- 6) schema isolation of legacy collector ----------
  await check('schema: learning source with legacy collectionState=partial is rejected by CHECK', () => denied(
    `insert into public.knowledge_sources (workspace_id, source_type, channel_type, uri, display_name, created_by_user_id, is_learning_source, refresh_policy)
     values ('${ws.A}','url','instagram','https://instagram.com/x/','x','${user.mgrA}',true,'{"ownership":"owned","allowedUse":"business_facts","requestedScope":"posts","collectionState":"partial"}');`,
    'knowledge_sources_learning_isolation_check'))
  await check('schema: legacy row cannot carry learning status columns', () => denied(
    `insert into public.knowledge_sources (workspace_id, source_type, uri, display_name, created_by_user_id, learning_verification_status, refresh_policy)
     values ('${ws.A}','url','https://example.com/','x','${user.mgrA}','verified','{"ownership":"owned","allowedUse":"business_facts","requestedScope":"posts","collectionState":"partial"}');`,
    'knowledge_sources_legacy_learning_columns_check'))
  await check('schema: authenticated user cannot insert a learning source directly', () => denied(
    authAs(user.mgrA, `insert into public.knowledge_sources (workspace_id, source_type, channel_type, uri, display_name, created_by_user_id, is_learning_source, refresh_policy)
     values ('${ws.A}','url','instagram','https://instagram.com/y/','y','${user.mgrA}',true,'{"ownership":"owned","allowedUse":"business_facts","requestedScope":"posts","collectionState":"connection_required"}');`),
    'LEARNING_SOURCE_SERVER_ONLY'))
  await check('schema: learning source defaults pending/queued and flag is immutable', () => {
    const id = insertLearningSource()
    equal(sql(`select learning_verification_status||'/'||learning_collection_status from public.knowledge_sources where id='${id}';`), 'pending/queued', 'defaults')
    denied(`update public.knowledge_sources set is_learning_source=false where id='${id}';`, 'LEARNING_SOURCE_FLAG_IMMUTABLE')
  })
  await check('privilege: authenticated cannot write learning tables or run server-only RPCs', () => {
    denied(authAs(user.mgrA, `insert into public.learning_jobs (workspace_id,knowledge_source_id,source_revision,job_kind,idempotency_key) values ('${ws.A}','${randomUUID()}',1,'collect','k');`), 'permission denied')
    const serverOnly = sql(`select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname in ('update_learning_verification_lease_atomic','persist_learning_documents_atomic','persist_learning_candidates_atomic','create_learning_job_atomic','claim_learning_job_atomic','update_learning_job_atomic')
      and not has_function_privilege('authenticated',p.oid,'EXECUTE') and not has_function_privilege('anon',p.oid,'EXECUTE') and has_function_privilege('service_role',p.oid,'EXECUTE');`)
    equal(serverOnly, 6, 'server-only RPC count')
  })

  // ---------- 1) auth helper ----------
  const authSrc = insertLearningSource()
  await check('auth: server-only RPC with no JWT role (NULL) is rejected, not silently allowed', () =>
    denied(`select public.persist_learning_documents_atomic('${ws.A}','${authSrc}',1,'[]'::jsonb,'${user.mgrA}');`, 'FORBIDDEN_SERVER_ONLY'))
  await check('auth: user RPC with no JWT role (NULL) is rejected', () =>
    denied(`select public.revoke_learning_source_atomic('${ws.A}','${authSrc}',1,'${user.mgrA}');`, 'FORBIDDEN_UNAUTHENTICATED'))
  await check('auth: service_role + actor from another tenant is rejected', () =>
    denied(svc(`select public.revoke_learning_source_atomic('${ws.A}','${authSrc}',1,'${user.mgrB}');`), 'FORBIDDEN_WORKSPACE_MEMBER'))
  await check('auth: service_role + viewer/removed/NULL actor rejected for delete', () => {
    denied(svc(`select * from public.delete_learning_source_atomic('${ws.A}','${authSrc}',1,'${user.viewerA}','k1');`), 'FORBIDDEN_WORKSPACE_MEMBER')
    denied(svc(`select * from public.delete_learning_source_atomic('${ws.A}','${authSrc}',1,'${user.removedA}','k1');`), 'FORBIDDEN_WORKSPACE_MEMBER')
    denied(svc(`select * from public.delete_learning_source_atomic('${ws.A}','${authSrc}',1,null,'k1');`), 'ACTOR_REQUIRED')
  })
  await check('auth: authenticated actor spoof / outsider / viewer rejected', () => {
    denied(authAs(user.mgrA, `select public.revoke_learning_source_atomic('${ws.A}','${authSrc}',1,'${user.ownerA}');`), 'ACTOR_MISMATCH')
    denied(authAs(user.mgrB, `select public.revoke_learning_source_atomic('${ws.A}','${authSrc}',1,'${user.mgrB}');`), 'FORBIDDEN_WORKSPACE_MEMBER')
    denied(authAs(user.viewerA, `select public.revoke_learning_source_atomic('${ws.A}','${authSrc}',1,'${user.viewerA}');`), 'FORBIDDEN_WORKSPACE_MEMBER')
  })
  await check('auth: authenticated cannot execute server evidence RPCs', () =>
    denied(authAs(user.mgrA, `select public.persist_learning_documents_atomic('${ws.A}','${authSrc}',1,'[]'::jsonb,'${user.mgrA}');`), 'permission denied'))
  await check('auth: evidence write with non-member actor is rejected even through service_role', () => {
    verify(authSrc)
    denied(persistDocs(authSrc, [doc(authSrc)], { actor: user.mgrB }), 'FORBIDDEN_WORKSPACE_MEMBER')
    denied(persistDocs(authSrc, [doc(authSrc)], { actor: user.viewerA }), 'FORBIDDEN_WORKSPACE_MEMBER')
  })

  // ---------- 2) documents ----------
  const S = insertLearningSource()
  await check('docs: unverified source cannot persist documents', () => denied(persistDocs(S, [doc(S)]), 'SOURCE_NOT_VERIFIED'))
  verify(S)
  const D1 = doc(S)
  await check('docs: persist stores one immutable version', () => {
    sql(persistDocs(S, [D1]))
    equal(count('learning_documents', `knowledge_source_id='${S}'`), 1, 'rows')
  })
  await check('docs: recollect with the same stable id is idempotent (id and collected_at unchanged)', () => {
    const before = sql(`select id::text||collected_at::text from public.learning_documents where knowledge_source_id='${S}';`)
    sql(persistDocs(S, [{ ...D1, collectedAt: new Date(Date.now() + 1000).toISOString() }]))
    equal(count('learning_documents', `knowledge_source_id='${S}'`), 1, 'rows after recollect')
    equal(sql(`select id::text||collected_at::text from public.learning_documents where knowledge_source_id='${S}';`), before, 'row unchanged')
  })
  await check('docs: same version with a different (random) id is rejected, not silently orphaned', () =>
    denied(persistDocs(S, [{ ...D1, id: randomUUID() }]), 'DOCUMENT_ID_MISMATCH'))
  await check('docs: same id with different content hash is rejected (approved evidence body cannot change)', () =>
    denied(persistDocs(S, [{ ...D1, contentHash: 'h-changed', text: 'tampered body' }]), 'DOCUMENT_VERSION_CONFLICT'))
  await check('docs: changed content becomes a new immutable version; old body untouched', () => {
    sql(persistDocs(S, [doc(S, { hash: 'h2', text: 'new body hours 11:00 - 19:00' })]))
    equal(count('learning_documents', `knowledge_source_id='${S}'`), 2, 'versions')
    expect(sql(`select text_content from public.learning_documents where id='${D1.id}';`).includes('reservation only'), 'v1 body must be unchanged')
  })
  await check('docs: direct UPDATE of a document is blocked by trigger', () =>
    denied(`update public.learning_documents set text_content='x' where id='${D1.id}';`, 'LEARNING_DOCUMENT_IMMUTABLE'))
  await check('docs: retention purge may redact body/images to empty but cannot rewrite or restore them', () => {
    const purged = doc(S, { provider: 'p_purge', hash: 'hp', text: 'body to purge', images: [{ mediaId: 'm', url: 'https://cdn/x.jpg', mimeType: 'image/jpeg' }] })
    const imageSource = insertLearningSource({ images: true })
    verify(imageSource)
    const imageDoc = doc(imageSource, { provider: 'p_purge', hash: 'hp', text: 'body to purge', images: purged.images })
    sql(persistDocs(imageSource, [imageDoc]))
    denied(`update public.learning_documents set text_content='rewritten' where id='${imageDoc.id}';`, 'LEARNING_DOCUMENT_IMMUTABLE')
    denied(`update public.learning_documents set content_hash='other' where id='${imageDoc.id}';`, 'LEARNING_DOCUMENT_IMMUTABLE')
    sql(`update public.learning_documents set text_content='', images='[]'::jsonb where id='${imageDoc.id}';`)
    equal(sql(`select length(text_content)||'/'||jsonb_array_length(images)||'/'||content_hash from public.learning_documents where id='${imageDoc.id}';`), '0/0/hp', 'purged row keeps relationship ids and hash only')
    denied(`update public.learning_documents set text_content='restored' where id='${imageDoc.id}';`, 'LEARNING_DOCUMENT_IMMUTABLE')
  })
  await check('docs: de-identifying source purge is allowed only for service_role on a deleted source, exact shape only', () => {
    const ps = insertLearningSource({ images: true })
    verify(ps)
    const pd = doc(ps, { provider: 'p_sp', hash: 'hsp', text: 'purge me' })
    sql(persistDocs(ps, [pd]))
    const purge = (extra = '') => `update public.learning_documents set text_content='', images='[]'::jsonb, url='https://removed.invalid/', author_account_id='', provider_document_id='purged:'||id ${extra} where id='${pd.id}';`
    denied(svc(purge()), 'LEARNING_DOCUMENT_IMMUTABLE') // source not deleted yet
    sql(svc(`select * from public.delete_learning_source_atomic('${ws.A}','${ps}',1,'${user.mgrA}','delete:${ps}:2');`))
    denied(purge(), 'LEARNING_DOCUMENT_IMMUTABLE') // no service_role claim
    denied(authAs(user.mgrA, purge()), 'permission denied')
    denied(svc(`update public.learning_documents set text_content='', images='[]'::jsonb, url='https://evil.example/', author_account_id='', provider_document_id='purged:'||id where id='${pd.id}';`), 'LEARNING_DOCUMENT_IMMUTABLE')
    denied(svc(`update public.learning_documents set text_content='x', images='[]'::jsonb, url='https://removed.invalid/', author_account_id='', provider_document_id='purged:'||id where id='${pd.id}';`), 'LEARNING_DOCUMENT_IMMUTABLE')
    denied(svc(purge(", content_hash='zz'")), 'LEARNING_DOCUMENT_IMMUTABLE')
    sql(svc(purge()))
    equal(sql(`select text_content||'|'||url||'|'||author_account_id||'|'||(provider_document_id='purged:'||id)::text||'|'||content_hash from public.learning_documents where id='${pd.id}';`), `|https://removed.invalid/||true|hsp`, 'purged row')
  })
  await check('docs: author not equal to lease provider account is rejected', () =>
    denied(persistDocs(S, [doc(S, { provider: 'p_author', author: 'someone_else' })]), 'DOCUMENT_AUTHOR_MISMATCH'))
  await check('docs: document declaring another revision/source is rejected', () => {
    denied(persistDocs(S, [doc(S, { provider: 'p_rev', revision: 2 })]), 'DOCUMENT_SOURCE_MISMATCH')
    denied(persistDocs(S, [{ ...doc(S, { provider: 'p_src' }), source: { workspaceId: ws.A, sourceId: randomUUID(), revision: 1 } }]), 'DOCUMENT_SOURCE_MISMATCH')
  })
  await check('docs: stale expected revision rejected', () => denied(persistDocs(S, [doc(S, { provider: 'p_stale', revision: 2 })], { revision: 2 }), 'STALE_SOURCE_REVISION'))
  await check('docs: image documents need image consent', () =>
    denied(persistDocs(S, [doc(S, { provider: 'p_img', images: [{ mediaId: 'm', url: 'https://cdn/x.jpg', mimeType: 'image/jpeg' }] })]), 'IMAGE_CONSENT_REQUIRED'))
  await check('docs: no text consent rejected', () => {
    const noConsent = insertLearningSource({ text: false, images: false })
    verify(noConsent)
    denied(persistDocs(noConsent, [doc(noConsent)]), 'CONSENT_REQUIRED')
  })
  await check('docs: expired lease rejected', () => {
    const expiring = insertLearningSource()
    verify(expiring, { expires: `now() + interval '2 seconds'` })
    sql('select pg_sleep(3);')
    denied(persistDocs(expiring, [doc(expiring)]), 'VALID_LEASE_REQUIRED')
  })
  await check('docs: cross-tenant source id rejected', () => denied(persistDocs(S, [doc(S, { workspace: ws.B, provider: 'p_x' })], { workspace: ws.B, actor: user.mgrB }), 'SOURCE_NOT_FOUND'))

  // ---------- 3) candidates ----------
  const C1 = cand(S, D1.id)
  await check('cands: new candidate is review_required, confidence null, creator = verified actor', () => {
    sql(persistCands(S, [C1]))
    equal(sql(`select status||'/'||version||'/'||coalesce(confidence::text,'null')||'/'||created_by_user_id from public.knowledge_candidates where id='${C1.id}';`), `review_required/1/null/${user.mgrA}`, 'candidate row')
  })
  await check('cands: identical retry does not bump version', () => {
    sql(persistCands(S, [C1]))
    equal(sql(`select version from public.knowledge_candidates where id='${C1.id}';`), 1, 'version')
  })
  await check('cands: same content with a new random id does not create a duplicate candidate', () => {
    sql(persistCands(S, [{ ...C1, id: randomUUID() }]))
    equal(count('knowledge_candidates', `knowledge_source_id='${S}'`), 1, 'candidate rows')
  })
  await check('cands: changed content bumps version exactly once', () => {
    sql(persistCands(S, [{ ...C1, content: 'Mon-Fri 10:00 - 21:00' }]))
    equal(sql(`select version||'/'||content from public.knowledge_candidates where id='${C1.id}';`), '2/Mon-Fri 10:00 - 21:00', 'updated')
  })
  await check('cands: whitespace-normalized quote from body is accepted', () =>
    sql(persistCands(S, [cand(S, D1.id, { category: 'policy', content: 'reservation only', excerpt: 'Mon-Fri   10:00 - 20:00   reservation only' })])))
  await check('cands: excerpt that is not in the document body is rejected', () =>
    denied(persistCands(S, [cand(S, D1.id, { excerpt: 'this sentence never appeared' })]), 'EVIDENCE_QUOTE_NOT_IN_DOCUMENT'))
  await check('cands: missing quote and missing vision receipt rejected', () =>
    denied(persistCands(S, [cand(S, D1.id, { excerpt: null })]), 'EVIDENCE_QUOTE_REQUIRED'))
  await check('cands: invalid category / empty content rejected', () => {
    denied(persistCands(S, [cand(S, D1.id, { category: 'nonsense' })]), 'INVALID_CANDIDATE_CATEGORY')
    denied(persistCands(S, [cand(S, D1.id, { content: '   ' })]), 'INVALID_CANDIDATE_CONTENT')
  })
  await check('cands: evidence document from another source in the same tenant is rejected', () => {
    const other = insertLearningSource()
    verify(other)
    const otherDoc = doc(other)
    sql(persistDocs(other, [otherDoc]))
    denied(persistCands(S, [cand(S, otherDoc.id)]), 'INVALID_DOCUMENT_EVIDENCE')
  })
  await check('cands: candidate id belonging to another source cannot be overwritten (cross-source tamper)', () => {
    const other = insertLearningSource()
    verify(other)
    const otherDoc = doc(other)
    sql(persistDocs(other, [otherDoc]))
    const otherCand = cand(other, otherDoc.id)
    sql(persistCands(other, [otherCand]))
    denied(persistCands(S, [{ ...cand(S, D1.id, { content: 'hijack' }), id: otherCand.id }]), 'CANDIDATE_SOURCE_MISMATCH')
    equal(sql(`select content from public.knowledge_candidates where id='${otherCand.id}';`), otherCand.content, 'other source candidate untouched')
  })
  await check('cands: visual evidence requires image consent', () =>
    denied(persistCands(S, [cand(S, D1.id, { category: 'visual', content: 'logo style', excerpt: null, receipt: 'vr_1' })]), 'CONSENT_REQUIRED'))
  await check('cands: conflictsWithFactId must reference a real fact in the tenant', () =>
    denied(persistCands(S, [cand(S, D1.id, { category: 'price', content: 'coffee 5000', excerpt: 'Mon-Fri 10:00', conflict: randomUUID() })]), 'INVALID_CONFLICT_FACT'))
  await check('cands: composite FK rejects evidence document of another source on direct insert', () => {
    const other = insertLearningSource()
    verify(other)
    const otherDoc = doc(other)
    sql(persistDocs(other, [otherDoc]))
    denied(`insert into public.knowledge_candidates (workspace_id,knowledge_source_id,category,content,created_by_user_id,evidence_document_id)
      values ('${ws.A}','${S}','hours','x','${user.mgrA}','${otherDoc.id}');`, 'knowledge_candidates_learning_document_fkey')
  })

  // ---------- review + approved immutability + context ----------
  await check('review: viewer and outsider cannot review', () => {
    const decision = [{ candidateId: C1.id, version: 2, decision: 'approved' }]
    denied(authAs(user.viewerA, `select public.review_learning_candidates_atomic('${ws.A}','${S}',1,1,'${user.viewerA}',${j(decision)});`), 'FORBIDDEN_WORKSPACE_MEMBER')
    denied(authAs(user.mgrB, `select public.review_learning_candidates_atomic('${ws.A}','${S}',1,1,'${user.mgrB}',${j(decision)});`), 'FORBIDDEN_WORKSPACE_MEMBER')
  })
  await check('review: stale candidate version rejected, then approve creates fact + dependency + epoch bump', () => {
    denied(authAs(user.mgrA, `select public.review_learning_candidates_atomic('${ws.A}','${S}',1,1,'${user.mgrA}',${j([{ candidateId: C1.id, version: 1, decision: 'approved' }])});`), 'STALE_CANDIDATE_VERSION')
    const epochBefore = Number(sql(`select coalesce(max(epoch),1) from public.workspace_knowledge_epochs where workspace_id='${ws.A}';`))
    sql(authAs(user.mgrA, `select public.review_learning_candidates_atomic('${ws.A}','${S}',1,1,'${user.mgrA}',${j([{ candidateId: C1.id, version: 2, decision: 'approved' }])});`))
    equal(count('learning_projection_dependencies', `knowledge_source_id='${S}'`), 1, 'dependency rows')
    equal(sql(`select epoch from public.workspace_knowledge_epochs where workspace_id='${ws.A}';`), epochBefore + 1, 'epoch')
  })
  await check('cands: approved candidate is never overwritten by a later changed persist', () => {
    const before = sql(`select version||'/'||content||'/'||status from public.knowledge_candidates where id='${C1.id}';`)
    sql(persistCands(S, [{ ...C1, content: 'attacker rewrite' }]))
    equal(sql(`select version||'/'||content||'/'||status from public.knowledge_candidates where id='${C1.id}';`), before, 'approved candidate')
  })
  await check('context: authenticated member reads approved fact with its dependency; outsider and no-JWT rejected', () => {
    const rows = sql(authAs(user.viewerA, `select dependencies::text from public.get_approved_learning_context('${ws.A}','conversation',10);`))
    expect(rows.includes(S), 'dependency must list the source')
    denied(authAs(user.mgrB, `select * from public.get_approved_learning_context('${ws.A}','conversation',10);`), 'permission denied')
    denied(`select * from public.get_approved_learning_context('${ws.A}','conversation',10);`, 'FORBIDDEN_UNAUTHENTICATED')
    denied(svc(`select * from public.get_approved_learning_context('${ws.A}','bogus',10);`), 'INVALID_PURPOSE')
  })
  await check('context: image purpose excludes facts whose source has no image consent', () =>
    equal(sql(svc(`select count(*) from public.get_approved_learning_context('${ws.A}','image',10);`)), 0, 'image facts'))
  await check('context: image purpose targets visual category only, ignores newer business facts, and prioritizes manual style', () => {
    // 1. Channel source with image consent and an older visual style fact
    const visualSrc = insertLearningSource({ text: true, images: true })
    verify(visualSrc)
    const vDoc = doc(visualSrc, { provider: 'vpost', hash: 'vh1', text: 'Brand visual identity warm minimal style guide.', images: [{ mediaId: 'v1', url: 'https://cdn/v1.png', mimeType: 'image/png' }] })
    sql(persistDocs(visualSrc, [vDoc]))
    const vCand = cand(visualSrc, vDoc.id, { category: 'visual', content: 'Warm pastel minimalist salon interior', excerpt: 'warm minimal style guide' })
    sql(persistCands(visualSrc, [vCand]))
    sql(authAs(user.mgrA, `select public.review_learning_candidates_atomic('${ws.A}','${visualSrc}',1,1,'${user.mgrA}',${j([{ candidateId: vCand.id, version: 1, decision: 'approved' }])});`))

    // 2. Insert a NEWER business fact (newer created_at)
    const newerBusinessCand = randomUUID()
    sql(`insert into public.knowledge_candidates (id,workspace_id,knowledge_source_id,category,content,status,reviewed_by_user_id,reviewed_at,created_by_user_id)
        values ('${newerBusinessCand}','${ws.A}','${visualSrc}','business','Newest business promotion notice 2026','approved','${user.mgrA}',now(),'${user.mgrA}');
      insert into public.knowledge_facts (workspace_id,category,content,source_candidate_id,approved_by_user_id,approved_at,created_at)
        values ('${ws.A}','business','Newest business promotion notice 2026','${newerBusinessCand}','${user.mgrA}',now(),now()+interval '10 minutes');`)

    // 3. get_approved_learning_context with purpose 'image' and max_facts 1 must return ONLY visual fact, NOT the newer business fact!
    const imageFactRow = sql(svc(`select category||'|'||content from public.get_approved_learning_context('${ws.A}','image',1);`))
    equal(imageFactRow.startsWith('visual|'), true, 'image purpose strictly targets visual category only')
    expect(imageFactRow.includes('Warm pastel minimalist salon interior'), 'older visual fact returned over newer business fact')

    // 4. When an approved manual visual fact exists, it takes precedence as the owner canonical style
    const manualVisualCand = randomUUID()
    sql(`insert into public.knowledge_sources (id,workspace_id,source_type,display_name,created_by_user_id) values ('${manualVisualCand}','${ws.A}','manual','manual visual','${user.mgrA}');
      insert into public.knowledge_candidates (id,workspace_id,knowledge_source_id,category,content,status,reviewed_by_user_id,reviewed_at,created_by_user_id)
        values ('${manualVisualCand}','${ws.A}','${manualVisualCand}','visual','Owner canonical brand identity: Chic modern monochromatic','approved','${user.mgrA}',now(),'${user.mgrA}');
      insert into public.knowledge_facts (workspace_id,category,content,source_candidate_id,approved_by_user_id,approved_at,created_at)
        values ('${ws.A}','visual','Owner canonical brand identity: Chic modern monochromatic','${manualVisualCand}','${user.mgrA}',now(),now()-interval '1 day');`)

    const topStyle = sql(svc(`select content from public.get_approved_learning_context('${ws.A}','image',1);`))
    expect(topStyle.includes('Owner canonical brand identity: Chic modern monochromatic'), 'manual owner canonical visual style prioritized')
  })
  await check('context: multi-leaf fact returns ALL leaf sources and dies when any one leaf is revoked', () => {
    const leaf2 = insertLearningSource()
    verify(leaf2)
    const factId = sql(`select projection_fact_id from public.learning_projection_dependencies where knowledge_source_id='${S}' limit 1;`)
    sql(`insert into public.learning_projection_dependencies (workspace_id,projection_fact_id,knowledge_source_id,required_revision) values ('${ws.A}','${factId}','${leaf2}',1);`)
    const deps = JSON.parse(sql(svc(`select dependencies::text from public.get_approved_learning_context('${ws.A}','conversation',10) where id='${factId}';`)))
    equal(deps.length, 2, 'dependency count')
    expect(deps.some((d) => d.sourceId === S) && deps.some((d) => d.sourceId === leaf2), 'both leaves present')
    sql(svc(`select public.revoke_learning_source_atomic('${ws.A}','${leaf2}',1,'${user.mgrA}');`))
    equal(sql(svc(`select count(*) from public.get_approved_learning_context('${ws.A}','conversation',10) where id='${factId}';`)), 0, 'fact excluded after leaf revoked')
  })
  await check('context: manual-source fact survives, deleted manual source fact is excluded', () => {
    const countBefore = Number(sql(svc(`select count(*) from public.get_approved_learning_context('${ws.A}','conversation',10);`)))
    const manual = randomUUID()
    sql(`insert into public.knowledge_sources (id,workspace_id,source_type,display_name,created_by_user_id) values ('${manual}','${ws.A}','manual','m','${user.mgrA}');
      insert into public.knowledge_candidates (id,workspace_id,knowledge_source_id,category,content,status,reviewed_by_user_id,reviewed_at,created_by_user_id)
        values ('${manual}','${ws.A}','${manual}','policy','manual rule','approved','${user.mgrA}',now(),'${user.mgrA}');
      insert into public.knowledge_facts (workspace_id,category,content,source_candidate_id,approved_by_user_id,approved_at) values ('${ws.A}','policy','manual rule','${manual}','${user.mgrA}',now());`)
    equal(sql(svc(`select count(*) from public.get_approved_learning_context('${ws.A}','conversation',10);`)), countBefore + 1, 'manual fact visible with 3 args')
    equal(sql(svc(`select count(*) from public.get_approved_learning_context('${ws.A}','conversation',10) where content='manual rule';`)), 1, 'manual fact visible')
    sql(`update public.knowledge_sources set deleted_at=now() where id='${manual}';`)
    equal(sql(svc(`select count(*) from public.get_approved_learning_context('${ws.A}','conversation',10);`)), countBefore, 'deleted manual fact hidden')
  })
  await check('context: returns fact created_at (timestamptz) and candidate source_location for manual/file facts, preserving evidence for channel facts', () => {
    // 1. Manual fact with explicit source_location 'manual'
    const manualSource = randomUUID()
    const manualCand = randomUUID()
    const manualFact = randomUUID()
    const manualTime = '2026-11-05 10:00:00+00'
    sql(`insert into public.knowledge_sources (id,workspace_id,source_type,display_name,created_by_user_id) values ('${manualSource}','${ws.A}','manual','manual-src','${user.mgrA}');
      insert into public.knowledge_candidates (id,workspace_id,knowledge_source_id,category,content,source_location,status,reviewed_by_user_id,reviewed_at,created_by_user_id)
        values ('${manualCand}','${ws.A}','${manualSource}','policy','manual created_at test','manual','approved','${user.mgrA}',now(),'${user.mgrA}');
      insert into public.knowledge_facts (id,workspace_id,category,content,source_candidate_id,approved_by_user_id,approved_at,created_at)
        values ('${manualFact}','${ws.A}','policy','manual created_at test','${manualCand}','${user.mgrA}',now(),'${manualTime}');`)

    // 2. File fact with source_location 'file:menu_v2.pdf'
    const fileSource = randomUUID()
    const fileCand = randomUUID()
    const fileFact = randomUUID()
    const fileAsset = randomUUID()
    const fileTime = '2026-11-06 14:30:00+00'
    sql(`insert into public.media_assets (workspace_id, id) values ('${ws.A}', '${fileAsset}');
      insert into public.knowledge_sources (id,workspace_id,source_type,file_asset_id,display_name,created_by_user_id) values ('${fileSource}','${ws.A}','file','${fileAsset}','menu_v2.pdf','${user.mgrA}');
      insert into public.knowledge_candidates (id,workspace_id,knowledge_source_id,category,content,source_location,status,reviewed_by_user_id,reviewed_at,created_by_user_id)
        values ('${fileCand}','${ws.A}','${fileSource}','offering','file created_at test','file:menu_v2.pdf','approved','${user.mgrA}',now(),'${user.mgrA}');
      insert into public.knowledge_facts (id,workspace_id,category,content,source_candidate_id,approved_by_user_id,approved_at,created_at)
        values ('${fileFact}','${ws.A}','offering','file created_at test','${fileCand}','${user.mgrA}',now(),'${fileTime}');`)

    // 3. Interview fact with source_location 'interview:q_parking'
    const ivCand = randomUUID()
    const ivFact = randomUUID()
    const ivTime = '2026-11-07 09:15:00+00'
    sql(`insert into public.knowledge_candidates (id,workspace_id,knowledge_source_id,category,content,source_location,status,reviewed_by_user_id,reviewed_at,created_by_user_id)
        values ('${ivCand}','${ws.A}','${manualSource}','location','parking info','interview:q_parking','approved','${user.mgrA}',now(),'${user.mgrA}');
      insert into public.knowledge_facts (id,workspace_id,category,content,source_candidate_id,approved_by_user_id,approved_at,created_at)
        values ('${ivFact}','${ws.A}','location','parking info','${ivCand}','${user.mgrA}',now(),'${ivTime}');`)

    // Query RPC for manual fact: verify created_at matches and source_location is 'manual'
    const manualRow = sql(svc(`select (created_at = '${manualTime}'::timestamptz)::text||'|'||coalesce(source_location,'NULL')||'|'||source_type from public.get_approved_learning_context('${ws.A}','conversation',10) where id='${manualFact}';`))
    equal(manualRow, 'true|manual|manual', 'manual fact returns created_at and source_location')

    // Query RPC for file fact: verify created_at matches and source_location is 'file:menu_v2.pdf'
    const fileRow = sql(svc(`select (created_at = '${fileTime}'::timestamptz)::text||'|'||coalesce(source_location,'NULL')||'|'||source_type from public.get_approved_learning_context('${ws.A}','conversation',10) where id='${fileFact}';`))
    equal(fileRow, 'true|file:menu_v2.pdf|manual', 'file fact returns created_at and source_location')

    // Query RPC for interview fact: verify created_at matches and source_location is 'interview:q_parking'
    const ivRow = sql(svc(`select (created_at = '${ivTime}'::timestamptz)::text||'|'||coalesce(source_location,'NULL')||'|'||source_type from public.get_approved_learning_context('${ws.A}','conversation',10) where id='${ivFact}';`))
    equal(ivRow, 'true|interview:q_parking|manual', 'interview fact returns created_at and source_location')

    // Query RPC for channel fact: verify created_at is valid timestamptz, source_location is null, dependencies preserved
    const channelRow = sql(svc(`select (created_at is not null)::text||'|'||coalesce(source_location,'NULL')||'|'||source_type||'|'||(jsonb_array_length(dependencies) > 0)::text from public.get_approved_learning_context('${ws.A}','conversation',10) where source_type='channel' limit 1;`))
    if (channelRow) {
      equal(channelRow, 'true|NULL|channel|true', 'channel fact preserves evidence dependencies and has valid created_at with null source_location')
    }
  })
  await check('context: single signature exists and 4th query argument filters matching facts', () => {
    equal(sql(`select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='get_approved_learning_context';`), 1, 'single function signature')
    expect(sql(`select 'public.get_approved_learning_context(uuid,text,integer,text)'::regprocedure::text;`).endsWith('get_approved_learning_context(uuid,text,integer,text)'), 'regprocedure matches')
    // Insert a fresh fact to verify query filter matching
    const qSource = randomUUID()
    const qCand = randomUUID()
    sql(`insert into public.knowledge_sources (id,workspace_id,source_type,display_name,created_by_user_id) values ('${qSource}','${ws.A}','manual','q-source','${user.mgrA}');
      insert into public.knowledge_candidates (id,workspace_id,knowledge_source_id,category,content,status,reviewed_by_user_id,reviewed_at,created_by_user_id)
        values ('${qCand}','${ws.A}','${qSource}','policy','Weekend reservation mandatory','approved','${user.mgrA}',now(),'${user.mgrA}');
      insert into public.knowledge_facts (workspace_id,category,content,source_candidate_id,approved_by_user_id,approved_at) values ('${ws.A}','policy','Weekend reservation mandatory','${qCand}','${user.mgrA}',now());`)
    // Search filter matches existing approved fact
    const match = sql(svc(`select count(*) from public.get_approved_learning_context('${ws.A}','conversation',10,'Weekend');`))
    equal(match, 1, 'filtered match')
    const nomatch = sql(svc(`select count(*) from public.get_approved_learning_context('${ws.A}','conversation',10,'nonexistent_query_token');`))
    equal(nomatch, 0, 'filtered no match')
    // Natural language Korean question matching and category alias ranking
    const qMenuCand = randomUUID()
    sql(`insert into public.knowledge_candidates (id,workspace_id,knowledge_source_id,category,content,status,reviewed_by_user_id,reviewed_at,created_by_user_id)
        values ('${qMenuCand}','${ws.A}','${qSource}','price','아메리카노 4500원 (HOT/ICE 동일)','approved','${user.mgrA}',now()-interval '30 days','${user.mgrA}');
      insert into public.knowledge_facts (workspace_id,category,content,source_candidate_id,approved_by_user_id,approved_at,created_at)
        values ('${ws.A}','price','아메리카노 4500원 (HOT/ICE 동일)','${qMenuCand}','${user.mgrA}',now()-interval '30 days',now()-interval '30 days');`)
    // 10k fixture: insert 10,000 newer noise candidates & facts to ensure relevance ranking ranks the old relevant fact #1
    sql(`with cands as (
        insert into public.knowledge_candidates (id, workspace_id, knowledge_source_id, category, content, status, reviewed_by_user_id, reviewed_at, created_by_user_id)
        select gen_random_uuid(), '${ws.A}'::uuid, '${qSource}'::uuid,
               case (i % 4) when 0 then 'business' when 1 then 'offering' when 2 then 'tone' else 'faq' end,
               'Dummy catalog noise product number ' || i, 'approved', '${user.mgrA}'::uuid, now()-interval '5 days', '${user.mgrA}'::uuid
        from generate_series(1, 10000) as i
        returning id, category, content
      )
      insert into public.knowledge_facts (workspace_id, category, content, status, source_candidate_id, approved_by_user_id, approved_at, created_at)
      select '${ws.A}'::uuid, c.category, c.content, 'active', c.id, '${user.mgrA}'::uuid, now()-interval '5 days', now()-interval '5 days'
      from cands c;`)
    const nlResult = sql(svc(`select content from public.get_approved_learning_context('${ws.A}','conversation',1,'아메리카노 가격이 얼마야?');`))
    expect(nlResult.includes('아메리카노 4500원'), 'natural language Korean question matches old relevant price fact over 10k newer noise facts via alias and tokens')
  })
  await check('cands: conservative conflict detection against active facts in price/hours/policy/location blocks unedited approve', () => {
    // 1. Existing manual canonical fact for price
    const manualSource = randomUUID()
    const manualCand = randomUUID()
    const factId = randomUUID()
    sql(`insert into public.knowledge_sources (id,workspace_id,source_type,display_name,created_by_user_id) values ('${manualSource}','${ws.A}','manual','manual price source','${user.mgrA}');
      insert into public.knowledge_candidates (id,workspace_id,knowledge_source_id,category,content,status,reviewed_by_user_id,reviewed_at,created_by_user_id)
        values ('${manualCand}','${ws.A}','${manualSource}','price','Americano 4000 KRW','approved','${user.mgrA}',now(),'${user.mgrA}');
      insert into public.knowledge_facts (id,workspace_id,category,content,source_candidate_id,approved_by_user_id,approved_at)
        values ('${factId}','${ws.A}','price','Americano 4000 KRW','${manualCand}','${user.mgrA}',now());`)
    // 2. New observed document with different price
    const priceDoc = doc(S, { provider: 'post_price', hash: 'hprice', text: 'Special blend Americano 4500 KRW seasonal sale.' })
    sql(persistDocs(S, [priceDoc]))
    // 3. Candidate extracted without conflictFactId (null)
    const priceCand = cand(S, priceDoc.id, { category: 'price', content: 'Americano 4500 KRW', excerpt: 'Americano 4500 KRW seasonal sale' })
    sql(persistCands(S, [priceCand]))
    // Conservative conflict detection must have flagged it as conflict linked to the fact
    const candRow = sql(`select status||'/'||conflicts_with_fact_id from public.knowledge_candidates where id='${priceCand.id}';`)
    equal(candRow, `conflict/${factId}`, 'candidate flagged as conflict with existing fact')
    // 4. Attempting unedited approval must be rejected with CONFLICT_RESOLUTION_REQUIRED
    denied(authAs(user.mgrA, `select public.review_learning_candidates_atomic('${ws.A}','${S}',1,1,'${user.mgrA}',${j([{ candidateId: priceCand.id, version: 1, decision: 'approved' }])});`), 'CONFLICT_RESOLUTION_REQUIRED')
    // 5. Explicit edited content resolves the conflict
    sql(authAs(user.mgrA, `select public.review_learning_candidates_atomic('${ws.A}','${S}',1,1,'${user.mgrA}',${j([{ candidateId: priceCand.id, version: 1, decision: 'approved', editedContent: 'Americano 4500 KRW (seasonal)' }])});`))
    equal(sql(`select status from public.knowledge_candidates where id='${priceCand.id}';`), 'approved', 'conflict resolved with edit')
  })

  // ---------- 4) durable jobs ----------
  const J = insertLearningSource()
  verify(J)
  const job = (kind, key, revision = 1, source = J) => svc(`select id from public.create_learning_job_atomic('${ws.A}','${source}',${revision},'${kind}',${q(key)});`)
  let jobId = ''
  await check('jobs: create is idempotent and conflicting key reuse is rejected', () => {
    jobId = sql(job('collect', 'jk1'))
    equal(sql(job('collect', 'jk1')), jobId, 'same job on retry')
    denied(job('verify', 'jk1'), 'IDEMPOTENCY_CONFLICT')
    denied(job('collect', 'jk-stale', 2), 'STALE_SOURCE_REVISION')
  })
  await check('jobs: claim is atomic (running, attempt 1, lease owner); second claimer gets nothing', () => {
    const claimed = sql(svc(`select status||'/'||attempt||'/'||lease_owner from public.claim_learning_job_atomic('${ws.A}','${jobId}','worker-1',60);`))
    equal(claimed, 'running/1/worker-1', 'claim result')
    equal(sql(svc(`select count(*) from public.claim_learning_job_atomic('${ws.A}','${jobId}','worker-2',60);`)), 0, 'second claim')
  })
  await check('jobs: result transition is CAS on owner/lease/state', () => {
    denied(svc(`select public.update_learning_job_atomic('${ws.A}','${jobId}','completed','worker-2');`), 'JOB_LEASE_MISMATCH')
    denied(svc(`select public.update_learning_job_atomic('${ws.A}','${jobId}','completed');`), 'JOB_LEASE_REQUIRED')
    sql(svc(`select public.update_learning_job_atomic('${ws.A}','${jobId}','running','worker-1',${j({ billing: { reserved: 2 } })});`))
    sql(svc(`select public.update_learning_job_atomic('${ws.A}','${jobId}','running','worker-1',${j({ cursor: 'c1' })});`))
    sql(svc(`select public.update_learning_job_atomic('${ws.A}','${jobId}','completed','worker-1');`))
    equal(sql(`select status||'/'||(checkpoint->>'cursor')||'/'||(checkpoint->'billing'->>'reserved') from public.learning_jobs where id='${jobId}';`), 'completed/c1/2', 'atomic shallow merged checkpoint')
    denied(svc(`select public.update_learning_job_atomic('${ws.A}','${jobId}','failed','worker-1');`), 'JOB_STATE_CONFLICT')
  })
  await check('jobs: expired lease can be reclaimed by another worker; the stale owner is fenced out', () => {
    const id = sql(job('collect', 'jk-expire'))
    sql(svc(`select * from public.claim_learning_job_atomic('${ws.A}','${id}','worker-1',60);`))
    sql(`update public.learning_jobs set lease_expires_at = now() - interval '1 second' where id='${id}';`)
    denied(svc(`select public.update_learning_job_atomic('${ws.A}','${id}','completed','worker-1');`), 'JOB_LEASE_MISMATCH')
    equal(sql(svc(`select lease_owner||'/'||attempt from public.claim_learning_job_atomic('${ws.A}','${id}','worker-2',60);`)), 'worker-2/2', 'reclaim')
  })
  await check('jobs: 8 concurrent claimers yield exactly one winner', async () => {
    const id = sql(job('collect', 'jk-race'))
    const runs = Array.from({ length: 8 }, (_, index) => new Promise((resolveRun, rejectRun) => {
      const child = spawn(join(bin, 'psql'), psqlArgs, { env })
      let out = ''
      child.stdout.on('data', (chunk) => { out += chunk })
      child.on('close', (code) => (code === 0 ? resolveRun(out.trim()) : rejectRun(new Error('psql failed'))))
      child.stdin.end(svc(`select lease_owner from public.claim_learning_job_atomic('${ws.A}','${id}','racer-${index}',60);`))
    }))
    const results = (await Promise.all(runs)).filter(Boolean)
    equal(results.length, 1, `winners (${results.join(',')})`)
  })
  await check('jobs: queued job whose source revision went stale is cancelled at claim, not run', () => {
    const stale = insertLearningSource()
    verify(stale)
    const id = sql(job('collect', 'jk-stale-claim', 1, stale))
    sql(`update public.knowledge_sources set lifecycle_revision = 2 where id='${stale}';`)
    equal(sql(svc(`select count(*) from public.claim_learning_job_atomic('${ws.A}','${id}','w',60);`)), 0, 'claim result')
    equal(sql(`select status||'/'||error_code from public.learning_jobs where id='${id}';`), 'cancelled/SOURCE_NOT_ACTIVE', 'job state')
  })
  await check('jobs: revoke cancels queued and running jobs; later create/claim of collect/verify rejected; delete job still allowed', () => {
    const rev = insertLearningSource()
    verify(rev)
    const queued = sql(job('collect', 'jk-rev-q', 1, rev))
    const running = sql(job('verify', 'jk-rev-r', 1, rev))
    sql(svc(`select * from public.claim_learning_job_atomic('${ws.A}','${running}','w1',60);`))
    sql(svc(`select public.revoke_learning_source_atomic('${ws.A}','${rev}',1,'${user.mgrA}');`))
    equal(sql(`select string_agg(status,',' order by idempotency_key) from public.learning_jobs where knowledge_source_id='${rev}';`), 'cancelled,cancelled', 'jobs after revoke')
    equal(sql(svc(`select count(*) from public.claim_learning_job_atomic('${ws.A}','${queued}','w2',60);`)), 0, 'claim after revoke')
    denied(job('collect', 'jk-rev-new', 2, rev), 'SOURCE_PAUSED')
    denied(job('collect', 'jk-rev-old', 1, rev), 'SOURCE_PAUSED')
    expect(sql(job('delete', 'jk-rev-del', 2, rev)).length > 0, 'delete job on revoked source')
    denied(svc(`select public.update_learning_job_atomic('${ws.A}','${running}','completed','w1');`), 'JOB_STATE_CONFLICT')
  })
  await check('jobs: delete cancels open jobs, creates one delete job, collect create rejected, delete job claimable', () => {
    const del = insertLearningSource()
    verify(del)
    const open = sql(job('collect', 'jk-del-open', 1, del))
    const row = sql(svc(`select deletion_job_id||'/'||new_revision from public.delete_learning_source_atomic('${ws.A}','${del}',1,'${user.mgrA}','delete:${del}:2');`))
    const [deleteJob, newRevision] = row.split('/')
    equal(newRevision, 2, 'new revision')
    equal(sql(`select status from public.learning_jobs where id='${open}';`), 'cancelled', 'open collect job')
    equal(sql(`select lifecycle_revision from public.knowledge_sources where id='${del}';`), 2, 'single revision bump')
    denied(job('collect', 'jk-del-new', 2, del), 'SOURCE_NOT_FOUND')
    equal(sql(svc(`select status from public.claim_learning_job_atomic('${ws.A}','${deleteJob}','janitor',60);`)), 'running', 'delete job claim')
  })

  // ---------- 5) list_due_learning_verifications & validate_learning_result & OAuth disconnect ----------
  await check('due: list_due_learning_verifications returns leases due within 18h in oldest-first order and is service_role only', () => {
    denied(authAs(user.mgrA, `select * from public.list_due_learning_verifications(50);`), 'permission denied')
    const due1 = insertLearningSource()
    const due2 = insertLearningSource()
    // due1 verified 20h ago, due2 verified 19h ago
    sql(`update public.knowledge_sources set evidence_revision = 1, learning_verification_status = 'verified' where id = '${due1}';
      insert into public.learning_evidence_leases(workspace_id,knowledge_source_id,evidence_revision,provider_account_id,method,verified_at,expires_at)
        values('${ws.A}','${due1}',1,'act_1','oauth',now()-interval '20 hours',now()+interval '4 hours');
      update public.knowledge_sources set evidence_revision = 1, learning_verification_status = 'verified' where id = '${due2}';
      insert into public.learning_evidence_leases(workspace_id,knowledge_source_id,evidence_revision,provider_account_id,method,verified_at,expires_at)
        values('${ws.A}','${due2}',1,'act_1','oauth',now()-interval '19 hours',now()+interval '5 hours');`)
    const rows = sql(svc(`select source_id from public.list_due_learning_verifications(50);`)).split('\n')
    const idx1 = rows.indexOf(due1)
    const idx2 = rows.indexOf(due2)
    expect(idx1 >= 0 && idx2 >= 0 && idx1 < idx2, 'oldest-first ordering prevents fresh lease starvation')
  })

  await check('due: 50 historical leases do not starve current due source (1:1 current evidence lease join test)', () => {
    const histSource = insertLearningSource()
    // Insert 50 historical leases for histSource (evidence_revision 1..50)
    for (let r = 1; r <= 50; r++) {
      sql(`insert into public.learning_evidence_leases(workspace_id,knowledge_source_id,evidence_revision,provider_account_id,method,verified_at,expires_at)
        values('${ws.A}','${histSource}',${r},'act_1','oauth',now()-interval '30 days',now()-interval '29 days');`)
    }
    // Set histSource current evidence_revision to 51 with a FRESH lease (verified just now, expires in 24h)
    sql(`update public.knowledge_sources set evidence_revision = 51, learning_verification_status = 'verified' where id = '${histSource}';
      insert into public.learning_evidence_leases(workspace_id,knowledge_source_id,evidence_revision,provider_account_id,method,verified_at,expires_at)
        values('${ws.A}','${histSource}',51,'act_1','oauth',now(),now()+interval '24 hours');`)

    // Now insert a real current due source (due51Target) whose current lease is 19h old
    const due51Target = insertLearningSource()
    sql(`update public.knowledge_sources set evidence_revision = 1, learning_verification_status = 'verified' where id = '${due51Target}';
      insert into public.learning_evidence_leases(workspace_id,knowledge_source_id,evidence_revision,provider_account_id,method,verified_at,expires_at)
        values('${ws.A}','${due51Target}',1,'act_1','oauth',now()-interval '19 hours',now()+interval '5 hours');`)

    const rows = sql(svc(`select source_id from public.list_due_learning_verifications(10);`)).split('\n')
    // histSource (having fresh current lease) must NOT be returned despite 50 expired history rows
    expect(!rows.includes(histSource), 'historical leases must not cause fresh source to be returned')
    // due51Target MUST be returned without being starved
    expect(rows.includes(due51Target), 'current due source must be returned')
  })

  await check('due: cron outage expired lease allows verify job claim for recovery, but blocks collect', () => {
    const outageSource = insertLearningSource()
    // Lease expired 2 hours ago due to cron outage
    sql(`update public.knowledge_sources set evidence_revision = 1, learning_verification_status = 'verified' where id = '${outageSource}';
      insert into public.learning_evidence_leases(workspace_id,knowledge_source_id,evidence_revision,provider_account_id,method,verified_at,expires_at)
        values('${ws.A}','${outageSource}',1,'outage_act','oauth',now()-interval '26 hours',now()-interval '2 hours');`)
    // 1. Verify job can still be created and claimed to recover the lease
    const verifyJobId = sql(svc(`select id from public.create_learning_job_atomic('${ws.A}','${outageSource}',1,'verify','vjob-outage');`))
    const claimedVerify = sql(svc(`select status from public.claim_learning_job_atomic('${ws.A}','${verifyJobId}','vworker',60);`))
    equal(claimedVerify, 'running', 'verify job claimed despite expired lease')
    // 2. But collect must be strictly blocked when lease is expired
    const docItem = doc(outageSource, { provider: 'outage-post', hash: 'houtage' })
    denied(svc(`select public.persist_learning_documents_atomic('${ws.A}','${outageSource}',1,${j([docItem])},'${user.mgrA}');`), 'VALID_LEASE_REQUIRED')
  })

  await check('consumer: validate_learning_result validates snapshot epoch, dependencies, and immediate OAuth disconnect', () => {
    const epoch = sql(`select coalesce(max(epoch), 1) from public.workspace_knowledge_epochs where workspace_id='${ws.A}';`)
    const validDep = [{ workspaceId: ws.A, sourceId: S, revision: 1 }]
    // 1. Stale epoch returns false
    equal(sql(svc(`select public.validate_learning_result('${ws.A}', ${Number(epoch) + 99}, ${j(validDep)});`)), 'f', 'stale epoch')
    // 2. Cross-workspace dep returns false
    equal(sql(svc(`select public.validate_learning_result('${ws.A}', ${epoch}, ${j([{ workspaceId: ws.B, sourceId: S, revision: 1 }])});`)), 'f', 'cross-tenant dep')
    // 3. Stale revision returns false
    equal(sql(svc(`select public.validate_learning_result('${ws.A}', ${epoch}, ${j([{ workspaceId: ws.A, sourceId: S, revision: 99 }])});`)), 'f', 'stale rev')
    // 4. Empty dependencies (manual fact only) returns true
    equal(sql(svc(`select public.validate_learning_result('${ws.A}', ${epoch}, '[]'::jsonb);`)), 't', 'empty manual dep')
    // 5. Active connection returns true
    sql(`insert into public.channel_connections (workspace_id, channel, status, external_account_id) values ('${ws.A}', 'instagram', 'connected', 'act_1') on conflict (workspace_id, channel) do update set status='connected', external_account_id='act_1';`)
    equal(sql(svc(`select public.validate_learning_result('${ws.A}', ${epoch}, ${j(validDep)});`)), 't', 'valid result')
    // 5a. F5: purpose consent check: source S has consent_text=true, consent_images=false
    equal(sql(svc(`select public.validate_learning_result('${ws.A}', ${epoch}, ${j(validDep)}, 'content');`)), 't', 'F5: content purpose valid with consent_text')
    equal(sql(svc(`select public.validate_learning_result('${ws.A}', ${epoch}, ${j(validDep)}, 'conversation');`)), 't', 'F5: conversation purpose valid with consent_text')
    equal(sql(svc(`select public.validate_learning_result('${ws.A}', ${epoch}, ${j(validDep)}, 'image');`)), 'f', 'F5: image purpose fails closed when consent_images is false')
    equal(sql(svc(`select public.validate_learning_result('${ws.A}', ${epoch}, ${j(validDep)}, 'invalid_purpose');`)), 'f', 'F5: invalid purpose fails closed')
    // 5b. F7: null external_account_id on connection fails closed for SNS while preserving manual facts
    const S_null = insertLearningSource({ workspace: ws.B, user: user.mgrB })
    sql(`insert into public.channel_connections (workspace_id, channel, status, external_account_id) values ('${ws.B}', 'instagram', 'connected', null) on conflict (workspace_id, channel) do update set status='connected', external_account_id=null;`)
    verify(S_null, { workspace: ws.B, account: 'act_null_check' })
    const epochB = sql(`select coalesce(max(epoch), 1) from public.workspace_knowledge_epochs where workspace_id='${ws.B}';`)
    equal(sql(svc(`select public.validate_learning_result('${ws.B}', ${epochB}, ${j([{ workspaceId: ws.B, sourceId: S_null, revision: 1 }])});`)), 'f', 'F7: validate fails closed when cc.external_account_id is null')
    const manualB = randomUUID()
    sql(`insert into public.knowledge_sources (id,workspace_id,source_type,display_name,created_by_user_id,is_learning_source,refresh_policy)
      values ('${manualB}','${ws.B}','manual','수동 가게 소개','${user.mgrB}',false,'{}');
      insert into public.knowledge_candidates (id,workspace_id,knowledge_source_id,category,content,status,reviewed_by_user_id,reviewed_at,created_by_user_id)
        values ('${manualB}','${ws.B}','${manualB}','business','수동 가게 소개','approved','${user.mgrB}',now(),'${user.mgrB}');
      insert into public.knowledge_facts(workspace_id,category,content,source_candidate_id,approved_by_user_id,approved_at)
        values ('${ws.B}','business','수동 가게 소개','${manualB}','${user.mgrB}',now());`)
    expect(Number(sql(svc(`select count(*) from public.get_approved_learning_context('${ws.B}','conversation',10) where source_type='manual';`))) > 0, 'F7: manual facts survive when SNS external_account_id is null')
    // 6. OAuth disconnect triggers atomic sync: revokes lease, sets source status to revoked, bumps epoch, and validates false
    sql(`update public.channel_connections set status='disconnected' where workspace_id='${ws.A}' and channel='instagram';`)
    equal(sql(`select revoked_at is not null from public.learning_evidence_leases where workspace_id='${ws.A}' and knowledge_source_id='${S}';`), 't', 'lease revoked atomically on disconnect')
    equal(sql(svc(`select public.validate_learning_result('${ws.A}', ${epoch}, ${j(validDep)});`)), 'f', 'validate fails after disconnect')
    // 7. Account rebind test: switching connection external_account_id from act_A to act_B revokes act_A lease and blocks act_A knowledge while manual facts survive
    const S_actA = insertLearningSource()
    sql(`update public.channel_connections set status='connected', external_account_id='act_A' where workspace_id='${ws.A}' and channel='instagram';`)
    verify(S_actA, { account: 'act_A' })
    const epochCur = sql(`select coalesce(max(epoch), 1) from public.workspace_knowledge_epochs where workspace_id='${ws.A}';`)
    equal(sql(svc(`select public.validate_learning_result('${ws.A}', ${epochCur}, ${j([{ workspaceId: ws.A, sourceId: S_actA, revision: 1 }])});`)), 't', 'act_A valid when connected to act_A')
    // Rebind to act_B
    sql(`update public.channel_connections set external_account_id='act_B' where workspace_id='${ws.A}' and channel='instagram';`)
    equal(sql(`select revoked_at is not null from public.learning_evidence_leases where workspace_id='${ws.A}' and knowledge_source_id='${S_actA}';`), 't', 'act_A lease revoked on rebind to act_B')
    equal(sql(svc(`select public.validate_learning_result('${ws.A}', ${epochCur}, ${j([{ workspaceId: ws.A, sourceId: S_actA, revision: 1 }])});`)), 'f', 'act_A knowledge invalid after rebind to act_B')
    // Manual facts survive connection rebind untouched
    expect(Number(sql(svc(`select count(*) from public.get_approved_learning_context('${ws.A}','conversation',10) where source_type='manual';`))) > 0, 'manual facts survive channel rebind')
  })
} finally {
  if (existsSync(join(cluster, 'postmaster.pid'))) spawnSync(join(bin, 'pg_ctl'), ['-D', cluster, '-m', 'immediate', '-w', 'stop'], { env, stdio: 'ignore' })
  rmSync(directory, { recursive: true, force: true })
}
if (failures.length > 0) {
  console.error(`FAIL: ${failures.length} failed, ${passed} passed (real PostgreSQL 16 RPC behavior)`)
  for (const failure of failures) console.error(` - ${failure}`)
  process.exit(1)
}
console.log(`PASS: ${passed} real RPC/trigger/constraint behavior checks on local PostgreSQL 16 (unix socket only, no remote DB).`)
