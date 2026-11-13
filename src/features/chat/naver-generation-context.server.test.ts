import { describe, expect, it, vi } from 'vitest'
import { loadNaverGenerationContext } from './naver-generation-context.server'

describe('loadNaverGenerationContext', () => {
  const workspaceId = '10000000-0000-4000-8000-000000000001'

  function createMockSupabase(overrides?: {
    businessError?: boolean
    brandError?: boolean
    knowledgeError?: boolean
    harnessError?: boolean
  }) {
    const channelFiltered: string[] = []

    const client = {
      from: vi.fn((table: string) => {
        if (table === 'business_profiles') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue(
                  overrides?.businessError
                    ? { data: null, error: new Error('db_error') }
                    : {
                        data: {
                          workspace_id: workspaceId,
                          business_name: '바이름',
                          industry: '뷰티',
                          location: '서울',
                          summary: '반영구 샵',
                        },
                        error: null,
                      },
                ),
              }),
            }),
          }
        }
        if (table === 'brand_profiles') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue(
                  overrides?.brandError
                    ? { data: null, error: new Error('db_error') }
                    : {
                        data: {
                          workspace_id: workspaceId,
                          voice: '친근한',
                          keywords: ['눈썹'],
                          prohibited_terms: ['절대'],
                        },
                        error: null,
                      },
                ),
              }),
            }),
          }
        }
        if (table === 'knowledge_sources') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  limit: vi.fn().mockResolvedValue(
                    overrides?.knowledgeError
                      ? { data: null, error: new Error('db_error') }
                      : {
                          data: [
                            {
                              workspace_id: workspaceId,
                              channel_type: 'naver_blog',
                              uri: 'https://blog.naver.com/test',
                              status: 'active',
                              refresh_policy: 'daily',
                            },
                          ],
                          error: null,
                        },
                  ),
                }),
              }),
            }),
          }
        }
        if (table === 'harness_rules') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  eq: vi.fn().mockReturnValue({
                    contains: vi.fn((_col: string, val: string[]) => {
                      channelFiltered.push(...val)
                      return {
                        limit: vi.fn().mockResolvedValue(
                          overrides?.harnessError
                            ? { data: null, error: new Error('db_error') }
                            : {
                                data: [
                                  {
                                    workspace_id: workspaceId,
                                    rule_type: 'text_generation',
                                    title: '어조 규칙',
                                    description: '정중하게',
                                    structured_rule: {},
                                    applies_to_channels: ['naver_blog'],
                                    status: 'active',
                                  },
                                ],
                                error: null,
                              },
                        ),
                      }
                    }),
                  }),
                }),
              }),
            }),
          }
        }
        throw new Error(`Unexpected table: ${table}`)
      }),
    }

    return { client, channelFiltered }
  }

  it('loads context successfully with default naver_blog channel', async () => {
    const { client, channelFiltered } = createMockSupabase()
    const result = await loadNaverGenerationContext(workspaceId, client as any)

    expect(result.businessName).toBe('바이름')
    expect(result.industry).toBe('뷰티')
    expect(channelFiltered).toContain('naver_blog')
  })

  it('uses specified channel when provided', async () => {
    const { client, channelFiltered } = createMockSupabase()
    const result = await loadNaverGenerationContext(workspaceId, client as any, 'instagram_post')

    expect(result.businessName).toBe('바이름')
    expect(channelFiltered).toContain('instagram_post')
  })

  it('throws instagram_context_unavailable when any db query fails', async () => {
    const { client } = createMockSupabase({ businessError: true })
    await expect(
      loadNaverGenerationContext(workspaceId, client as any),
    ).rejects.toThrow('instagram_context_unavailable')
  })
})
