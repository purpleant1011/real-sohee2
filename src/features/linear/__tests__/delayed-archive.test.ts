import { describe, it, expect, vi } from 'vitest'
import crypto from 'node:crypto'
import {
  verifyLinearWebhookSignature,
  shouldEnqueueDelayedArchive,
  processDelayedArchiveJob,
  LINEAR_ARCHIVE_GRACE_PERIOD_SECONDS,
  type LinearWebhookPayload,
  type LinearApiClient,
} from '../delayed-archive'

describe('Linear Delayed Auto-Archive (ANI-433)', () => {
  const secret = 'test-linear-secret'

  it('verifies valid HMAC-SHA256 Linear signature and rejects invalid ones', () => {
    const rawBody = JSON.stringify({ action: 'update', type: 'Issue' })
    const validSignature = crypto.createHmac('sha256', secret).update(rawBody).digest('hex')

    expect(verifyLinearWebhookSignature(rawBody, validSignature, secret)).toBe(true)
    expect(verifyLinearWebhookSignature(rawBody, 'invalid-signature-hex', secret)).toBe(false)
    expect(verifyLinearWebhookSignature(rawBody, null, secret)).toBe(false)
  })

  it('identifies new transitions to Done/completed state for delayed archiving', () => {
    const donePayload: LinearWebhookPayload = {
      action: 'update',
      type: 'Issue',
      data: {
        id: 'issue-1',
        identifier: 'ANI-433',
        title: 'Test issue',
        state: { id: 's-done', name: 'Done', type: 'completed' },
      },
      updatedFrom: {
        state: { id: 's-in-progress', name: 'In Progress', type: 'started' },
      },
      createdAt: new Date().toISOString(),
    }

    expect(shouldEnqueueDelayedArchive(donePayload)).toBe(true)
    expect(LINEAR_ARCHIVE_GRACE_PERIOD_SECONDS).toBe(900) // 15분

    // Non-Done transition
    const inProgressPayload: LinearWebhookPayload = {
      ...donePayload,
      data: {
        ...donePayload.data,
        state: { id: 's-started', name: 'In Progress', type: 'started' },
      },
    }
    expect(shouldEnqueueDelayedArchive(inProgressPayload)).toBe(false)
  })

  it('archives issue after 15 minutes if still completed', async () => {
    const mockClient: LinearApiClient = {
      getIssue: vi.fn(async () => ({
        id: 'issue-1',
        state: { type: 'completed' },
        archivedAt: null,
      })),
      archiveIssue: vi.fn(async () => ({ success: true })),
    }

    const result = await processDelayedArchiveJob('issue-1', mockClient)
    expect(result.status).toBe('ARCHIVED')
    expect(mockClient.archiveIssue).toHaveBeenCalledWith('issue-1')
  })

  it('cancels archive if issue was reopened during grace period', async () => {
    const mockClient: LinearApiClient = {
      getIssue: vi.fn(async () => ({
        id: 'issue-1',
        state: { type: 'started' }, // Reopened!
        archivedAt: null,
      })),
      archiveIssue: vi.fn(async () => ({ success: true })),
    }

    const result = await processDelayedArchiveJob('issue-1', mockClient)
    expect(result.status).toBe('SKIPPED_REOPENED')
    expect(mockClient.archiveIssue).not.toHaveBeenCalled()
  })

  it('skips archive without error if already archived (idempotency)', async () => {
    const mockClient: LinearApiClient = {
      getIssue: vi.fn(async () => ({
        id: 'issue-1',
        state: { type: 'completed' },
        archivedAt: '2026-09-01T12:00:00Z', // Already archived
      })),
      archiveIssue: vi.fn(async () => ({ success: true })),
    }

    const result = await processDelayedArchiveJob('issue-1', mockClient)
    expect(result.status).toBe('SKIPPED_ALREADY_ARCHIVED')
    expect(mockClient.archiveIssue).not.toHaveBeenCalled()
  })
})
