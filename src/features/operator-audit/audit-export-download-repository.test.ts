import { describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
import { getAuditExportDownload } from './audit-export-download-repository'
const id = '10000000-0000-4000-8000-000000000001'
const operatorGateway = { getClaims: vi.fn(async () => ({ data: { claims: { sub: id } }, error: null })), getAal: vi.fn(async () => ({ data: { currentLevel: 'aal2' }, error: null })), getOperatorContext: vi.fn(async () => ({ data: { user_id: id, status: 'active', permissions: ['audit.read'], workspace_scope: 'all', mfa_required: true, permission_scopes: [{ permission: 'audit.read', workspace_scope: 'all' }] }, error: null })) }
describe('audit export download repository', () => {
  it('rechecks operator read scope and caps signed URL lifetime at 60 seconds', async () => {
    const sign = vi.fn(async () => 'https://signed.test')
    await expect(getAuditExportDownload(id, { operatorGateway, gateway: { rpc: vi.fn(async () => ({ data: { workspace_id: null, storage_path: `global/${id}/audit.csv`, expires_at: new Date(Date.now() + 120000).toISOString() }, error: null })) }, sign })).resolves.toEqual({ url: 'https://signed.test', error: null })
    expect(sign).toHaveBeenCalledWith(`global/${id}/audit.csv`, 60)
  })
})
