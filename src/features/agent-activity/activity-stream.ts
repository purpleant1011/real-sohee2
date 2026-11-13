import { parseSseStream, type SseEvent } from '@/features/chat-floor/parse-sse-stream'
import { isActivityId, projectActivityEvent, type AgentActivityEvent } from './activity-event'
import { ActivityCursor, followActivity } from './activity-recovery'

interface ActivityStreamOptions {
  workspaceId: string
  signal?: AbortSignal
  onActivity: (event: AgentActivityEvent) => void
  onPending?: (nextCheckAt: number | null) => void
  onFrame: (event: SseEvent) => void
  fetcher?: (url: string, init?: RequestInit) => Promise<Response>
}

export async function consumeActivityStream(body: ReadableStream<Uint8Array>, options: ActivityStreamOptions): Promise<void> {
  const { workspaceId, signal, onActivity, onFrame, fetcher = fetch } = options
  signal?.throwIfAborted()
  let cursor: ActivityCursor | undefined
  let terminal = false
  let disconnected = false
  const frames = parseSseStream(body)
  try {
    while (true) {
      let next: IteratorResult<SseEvent>
      try { next = await frames.next() } catch {
        signal?.throwIfAborted()
        disconnected = true
        break
      }
      signal?.throwIfAborted()
      if (next.done) break
      const frame = next.value
      if (frame.event === 'activity') {
        const event = projectActivityEvent(frame.data)
        if (!event) throw new Error('ACTIVITY_INVALID')
        if (event.workspace_id !== workspaceId) throw new Error('ACTIVITY_SCOPE_MISMATCH')
        cursor ??= new ActivityCursor(workspaceId, event.run_id)
        cursor.push(event).forEach(onActivity)
      } else {
        if (frame.event === 'run' && isActivityId(frame.data?.runId)) {
          if (cursor && cursor.runId !== frame.data.runId) throw new Error('ACTIVITY_SCOPE_MISMATCH')
          cursor ??= new ActivityCursor(workspaceId, frame.data.runId)
        }
        if (frame.event === 'result' || frame.event === 'error') terminal = true
        onFrame(frame)
      }
    }
  } finally {
    await frames.return(undefined)
  }
  signal?.throwIfAborted()
  if (cursor && (!terminal || disconnected || cursor.hasGap)) {
    await followActivity(cursor, { fetcher, signal, onActivity, onPending: options.onPending })
  } else if (disconnected) {
    throw new Error('ACTIVITY_STREAM_DISCONNECTED')
  }
}
