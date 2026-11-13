import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { resolveCanonicalCustomer } from './canonical-customer'

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

describe('resolveCanonicalCustomer', () => {
  const workspaceId = 'ws-test-123'
  const displayName = '홍길동'
  const phone010 = '010-1234-5678'
  const expectedE164 = '+821012345678'
  const expectedSha256 = sha256(expectedE164)

  it('normalizes 010 phone to E.164, computes sha256, calls upsert_customer_by_phone RPC and returns customerUuid', async () => {
    const mockRpc = vi.fn().mockResolvedValue({
      data: '00000000-0000-0000-0000-000000000001',
      error: null,
    })
    const admin = { rpc: mockRpc }

    const result = await resolveCanonicalCustomer({
      admin,
      workspaceId,
      displayName,
      phone010,
    })

    expect(result).toEqual({ customerUuid: '00000000-0000-0000-0000-000000000001' })
    expect(mockRpc).toHaveBeenCalledTimes(1)
    expect(mockRpc).toHaveBeenCalledWith('upsert_customer_by_phone', {
      p_workspace_id: workspaceId,
      p_display_name: displayName,
      p_phone_e164: expectedE164,
      p_phone_sha256: expectedSha256,
    })
  })

  it('handles unhyphenated 010 phone string correctly', async () => {
    const mockRpc = vi.fn().mockResolvedValue({
      data: '00000000-0000-0000-0000-000000000002',
      error: null,
    })
    const admin = { rpc: mockRpc }

    const result = await resolveCanonicalCustomer({
      admin,
      workspaceId,
      displayName: '이몽룡',
      phone010: '01098765432',
    })

    expect(result).toEqual({ customerUuid: '00000000-0000-0000-0000-000000000002' })
    expect(mockRpc).toHaveBeenCalledWith('upsert_customer_by_phone', {
      p_workspace_id: workspaceId,
      p_display_name: '이몽룡',
      p_phone_e164: '+821098765432',
      p_phone_sha256: sha256('+821098765432'),
    })
  })

  it('returns null customerUuid when phone010 is missing or empty', async () => {
    const mockRpc = vi.fn()
    const admin = { rpc: mockRpc }

    const res1 = await resolveCanonicalCustomer({
      admin,
      workspaceId,
      displayName,
      phone010: undefined,
    })
    expect(res1).toEqual({ customerUuid: null })

    const res2 = await resolveCanonicalCustomer({
      admin,
      workspaceId,
      displayName,
      phone010: null,
    })
    expect(res2).toEqual({ customerUuid: null })

    const res3 = await resolveCanonicalCustomer({
      admin,
      workspaceId,
      displayName,
      phone010: '   ',
    })
    expect(res3).toEqual({ customerUuid: null })

    expect(mockRpc).not.toHaveBeenCalled()
  })

  it('returns null customerUuid when phone is not a valid 010 format without throwing or logging PII', async () => {
    const mockRpc = vi.fn()
    const admin = { rpc: mockRpc }

    const res = await resolveCanonicalCustomer({
      admin,
      workspaceId,
      displayName,
      phone010: '02-123-4567',
    })

    expect(res).toEqual({ customerUuid: null })
    expect(mockRpc).not.toHaveBeenCalled()
  })

  it('returns null customerUuid when workspaceId is missing or empty', async () => {
    const mockRpc = vi.fn()
    const admin = { rpc: mockRpc }

    const res = await resolveCanonicalCustomer({
      admin,
      workspaceId: '',
      displayName,
      phone010,
    })

    expect(res).toEqual({ customerUuid: null })
    expect(mockRpc).not.toHaveBeenCalled()
  })

  it('returns null customerUuid when admin.rpc returns error without throwing', async () => {
    const mockRpc = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'function upsert_customer_by_phone does not exist' },
    })
    const admin = { rpc: mockRpc }

    const result = await resolveCanonicalCustomer({
      admin,
      workspaceId,
      displayName,
      phone010,
    })

    expect(result).toEqual({ customerUuid: null })
  })

  it('returns null customerUuid when admin.rpc throws exception (fail-open)', async () => {
    const mockRpc = vi.fn().mockRejectedValue(new Error('Connection failure'))
    const admin = { rpc: mockRpc }

    const result = await resolveCanonicalCustomer({
      admin,
      workspaceId,
      displayName,
      phone010,
    })

    expect(result).toEqual({ customerUuid: null })
  })

  it('returns null customerUuid when admin or admin.rpc is not a function', async () => {
    const res1 = await resolveCanonicalCustomer({
      admin: null,
      workspaceId,
      displayName,
      phone010,
    })
    expect(res1).toEqual({ customerUuid: null })

    const res2 = await resolveCanonicalCustomer({
      admin: {},
      workspaceId,
      displayName,
      phone010,
    })
    expect(res2).toEqual({ customerUuid: null })
  })
})
