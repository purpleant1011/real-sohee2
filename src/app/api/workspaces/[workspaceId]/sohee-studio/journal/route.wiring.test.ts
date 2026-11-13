import { beforeEach, describe, expect, it, vi } from 'vitest'
import { journalSourceTypes, journalSourceKinds, KNOWLEDGE_JOURNAL_NOTICE } from '@/features/sohee-studio/knowledge-journal'
const mocks = vi.hoisted(() => ({ authorize: vi.fn(), load: vi.fn() }))
vi.mock('@/features/quick-start/route-auth', () => ({ authorizeQuickRequest: mocks.authorize, isResponse: (value: unknown) => value instanceof Response }))
vi.mock('@/features/sohee-studio/knowledge-journal.server', () => ({ loadKnowledgeJournal: mocks.load }))
import { GET } from './route'
const workspaceId = '20000000-0000-4000-8000-000000000001'
const admin = {}
const context = { params: Promise.resolve({ workspaceId }) }
beforeEach(() => {
  vi.clearAllMocks()
  mocks.authorize.mockResolvedValue({ workspaceId, admin })
  mocks.load.mockResolvedValue({ workspaceId, observedAt: '2026-10-30T00:00:00Z', entries: [], sources: journalSourceTypes.map(sourceType => ({ sourceType, kind: journalSourceKinds[sourceType], state: 'confirmed_empty', returnedCount: 0 })), partial: false, notice: KNOWLEDGE_JOURNAL_NOTICE })
})
describe('운영 일지 API 배선', () => {
  it('reviewer 이상 권한을 조회 전후에 검증하고 서버 읽기 클라이언트를 사용한다', async () => {
    const response = await GET(new Request('https://example.com/api/journal'), context)
    expect(response.status).toBe(200)
    expect(mocks.authorize).toHaveBeenCalledTimes(2)
    expect(mocks.authorize).toHaveBeenCalledWith(workspaceId, { requireRole: 'reviewer' })
    expect(mocks.load).toHaveBeenCalledWith({ workspaceId, client: admin, limit: 30 })
  })
  it('인증 모듈이 viewer를 거부하면 원장을 읽지 않는다', async () => {
    mocks.authorize.mockResolvedValue(new Response('forbidden', { status: 403 }))
    expect((await GET(new Request('https://example.com/api/journal'), context)).status).toBe(403)
    expect(mocks.load).not.toHaveBeenCalled()
  })
})
