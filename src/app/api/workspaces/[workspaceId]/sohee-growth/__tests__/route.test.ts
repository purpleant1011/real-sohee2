import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const WS = '3f1c2b4e-5a6d-4e7f-8a9b-0c1d2e3f4a5b'
const mocks = vi.hoisted(() => ({ guard: vi.fn(), load: vi.fn() }))

vi.mock('@/lib/auth/workspace-guard', () => ({ requireWorkspaceMembership: mocks.guard }))
vi.mock('@/features/sohee-growth/load-evidence', () => ({ loadGrowthEvidence: mocks.load }))

import { GET } from '../route'
import { EMPTY } from '@/features/sohee-growth/__tests__/fixtures'

const call = () =>
  GET(new NextRequest(`http://localhost:3000/api/workspaces/${WS}/sohee-growth`), { params: Promise.resolve({ workspaceId: WS }) })

beforeEach(() => {
  mocks.guard.mockReset()
  mocks.load.mockReset()
  mocks.guard.mockResolvedValue({ ok: true, userId: 'u1', role: 'owner', workspaceId: WS })
  mocks.load.mockResolvedValue(EMPTY)
})

describe('GET /api/workspaces/[workspaceId]/sohee-growth', () => {
  it('멤버십 확인에 실패하면 그 상태코드를 돌려주고 DB를 읽지 않는다', async () => {
    mocks.guard.mockResolvedValue({ ok: false, status: 403, error: 'FORBIDDEN', message: '권한이 없어요.' })
    const res = await call()
    expect(res.status).toBe(403)
    expect(mocks.load).not.toHaveBeenCalled()
  })

  it('스냅샷을 no-store 로 돌려준다', async () => {
    const res = await call()
    expect(res.status).toBe(200)
    expect(res.headers.get('Cache-Control')).toBe('no-store')
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data.completenessPercent).toBe(0)
    expect(body.data.jobs).toHaveLength(6)
    expect(mocks.load).toHaveBeenCalledWith(WS)
  })

  it('읽기 오류는 500 과 고정 문구만 돌려준다 (내부 메시지 비노출)', async () => {
    mocks.load.mockRejectedValue(new Error('GROWTH_EVIDENCE_READ_FAILED: permission denied for table x'))
    const res = await call()
    expect(res.status).toBe(500)
    const text = JSON.stringify(await res.json())
    expect(text).not.toContain('permission denied')
    expect(text).toContain('불러오지 못했어요')
  })
})
