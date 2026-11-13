// @vitest-environment node
import { it, vi } from 'vitest'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'
import { WORKSPACE, ACTOR, database, seed, readObject, receiveUpload, sql, storageProof } from '../../fixtures/firstpost-web/database'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/server', async () => ({ createServerSupabaseClient: async () => (await import('../../fixtures/firstpost-web/database')).database(true) }))
vi.mock('@/lib/supabase/admin', async () => ({ createAdminSupabaseClient: () => database() }))
vi.mock('@/features/quick-start/route-auth', () => ({
  authorizeQuickRequest: async (workspaceId: string) => workspaceId === WORKSPACE ? { workspaceId, userId: ACTOR, role: 'owner', supabase: database(true), admin: database() } : Response.json({ error: 'Other local workspace' }, { status: 403 }),
  isResponse: (value: unknown) => value instanceof Response,
}))
vi.mock('@/features/readiness/load', () => ({ loadReadiness: async () => ({ prepared: true, facts: Object.fromEntries(['BUSINESS_VERIFIED', 'BUSINESS_KNOWLEDGE_CONFIRMED', 'TEXT_HARNESS_CONFIRMED', 'IMAGE_HARNESS_CONFIRMED', 'OPERATING_POLICY_CONFIRMED'].map(key => [key, { verified: true }])), blockers: [] }) }))
vi.mock('@/features/readiness', () => ({ evaluateGate: () => ({ allowed: true }) }))
vi.mock('@/features/missions/conversational-first-post', async original => ({
  ...await original<typeof import('../../../src/features/missions/conversational-first-post')>(),
  composeFirstPostWithGemini: async () => ({ instagram: { caption: '격리 매장의 첫 소식을 전합니다.' }, threads: { content: '격리 매장의 첫 소식입니다.' } }),
}))
import { POST as propose } from '../../../src/app/api/missions/first-post/propose/route'
import { POST as revise } from '../../../src/app/api/missions/first-post/revise/route'
import { GET as getDraft } from '../../../src/app/api/missions/first-post/[missionId]/route'
import { POST as mediaPost, GET as mediaGet } from '../../../src/app/api/onboarding/media/route'
import { GET as inboxGet } from '../../../src/app/api/workspaces/[workspaceId]/mobile-inbox/route'
import { GET as inboxDetail } from '../../../src/app/api/workspaces/[workspaceId]/mobile-inbox/[threadKey]/route'
import { PATCH as replySave } from '../../../src/app/api/workspaces/[workspaceId]/mobile-inbox/[threadKey]/draft/route'
import { calculateApprovalFingerprint } from '../../../src/features/missions/conversational-first-post'

