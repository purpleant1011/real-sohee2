import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  user: { id: 'u', email: 'a@b.c' } as any,
  mission: null as any,
  resolved: { success: true, workspaceId: 'w1' } as any,
  lastEq: [] as Array<[string, string]>,
}))

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: async () => ({ auth: { getUser: async () => ({ data: { user: state.user } }) } }),
}))
vi.mock('@/features/auth/workspace-context', () => ({ resolveDeterministicWorkspace: async () => state.resolved }))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminSupabaseClient: () => ({
    from: () => {
      const q: any = {
        select: () => q,
        eq: (k: string, v: string) => { state.lastEq.push([k, v]); return q },
        maybeSingle: async () => ({ data: state.mission, error: null }),
      }
      return q
    },
  }),
}))

import { GET } from './route'

const ID = '11111111-1111-4111-8111-111111111111'
const call = () => GET(new Request('http://x'), { params: Promise.resolve({ missionId: ID }) })

const EXECUTION_RESULT = {
  overallStatus: 'ALL_VERIFIED',
  receipts: {
    instagram: {
      channel: 'instagram',
      stage: 'EXTERNALLY_VERIFIED',
      permalink: 'https://www.instagram.com/p/abc/',
      verifiedAt: '2026-10-24T01:00:00Z',
    },
  },
}

describe('GET /api/missions/first-post/[missionId]/outcome', () => {
  beforeEach(() => {
    state.user = { id: 'u' }
    state.resolved = { success: true, workspaceId: 'w1' }
    state.lastEq = []
    state.mission = {
      id: ID,
      status: 'PUBLISHED',
      metadata: {
        executionResult: EXECUTION_RESULT,
        approvedMission: { payload: { channels: [{ provider: 'instagram', handle: '@sohee' }] } },
      },
    }
  })

  it('로그인이 없으면 401', async () => {
    state.user = null
    expect((await call()).status).toBe(401)
  })

  it('UUID 가 아니면 422', async () => {
    const res = await GET(new Request('http://x'), { params: Promise.resolve({ missionId: 'nope' }) })
    expect(res.status).toBe(422)
  })

  it('조회는 현재 workspace 로 한정한다(다른 매장 미션은 404)', async () => {
    state.mission = null
    const res = await call()
    expect(res.status).toBe(404)
    expect(state.lastEq).toContainEqual(['workspace_id', 'w1'])
  })

  it('저장된 실행 결과를 그대로 내려준다(만들지 않는다)', async () => {
    const res = await call()
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.executionResult).toEqual(EXECUTION_RESULT)
    expect(body.approvedChannels).toEqual({ instagram: '@sohee' })
    expect(body.missionStatus).toBe('PUBLISHED')
    // 결과·계정 근거는 매장별 데이터이므로 공유 캐시에 남기지 않는다.
    expect(res.headers.get('cache-control')).toContain('no-store')
  })

  it('저장된 결과가 없으면 null 이다(빈 성공으로 위장하지 않는다)', async () => {
    state.mission = { id: ID, status: 'AWAITING_APPROVAL', metadata: {} }
    const body = await (await call()).json()
    expect(body.executionResult).toBeNull()
  })

  it('승인 스냅샷이 없으면 초안(draft)을 계정 대조 근거로 쓰지 않는다', async () => {
    state.mission = {
      id: ID,
      status: 'PUBLISHED',
      metadata: { draft: { channels: [{ provider: 'threads', handle: ' @b ' }] } },
    }
    const body = await (await call()).json()
    expect(body.approvedChannels).toEqual({})
  })

  it('승인 전 payload 만 있어도 계정 대조 근거로 승격하지 않는다', async () => {
    state.mission = {
      id: ID,
      status: 'AWAITING_APPROVAL',
      metadata: { payload: { channels: [{ provider: 'instagram', handle: '@draft_only' }] } },
    }
    const body = await (await call()).json()
    expect(body.approvedChannels).toEqual({})
  })

  it('오류 응답에도 no-store 를 붙인다', async () => {
    state.user = null
    const res = await call()
    expect(res.status).toBe(401)
    expect(res.headers.get('cache-control')).toContain('no-store')
  })
})
