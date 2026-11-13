import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
import * as repository from './repository'

describe('operator audit write boundary', () => {
  it('exports only read operations and has no generic writer module', () => {
    expect(Object.keys(repository).sort()).toEqual([
      'readOperatorApprovalRequests',
      'readOperatorAuditEvents',
    ])

    const directory = dirname(fileURLToPath(import.meta.url))
    expect(existsSync(join(directory, 'write-audit-event.ts'))).toBe(false)
    expect(readdirSync(directory).filter((name) => /writer|service-role|admin-client/u.test(name))).toEqual([])

    const productionSources = readdirSync(directory)
      .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts') && !name.startsWith('audit-export-'))
      .map((name) => readFileSync(join(directory, name), 'utf8'))
      .join('\n')
    expect(productionSources).not.toMatch(/createAdminSupabaseClient|SUPABASE_SERVICE_ROLE_KEY|service_role/u)
    expect(productionSources).not.toMatch(/writeAudit|appendAudit|markAdminApprovalApplied|applyAdminApproval/u)
    expect(productionSources).not.toMatch(/(?:gateway|client|supabase)\.(?:insert|update|delete|rpc)\s*\(/u)
  })

  it('can complete reads through a gateway that has no write capability', async () => {
    const listAuditEvents = vi.fn(async () => ({ data: [], error: null }))
    const listApprovalRequests = vi.fn(async () => ({ data: [], error: null }))
    const operatorGateway = {
      getClaims: vi.fn(async () => ({ data: { claims: { sub: '93000000-0000-4000-8000-000000000001' } }, error: null })),
      getAal: vi.fn(async () => ({ data: { currentLevel: 'aal2' }, error: null })),
      getOperatorContext: vi.fn(async () => ({
        data: {
          user_id: '93000000-0000-4000-8000-000000000001',
          status: 'active',
          permissions: ['audit.read'],
          workspace_scope: 'all',
          mfa_required: true,
          permission_scopes: [{ permission: 'audit.read', workspace_scope: 'all' }],
        },
        error: null,
      })),
    }

    await expect(repository.readOperatorAuditEvents(
      { limit: 1 },
      { gateway: { listAuditEvents, listApprovalRequests }, operatorGateway },
    )).resolves.toEqual({ data: [], error: null })
  })
})