it.skipIf(process.env.SOHEE_FIRSTPOST_WEB !== '1')('loopback-only actual PostgreSQL/handlers first-post web harness', async () => {
  seed()
  const ledger: Array<{ method: string; path: string; status: number }> = []
  const root = resolve(process.cwd())
  const vite = await createServer({
    configFile: false, publicDir: resolve(root, 'public'), root: resolve(root, 'tests/fixtures/firstpost-web'),
    plugins: [react(), { name: 'isolated-firstpost-api', configureServer(server) {
      server.middlewares.use(async (incoming, outgoing, next) => {
        const path = new URL(incoming.url || '/', 'http://127.0.0.1:3102').pathname
        if (!path.startsWith('/api/') && !path.startsWith('/__')) return next()
        try {
          const chunks: Buffer[] = []
          for await (const chunk of incoming) chunks.push(Buffer.from(chunk))
          const bytes = Buffer.concat(chunks)
          const request = new Request(`http://127.0.0.1:3102${incoming.url}`, { method: incoming.method, headers: incoming.headers as Record<string, string>, ...(incoming.method !== 'GET' && incoming.method !== 'HEAD' ? { body: bytes } : {}) })
          let response: Response
          const detailMatch = /^\/api\/workspaces\/([^/]+)\/mobile-inbox\/([^/]+)(\/draft)?$/.exec(path)
          if (path === '/api/health') response = Response.json({ local: true }, { headers: { 'Cache-Control': 'no-store' } })
          else if (path === `/api/workspaces/${WORKSPACE}/mobile-inbox`) response = await inboxGet(request, { params: Promise.resolve({ workspaceId: WORKSPACE }) })
          else if (detailMatch && detailMatch[1] === WORKSPACE) {
            const context = { params: Promise.resolve({ workspaceId: WORKSPACE, threadKey: decodeURIComponent(detailMatch[2]) }) }
            response = await (incoming.method === 'PATCH' && detailMatch[3] ? replySave : inboxDetail)(request, context)
          }
          else if (path.startsWith('/__storage/')) {
            receiveUpload(path.split('/').at(-1)!, bytes)
            response = Response.json({ stored: true })
          } else if (path === '/__proof') {
            const missions = sql(`select coalesce(json_agg(r),'[]') from (select id,workspace_id,status,metadata from public.marketing_missions where workspace_id='${WORKSPACE}') r;`)
            response = Response.json({ replies: sql(`select coalesce(json_agg(r),'[]') from (select workspace_id,thread_id,draft_text,updated_at from public.instagram_dm_drafts where workspace_id='${WORKSPACE}') r;`), boundary: 'LOCAL_HARNESS_IDENTITY_READINESS_AI_FIXTURES_REAL_PG_AND_BYTES', ledger, storage: storageProof(), missions: missions.map(row => ({ ...row, recomputedFingerprint: calculateApprovalFingerprint(row.metadata.payload) })) })
          } else if (path === '/api/onboarding/media') response = await (incoming.method === 'POST' ? mediaPost : mediaGet)(request)
          else if (path === '/api/missions/first-post/propose') response = await propose(request)
          else if (path === '/api/missions/first-post/revise') response = await revise(request)
          else if (/^\/api\/missions\/first-post\/[a-f0-9-]{36}$/.test(path)) response = await getDraft(request, { params: Promise.resolve({ missionId: path.split('/').at(-1)! }) })
          else if (path.startsWith(`/api/workspaces/${WORKSPACE}/media/`)) {
            // 로컬 파일 transport만 대체. Supabase HTTPS signed URL 발급 증거로 쓰지 않는다.
            const assetId = path.split('/').at(-1)!
            const result = await database(true).from('media_assets').select('*').eq('workspace_id', WORKSPACE).eq('id', assetId).maybeSingle()
            response = result.data ? new Response(readObject(result.data.object_path), { headers: { 'Content-Type': result.data.mime_type, 'Cache-Control': 'no-store' } }) : new Response(null, { status: 404 })
          } else response = Response.json({ error: 'Approval/provider write is disabled in this local harness' }, { status: 403 })
          ledger.push({ method: incoming.method || 'GET', path, status: response.status })
          outgoing.statusCode = response.status
          response.headers.forEach((v, k) => outgoing.setHeader(k, v))
          outgoing.end(Buffer.from(await response.arrayBuffer()))
        } catch (error) { console.error('FIRSTPOST_LOCAL_HTTP_ERROR', error); outgoing.statusCode = 500; outgoing.end('Isolated harness failure') }
      })
    } }],
    resolve: { alias: { '@': resolve(root, 'src'), 'next/link': resolve(root, 'tests/fixtures/firstpost-web/link.tsx'), 'next/navigation': resolve(root, 'tests/fixtures/firstpost-web/navigation.ts') }, dedupe: ['react', 'react-dom'] },
    define: { 'process.env.NODE_ENV': '"development"', 'process.env.NEXT_PUBLIC_MOBILE_R2_FIRSTPOST': '"on"' },
    css: { postcss: root },
    server: { host: '127.0.0.1', port: 3102, strictPort: true, fs: { allow: [root] } },
  })
  await vite.listen()
  console.log('FIRSTPOST_WEB_READY http://127.0.0.1:3102/app/work/new (actual UI/handlers/PG/bytes, synthetic identity/readiness/AI, all external writes blocked)')
  await new Promise<void>(resolveStop => process.once('SIGTERM', resolveStop))
  await vite.close()
}, 3_600_000)
