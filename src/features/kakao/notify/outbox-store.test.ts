import { describe, expect, it, vi } from 'vitest'
import {
  SupabaseNotificationOutboxStore,
  OutboxStoreError,
  type OutboxSupabaseRpcClient,
} from './outbox-store'
import type { OutboxState } from './outbox-processor'

describe('SupabaseNotificationOutboxStore', () => {
  const dummyJobId = 'job-uuid-1111'
  const fixedToken = 'fixed-lease-token-2222'

  function createMockRpcClient(
    rpcResult: { data: unknown; error: { message: string } | null } = {
      data: true,
      error: null,
    },
  ): {
    client: OutboxSupabaseRpcClient
    rpcMock: ReturnType<typeof vi.fn>
  } {
    const rpcMock = vi.fn().mockResolvedValue(rpcResult)
    const client: OutboxSupabaseRpcClient = {
      rpc: rpcMock,
    }
    return { client, rpcMock }
  }

  describe('constructor & tokenFactory', () => {
    it('tokenFactory를 주입받지 않으면 crypto.randomUUID 기본 생성자를 사용한다', async () => {
      const { client, rpcMock } = createMockRpcClient({ data: true, error: null })
      const store = new SupabaseNotificationOutboxStore(client)

      const token = await store.claim(dummyJobId)
      expect(typeof token).toBe('string')
      expect(token).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
      expect(rpcMock).toHaveBeenCalledWith('claim_kakao_notification_job', {
        p_job_id: dummyJobId,
        p_lease_token: token,
      })
    })

    it('주입된 custom tokenFactory를 사용하여 토큰을 생성한다', async () => {
      const { client, rpcMock } = createMockRpcClient({ data: true, error: null })
      const customFactory = vi.fn().mockReturnValue(fixedToken)
      const store = new SupabaseNotificationOutboxStore(client, customFactory)

      const token = await store.claim(dummyJobId)
      expect(customFactory).toHaveBeenCalledTimes(1)
      expect(token).toBe(fixedToken)
      expect(rpcMock).toHaveBeenCalledWith('claim_kakao_notification_job', {
        p_job_id: dummyJobId,
        p_lease_token: fixedToken,
      })
    })

    it('tokenFactory가 빈 토큰이나 공백을 반환하면 RPC 호출 없이 정적 generic error를 throw한다', async () => {
      for (const blankToken of ['', '   ']) {
        const { client, rpcMock } = createMockRpcClient()
        const store = new SupabaseNotificationOutboxStore(client, () => blankToken)

        await expect(store.claim(dummyJobId)).rejects.toThrow(OutboxStoreError)
        await expect(store.claim(dummyJobId)).rejects.toThrow('Notification outbox store operation failed')
        expect(rpcMock).not.toHaveBeenCalled()
      }
    })

    it('tokenFactory 실행 도중 예외가 발생해도 예외 원문이 유출되지 않고 고정 generic error를 throw한다', async () => {
      const { client, rpcMock } = createMockRpcClient()
      const sensitiveCanaryFactory = () => {
        throw new Error('entropy leak: canary-phone-010-1234-5678')
      }
      const store = new SupabaseNotificationOutboxStore(client, sensitiveCanaryFactory)

      await expect(store.claim(dummyJobId)).rejects.toThrow(OutboxStoreError)
      await expect(store.claim(dummyJobId)).rejects.toThrow('Notification outbox store operation failed')
      await expect(store.claim(dummyJobId)).rejects.not.toThrow(/canary-phone|010-1234-5678/)
      expect(rpcMock).not.toHaveBeenCalled()
    })
  })

  describe('claim', () => {
    it('RPC 성공 및 data === true인 경우 생성된 leaseToken을 반환한다', async () => {
      const { client, rpcMock } = createMockRpcClient({ data: true, error: null })
      const store = new SupabaseNotificationOutboxStore(client, () => fixedToken)

      const result = await store.claim(dummyJobId)
      expect(result).toBe(fixedToken)
      expect(rpcMock).toHaveBeenCalledTimes(1)
      expect(rpcMock).toHaveBeenCalledWith('claim_kakao_notification_job', {
        p_job_id: dummyJobId,
        p_lease_token: fixedToken,
      })
    })

    it('RPC 성공하였으나 data === false인 경우 null을 반환한다', async () => {
      const { client, rpcMock } = createMockRpcClient({ data: false, error: null })
      const store = new SupabaseNotificationOutboxStore(client, () => fixedToken)

      const result = await store.claim(dummyJobId)
      expect(result).toBeNull()
      expect(rpcMock).toHaveBeenCalledTimes(1)
    })

    it('boolean strict: data가 true가 아닌 truthy/falsy 값(1, "true", null)일 때 null을 반환한다', async () => {
      for (const notStrictTrue of [1, 'true', null, undefined, {}, []]) {
        const { client } = createMockRpcClient({ data: notStrictTrue, error: null })
        const store = new SupabaseNotificationOutboxStore(client, () => fixedToken)

        const result = await store.claim(dummyJobId)
        expect(result).toBeNull()
      }
    })

    it('RPC 에러 발생 시 provider 필드를 포함하지 않는 정적 generic error를 throw한다', async () => {
      const { client } = createMockRpcClient({
        data: null,
        error: { message: 'relation kakao_notification_outbox does not exist or permission denied' },
      })
      const store = new SupabaseNotificationOutboxStore(client, () => fixedToken)

      await expect(store.claim(dummyJobId)).rejects.toThrow(OutboxStoreError)
      await expect(store.claim(dummyJobId)).rejects.toThrow('Notification outbox store operation failed')
      await expect(store.claim(dummyJobId)).rejects.not.toThrow(/relation|kakao_notification_outbox|permission/)
    })

    it('RPC 호출 자체가 reject될 때도 provider 세부정보 없는 generic error를 throw한다', async () => {
      const client: OutboxSupabaseRpcClient = {
        rpc: vi.fn().mockRejectedValue(new Error('PostgREST fatal network error 502')),
      }
      const store = new SupabaseNotificationOutboxStore(client, () => fixedToken)

      await expect(store.claim(dummyJobId)).rejects.toThrow(OutboxStoreError)
      await expect(store.claim(dummyJobId)).rejects.toThrow('Notification outbox store operation failed')
      await expect(store.claim(dummyJobId)).rejects.not.toThrow(/PostgREST|502/)
    })

    it('injected client가 민감정보 canary 메시지를 담은 OutboxStoreError를 던져도 고정 메시지로 치환된다', async () => {
      const canaryError = new OutboxStoreError('canary-leak-phone-010-1111-2222')
      const client: OutboxSupabaseRpcClient = {
        rpc: vi.fn().mockRejectedValue(canaryError),
      }
      const store = new SupabaseNotificationOutboxStore(client, () => fixedToken)

      await expect(store.claim(dummyJobId)).rejects.toThrow(OutboxStoreError)
      await expect(store.claim(dummyJobId)).rejects.toThrow('Notification outbox store operation failed')
      await expect(store.claim(dummyJobId)).rejects.not.toThrow(/canary-leak-phone|010-1111-2222/)
    })

    it('jobId가 유효하지 않으면 RPC 호출 없이 generic error를 throw한다', async () => {
      const { client, rpcMock } = createMockRpcClient()
      const store = new SupabaseNotificationOutboxStore(client, () => fixedToken)

      await expect(store.claim('')).rejects.toThrow(OutboxStoreError)
      await expect(store.claim('   ')).rejects.toThrow(OutboxStoreError)
      expect(rpcMock).not.toHaveBeenCalled()
    })

    it('claim 실패 시 자체 자동 재시도를 하지 않고 단 1회만 호출한다', async () => {
      const { client, rpcMock } = createMockRpcClient({ data: false, error: null })
      const store = new SupabaseNotificationOutboxStore(client, () => fixedToken)

      const result = await store.claim(dummyJobId)
      expect(result).toBeNull()
      expect(rpcMock).toHaveBeenCalledTimes(1)
    })
  })

  describe('markSending', () => {
    it('RPC 성공 및 data === true인 경우 true를 반환하며 파라미터를 정확히 전달한다', async () => {
      const { client, rpcMock } = createMockRpcClient({ data: true, error: null })
      const store = new SupabaseNotificationOutboxStore(client)

      const result = await store.markSending(dummyJobId, fixedToken)
      expect(result).toBe(true)
      expect(rpcMock).toHaveBeenCalledTimes(1)
      expect(rpcMock).toHaveBeenCalledWith('mark_kakao_notification_sending', {
        p_job_id: dummyJobId,
        p_lease_token: fixedToken,
      })
    })

    it('RPC 성공하였으나 data === false인 경우 false를 반환한다', async () => {
      const { client, rpcMock } = createMockRpcClient({ data: false, error: null })
      const store = new SupabaseNotificationOutboxStore(client)

      const result = await store.markSending(dummyJobId, fixedToken)
      expect(result).toBe(false)
      expect(rpcMock).toHaveBeenCalledTimes(1)
    })

    it('boolean strict: data가 true가 아니면 false를 반환한다', async () => {
      for (const notStrictTrue of [1, 'true', null, undefined]) {
        const { client } = createMockRpcClient({ data: notStrictTrue, error: null })
        const store = new SupabaseNotificationOutboxStore(client)

        const result = await store.markSending(dummyJobId, fixedToken)
        expect(result).toBe(false)
      }
    })

    it('RPC 에러 발생 시 provider 필드 없는 generic error를 throw한다', async () => {
      const { client } = createMockRpcClient({
        data: null,
        error: { message: 'database locked or constraint violation' },
      })
      const store = new SupabaseNotificationOutboxStore(client)

      await expect(store.markSending(dummyJobId, fixedToken)).rejects.toThrow(OutboxStoreError)
      await expect(store.markSending(dummyJobId, fixedToken)).rejects.toThrow(
        'Notification outbox store operation failed',
      )
      await expect(store.markSending(dummyJobId, fixedToken)).rejects.not.toThrow(/database locked/)
    })

    it('injected client가 민감정보 canary 메시지를 담은 OutboxStoreError를 던져도 고정 메시지로 치환된다', async () => {
      const canaryError = new OutboxStoreError('canary-leak-phone-010-3333-4444')
      const client: OutboxSupabaseRpcClient = {
        rpc: vi.fn().mockRejectedValue(canaryError),
      }
      const store = new SupabaseNotificationOutboxStore(client)

      await expect(store.markSending(dummyJobId, fixedToken)).rejects.toThrow(OutboxStoreError)
      await expect(store.markSending(dummyJobId, fixedToken)).rejects.toThrow(
        'Notification outbox store operation failed',
      )
      await expect(store.markSending(dummyJobId, fixedToken)).rejects.not.toThrow(/canary-leak-phone|010-3333-4444/)
    })

    it('jobId 또는 token이 비어있으면 RPC 호출 없이 generic error를 throw한다', async () => {
      const { client, rpcMock } = createMockRpcClient()
      const store = new SupabaseNotificationOutboxStore(client)

      await expect(store.markSending('', fixedToken)).rejects.toThrow(OutboxStoreError)
      await expect(store.markSending(dummyJobId, '')).rejects.toThrow(OutboxStoreError)
      expect(rpcMock).not.toHaveBeenCalled()
    })
  })

  describe('finish', () => {
    it('RPC 성공 및 data === true인 경우 true를 반환하며 모든 파라미터(reasonCode 포함)를 정확히 전달한다', async () => {
      const { client, rpcMock } = createMockRpcClient({ data: true, error: null })
      const store = new SupabaseNotificationOutboxStore(client)

      const state: OutboxState = 'SENT'
      const reasonCode = 'SENT_SUCCESS'

      const result = await store.finish(dummyJobId, fixedToken, state, reasonCode)
      expect(result).toBe(true)
      expect(rpcMock).toHaveBeenCalledTimes(1)
      expect(rpcMock).toHaveBeenCalledWith('finish_kakao_notification_job', {
        p_job_id: dummyJobId,
        p_lease_token: fixedToken,
        p_status: 'SENT',
        p_reason_code: 'SENT_SUCCESS',
      })
    })

    it('reasonCode가 없거나 빈 문자열/공백이면 RPC에 null을 전달하지 않고 OutboxStoreError를 던진다', async () => {
      for (const invalidReason of ['', '   ', undefined as unknown as string, null as unknown as string]) {
        const { client, rpcMock } = createMockRpcClient({ data: true, error: null })
        const store = new SupabaseNotificationOutboxStore(client)

        const state: OutboxState = 'BLOCKED'
        await expect(store.finish(dummyJobId, fixedToken, state, invalidReason)).rejects.toThrow(
          OutboxStoreError,
        )
        expect(rpcMock).not.toHaveBeenCalled()
      }
    })

    it('completed/UNKNOWN/SUPERSEDED 상태 전이 시 자체 재시도 없이 1회만 호출한다', async () => {
      const { client, rpcMock } = createMockRpcClient({ data: false, error: null })
      const store = new SupabaseNotificationOutboxStore(client)

      const result = await store.finish(dummyJobId, fixedToken, 'UNKNOWN', 'SEND_EXCEPTION')
      expect(result).toBe(false)
      expect(rpcMock).toHaveBeenCalledTimes(1)
    })

    it('boolean strict: data가 true가 아니면 false를 반환한다', async () => {
      const { client } = createMockRpcClient({ data: 'true', error: null })
      const store = new SupabaseNotificationOutboxStore(client)

      const result = await store.finish(dummyJobId, fixedToken, 'SENT', 'SENT_SUCCESS')
      expect(result).toBe(false)
    })

    it('RPC 에러 발생 시 provider 필드 없는 generic error를 throw한다', async () => {
      const { client } = createMockRpcClient({
        data: null,
        error: { message: 'deadlock detected in postgres function' },
      })
      const store = new SupabaseNotificationOutboxStore(client)

      await expect(store.finish(dummyJobId, fixedToken, 'SENT', 'SENT_SUCCESS')).rejects.toThrow(OutboxStoreError)
      await expect(store.finish(dummyJobId, fixedToken, 'SENT', 'SENT_SUCCESS')).rejects.toThrow(
        'Notification outbox store operation failed',
      )
      await expect(store.finish(dummyJobId, fixedToken, 'SENT', 'SENT_SUCCESS')).rejects.not.toThrow(/deadlock/)
    })

    it('injected client가 민감정보 canary 메시지를 담은 OutboxStoreError를 던져도 고정 메시지로 치환된다', async () => {
      const canaryError = new OutboxStoreError('canary-leak-phone-010-5555-6666')
      const client: OutboxSupabaseRpcClient = {
        rpc: vi.fn().mockRejectedValue(canaryError),
      }
      const store = new SupabaseNotificationOutboxStore(client)

      await expect(store.finish(dummyJobId, fixedToken, 'SENT', 'SENT_SUCCESS')).rejects.toThrow(OutboxStoreError)
      await expect(store.finish(dummyJobId, fixedToken, 'SENT', 'SENT_SUCCESS')).rejects.toThrow(
        'Notification outbox store operation failed',
      )
      await expect(store.finish(dummyJobId, fixedToken, 'SENT', 'SENT_SUCCESS')).rejects.not.toThrow(/canary-leak-phone|010-5555-6666/)
    })

    it('jobId 또는 token이 비어있으면 RPC 호출 없이 generic error를 throw한다', async () => {
      const { client, rpcMock } = createMockRpcClient()
      const store = new SupabaseNotificationOutboxStore(client)

      await expect(store.finish('', fixedToken, 'SENT', 'SENT_SUCCESS')).rejects.toThrow(OutboxStoreError)
      await expect(store.finish(dummyJobId, '', 'SENT', 'SENT_SUCCESS')).rejects.toThrow(OutboxStoreError)
      expect(rpcMock).not.toHaveBeenCalled()
    })
  })
})
