import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ConversationRepository } from '@/lib/conversation/conversation-repository'
import { createServerSupabaseClient } from '@/lib/supabase/server'

vi.mock('@/lib/supabase/server')

describe('ANI-1038: Canonical Read Semantics (DATA | EMPTY | ERROR | STALE)', () => {
  const workspaceId = '00000000-0000-4000-8000-0000000000a2'
  const threadId = '11111111-1111-1111-1111-111111111111'

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('ConversationRepository.getThreadsResult', () => {
    it('1. Returns DATA state with mapped threads on successful query', async () => {
      const mockSelect = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          order: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue({
              data: [
                {
                  id: 'th-1',
                  workspace_id: workspaceId,
                  title: '신메뉴 마케팅',
                  kind: 'operations',
                  status: 'active',
                  model_profile: 'test_model',
                  last_message_at: '2026-09-08T00:00:00Z',
                  created_at: '2026-09-08T00:00:00Z',
                  updated_at: '2026-09-08T00:00:00Z',
                }
              ],
              error: null,
            })
          })
        })
      })

      vi.mocked(createServerSupabaseClient).mockResolvedValue({
        from: vi.fn().mockReturnValue({ select: mockSelect })
      } as any)

      const result = await ConversationRepository.getThreadsResult(workspaceId)
      expect(result.state).toBe('DATA')
      if (result.state === 'DATA') {
        expect(result.data).toHaveLength(1)
        expect(result.data[0].id).toBe('th-1')
        expect(result.data[0].title).toBe('신메뉴 마케팅')
        expect(result.observedAt).toBeDefined()
      }
    })

    it('2. Returns EMPTY state when query returns empty array (verified empty, not error)', async () => {
      const mockSelect = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          order: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue({
              data: [],
              error: null,
            })
          })
        })
      })

      vi.mocked(createServerSupabaseClient).mockResolvedValue({
        from: vi.fn().mockReturnValue({ select: mockSelect })
      } as any)

      const result = await ConversationRepository.getThreadsResult(workspaceId)
      expect(result.state).toBe('EMPTY')
      if (result.state === 'EMPTY') {
        expect(result.data).toEqual([])
        expect(result.observedAt).toBeDefined()
      }
    })

    it('3. Returns ERROR state when query fails (NEVER masks as empty array)', async () => {
      const mockSelect = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          order: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue({
              data: null,
              error: { code: '42P01', message: 'relation "conversation_threads" does not exist' },
            })
          })
        })
      })

      vi.mocked(createServerSupabaseClient).mockResolvedValue({
        from: vi.fn().mockReturnValue({ select: mockSelect })
      } as any)

      const result = await ConversationRepository.getThreadsResult(workspaceId)
      expect(result.state).toBe('ERROR')
      if (result.state === 'ERROR') {
        expect(result.errorCode).toBe('42P01')
        expect(result.message).toContain('relation')
        expect(result.retryable).toBe(true)
      }
    })
  })

  describe('ConversationRepository.getThreadMessagesResult', () => {
    it('4. Returns ERROR state on query error without throwing unhandled exception', async () => {
      const mockSelect = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            order: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue({
                data: null,
                error: { code: '57P01', message: 'admin shutdown' },
              })
            })
          })
        })
      })

      vi.mocked(createServerSupabaseClient).mockResolvedValue({
        from: vi.fn().mockReturnValue({ select: mockSelect })
      } as any)

      const result = await ConversationRepository.getThreadMessagesResult(workspaceId, threadId)
      expect(result.state).toBe('ERROR')
      if (result.state === 'ERROR') {
        expect(result.errorCode).toBe('57P01')
      }
    })

    it('5. Returns DATA state with parsed usage metadata on success', async () => {
      const mockSelect = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            order: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue({
                data: [
                  {
                    id: 'msg-1',
                    workspace_id: workspaceId,
                    thread_id: threadId,
                    role: 'sohee',
                    content: '안녕하세요!',
                    status: 'completed',
                    usage_metadata: { runId: 'run-1', toolCalls: [] },
                    created_at: '2026-09-08T00:00:00Z',
                  }
                ],
                error: null,
              })
            })
          })
        })
      })

      vi.mocked(createServerSupabaseClient).mockResolvedValue({
        from: vi.fn().mockReturnValue({ select: mockSelect })
      } as any)

      const result = await ConversationRepository.getThreadMessagesResult(workspaceId, threadId)
      expect(result.state).toBe('DATA')
      if (result.state === 'DATA') {
        expect(result.data).toHaveLength(1)
        expect(result.data[0].runId).toBe('run-1')
      }
    })
  })
})
