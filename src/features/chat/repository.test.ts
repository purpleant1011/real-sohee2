import { describe, expect, it, vi } from 'vitest'
import type { ServerSupabaseClient } from '@/features/operations/types'
import {
  advanceContentInterview,
  createInitialContentInterview,
  type ContentInterviewState,
} from './content-interview'
import { createConversationMessage, listConversationMessages } from './repository'

const draftResults = vi.hoisted(() => vi.fn())
vi.mock('./interaction-draft-results.server', () => ({ loadConversationInteractionDrafts: draftResults }))

const workspaceId = '20000000-0000-4000-8000-000000000001'
const threadId = '30000000-0000-4000-8000-000000000001'
const messageId = '40000000-0000-4000-8000-000000000001'
const clientMessageId = '50000000-0000-4000-8000-000000000001'

function collectingInterviewState(): ContentInterviewState {
  const initial = createInitialContentInterview({
    originalPrompt: '이번 주 콘텐츠를 준비해 줘.',
    channels: ['instagram'],
    requestedImageCounts: { instagram: 1 },
    referenceMediaIds: [],
  })
  return advanceContentInterview(initial, { value: 'consultation', source: 'option' })
}

const row = {
  id: messageId,
  workspace_id: workspaceId,
  thread_id: threadId,
  role: 'user',
  content: '이번 주 콘텐츠를 준비해 줘.',
  status: 'completed',
  work_item_id: null,
  created_at: '2026-08-10T01:00:00.000Z',
  completed_at: '2026-08-10T01:00:01.000Z',
} as const

function query(result: unknown) {
  const promise = Promise.resolve(result)
  type FakeQuery = {
    select: ReturnType<typeof vi.fn>
    eq: ReturnType<typeof vi.fn>
    lt: ReturnType<typeof vi.fn>
    order: ReturnType<typeof vi.fn>
    limit: ReturnType<typeof vi.fn>
    upsert: ReturnType<typeof vi.fn>
    maybeSingle: ReturnType<typeof vi.fn>
    then: PromiseLike<unknown>['then']
  }
  const builder = {} as FakeQuery
  Object.assign(builder, {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    lt: vi.fn(() => builder),
    order: vi.fn(() => builder),
    limit: vi.fn(() => builder),
    upsert: vi.fn(() => builder),
    maybeSingle: vi.fn(async () => result),
    then: promise.then.bind(promise),
  })
  return builder
}

