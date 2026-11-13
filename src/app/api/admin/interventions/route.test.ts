import { describe, expect, it, vi } from 'vitest'
vi.mock('@/features/operator-auth/require-operator', () => ({ requireOperator: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminSupabaseClient: vi.fn(() => ({})) }))
vi.mock('@/features/admin/interventions/service', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/features/admin/interventions/service')>()
  return { ...original, previewIntervention: vi.fn(), executeIntervention: vi.fn() }
})
import { requireOperator } from '@/features/operator-auth/require-operator'
import { executeIntervention, previewIntervention } from '@/features/admin/interventions/service'
import { OperatorAccessError } from '@/features/operator-auth/current-operator'
import { POST, PUT } from './route'
const ws = 'a1560001-1111-4111-8111-111111111111'
const req = (input: unknown) => new Request('http://localhost/api/admin/interventions', { method: 'POST', body: JSON.stringify(input) })
describe('admin intervention boundary', () => {
  it('refuses read-only operators before any write', async () => {
    vi.mocked(requireOperator).mockRejectedValueOnce(new OperatorAccessError('PERMISSION_DENIED'))
    const response = await POST(req({ kind: 'WORKSPACE', workspaceId: ws, active: true, reason: '긴급 점검', confirmed: true, idempotencyKey: 'once' }))
    expect(response.status).toBe(403)
    expect(vi.mocked(executeIntervention).mock.calls).toHaveLength(0)
  })
  it('accepts preview permission without execute permission and returns actual impact', async () => {
    vi.mocked(requireOperator).mockResolvedValueOnce({ userId: ws } as never)
    vi.mocked(previewIntervention).mockResolvedValueOnce({ affectedCount: 4, active: false, stateLabel: '소희가 잠시 멈췄어요', detail: '보관 글 4건은 그대로 남아요' })
    const response = await PUT(req({ kind: 'WORKSPACE', workspaceId: ws }))
    expect(response.status).toBe(200)
    expect((await response.json()).data.affectedCount).toBe(4)
  })
  it('requires explicit confirmation and a trimmed reason', async () => {
    const response = await POST(req({ kind: 'CREDIT', workspaceId: ws, amount: 10, confirmed: false, reason: '  ', idempotencyKey: 'once' }))
    expect(response.status).toBe(400)
  })
})
