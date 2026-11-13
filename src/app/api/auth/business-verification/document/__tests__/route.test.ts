import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextResponse } from 'next/server'

const WS = '3f1c2b4e-5a6d-4e7f-8a9b-0c1d2e3f4a5b'

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  upload: vi.fn(),
  list: vi.fn(),
}))

vi.mock('@/features/quick-start/route-auth', () => ({
  authorizeQuickRequest: mocks.authorize,
  isResponse: (v: any) => Boolean(v && typeof v.status === 'number' && typeof v.json === 'function'),
}))

import { POST } from '../route'

const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a, 0x25, 0xe2, 0xe3])

function fakeFile(bytes: Uint8Array, type: string) {
  return {
    name: 'license',
    type,
    size: bytes.byteLength,
    arrayBuffer: async () => bytes.slice().buffer,
    slice: (s = 0, e = bytes.byteLength) => ({ arrayBuffer: async () => bytes.slice(s, e).buffer }),
  }
}

function fakeRequest(file: unknown) {
  return {
    headers: new Headers(),
    formData: async () => ({ get: (key: string) => (key === 'file' ? file : null) }),
  } as unknown as Request
}

beforeEach(() => {
  mocks.authorize.mockReset()
  mocks.upload.mockReset()
  mocks.list.mockReset()
  mocks.authorize.mockResolvedValue({
    userId: 'user-1',
    workspaceId: WS,
    role: 'owner',
    supabase: {},
    admin: { storage: { from: () => ({ upload: mocks.upload, list: mocks.list }) } },
  })
  mocks.upload.mockResolvedValue({ error: null })
  mocks.list.mockResolvedValue({ data: [], error: null })
})

describe('POST /api/auth/business-verification/document', () => {
  it('이미 상한 개수만큼 올렸으면 429이고 저장하지 않는다', async () => {
    mocks.list.mockResolvedValue({ data: Array.from({ length: 10 }, (_, i) => ({ name: `f${i}.pdf` })), error: null })
    const res = await POST(fakeRequest(fakeFile(PDF, 'application/pdf')))
    expect(res.status).toBe(429)
    expect(mocks.upload).not.toHaveBeenCalled()
  })

  it('기존 파일 목록 조회 실패 시 500이고 저장하지 않는다', async () => {
    mocks.list.mockResolvedValue({ data: null, error: { message: 'storage list failed' } })
    const res = await POST(fakeRequest(fakeFile(PDF, 'application/pdf')))
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({
      error: '파일을 저장하지 못했어요. 잠시 후 다시 시도해 주세요.',
      code: 'UPLOAD_FAILED',
    })
    expect(mocks.upload).not.toHaveBeenCalled()
  })

  it('로그인 실패 응답을 그대로 돌려준다', async () => {
    mocks.authorize.mockResolvedValue(NextResponse.json({ error: '로그인이 필요해요.' }, { status: 401 }))
    const res = await POST(fakeRequest(fakeFile(PDF, 'application/pdf')))
    expect(res.status).toBe(401)
    expect(mocks.upload).not.toHaveBeenCalled()
  })

  it('파일이 없으면 400', async () => {
    const res = await POST(fakeRequest(null))
    expect(res.status).toBe(400)
    expect(mocks.upload).not.toHaveBeenCalled()
  })

  it('허용되지 않는 파일은 422로 거절하고 저장하지 않는다', async () => {
    const text = new TextEncoder().encode('hello')
    const res = await POST(fakeRequest(fakeFile(text, 'text/plain')))
    expect(res.status).toBe(422)
    expect(mocks.upload).not.toHaveBeenCalled()
  })

  it('정상 PDF는 워크스페이스 폴더에 저장하고 경로만 돌려준다', async () => {
    const res = await POST(fakeRequest(fakeFile(PDF, 'application/pdf')))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.documentPath).toMatch(new RegExp(`^${WS}/[0-9a-f-]{36}\\.pdf$`))
    expect(mocks.upload).toHaveBeenCalledWith(
      body.documentPath,
      expect.anything(),
      expect.objectContaining({ contentType: 'application/pdf', upsert: false }),
    )
  })

  it('저장소 오류는 500이고 내부 메시지를 노출하지 않는다', async () => {
    mocks.upload.mockResolvedValue({ error: { message: 'bucket exploded: secret detail' } })
    const res = await POST(fakeRequest(fakeFile(PDF, 'application/pdf')))
    expect(res.status).toBe(500)
    expect(JSON.stringify(await res.json())).not.toContain('secret detail')
  })
})
