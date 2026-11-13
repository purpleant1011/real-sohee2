import { describe, expect, it } from 'vitest'
import {
  resolveDeterministicWorkspace,
  selectInstagramGenerationContext,
  selectWorkspaceContext,
} from './workspace-context'

const workspaceA = '10000000-0000-4000-8000-000000000001'
const workspaceB = '10000000-0000-4000-8000-000000000002'

describe('selectWorkspaceContext', () => {
  it('선호한 활성 작업공간과 역할을 반환한다', () => {
    expect(
      selectWorkspaceContext(
        [
          { workspace_id: workspaceA, role: 'viewer', status: 'active' },
          { workspace_id: workspaceB, role: 'manager', status: 'active' },
        ],
        workspaceB,
      ),
    ).toEqual({ workspaceId: workspaceB, role: 'manager' })
  })

  it('선호 작업공간이 없으면 첫 활성 멤버십을 사용한다', () => {
    expect(
      selectWorkspaceContext([
        { workspace_id: workspaceA, role: 'reviewer', status: 'active' },
      ]),
    ).toEqual({ workspaceId: workspaceA, role: 'reviewer' })
  })

  it('초대 또는 비활성 멤버십은 선택하지 않는다', () => {
    expect(
      selectWorkspaceContext([
        { workspace_id: workspaceA, role: 'owner', status: 'invited' },
        { workspace_id: workspaceB, role: 'manager', status: 'disabled' },
      ]),
    ).toBeNull()
  })

  it('알 수 없는 역할은 권한으로 사용하지 않는다', () => {
    expect(
      selectWorkspaceContext([
        { workspace_id: workspaceA, role: 'admin', status: 'active' },
      ]),
    ).toBeNull()
  })

  it('UUID가 아닌 작업공간 식별자를 거절한다', () => {
    expect(
      selectWorkspaceContext([
        { workspace_id: 'ws-unsafe', role: 'owner', status: 'active' },
      ]),
    ).toBeNull()
  })

  it('배열이 아닌 응답은 안전하게 빈 상태로 처리한다', () => {
    expect(selectWorkspaceContext(null)).toBeNull()
    expect(selectWorkspaceContext({})).toBeNull()
  })

  it('호출자가 Array filter를 오염시켜도 권한이 바뀌지 않는다', () => {
    const originalFilter = Array.prototype.filter
    try {
      Array.prototype.filter = () => [
        { workspace_id: workspaceB, role: 'owner', status: 'active' },
      ]
      const selected = selectWorkspaceContext([
        { workspace_id: workspaceA, role: 'viewer', status: 'active' },
      ])
      expect(selected?.workspaceId).toBe(workspaceA)
      expect(selected?.role).toBe('viewer')
    } finally {
      Array.prototype.filter = originalFilter
    }
  })

  it('호출자가 Object.freeze를 오염시켜도 권한이 바뀌지 않는다', () => {
    const originalFreeze = Object.freeze
    try {
      Object.freeze = (() => ({ workspaceId: workspaceB, role: 'owner' })) as typeof Object.freeze
      expect(
        selectWorkspaceContext([
          { workspace_id: workspaceA, role: 'viewer', status: 'active' },
        ]),
      ).toEqual({ workspaceId: workspaceA, role: 'viewer' })
    } finally {
      Object.freeze = originalFreeze
    }
  })

  it('Proxy 배열 접근 오류를 외부로 던지지 않는다', () => {
    const poisoned = new Proxy([], {
      get(target, property, receiver) {
        if (property === 'length') throw new Error('PRIVATE_PROXY_DETAIL')
        return Reflect.get(target, property, receiver)
      },
    })

    expect(() => selectWorkspaceContext(poisoned)).not.toThrow()
    expect(selectWorkspaceContext(poisoned)).toBeNull()
  })
})

