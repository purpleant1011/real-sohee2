import { spawnSync } from 'node:child_process'
import { beforeAll, describe, expect, it } from 'vitest'
import { query } from '../vault/pg-client'

const wsA = '22000000-0000-4000-8000-000000000024'
const ownerA = '12000000-0000-4000-8000-000000000024'
const reviewerA = '12000000-0000-4000-8000-000000000025'
const viewerA = '12000000-0000-4000-8000-000000000027'

const wsB = '22000000-0000-4000-8000-000000000026'
const ownerB = '12000000-0000-4000-8000-000000000026'

const contentId = '32000000-0000-4000-8000-000000000024'
const versionId = '42000000-0000-4000-8000-000000000024'
const mediaAssetId = '52000000-0000-4000-8000-000000000024'
const deviceId = 'b2000000-0000-4000-8000-000000000024'
const connectionId = 'c2000000-0000-4000-8000-000000000024'
const fingerprint = 'd'.repeat(64)

const exactSignature =
  'public.approve_and_dispatch_local_content(uuid,uuid,uuid,text,text,timestamptz,text,uuid)'

interface DispatchResult {
  approvalId: string
  actionRequestId: string | null
  next: string
}

function parseDispatchResult(run: { stdout: string }): DispatchResult {
  const line = run.stdout
    .trim()
    .split('\n')
    .filter(Boolean)
    .find((l) => l.trim().startsWith('{'))
  if (!line) throw new Error(`No JSON result found in psql output:\n${run.stdout}`)
  return JSON.parse(line.trim())
}

function execSql(
  statement: string,
  options: {
    role?: 'authenticated' | 'anon' | 'service_role'
    userId?: string | null
    commit?: boolean
  } = {}
) {
  if (!process.env.PGHOST?.includes('sohee-vault-db-')) {
    throw new Error('Local publish dispatch tests require isolated PostgreSQL cluster')
  }
  const bin = process.env.PG16_BIN || '/opt/homebrew/opt/postgresql@16/bin'
  const { role, userId, commit = false } = options

  let input = ''
  if (role !== undefined || userId !== undefined) {
    input += 'begin;\n'
    if (role) input += `set local role ${role};\n`
    if (userId !== undefined) {
      input += `select set_config('request.jwt.claim.sub', ${userId === null ? "''" : `'${userId}'`}, true);\n`
    }
    input += `${statement};\n`
    input += commit ? 'commit;\n' : 'rollback;\n'
  } else {
    input = `${statement};`
  }

  return spawnSync(
    `${bin}/psql`,
    ['-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-d', process.env.PGDATABASE!],
    { input, encoding: 'utf8' }
  )
}

function callDispatch(options: {
  role?: 'authenticated' | 'anon' | 'service_role'
  userId?: string | null
  commit?: boolean
  workspaceId?: string | null
  contentId?: string | null
  versionId?: string | null
  fingerprint?: string | null
  mode?: 'approve_only' | 'publish_now' | 'schedule'
  publishAt?: string | null
  timezone?: string | null
  connectionId?: string | null
}) {
  const {
    role = 'authenticated',
    userId,
    commit = false,
    workspaceId = wsA,
    contentId: cid = contentId,
    versionId: vid = versionId,
    fingerprint: fp = fingerprint,
    mode = 'publish_now',
    publishAt = null,
    timezone = mode === 'approve_only' ? null : 'Asia/Seoul',
    connectionId: conn = mode === 'approve_only' ? null : connectionId,
  } = options

  const pWs = workspaceId ? `'${workspaceId}'::uuid` : 'null'
  const pCid = cid ? `'${cid}'::uuid` : 'null'
  const pVid = vid ? `'${vid}'::uuid` : 'null'
  const pFp = fp ? `'${fp}'` : 'null'
  const pAt = publishAt ? `'${publishAt}'::timestamptz` : 'null'
  const pTz = timezone ? `'${timezone}'` : 'null'
  const pConn = conn ? `'${conn}'::uuid` : 'null'

  const statement = `select public.approve_and_dispatch_local_content(
    ${pWs},
    ${pCid},
    ${pVid},
    ${pFp},
    '${mode}',
    ${pAt},
    ${pTz},
    ${pConn}
  )`

  return execSql(statement, { role, userId, commit })
}

