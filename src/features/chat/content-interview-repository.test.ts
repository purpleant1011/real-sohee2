import { describe, expect, it, vi } from 'vitest'
import type { ServerSupabaseClient } from '@/features/operations/types'
import {
  advanceContentInterview,
  createInitialContentInterview,
  type ContentInterviewState,
} from './content-interview'
import {
  cancelContentInterview,
  findContentInterviewByMessage,
  findLatestContentInterview,
  findLatestReadyContentInterview,
  completeContentInterview,
  retireContentInterview,
  validateContentInterviewAttachments,
} from './content-interview-repository'

const workspaceId = '20000000-0000-4000-8000-000000000001'
const otherWorkspaceId = '20000000-0000-4000-8000-000000000099'
const threadId = '30000000-0000-4000-8000-000000000001'
const messageId = '40000000-0000-4000-8000-000000000001'
const userMessageId = '50000000-0000-4000-8000-000000000001'

function collectingInterviewState(): ContentInterviewState {
  const initial = createInitialContentInterview({
    originalPrompt: '이번 주 콘텐츠를 준비해 줘.',
    channels: ['instagram'],
    requestedImageCounts: { instagram: 1 },
    referenceMediaIds: [],
  })
  return advanceContentInterview(initial, { value: 'consultation', source: 'option' })
}

function completedInterviewState(): ContentInterviewState {
  let state = collectingInterviewState()
  state = advanceContentInterview(state, { value: 'local', source: 'option' })
  state = advanceContentInterview(state, { value: 'short_natural', source: 'option' })
  state = advanceContentInterview(state, {
    image: { value: 'detail', source: 'option' },
    callToAction: { value: 'check', source: 'option' },
  })
  return { ...state, status: 'completed' }
}

function query(result: unknown) {
  const promise = Promise.resolve(result)
  const builder = {
    select: vi.fn(),
    update: vi.fn(),
    eq: vi.fn(),
    contains: vi.fn(),
    in: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
    maybeSingle: vi.fn(async () => result),
    then: promise.then.bind(promise),
  }
  builder.select.mockReturnValue(builder)
  builder.update.mockReturnValue(builder)
  builder.eq.mockReturnValue(builder)
  builder.contains.mockReturnValue(builder)
  builder.in.mockReturnValue(builder)
  builder.order.mockReturnValue(builder)
  builder.limit.mockReturnValue(builder)
  return builder
}

function interviewRow(overrides: Record<string, unknown> = {}) {
  return {
    id: messageId,
    workspace_id: workspaceId,
    thread_id: threadId,
    role: 'sohee',
    reply_to_message_id: userMessageId,
    status: 'completed',
    created_at: '2026-08-10T01:00:00.000Z',
    usage_metadata: { soheeConversationInterview: collectingInterviewState() },
    ...overrides,
  }
}

