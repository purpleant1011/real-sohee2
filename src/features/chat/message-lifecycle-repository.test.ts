import { describe, expect, it, vi } from 'vitest'
import {
  advanceContentInterview,
  createInitialContentInterview,
  type ContentInterviewState,
} from './content-interview'
import {
  createAssistantMessage,
  createOrGetAssistantMessage,
  finalizeAssistantMessage,
  forceFinalizeAssistantMessage,
  reconcileStaleAssistantMessages,
} from './message-lifecycle-repository'

const workspaceId = '11111111-1111-4111-8111-111111111111'
const threadId = '22222222-2222-4222-8222-222222222222'
const messageId = '33333333-3333-4333-8333-333333333333'
const userMessageId = '44444444-4444-4444-8444-444444444444'

function collectingInterviewState(): ContentInterviewState {
  const initial = createInitialContentInterview({
    originalPrompt: '이번 주 콘텐츠를 준비해 줘.',
    channels: ['instagram'],
    requestedImageCounts: { instagram: 1 },
    referenceMediaIds: [],
  })
  return advanceContentInterview(initial, { value: 'consultation', source: 'option' })
}

function assistantRow(usageMetadata: unknown = {}) {
  return {
    id: messageId,
    workspace_id: workspaceId,
    thread_id: threadId,
    role: 'sohee',
    content: '응답을 준비하고 있습니다.',
    status: 'streaming',
    work_item_id: null,
    artifact_type: null,
    artifact_id: null,
    created_at: '2026-08-10T01:00:00.000Z',
    completed_at: null,
    usage_metadata: usageMetadata,
  }
}

function lifecycleQuery(result: unknown) {
  const builder = {
    insert: vi.fn(),
    update: vi.fn(),
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn(async () => result),
    single: vi.fn(async () => result),
  }
  builder.insert.mockReturnValue(builder)
  builder.update.mockReturnValue(builder)
  builder.select.mockReturnValue(builder)
  builder.eq.mockReturnValue(builder)
  return builder
}

function finalizeClient(currentMetadata: unknown, updateResult: unknown) {
  const readQuery = lifecycleQuery({
    data: { usage_metadata: currentMetadata },
    error: null,
  })
  const updateQuery = lifecycleQuery(updateResult)
  const client = {
    from: vi.fn().mockReturnValueOnce(readQuery).mockReturnValueOnce(updateQuery),
  }
  return { client, readQuery, updateQuery }
}

describe('reconcileStaleAssistantMessages', () => {
  it('finalizes only streaming assistant messages older than the cutoff', async () => {
    const query = {
      update: vi.fn(),
      eq: vi.fn(),
      lt: vi.fn(async () => ({ error: null })),
    }
    query.update.mockReturnValue(query)
    query.eq.mockReturnValue(query)
    const client = { from: vi.fn(() => query) }

    await reconcileStaleAssistantMessages({
      client: client as never,
      workspaceId: '11111111-1111-4111-8111-111111111111',
      threadId: '22222222-2222-4222-8222-222222222222',
      staleBefore: '2026-08-20T14:30:00.000Z',
    })

    expect(query.update).toHaveBeenCalledWith(expect.objectContaining({
      status: 'failed',
      error_code: 'CHAT_WORKER_INTERRUPTED',
      completed_at: expect.any(String),
    }))
    expect(query.eq.mock.calls).toEqual([
      ['workspace_id', '11111111-1111-4111-8111-111111111111'],
      ['thread_id', '22222222-2222-4222-8222-222222222222'],
      ['role', 'sohee'],
      ['status', 'streaming'],
    ])
    expect(query.lt).toHaveBeenCalledWith('created_at', '2026-08-20T14:30:00.000Z')
  })
})

describe('createAssistantMessage', () => {
  it('persists validated interview metadata and projects it as clarification', async () => {
    const state = collectingInterviewState()
    const createQuery = lifecycleQuery({
      data: assistantRow({ soheeConversationInterview: state }),
      error: null,
    })
    const client = { from: vi.fn(() => createQuery) }

    const message = await createAssistantMessage({
      client: client as never,
      workspaceId,
      threadId,
      userMessageId,
      model: 'gpt-test',
      usageMetadata: { soheeConversationInterview: state },
    })

    expect(createQuery.insert).toHaveBeenCalledWith(expect.objectContaining({
      usage_metadata: { soheeConversationInterview: state },
    }))
    expect(createQuery.select).toHaveBeenCalledWith(expect.stringContaining('usage_metadata'))
    expect(message.clarification?.step).toBe(2)
    expect(message).not.toHaveProperty('usage_metadata')
  })

  it('rejects malformed interview metadata before attempting an insert', async () => {
    const createQuery = lifecycleQuery({ data: assistantRow(), error: null })
    const client = { from: vi.fn(() => createQuery) }

    await expect(createAssistantMessage({
      client: client as never,
      workspaceId,
      threadId,
      userMessageId,
      model: 'gpt-test',
      usageMetadata: {
        soheeConversationInterview: { ...collectingInterviewState(), step: 9 } as never,
      },
    })).rejects.toThrow()
    expect(client.from).not.toHaveBeenCalled()
  })
})