describe('selectInstagramGenerationContext', () => {
  it('selects only the current workspace business and brand profile values', () => {
    expect(selectInstagramGenerationContext({
      workspaceId: workspaceA,
      businessProfile: {
        workspace_id: workspaceA,
        business_name: '바이름',
        industry: '반영구 화장',
        location: '서울',
        summary: '자연스러운 눈썹 디자인',
      },
      brandProfile: {
        workspace_id: workspaceA,
        voice: '차분하고 친절한 말투',
        keywords: ['자연스러움'],
        prohibited_terms: ['완벽 보장'],
      },
    })).toEqual({
      businessName: '바이름',
      industry: '반영구 화장',
      location: '서울',
      businessSummary: '자연스러운 눈썹 디자인',
      brandVoice: '차분하고 친절한 말투',
      keywords: ['자연스러움'],
      prohibitedTerms: ['완벽 보장'],
      ownedKnowledgeSources: [],
      activeTextHarnesses: [],
    })
  })

  it('does not include a profile from another workspace', () => {
    expect(selectInstagramGenerationContext({
      workspaceId: workspaceA,
      businessProfile: {
        workspace_id: workspaceB,
        business_name: '다른 사업장',
        industry: null,
        location: null,
        summary: null,
      },
      brandProfile: null,
    })).toEqual({
      businessName: null,
      industry: null,
      location: null,
      businessSummary: null,
      brandVoice: null,
      keywords: [],
      prohibitedTerms: [],
      ownedKnowledgeSources: [],
      activeTextHarnesses: [],
    })
  })

  it('includes only owned URL knowledge sources from the current workspace', () => {
    expect(selectInstagramGenerationContext({
      workspaceId: workspaceA,
      businessProfile: null,
      brandProfile: null,
      knowledgeSources: [
        { workspace_id: workspaceA, channel_type: null, uri: null, refresh_policy: {}, status: 'approved' },
        { workspace_id: workspaceA, channel_type: 'naver_blog', uri: 'https://blog.naver.com/larlds', refresh_policy: { ownership: 'owned' }, status: 'collection_pending' },
        { workspace_id: workspaceA, channel_type: 'naver_place', uri: 'https://naver.me/5xgJJEBa', refresh_policy: { ownership: 'reference' }, status: 'registered' },
        { workspace_id: workspaceB, channel_type: 'daangn_business', uri: 'https://www.daangn.com/foreign', refresh_policy: { ownership: 'owned' }, status: 'registered' },
      ],
    }).ownedKnowledgeSources).toEqual([
      { channel: 'naver_blog', url: 'https://blog.naver.com/larlds', status: 'collection_pending' },
    ])
  })

  it('includes only active text harnesses that apply to the requested workspace', () => {
    expect(selectInstagramGenerationContext({
      workspaceId: workspaceA,
      businessProfile: null,
      brandProfile: null,
      harnessRules: [
        {
          workspace_id: workspaceA,
          rule_type: 'text_generation',
          title: '바이름 네이버 블로그 텍스트 하네스',
          description: '눈썹 반영구 상담과 디자인 기준을 과장 없이 설명합니다.',
          structured_rule: { service: 'eyebrow_semipermanent', goal: 'consultation_inquiry' },
          applies_to_channels: ['naver_blog'],
          status: 'active',
        },
        {
          workspace_id: workspaceA,
          rule_type: 'image_generation',
          title: '이미지 규칙',
          description: '이미지 전용',
          structured_rule: {},
          applies_to_channels: ['naver_blog'],
          status: 'active',
        },
        {
          workspace_id: workspaceB,
          rule_type: 'text_generation',
          title: '다른 작업공간 규칙',
          description: '포함되면 안 됩니다.',
          structured_rule: {},
          applies_to_channels: ['naver_blog'],
          status: 'active',
        },
      ],
    }).activeTextHarnesses).toEqual([{
      title: '바이름 네이버 블로그 텍스트 하네스',
      description: '눈썹 반영구 상담과 디자인 기준을 과장 없이 설명합니다.',
      structuredRule: { service: 'eyebrow_semipermanent', goal: 'consultation_inquiry' },
      channels: ['naver_blog'],
    }])
  })
})

