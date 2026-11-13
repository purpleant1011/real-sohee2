import { describe, it, expect, vi } from 'vitest'
import {
  getPersistedChannelVerification,
  verifyInstagramEvidence,
  verifyThreadsEvidence,
} from '../dual-channel-verification'

const WORKSPACE_ID = '10000000-0000-4000-8000-000000000001'

/** 테이블별 응답을 돌려주는 최소 admin 클라이언트. */
function fakeAdmin(byTable: Record<string, { data: unknown; error: unknown }>) {
  return {
    from(table: string) {
      const result = byTable[table] ?? { data: null, error: null }
      const builder: any = {}
      for (const method of ['select', 'eq', 'in', 'order', 'limit']) {
        builder[method] = vi.fn(() => builder)
      }
      builder.maybeSingle = vi.fn(async () => result)
      return builder
    },
  } as any
}

const freshCredential = {
  id: 'cred-1',
  provider: 'instagram',
  granted_scopes: ['instagram_business_basic', 'instagram_business_content_publish'],
  token_expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
  status: 'active',
  channel_connections: { external_account_id: 'ig-1', account_label: '@byreum' },
}

describe('[ANI-1776] 마지막 점검 시각은 서버 근거에서만 나온다', () => {
  it('실측 검증 영수증이 있으면 그 시각을 쓴다', () => {
    const probedAt = '2026-10-21T03:04:05.000Z'
    const result = verifyInstagramEvidence({
      accountId: 'ig-1',
      username: '@byreum',
      tokenExpiresAt: new Date(Date.now() + 86400000 * 10).toISOString(),
      scopes: ['instagram_business_basic', 'instagram_business_content_publish'],
      capabilityReceipt: { profileReadSuccess: true, publishQuotaVerified: true, probedAt },
    })
    expect(result.status).toBe('VERIFIED')
    expect(result.lastCheckedAt).toBe(probedAt)

    const threads = verifyThreadsEvidence({
      threadsUserId: 'th-1',
      threadsUsername: '@byreum',
      tokenExpiresAt: new Date(Date.now() + 86400000 * 10).toISOString(),
      scopes: ['threads_basic', 'threads_content_publish'],
      capabilityReceipt: { profileReadSuccess: true, publishQuotaVerified: true, probedAt },
    })
    expect(threads.lastCheckedAt).toBe(probedAt)
  })

  it('검증 전 상태에는 점검 시각을 만들지 않는다', () => {
    expect(verifyInstagramEvidence(null).lastCheckedAt).toBeUndefined()
    expect(verifyThreadsEvidence({
      threadsUserId: 'th-1',
      threadsUsername: '@byreum',
      tokenExpiresAt: new Date(Date.now() + 86400000 * 10).toISOString(),
      scopes: ['threads_basic', 'threads_content_publish'],
      capabilityReceipt: null,
    }).lastCheckedAt).toBeUndefined()
  })

  it('영속 검증 런의 read_after_write_at 을 점검 시각으로 돌려준다', async () => {
    const readAfterWriteAt = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    const client = fakeAdmin({
      meta_channel_credentials: { data: freshCredential, error: null },
      channel_verification_runs: { data: { id: 'run-1', status: 'VERIFIED', read_after_write_at: readAfterWriteAt, created_at: readAfterWriteAt }, error: null },
    })

    const result = await getPersistedChannelVerification(WORKSPACE_ID, 'instagram', { adminClient: client })

    expect(result.status).toBe('VERIFIED')
    expect(result.lastCheckedAt).toBe(readAfterWriteAt)
  })

  it('검증 런이 만료되면 마지막 점검 시각은 그 런의 시각이다', async () => {
    const staleAt = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString()
    const client = fakeAdmin({
      meta_channel_credentials: { data: freshCredential, error: null },
      channel_verification_runs: { data: { id: 'run-1', status: 'VERIFIED', read_after_write_at: staleAt, created_at: staleAt }, error: null },
    })

    const result = await getPersistedChannelVerification(WORKSPACE_ID, 'instagram', { adminClient: client })

    expect(result.status).toBe('READY_DEGRADED')
    expect(result.lastCheckedAt).toBe(staleAt)
  })

  it('연결 근거가 없으면 점검 시각도 없다', async () => {
    const client = fakeAdmin({})
    const result = await getPersistedChannelVerification(WORKSPACE_ID, 'threads', { adminClient: client })

    expect(result.status).toBe('NOT_CONNECTED')
    expect(result.lastCheckedAt).toBeUndefined()
  })

  // [ANI-1776] 자격증명이 나빠져도 "점검 기록 없음"으로 보이면 안 된다.
  describe('준비도 저하 상태에서도 실측 영수증 시각을 유지한다', () => {
    const receiptAt = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
    const receipt = { data: { id: 'run-1', status: 'VERIFIED', read_after_write_at: receiptAt, created_at: receiptAt }, error: null }

    it('비활성 자격증명이어도 마지막 점검 시각을 돌려준다', async () => {
      const client = fakeAdmin({
        meta_channel_credentials: { data: { ...freshCredential, status: 'revoked' }, error: null },
        channel_verification_runs: receipt,
      })

      const result = await getPersistedChannelVerification(WORKSPACE_ID, 'instagram', { adminClient: client })

      expect(result.status).toBe('READY_DEGRADED')
      expect(result.lastCheckedAt).toBe(receiptAt)
    })

    it('토큰 잔여 24시간 미만이어도 마지막 점검 시각을 돌려준다', async () => {
      const client = fakeAdmin({
        meta_channel_credentials: {
          data: { ...freshCredential, token_expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString() },
          error: null,
        },
        channel_verification_runs: receipt,
      })

      const result = await getPersistedChannelVerification(WORKSPACE_ID, 'instagram', { adminClient: client })

      expect(result.status).toBe('READY_DEGRADED')
      expect(result.lastCheckedAt).toBe(receiptAt)
    })

    it('권한이 부족해도 마지막 점검 시각을 돌려준다', async () => {
      const client = fakeAdmin({
        meta_channel_credentials: {
          data: { ...freshCredential, granted_scopes: ['instagram_business_basic'] },
          error: null,
        },
        channel_verification_runs: receipt,
      })

      const result = await getPersistedChannelVerification(WORKSPACE_ID, 'instagram', { adminClient: client })

      expect(result.status).toBe('SCOPE_INSUFFICIENT')
      expect(result.lastCheckedAt).toBe(receiptAt)
    })

    it('영수증이 없으면 저하 상태에서도 시각을 만들지 않는다', async () => {
      const client = fakeAdmin({
        meta_channel_credentials: { data: { ...freshCredential, status: 'revoked' }, error: null },
      })

      const result = await getPersistedChannelVerification(WORKSPACE_ID, 'instagram', { adminClient: client })

      expect(result.status).toBe('READY_DEGRADED')
      expect(result.lastCheckedAt).toBeNull()
    })
  })
})