describe('listConversationMessages', () => {
  it('hydrates canonical draft snapshots only for completed messages carrying an actual result marker', async () => {
    const snapshot = { id: 'step', draftText: '저장된 답안' }
    draftResults.mockResolvedValueOnce(new Map([[messageId, [snapshot]]]))
    const timeline = { id: 'tasks', kind: 'task_timeline', title: '답안 준비', totalSteps: 1, completedSteps: 1,
      steps: [{ id: 'draft', title: '답안 준비', status: 'completed', capabilityId: 'comment.reply_draft' }], isLive: false }
    const listQuery = query({ data: [{ ...row, role: 'sohee', usage_metadata: { soheeTaskTimeline: timeline } }], error: null })
    const client = { from: vi.fn(() => listQuery) } as unknown as ServerSupabaseClient
    const messages = await listConversationMessages({ client, workspaceId, threadId, limit: 20 })
    expect(messages[0].interactionDrafts).toEqual([snapshot])
    expect(draftResults).toHaveBeenLastCalledWith({ client, workspaceId, threadId, messageIds: [messageId] })
  })
  it('keeps the conversation readable while explicitly flagging an unavailable draft result lookup', async () => {
    draftResults.mockRejectedValueOnce(new Error('private database detail'))
    const timeline = { id: 'tasks', kind: 'task_timeline', title: '답안 준비', totalSteps: 1, completedSteps: 1,
      steps: [{ id: 'draft', title: '답안 준비', status: 'completed', capabilityId: 'dm.reply_draft' }], isLive: false }
    const listQuery = query({ data: [{ ...row, role: 'sohee', usage_metadata: { soheeTaskTimeline: timeline } }], error: null })
    const client = { from: vi.fn(() => listQuery) } as unknown as ServerSupabaseClient
    const messages = await listConversationMessages({ client, workspaceId, threadId, limit: 20 })
    expect(messages[0]).toMatchObject({ interactionDraftsUnavailable: true })
    expect(JSON.stringify(messages)).not.toContain('private database detail')
  })
  it('returns equal-timestamp turns in stable newest-first order so reverse replay keeps the user before the answer', async () => {
    const assistant = { ...row, id: '40000000-0000-4000-8000-000000000002', role: 'sohee', content: '정본 조회 결과 1건입니다.' }
    const listQuery = query({ data: [row, assistant], error: null })
    const client = { from: vi.fn(() => listQuery) } as unknown as ServerSupabaseClient
    const messages = await listConversationMessages({ client, workspaceId, threadId, limit: 20 })
    expect([...messages].reverse().map(message => message.role)).toEqual(['user', 'sohee'])
  })
  it('restores persisted tasks without exposing unrelated usage metadata or a stale spinner', async () => {
    const timeline = { id: 'tasks', kind: 'task_timeline', title: '소희의 작업', totalSteps: 1, completedSteps: 0,
      steps: [{ id: 'write', title: '문안 작성', status: 'in_progress' }], isLive: true }
    const listQuery = query({ data: [{ ...row, role: 'sohee', usage_metadata: { soheeTaskTimeline: timeline, privateValue: 'secret' } }], error: null })
    const client = { from: vi.fn(() => listQuery) } as unknown as ServerSupabaseClient
    const messages = await listConversationMessages({ client, workspaceId, threadId, limit: 20 })
    expect(messages[0].taskTimeline).toMatchObject({ isLive: false, completedSteps: 0, steps: [{ status: 'unknown' }] })
    expect(JSON.stringify(messages)).not.toContain('secret')
  })
  it('always scopes a recent page by workspace and thread', async () => {
    const listQuery = query({ data: [row], error: null })
    const client = { from: vi.fn(() => listQuery) } as unknown as ServerSupabaseClient

    await expect(
      listConversationMessages({ client, workspaceId, threadId, limit: 30 }),
    ).resolves.toEqual([
      {
        id: messageId,
        workspaceId,
        threadId,
        role: 'user',
        content: '이번 주 콘텐츠를 준비해 줘.',
        status: 'completed',
        workItemId: null,
        createdAt: '2026-08-10T01:00:00.000Z',
        completedAt: '2026-08-10T01:00:01.000Z',
      },
    ])
    expect(listQuery.eq).toHaveBeenNthCalledWith(1, 'workspace_id', workspaceId)
    expect(listQuery.eq).toHaveBeenNthCalledWith(2, 'thread_id', threadId)
  })

  it('returns the client message id used to reconcile an optimistic user message', async () => {
    const listQuery = query({
      data: [{ ...row, client_message_id: clientMessageId }],
      error: null,
    })
    const client = { from: vi.fn(() => listQuery) } as unknown as ServerSupabaseClient

    const messages = await listConversationMessages({ client, workspaceId, threadId, limit: 30 })

    expect(messages[0]).toMatchObject({
      id: messageId,
      clientMessageId,
    })
    expect(listQuery.select).toHaveBeenCalledWith(expect.stringContaining('client_message_id'))
  })

  it('returns every persisted conversation artifact reference for refresh replay', async () => {
    const artifactId = '60000000-0000-4000-8000-000000000001'
    const listQuery = query({
      data: [{ ...row, message_artifacts: [{ artifact_id: artifactId }] }],
      error: null,
    })
    const client = { from: vi.fn(() => listQuery) } as unknown as ServerSupabaseClient

    const messages = await listConversationMessages({ client, workspaceId, threadId, limit: 30 })

    expect(messages[0]?.artifacts).toEqual([
      { type: 'conversation_artifact', id: artifactId },
    ])
  })

  it('projects valid interview metadata as public clarification without returning raw metadata', async () => {
    const listQuery = query({
      data: [{
        ...row,
        role: 'sohee',
        usage_metadata: { soheeConversationInterview: collectingInterviewState() },
      }],
      error: null,
    })
    const client = { from: vi.fn(() => listQuery) } as unknown as ServerSupabaseClient

    const messages = await listConversationMessages({ client, workspaceId, threadId, limit: 20 })

    expect(messages[0]?.clarification?.step).toBe(2)
    expect(messages[0]?.clarification?.totalSteps).toBe(4)
    expect(messages[0]).not.toHaveProperty('usage_metadata')
    expect(listQuery.select).toHaveBeenCalledWith(expect.stringContaining('usage_metadata'))
  })

  it('ignores malformed interview metadata during message recovery', async () => {
    const listQuery = query({
      data: [{
        ...row,
        role: 'sohee',
        usage_metadata: {
          soheeConversationInterview: { ...collectingInterviewState(), step: 5 },
        },
      }],
      error: null,
    })
    const client = { from: vi.fn(() => listQuery) } as unknown as ServerSupabaseClient

    const messages = await listConversationMessages({ client, workspaceId, threadId, limit: 20 })

    expect(messages[0]).not.toHaveProperty('clarification')
  })

  it('rejects a recovered message whose workspace does not match the requested scope', async () => {
    const listQuery = query({
      data: [{ ...row, workspace_id: '20000000-0000-4000-8000-000000000099' }],
      error: null,
    })
    const client = { from: vi.fn(() => listQuery) } as unknown as ServerSupabaseClient

    await expect(
      listConversationMessages({ client, workspaceId, threadId, limit: 20 }),
    ).rejects.toThrow('conversation_message_workspace_mismatch')
  })
})

describe('createConversationMessage', () => {
  it('returns the existing message when a client message id is duplicated', async () => {
    const insertQuery = query({ data: null, error: null })
    const existingQuery = query({ data: row, error: null })
    const client = {
      from: vi.fn().mockReturnValueOnce(insertQuery).mockReturnValueOnce(existingQuery),
    } as unknown as ServerSupabaseClient

    await expect(
      createConversationMessage({
        client,
        workspaceId,
        threadId,
        clientMessageId,
        userId: '10000000-0000-4000-8000-000000000001',
        content: '이번 주 콘텐츠를 준비해 줘.',
      }),
    ).resolves.toMatchObject({ id: messageId, workspaceId, threadId })

    expect(insertQuery.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ client_message_id: clientMessageId }),
      { ignoreDuplicates: true, onConflict: 'workspace_id,client_message_id' },
    )
    expect(existingQuery.eq).toHaveBeenCalledWith('workspace_id', workspaceId)
    expect(existingQuery.eq).toHaveBeenCalledWith('client_message_id', clientMessageId)
  })
})
