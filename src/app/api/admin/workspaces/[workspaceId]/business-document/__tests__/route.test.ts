import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { OperatorAccessError } from '@/features/operator-auth/current-operator'

const WS = '3f1c2b4e-5a6d-4e7f-8a9b-0c1d2e3f4a5b'
const OTHER_WS = '9a8b7c6d-5e4f-4a3b-9c2d-1e0f9a8b7c6d'
const FILE_ID = '0b1c2d3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e'
const VALID_PATH = `${WS}/${FILE_ID}.pdf`
const OPERATOR_USER_ID = '10000000-0000-4000-8000-000000000001'

const mocks = vi.hoisted(() => ({
  requireOperator: vi.fn(),
  adminFrom: vi.fn(),
  auditInsert: vi.fn(),
  createSignedUrl: vi.fn(),
}))

vi.mock('@/features/operator-auth/require-operator', () => ({
  requireOperator: mocks.requireOperator,
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminSupabaseClient: vi.fn(() => ({
    from: mocks.adminFrom,
    storage: {
      from: vi.fn(() => ({
        createSignedUrl: mocks.createSignedUrl,
      })),
    },
  })),
}))

import { GET } from '../route'

function getReq(url: string = `http://localhost:3000/api/admin/workspaces/${WS}/business-document`) {
  return new NextRequest(url, { method: 'GET' })
}

describe('GET /api/admin/workspaces/[workspaceId]/business-document', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireOperator.mockResolvedValue({ userId: OPERATOR_USER_ID })
    mocks.auditInsert.mockResolvedValue({ error: null })
    mocks.adminFrom.mockImplementation((table: string) => {
      if (table === 'audit_events') {
        return {
          insert: mocks.auditInsert,
        }
      }
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: { document_url: VALID_PATH },
          error: null,
        }),
      }
    })
    mocks.createSignedUrl.mockResolvedValue({
      data: { signedUrl: 'https://storage.example.com/signed/doc.pdf?token=abc' },
      error: null,
    })
  })

  it('권한 오류(PERMISSION_DENIED)는 403 고정 문구와 no-store 헤더를 반환하고 내부 메시지를 숨긴다', async () => {
    mocks.requireOperator.mockRejectedValueOnce(new OperatorAccessError('PERMISSION_DENIED'))
    const res = await GET(getReq(), { params: Promise.resolve({ workspaceId: WS }) })
    expect(res.status).toBe(403)
    expect(res.headers.get('cache-control')).toBe('no-store')
    const json = await res.json()
    expect(json.error).toBe('권한이 없어요.')
    expect(JSON.stringify(json)).not.toContain('PERMISSION_DENIED')
  })

  it('인증 필요(AUTH_REQUIRED) 오류는 401 고정 문구와 no-store 헤더를 반환한다', async () => {
    mocks.requireOperator.mockRejectedValueOnce(new OperatorAccessError('AUTH_REQUIRED'))
    const res = await GET(getReq(), { params: Promise.resolve({ workspaceId: WS }) })
    expect(res.status).toBe(401)
    expect(res.headers.get('cache-control')).toBe('no-store')
    const json = await res.json()
    expect(json.error).toBe('권한이 없어요.')
  })

  it('사업자등록증 문서가 없으면 404 및 no-store 헤더를 반환한다', async () => {
    mocks.adminFrom.mockImplementation((table: string) => {
      if (table === 'audit_events') return { insert: mocks.auditInsert }
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: null,
          error: null,
        }),
      }
    })
    const res = await GET(getReq(), { params: Promise.resolve({ workspaceId: WS }) })
    expect(res.status).toBe(404)
    expect(res.headers.get('cache-control')).toBe('no-store')
    const json = await res.json()
    expect(json.error).toBe('제출된 사업자등록증이 없어요.')
  })

  it('남의 워크스페이스 경로나 형식 위반 경로면 404 및 no-store 헤더를 반환한다', async () => {
    mocks.adminFrom.mockImplementation((table: string) => {
      if (table === 'audit_events') return { insert: mocks.auditInsert }
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: { document_url: `${OTHER_WS}/${FILE_ID}.pdf` },
          error: null,
        }),
      }
    })
    const res = await GET(getReq(), { params: Promise.resolve({ workspaceId: WS }) })
    expect(res.status).toBe(404)
    expect(res.headers.get('cache-control')).toBe('no-store')
    const json = await res.json()
    expect(json.error).toBe('제출된 사업자등록증이 없어요.')
  })

  it('정상 조회 시 감사 기록이 서명 URL 발급 전에 올바른 필드로 insert되고 200 no-store를 반환한다', async () => {
    const callOrder: string[] = []
    mocks.auditInsert.mockImplementationOnce(async () => {
      callOrder.push('auditInsert')
      return { error: null }
    })
    mocks.createSignedUrl.mockImplementationOnce(async () => {
      callOrder.push('createSignedUrl')
      return {
        data: { signedUrl: 'https://storage.example.com/signed/doc.pdf?token=abc' },
        error: null,
      }
    })

    const res = await GET(getReq(), { params: Promise.resolve({ workspaceId: WS }) })
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    const json = await res.json()
    expect(json.url).toBe('https://storage.example.com/signed/doc.pdf?token=abc')
    expect(json.expiresIn).toBe(60)

    expect(callOrder).toEqual(['auditInsert', 'createSignedUrl'])
    expect(mocks.auditInsert).toHaveBeenCalledWith({
      workspace_id: WS,
      actor_id: OPERATOR_USER_ID,
      event_type: 'business_document_view',
      entity_type: 'business_verification',
      metadata: { via: 'json' },
    })
    expect(mocks.createSignedUrl).toHaveBeenCalledWith(VALID_PATH, 60)
  })

  it('?redirect=1 쿼리가 있으면 감사 metadata.via가 redirect이고 302 리다이렉트 no-store를 반환한다', async () => {
    const res = await GET(
      getReq(`http://localhost:3000/api/admin/workspaces/${WS}/business-document?redirect=1`),
      { params: Promise.resolve({ workspaceId: WS }) }
    )
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('https://storage.example.com/signed/doc.pdf?token=abc')
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(mocks.auditInsert).toHaveBeenCalledWith({
      workspace_id: WS,
      actor_id: OPERATOR_USER_ID,
      event_type: 'business_document_view',
      entity_type: 'business_verification',
      metadata: { via: 'redirect' },
    })
  })

  it('감사 기록 insert 실패 시 서명 URL을 발급하지 않고 500 고정 문구와 no-store로 응답한다 (fail-closed)', async () => {
    mocks.auditInsert.mockResolvedValueOnce({
      error: { message: 'db audit failure' },
    })
    const res = await GET(getReq(), { params: Promise.resolve({ workspaceId: WS }) })
    expect(res.status).toBe(500)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(mocks.createSignedUrl).not.toHaveBeenCalled()
    const json = await res.json()
    expect(json.error).toBe('서류를 불러오지 못했어요.')
    expect(JSON.stringify(json)).not.toContain('db audit failure')
  })

  it('스토리지 서명 생성 실패 시 500 고정 문구와 no-store로 응답하고 내부 메시지를 숨긴다', async () => {
    mocks.createSignedUrl.mockResolvedValueOnce({
      data: null,
      error: { message: 'internal s3 connection timed out' },
    })
    const res = await GET(getReq(), { params: Promise.resolve({ workspaceId: WS }) })
    expect(res.status).toBe(500)
    expect(res.headers.get('cache-control')).toBe('no-store')
    const json = await res.json()
    expect(json.error).not.toContain('internal s3')
    expect(json.error).toBe('사업자등록증을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.')
  })
})
