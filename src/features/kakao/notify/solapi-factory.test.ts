import { describe, expect, it, vi } from 'vitest'
import type { AlimtalkSendRequest } from './alimtalk-contract'
import {
  createAlimtalkAdapterFromEnv,
  type SolapiEnv,
} from './solapi-factory'

describe('KAPI-11/16 solapi-factory (createAlimtalkAdapterFromEnv)', () => {
  const validSecrets = {
    apiKey: 'NCSTEST_API_KEY_1234567890',
    apiSecret: 'SECRET_KEY_VERY_SECRET_9876543210',
    pfId: 'KA01PF240000000000',
  }

  const validEnv: SolapiEnv = {
    SOLAPI_ENABLED: 'true',
    SOLAPI_API_KEY: validSecrets.apiKey,
    SOLAPI_API_SECRET: validSecrets.apiSecret,
    SOLAPI_PF_ID: validSecrets.pfId,
    SOLAPI_BASE_URL: 'https://api.solapi.com',
  }

  const validRequest: AlimtalkSendRequest = {
    idempotencyKey: 'alimtalk:ws-test:book-1:booking_confirmed',
    recipientPhone: '010-1234-5678',
    templateCode: 'SOHEE_BOOKING_CONFIRMED_V1',
    templateBody: '[#{매장명}] 예약 확정 안내\n안녕하세요, #{고객명}님!',
    variables: {
      매장명: '바이름 헤어',
      고객명: '홍길동',
    },
    consent: 'informational',
  }

  describe('1. 활성화 조건 (SOLAPI_ENABLED=true 및 필수 키 모두 존재)', () => {
    it('SOLAPI_ENABLED=true 이고 API_KEY, API_SECRET, PF_ID 모두 존재할 때 enabled=true 어댑터를 생성한다', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          groupInfo: { groupId: 'G123' },
          messageList: { M999: { messageId: 'M999' } },
        }),
      })

      const adapter = createAlimtalkAdapterFromEnv(
        { ...validEnv, SOLAPI_TEMPLATE_IDS: JSON.stringify({ SOHEE_BOOKING_CONFIRMED_V1: 'KA01TP-TEST' }) },
        { fetchImpl: mockFetch as unknown as typeof fetch },
      )

      expect(adapter.enabled).toBe(true)

      const result = await adapter.send(validRequest)
      expect(result.success).toBe(true)
      expect(result.status).toBe('SENT')
      expect(mockFetch).toHaveBeenCalledTimes(1)
    })
  })

  describe('2. Fail-Closed 킬스위치 및 비활성 처리 (어떤 경우에도 throw 대신 DRY_RUN)', () => {
    it('SOLAPI_ENABLED가 false인 경우 DRY_RUN 모드로 격리된다', async () => {
      const mockFetch = vi.fn()
      const env: SolapiEnv = {
        ...validEnv,
        SOLAPI_ENABLED: 'false',
      }

      const adapter = createAlimtalkAdapterFromEnv(env, {
        fetchImpl: mockFetch as unknown as typeof fetch,
      })

      expect(adapter.enabled).toBe(false)

      const result = await adapter.send(validRequest)
      expect(result.success).toBe(true)
      expect(result.status).toBe('DRY_RUN')
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('SOLAPI_ENABLED 환경변수가 누락되거나 빈 문자열인 경우 DRY_RUN 모드로 격리된다', async () => {
      const mockFetch = vi.fn()
      const env: SolapiEnv = {
        ...validEnv,
        SOLAPI_ENABLED: undefined,
      }

      const adapter = createAlimtalkAdapterFromEnv(env, {
        fetchImpl: mockFetch as unknown as typeof fetch,
      })

      expect(adapter.enabled).toBe(false)
      const result = await adapter.send(validRequest)
      expect(result.status).toBe('DRY_RUN')
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('SOLAPI_API_KEY가 누락되거나 빈 문자열인 경우 DRY_RUN 모드로 격리된다', async () => {
      const mockFetch = vi.fn()
      const env: SolapiEnv = {
        ...validEnv,
        SOLAPI_API_KEY: '   ',
      }

      const adapter = createAlimtalkAdapterFromEnv(env, {
        fetchImpl: mockFetch as unknown as typeof fetch,
      })

      expect(adapter.enabled).toBe(false)
      const result = await adapter.send(validRequest)
      expect(result.status).toBe('DRY_RUN')
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('SOLAPI_API_SECRET이 누락되거나 빈 문자열인 경우 DRY_RUN 모드로 격리된다', async () => {
      const mockFetch = vi.fn()
      const env: SolapiEnv = {
        ...validEnv,
        SOLAPI_API_SECRET: '',
      }

      const adapter = createAlimtalkAdapterFromEnv(env, {
        fetchImpl: mockFetch as unknown as typeof fetch,
      })

      expect(adapter.enabled).toBe(false)
      const result = await adapter.send(validRequest)
      expect(result.status).toBe('DRY_RUN')
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('SOLAPI_PF_ID가 누락되거나 빈 문자열인 경우 DRY_RUN 모드로 격리된다', async () => {
      const mockFetch = vi.fn()
      const env: SolapiEnv = {
        ...validEnv,
        SOLAPI_PF_ID: undefined,
      }

      const adapter = createAlimtalkAdapterFromEnv(env, {
        fetchImpl: mockFetch as unknown as typeof fetch,
      })

      expect(adapter.enabled).toBe(false)
      const result = await adapter.send(validRequest)
      expect(result.status).toBe('DRY_RUN')
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('env가 undefined이거나 null인 경우에도 throw하지 않고 DRY_RUN 어댑터를 반환한다', async () => {
      const adapter = createAlimtalkAdapterFromEnv(undefined)
      expect(adapter.enabled).toBe(false)

      const result = await adapter.send(validRequest)
      expect(result.status).toBe('DRY_RUN')
    })
  })

  describe('3. 비밀값 노출 방지 검증 (반환 객체/에러에 노출 금지)', () => {
    it('어댑터 객체를 JSON.stringify 하거나 키를 순회해도 API_KEY, API_SECRET이 노출되지 않는다', () => {
      const adapter = createAlimtalkAdapterFromEnv(validEnv)
      const serialized = JSON.stringify(adapter)
      const keys = Object.keys(adapter)

      expect(serialized).not.toContain(validSecrets.apiKey)
      expect(serialized).not.toContain(validSecrets.apiSecret)
      expect(keys).not.toContain('apiKey')
      expect(keys).not.toContain('apiSecret')
    })

    it('비활성 어댑터에서도 비밀키가 노출되지 않는다', () => {
      const adapter = createAlimtalkAdapterFromEnv({
        ...validEnv,
        SOLAPI_ENABLED: 'false',
      })
      const serialized = JSON.stringify(adapter)
      const keys = Object.keys(adapter)

      expect(serialized).not.toContain(validSecrets.apiKey)
      expect(serialized).not.toContain(validSecrets.apiSecret)
      expect(keys).not.toContain('apiKey')
      expect(keys).not.toContain('apiSecret')
    })
  })

  describe('4. readbackStatus 위임 검증', () => {
    it('DRY_RUN 모드에서 발송 후 readbackStatus 조회가 정상 동작한다', async () => {
      const adapter = createAlimtalkAdapterFromEnv({
        ...validEnv,
        SOLAPI_ENABLED: 'false',
      })

      await adapter.send(validRequest)
      const statusRes = await adapter.readbackStatus(validRequest.idempotencyKey)

      expect(statusRes.found).toBe(true)
      expect(statusRes.status).toBe('DRY_RUN')
    })
  })
})

describe('SOLAPI_TEMPLATE_IDS 미설정 시 fail-closed', () => {
  it('매핑이 없으면 실발송 어댑터라도 네트워크 호출 없이 FAILED', async () => {
    const mockFetch = vi.fn()
    const adapter = createAlimtalkAdapterFromEnv(
      {
        SOLAPI_ENABLED: 'true',
        SOLAPI_API_KEY: 'k',
        SOLAPI_API_SECRET: 's',
        SOLAPI_PF_ID: 'pf',
      },
      { fetchImpl: mockFetch as unknown as typeof fetch },
    )
    const result = await adapter.send({
      idempotencyKey: 'alimtalk:w:b:e',
      recipientPhone: '010-1234-5678',
      templateCode: 'SOHEE_BOOKING_CONFIRMED_V1',
      templateBody: '[#{매장명}] 안내',
      variables: { 매장명: '소희' },
      consent: 'informational',
    })
    expect(result.status).toBe('FAILED')
    expect(mockFetch).not.toHaveBeenCalled()
  })
})
