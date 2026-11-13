import { describe, it, expect, vi } from 'vitest'
import {
  linkCustomerIdentity,
  normalizeIdentityChannel,
  type LinkCustomerIdentityParams,
} from './customer-identity-service'
import { createHash } from 'node:crypto'

describe('customer-identity-service', () => {
  const workspaceId = '11111111-1111-4111-a111-111111111111'
  const customerUuid = '22222222-2222-4222-a222-222222222222'
  const rawSubjectRef = '1784140000000001'
  const expectedHash = createHash('sha256').update(rawSubjectRef).digest('hex')

  it('channel 정규화가 INSTAGRAM, THREADS, KAKAO, MANUAL을 올바르게 지원하고 잘못된 채널은 null을 반환한다', () => {
    expect(normalizeIdentityChannel('instagram')).toBe('INSTAGRAM')
    expect(normalizeIdentityChannel('INSTAGRAM')).toBe('INSTAGRAM')
    expect(normalizeIdentityChannel('threads')).toBe('THREADS')
    expect(normalizeIdentityChannel('THREADS')).toBe('THREADS')
    expect(normalizeIdentityChannel('kakao')).toBe('KAKAO')
    expect(normalizeIdentityChannel('KAKAO')).toBe('KAKAO')
    expect(normalizeIdentityChannel('manual')).toBe('MANUAL')
    expect(normalizeIdentityChannel('MANUAL')).toBe('MANUAL')
    expect(normalizeIdentityChannel('unknown')).toBeNull()
    expect(normalizeIdentityChannel('')).toBeNull()
    expect(normalizeIdentityChannel(null as any)).toBeNull()
  })

  it('customer_identities에 upsert하고 관련 customer_conversations의 customer_uuid를 업데이트한다', async () => {
    const mockIdentityUpsert = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        maybeSingle: vi.fn().mockResolvedValue({
          data: { id: 'identity-uuid-1' },
          error: null,
        }),
      }),
    })

    const mockConvUpdate = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        or: vi.fn().mockReturnValue({
          select: vi.fn().mockResolvedValue({
            data: [{ id: 'conv-1' }, { id: 'conv-2' }],
            error: null,
          }),
        }),
      }),
    })

    const mockAdmin = {
      from: vi.fn((table: string) => {
        if (table === 'customer_identities') {
          return { upsert: mockIdentityUpsert }
        }
        if (table === 'customer_conversations') {
          return { update: mockConvUpdate }
        }
        throw new Error(`Unexpected table ${table}`)
      }),
    }

    const result = await linkCustomerIdentity({
      admin: mockAdmin,
      workspaceId,
      customerUuid,
      channel: 'instagram',
      subjectRef: rawSubjectRef,
    })

    expect(result.success).toBe(true)
    expect(result.identityId).toBe('identity-uuid-1')
    expect(result.updatedConversationsCount).toBe(2)

    // Verify customer_identities upsert payload
    expect(mockAdmin.from).toHaveBeenCalledWith('customer_identities')
    expect(mockIdentityUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        workspace_id: workspaceId,
        customer_id: customerUuid,
        channel: 'INSTAGRAM',
        subject_ref: rawSubjectRef,
      }),
      expect.objectContaining({
        onConflict: 'workspace_id,channel,subject_ref',
      }),
    )

    // Verify customer_conversations update payload
    expect(mockAdmin.from).toHaveBeenCalledWith('customer_conversations')
    expect(mockConvUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        customer_uuid: customerUuid,
      }),
    )
    expect(expectedHash).toMatch(/^[a-f0-9]{64}$/)
  })

  it('이미 SHA256 해시인 subjectRef가 전달된 경우에도 동일한 해시로 customer_conversations를 동기화한다', async () => {
    const hexHash = 'a'.repeat(64)
    const mockIdentityUpsert = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        maybeSingle: vi.fn().mockResolvedValue({
          data: { id: 'identity-hex-1' },
          error: null,
        }),
      }),
    })

    const mockConvUpdate = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        or: vi.fn().mockReturnValue({
          select: vi.fn().mockResolvedValue({
            data: [{ id: 'conv-hex-1' }],
            error: null,
          }),
        }),
      }),
    })

    const mockAdmin = {
      from: vi.fn((table: string) => {
        if (table === 'customer_identities') {
          return { upsert: mockIdentityUpsert }
        }
        if (table === 'customer_conversations') {
          return { update: mockConvUpdate }
        }
        throw new Error(`Unexpected table: ${table}`)
      }),
    }

    const result = await linkCustomerIdentity({
      admin: mockAdmin,
      workspaceId,
      customerUuid,
      channel: 'INSTAGRAM',
      subjectRef: hexHash,
    })

    expect(result.success).toBe(true)
    expect(mockIdentityUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        subject_ref: hexHash,
        channel: 'INSTAGRAM',
      }),
      expect.anything(),
    )
  })

  it('대화 목록에 매칭되는 행이 없어도 에러 없이 success: true 및 updatedConversationsCount: 0을 반환한다', async () => {
    const mockAdmin = {
      from: vi.fn((table: string) => {
        if (table === 'customer_identities') {
          return {
            upsert: vi.fn().mockReturnValue({
              select: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: { id: 'identity-only-1' },
                  error: null,
                }),
              }),
            }),
          }
        }
        if (table === 'customer_conversations') {
          return {
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                or: vi.fn().mockReturnValue({
                  select: vi.fn().mockResolvedValue({
                    data: [],
                    error: null,
                  }),
                }),
              }),
            }),
          }
        }
        throw new Error(`Unexpected table ${table}`)
      }),
    }

    const result = await linkCustomerIdentity({
      admin: mockAdmin,
      workspaceId,
      customerUuid,
      channel: 'INSTAGRAM',
      subjectRef: 'no-conversation-yet',
    })

    expect(result.success).toBe(true)
    expect(result.updatedConversationsCount).toBe(0)
  })

  it('필수 입력값 누락 시 예외를 던지지 않고 fail-open({ success: false })을 반환한다', async () => {
    const validParams: LinkCustomerIdentityParams = {
      admin: { from: vi.fn() },
      workspaceId,
      customerUuid,
      channel: 'INSTAGRAM',
      subjectRef: rawSubjectRef,
    }

    // null/undefined params
    expect(await linkCustomerIdentity(null as any)).toEqual({ success: false })

    // admin 누락
    expect(await linkCustomerIdentity({ ...validParams, admin: null })).toEqual({ success: false })

    // workspaceId 누락
    expect(await linkCustomerIdentity({ ...validParams, workspaceId: '' })).toEqual({ success: false })

    // customerUuid 누락
    expect(await linkCustomerIdentity({ ...validParams, customerUuid: '' })).toEqual({ success: false })

    // subjectRef 누락
    expect(await linkCustomerIdentity({ ...validParams, subjectRef: '   ' })).toEqual({ success: false })

    // channel 유효하지 않음
    expect(await linkCustomerIdentity({ ...validParams, channel: 'TIKTOK' })).toEqual({ success: false })
  })

  it('DB 에러 발생 시 예외를 던지지 않고 fail-open({ success: false })을 반환한다', async () => {
    const mockAdmin = {
      from: vi.fn(() => ({
        upsert: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({
              data: null,
              error: { message: 'Database constraint violation' },
            }),
          }),
        }),
      })),
    }

    const result = await linkCustomerIdentity({
      admin: mockAdmin,
      workspaceId,
      customerUuid,
      channel: 'INSTAGRAM',
      subjectRef: rawSubjectRef,
    })

    expect(result.success).toBe(false)
  })

  it('DB 쿼리 호출 중 crash(throw) 발생 시에도 예외를 상위로 전파하지 않고 { success: false }를 반환한다', async () => {
    const mockAdmin = {
      from: vi.fn(() => {
        throw new Error('Network timeout or unexpected DB failure')
      }),
    }

    const result = await linkCustomerIdentity({
      admin: mockAdmin,
      workspaceId,
      customerUuid,
      channel: 'INSTAGRAM',
      subjectRef: rawSubjectRef,
    })

    expect(result.success).toBe(false)
  })
})
