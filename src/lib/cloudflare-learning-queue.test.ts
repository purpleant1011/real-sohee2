import { describe, expect, it } from 'vitest'
import { dispatchLearningQueue, parseLearningQueueMessage } from './cloudflare-learning-queue'

const workspaceId = '11111111-1111-4111-8111-111111111111'
const jobId = '22222222-2222-4222-8222-222222222222'
const envelope = { schemaVersion: 2, kind: 'knowledge_collect', jobId, workspaceId }
function message(body: unknown) {
  const result = { acknowledged: 0, retried: 0 }
  return { body, result, ack() { result.acknowledged++ }, retry() { result.retried++ } }
}

describe('learning queue dispatch', () => {
  it('validates exact keys and supported job kinds before routing', () => {
    expect(parseLearningQueueMessage(envelope)).toEqual(envelope)
    expect(() => parseLearningQueueMessage({ ...envelope, accessToken: 'secret' })).toThrow()
    expect(() => parseLearningQueueMessage({ ...envelope, workspaceId: 'foreign' })).toThrow()
    expect(() => parseLearningQueueMessage({ ...envelope, kind: 'publish' })).toThrow()
  })

  it('partitions new learning jobs without dropping legacy conversation jobs', async () => {
    const learning = message(envelope)
    const conversation = message({ schemaVersion: 1, jobId, workspaceId })
    const seen: string[] = []
    await dispatchLearningQueue({ messages: [learning, conversation] }, {
      async runLearning(input) { seen.push(input.kind); return { state: 'complete' } },
      async runConversation(batch) { seen.push('conversation'); for (const item of batch.messages) item.ack() },
    })
    expect(seen).toEqual(['knowledge_collect', 'conversation'])
    expect(learning.result).toEqual({ acknowledged: 1, retried: 0 })
    expect(conversation.result).toEqual({ acknowledged: 1, retried: 0 })
  })

  it('retries unavailable workers rather than acknowledging unexecuted jobs', async () => {
    const unavailable = message(envelope)
    const crashed = message({ ...envelope, kind: 'knowledge_delete' })
    await dispatchLearningQueue({ messages: [unavailable, crashed] }, {
      async runLearning(input) {
        if (input.kind === 'knowledge_delete') throw new Error('private provider error')
        return { state: 'blocked' }
      },
      async runConversation() { throw new Error('unexpected legacy routing') },
    })
    expect(unavailable.result).toEqual({ acknowledged: 0, retried: 1 })
    expect(crashed.result).toEqual({ acknowledged: 0, retried: 1 })
  })

  it('does not let malformed learning payloads enter the legacy parser', async () => {
    const malformed = message({ ...envelope, workspaceId: 'bad' })
    let legacyCount = 0
    await dispatchLearningQueue({ messages: [malformed] }, {
      async runLearning() { throw new Error('invalid input reached execution') },
      async runConversation(batch) { legacyCount += batch.messages.length },
    })
    expect(legacyCount).toBe(0)
    expect(malformed.result).toEqual({ acknowledged: 1, retried: 0 })
  })

  it('acknowledges the durable runner completed status', async () => {
    const item = message(envelope)
    await dispatchLearningQueue({ messages: [item] }, {
      async runLearning() { return { state: 'completed' } }, async runConversation() {},
    })
    expect(item.result).toEqual({ acknowledged: 1, retried: 0 })
  })

  it('retries queued/processing/unknown outcomes until durable completion is observed', async () => {
    for (const state of ['queued', 'processing', 'retry', 'unknown']) {
      const item = message(envelope)
      await dispatchLearningQueue({ messages: [item] }, {
        async runLearning() { return { state } }, async runConversation() {},
      })
      expect(item.result).toEqual({ acknowledged: 0, retried: 1 })
    }
  })
})
