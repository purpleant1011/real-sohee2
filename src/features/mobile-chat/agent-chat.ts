import { parseSseStream } from '@/features/chat-floor/parse-sse-stream'
import { ActivityCursor, recoverActivity } from '@/features/agent-activity/activity-recovery'
import { projectActivityEvent, type AgentActivityEvent } from '@/features/agent-activity/activity-event'
import { projectPublicAgentProgress } from '@/features/agent-activity/public-agent-progress'
import type { AgentProgressEvent } from '@/features/tool-runtime/agent-loop-engine'
import { chatId, record, projectPublicChatResult, type PublicChatResult } from '@/lib/agent-os/public-chat-result'
import { toChatSnapshot, latestThreadId, failedChatSnapshot } from './r2-chat-snapshot'
import type { ChatViewSnapshot } from './mobile-chat-view'

export function agentThreadLookup(value: unknown) {
  const source = record(value)
  return latestThreadId(source?.success === true ? { data: { items: source.threads } } : null)
}

export function agentMessagesSnapshot(value: unknown, workspaceId: string, threadId: string): ChatViewSnapshot {
  const source = record(value)
  const checkedAt = new Date().toISOString()
  if (source?.success !== true || !Array.isArray(source.messages)) return failedChatSnapshot(checkedAt)
  if (source.messages.some(row => {
    const message = record(row)
    return !message || (message.workspaceId && message.workspaceId !== workspaceId) || (message.threadId && message.threadId !== threadId)
  })) return failedChatSnapshot(checkedAt)
  const snapshot = toChatSnapshot({ data: source.messages }, { checkedAt, limit: 50 })
  const last = [...source.messages].reverse().find(row => record(row)?.role === 'sohee')
  const metadata = record(record(last)?.usageMetadata)
  const candidate = projectPublicChatResult(metadata?.publicChatResult)
  const runId = chatId(record(last)?.runId)
  const result = candidate && (!candidate.threadId || candidate.threadId === threadId) && (!candidate.runId || candidate.runId === runId) ? candidate : null
  const latestTurn = [...source.messages].reverse().find(row => ['user', 'sohee'].includes(String(record(row)?.role)))
  const uncertain = record(latestTurn)?.role === 'user'
  return { ...snapshot, uncertain, ...(result ? { agentResult: result } : {}), ...(runId ? { agentRunId: runId } : {}) }
}

interface StreamOptions {
  signal?: AbortSignal
  onRun?: (runId: string, threadId?: string) => void
  onActivity?: (event: AgentActivityEvent) => void
  onProgress?: (event: AgentProgressEvent) => void
}

/** terminal은 응답 종료이지 외부 업무 완료가 아니다. POST는 자동 재시도하지 않는다. */
export async function readAgentChatResponse(response: Response, workspaceId: string, options: StreamOptions): Promise<PublicChatResult> {
  if (!response.ok) throw new Error('AGENT_CHAT_FAILED')
  if (!response.headers.get('content-type')?.includes('text/event-stream')) {
    const result = projectPublicChatResult(await response.json())
    if (!result) throw new Error('AGENT_RESULT_INVALID')
    return result
  }
  if (!response.body) throw new Error('AGENT_STREAM_MISSING')
  let runId: string | undefined
  let threadId: string | undefined
  let result: PublicChatResult | null = null
  let cursor: ActivityCursor | undefined
  for await (const frame of parseSseStream(response.body)) {
    options.signal?.throwIfAborted()
    if (frame.event === 'error') throw new Error('AGENT_TURN_FAILED')
    if (frame.event === 'run') {
      const id = chatId(frame.data?.runId)
      if (!id || (runId && runId !== id)) throw new Error('AGENT_SCOPE_MISMATCH')
      runId = id
      threadId = chatId(frame.data?.threadId)
      cursor ??= new ActivityCursor(workspaceId, id)
      options.onRun?.(id, threadId)
    } else if (frame.event === 'activity') {
      const event = projectActivityEvent(frame.data)
      if (!event || !cursor) throw new Error('AGENT_ACTIVITY_INVALID')
      cursor.push(event).forEach(value => options.onActivity?.(value))
    } else if (frame.event === 'progress') {
      const progress = projectPublicAgentProgress(frame.data)
      if (progress) options.onProgress?.(progress)
    } else if (frame.event === 'result') {
      if (result) throw new Error('AGENT_DUPLICATE_RESULT')
      result = projectPublicChatResult(frame.data)
      if (!result || (runId && result.runId !== runId) || (threadId && result.threadId !== threadId)) throw new Error('AGENT_RESULT_INVALID')
    }
  }
  options.signal?.throwIfAborted()
  if (!result || cursor?.hasGap) throw new Error('AGENT_STREAM_INCOMPLETE')
  return result
}

export async function restoreAgentActivities(workspaceId: string, runId: string, fetchImpl: typeof fetch, signal?: AbortSignal) {
  return recoverActivity(new ActivityCursor(workspaceId, runId), { fetcher: fetchImpl, signal })
}
