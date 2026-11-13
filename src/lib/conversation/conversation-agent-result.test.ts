import { beforeEach, describe, expect, it, vi } from 'vitest'
import { projectPublicChatResult } from '@/lib/agent-os/public-chat-result'

const client = vi.hoisted(() => ({ from: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createServerSupabaseClient: async () => client }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminSupabaseClient: () => client }))
import { ConversationRepository } from './conversation-repository'

const WS = '11111111-1111-4111-8111-111111111111'
const THREAD = '22222222-2222-4222-8222-222222222222'
const RUN = '33333333-3333-4333-8333-333333333333'

describe('대화 결과 영속 복원', () => {
  beforeEach(() => vi.clearAllMocks())
  it('50개를 넘는 대화도 가장 최근 결과를 시간순으로 복원한다', async () => {
    const rows = Array.from({ length: 60 }, (_, i) => ({ id: `m${i}`, workspace_id: WS, thread_id: THREAD, role: 'sohee', content: `답변 ${i}`, created_at: new Date(i * 1000).toISOString(), usage_metadata: {} }))
    let ascending = true
    const eq = vi.fn().mockReturnThis()
    const query = {
      select: vi.fn().mockReturnThis(), eq,
      order: vi.fn((_key, options) => { ascending = options.ascending; return query }),
      limit: vi.fn(async (n: number) => ({ data: (ascending ? rows : [...rows].reverse()).slice(0, n), error: null })),
    }
    client.from.mockReturnValue(query)
    const output = await ConversationRepository.getThreadMessagesResult(WS, THREAD)
    if (output.state === 'ERROR') throw new Error(output.message)
    expect(output.data.map(row => row.id)).toEqual(rows.slice(10).map(row => row.id))
    expect(eq.mock.calls).toEqual([['workspace_id', WS], ['thread_id', THREAD]])
  })
  it('공개 결과를 저장하고 메시지 조회에서 동일하게 복원한다', async () => {
    const publicChatResult = projectPublicChatResult({ content: '검토 결과', threadId: THREAD, runId: RUN, planCard: { title: '제안', steps: [{ name: '확인' }] }, raw_args: 'PRIVATE' })!
    let saved: Record<string, unknown> = {}
    const messageQuery = {
      insert: vi.fn((value) => { saved = value; return messageQuery }),
      select: vi.fn().mockReturnThis(), single: vi.fn(async () => ({ data: { id: 'saved' }, error: null })),
      eq: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(),
      limit: vi.fn(async () => ({ data: [{ ...saved, id: 'saved' }], error: null })),
    }
    const threadQuery = { update: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), then: (resolve: (v: unknown) => void) => resolve({ error: null }) }
    client.from.mockImplementation((table: string) => table === 'messages' ? messageQuery : threadQuery)
    await ConversationRepository.saveMessage(WS, THREAD, 'sohee', publicChatResult.content, { runId: RUN, publicChatResult })
    const restored = await ConversationRepository.getThreadMessagesResult(WS, THREAD)
    if (restored.state === 'ERROR') throw new Error(restored.message)
    expect(restored.data[0].usageMetadata?.publicChatResult).toEqual(publicChatResult)
    expect(JSON.stringify(saved)).not.toContain('PRIVATE')
  })
})
