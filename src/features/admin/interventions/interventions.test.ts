import { describe, expect, it, vi } from 'vitest'
import { interventionInput, previewIntervention, executeIntervention } from './service'

const ws = 'a1560001-1111-4111-8111-111111111111'
const actor = 'a1560002-1111-4111-8111-111111111111'
const key = 'ani-1560-test-key'

function db(options: { active?: boolean; fail?: boolean } = {}) {
  const rpc = vi.fn().mockResolvedValue({ data: { success: true, is_replay: false, active: true, balance: null }, error: options.fail ? { message: 'audit failed' } : null })
  const from = vi.fn((table: string) => ({
    select: () => table === 'kill_switches'
      ? { eq: () => Promise.resolve({ data: options.active ? [{ scope: 'WORKSPACE', target_id: ws, is_active: true }] : [], error: null }) }
      : { eq: () => ({ is: () => Promise.resolve({ count: 3, error: null }) }) },
  }))
  return { rpc, from }
}

describe('ANI-1560 safety intervention contract', () => {
  it('requires a reason, exact confirmed target, valid scope, and an idempotency key before mutation', async () => {
    expect(interventionInput.safeParse({ kind: 'WORKSPACE', workspaceId: ws, reason: ' ', confirmed: true, idempotencyKey: key }).success).toBe(false)
    expect(interventionInput.safeParse({ kind: 'PROVIDER', workspaceId: ws, reason: 'urgent', confirmed: true, idempotencyKey: key }).success).toBe(false)
    expect(interventionInput.safeParse({ kind: 'CREDIT', workspaceId: ws, amount: 20, reason: 'refund', confirmed: false, idempotencyKey: key }).success).toBe(false)
    expect(interventionInput.safeParse({ kind: 'CREDIT', workspaceId: ws, amount: -10, reason: 'refund', confirmed: true, idempotencyKey: key }).success).toBe(false)
  })
  it('reads a real preview and refuses database failures instead of describing zero impact', async () => {
    const client = db()
    await expect(previewIntervention(client as never, { kind: 'WORKSPACE', workspaceId: ws })).resolves.toMatchObject({ affectedCount: 3, stateLabel: '소희가 잠시 멈췄어요' })
    const broken = { from: () => ({ select: () => ({ eq: () => ({ is: () => Promise.resolve({ count: null, error: { message: 'offline' } }) }) }) }) }
    await expect(previewIntervention(broken as never, { kind: 'WORKSPACE', workspaceId: ws })).rejects.toThrow()
  })
  it('surfaces atomic RPC failures and never claims that an unaudited action succeeded', async () => {
    await expect(executeIntervention(db({ fail: true }) as never, actor, { kind: 'WORKSPACE', workspaceId: ws, active: true, reason: '긴급 안전 점검', confirmed: true, idempotencyKey: key })).rejects.toThrow()
  })
})
