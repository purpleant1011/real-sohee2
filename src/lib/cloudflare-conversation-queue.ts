const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type ConversationQueueMessage = Readonly<{
  schemaVersion: 1
  jobId: string
  workspaceId: string
}>

export type QueueMessageLike = Readonly<{
  body: unknown
  ack(): void
  retry(options?: Readonly<{ delaySeconds?: number }>): void
}>

export function parseConversationQueueMessage(value: unknown): ConversationQueueMessage {
  if (
    typeof value === 'object' &&
    value !== null &&
    (value as Record<string, unknown>).schemaVersion === 1 &&
    typeof (value as Record<string, unknown>).jobId === 'string' &&
    UUID_REGEX.test((value as Record<string, unknown>).jobId as string) &&
    typeof (value as Record<string, unknown>).workspaceId === 'string' &&
    UUID_REGEX.test((value as Record<string, unknown>).workspaceId as string) &&
    Object.keys(value).length === 3
  ) {
    return Object.freeze({
      schemaVersion: 1,
      jobId: (value as Record<string, unknown>).jobId as string,
      workspaceId: (value as Record<string, unknown>).workspaceId as string,
    })
  }
  throw new Error('CONVERSATION_QUEUE_MESSAGE_INVALID')
}

export async function consumeConversationJobs(
  batch: Readonly<{ messages: readonly QueueMessageLike[] }>,
  dependencies: Readonly<{
    run(jobId: string, workerId: string): Promise<Readonly<{ state: string }>>
    workerId(): string
  }>,
) {
  for (const message of batch.messages) {
    let envelope: ConversationQueueMessage
    try {
      envelope = parseConversationQueueMessage(message.body)
    } catch {
      message.ack()
      continue
    }
    const result = await dependencies.run(envelope.jobId, dependencies.workerId())
    if (result.state === 'blocked') message.retry({ delaySeconds: 60 })
    else message.ack()
  }
}

export async function runProductionConversationQueue(batch: Readonly<{
  messages: readonly QueueMessageLike[]
}>) {
  const { runProductionConversationJob } = await import('@/features/chat/jobs/production-runner')
  return consumeConversationJobs(batch, {
    run: runProductionConversationJob,
    workerId: () => crypto.randomUUID(),
  })
}

// worker-entry.js already calls this name; keep a thin compatibility adapter.
export async function handleConversationJobQueue(
  batch: Readonly<{ messages: readonly QueueMessageLike[] }>,
  _env?: Readonly<Record<string, unknown>>,
) {
  return runProductionConversationQueue(batch)
}
