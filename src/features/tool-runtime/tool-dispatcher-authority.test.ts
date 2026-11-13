import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ admission: vi.fn(), execute: vi.fn() }))
vi.mock('@/lib/mcp-gateway/tool-admission-controller', () => ({ ToolAdmissionController: { checkAdmission: mocks.admission } }))
vi.mock('./dispatchers/system-dispatcher', () => ({ systemDispatcher: { execute: mocks.execute } }))
import { ToolDispatcher } from './tool-dispatcher'
const base = { workspaceId: 'workspace-a', actionRunId: 'job-a', correlationId: 'turn-a', actorId: 'user-a' }
beforeEach(() => { vi.clearAllMocks(); mocks.admission.mockResolvedValue({ admitted: true }); mocks.execute.mockResolvedValue({ success: true, toolId: 'credit.status', status: 'COMPLETED', data: { balance: 9 } }) })
describe('dispatcher conversation authority', () => {
  it('rejects an empty allowlist before admission or execution', async () => {
    const result = await ToolDispatcher.dispatch('credit.status', {}, { ...base, allowedCapabilityIds: [] })
    expect(result.success).toBe(false)
    expect(mocks.admission).not.toHaveBeenCalled()
    expect(mocks.execute).not.toHaveBeenCalled()
  })
  it('normalizes aliases without widening permission', async () => {
    const result = await ToolDispatcher.dispatch('mcp_check_credits', {}, { ...base, allowedCapabilityIds: ['credit.status'] })
    expect(result.success).toBe(true)
    expect(mocks.execute).toHaveBeenCalledOnce()
  })
  it('rechecks current actor authority after admission', async () => {
    let revoked = false
    mocks.admission.mockImplementation(async () => { revoked = true; return { admitted: true } })
    const result = await ToolDispatcher.dispatch('credit.status', {}, { ...base,
      allowedCapabilityIds: ['credit.status'], authorizeCapability: async () => !revoked })
    expect(result.success).toBe(false)
    expect(mocks.execute).not.toHaveBeenCalled()
  })
  it('fails closed when the authority check cannot be completed', async () => {
    const result = await ToolDispatcher.dispatch('credit.status', {}, { ...base,
      allowedCapabilityIds: ['credit.status'], authorizeCapability: async () => { throw new Error('offline') } })
    expect(result.success).toBe(false)
    expect(mocks.execute).not.toHaveBeenCalled()
  })
})
