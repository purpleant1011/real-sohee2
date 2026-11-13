import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ConversationRepository } from '../conversation-repository'

// Mock createServerSupabaseClient and createAdminSupabaseClient
const mockUserClient = {
  auth: {
    getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'mock-user-123' } } }),
  },
  from: vi.fn(),
}

const mockAdminClient = {
  from: vi.fn(),
}

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn(() => Promise.resolve(mockUserClient)),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminSupabaseClient: vi.fn(() => mockAdminClient),
}))

vi.mock('@/lib/supabase/require-success', () => ({
  assertSupabaseSuccess: vi.fn((val) => val?.data || val),
}))

describe('ConversationRepository Message Actor Boundary (ANI-1154, QA11-P0-001)', () => {
  const workspaceId = '00000000-0000-0000-0000-000000000001'
  const threadId = '00000000-0000-0000-0000-000000000002'

  beforeEach(() => {
    vi.clearAllMocks()

    const setupFrom = (client: any) => {
      client.from.mockImplementation((table: string) => {
        if (table === 'messages') {
          return {
            insert: vi.fn().mockReturnValue({
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({ data: { id: 'msg-id-123' }, error: null }),
              }),
            }),
            upsert: vi.fn().mockReturnValue({
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({ data: { id: 'msg-id-123' }, error: null }),
              }),
            }),
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
                }),
                maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
              }),
            }),
          }
        }
        if (table === 'conversation_threads') {
          return {
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockResolvedValue({ data: null, error: null }),
              }),
            }),
          }
        }
        return {}
      })
    }

    setupFrom(mockUserClient)
    setupFrom(mockAdminClient)
  })

  it('routes role=user messages through server-authoritative persistence while attributing created_by_user_id', async () => {
    const msgId = await ConversationRepository.saveMessage(
      workspaceId,
      threadId,
      'user',
      '안녕하세요 바이름 홍보해주세요'
    )

    expect(msgId).toBeDefined()
    expect(mockUserClient.auth.getUser).toHaveBeenCalled()
    expect(mockAdminClient.from).toHaveBeenCalledWith('messages')
  })

  it('routes role=sohee messages through server-only privileged admin client', async () => {
    const msgId = await ConversationRepository.saveMessage(
      workspaceId,
      threadId,
      'sohee',
      '네 사장님! 바이름 맞춤 홍보 콘텐츠를 준비했습니다.'
    )

    expect(msgId).toBeDefined()
    expect(mockAdminClient.from).toHaveBeenCalledWith('messages')
    expect(mockUserClient.from).not.toHaveBeenCalledWith('messages')
  })

  it('routes role=system_event messages through server-only privileged admin client', async () => {
    const msgId = await ConversationRepository.saveMessage(
      workspaceId,
      threadId,
      'system_event',
      'Instagram 게시가 승인 대기 상태입니다.'
    )

    expect(msgId).toBeDefined()
    expect(mockAdminClient.from).toHaveBeenCalledWith('messages')
    expect(mockUserClient.from).not.toHaveBeenCalledWith('messages')
  })
})