describe('createOrGetAssistantMessage', () => {
  it('returns the existing deterministic assistant row when the insert loses a race', async () => {
    const insertQuery = lifecycleQuery({ data: null, error: { code: '23505' } })
    const existingQuery = lifecycleQuery({ data: assistantRow(), error: null })
    const client = {
      from: vi.fn().mockReturnValueOnce(insertQuery).mockReturnValueOnce(existingQuery),
    }

    const result = await createOrGetAssistantMessage({
      client: client as never,
      workspaceId,
      threadId,
      userMessageId,
      assistantMessageId: messageId,
      model: 'gpt-test',
    })

    expect(result).toEqual({ message: expect.objectContaining({ id: messageId }), created: false })
    expect(existingQuery.eq).toHaveBeenCalledWith('id', messageId)
  })
})

describe('finalizeAssistantMessage', () => {
  it('updates validated interview metadata when explicitly provided', async () => {
    const state = collectingInterviewState()
    const { client, updateQuery } = finalizeClient({}, { data: { id: messageId }, error: null })

    await finalizeAssistantMessage({
      client: client as never,
      workspaceId,
      messageId,
      content: '콘텐츠 인터뷰를 이어갈게요.',
      status: 'completed',
      errorCode: null,
      usageMetadata: { soheeConversationInterview: state },
    })

    expect(updateQuery.update).toHaveBeenCalledWith(expect.objectContaining({
      usage_metadata: { soheeConversationInterview: state },
    }))
  })

  it('merges interview metadata while preserving unrelated usage metadata namespaces', async () => {
    const state = collectingInterviewState()
    const existingMetadata = {
      operationEventKey: 'event-2026-08-22',
      operationEventId: '60000000-0000-4000-8000-000000000001',
      retry: { attempt: 2 },
    }
    const { client, readQuery, updateQuery } = finalizeClient(
      existingMetadata,
      { data: { id: messageId }, error: null },
    )

    await finalizeAssistantMessage({
      client: client as never,
      workspaceId,
      messageId,
      content: '콘텐츠 인터뷰를 이어갈게요.',
      status: 'completed',
      errorCode: null,
      usageMetadata: { soheeConversationInterview: state },
    })

    expect(readQuery.select).toHaveBeenCalledWith('usage_metadata')
    expect(updateQuery.update).toHaveBeenCalledWith(expect.objectContaining({
      usage_metadata: {
        ...existingMetadata,
        soheeConversationInterview: state,
      },
    }))
    expect(updateQuery.eq).toHaveBeenCalledWith('usage_metadata', JSON.stringify(existingMetadata))
  })

  it('fails when the metadata equality guard prevents the finalize update', async () => {
    const state = collectingInterviewState()
    const existingMetadata = { operationEventKey: 'event-2026-08-22' }
    const { client, updateQuery } = finalizeClient(
      existingMetadata,
      { data: null, error: null },
    )

    await expect(finalizeAssistantMessage({
      client: client as never,
      workspaceId,
      messageId,
      content: '콘텐츠 인터뷰를 이어갈게요.',
      status: 'completed',
      errorCode: null,
      usageMetadata: { soheeConversationInterview: state },
    })).rejects.toThrow('assistant_reply_finalize_failed')
    expect(updateQuery.eq).toHaveBeenCalledWith('usage_metadata', JSON.stringify(existingMetadata))
  })

  it('leaves existing metadata untouched when interview metadata is omitted', async () => {
    const finalizeQuery = lifecycleQuery({ data: { id: messageId }, error: null })
    const client = { from: vi.fn(() => finalizeQuery) }

    await finalizeAssistantMessage({
      client: client as never,
      workspaceId,
      messageId,
      content: '일반 답변입니다.',
      status: 'completed',
      errorCode: null,
    })

    expect(finalizeQuery.update).toHaveBeenCalledWith(expect.not.objectContaining({
      usage_metadata: expect.anything(),
    }))
  })

  it('rejects malformed interview metadata before attempting an update', async () => {
    const finalizeQuery = lifecycleQuery({ data: { id: messageId }, error: null })
    const client = { from: vi.fn(() => finalizeQuery) }

    await expect(finalizeAssistantMessage({
      client: client as never,
      workspaceId,
      messageId,
      content: '일반 답변입니다.',
      status: 'completed',
      errorCode: null,
      usageMetadata: {
        soheeConversationInterview: { ...collectingInterviewState(), step: 9 } as never,
      },
    })).rejects.toThrow()
    expect(client.from).not.toHaveBeenCalled()
  })
})

describe('forceFinalizeAssistantMessage', () => {
  it('closes a streaming row without the optimistic status or metadata guard', async () => {
    const query = lifecycleQuery({ data: { id: messageId }, error: null })
    const client = { from: vi.fn(() => query) }

    await forceFinalizeAssistantMessage({
      client: client as never,
      workspaceId,
      messageId,
      content: '응답을 저장하지 못했습니다.',
      status: 'failed',
      errorCode: 'CHAT_PROVIDER_FAILED',
    })

    expect(query.update).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed' }))
    expect(query.eq).toHaveBeenCalledWith('role', 'sohee')
    expect(query.eq).not.toHaveBeenCalledWith('status', 'streaming')
  })
})