beforeAll(async () => {
  const setup = execSql(`
    -- 1. Users
    insert into auth.users (id, email) values
      ('${ownerA}', 'owner-a@sohee.test.invalid'),
      ('${reviewerA}', 'reviewer-a@sohee.test.invalid'),
      ('${viewerA}', 'viewer-a@sohee.test.invalid'),
      ('${ownerB}', 'owner-b@sohee.test.invalid');

    -- 2. Workspaces (add_workspace_owner trigger automatically assigns creator as owner)
    insert into public.workspaces (id, name, created_by) values
      ('${wsA}', '작업공간 A', '${ownerA}'),
      ('${wsB}', '다른 작업공간 B', '${ownerB}');

    -- 3. Workspace members
    insert into public.workspace_members (workspace_id, user_id, role, status) values
      ('${wsA}', '${reviewerA}', 'reviewer', 'active'),
      ('${wsA}', '${viewerA}', 'viewer', 'active');

    -- 4. Media asset & Storage object
    insert into public.media_assets (
      id, workspace_id, bucket_id, object_path, kind, mime_type, size_bytes, rights_status, created_by, sha256_digest
    ) values (
      '${mediaAssetId}', '${wsA}', 'content-media',
      '${wsA}/${ownerA}/cover.png',
      'content', 'image/png', 1024, 'confirmed', '${ownerA}', repeat('a', 64)
    );

    insert into storage.objects (bucket_id, name, owner, metadata) values (
      'content-media', '${wsA}/${ownerA}/cover.png', '${ownerA}', '{"mimetype":"image/png","size":1024}'::jsonb
    );

    -- 5. Content item & version
    insert into public.content_items (id, workspace_id, channel, title, created_by) values (
      '${contentId}', '${wsA}', 'naver_blog', '네이버 블로그 게시물', '${ownerA}'
    );

    insert into public.content_versions (
      id, workspace_id, content_id, version_number, caption, fingerprint, created_by,
      rights, generation_evidence, structured_payload
    ) values (
      '${versionId}', '${wsA}', '${contentId}', 1, '네이버 블로그 본문 내용입니다.', '${fingerprint}', '${ownerA}',
      '{"confirmed": true}'::jsonb, '{"confirmed": true}'::jsonb, '{"visibility": "public"}'::jsonb
    );

    insert into public.content_version_media (workspace_id, version_id, media_asset_id, position) values (
      '${wsA}', '${versionId}', '${mediaAssetId}', 0
    );

    update public.content_items set current_version_id = '${versionId}' where id = '${contentId}';

    -- 6. Connector device & Browser channel connection
    insert into public.connector_devices (
      id, workspace_id, display_name, platform, client_version, token_digest, status, created_by
    ) values (
      '${deviceId}', '${wsA}', '네이버 테스트 연결기', 'macos', '0.1.0', repeat('b', 64), 'active', '${ownerA}'
    );

    insert into public.browser_channel_connections (
      id, workspace_id, device_id, channel, external_account_label, target_external_id,
      target_url, target_fingerprint, environment, status, verified_at
    ) values (
      '${connectionId}', '${wsA}', '${deviceId}', 'naver_blog', 'findk3', 'findk3',
      'https://blog.naver.com/findk3/postwrite?categoryNo=1', repeat('c', 64), 'test', 'connected', now()
    );
  `)
  if (setup.status !== 0) {
    throw new Error(`Fixture setup failed: ${setup.stderr}`)
  }

  // Verify the content version is recognized as publishable
  const [publishable] = query<{ ok: boolean }>(
    `select private.is_content_version_publishable('${wsA}', '${versionId}') as ok`
  )
  expect(publishable.ok).toBe(true)
})

