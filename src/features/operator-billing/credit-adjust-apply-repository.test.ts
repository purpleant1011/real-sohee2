import { describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
import { applyApprovedCreditAdjustment, type CreditAdjustApplyRpcGateway } from './credit-adjust-apply-repository'

const approvalRequestId = '10000000-0000-4000-8000-000000000001'
const ledgerEntryId = '10000000-0000-4000-8000-000000000002'
const gateway = (data: unknown = { ledger_entry_id: ledgerEntryId, account_version: 4, status: 'applied' }): CreditAdjustApplyRpcGateway => ({ rpc: vi.fn(async () => ({ data, error: null })) })

describe('credit adjustment apply repository', () => {
  it('calls the approved-only RPC and returns the versioned ledger result', async () => {
    const read = gateway()
    await expect(applyApprovedCreditAdjustment({ approvalRequestId }, { gateway: read })).resolves.toEqual({ data: { ledgerEntryId, accountVersion: 4, status: 'applied' }, error: null })
    expect(read.rpc).toHaveBeenCalledWith('apply_approved_credit_adjustment', { p_approval_request_id: approvalRequestId })
  })

  it('fails closed on a forbidden provider-shaped response', async () => {
    await expect(applyApprovedCreditAdjustment({ approvalRequestId }, { gateway: gateway({ ledger_entry_id: ledgerEntryId, account_version: 4, status: 'applied', provider_reference: 'secret' }) })).resolves.toMatchObject({ data: null, error: 'BILLING_WRITE_UNAVAILABLE' })
  })
})
