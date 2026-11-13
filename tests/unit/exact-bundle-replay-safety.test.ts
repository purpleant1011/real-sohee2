import { describe, expect, it } from 'vitest'
import { ExactApprovalService, FingerprintMismatchError, StaleApprovalConcurrencyError } from '@/features/creative/exact-approval-service'
import { filteredTableUpdate } from '../helpers/filtered-table-update'

const workspaceId = '11111111-1111-4111-a111-111111111111'
const bundleId = '22222222-2222-4222-a222-222222222222'
const actorId = '33333333-3333-4333-a333-333333333333'
const fingerprint = 'a'.repeat(64)

function approvedBundle(change: Record<string, unknown> = {}) {
  return {
    id: bundleId, workspace_id: workspaceId, content_id: 'content-1', version_id: 'version-1',
    channel: 'instagram', caption: '검토한 원고', hashtags: [], creative_brief_version: 'v1',
    bundle_fingerprint: fingerprint, approval_status: 'APPROVED', approved_fingerprint: fingerprint,
    approved_at: '2026-10-26T08:00:00.000Z', approved_by: actorId,
    created_at: '2026-10-26T07:00:00.000Z', updated_at: '2026-10-26T08:00:00.000Z', ...change,
  }
}

function database(rows: Record<string, unknown>[]) {
  return { from(table: string) {
    if (table !== 'creative_bundles') throw new Error('Unexpected table')
    return {
      update(patch: Record<string, unknown>) {
        return { match(filters: Record<string, unknown>) {
          const query = filteredTableUpdate(rows, patch)
          for (const [key, value] of Object.entries(filters)) query.eq(key, value)
          return { select: () => ({ single: () => query.maybeSingle() }) }
        } }
      },
      select() {
        const filters: Array<[string, unknown]> = []
        const query = {
          eq(key: string, value: unknown) { filters.push([key, value]); return query },
          async single() {
            return { data: rows.find(row => filters.every(([key, value]) => row[key] === value)) ?? null, error: null }
          },
        }
        return query
      },
    }
  } }
}

const command = { workspaceId, bundleId, expectedFingerprint: fingerprint, decidedBy: 'new-reviewer' }

describe('exact bundle replay safety', () => {
  it('rejects an old approval when the live bundle fingerprint has changed', async () => {
    const row = approvedBundle({ bundle_fingerprint: 'b'.repeat(64) })
    const service = new ExactApprovalService(database([row]))

    await expect(service.approveBundleExact(command)).rejects.toThrow(FingerprintMismatchError)
    expect(row.bundle_fingerprint).toBe('b'.repeat(64))
    expect(row.approved_by).toBe(actorId)
  })

  it.each([
    { approved_at: null },
    { approved_by: null },
  ])('does not invent missing original approval evidence: %j', async change => {
    const service = new ExactApprovalService(database([approvedBundle(change)]))
    await expect(service.approveBundleExact(command)).rejects.toThrow(StaleApprovalConcurrencyError)
  })

  it('returns the original actor and time for an unchanged confirmed approval', async () => {
    const row = approvedBundle()
    const service = new ExactApprovalService(database([row]))
    const result = await service.approveBundleExact(command)

    expect(result).toMatchObject({ status: 'APPROVED', isIdempotentReplay: true, approvedBy: actorId, approvedAt: '2026-10-26T08:00:00.000Z' })
    expect(row.approved_by).toBe(actorId)
  })
})
