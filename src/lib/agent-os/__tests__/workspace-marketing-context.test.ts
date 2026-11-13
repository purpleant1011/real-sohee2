import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { buildWorkspaceMarketingContext } from '@/lib/agent-os/workspace-marketing-context'

describe('WorkspaceMarketingContext with Channel Learning (ANI-2192)', () => {
  const mockWorkspaceId = '11111111-1111-4111-8111-111111111111'
  const prevEnv = process.env.SOHEE_CHANNEL_LEARNING_ENABLED

  afterEach(() => {
    if (prevEnv !== undefined) {
      process.env.SOHEE_CHANNEL_LEARNING_ENABLED = prevEnv
    } else {
      delete process.env.SOHEE_CHANNEL_LEARNING_ENABLED
    }
  })

  function createMockSupabase(params?: {
    businessProfile?: any
    brandProfile?: any
    rpcResult?: { data: any; error: any }
  }) {
    const businessData = params?.businessProfile ?? {
      business_name: '봄날의 빵집',
      industry: '베이커리',
      location: '서울 마포구',
      summary: '천연 발효종을 사용하는 유기농 베이커리입니다.',
    }
    const brandData = params?.brandProfile ?? {
      voice: '따뜻하고 정겨운 어조',
      keywords: ['유기농', '소금빵', '천연발효'],
      prohibited_terms: ['최저가', '폭탄세일'],
    }
    const rpcRes = params?.rpcResult ?? {
      data: {
        epoch: 3,
        items: [
          {
            id: 'fact-1',
            category: 'MENU',
            content: '소금빵 3,500원 (프랑스 고메버터 사용)',
            source_type: 'channel',
            dependencies: [
              { workspaceId: mockWorkspaceId, sourceId: 'src-insta-1', revision: 2 },
            ],
          },
          {
            id: 'fact-2',
            category: 'HOURS',
            content: '화~일 10:00 - 20:00 (월요일 정기휴무)',
            source_type: 'channel',
            dependencies: [
              { workspaceId: mockWorkspaceId, sourceId: 'src-insta-1', revision: 2 },
            ],
          },
        ],
      },
      error: null,
    }

    return {
      from: vi.fn((table: string) => {
        if (table === 'business_profiles') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({ data: businessData, error: null }),
              }),
            }),
          }
        }
        if (table === 'brand_profiles') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({ data: brandData, error: null }),
              }),
            }),
          }
        }
        if (table === 'workspace_products_services') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  order: vi.fn().mockResolvedValue({ data: [], error: null }),
                }),
              }),
            }),
          }
        }
        if (table === 'work_items') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                not: vi.fn().mockReturnValue({
                  order: vi.fn().mockReturnValue({
                    limit: vi.fn().mockResolvedValue({ data: [], error: null }),
                  }),
                }),
              }),
            }),
          }
        }
        if (table === 'external_action_receipts') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                order: vi.fn().mockReturnValue({
                  limit: vi.fn().mockResolvedValue({ data: [], error: null }),
                }),
              }),
            }),
          }
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue({ data: [], error: null }),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        }
      }),
      rpc: vi.fn((name: string, _args: any) => {
        if (name === 'get_approved_learning_context') {
          return Promise.resolve(rpcRes)
        }
        return Promise.resolve({ data: null, error: null })
      }),
    }
  }

  it('SOHEE_CHANNEL_LEARNING_ENABLED === 1 일 때 승인된 채널 지식을 주입하고 contextSummary에 마크다운으로 포함한다', async () => {
    process.env.SOHEE_CHANNEL_LEARNING_ENABLED = '1'
    const mockSupabase = createMockSupabase()

    const context = await buildWorkspaceMarketingContext(mockWorkspaceId, {
      client: mockSupabase as any,
    })

    // 1. RPC 호출 확인
    expect(mockSupabase.rpc).toHaveBeenCalledWith('get_approved_learning_context', {
      p_workspace_id: mockWorkspaceId,
      p_purpose: 'conversation',
      p_max_facts: 50,
      p_query: '',
    })

    // 2. learnedChannelKnowledge 필드 검증
    expect(context.learnedChannelKnowledge).toBeDefined()
    expect(context.learnedChannelKnowledge?.epoch).toBe(3)
    expect(context.learnedChannelKnowledge?.facts).toHaveLength(2)
    expect(context.learnedChannelKnowledge?.dependencies).toEqual([
      { workspaceId: mockWorkspaceId, sourceId: 'src-insta-1', revision: 2 },
    ])

    // 3. contextSummary에 포함 여부 검증
    expect(context.contextSummary).toContain('[학습된 매장 공식 채널 지식 (승인됨)]')
    expect(context.contextSummary).toContain('소금빵 3,500원')
    expect(context.contextSummary).toContain('화~일 10:00 - 20:00')
  })

  it('SOHEE_CHANNEL_LEARNING_ENABLED !== 1 (기본 비활성) 일 때는 채널 지식을 조회하지 않고 기존 동작을 유지한다', async () => {
    delete process.env.SOHEE_CHANNEL_LEARNING_ENABLED
    const mockSupabase = createMockSupabase()

    const context = await buildWorkspaceMarketingContext(mockWorkspaceId, {
      client: mockSupabase as any,
    })

    expect(mockSupabase.rpc).not.toHaveBeenCalledWith('get_approved_learning_context', expect.anything())
    expect(context.learnedChannelKnowledge).toBeUndefined()
    expect(context.contextSummary).not.toContain('[학습된 매장 공식 채널 지식 (승인됨)]')
  })

  it('RPC 호출이 에러를 반환하면 fail-closed로 채널 지식을 주입하지 않고 정상 컨텍스트를 반환한다', async () => {
    process.env.SOHEE_CHANNEL_LEARNING_ENABLED = '1'
    const mockSupabase = createMockSupabase({
      rpcResult: { data: null, error: { message: 'RPC_EXECUTION_FAILED' } },
    })

    const context = await buildWorkspaceMarketingContext(mockWorkspaceId, {
      client: mockSupabase as any,
    })

    expect(context.business.businessName).toBe('봄날의 빵집')
    expect(context.learnedChannelKnowledge).toBeUndefined()
    expect(context.contextSummary).not.toContain('[학습된 매장 공식 채널 지식 (승인됨)]')
  })
})