describe('findLatestContentInterview', () => {
  it('finds the latest collecting interview only within the requested workspace and thread', async () => {
    const latestQuery = query({ data: interviewRow(), error: null })
    const client = { from: vi.fn(() => latestQuery) } as unknown as ServerSupabaseClient

    const result = await findLatestContentInterview({ client, workspaceId, threadId })

    expect(result).toMatchObject({
      messageId,
      userMessageId,
      state: { kind: 'content_interview', status: 'collecting', step: 2 },
    })
    expect(latestQuery.select).toHaveBeenCalledWith(expect.stringContaining('usage_metadata'))
    expect(latestQuery.eq).toHaveBeenCalledWith('workspace_id', workspaceId)
    expect(latestQuery.eq).toHaveBeenCalledWith('thread_id', threadId)
    expect(latestQuery.eq).toHaveBeenCalledWith('role', 'sohee')
    expect(latestQuery.in).toHaveBeenCalledWith('status', ['completed', 'streaming'])
    expect(latestQuery.contains).toHaveBeenCalledWith(
      'usage_metadata',
      { soheeConversationInterview: { kind: 'content_interview' } },
    )
    expect(latestQuery.order).toHaveBeenCalledWith('created_at', { ascending: false })
    expect(latestQuery.limit).toHaveBeenCalledWith(1)
  })

  it('완성된 초안이 최신이면 과거 질문을 다시 활성화하지 않는다', async () => {
    const old = interviewRow()
    const latest = interviewRow({ usage_metadata: { soheeConversationInterview: completedInterviewState() } })
    const builder = query({ data: null, error: null })
    builder.contains.mockImplementation((_field: string, filter: { soheeConversationInterview: { status?: string } }) => {
      builder.maybeSingle.mockResolvedValue({ data: filter.soheeConversationInterview.status === 'collecting' ? old : latest, error: null } as never)
      return builder
    })
    const client = { from: () => builder } as unknown as ServerSupabaseClient
    await expect(findLatestContentInterview({ client, workspaceId, threadId })).resolves.toBeNull()
  })

  it('ignores malformed interview metadata and never returns the raw metadata', async () => {
    const latestQuery = query({
      data: interviewRow({
        usage_metadata: { soheeConversationInterview: { status: 'collecting', step: 9 } },
      }),
      error: null,
    })
    const client = { from: vi.fn(() => latestQuery) } as unknown as ServerSupabaseClient

    await expect(findLatestContentInterview({ client, workspaceId, threadId })).resolves.toBeNull()
  })

  it('ignores completed or cross-workspace interview rows', async () => {
    const completedQuery = query({
      data: interviewRow({
        workspace_id: otherWorkspaceId,
        usage_metadata: { soheeConversationInterview: completedInterviewState() },
      }),
      error: null,
    })
    const client = { from: vi.fn(() => completedQuery) } as unknown as ServerSupabaseClient

    await expect(findLatestContentInterview({ client, workspaceId, threadId })).resolves.toBeNull()
  })

  it('does not reselect collecting metadata from a terminal stale assistant row', async () => {
    const staleQuery = query({
      data: interviewRow({ status: 'failed' }),
      error: null,
    })
    const client = { from: vi.fn(() => staleQuery) } as unknown as ServerSupabaseClient

    await expect(findLatestContentInterview({ client, workspaceId, threadId })).resolves.toBeNull()
  })
})

