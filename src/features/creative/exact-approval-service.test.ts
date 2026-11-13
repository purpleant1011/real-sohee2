import { describe, expect, it } from 'vitest'
import { ExactApprovalService } from './exact-approval-service'

const workspaceId = 'workspace-review'
const bundleId = 'bundle-review'
const fingerprint = 'a'.repeat(64)
const actorId = 'owner-review'
const approved = {
  id: bundleId, workspace_id: workspaceId, bundle_fingerprint: fingerprint,
  approval_status: 'APPROVED', approved_fingerprint: fingerprint,
  approved_at: '2026-10-26T01:00:00Z', approved_by: actorId,
}

// Only the database boundary is replaced; both mutation and replay use the real service.
function database(row: Record<string, unknown>, replay = false) {
  return { from: () => {
    const filters: Record<string, unknown> = {}
    const query = {
      update: () => query,
      match: (value: Record<string, unknown>) => { Object.assign(filters, value); return query },
      select: () => query,
      eq: (key: string, value: unknown) => { filters[key] = value; return query },
      single: async () => replay && filters.approval_status === 'PENDING'
        ? { data: null, error: { code: 'PGRST116' } }
        : { data: row, error: null },
    }
    return query
  } }
}

const approve = (row: Record<string, unknown>, replay = false) => new ExactApprovalService(database(row, replay))
  .approveBundleExact({ workspaceId, bundleId, expectedFingerprint: fingerprint, decidedBy: actorId })

describe('exact bundle approval returned evidence', () => {
  it('returns the stored decision without replacing its timestamp', async () => {
    await expect(approve(approved)).resolves.toEqual({
      bundleId, status: 'APPROVED', approvedFingerprint: fingerprint,
      approvedAt: '2026-10-26T01:00:00Z', approvedBy: actorId, isIdempotentReplay: false,
    })
  })

  it.each([
    { approved_fingerprint: null },
    { approved_fingerprint: 'b'.repeat(64) },
    { bundle_fingerprint: 'b'.repeat(64) },
    { approved_at: null },
    { approved_at: 'invalid-date' },
    { approved_by: null },
    { approved_by: ' ' },
    { approved_by: 'another-owner' },
    { approval_status: 'PENDING' },
    { id: 'another-bundle' },
    { workspace_id: 'another-workspace' },
  ])('does not fabricate success from an incomplete or mismatched mutation result: %j', async change => {
    await expect(approve({ ...approved, ...change })).rejects.toMatchObject({ code: 'BUNDLE_APPROVAL_RESULT_UNKNOWN' })
  })

  it.each([{ id: 'another-bundle' }, { workspace_id: 'another-workspace' }])(
    'does not replay a decision from another scope: %j', async change => {
      await expect(approve({ ...approved, ...change }, true)).rejects.toMatchObject({ code: 'BUNDLE_APPROVAL_RESULT_UNKNOWN' })
    },
  )

  it('preserves the original approver on an intact idempotent replay', async () => {
    await expect(approve({ ...approved, approved_by: 'original-owner' }, true)).resolves.toMatchObject({
      approvedBy: 'original-owner', approvedAt: '2026-10-26T01:00:00Z', isIdempotentReplay: true,
    })
  })
})
