import { describe, expect, it, vi } from 'vitest'
import { GET, POST } from '@/app/api/workspaces/[workspaceId]/agent/control/route'
import { NextRequest } from 'next/server'
const mocks = vi.hoisted(() => ({ state: {} as Record<string, unknown>, ledger: {} as Record<string, unknown> | null, ledgerError: false, writes: 0, server: vi.fn(), setMode: vi.fn() }))
vi.mock('@/lib/auth/workspace-guard', () => ({ requireWorkspaceMembership: async () => ({ ok: true, role: 'owner', userId: 'local-actor' }) }))
vi.mock('@/lib/supabase/server', () => ({ createServerSupabaseClient: mocks.server }))
vi.mock('../agent-control-state', () => ({ AgentControlPlaneService: { getControlState: async () => mocks.state, setDesiredMode: mocks.setMode } }))
const context = () => ({ params: Promise.resolve({ workspaceId: 'A' }) })
function setup(overrides: Record<string, unknown> = {}) {
  mocks.state = { workspace_id: 'A', workspaceId: 'A', desired_mode: 'RUNNING', actual_mode: 'RUNNING', desiredMode: 'RUNNING', actualMode: 'RUNNING', version: 2, active_action_run_count: 0, kill_switch_active: false, updated_at: '2026-10-25T10:00:00Z', ...overrides }
  mocks.ledger = { workspace_id: 'A', remaining_available_energy: 10 }; mocks.ledgerError = false; mocks.writes = 0
  mocks.setMode.mockImplementation(async () => ({ ...mocks.state, actualMode: 'RUNNING' }))
  mocks.server.mockResolvedValue({ from(table: string) {
    const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: table === 'agent_energy_ledgers' ? mocks.ledger : mocks.state, error: mocks.ledgerError && table === 'agent_energy_ledgers' ? { message: 'private' } : null }), then: (resolve: (v: unknown) => unknown) => Promise.resolve(resolve({ data: [], error: null })), upsert: () => { mocks.writes++; return query } }; return query
  } })
}
describe('ANI-1791 control GET/POST durable readback', () => {
  it.each([null, {}, { workspace_id: 'A', remaining_available_energy: null }, { workspace_id: 'A', remaining_available_energy: 'bad' }])('에너지 근거 %j는 RUNNING 200으로 숨기지 않는다', async ledger => {
    setup(); mocks.ledger = ledger
    const response = await GET(new NextRequest('http://localhost/api/control'), context())
    expect(response.status).toBe(503)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(JSON.stringify(await response.json())).not.toContain('RUNNING')
  })
  it('에너지 조회 실패는 무시하지 않고 unavailable로 닫는다', async () => {
    setup(); mocks.ledgerError = true
    expect((await GET(new NextRequest('http://localhost/api/control'), context())).status).toBe(503)
  })
  it('DB PAUSED는 희망 RUNNING보다 우선하며 GET은 상태를 만들지 않는다', async () => {
    setup({ actual_mode: 'PAUSED', actualMode: 'PAUSED' })
    const response = await GET(new NextRequest('http://localhost/api/control'), context())
    expect(await response.json()).toMatchObject({ actualMode: 'PAUSED', workspaceId: 'A', checkedAt: '2026-10-25T10:00:00Z' })
    expect(mocks.writes).toBe(0)
  })
  it('POST accepted 본문 대신 durable GET readback을 반환한다', async () => {
    setup({ actual_mode: 'PAUSED', actualMode: 'PAUSED' })
    const response = await POST(new NextRequest('http://localhost/api/control', { method: 'POST', body: JSON.stringify({ action: 'set_mode', desiredMode: 'RUNNING', expectedVersion: 2 }) }), context())
    expect(await response.json()).toMatchObject({ actualMode: 'PAUSED' })
  })
})
