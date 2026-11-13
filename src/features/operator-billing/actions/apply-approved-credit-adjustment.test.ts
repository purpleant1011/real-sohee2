import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ apply: vi.fn() }))
vi.mock('../credit-adjust-apply-repository', () => ({ applyApprovedCreditAdjustment: mocks.apply }))

import { applyApprovedCreditAdjustmentAction } from './apply-approved-credit-adjustment'

const approvalRequestId = '10000000-0000-4000-8000-000000000001'

describe('applyApprovedCreditAdjustmentAction', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.apply.mockResolvedValue({ data: { ledgerEntryId: '10000000-0000-4000-8000-000000000002', accountVersion: 4, status: 'applied' }, error: null }) })

  it('returns the append-only adjustment result without payment/provider calls', async () => {
    await expect(applyApprovedCreditAdjustmentAction({ approvalRequestId })).resolves.toEqual({ data: { applied: true, ledgerEntryId: '10000000-0000-4000-8000-000000000002', accountVersion: 4 } })
    expect(mocks.apply).toHaveBeenCalledWith({ approvalRequestId })
  })

  it('rejects malformed approval request ids before apply', async () => {
    await expect(applyApprovedCreditAdjustmentAction({ approvalRequestId: 'bad' })).resolves.toHaveProperty('error')
    expect(mocks.apply).not.toHaveBeenCalled()
  })
})
