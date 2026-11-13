// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  membership: vi.fn(),
  imageRules: vi.fn(),
  textRule: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn(async () => ({
    auth: { getUser: mocks.getUser },
    from: (table: string) => {
      if (table === 'workspace_members') {
        const q: Record<string, unknown> = {}
        q.select = () => q
        q.eq = () => q
        q.maybeSingle = mocks.membership
        return q
      }

      if (table === 'harness_rules') {
        let ruleType = ''
        const q: Record<string, unknown> = {}
        q.select = () => q
        q.eq = (_col: string, val: string) => {
          if (_col === 'rule_type') ruleType = val
          return q
        }
        q.order = () => q
        q.limit = () => q
        q.maybeSingle = mocks.textRule
        // Thenable for the image rules query:
        q.then = (resolve: (val: unknown) => unknown, reject?: (err: unknown) => unknown) => {
          if (ruleType === 'image_generation') {
            return Promise.resolve(mocks.imageRules()).then(resolve, reject)
          }
          return Promise.resolve({ data: [], error: null }).then(resolve, reject)
        }
        return q
      }

      return {}
    },
  })),
}))

import { EMPTY_STYLE_SUMMARY } from '../style-summary'
import { loadWorkspaceStyleSummaryAction } from './load-style-summary'

const workspaceId = '20000000-0000-4000-8000-000000000001'
const userId = '10000000-0000-4000-8000-000000000001'

describe('loadWorkspaceStyleSummaryAction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getUser.mockResolvedValue({ data: { user: { id: userId } }, error: null })
    mocks.membership.mockResolvedValue({ data: { status: 'active', role: 'viewer' }, error: null })
    mocks.imageRules.mockResolvedValue({ data: [], error: null })
    mocks.textRule.mockResolvedValue({ data: null, error: null })
  })

  it('rejects unauthenticated users', async () => {
    mocks.getUser.mockResolvedValueOnce({ data: { user: null }, error: null })
    const result = await loadWorkspaceStyleSummaryAction({ workspaceId })
    expect(result).toEqual({
      error: {
        message: '이 작업공간을 볼 수 없어요.',
        requestId: 'workspace-style-summary',
      },
    })
  })

  it('rejects non-members or inactive members', async () => {
    mocks.membership.mockResolvedValueOnce({ data: null, error: null })
    const notMember = await loadWorkspaceStyleSummaryAction({ workspaceId })
    expect(notMember).toEqual({
      error: {
        message: '이 작업공간을 볼 수 없어요.',
        requestId: 'workspace-style-summary',
      },
    })

    mocks.membership.mockResolvedValueOnce({ data: { status: 'invited', role: 'member' }, error: null })
    const inactive = await loadWorkspaceStyleSummaryAction({ workspaceId })
    expect(inactive).toEqual({
      error: {
        message: '이 작업공간을 볼 수 없어요.',
        requestId: 'workspace-style-summary',
      },
    })
  })

  it('rejects invalid workspaceId input', async () => {
    const invalid = await loadWorkspaceStyleSummaryAction({ workspaceId: 'not-a-uuid' })
    expect(invalid).toEqual({
      error: {
        message: '입력 내용을 확인해 주세요.',
        requestId: 'workspace-style-summary',
      },
    })
  })

  it('allows active members regardless of role and returns style summary', async () => {
    const refId = '30000000-0000-4000-8000-000000000001'
    mocks.membership.mockResolvedValueOnce({ data: { status: 'active', role: 'viewer' }, error: null })
    mocks.imageRules.mockResolvedValueOnce({
      data: [
        {
          rule_key: 'custom-image-style-v1',
          structured_rule: {
            custom: {
              subject: '자연주의 베이커리',
              mood: '',
              setting: '',
              lookAndColor: '',
              people: 'any',
              avoid: [],
              extra: '',
              composition: '',
              guide: '빛을 풍부하게 활용',
              referenceAssetIds: [refId],
              referenceNotes: { [refId]: '갓 구운 크루아상' },
            },
          },
        },
      ],
      error: null,
    })
    mocks.textRule.mockResolvedValueOnce({
      data: {
        structured_rule: {
          brandVoice: '담백하고 진정성 있는 어조',
        },
      },
      error: null,
    })

    const result = await loadWorkspaceStyleSummaryAction({ workspaceId })
    expect(result).toEqual({
      data: {
        image: {
          configured: true,
          headline: '자연주의 베이커리',
          referenceCount: 1,
          references: [
            {
              id: refId,
              url: `/api/workspaces/${workspaceId}/media/${refId}`,
              note: '갓 구운 크루아상',
            },
          ],
          hasGuide: true,
          custom: true,
        },
        text: {
          configured: true,
          voiceSummary: '담백하고 진정성 있는 어조',
        },
        overlay: null,
      },
    })
  })

  it('reads custom-overlay-v1 rule from image generation rules and includes it in summary', async () => {
    mocks.imageRules.mockResolvedValueOnce({
      data: [
        {
          rule_key: 'custom-overlay-v1',
          structured_rule: {
            overlay: {
              preset: 'review-card',
              texts: {
                brandLine: '리뷰 제목',
                designLine: '소제목',
                quote: '고객 만족 후기',
                insetLabel: 'BEFORE',
              },
            },
          },
        },
      ],
      error: null,
    })

    const result = await loadWorkspaceStyleSummaryAction({ workspaceId })
    expect(result.data?.overlay).toEqual({
      preset: 'review-card',
      brandLine: '리뷰 제목',
      designLine: '소제목',
      quote: '고객 만족 후기',
      insetLabel: 'BEFORE',
    })
  })

  it('handles legacy image style as custom: false', async () => {
    mocks.imageRules.mockResolvedValueOnce({
      data: [
        {
          rule_key: 'quick-image-style',
          structured_rule: {
            rules: {
              modelStyle: '모던 플랫',
            },
          },
        },
      ],
      error: null,
    })

    const result = await loadWorkspaceStyleSummaryAction({ workspaceId })
    expect(result.data?.image.configured).toBe(true)
    expect(result.data?.image.custom).toBe(false)
    expect(result.data?.image.headline).toBe('모던 플랫')
  })

  it('returns EMPTY_STYLE_SUMMARY on database read errors without throwing', async () => {
    mocks.imageRules.mockResolvedValueOnce({ data: null, error: { message: 'db error' } })

    const result = await loadWorkspaceStyleSummaryAction({ workspaceId })
    expect(result).toEqual({
      data: EMPTY_STYLE_SUMMARY,
    })
  })

  it('returns EMPTY_STYLE_SUMMARY when textRule read errors without throwing', async () => {
    mocks.textRule.mockResolvedValueOnce({ data: null, error: { message: 'db error' } })

    const result = await loadWorkspaceStyleSummaryAction({ workspaceId })
    expect(result).toEqual({
      data: EMPTY_STYLE_SUMMARY,
    })
  })
})
