import { describe, expect, it, vi } from 'vitest'
import { emailHash, executeApprovedAdminInvite, type ProviderGateway } from './admin-invite-executor'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/admin', () => ({ createAdminSupabaseClient: vi.fn() }))

const id = '00000000-0000-4000-8000-000000000001'
const gateway = (overrides: Partial<ProviderGateway> = {}): ProviderGateway => ({
  getIntent: vi.fn(async () => ({ emailHash: emailHash('operator@example.com'), status: 'provider_pending' })),
  invite: vi.fn(async () => ({ ok: true })),
  record: vi.fn(async () => undefined),
  ...overrides,
})

describe('executeApprovedAdminInvite', () => {
  it('does not send when the supplied email does not match the approved hash', async () => {
    const provider = gateway()
    await expect(executeApprovedAdminInvite(id, 'other@example.com', provider)).resolves.toEqual({ state: 'provider_failed', safeCode: 'EMAIL_HASH_MISMATCH' })
    expect(provider.invite).not.toHaveBeenCalled()
    expect(provider.record).not.toHaveBeenCalled()
  })

  it('records only a safe success code after the provider accepts the mocked send', async () => {
    const provider = gateway()
    await expect(executeApprovedAdminInvite(id, 'operator@example.com', provider)).resolves.toEqual({ state: 'provider_succeeded', safeCode: 'PROVIDER_ACCEPTED' })
    expect(provider.invite).toHaveBeenCalledWith('operator@example.com')
    expect(provider.record).toHaveBeenCalledWith(id, 'provider_succeeded')
  })
})
