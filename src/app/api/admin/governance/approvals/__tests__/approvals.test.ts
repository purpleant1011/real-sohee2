import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({ requireOperator: vi.fn(), requireOperatorAnyScope: vi.fn(), session: vi.fn(), admin: vi.fn() }))
vi.mock('@/features/operator-auth/require-operator', () => ({ requireOperator: mocks.requireOperator, requireOperatorAnyScope: mocks.requireOperatorAnyScope }))
vi.mock('@/lib/supabase/server', () => ({ createServerSupabaseClient: mocks.session }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminSupabaseClient: mocks.admin }))
import { GET, POST } from '../route'

const actor = 'e1559000-0000-4000-8000-000000000002'
const other = 'e1559000-0000-4000-8000-000000000003'
const workspace = 'e1559000-0000-4000-8000-000000000004'
const request = (body: object = {}) => new NextRequest('http://localhost/api/admin/governance/approvals', {
  method: 'POST', body: JSON.stringify({ requestId: 'session-1', action: 'APPROVE', stepUpToken: 'untrusted-string', ...body }),
})
const sessionRow = { session_id: 'session-1', operator_id: other, workspace_id: workspace, is_active: true, opened_at: '2026-09-05T01:00:00.000Z' }
const fetchSession = vi.fn().mockResolvedValue({ data: sessionRow, error: null })
const updateResult = vi.fn().mockResolvedValue({ data: [{ session_id: 'session-1' }], error: null })
const auditResult = vi.fn().mockResolvedValue({ error: null })
const updateChain = { eq: vi.fn().mockReturnThis(), select: updateResult }
const sessionTable = { select: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ maybeSingle: fetchSession }) }), update: vi.fn().mockReturnValue(updateChain) }
const auditTable = { insert: auditResult }
const from = vi.fn((table: string) => table === 'operator_audit_sessions' ? sessionTable : auditTable)

beforeEach(() => {
  vi.clearAllMocks()
  fetchSession.mockResolvedValue({ data: sessionRow, error: null })
  updateResult.mockResolvedValue({ data: [{ session_id: 'session-1' }], error: null })
  auditResult.mockResolvedValue({ error: null })
  mocks.requireOperator.mockResolvedValue({ userId: actor })
  mocks.requireOperatorAnyScope.mockResolvedValue({ userId: actor })
  mocks.session.mockResolvedValue({ auth: {
    getClaims: vi.fn().mockResolvedValue({ data: { claims: { sub: actor } }, error: null }),
    mfa: { getAuthenticatorAssuranceLevel: vi.fn().mockResolvedValue({ data: { currentLevel: 'aal2' }, error: null }) },
  }, from })
  mocks.admin.mockReturnValue({ from })
})

describe('Admin governance approvals', () => {
  it('GET reports the actual current time, not a fixed timestamp', async () => {
    sessionTable.select.mockReturnValueOnce({ eq: vi.fn().mockReturnValue({ order: vi.fn().mockResolvedValue({ data: [sessionRow], error: null }) }) })
    const response = await GET()
    expect(response.status).toBe(200)
    expect(Date.now() - Date.parse((await response.json()).asOf)).toBeLessThan(5000)
  })

  it('refuses a read-only operator without writing', async () => {
    mocks.requireOperator.mockRejectedValueOnce(new Error('PERMISSION_DENIED'))
    const response = await POST(request())
    expect(response.status).toBeGreaterThanOrEqual(400)
    expect(mocks.requireOperator).toHaveBeenCalledWith('runtime_control.change.request')
    expect(mocks.admin).not.toHaveBeenCalled()
  })

  it('rejects forged stepUpToken if session assurance is not AAL2', async () => {
    mocks.session.mockResolvedValueOnce({ auth: {
      getClaims: vi.fn().mockResolvedValue({ data: { claims: { sub: actor } }, error: null }),
      mfa: { getAuthenticatorAssuranceLevel: vi.fn().mockResolvedValue({ data: { currentLevel: 'aal1' }, error: null }) },
    } })
    const response = await POST(request())
    expect(response.status).toBe(401)
    expect((await response.json()).code).toBe('STEP_UP_REQUIRED')
    expect(updateResult).not.toHaveBeenCalled()
  })

  it('rejects AAL2 of a session belonging to another account', async () => {
    mocks.session.mockResolvedValueOnce({ auth: {
      getClaims: vi.fn().mockResolvedValue({ data: { claims: { sub: other } }, error: null }),
      mfa: { getAuthenticatorAssuranceLevel: vi.fn().mockResolvedValue({ data: { currentLevel: 'aal2' }, error: null }) },
    } })
    const response = await POST(request())
    expect(response.status).toBe(401)
    expect(updateResult).not.toHaveBeenCalled()
  })

  it('rejects unknown action, never interpreting it as REJECT', async () => {
    const response = await POST(request({ action: 'DELETE' }))
    expect(response.status).toBe(400)
    expect(updateResult).not.toHaveBeenCalled()
  })

  it('blocks fixture requests and self approval', async () => {
    expect((await POST(request({ requestId: 'req-401' }))).status).toBe(422)
    fetchSession.mockResolvedValueOnce({ data: { ...sessionRow, operator_id: actor }, error: null })
    expect((await POST(request())).status).toBe(403)
    expect(updateResult).not.toHaveBeenCalled()
  })

  it('returns a failure when the conditional update changes zero rows', async () => {
    updateResult.mockResolvedValueOnce({ data: [], error: null })
    const response = await POST(request())
    expect(response.status).not.toBe(200)
    expect(auditResult).not.toHaveBeenCalled()
    expect(updateChain.eq).toHaveBeenCalledWith('is_active', true)
  })

  it('returns a failure when the database update errors', async () => {
    updateResult.mockResolvedValueOnce({ data: null, error: { message: 'update rejected' } })
    expect((await POST(request())).status).not.toBe(200)
    expect(auditResult).not.toHaveBeenCalled()
  })

  it('writes the audit only after one row was closed successfully', async () => {
    const response = await POST(request({ stepUpToken: undefined }))
    expect(response.status).toBe(200)
    expect(mocks.requireOperator).toHaveBeenCalledWith('runtime_control.change.request')
    expect(updateChain.select).toHaveBeenCalledWith('session_id')
    expect(auditResult).toHaveBeenCalledOnce()
    expect((await response.json()).status).toBe('APPROVED')
  })
})