/**
 * ANI-1714 리뷰 지적: 조회 실패를 '권한 없음(403)'으로 바꾸면 사용자는 권한을 요청하라는
 * 안내를 받지만 실제로는 다시 시도하면 풀린다. 그래서 실패 사유를 네 갈래로 나눈다.
 */
function supabaseReturning(result: { data: unknown; error: unknown }) {
  const builder: Record<string, unknown> = {}
  for (const method of ['select', 'eq', 'order']) builder[method] = () => builder
  builder.limit = async () => result
  builder.maybeSingle = async () => result
  return { from: () => builder } as never
}

const dbError = { message: 'canceling statement due to statement timeout' }

describe('resolveDeterministicWorkspace — 실패 사유 분리', () => {
  it('세션이 없으면 401 이다', async () => {
    const resolved = await resolveDeterministicWorkspace({ supabase: supabaseReturning({ data: null, error: null }), userId: '' })

    expect(resolved.success).toBe(false)
    expect(resolved).toMatchObject({ error: 'UNAUTHORIZED', statusCode: 401 })
  })

  it('가게를 지정했는데 조회가 실패하면 권한 없음(403)이 아니라 500 이다', async () => {
    const resolved = await resolveDeterministicWorkspace({
      supabase: supabaseReturning({ data: null, error: dbError }),
      userId: 'user-1',
      requestedWorkspaceId: workspaceA,
    })

    expect(resolved.success).toBe(false)
    expect(resolved).toMatchObject({ error: 'WORKSPACE_LOOKUP_FAILED', statusCode: 500 })
    if (resolved.success) throw new Error('unreachable')
    // 재시도 안내여야 하고, '권한 없음'이나 '소속 없음' 문구가 나오면 안 된다.
    expect(resolved.message).toContain('다시 시도')
    expect(resolved.message).not.toContain('권한')
  })

  it('가게를 지정했고 조회가 성공했지만 멤버십이 없으면 403 이다', async () => {
    const resolved = await resolveDeterministicWorkspace({
      supabase: supabaseReturning({ data: null, error: null }),
      userId: 'user-1',
      requestedWorkspaceId: workspaceA,
    })

    expect(resolved.success).toBe(false)
    expect(resolved).toMatchObject({ error: 'CROSS_TENANT_ACCESS_DENIED', statusCode: 403 })
  })

  it('가게를 지정했고 멤버십이 비활성이면 403 이다', async () => {
    const resolved = await resolveDeterministicWorkspace({
      supabase: supabaseReturning({ data: { workspace_id: workspaceA, role: 'owner', status: 'disabled' }, error: null }),
      userId: 'user-1',
      requestedWorkspaceId: workspaceA,
    })

    expect(resolved.success).toBe(false)
    expect(resolved).toMatchObject({ error: 'CROSS_TENANT_ACCESS_DENIED', statusCode: 403 })
  })

  it('가게를 지정하지 않았을 때 조회가 실패하면 소속 없음(404)이 아니라 500 이다', async () => {
    const resolved = await resolveDeterministicWorkspace({
      supabase: supabaseReturning({ data: null, error: dbError }),
      userId: 'user-1',
    })

    expect(resolved.success).toBe(false)
    expect(resolved).toMatchObject({ error: 'WORKSPACE_LOOKUP_FAILED', statusCode: 500 })
  })

  it('가게를 지정하지 않았고 활성 소속이 정말 없으면 404 다', async () => {
    const resolved = await resolveDeterministicWorkspace({
      supabase: supabaseReturning({ data: [], error: null }),
      userId: 'user-1',
    })

    expect(resolved.success).toBe(false)
    expect(resolved).toMatchObject({ error: 'WORKSPACE_NOT_FOUND', statusCode: 404 })
  })

  it('활성 멤버십이 있으면 그 가게로 확정한다', async () => {
    const resolved = await resolveDeterministicWorkspace({
      supabase: supabaseReturning({
        data: [{ workspace_id: workspaceA, role: 'manager', status: 'active' }],
        error: null,
      }),
      userId: 'user-1',
    })

    expect(resolved).toEqual({ success: true, workspaceId: workspaceA, role: 'manager', status: 'active' })
  })
})
