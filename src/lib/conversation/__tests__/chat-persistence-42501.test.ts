import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ConversationRepository } from '../conversation-repository'

// Mock clients
const mockUserClient = {
  auth: {
    getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-actual-123' } } }),
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
  assertSupabaseSuccess: vi.fn((val, context) => {
    if (val?.error) {
      const err = new Error(`[${context}] ${val.error.message || 'db error'}`)
      ;(err as any).code = val.error.code
      throw err
    }
    return val?.data || val
  }),
}))

describe('Chat Persistence P0 Recovery & Idempotency (ANI-1189, ANI-1206, ANI-1207)', () => {
  const workspaceId = '00000000-0000-4000-8000-0000000000a2'
  const threadId = '11111111-2222-4333-8444-555555555555'
  const clientMessageUuid = '99999999-8888-4777-a666-555555555555'

  beforeEach(() => {
    vi.clearAllMocks()

    // Default thread mock for adminClient
    mockAdminClient.from.mockImplementation((table: string) => {
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
  })

  it('MUST use server-authoritative persistence with actor attribution for role=user', async () => {
    // Specification:
    // 1. Session user is verified
    // 2. Server-authoritative admin client writes to messages with insert (not userClient upsert)
    // 3. created_by_user_id preserves authenticated user id
    const insertedRecords: any[] = []

    mockAdminClient.from.mockImplementation((table: string) => {
      if (table === 'messages') {
        return {
          insert: vi.fn().mockImplementation((record: any) => {
            insertedRecords.push(record)
            return {
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: { id: record.id },
                  error: null,
                }),
              }),
            }
          }),
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
              }),
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

    const msgId = await ConversationRepository.saveMessage(
      workspaceId,
      threadId,
      'user',
      '바이름 이번 주 마케팅 해줘',
      { clientMessageId: clientMessageUuid }
    )

    // MUST persist via server-authoritative client, NOT userClient
    expect(mockAdminClient.from).toHaveBeenCalledWith('messages')
    expect(mockUserClient.from).not.toHaveBeenCalledWith('messages')
    expect(insertedRecords.length).toBe(1)
    expect(insertedRecords[0].created_by_user_id).toBe('user-actual-123')
    expect(insertedRecords[0].workspace_id).toBe(workspaceId)
    expect(msgId).toBe(clientMessageUuid)
  })

  it('MUST be idempotent on retry with same client_message_id without creating duplicate messages', async () => {
    // If a message with the same client_message_id already exists in this workspace,
    // it must return the existing message id and NOT insert a second row
    const existingMessage = {
      id: clientMessageUuid,
      workspace_id: workspaceId,
      thread_id: threadId,
      role: 'user',
      content: '바이름 이번 주 마케팅 해줘',
      created_at: '2026-09-10T02:00:00.000Z',
    }

    mockAdminClient.from.mockImplementation((table: string) => {
      if (table === 'messages') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({ data: existingMessage, error: null }),
              }),
            }),
          }),
          insert: vi.fn(), // Should NOT be called
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

    const msgId = await ConversationRepository.saveMessage(
      workspaceId,
      threadId,
      'user',
      '바이름 이번 주 마케팅 해줘',
      { clientMessageId: clientMessageUuid }
    )

    expect(msgId).toBe(clientMessageUuid)
    expect(mockAdminClient.from).toHaveBeenCalledWith('messages')
    const messagesTable = mockAdminClient.from.mock.results[0].value
    expect(messagesTable.insert).not.toHaveBeenCalled()
  })
})
