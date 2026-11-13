import { describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
import { getOperatorOnboardingOverview, type OperatorOnboardingGateway } from './lifecycle-repository'

const workspaceId = '11111111-1111-4111-8111-111111111111'
const base = {
  workspace_id: workspaceId,
  workspace_name: 'Workspace A',
  lifecycle: { state: 'fresh', status: 'contract_review', version: 2, changed_at: '2026-08-23T00:00:00.000Z' },
  agreements: { state: 'empty', items: [] },
  delegations: { state: 'empty', items: [] },
  activation: { ready: false, missing: ['service_agreement'] },
  source_timestamps: { workspace: '2026-08-23T00:00:00.000Z', lifecycle: '2026-08-23T00:00:00.000Z' },
  read_state: 'fresh',
}

function gateway(data: unknown = [base]): OperatorOnboardingGateway {
  return { rpc: vi.fn(async () => ({ data, error: null })) }
}

describe('operator onboarding lifecycle repository', () => {
  it('calls only the scoped onboarding overview RPC and maps strict wire data', async () => {
    const provided = gateway()
    const result = await getOperatorOnboardingOverview(workspaceId, provided)
    expect(provided.rpc).toHaveBeenCalledWith('get_operator_onboarding_overview', { p_workspace_id: workspaceId })
    expect(result).toMatchObject({ data: [{ workspaceId, lifecycle: { data: { status: 'contract_review', version: 2 } } }] })
  })

  it('rejects invalid workspace IDs, unknown keys and cross-workspace rows', async () => {
    const provided = gateway([{ ...base, extra: 'forbidden' }])
    await expect(getOperatorOnboardingOverview('not-a-uuid', provided)).resolves.toEqual({ data: null, error: 'ONBOARDING_INPUT_INVALID' })
    await expect(getOperatorOnboardingOverview(workspaceId, provided)).resolves.toEqual({ data: null, error: 'ONBOARDING_OVERVIEW_UNAVAILABLE' })
    const mismatch = gateway([{ ...base, workspace_id: '22222222-2222-4222-8222-222222222222' }])
    await expect(getOperatorOnboardingOverview(workspaceId, mismatch)).resolves.toEqual({ data: null, error: 'ONBOARDING_OVERVIEW_UNAVAILABLE' })
  })

  it('preserves unknown, empty and error states without inventing zero values or secrets', async () => {
    const provided = gateway([{ ...base, lifecycle: { state: 'unknown', status: null, version: null, changed_at: null }, agreements: { state: 'error', items: null, code: 'ONBOARDING_SOURCE_UNAVAILABLE' }, delegations: { state: 'empty', items: [] }, activation: { ready: false, missing: ['privacy_consent'] }, read_state: 'unknown' }])
    const result = await getOperatorOnboardingOverview(workspaceId, provided)
    expect(result).toMatchObject({ data: [{ lifecycle: { state: 'unknown' }, agreements: { state: 'error' }, delegations: { state: 'empty' } }] })
    expect(JSON.stringify(result)).not.toMatch(/token|secret|password|0원|0건/iu)
  })
})
