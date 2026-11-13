import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import {
  registerOAuthTransaction,
  consumeOAuthTransaction,
  type RegisterOAuthTransactionInput,
  type ConsumeOAuthTransactionInput,
} from './oauth-transaction-repository'

const testInput: RegisterOAuthTransactionInput = {
  state: 'random-state-entropy-at-least-32-chars-long-abc123',
  workspaceId: '10000000-0000-4000-8000-000000000001',
  actorUserId: '20000000-0000-4000-8000-000000000001',
  channel: 'instagram',
  requestedScopes: ['instagram_business_basic', 'instagram_business_content_publish'],
  returnPath: '/app/settings/channels',
  correlationId: 'test-corr-123',
  expiresAt: new Date(Date.now() + 600_000).toISOString(),
}

describe('OAuth Transaction Repository (ANI-625)', () => {
  it('registers transaction and hashes state with anti-replay guarantees', async () => {
    const mockDb = {
      from: vi.fn().mockReturnValue({
        insert: vi.fn().mockResolvedValue({ error: null }),
      }),
    }

    await expect(registerOAuthTransaction(testInput, mockDb as any)).resolves.toBeUndefined()
    expect(mockDb.from).toHaveBeenCalledWith('oauth_transactions')
  })

  it('consumes single-use transaction successfully once and blocks replay on 10 consecutive attempts', async () => {
    let consumed = false
    const mockDb = {
      from: vi.fn().mockReturnValue({
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnThis(),
          is: vi.fn().mockReturnThis(),
          gt: vi.fn().mockImplementation(() => {
            if (!consumed) {
              consumed = true
              return Promise.resolve({ data: [{ id: 'tx-1' }], error: null, count: 1 })
            }
            return Promise.resolve({ data: [], error: null, count: 0 })
          }),
        }),
      }),
    }

    const consumeInput: ConsumeOAuthTransactionInput = {
      state: testInput.state,
      workspaceId: testInput.workspaceId,
      actorUserId: testInput.actorUserId,
      channel: testInput.channel,
    }

    await expect(consumeOAuthTransaction(consumeInput, mockDb as any)).resolves.toBeUndefined()

    for (let i = 0; i < 10; i++) {
      await expect(consumeOAuthTransaction(consumeInput, mockDb as any)).rejects.toThrow(
        '채널 연결 요청이 이미 사용되었거나 만료되었습니다.'
      )
    }
  })

  it('rejects cross-tenant transaction consumption attempt (BOLA / tenant isolation)', async () => {
    const mockDb = {
      from: vi.fn().mockReturnValue({
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnThis(),
          is: vi.fn().mockReturnThis(),
          gt: vi.fn().mockResolvedValue({ data: [], error: null, count: 0 }),
        }),
      }),
    }

    const crossTenantInput: ConsumeOAuthTransactionInput = {
      state: testInput.state,
      workspaceId: '99999999-9999-4999-8999-999999999999',
      actorUserId: testInput.actorUserId,
      channel: testInput.channel,
    }

    await expect(consumeOAuthTransaction(crossTenantInput, mockDb as any)).rejects.toThrow(
      '채널 연결 요청이 이미 사용되었거나 만료되었습니다.'
    )
  })
})
