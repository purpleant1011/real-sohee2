import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  user: { id: 'u', email: 'a@b.c' } as any,
  mission: null as any,
  resolved: { success: true, workspaceId: 'w1' } as any,
  lastEq: [] as Array<[string, string]>,
  registry: { dataset_mode: 'ACTUAL' } as any,
  connectionsError: null as any,
}))

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: async () => ({ auth: { getUser: async () => ({ data: { user: state.user } }) } }),
}))
vi.mock('@/features/auth/workspace-context', () => ({ resolveDeterministicWorkspace: async () => state.resolved }))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminSupabaseClient: () => ({
    from: (table: string) => {
      const q: any = {
        select: () => q,
        in: () => q,
        order: () => q,
        eq: (k: string, v: string) => { if (table === 'marketing_missions') state.lastEq.push([k, v]); return q },
        maybeSingle: async () => {
          if (table === 'workspace_registry') {
            return { data: state.registry, error: null }
          }
          return { data: state.mission, error: null }
        },
        then: (res: any) => {
          if (table === 'channel_connections' && state.connectionsError) {
            return res({ data: null, error: state.connectionsError })
          }
          return res({ data: [], error: null })
        },
      }
      return q
    },
  }),
}))

import { GET } from './route'

const ID = '11111111-1111-4111-8111-111111111111'
const call = () => GET(new Request('http://x'), { params: Promise.resolve({ missionId: ID }) })

describe('GET /api/missions/first-post/[missionId]', () => {
  beforeEach(() => {
    state.user = { id: 'u' }
    state.resolved = { success: true, workspaceId: 'w1' }
    state.lastEq = []
    state.registry = { dataset_mode: 'ACTUAL' }
    state.connectionsError = null
    state.mission = {
      id: ID,
      status: 'AWAITING_APPROVAL',
      metadata: { draft: { missionId: ID, approvalFingerprint: 'fp', channels: [{ provider: 'instagram', handle: '@a' }] } },
    }
  })

  it('저장 원문 응답은 오류 포함 private no-store이다', async () => {
    expect((await call()).headers.get('Cache-Control')).toContain('no-store')
    state.mission = null
    expect((await call()).headers.get('Cache-Control')).toContain('no-store')
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
  it('초안과 가산 필드를 돌려주고 승인 지문은 그대로다', async () => {
    const body = await (await call()).json()
    expect(body.draft.approvalFingerprint).toBe('fp')
    expect(body.draft.costQuote).toEqual({ amountKrw: 0, source: 'POLICY' })
    expect(body.draft.channels[0].handle).toBe('@a')
    expect(body.missionStatus).toBe('AWAITING_APPROVAL')
    expect(body.draft.datasetMode).toBe('ACTUAL')
  })

  it('evidence 읽기 실패 시 fallback 으로 datasetMode: UNKNOWN 명시 (기존 metadata ACTUAL 신뢰 금지)', async () => {
    state.mission = {
      id: ID,
      status: 'AWAITING_APPROVAL',
      metadata: {
        draft: {
          missionId: ID,
          approvalFingerprint: 'fp',
          channels: [{ provider: 'instagram', handle: '@a' }],
          datasetMode: 'ACTUAL', // metadata 에 ACTUAL 이 적혀 있어도 신뢰하지 않음
        },
      },
    }
    state.connectionsError = { message: 'connections read failed' }

    const body = await (await call()).json()
    expect(body.draft.approvalFingerprint).toBe('fp')
    expect(body.draft.datasetMode).toBe('UNKNOWN')
  })

  it('workspace_registry 가 SHOWCASE_DEMO 이면 draft.datasetMode: SHOWCASE_DEMO', async () => {
    state.registry = { dataset_mode: 'SHOWCASE_DEMO' }
    const body = await (await call()).json()
    expect(body.draft.datasetMode).toBe('SHOWCASE_DEMO')
  })
})
