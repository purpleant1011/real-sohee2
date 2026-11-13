import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import * as fs from 'node:fs'
import * as path from 'node:path'

// Mock dependencies for route
const {
  mockStorageRemove,
  mockStorageCreateSignedUrl,
  mockDbUpdateEq2,
  mockDbUpdateEq1,
  mockDbUpdate,
  mockDbDeleteEq2,
  mockDbDeleteEq1,
  mockDbDelete,
  mockRpc,
  mockOrchestratorExecute,
} = vi.hoisted(() => {
  const mockStorageRemove = vi.fn().mockResolvedValue({ error: null })
  const mockStorageCreateSignedUrl = vi.fn().mockResolvedValue({
    data: { signedUrl: 'https://images.example.com/dynamic-asset.png' },
    error: null,
  })
  const mockDbUpdateEq2 = vi.fn().mockResolvedValue({ data: null, error: null })
  const mockDbUpdateEq1 = vi.fn().mockReturnValue({ eq: mockDbUpdateEq2 })
  const mockDbUpdate = vi.fn().mockReturnValue({ eq: mockDbUpdateEq1 })

  const mockDbDeleteEq2 = vi.fn().mockResolvedValue({ data: null, error: null })
  const mockDbDeleteEq1 = vi.fn().mockReturnValue({ eq: mockDbDeleteEq2 })
  const mockDbDelete = vi.fn().mockReturnValue({ eq: mockDbDeleteEq1 })

  const mockRpc = vi.fn().mockResolvedValue({ data: null, error: null })

  const mockOrchestratorExecute = vi.fn().mockResolvedValue({
    runId: 'run-123',
    status: 'READY',
    mediaAsset: {
      id: 'asset-123',
      workspace_id: '00000000-0000-0000-0000-000000000001',
      bucket_id: 'content-media',
      object_path: 'workspaces/ws-1/media/source/asset-123/original.png',
      kind: 'content',
      source_type: 'GENERATED_OPENAI',
      mime_type: 'image/png',
      size_bytes: 1024,
      width: 1024,
      height: 1024,
      sha256_digest: 'b'.repeat(64),
      rights_status: 'approved',
      lifecycle_status: 'READY',
      publish_eligibility: true,
      generation_metadata: { model: 'gpt-image-2', provider: 'openai', providerRequestId: 'req-123' },
      created_by: 'system',
      created_at: new Date().toISOString(),
    },
  })

  return {
    mockStorageRemove,
    mockStorageCreateSignedUrl,
    mockDbUpdateEq2,
    mockDbUpdateEq1,
    mockDbUpdate,
    mockDbDeleteEq2,
    mockDbDeleteEq1,
    mockDbDelete,
    mockRpc,
    mockOrchestratorExecute,
  }
})

vi.mock('@/lib/auth/workspace-actor-guard', () => ({
  verifyWorkspaceActor: vi.fn().mockResolvedValue({
    actorId: 'usr-123',
    role: 'owner',
    workspaceId: '00000000-0000-0000-0000-000000000001',
    isTestAccount: false,
    datasetMode: 'ACTUAL',
  }),
  handleWorkspaceActorError: vi.fn(),
  redactErrorPayload: vi.fn((x) => x),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminSupabaseClient: vi.fn().mockReturnValue({
    rpc: mockRpc,
    storage: {
      from: vi.fn().mockReturnValue({
        createSignedUrl: mockStorageCreateSignedUrl,
        remove: mockStorageRemove,
      }),
    },
    from: vi.fn().mockReturnValue({
      update: mockDbUpdate,
      delete: mockDbDelete,
    }),
  }),
}))

vi.mock('@/features/content/canonical-content-lifecycle', () => ({
  CanonicalContentLifecycleService: {
    createContent: vi.fn().mockResolvedValue({
      contentId: '00000000-0000-0000-0000-000000000010',
      versionId: '00000000-0000-0000-0000-000000000020',
      fingerprint: 'a'.repeat(64),
      status: 'draft',
    }),
  },
}))

vi.mock('@/lib/agent-os/marketing-work-service', () => ({
  MarketingWorkService: {
    ensureMarketingWorkItem: vi.fn().mockResolvedValue({
      workItem: { id: '00000000-0000-0000-0000-000000000030' },
    }),
    linkContentToWorkItem: vi.fn().mockResolvedValue(undefined),
  },
}))

