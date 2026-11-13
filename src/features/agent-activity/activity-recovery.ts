import { projectActivityEvent, type AgentActivityEvent } from './activity-event'
import { isActivityRunActive, isActivityRunStatus, type ActivityRunStatus } from './activity-run-status'

export class ActivityCursor {
  private sequence = 0
  private readonly events = new Map<number, AgentActivityEvent>()

  constructor(readonly workspaceId: string, readonly runId: string) {}

  get lastSequence(): number {
    return this.sequence
  }

  get hasGap(): boolean {
    return [...this.events.keys()].some(sequence => sequence > this.sequence)
  }

  fork(): ActivityCursor {
    const cursor = new ActivityCursor(this.workspaceId, this.runId)
    cursor.sequence = this.sequence
    this.events.forEach((event, sequence) => cursor.events.set(sequence, event))
    return cursor
  }

  pushBatch(values: unknown[]): AgentActivityEvent[] {
    const candidate = this.fork()
    const ready = values.flatMap(value => candidate.push(value))
    this.sequence = candidate.sequence
    this.events.clear()
    candidate.events.forEach((event, sequence) => this.events.set(sequence, event))
    return ready
  }

  push(value: unknown): AgentActivityEvent[] {
    const event = projectActivityEvent(value)
    if (!event) throw new Error('ACTIVITY_INVALID')
    if (event.workspace_id !== this.workspaceId || event.run_id !== this.runId) {
      throw new Error('ACTIVITY_SCOPE_MISMATCH')
    }
    const existing = this.events.get(event.sequence)
    if (existing && existing.event_id !== event.event_id) {
      throw new Error('ACTIVITY_SEQUENCE_CONFLICT')
    }
    if (existing) return []
    this.events.set(event.sequence, event)
    const ready: AgentActivityEvent[] = []
    while (this.events.has(this.sequence + 1)) {
      this.sequence += 1
      ready.push(this.events.get(this.sequence)!)
    }
    return ready
  }
}

interface RecoveryOptions {
  fetcher?: (url: string, init?: RequestInit) => Promise<Response>
  signal?: AbortSignal
}

export async function recoverActivity(cursor: ActivityCursor, options: RecoveryOptions = {}): Promise<AgentActivityEvent[]> {
  return (await recoverSnapshot(cursor, options)).events
}

async function recoverSnapshot(
  cursor: ActivityCursor,
  { fetcher = fetch, signal }: RecoveryOptions,
  requireStatus = false,
): Promise<{ events: AgentActivityEvent[]; status: ActivityRunStatus | undefined }> {
  signal?.throwIfAborted()
  const candidate = cursor.fork()
  const restored: AgentActivityEvent[] = []
  while (true) {
    const after = candidate.lastSequence
    const query = new URLSearchParams({ runId: cursor.runId, 'last-seq': String(after) })
    const response = await fetcher(`/api/workspaces/${cursor.workspaceId}/agent/activity?${query}`, {
      method: 'GET', cache: 'no-store', signal,
    })
    signal?.throwIfAborted()
    if (!response.ok) throw new Error('ACTIVITY_REPLAY_FAILED')
    const payload: unknown = await response.json()
    signal?.throwIfAborted()
    if (!payload || typeof payload !== 'object' || !('events' in payload) || !Array.isArray(payload.events) || payload.events.length > 200) {
      throw new Error('ACTIVITY_INVALID')
    }
    const status = 'run_status' in payload && isActivityRunStatus(payload.run_status) ? payload.run_status : undefined
    if (requireStatus && !status) throw new Error('ACTIVITY_INVALID')
    restored.push(...candidate.pushBatch(payload.events))
    if (payload.events.length < 200) {
      if (candidate.hasGap) throw new Error('ACTIVITY_REPLAY_GAP')
      return { events: cursor.pushBatch(restored), status }
    }
    if (candidate.lastSequence <= after) throw new Error('ACTIVITY_REPLAY_GAP')
  }
}

function waitForNextCheck(signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted()
    const abort = () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
      reject(signal?.reason ?? new DOMException('Aborted', 'AbortError'))
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', abort)
      resolve()
    }, 2_000)
    signal?.addEventListener('abort', abort, { once: true })
  })
}

export async function followActivity(
  cursor: ActivityCursor,
  options: RecoveryOptions & {
    onActivity: (event: AgentActivityEvent) => void
    onPending?: (nextCheckAt: number | null) => void
  },
): Promise<ActivityRunStatus> {
  for (let attempt = 0; ; attempt++) {
    const { events, status } = await recoverSnapshot(cursor, options, true)
    options.signal?.throwIfAborted()
    if (!status) throw new Error('ACTIVITY_INVALID')
    events.forEach(options.onActivity)
    // A terminal execution state never creates a verified business outcome.
    if (!isActivityRunActive(status)) return status
    if (attempt === 4) {
      options.onPending?.(null)
      return status
    }
    options.onPending?.(Date.now() + 2_000)
    await waitForNextCheck(options.signal)
  }
}
