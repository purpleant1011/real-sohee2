import { NextRequest } from 'next/server'
import { beforeEach, expect, it, vi } from 'vitest'
import { ForbiddenError } from '@/lib/auth/workspace-actor-guard'
import { GET } from './route'

const { verify, client, extension, preview } = vi.hoisted(() => ({ verify: vi.fn(), client: vi.fn(), extension: vi.fn(), preview: vi.fn() }))
vi.mock('@/features/approvals/approval-preview-repository', () => ({ getApprovalPreview: preview }))
vi.mock('@/lib/auth/workspace-actor-guard', async original => ({ ...await original<typeof import('@/lib/auth/workspace-actor-guard')>(), verifyWorkspaceActor: verify }))
vi.mock('@/lib/supabase/server', () => ({ createServerSupabaseClient: client }))
vi.mock('@/features/missions/first-post-draft-extension', () => ({ readDraftExtensionEvidence: extension, extendFirstPostDraft: (draft: object) => ({ ...draft, datasetMode: 'ACTUAL', channels: [], costQuote: { amountKrw: 0, source: 'POLICY' } }) }))
const workspaceId = '00000000-0000-0000-0000-000000000001'
const runId = '00000000-0000-0000-0000-000000000002'
const missionId = '00000000-0000-0000-0000-000000000003'
const context = { params: Promise.resolve({ workspaceId }) }
const request = () => new NextRequest(`http://localhost/api/workspaces/${workspaceId}/agent/evidence?runId=${runId}&missionId=${missionId}`)
let records: Record<string, unknown[]>
let queries: { table: string; filters: Record<string, unknown> }[]
beforeEach(() => {
  vi.clearAllMocks()
  verify.mockResolvedValue({ workspaceId })
  extension.mockResolvedValue({ datasetMode: 'ACTUAL', connections: [], credentials: [], receipts: [] })
  records = {
    conversation_jobs: [{ id: runId, workspace_id: workspaceId, plan_data: { missionId } }],
    marketing_missions: [{ id: missionId, workspace_id: workspaceId, metadata: {} }],
    conversation_job_steps: [{ workspace_id: workspaceId, job_id: runId, capability_id: 'reservation.list', status: 'completed', completed_at: '2026-10-26T10:00:00Z', output_payload: { count: 1, empty: false, reservations: [{ name: 'CUSTOMER_PRIVATE', phone: '010-1234-5678' }] } }],
  }
  queries = []
  client.mockResolvedValue({ from(table: string) {
    const filters: Record<string, unknown> = {}
    queries.push({ table, filters })
    const filtered = () => (records[table] ?? []).filter((row: any) => Object.entries(filters).every(([key, value]) => row[key] === value))
    const chain: any = { select: () => chain, eq: (key: string, value: unknown) => { filters[key] = value; return chain }, order: () => chain, limit: () => chain,
      maybeSingle: async () => ({ data: filtered()[0] ?? null, error: null }), then: (resolve: any) => Promise.resolve({ data: filtered(), error: null }).then(resolve) }
    return chain
  } })
})

