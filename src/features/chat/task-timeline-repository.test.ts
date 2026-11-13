import { describe, expect, it, vi } from 'vitest'
import { saveTaskTimeline } from './task-timeline-repository'
import type { ServerSupabaseClient } from '@/features/operations/types'
import type { TaskTimelineMessageArtifact } from './stream-events'
const workspaceId = '11111111-1111-4111-8111-111111111111'
const threadId = '22222222-2222-4222-8222-222222222222'
const messageId = '33333333-3333-4333-8333-333333333333'
const timeline: TaskTimelineMessageArtifact = { id: 'tasks', kind: 'task_timeline', title: '작업', totalSteps: 1,
  completedSteps: 0, steps: [{ id: 'write', title: '원고 준비', status: 'in_progress' }], isLive: true }
function setup(data: unknown, saved: unknown = { id: messageId }) {
  const query = (value: unknown) => { const q: any = {}; for (const name of ['select', 'update', 'eq']) q[name] = vi.fn(() => q)
    q.maybeSingle = vi.fn(async () => ({ data: value, error: null })); return q }
  const read = query(data); const write = query(saved)
  const client = { from: vi.fn().mockReturnValueOnce(read).mockReturnValueOnce(write) } as unknown as ServerSupabaseClient
  return { client, read, write }
}
describe('task timeline scoped metadata storage', () => {
  it('preserves existing metadata and requires workspace/thread/message/status plus metadata CAS', async () => {
    const original = { model: 'existing', soheeConversationInterview: { status: 'completed' } }
    const { client, read, write } = setup({ status: 'streaming', usage_metadata: original })
    await saveTaskTimeline({ client, workspaceId, threadId, messageId, timeline })
    expect(read.eq).toHaveBeenCalledWith('workspace_id', workspaceId)
    expect(read.eq).toHaveBeenCalledWith('thread_id', threadId)
    expect(write.eq).toHaveBeenCalledWith('id', messageId)
    expect(write.eq).toHaveBeenCalledWith('status', 'streaming')
    expect(write.eq).toHaveBeenCalledWith('usage_metadata', JSON.stringify(original))
    expect(write.update).toHaveBeenCalledWith({ usage_metadata: { ...original, soheeTaskTimeline: timeline } })
  })
  it('does not overwrite cancelled work with a late running snapshot', async () => {
    const { client, write } = setup({ status: 'cancelled', usage_metadata: {} })
    await expect(saveTaskTimeline({ client, workspaceId, threadId, messageId, timeline })).rejects.toThrow()
    expect(write.update).not.toHaveBeenCalled()
  })
  it('stores the final non-live snapshot after terminal message finalization but not a late running one', async () => {
    const final = { ...timeline, isLive: false, completedSteps: 1, steps: [{ ...timeline.steps[0], status: 'completed' as const }] }
    const accepted = setup({ status: 'completed', usage_metadata: {} })
    await saveTaskTimeline({ client: accepted.client, workspaceId, threadId, messageId, timeline: final })
    expect(accepted.write.update).toHaveBeenCalled()
    const rejected = setup({ status: 'completed', usage_metadata: {} })
    await expect(saveTaskTimeline({ client: rejected.client, workspaceId, threadId, messageId, timeline })).rejects.toThrow()
  })
  it('does not let late completion overwrite a cancelled request', async () => {
    const { client, write } = setup({ status: 'cancelled', usage_metadata: {} })
    const late = { ...timeline, isLive: false, completedSteps: 1, steps: [{ ...timeline.steps[0], status: 'completed' as const }] }
    await expect(saveTaskTimeline({ client, workspaceId, threadId, messageId, timeline: late })).rejects.toThrow()
    expect(write.update).not.toHaveBeenCalled()
  })
  it('reports zero-row CAS as failure instead of pretending persistence', async () => {
    const { client } = setup({ status: 'streaming', usage_metadata: {} }, null)
    await expect(saveTaskTimeline({ client, workspaceId, threadId, messageId, timeline })).rejects.toThrow()
  })
})
