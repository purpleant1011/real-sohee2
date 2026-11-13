import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  membership: vi.fn(),
  maybeSingle: vi.fn(),
  update: vi.fn(),
  from: vi.fn(),
  select: vi.fn(),
  eq: vi.fn(),
  abortActiveChatStream: vi.fn(),
  revalidatePath: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn(async () => ({
    auth: { getUser: mocks.getUser },
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => ({ maybeSingle: mocks.membership })),
          })),
        })),
      })),
    })),
  })),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminSupabaseClient: vi.fn(() => ({
    from: mocks.from,
  })),
}))

vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock('../active-chat-streams', () => ({ abortActiveChatStream: mocks.abortActiveChatStream }))

import { cancelMessageAction } from './cancel-message'
import { advanceContentInterview, createInitialContentInterview, safeParseContentInterviewState } from '../content-interview'

const input = {
  workspaceId: '11111111-1111-4111-8111-111111111111',
  messageId: '22222222-2222-4222-8222-222222222222',
}

function readyInterviewState() {
  let state = createInitialContentInterview({
    originalPrompt: '네이버 블로그 게시물 만들어줘',
    channels: ['naver_blog'],
    requestedImageCounts: { naver_blog: 1 },
    referenceMediaIds: [],
  })
  state = advanceContentInterview(state, { value: 'consultation', source: 'option' })
  state = advanceContentInterview(state, { value: 'local', source: 'option' })
  state = advanceContentInterview(state, { value: 'short_natural', source: 'option' })
  return advanceContentInterview(state, {
    image: { value: 'detail', source: 'option' },
    callToAction: { value: 'save', source: 'option' },
  })
}

describe('cancelMessageAction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getUser.mockResolvedValue({ data: { user: { id: '33333333-3333-4333-8333-333333333333' } }, error: null })
    mocks.membership.mockResolvedValue({ data: { workspace_id: input.workspaceId }, error: null })
    const query = {
      select: mocks.select,
      update: mocks.update,
      eq: mocks.eq,
      maybeSingle: mocks.maybeSingle,
    }
    mocks.update.mockReturnValue(query)
    mocks.from
      .mockReturnValueOnce({ select: mocks.select })
      .mockReturnValueOnce({ update: mocks.update })
    mocks.select.mockReturnValue(query)
    mocks.eq.mockReturnValue(query)
    mocks.maybeSingle
      .mockResolvedValueOnce({
        data: {
          usage_metadata: {
            soheeConversationInterview: {
              kind: 'content_interview',
              status: 'collecting',
              step: 1,
              originalPrompt: '인스타 게시물 만들어줘',
              channels: ['instagram'],
              requestedImageCounts: { instagram: 1 },
              answers: {},
              referenceMediaIds: [],
            },
          },
        },
        error: null,
      })
      .mockResolvedValueOnce({ data: { id: input.messageId }, error: null })
  })

  it('인터뷰 메타데이터가 있는 streaming 응답을 취소 상태로 갱신한다', async () => {
    const result = await cancelMessageAction(input)

    expect(result).toEqual({ data: { messageId: input.messageId, cancelled: true } })
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({
      status: 'cancelled',
      error_code: 'CHAT_CANCELLED',
      usage_metadata: expect.objectContaining({
        soheeConversationInterview: expect.objectContaining({ status: 'cancelled' }),
      }),
    }))
  })

  it('ready_to_generate 메타데이터도 메시지 취소와 함께 terminal cancelled로 닫는다', async () => {
    const state = readyInterviewState()
    mocks.maybeSingle.mockReset()
    mocks.maybeSingle
      .mockResolvedValueOnce({
        data: { usage_metadata: { soheeConversationInterview: state } },
        error: null,
      })
      .mockResolvedValueOnce({ data: { id: input.messageId }, error: null })

    const result = await cancelMessageAction(input)

    expect(result).toEqual({ data: { messageId: input.messageId, cancelled: true } })
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({
      status: 'cancelled',
      usage_metadata: expect.objectContaining({
        soheeConversationInterview: expect.objectContaining({ status: 'cancelled' }),
      }),
    }))
    const update = mocks.update.mock.calls.at(-1)?.[0]
    expect(safeParseContentInterviewState(update.usage_metadata.soheeConversationInterview)).toMatchObject({
      success: true,
    })
    expect(update.usage_metadata.soheeConversationInterview.brief).toBeDefined()
  })
})
