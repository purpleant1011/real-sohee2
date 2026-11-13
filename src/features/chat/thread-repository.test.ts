import { describe, expect, it, vi } from 'vitest'
import type { ServerSupabaseClient } from '@/features/operations/types'
import {
  archiveConversationThread,
  createConversationThread,
  listConversationThreads,
  restoreConversationThread,
  startConversation,
} from './thread-repository'

const workspaceId = '10000000-0000-4000-8000-000000000001'
const threadId = '20000000-0000-4000-8000-000000000001'
const requestKey = '30000000-0000-4000-8000-000000000001'
const userId = '40000000-0000-4000-8000-000000000001'
const clientMessageId = '50000000-0000-4000-8000-000000000001'
const messageId = '60000000-0000-4000-8000-000000000001'

const row = {
  id: threadId,
  workspace_id: workspaceId,
  title: '주간 콘텐츠 계획',
  status: 'active',
  last_message_at: '2026-08-14T02:00:00.000Z',
  created_at: '2026-08-14T01:00:00.000Z',
  updated_at: '2026-08-14T02:00:00.000Z',
} as const

function query(result: unknown) {
  const promise = Promise.resolve(result)
  type FakeQuery = Record<string, ReturnType<typeof vi.fn>> & PromiseLike<unknown>
  const builder = {} as FakeQuery
  Object.assign(builder, {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    order: vi.fn(() => builder),
    range: vi.fn(() => builder),
    upsert: vi.fn(() => builder),
    update: vi.fn(() => builder),
    maybeSingle: vi.fn(async () => result),
    then: promise.then.bind(promise),
  })
  return builder
}

describe('conversation thread collection', () => {
  it('lists a stable workspace-scoped page and reports whether another page exists', async () => {
    const second = {
      ...row,
      id: '20000000-0000-4000-8000-000000000002',
      title: '새 대화',
      last_message_at: null,
      created_at: '2026-08-14T00:00:00.000Z',
      updated_at: '2026-08-14T00:00:00.000Z',
    }
    const listQuery = query({ data: [row, second], error: null })
    const client = { from: vi.fn(() => listQuery) } as unknown as ServerSupabaseClient

    await expect(listConversationThreads({ client, workspaceId, page: 0, limit: 1 }))
      .resolves.toEqual({
        items: [{
          id: threadId,
          workspaceId,
          title: '주간 콘텐츠 계획',
          status: 'active',
          lastMessageAt: '2026-08-14T02:00:00.000Z',
          createdAt: '2026-08-14T01:00:00.000Z',
          updatedAt: '2026-08-14T02:00:00.000Z',
        }],
        hasMore: true,
      })
    expect(listQuery.eq).toHaveBeenCalledWith('workspace_id', workspaceId)
    expect(listQuery.order).toHaveBeenNthCalledWith(1, 'last_message_at', { ascending: false, nullsFirst: false })
    expect(listQuery.order).toHaveBeenNthCalledWith(2, 'created_at', { ascending: false })
    expect(listQuery.order).toHaveBeenNthCalledWith(3, 'id', { ascending: false })
    expect(listQuery.range).toHaveBeenCalledWith(0, 1)
  })

  it('uses the same request key to return an existing thread without creating a duplicate', async () => {
    const insertQuery = query({ data: null, error: null })
    const existingQuery = query({ data: row, error: null })
    const client = {
      from: vi.fn().mockReturnValueOnce(insertQuery).mockReturnValueOnce(existingQuery),
    } as unknown as ServerSupabaseClient

    await expect(createConversationThread({ client, workspaceId, requestKey }))
      .resolves.toMatchObject({ id: threadId, workspaceId })
    expect(insertQuery.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        workspace_id: workspaceId,
        creation_request_key: requestKey,
        last_message_at: expect.any(String),
      }),
      { ignoreDuplicates: true, onConflict: 'workspace_id,creation_request_key' },
    )
    expect(existingQuery.eq).toHaveBeenCalledWith('workspace_id', workspaceId)
    expect(existingQuery.eq).toHaveBeenCalledWith('creation_request_key', requestKey)
  })

  it('starts a thread and first message through one transaction RPC', async () => {
    const rpc = vi.fn(async () => ({
      data: {
        thread: row,
        user_message: {
          id: messageId,
          workspace_id: workspaceId,
          thread_id: threadId,
          role: 'user',
          content: '이번 주 게시물을 제안해줘',
          status: 'completed',
          work_item_id: null,
          created_at: '2026-08-14T01:00:00.000Z',
          completed_at: '2026-08-14T01:00:00.000Z',
        },
      },
      error: null,
    }))
    const client = { rpc } as unknown as ServerSupabaseClient

    await expect(startConversation({
      client,
      workspaceId,
      requestKey,
      userId,
      clientMessageId,
      content: '이번 주 게시물을 제안해줘',
    })).resolves.toMatchObject({
      thread: { id: threadId, workspaceId },
      userMessage: { id: messageId, threadId, content: '이번 주 게시물을 제안해줘' },
    })
    expect(rpc).toHaveBeenCalledWith('start_conversation_with_first_message', {
      p_client_message_id: clientMessageId,
      p_content: '이번 주 게시물을 제안해줘',
      p_request_key: requestKey,
      p_user_id: userId,
      p_workspace_id: workspaceId,
    })
  })

  it('accepts the complete conversation row returned by the database RPC', async () => {
    const rpc = vi.fn(async () => ({
      data: {
        thread: {
          ...row,
          kind: 'operations',
          creation_request_key: requestKey,
        },
        user_message: {
          id: messageId,
          workspace_id: workspaceId,
          thread_id: threadId,
          role: 'user',
          content: '실제 RPC 응답을 확인해줘',
          status: 'completed',
          work_item_id: null,
          client_message_id: clientMessageId,
          created_by_user_id: userId,
          created_at: '2026-08-14T01:00:00.000Z',
          completed_at: '2026-08-14T01:00:00.000Z',
        },
      },
      error: null,
    }))
    const client = { rpc } as unknown as ServerSupabaseClient

    await expect(startConversation({
      client,
      workspaceId,
      requestKey,
      userId,
      clientMessageId,
      content: '실제 RPC 응답을 확인해줘',
    })).resolves.toMatchObject({
      thread: { id: threadId, workspaceId },
      userMessage: { id: messageId, threadId, content: '실제 RPC 응답을 확인해줘' },
    })
  })

  it('archives and restores without deleting linked conversation records', async () => {
    const archiveQuery = query({ data: { ...row, status: 'archived' }, error: null })
    const restoreQuery = query({ data: row, error: null })
    const client = {
      from: vi.fn().mockReturnValueOnce(archiveQuery).mockReturnValueOnce(restoreQuery),
    } as unknown as ServerSupabaseClient

    await expect(archiveConversationThread({ client, workspaceId, threadId }))
      .resolves.toMatchObject({ status: 'archived' })
    await expect(restoreConversationThread({ client, workspaceId, threadId }))
      .resolves.toMatchObject({ status: 'active' })
    expect(archiveQuery.update).toHaveBeenCalledWith({ status: 'archived' })
    expect(restoreQuery.update).toHaveBeenCalledWith({ status: 'active' })
  })
})