it('비회원은 저장된 원본 결과를 조회하기 전에 차단한다', async () => {
  verify.mockRejectedValueOnce(new ForbiddenError())
  expect((await GET(request(), context)).status).toBe(403)
  expect(queries).toEqual([])
})
it('인증된 같은 미션 실행의 예약 건수만 반환하고 개인정보를 전송하지 않는다', async () => {
  const response = await GET(request(), context)
  expect(response.status).toBe(200)
  const body = await response.json()
  expect(body.evidence.reservations).toEqual({ state: 'CONFIRMED', count: 1, observedAt: '2026-10-26T10:00:00Z' })
  expect(body.evidence.price).toEqual({ state: 'UNKNOWN' })
  expect(JSON.stringify(body)).not.toMatch(/CUSTOMER_PRIVATE|010-1234|output_payload/)
  expect(queries.every(query => query.filters.workspace_id === workspaceId)).toBe(true)
  expect(response.headers.get('cache-control')).toContain('no-store')
})
it('다른 미션의 실행을 끼워 넣으면 도구 원장을 읽지 않는다', async () => {
  records.conversation_jobs = [{ id: runId, workspace_id: workspaceId, plan_data: { missionId: 'other' } }]
  expect((await GET(request(), context)).status).toBe(404)
  expect(queries.some(query => query.table === 'conversation_job_steps')).toBe(false)
})
it('테넌트가 다른 실행은 반환하지 않는다', async () => {
  records.conversation_jobs = [{ id: runId, workspace_id: 'other', plan_data: { missionId } }]
  expect((await GET(request(), context)).status).toBe(404)
})
it('연습 작업공간의 예약 결과를 실제 확인으로 표시하지 않는다', async () => {
  extension.mockResolvedValueOnce({ datasetMode: 'TEST', connections: [], credentials: [], receipts: [] })
  const response = await GET(request(), context)
  expect((await response.json()).evidence.reservations).toEqual({ state: 'UNKNOWN' })
})
it('해당 작업공간·미션의 첫 게시 초안에만 무료 게시 정책을 적용한다', async () => {
  records.marketing_missions = [{ id: missionId, workspace_id: workspaceId, metadata: { draft: { missionId, workspaceId, copies: { instagram: { caption: '원고' } } } } }]
  const response = await GET(request(), context)
  expect((await response.json()).evidence.price).toEqual({ state: 'CONFIRMED', amountKrw: 0, source: 'FIRST_POST_POLICY' })
})
const contentId = '00000000-0000-0000-0000-000000000004'
const versionId = '00000000-0000-0000-0000-000000000005'
function artifactRequest() {
  return new NextRequest(`${request().url}&contentId=${contentId}&versionId=${versionId}`)
}
function bindArtifact() {
  records.marketing_missions = [{ id: missionId, workspace_id: workspaceId, content_id: contentId, content_version_id: versionId, metadata: {} }]
  preview.mockResolvedValue({ data: {
    workspaceId, contentId, versionId, versionNumber: 2, fingerprint: 'a'.repeat(64),
    approval: { id: null, status: 'unreviewed', fingerprint: null }, channel: 'instagram', visibility: null,
    account: { connectionId: 'connection-1', label: '@shop', status: 'connected' },
    caption: '검토할 원고', hashtags: ['가게소식'], disclosure: 'AI 보조 제작', text: '검토할 원고 #가게소식',
    media: [{ id: 'photo-1', position: 1, mimeType: 'image/jpeg', altText: '매장 사진', src: `/api/workspaces/${workspaceId}/media/photo-1`, width: 1080, height: 1350, sizeBytes: 240000 }],
    issues: [],
  } })
}

it('일반 원고의 미션·실행·버전을 묶어 검토하되 비용 미확인 승인은 차단한다', async () => {
  bindArtifact()
  const response = await GET(artifactRequest(), context)
  expect(response.status).toBe(200)
  const body = await response.json()
  expect(body.artifactReview).toMatchObject({
    preview: { workspaceId, contentId, versionId, caption: '검토할 원고', account: { label: '@shop' }, media: [{ position: 1, altText: '매장 사진' }] },
    cost: { state: 'UNKNOWN' }, approvalAllowed: false,
  })
  expect(body.artifactReview.blockers).toContain('게시 비용과 승인 범위를 아직 확인하지 못했습니다.')
  expect(preview).toHaveBeenCalledWith(workspaceId, contentId)
})
it.each(['content_id', 'content_version_id'])('미션에 연결되지 않은 %s의 검토를 차단한다', async field => {
  bindArtifact()
  ;(records.marketing_missions[0] as any)[field] = 'other'
  expect((await GET(artifactRequest(), context)).status).toBe(409)
  expect(preview).not.toHaveBeenCalled()
})
it('미리보기 조회 중 버전이 바뀌면 과거 승인 내용을 반환하지 않는다', async () => {
  bindArtifact()
  const value = await preview()
  preview.mockResolvedValue({ data: { ...value.data, versionId: 'new-version' } })
  const response = await GET(artifactRequest(), context)
  expect(response.status).toBe(409)
  expect((await response.json()).artifactReview).toBeUndefined()
})
it('사진 권리·연결 권한의 미확인 사유를 검토 차단 사유에 유지한다', async () => {
  bindArtifact()
  const value = await preview()
  preview.mockResolvedValue({ data: { ...value.data, issues: [{ code: 'media_rights', message: '모든 이미지의 사용권을 확인해 주세요.' }] } })
  const response = await GET(artifactRequest(), context)
  expect((await response.json()).artifactReview.blockers).toContain('모든 이미지의 사용권을 확인해 주세요.')
})
it('원고 검토 조회 실패를 근거 없는 승인 가능 상태로 바꾸지 않는다', async () => {
  bindArtifact()
  preview.mockResolvedValue({ error: { message: 'SECRET_ERROR', requestId: 'preview' } })
  const response = await GET(artifactRequest(), context)
  expect(response.status).toBe(503)
  expect(await response.text()).not.toContain('SECRET_ERROR')
})

it('DB 실패를 빈 성공으로 바꾸거나 원문을 노출하지 않는다', async () => {
  client.mockRejectedValueOnce(new Error('SECRET_DB_ERROR'))
  const response = await GET(request(), context)
  expect(response.status).toBe(503)
  expect(await response.text()).not.toContain('SECRET_DB_ERROR')
})
