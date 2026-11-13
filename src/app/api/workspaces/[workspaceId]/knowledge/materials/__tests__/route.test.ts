import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const WS = '3f1c2b4e-5a6d-4e7f-8a9b-0c1d2e3f4a5b'
const mocks = vi.hoisted(() => ({
  guard: vi.fn(),
  listMaterials: vi.fn(),
}))

vi.mock('@/lib/auth/workspace-guard', () => ({
  requireWorkspaceMembership: mocks.guard,
}))
vi.mock('@/features/sohee-materials/materials-service', () => ({
  listWorkspaceMaterials: mocks.listMaterials,
}))

import { GET } from '../route'

function createRequest() {
  return new NextRequest(
    `http://localhost:3000/api/workspaces/${WS}/knowledge/materials`,
    {
      method: 'GET',
    },
  )
}

const call = () =>
  GET(createRequest(), {
    params: Promise.resolve({ workspaceId: WS }),
  })

beforeEach(() => {
  mocks.guard.mockReset()
  mocks.listMaterials.mockReset()
  mocks.guard.mockResolvedValue({
    ok: true,
    userId: 'user-owner-1',
    role: 'owner',
    workspaceId: WS,
  })
  mocks.listMaterials.mockResolvedValue({
    items: [
      {
        id: 'mat-1',
        source: 'item',
        name: '사업자등록증.pdf',
        kind: 'file',
        status: 'learned',
        createdAt: '2026-10-01T00:00:00Z',
      },
    ],
    learnedCount: 1,
  })
})

describe('GET /api/workspaces/[workspaceId]/knowledge/materials', () => {
  it('비인증 사용자는 401을 반환하고 no-store 헤더를 갖는다', async () => {
    mocks.guard.mockResolvedValue({
      ok: false,
      status: 401,
      error: 'UNAUTHORIZED',
      message: '로그인이 필요해요.',
    })

    const res = await call()
    expect(res.status).toBe(401)
    expect(res.headers.get('Cache-Control')).toBe('no-store')
    expect(mocks.listMaterials).not.toHaveBeenCalled()
  })

  it('비멤버 사용자는 403을 반환하고 no-store 헤더를 갖는다', async () => {
    mocks.guard.mockResolvedValue({
      ok: false,
      status: 403,
      error: 'FORBIDDEN',
      message: '권한이 없어요.',
    })

    const res = await call()
    expect(res.status).toBe(403)
    expect(res.headers.get('Cache-Control')).toBe('no-store')
    expect(mocks.listMaterials).not.toHaveBeenCalled()
  })

  it('정상 멤버십 사용자의 자료 목록을 조회하고 200과 no-store 헤더를 반환한다', async () => {
    const res = await call()
    expect(res.status).toBe(200)
    expect(res.headers.get('Cache-Control')).toBe('no-store')

    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data).toEqual({
      items: [
        {
          id: 'mat-1',
          source: 'item',
          name: '사업자등록증.pdf',
          kind: 'file',
          status: 'learned',
          createdAt: '2026-10-01T00:00:00Z',
        },
      ],
      learnedCount: 1,
    })
    expect(mocks.listMaterials).toHaveBeenCalledWith(WS)
  })

  it('서비스 실패 시 500 고정 한국어 메시지를 반환하고 내부 오류를 노출하지 않는다', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const secretError = new TypeError('Internal database secret info leak')
    mocks.listMaterials.mockRejectedValue(secretError)

    const res = await call()
    expect(res.status).toBe(500)
    expect(res.headers.get('Cache-Control')).toBe('no-store')

    const body = await res.json()
    expect(body.success).toBe(false)
    expect(body.message).toBe('자료 목록을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.')
    expect(JSON.stringify(body)).not.toContain('secret info leak')

    // console.error에는 error.name만 기록되는지 확인
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('[knowledge-materials] failed:'),
      'TypeError',
    )
    consoleErrorSpy.mockRestore()
  })
})
