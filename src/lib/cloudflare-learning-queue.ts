import type { QueueMessageLike } from './cloudflare-conversation-queue'

export type LearningQueueMessage = Readonly<{
  schemaVersion: 2
  kind: 'knowledge_collect' | 'knowledge_verify' | 'knowledge_delete'
  jobId: string
  workspaceId: string
}>
export type LearningQueueDependencies = Readonly<{
  runLearning(message: LearningQueueMessage): Promise<{ state: string }>
  runConversation(batch: { messages: readonly QueueMessageLike[] }): Promise<unknown>
}>

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const kinds = new Set(['knowledge_collect', 'knowledge_verify', 'knowledge_delete'])

export function parseLearningQueueMessage(value: unknown): LearningQueueMessage {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('LEARNING_QUEUE_MESSAGE_INVALID')
  }
  const row = value as Record<string, unknown>
  if (Object.keys(row).length !== 4 || row.schemaVersion !== 2
    || typeof row.kind !== 'string' || !kinds.has(row.kind)
    || typeof row.jobId !== 'string' || !UUID.test(row.jobId)
    || typeof row.workspaceId !== 'string' || !UUID.test(row.workspaceId)) {
    throw new Error('LEARNING_QUEUE_MESSAGE_INVALID')
  }
  return Object.freeze({ schemaVersion: 2, kind: row.kind as LearningQueueMessage['kind'],
    jobId: row.jobId, workspaceId: row.workspaceId })
}

export async function dispatchLearningQueue(
  batch: { messages: readonly QueueMessageLike[] }, dependencies: LearningQueueDependencies,
): Promise<void> {
  const legacy: QueueMessageLike[] = []
  for (const message of batch.messages) {
    const body = message.body
    if (typeof body !== 'object' || body === null
      || (body as Record<string, unknown>).schemaVersion !== 2) {
      legacy.push(message)
      continue
    }
    let envelope: LearningQueueMessage
    try { envelope = parseLearningQueueMessage(body) } catch {
      // Poison payloads must not pass to a parser which silently treats them as conversation jobs.
      message.ack()
      continue
    }
    try {
      const result = await dependencies.runLearning(envelope)
      if (['complete', 'completed', 'cancelled', 'deleted', 'revoked', 'failed'].includes(result.state)) message.ack()
      else message.retry({ delaySeconds: 60 })
    } catch {
      // Transport failure is not a durable completion receipt. Let the configured queue DLQ bound retries.
      message.retry({ delaySeconds: 60 })
    }
  }
  if (legacy.length > 0) await dependencies.runConversation({ messages: legacy })
}