describe('ANI-1140 approve_and_dispatch_local_content integration tests', () => {
  describe('(e) function privileges on exact signature', () => {
    it('grants EXECUTE to authenticated and service_role, denies anon and public', () => {
      const [authPriv] = query<{ ok: boolean }>(
        `select has_function_privilege('authenticated', '${exactSignature}', 'EXECUTE') as ok`
      )
      expect(authPriv.ok).toBe(true)

      const [srPriv] = query<{ ok: boolean }>(
        `select has_function_privilege('service_role', '${exactSignature}', 'EXECUTE') as ok`
      )
      expect(srPriv.ok).toBe(true)

      const [anonPriv] = query<{ ok: boolean }>(
        `select has_function_privilege('anon', '${exactSignature}', 'EXECUTE') as ok`
      )
      expect(anonPriv.ok).toBe(false)

      const [pubPriv] = query<{ ok: boolean }>(
        `select has_function_privilege('public', '${exactSignature}', 'EXECUTE') as ok`
      )
      expect(pubPriv.ok).toBe(false)

      const [publicAcl] = query<{ has_public: boolean }>(
        `select exists (
          select 1 from pg_catalog.aclexplode(
            (select coalesce(proacl, pg_catalog.acldefault('f', proowner))
             from pg_catalog.pg_proc
             where oid = '${exactSignature}'::regprocedure)
          )
          where grantee = 0 and privilege_type = 'EXECUTE'
        ) as has_public`
      )
      expect(publicAcl.has_public).toBe(false)
    })
  })

  describe('(b) authenticated viewer and reviewer role guards', () => {
    it('forbids viewer from calling approve_only and publish_now, without writing approvals', () => {
      const appRes = callDispatch({ userId: viewerA, mode: 'approve_only', commit: true })
      expect(appRes.status).not.toBe(0)
      expect(appRes.stderr).toContain('LOCAL_PUBLISH_DISPATCH_FORBIDDEN')

      const pubRes = callDispatch({ userId: viewerA, mode: 'publish_now', commit: true })
      expect(pubRes.status).not.toBe(0)
      expect(pubRes.stderr).toContain('LOCAL_PUBLISH_DISPATCH_FORBIDDEN')

      const [approvals] = query<{ count: number }>(
        `select count(*)::int as count from public.approvals where workspace_id = '${wsA}'`
      )
      expect(approvals.count).toBe(0)

      const [requests] = query<{ count: number }>(
        `select count(*)::int as count from public.external_action_requests where workspace_id = '${wsA}'`
      )
      expect(requests.count).toBe(0)
    })

    it('forbids reviewer from calling approve_only and publish_now, without writing approvals', () => {
      const appRes = callDispatch({ userId: reviewerA, mode: 'approve_only', commit: true })
      expect(appRes.status).not.toBe(0)
      expect(appRes.stderr).toContain('LOCAL_PUBLISH_DISPATCH_FORBIDDEN')

      const pubRes = callDispatch({ userId: reviewerA, mode: 'publish_now', commit: true })
      expect(pubRes.status).not.toBe(0)
      expect(pubRes.stderr).toContain('LOCAL_PUBLISH_DISPATCH_FORBIDDEN')

      const [approvals] = query<{ count: number }>(
        `select count(*)::int as count from public.approvals where workspace_id = '${wsA}'`
      )
      expect(approvals.count).toBe(0)

      const [requests] = query<{ count: number }>(
        `select count(*)::int as count from public.external_action_requests where workspace_id = '${wsA}'`
      )
      expect(requests.count).toBe(0)
    })
  })

  describe('(c) authenticated owner of another workspace isolation', () => {
    it('rejects foreign workspace owner for approve_only and publish_now, writing nothing', () => {
      const appRes = callDispatch({
        userId: ownerB,
        workspaceId: wsA,
        mode: 'approve_only',
        commit: true,
      })
      expect(appRes.status).not.toBe(0)
      expect(appRes.stderr).toContain('LOCAL_PUBLISH_DISPATCH_FORBIDDEN')

      const pubRes = callDispatch({
        userId: ownerB,
        workspaceId: wsA,
        mode: 'publish_now',
        commit: true,
      })
      expect(pubRes.status).not.toBe(0)
      expect(pubRes.stderr).toContain('LOCAL_PUBLISH_DISPATCH_FORBIDDEN')

      const [approvals] = query<{ count: number }>(
        `select count(*)::int as count from public.approvals where workspace_id = '${wsA}'`
      )
      expect(approvals.count).toBe(0)

      const [requests] = query<{ count: number }>(
        `select count(*)::int as count from public.external_action_requests where workspace_id = '${wsA}'`
      )
      expect(requests.count).toBe(0)
    })
  })

  describe('(d) call without user JWT subject (null auth.uid())', () => {
    it('service_role without JWT subject raises LOCAL_PUBLISH_DISPATCH_FORBIDDEN', () => {
      const res = callDispatch({
        role: 'service_role',
        userId: null,
        mode: 'publish_now',
        commit: true,
      })
      expect(res.status).not.toBe(0)
      expect(res.stderr).toContain('LOCAL_PUBLISH_DISPATCH_FORBIDDEN')
    })

    it('authenticated role without JWT subject raises LOCAL_PUBLISH_DISPATCH_FORBIDDEN', () => {
      const res = callDispatch({
        role: 'authenticated',
        userId: null,
        mode: 'publish_now',
        commit: true,
      })
      expect(res.status).not.toBe(0)
      expect(res.stderr).toContain('LOCAL_PUBLISH_DISPATCH_FORBIDDEN')
    })

    it('anon role context raises permission denied (SQL state 42501)', () => {
      const res = callDispatch({
        role: 'anon',
        mode: 'publish_now',
        commit: true,
      })
      expect(res.status).not.toBe(0)
      expect(res.stderr).toMatch(/permission denied|42501/i)
    })

    it('confirms no approvals or action requests were written by unauthenticated calls', () => {
      const [approvals] = query<{ count: number }>(
        `select count(*)::int as count from public.approvals where workspace_id = '${wsA}'`
      )
      expect(approvals.count).toBe(0)

      const [requests] = query<{ count: number }>(
        `select count(*)::int as count from public.external_action_requests where workspace_id = '${wsA}'`
      )
      expect(requests.count).toBe(0)
    })
  })

  describe('(a) authenticated owner can approve and dispatch local content', () => {
    let firstResult: DispatchResult

    it('creates an approval, scheduled content status, and ready external action request', () => {
      const run = callDispatch({
        userId: ownerA,
        mode: 'publish_now',
        commit: true,
      })
      expect(run.status).toBe(0)
      firstResult = parseDispatchResult(run)

      expect(firstResult.next).toBe('publishing')
      expect(firstResult.approvalId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
      )
      expect(firstResult.actionRequestId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
      )

      // Verify approval row
      const [approval] = query<{
        status: string
        fingerprint: string
        decided_by: string
      }>(
        `select status, fingerprint, decided_by::text from public.approvals where id = '${firstResult.approvalId}'`
      )
      expect(approval).toBeDefined()
      expect(approval.status).toBe('approved')
      expect(approval.fingerprint).toBe(fingerprint)
      expect(approval.decided_by).toBe(ownerA)

      // Verify content_items status was transitioned to scheduled
      const [contentItem] = query<{ status: string }>(
        `select status from public.content_items where id = '${contentId}'`
      )
      expect(contentItem.status).toBe('scheduled')

      // Verify external_action_requests row
      const [actionRequest] = query<{
        id: string
        status: string
        channel: string
        action_kind: string
        idempotency_key: string
        created_by: string
        browser_channel_connection_id: string
        target_external_id: string
        target_label: string
        exact_payload: {
          contentId: string
          versionId: string
          fingerprint: string
          visibility: string
        }
      }>(
        `select id, status, channel, action_kind, idempotency_key, created_by::text,
                browser_channel_connection_id::text, target_external_id, target_label, exact_payload
         from public.external_action_requests
         where id = '${firstResult.actionRequestId}'`
      )
      expect(actionRequest).toBeDefined()
      expect(actionRequest.status).toBe('ready')
      expect(actionRequest.idempotency_key).toBe(
        `local:${firstResult.approvalId}:publish_now:now`
      )
      expect(actionRequest.channel).toBe('naver_blog')
      expect(actionRequest.action_kind).toBe('blog_post')
      expect(actionRequest.created_by).toBe(ownerA)
      expect(actionRequest.browser_channel_connection_id).toBe(connectionId)
      expect(actionRequest.target_external_id).toBe('findk3')
      expect(actionRequest.target_label).toBe('findk3')
      expect(actionRequest.exact_payload).toEqual({
        contentId,
        versionId,
        fingerprint,
        visibility: 'public',
      })
    })

    it('calling again is idempotent and returns the same actionRequestId', () => {
      const run2 = callDispatch({
        userId: ownerA,
        mode: 'publish_now',
        commit: true,
      })
      expect(run2.status).toBe(0)
      const secondResult: DispatchResult = parseDispatchResult(run2)

      expect(secondResult.actionRequestId).toBe(firstResult.actionRequestId)
      expect(secondResult.approvalId).toBe(firstResult.approvalId)
      expect(secondResult.next).toBe('publishing')

      // Confirm only 1 action request exists
      const [reqCount] = query<{ count: number }>(
        `select count(*)::int as count from public.external_action_requests where workspace_id = '${wsA}'`
      )
      expect(reqCount.count).toBe(1)
    })
  })
})