describe('content interview retry and attachment boundaries', () => {
  it('finds only the latest ready review state for explicit generation controls', async () => {
    const ready = { ...completedInterviewState(), status: 'ready_to_generate' as const }
    const latestQuery = query({
      data: interviewRow({ usage_metadata: { soheeConversationInterview: ready } }),
      error: null,
    })
    const client = { from: vi.fn(() => latestQuery) } as unknown as ServerSupabaseClient

    const result = await findLatestReadyContentInterview({ client, workspaceId, threadId })

    expect(result?.state.status).toBe('ready_to_generate')
    expect(latestQuery.contains).toHaveBeenCalledWith(
      'usage_metadata',
      { soheeConversationInterview: { status: 'ready_to_generate' } },
    )
  })

  it('marks the review source completed only after generation succeeds', async () => {
    const ready = { ...completedInterviewState(), status: 'ready_to_generate' as const }
    const readQuery = query({ data: interviewRow({ usage_metadata: { soheeConversationInterview: ready } }), error: null })
    const updateQuery = query({ data: { id: messageId }, error: null })
    const client = {
      from: vi.fn().mockReturnValueOnce(readQuery).mockReturnValueOnce(updateQuery),
    } as unknown as ServerSupabaseClient

    const result = await completeContentInterview({ client, workspaceId, messageId })

    expect(result?.status).toBe('completed')
    expect(updateQuery.update).toHaveBeenCalledWith(expect.objectContaining({ usage_metadata: expect.any(Object) }))
  })

  it('retires a collecting projection without rewriting its message or other metadata', async () => {
    const readQuery = query({ data: interviewRow({ usage_metadata: { soheeConversationInterview: collectingInterviewState(), kept: 'evidence' } }), error: null })
    const updateQuery = query({ data: { id: messageId }, error: null })
    const client = { from: vi.fn().mockReturnValueOnce(readQuery).mockReturnValueOnce(updateQuery) } as unknown as ServerSupabaseClient
    await expect(retireContentInterview({ client, workspaceId, messageId })).resolves.toBe(true)
    expect(updateQuery.update).toHaveBeenCalledWith({ usage_metadata: { kept: 'evidence' } })
  })

  it('retires the prior review projection when an edit starts a new collecting assistant', async () => {
    const ready = { ...completedInterviewState(), status: 'ready_to_generate' as const }
    const readQuery = query({ data: interviewRow({ usage_metadata: { soheeConversationInterview: ready } }), error: null })
    const updateQuery = query({ data: { id: messageId }, error: null })
    const client = {
      from: vi.fn().mockReturnValueOnce(readQuery).mockReturnValueOnce(updateQuery),
    } as unknown as ServerSupabaseClient

    await expect(retireContentInterview({ client, workspaceId, messageId })).resolves.toBe(true)
    expect(updateQuery.update).toHaveBeenCalledWith({ usage_metadata: {} })
  })

  it('loads a ready interview by failed assistant id without exposing raw metadata', async () => {
    const ready = { ...completedInterviewState(), status: 'ready_to_generate' as const }
    const latestQuery = query({
      data: interviewRow({ usage_metadata: { soheeConversationInterview: ready } }),
      error: null,
    })
    const client = { from: vi.fn(() => latestQuery) } as unknown as ServerSupabaseClient

    const result = await findContentInterviewByMessage({ client, workspaceId, messageId })

    expect(result?.state.status).toBe('ready_to_generate')
    expect(latestQuery.eq).toHaveBeenCalledWith('id', messageId)
  })

  it('returns only confirmed content media owned by the workspace in request order', async () => {
    const ids = [
      '60000000-0000-4000-8000-000000000001',
      '60000000-0000-4000-8000-000000000002',
    ]
    const mediaQuery = query({
      data: ids.map((id) => ({ id, workspace_id: workspaceId, bucket_id: 'content-media', kind: 'content', rights_status: 'confirmed' })),
      error: null,
    })
    const client = { from: vi.fn(() => mediaQuery) } as unknown as ServerSupabaseClient

    await expect(validateContentInterviewAttachments({ client, workspaceId, attachmentIds: ids })).resolves.toEqual(ids)
    expect(mediaQuery.in).toHaveBeenCalledWith('id', ids)
    expect(mediaQuery.eq).toHaveBeenCalledWith('bucket_id', 'content-media')
    expect(mediaQuery.eq).toHaveBeenCalledWith('kind', 'content')
    expect(mediaQuery.eq).toHaveBeenCalledWith('rights_status', 'confirmed')
  })

  it('closes the prior message and preserves a schema-valid ready state on cancellation', async () => {
    const ready = { ...completedInterviewState(), status: 'ready_to_generate' as const }
    const readQuery = query({
      data: interviewRow({ usage_metadata: { soheeConversationInterview: ready } }),
      error: null,
    })
    const updateQuery = query({ data: { id: messageId }, error: null })
    const client = {
      from: vi.fn().mockReturnValueOnce(readQuery).mockReturnValueOnce(updateQuery),
    } as unknown as ServerSupabaseClient

    const result = await cancelContentInterview({ client, workspaceId, messageId })

    expect(result?.status).toBe('cancelled')
    expect(result?.brief).toBeDefined()
    expect(updateQuery.update).toHaveBeenCalledWith(expect.objectContaining({
      status: 'cancelled',
      error_code: 'CHAT_CANCELLED',
    }))
  })

  it('rejects an attachment when the database does not return every requested asset', async () => {
    const id = '60000000-0000-4000-8000-000000000003'
    const mediaQuery = query({ data: [], error: null })
    const client = { from: vi.fn(() => mediaQuery) } as unknown as ServerSupabaseClient

    await expect(validateContentInterviewAttachments({ client, workspaceId, attachmentIds: [id] }))
      .rejects.toThrow('content_interview_attachment_forbidden')
  })
})
