import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// These routes now run the shared cross-tenant guard before touching data, so the suite
// authenticates as a member of the workspace under test. Expectations are unchanged.
const { authorize, mockCompiler, mockKernel, mockRunner } = vi.hoisted(() => ({
  authorize: vi.fn(),
  mockCompiler: vi.fn(),
  mockKernel: vi.fn(),
  mockRunner: vi.fn(),
}))
vi.mock('@/features/quick-start/route-auth', () => ({
  authorizeQuickRequest: authorize,
  isResponse: (value: unknown) => value instanceof Response,
}))
vi.mock('@/features/harness/harness-compiler', () => ({
  HarnessCompiler: mockCompiler,
}))
vi.mock('@/features/harness/harness-kernel', () => ({
  HarnessKernel: mockKernel,
  harnessKernel: {},
}))
vi.mock('@/features/harness/harness-job-runner', () => ({
  HarnessJobRunner: mockRunner,
}))

import { GET as listHarness, POST as createHarness } from './route'
import { GET as getHarnessDetail } from './[harnessId]/route'
import { POST as addOverride } from './[harnessId]/override/route'
import { POST as assignChannel } from './[harnessId]/assign/route'
import { POST as previewHarness } from './preview/route'

describe('Harness Server Routes Integration (Supabase & REST API)', () => {
  const workspaceId = 'b1000000-0000-4000-8000-000000000001'
  const harnessId = 'harness_byreum_001'

  beforeEach(() => {
    authorize.mockReset()
    authorize.mockResolvedValue({ userId: 'user-owner', workspaceId, role: 'owner', supabase: {}, admin: {} })
    mockCompiler.mockClear()
    mockKernel.mockClear()
    mockRunner.mockClear()
  })

  it('POST /api/workspaces/[workspaceId]/harness returns 410 gone with replacement and does not invoke compiler/kernel/runner', async () => {
    const req = new NextRequest(`http://localhost:3000/api/workspaces/${workspaceId}/harness`, {
      method: 'POST',
      body: JSON.stringify({
        sourceUrl: 'https://blog.naver.com/my-shop',
      }),
    })
    const res = await createHarness(req, { params: Promise.resolve({ workspaceId }) })
    const data = await res.json()

    expect(res.status).toBe(410)
    expect(data.ok).toBe(false)
    expect(data.error).toBe('이 기능은 이미지 스타일 화면의 "링크로 한 번에 만들기"로 옮겨졌어요.')
    expect(data.replacement).toBe('/app/settings/image-style')
    expect(mockCompiler).not.toHaveBeenCalled()
    expect(mockKernel).not.toHaveBeenCalled()
    expect(mockRunner).not.toHaveBeenCalled()
  })

  it('GET /api/workspaces/[workspaceId]/harness returns workspace assets and assignments', async () => {
    const req = new NextRequest(`http://localhost:3000/api/workspaces/${workspaceId}/harness`)
    const res = await listHarness(req, { params: Promise.resolve({ workspaceId }) })
    const data = await res.json()

    expect(data.ok).toBe(true)
    expect(data.assets.length).toBeGreaterThan(0)
    expect(data.assets.some((a: any) => a.id === harnessId)).toBe(true)
  })

  it('GET /api/workspaces/[workspaceId]/harness/[harnessId] returns details, active version, and rules', async () => {
    const req = new NextRequest(`http://localhost:3000/api/workspaces/${workspaceId}/harness/${harnessId}`)
    const res = await getHarnessDetail(req, { params: Promise.resolve({ workspaceId, harnessId }) })
    const data = await res.json()

    expect(data.ok).toBe(true)
    expect(data.asset.id).toBe(harnessId)
    expect(data.version).toBeDefined()
    expect(data.rules.length).toBeGreaterThan(0)
  })

  it('POST /api/workspaces/[workspaceId]/harness/[harnessId]/override saves user custom rule', async () => {
    const req = new NextRequest(`http://localhost:3000/api/workspaces/${workspaceId}/harness/${harnessId}/override`, {
      method: 'POST',
      body: JSON.stringify({
        module: 'text',
        ruleKey: 'custom_cta',
        overrideValue: '네이버 예약 시 10% 추가 할인',
        reason: '3월 봄맞이 이벤트'
      })
    })
    const res = await addOverride(req, { params: Promise.resolve({ workspaceId, harnessId }) })
    const data = await res.json()

    expect(data.ok).toBe(true)
    expect(data.override.ruleKey).toBe('custom_cta')
    expect(data.override.overrideValue).toBe('네이버 예약 시 10% 추가 할인')
  })

  it('POST /api/workspaces/[workspaceId]/harness/[harnessId]/assign maps harness to channel', async () => {
    const req = new NextRequest(`http://localhost:3000/api/workspaces/${workspaceId}/harness/${harnessId}/assign`, {
      method: 'POST',
      body: JSON.stringify({
        channelId: 'ch_insta_main',
        channelName: '인스타그램 공식 계정',
        channelPlatform: 'instagram',
        enabled: true
      })
    })
    const res = await assignChannel(req, { params: Promise.resolve({ workspaceId, harnessId }) })
    const data = await res.json()

    expect(data.ok).toBe(true)
    expect(data.assignment.harnessAssetId).toBe(harnessId)
  })

  it('POST /api/workspaces/[workspaceId]/harness/preview generates 5.6 Luna AI simulation with SHA-256 hash', async () => {
    const req = new NextRequest(`http://localhost:3000/api/workspaces/${workspaceId}/harness/preview`, {
      method: 'POST',
      body: JSON.stringify({
        harnessId,
        targetPlatform: 'threads',
        topic: '봄맞이 눈썹 디자인 팁'
      })
    })
    const res = await previewHarness(req, { params: Promise.resolve({ workspaceId }) })
    const data = await res.json()

    expect(data.ok).toBe(true)
    expect(data.preview.promptHash).toBeDefined()
    expect(data.preview.content.length).toBeGreaterThan(0)
    expect(data.preview.evalResult.passed).toBe(true)
    expect(data.preview.provenance.compilerVersion).toBe('sohee-luna-5.6')
  })
})