vi.mock('@/features/creative/production-generation-factory', () => ({
  createProductionGenerationOrchestrator: vi.fn().mockReturnValue({
    execute: (...args: any[]) => mockOrchestratorExecute(...args),
  }),
}))

// ANI-1753: chat 라우트가 세션·감사 경로에서 서버 Supabase 를 쓴다. 대역이 없으면
// 실제 요청이 나가 백그라운드 실패로 남고, 네트워크 가드가 그 위반을 테스트 실패로 보고한다.
vi.mock('@/lib/supabase/server', async () =>
  (await import('../../../../../../../../tests/unit/helpers/fake-supabase-server')).fakeServerSupabaseModule(),
)
vi.mock('@/lib/profile/workspace-profile-service', () => ({
  getWorkspaceProfile: vi.fn(),
  saveWorkspaceProfile: vi.fn(),
}))

import { POST } from '../route'
import * as profileService from '@/lib/profile/workspace-profile-service'

describe('Chat Route & System View Fixture Isolation (ANI-994)', () => {
  const workspaceId = '00000000-0000-0000-0000-000000000001'

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('PURPOSE_SELECTED returns dynamic options without hardcoded "바이름" or "청라" strings', async () => {
    vi.mocked(profileService.getWorkspaceProfile).mockResolvedValueOnce({
      business: {
        workspace_id: workspaceId,
        business_name: '오르다 베이커리',
        industry: '베이커리 카페',
        location: '서울 성동구 성수동',
        summary: '성수동 수제 베이커리',
        updated_at: '2026-09-07T12:00:00Z',
      },
      brand: {
        workspace_id: workspaceId,
        voice: '따뜻하고 정감있는',
        keywords: ['소금빵', '성수카페'],
        prohibited_terms: [],
        updated_at: '2026-09-07T12:00:00Z',
      },
    })

    const request = new NextRequest(`http://localhost/api/workspaces/${workspaceId}/agent/chat`, {
      method: 'POST',
      body: JSON.stringify({
        selectionData: {
          step: 'PURPOSE_SELECTED',
          purpose: '시그니처 소금빵 출시',
        },
      }),
    })

    const response = await POST(request, { params: Promise.resolve({ workspaceId }) })
    expect(response.status).toBe(200)

    const json = await response.json()
    const contentString = JSON.stringify(json)

    // Assert zero hardcoded fixture strings
    expect(contentString).not.toContain('바이름')
    expect(contentString).not.toContain('studio_by.reum')
    expect(contentString).not.toContain('청라 커넬웨이')
    expect(contentString).not.toContain('자연눈썹')

    // Assert dynamic business name is integrated
    const opt5 = json.interview.options.find((o: any) => o.id === 'opt_img_5')
    expect(opt5).toBeDefined()
    expect(opt5.description).toContain('오르다 베이커리')
  })

  it('COUNT_SELECTED produces preview with dynamic WorkspaceProfile metadata and zero forbidden strings', async () => {
    vi.mocked(profileService.getWorkspaceProfile).mockResolvedValueOnce({
      business: {
        workspace_id: workspaceId,
        business_name: '오르다 베이커리 Orda Bakery',
        industry: '베이커리 카페',
        location: '서울 성동구 성수동 1가',
        summary: '성수동 수제 베이커리',
        updated_at: '2026-09-07T12:00:00Z',
      },
      brand: {
        workspace_id: workspaceId,
        voice: '따뜻하고 감성적인',
        keywords: ['소금빵', '성수디저트'],
        prohibited_terms: [],
        updated_at: '2026-09-07T12:00:00Z',
      },
    })

    const request = new NextRequest(`http://localhost/api/workspaces/${workspaceId}/agent/chat`, {
      method: 'POST',
      body: JSON.stringify({
        selectionData: {
          step: 'COUNT_SELECTED',
          purpose: '봄맞이 딸기 크루아상 신메뉴',
          imageStyle: '자연광 감성 스마트폰 실사 샷',
          imageCount: '1',
        },
      }),
    })

    const response = await POST(request, { params: Promise.resolve({ workspaceId }) })
    expect(response.status).toBe(200)

    const json = await response.json()
    const contentString = JSON.stringify(json)

    // Zero forbidden strings
    expect(contentString).not.toContain('바이름')
    expect(contentString).not.toContain('studio_by.reum')
    expect(contentString).not.toContain('청라 커넬웨이')
    expect(contentString).not.toContain('눈썹')

    // Dynamic brand & business attributes in preview
    expect(json.preview.profileName).toBe('오르다 베이커리 Orda Bakery | 베이커리 카페')
    expect(json.preview.accountHandle).toBe('@ordabakery')
    expect(json.preview.caption).toContain('오르다 베이커리')
    expect(json.preview.caption).toContain('서울 성동구 성수동 1가')
    expect(json.preview.hashtags).toContain('#오르다베이커리OrdaBakery')
    expect(json.preview.hashtags).toContain('#베이커리카페')
    expect(json.preview.hashtags).toContain('#소금빵')
    expect(json.preview.hashtags).toContain('#성수디저트')
  })

  it('Static Audit: system-view.tsx contains zero fake TX-00001 rows and zero legacy "+50 Energy" strings', () => {
    const systemViewPath = path.resolve(process.cwd(), 'src/app/app/system/system-view.tsx')
    const content = fs.readFileSync(systemViewPath, 'utf8')

    // 1. Must not contain fake TX-00001 row
    expect(content).not.toContain('TX-00001')
    expect(content).not.toContain('신규 사업자 진위확인 완료: 1회성 무료 맛보기')

    // 2. Must not contain legacy Energy vocabulary in UI
    expect(content).not.toContain('+50 Energy')
    expect(content).not.toContain('가용 업무 에너지')
    expect(content).not.toContain('50 Agent Energy')
    expect(content).not.toContain('1,500 Agent Energy')
    expect(content).not.toContain('3,500 Agent Energy')
    expect(content).not.toContain('6,500 Agent Energy')

    // 3. UI hides credit balance/numbers, uses action log vocabulary
    expect(content).not.toContain('가용 크레딧 (Available Credits)')
    // 빈 배열 상수로 항상 "기록 없음"만 보여주던 가짜 로그 탭은 S3 에서 제거했다(실제 기록은 SystemTrustTabs 의 감사 로그).
    expect(content).not.toContain('CREDIT_LOGS')

    // 4. Billing section must not contain legacy 4-tier plan comparison, fake payment methods, or PaywallModal
    expect(content).not.toContain('ProofOfWorkPaywallModal')
    expect(content).not.toContain('등록된 결제 수단')
    expect(content).not.toContain('₩150,000')
    expect(content).not.toContain('₩300,000')
    expect(content).not.toContain('₩500,000')
    expect(content).not.toContain('플랜 업그레이드')
    expect(content).toContain('/app/account/billing')
  })

  describe('Post-generation channel source revocation cleanup & quarantine', () => {
    const originalEnv = process.env.SOHEE_CHANNEL_LEARNING_ENABLED

    beforeEach(() => {
      process.env.SOHEE_CHANNEL_LEARNING_ENABLED = '1'
      vi.mocked(profileService.getWorkspaceProfile).mockResolvedValue({
        business: {
          workspace_id: workspaceId,
          business_name: '오르다 베이커리',
          industry: '베이커리 카페',
          location: '서울 성동구',
          summary: '수제 베이커리',
          updated_at: '2026-09-07T12:00:00Z',
        },
        brand: {
          workspace_id: workspaceId,
          voice: '따뜻한',
          keywords: ['소금빵'],
          prohibited_terms: [],
          updated_at: '2026-09-07T12:00:00Z',
        },
      })
    })

    afterEach(() => {
      process.env.SOHEE_CHANNEL_LEARNING_ENABLED = originalEnv
    })

    it('사후 gate false -> 새로 생성된 자산을 workspace scope로 DB 격리 및 storage/DB 삭제 (scoped cleanup)', async () => {
      // 1. Setup mock RPC: learning context has visual dependency, but validation returns false
      mockRpc.mockImplementation((fn: string) => {
        if (fn === 'get_approved_learning_context') {
          return Promise.resolve({
            data: {
              epoch: 2,
              items: [
                {
                  category: 'visual',
                  content: '매장 감성 톤앤매너',
                  source_id: '11111111-1111-4111-8111-111111111111',
                  source_revision: 1,
                },
              ],
            },
            error: null,
          })
        }
        if (fn === 'validate_learning_result') {
          return Promise.resolve({ data: false, error: null })
        }
        return Promise.resolve({ data: null, error: null })
      })

      mockOrchestratorExecute.mockResolvedValueOnce({
        runId: 'run-gate-fail',
        status: 'READY',
        isReplay: false,
        mediaAsset: {
          id: 'asset-quarantine-1',
          workspace_id: workspaceId,
          bucket_id: 'content-media',
          object_path: 'workspaces/ws-1/media/source/asset-quarantine-1/original.png',
          kind: 'content',
          source_type: 'GENERATED_OPENAI',
          mime_type: 'image/png',
          size_bytes: 2048,
          width: 1024,
          height: 1024,
          sha256_digest: 'c'.repeat(64),
          rights_status: 'approved',
          lifecycle_status: 'READY',
          publish_eligibility: true,
          generation_metadata: { model: 'gpt-image-2', provider: 'openai', providerRequestId: 'req-gate-1' },
          created_by: 'system',
          created_at: new Date().toISOString(),
        },
      })

      const request = new NextRequest(`http://localhost/api/workspaces/${workspaceId}/agent/chat`, {
        method: 'POST',
        body: JSON.stringify({
          clientMessageId: '99999999-9999-4999-8999-999999999999',
          selectionData: {
            step: 'COUNT_SELECTED',
            purpose: '신메뉴 소금빵',
            imageStyle: '자연광 감성 스마트폰 실사 샷',
            imageCount: '1',
          },
        }),
      })

      const response = await POST(request, { params: Promise.resolve({ workspaceId }) })

      // Response must fail with 500 error, zero credit deduction, and no image preview URL
      expect(response.status).toBe(500)
      const json = await response.json()
      expect(json.status).toBe('FAILED')
      expect(json.creditDeduction).toBeUndefined()
      expect(json.preview).toBeUndefined()
      expect(json.visualImage).toBeUndefined()

      // Scoped quarantine update must precede or accompany cleanup
      expect(mockDbUpdate).toHaveBeenCalledWith({
        publish_eligibility: false,
        lifecycle_status: 'QUARANTINED',
      })
      expect(mockDbUpdateEq1).toHaveBeenCalledWith('id', 'asset-quarantine-1')
      expect(mockDbUpdateEq2).toHaveBeenCalledWith('workspace_id', workspaceId)

      // Storage remove must be called for the specific object path
      expect(mockStorageRemove).toHaveBeenCalledWith([
        'workspaces/ws-1/media/source/asset-quarantine-1/original.png',
      ])

      // DB delete must be strictly scoped to id and workspace_id
      expect(mockDbDelete).toHaveBeenCalled()
      expect(mockDbDeleteEq1).toHaveBeenCalledWith('id', 'asset-quarantine-1')
      expect(mockDbDeleteEq2).toHaveBeenCalledWith('workspace_id', workspaceId)
    })

    it('사후 gate false + DB/Storage 모두 실패 -> 500 에러로 URL 및 이미지 응답 차단하고 결제 미차감 유지', async () => {
      mockRpc.mockImplementation((fn: string) => {
        if (fn === 'get_approved_learning_context') {
          return Promise.resolve({
            data: {
              epoch: 2,
              items: [
                {
                  category: 'visual',
                  content: '매장 감성 톤앤매너',
                  source_id: '11111111-1111-4111-8111-111111111111',
                  source_revision: 1,
                },
              ],
            },
            error: null,
          })
        }
        if (fn === 'validate_learning_result') {
          return Promise.resolve({ data: false, error: null })
        }
        return Promise.resolve({ data: null, error: null })
      })

      // Simulate both DB and Storage failures during cleanup
      mockDbUpdateEq2.mockResolvedValueOnce({ data: null, error: new Error('DB update connection reset') })
      mockStorageRemove.mockResolvedValueOnce({ error: new Error('S3 remove timeout') })
      mockDbDeleteEq2.mockResolvedValueOnce({ data: null, error: new Error('DB delete failure') })

      mockOrchestratorExecute.mockResolvedValueOnce({
        runId: 'run-gate-fail-all-errors',
        status: 'READY',
        isReplay: false,
        mediaAsset: {
          id: 'asset-fail-cleanup',
          workspace_id: workspaceId,
          bucket_id: 'content-media',
          object_path: 'workspaces/ws-1/media/source/asset-fail-cleanup/original.png',
          kind: 'content',
          source_type: 'GENERATED_OPENAI',
          mime_type: 'image/png',
          size_bytes: 2048,
          width: 1024,
          height: 1024,
          sha256_digest: 'd'.repeat(64),
          rights_status: 'approved',
          lifecycle_status: 'READY',
          publish_eligibility: true,
          generation_metadata: { model: 'gpt-image-2', provider: 'openai' },
          created_by: 'system',
          created_at: new Date().toISOString(),
        },
      })

      const request = new NextRequest(`http://localhost/api/workspaces/${workspaceId}/agent/chat`, {
        method: 'POST',
        body: JSON.stringify({
          clientMessageId: '88888888-8888-4888-8888-888888888888',
          selectionData: {
            step: 'COUNT_SELECTED',
            purpose: '신메뉴 소금빵',
            imageStyle: '자연광 감성 스마트폰 실사 샷',
            imageCount: '1',
          },
        }),
      })

      const response = await POST(request, { params: Promise.resolve({ workspaceId }) })

      expect(response.status).toBe(500)
      const json = await response.json()
      expect(json.status).toBe('FAILED')
      expect(json.creditDeduction).toBeUndefined()
      // Must not leak mediaUrl or preview images
      expect(json.preview).toBeUndefined()
      expect(json.visualImage).toBeUndefined()
      expect(JSON.stringify(json)).not.toContain('asset-fail-cleanup')
    })

    it('사후 gate true -> 정상 200 반환 및 생성된 이미지 유지 (정리 미실행)', async () => {
      mockRpc.mockImplementation((fn: string) => {
        if (fn === 'get_approved_learning_context') {
          return Promise.resolve({
            data: {
              epoch: 2,
              items: [
                {
                  category: 'visual',
                  content: '매장 감성 톤앤매너',
                  source_id: '11111111-1111-4111-8111-111111111111',
                  source_revision: 1,
                },
              ],
            },
            error: null,
          })
        }
        if (fn === 'validate_learning_result') {
          return Promise.resolve({ data: true, error: null })
        }
        return Promise.resolve({ data: null, error: null })
      })

      mockOrchestratorExecute.mockResolvedValueOnce({
        runId: 'run-gate-success',
        status: 'READY',
        isReplay: false,
        mediaAsset: {
          id: 'asset-success',
          workspace_id: workspaceId,
          bucket_id: 'content-media',
          object_path: 'workspaces/ws-1/media/source/asset-success/original.png',
          kind: 'content',
          source_type: 'GENERATED_OPENAI',
          mime_type: 'image/png',
          size_bytes: 2048,
          width: 1024,
          height: 1024,
          sha256_digest: 'e'.repeat(64),
          rights_status: 'approved',
          lifecycle_status: 'READY',
          publish_eligibility: true,
          generation_metadata: { model: 'gpt-image-2', provider: 'openai' },
          created_by: 'system',
          created_at: new Date().toISOString(),
        },
      })

      const request = new NextRequest(`http://localhost/api/workspaces/${workspaceId}/agent/chat`, {
        method: 'POST',
        body: JSON.stringify({
          clientMessageId: '77777777-7777-4777-8777-777777777777',
          selectionData: {
            step: 'COUNT_SELECTED',
            purpose: '신메뉴 소금빵',
            imageStyle: '자연광 감성 스마트폰 실사 샷',
            imageCount: '1',
          },
        }),
      })

      const response = await POST(request, { params: Promise.resolve({ workspaceId }) })

      expect(response.status).toBe(200)
      const json = await response.json()
      expect(json.visualImage).toBeDefined()
      expect(json.preview.images).toHaveLength(1)
      // Cleanup must NOT be called
      expect(mockStorageRemove).not.toHaveBeenCalled()
      expect(mockDbDelete).not.toHaveBeenCalled()
    })

    it('사후 gate false이지만 isReplay: true인 경우 기존 자산 보호 (정리 미실행)', async () => {
      mockRpc.mockImplementation((fn: string) => {
        if (fn === 'get_approved_learning_context') {
          return Promise.resolve({
            data: {
              epoch: 2,
              items: [
                {
                  category: 'visual',
                  content: '매장 감성 톤앤매너',
                  source_id: '11111111-1111-4111-8111-111111111111',
                  source_revision: 1,
                },
              ],
            },
            error: null,
          })
        }
        if (fn === 'validate_learning_result') {
          return Promise.resolve({ data: false, error: null })
        }
        return Promise.resolve({ data: null, error: null })
      })

      mockOrchestratorExecute.mockResolvedValueOnce({
        runId: 'run-replay',
        status: 'READY',
        isReplay: true, // Replay from earlier idempotent run
        mediaAsset: {
          id: 'asset-replay',
          workspace_id: workspaceId,
          bucket_id: 'content-media',
          object_path: 'workspaces/ws-1/media/source/asset-replay/original.png',
          kind: 'content',
          source_type: 'GENERATED_OPENAI',
          mime_type: 'image/png',
          size_bytes: 2048,
          width: 1024,
          height: 1024,
          sha256_digest: 'f'.repeat(64),
          rights_status: 'approved',
          lifecycle_status: 'READY',
          publish_eligibility: true,
          generation_metadata: { model: 'gpt-image-2', provider: 'openai' },
          created_by: 'system',
          created_at: new Date().toISOString(),
        },
      })

      const request = new NextRequest(`http://localhost/api/workspaces/${workspaceId}/agent/chat`, {
        method: 'POST',
        body: JSON.stringify({
          clientMessageId: '66666666-6666-4666-8666-666666666666',
          selectionData: {
            step: 'COUNT_SELECTED',
            purpose: '신메뉴 소금빵',
            imageStyle: '자연광 감성 스마트폰 실사 샷',
            imageCount: '1',
          },
        }),
      })

      const response = await POST(request, { params: Promise.resolve({ workspaceId }) })

      expect(response.status).toBe(500)
      // Crucial: Replay asset must NOT be deleted or removed
      expect(mockStorageRemove).not.toHaveBeenCalled()
      expect(mockDbDelete).not.toHaveBeenCalled()
    })

    it('사후 gate false이지만 외부 원본이거나 타 workspace 자산인 경우 보호 (정리 미실행)', async () => {
      mockRpc.mockImplementation((fn: string) => {
        if (fn === 'get_approved_learning_context') {
          return Promise.resolve({
            data: {
              epoch: 2,
              items: [
                {
                  category: 'visual',
                  content: '매장 감성 톤앤매너',
                  source_id: '11111111-1111-4111-8111-111111111111',
                  source_revision: 1,
                },
              ],
            },
            error: null,
          })
        }
        if (fn === 'validate_learning_result') {
          return Promise.resolve({ data: false, error: null })
        }
        return Promise.resolve({ data: null, error: null })
      })

      mockOrchestratorExecute.mockResolvedValueOnce({
        runId: 'run-external',
        status: 'READY',
        isReplay: false,
        mediaAsset: {
          id: 'asset-external-insta',
          workspace_id: 'different-workspace-9999', // Other workspace!
          bucket_id: 'content-media',
          object_path: 'workspaces/ws-99/media/source/asset-external/original.png',
          kind: 'content',
          source_type: 'INSTAGRAM_SYNC', // External SNS original!
          mime_type: 'image/jpeg',
          size_bytes: 2048,
          width: 1024,
          height: 1024,
          sha256_digest: '9'.repeat(64),
          rights_status: 'approved',
          lifecycle_status: 'READY',
          publish_eligibility: true,
          generation_metadata: {},
          created_by: 'system',
          created_at: new Date().toISOString(),
        },
      })

      const request = new NextRequest(`http://localhost/api/workspaces/${workspaceId}/agent/chat`, {
        method: 'POST',
        body: JSON.stringify({
          clientMessageId: '55555555-5555-4555-8555-555555555555',
          selectionData: {
            step: 'COUNT_SELECTED',
            purpose: '신메뉴 소금빵',
            imageStyle: '자연광 감성 스마트폰 실사 샷',
            imageCount: '1',
          },
        }),
      })

      const response = await POST(request, { params: Promise.resolve({ workspaceId }) })

      expect(response.status).toBe(500)
      // Crucial: External SNS or different workspace asset must NEVER be deleted or removed
      expect(mockStorageRemove).not.toHaveBeenCalled()
      expect(mockDbDelete).not.toHaveBeenCalled()
    })
  })
})
