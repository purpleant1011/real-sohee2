import { describe, expect, it, vi } from 'vitest'
import type { AlimtalkSendRequest } from './alimtalk-contract'
import {
  createSolapiAuthHeader,
  createSolapiSignature,
  maskSecrets,
  SolapiAlimtalkAdapter,
} from './solapi-adapter'

describe('SolapiAlimtalkAdapter', () => {
  const fixedDate = '2026-11-05T12:00:00.000Z'
  const fixedSalt = 'salt-1234567890abcdef'
  const apiKey = 'SOLAPI_API_KEY_TEST_12345'
  const apiSecret = 'SOLAPI_API_SECRET_TEST_SECRET_67890'
  const pfId = 'PF_TEST_PROFILE_ID'

  const validRequest: AlimtalkSendRequest = {
    idempotencyKey: 'alimtalk:ws-1:book-1:CONFIRMED',
    recipientPhone: '010-1234-5678',
    templateCode: 'TMPL_BOOKING_CONFIRMED',
    templateBody: '고객 #{고객명}님의 예약이 #{일시}에 확정되었습니다.',
    variables: {
      고객명: '홍길동',
      일시: '2026-11-07 14:00',
    },
    consent: 'informational',
    workspaceId: 'ws-1',
    bookingId: 'book-1',
    event: 'CONFIRMED',
  }

  describe('HMAC-SHA256 signature and Auth Header (deterministic vector)', () => {
    it('creates deterministic HMAC-SHA256 signature using Web Crypto', async () => {
      const sig1 = await createSolapiSignature(apiSecret, fixedDate, fixedSalt)
      const sig2 = await createSolapiSignature(apiSecret, fixedDate, fixedSalt)

      expect(sig1).toBe(sig2)
      expect(sig1).toMatch(/^[0-9a-f]{64}$/)

      // Explicit verification: data = fixedDate + fixedSalt
      const enc = new TextEncoder()
      const key = await crypto.subtle.importKey(
        'raw',
        enc.encode(apiSecret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign'],
      )
      const expectedBuf = await crypto.subtle.sign(
        'HMAC',
        key,
        enc.encode(`${fixedDate}${fixedSalt}`),
      )
      const expectedHex = Array.from(new Uint8Array(expectedBuf))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')

      expect(sig1).toBe(expectedHex)
    })

    it('formats Authorization header per SOLAPI documentation', async () => {
      const header = await createSolapiAuthHeader({
        apiKey,
        apiSecret,
        date: fixedDate,
        salt: fixedSalt,
      })

      expect(header).toMatch(
        /^HMAC-SHA256 apiKey=SOLAPI_API_KEY_TEST_12345, date=2026-11-05T12:00:00\.000Z, salt=salt-1234567890abcdef, signature=[0-9a-f]{64}$/,
      )
    })
  })

  describe('maskSecrets utility', () => {
    it('masks apiKey, apiSecret, signature and raw headers in error strings', () => {
      const rawError = `Failed to send: apiKey=SOLAPI_API_KEY_TEST_12345, secret=${apiSecret}, signature=deadbeef123456`
      const masked = maskSecrets(rawError, [apiKey, apiSecret, 'deadbeef123456'])

      expect(masked).not.toContain(apiKey)
      expect(masked).not.toContain(apiSecret)
      expect(masked).not.toContain('deadbeef123456')
      expect(masked).toContain('[MASKED]')
    })
  })

  describe('Default disabled (enabled=false) mode', () => {
    it('returns DRY_RUN without making any network call when enabled is false or omitted', async () => {
      const mockFetch = vi.fn()
      const adapter = new SolapiAlimtalkAdapter({
        apiKey,
        apiSecret,
        pfId,
        fetchImpl: mockFetch as unknown as typeof fetch,
        now: () => fixedDate,
        saltGen: () => fixedSalt,
        enabled: false,
      })

      const result = await adapter.send(validRequest)

      expect(mockFetch).not.toHaveBeenCalled()
      expect(result.success).toBe(true)
      expect(result.status).toBe('DRY_RUN')
      expect(result.idempotencyKey).toBe(validRequest.idempotencyKey)
      expect(result.normalizedPhone).toBe('+821012345678')
      expect(result.resolvedMessage).toBe('고객 홍길동님의 예약이 2026-11-07 14:00에 확정되었습니다.')

      // readbackStatus
      const readback = await adapter.readbackStatus(validRequest.idempotencyKey)
      expect(readback.found).toBe(true)
      expect(readback.status).toBe('DRY_RUN')
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('rejects if consent is none even in disabled mode', async () => {
      const mockFetch = vi.fn()
      const adapter = new SolapiAlimtalkAdapter({
        apiKey,
        apiSecret,
        pfId,
        fetchImpl: mockFetch as unknown as typeof fetch,
      })

      const result = await adapter.send({
        ...validRequest,
        consent: 'none',
      })

      expect(mockFetch).not.toHaveBeenCalled()
      expect(result.success).toBe(false)
      expect(result.status).toBe('REJECTED')
      expect(result.error).toContain('consent: none')

      // readbackStatus must not return false success ('SENT') for REJECTED cache
      const readback = await adapter.readbackStatus(validRequest.idempotencyKey)
      expect(readback.found).toBe(true)
      expect(readback.status).toBe('FAILED')
    })

    it('rejects if phone number is not valid 010 mobile', async () => {
      const mockFetch = vi.fn()
      const adapter = new SolapiAlimtalkAdapter({
        apiKey,
        apiSecret,
        pfId,
        fetchImpl: mockFetch as unknown as typeof fetch,
      })

      const result = await adapter.send({
        ...validRequest,
        recipientPhone: '02-1234-5678', // landline
      })

      expect(mockFetch).not.toHaveBeenCalled()
      expect(result.success).toBe(false)
      expect(result.status).toBe('REJECTED')
      expect(result.error).toContain('유선 전화번호는 알림톡 수신이 불가능합니다')
    })

    it('rejects if advertising content is included', async () => {
      const mockFetch = vi.fn()
      const adapter = new SolapiAlimtalkAdapter({
        apiKey,
        apiSecret,
        pfId,
        fetchImpl: mockFetch as unknown as typeof fetch,
      })

      const result = await adapter.send({
        ...validRequest,
        templateBody: '(광고) 특가이벤트 고객 #{고객명}님',
      })

      expect(mockFetch).not.toHaveBeenCalled()
      expect(result.success).toBe(false)
      expect(result.status).toBe('REJECTED')
      expect(result.error).toContain('광고성 문구')
    })
  })

  describe('Live mode (enabled=true)', () => {
    it('sends message via SOLAPI API with proper headers and body', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          groupInfo: {
            groupId: 'G4V202611050000000001',
          },
          failedMessageList: [],
          messageList: {
            M4V202611050000000001: {
              messageId: 'M4V202611050000000001',
              statusCode: '2000',
              status: 'SENDING',
            },
          },
        }),
      })

      const adapter = new SolapiAlimtalkAdapter({
        apiKey,
        apiSecret,
        pfId,
        fetchImpl: mockFetch as unknown as typeof fetch,
        now: () => fixedDate,
        saltGen: () => fixedSalt,
        enabled: true,
      })

      const result = await adapter.send(validRequest)

      expect(mockFetch).toHaveBeenCalledTimes(1)
      const [url, init] = mockFetch.mock.calls[0]
      expect(url).toBe('https://api.solapi.com/messages/v4/send-many/detail')
      expect(init.method).toBe('POST')

      // Check Authorization header
      const authHeader = init.headers['Authorization']
      expect(authHeader).toContain(`apiKey=${apiKey}`)
      expect(authHeader).toContain(`date=${fixedDate}`)
      expect(authHeader).toContain(`salt=${fixedSalt}`)

      // Check request body format per Solapi ATA spec
      const parsedBody = JSON.parse(init.body)
      expect(parsedBody.messages).toHaveLength(1)
      const msg = parsedBody.messages[0]
      expect(msg.to).toBe('01012345678')
      expect(msg.country).toBe('82')
      expect(msg.kakaoOptions).toEqual({
        pfId,
        templateId: 'TMPL_BOOKING_CONFIRMED',
        variables: {
          '#{고객명}': '홍길동',
          '#{일시}': '2026-11-07 14:00',
        },
        disableSms: true,
      })
      expect(msg.customFields).toEqual({
        idempotencyKey: validRequest.idempotencyKey,
      })

      // Result verification
      expect(result.success).toBe(true)
      expect(result.status).toBe('SENT')
      expect(result.idempotencyKey).toBe(validRequest.idempotencyKey)
      expect(result.normalizedPhone).toBe('+821012345678')
      expect(result.resolvedMessage).toBe('고객 홍길동님의 예약이 2026-11-07 14:00에 확정되었습니다.')
    })

    it('handles Solapi HTTP error response with secret masking', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        text: async () =>
          `{"errorCode":"InvalidSignature","errorMessage":"Invalid signature for apiKey=${apiKey} and secret=${apiSecret}"}`,
      })

      const adapter = new SolapiAlimtalkAdapter({
        apiKey,
        apiSecret,
        pfId,
        fetchImpl: mockFetch as unknown as typeof fetch,
        enabled: true,
      })

      const result = await adapter.send(validRequest)

      expect(result.success).toBe(false)
      expect(result.status).toBe('FAILED')
      expect(result.errorCode).toBe('HTTP_401_INVALID_SIGNATURE')
      expect(result.errorCode).toMatch(/^[A-Z0-9_]{1,40}$/)
      expect(result.error).toBeDefined()
      expect(result.reason).toBeDefined()

      // Ensure secret masking: apiKey and apiSecret must never leak in error/reason
      expect(result.error).not.toContain(apiKey)
      expect(result.error).not.toContain(apiSecret)
      expect(result.reason).not.toContain(apiKey)
      expect(result.reason).not.toContain(apiSecret)
    })

    it('handles Solapi failedMessageList in 200 OK response with secret masking', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          groupInfo: { groupId: 'G4V111' },
          failedMessageList: [
            {
              to: '01012345678',
              statusCode: '4001',
              reason: `Failed because of secret ${apiSecret}`,
            },
          ],
        }),
      })

      const adapter = new SolapiAlimtalkAdapter({
        apiKey,
        apiSecret,
        pfId,
        fetchImpl: mockFetch as unknown as typeof fetch,
        enabled: true,
      })

      const result = await adapter.send(validRequest)

      expect(result.success).toBe(false)
      expect(result.status).toBe('FAILED')
      expect(result.errorCode).toBe('SOLAPI_4001')
      expect(result.errorCode).toMatch(/^[A-Z0-9_]{1,40}$/)
      expect(result.error).not.toContain(apiSecret)
      expect(result.reason).not.toContain(apiSecret)
      expect(result.reason).toContain('[MASKED]')
    })

    it('handles network throw exception with secret masking', async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error(`Network timeout with secret=${apiSecret}`))

      const adapter = new SolapiAlimtalkAdapter({
        apiKey,
        apiSecret,
        pfId,
        fetchImpl: mockFetch as unknown as typeof fetch,
        enabled: true,
      })

      const result = await adapter.send(validRequest)

      expect(result.success).toBe(false)
      expect(result.status).toBe('FAILED')
      expect(result.errorCode).toBe('NETWORK_EXCEPTION')
      expect(result.reason).not.toContain(apiSecret)
      expect(result.error).not.toContain(apiSecret)
    })

    it('sets safe errorCode for local pre-rejections without leaking PII or secrets', async () => {
      const adapter = new SolapiAlimtalkAdapter({
        apiKey,
        apiSecret,
        pfId,
        enabled: true,
        templateIdMap: {
          TMPL_OTHER: 'MAPPED_OTHER',
        },
      })

      // 1. Consent 거부 -> LOCAL_CONSENT
      const consentResult = await adapter.send({
        ...validRequest,
        consent: 'none',
      })
      expect(consentResult.errorCode).toBe('LOCAL_CONSENT')
      expect(consentResult.errorCode).toMatch(/^[A-Z0-9_]{1,40}$/)

      // 2. 광고성 문구 거부 -> LOCAL_AD
      const adResult = await adapter.send({
        ...validRequest,
        templateBody: '(광고) 예약 알림 #{고객명}',
      })
      expect(adResult.errorCode).toBe('LOCAL_AD')
      expect(adResult.errorCode).toMatch(/^[A-Z0-9_]{1,40}$/)

      // 3. 전화번호 검증 실패 -> LOCAL_PHONE
      const phoneResult = await adapter.send({
        ...validRequest,
        recipientPhone: '02-999-9999',
      })
      expect(phoneResult.errorCode).toBe('LOCAL_PHONE')
      expect(phoneResult.errorCode).toMatch(/^[A-Z0-9_]{1,40}$/)

      // 4. 변수 검증 실패 -> LOCAL_VARIABLES
      const varResult = await adapter.send({
        ...validRequest,
        variables: {
          고객명: '홍길동',
          // '일시' 누락
        },
      })
      expect(varResult.errorCode).toBe('LOCAL_VARIABLES')
      expect(varResult.errorCode).toMatch(/^[A-Z0-9_]{1,40}$/)

      // 5. 템플릿 미매핑 -> LOCAL_TEMPLATE_UNMAPPED
      const unmappedResult = await adapter.send({
        ...validRequest,
        templateCode: 'UNMAPPED_CODE_123',
      })
      expect(unmappedResult.errorCode).toBe('LOCAL_TEMPLATE_UNMAPPED')
      expect(unmappedResult.errorCode).toMatch(/^[A-Z0-9_]{1,40}$/)
    })

    it('formats HTTP error without errorCode in json as HTTP_<status>', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        text: async () => '<html>Internal Server Error 01012345678 secret=xyz</html>',
      })

      const adapter = new SolapiAlimtalkAdapter({
        apiKey,
        apiSecret,
        pfId,
        fetchImpl: mockFetch as unknown as typeof fetch,
        enabled: true,
      })

      const result = await adapter.send(validRequest)
      expect(result.errorCode).toBe('HTTP_500')
      expect(result.errorCode).not.toContain('01012345678')
      expect(result.errorCode).not.toContain('xyz')
      expect(result.errorCode).toMatch(/^[A-Z0-9_]{1,40}$/)
    })

    it('reads back status via Solapi message list API', async () => {
      // Step 1: Send a message first
      const sendMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          groupInfo: { groupId: 'G4V202611050000000001' },
          failedMessageList: [],
          messageList: {
            M4V202611050000000001: {
              messageId: 'M4V202611050000000001',
              statusCode: '2000',
              status: 'SENDING',
            },
          },
        }),
      })

      const adapter = new SolapiAlimtalkAdapter({
        apiKey,
        apiSecret,
        pfId,
        fetchImpl: sendMock as unknown as typeof fetch,
        now: () => fixedDate,
        saltGen: () => fixedSalt,
        enabled: true,
      })

      await adapter.send(validRequest)

      // Step 2: Query status with readbackStatus
      const readbackMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          messageList: {
            M4V202611050000000001: {
              messageId: 'M4V202611050000000001',
              statusCode: '4000',
              status: 'COMPLETE',
            },
          },
        }),
      })

      // Replace fetchImpl for readback
      ;(adapter as unknown as { fetchImpl: typeof fetch }).fetchImpl = readbackMock as unknown as typeof fetch

      const readback = await adapter.readbackStatus(validRequest.idempotencyKey)

      expect(readbackMock).toHaveBeenCalledTimes(1)
      const [readbackUrl] = readbackMock.mock.calls[0]
      expect(readbackUrl).toContain('/messages/v4/list')
      expect(readbackUrl).toContain('M4V202611050000000001')

      expect(readback.found).toBe(true)
      expect(readback.status).toBe('SENT')
    })

    it('returns NOT_FOUND if message is not found on readbackStatus', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          messageList: {},
        }),
      })

      const adapter = new SolapiAlimtalkAdapter({
        apiKey,
        apiSecret,
        pfId,
        fetchImpl: mockFetch as unknown as typeof fetch,
        enabled: true,
      })

      const readback = await adapter.readbackStatus('alimtalk:non-existent-key')

      expect(readback.found).toBe(false)
      expect(readback.status).toBe('NOT_FOUND')
    })

    it('matches customFields.idempotencyKey during readback if messageId was not cached', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          messageList: {
            M4V_OTHER: {
              messageId: 'M4V_OTHER',
              customFields: { idempotencyKey: 'other-key' },
              status: 'COMPLETE',
            },
            M4V_TARGET: {
              messageId: 'M4V_TARGET',
              customFields: { idempotencyKey: 'alimtalk:ws-1:book-1:CONFIRMED' },
              status: 'COMPLETE',
            },
          },
        }),
      })

      const adapter = new SolapiAlimtalkAdapter({
        apiKey,
        apiSecret,
        pfId,
        fetchImpl: mockFetch as unknown as typeof fetch,
        enabled: true,
      })

      const readback = await adapter.readbackStatus('alimtalk:ws-1:book-1:CONFIRMED')

      expect(readback.found).toBe(true)
      expect(readback.status).toBe('SENT')
    })

    it('maps FAILED status correctly on readback', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          messageList: {
            M4V_FAIL: {
              messageId: 'M4V_FAIL',
              customFields: { idempotencyKey: 'alimtalk:ws-1:book-1:FAIL' },
              status: 'FAILED',
            },
          },
        }),
      })

      const adapter = new SolapiAlimtalkAdapter({
        apiKey,
        apiSecret,
        pfId,
        fetchImpl: mockFetch as unknown as typeof fetch,
        enabled: true,
      })

      const readback = await adapter.readbackStatus('alimtalk:ws-1:book-1:FAIL')

      expect(readback.found).toBe(true)
      expect(readback.status).toBe('FAILED')
    })

    it('returns FAILED instead of false SENT when readback HTTP fails but cache has FAILED status', async () => {
      const mockFetch = vi.fn()
        // 1. send call fails with 500
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          statusText: 'Internal Server Error',
          text: async () => 'Internal Server Error',
        })
        // 2. readback call also fails with 500
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          statusText: 'Internal Server Error',
          text: async () => 'Internal Server Error',
        })

      const adapter = new SolapiAlimtalkAdapter({
        apiKey,
        apiSecret,
        pfId,
        fetchImpl: mockFetch as unknown as typeof fetch,
        enabled: true,
      })

      const sendRes = await adapter.send(validRequest)
      expect(sendRes.status).toBe('FAILED')

      // readback fallback must preserve FAILED instead of returning SENT
      const readback = await adapter.readbackStatus(validRequest.idempotencyKey)
      expect(readback.found).toBe(true)
      expect(readback.status).toBe('FAILED')
    })

    it('returns FAILED instead of false SENT when readback throws network error but cache has FAILED status', async () => {
      const mockFetch = vi.fn()
        // 1. send call fails
        .mockResolvedValueOnce({
          ok: false,
          status: 400,
          statusText: 'Bad Request',
          text: async () => 'Bad Request',
        })
        // 2. readback call throws network error
        .mockRejectedValueOnce(new Error('Network disconnected'))

      const adapter = new SolapiAlimtalkAdapter({
        apiKey,
        apiSecret,
        pfId,
        fetchImpl: mockFetch as unknown as typeof fetch,
        enabled: true,
      })

      const sendRes = await adapter.send(validRequest)
      expect(sendRes.status).toBe('FAILED')

      const readback = await adapter.readbackStatus(validRequest.idempotencyKey)
      expect(readback.found).toBe(true)
      expect(readback.status).toBe('FAILED')
    })

    it('formats template variables to Solapi expected #{key} format', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          groupInfo: { groupId: 'G4V111' },
          failedMessageList: [],
          messageList: { M1: { messageId: 'M1', status: 'SENDING' } },
        }),
      })

      const adapter = new SolapiAlimtalkAdapter({
        apiKey,
        apiSecret,
        pfId,
        fetchImpl: mockFetch as unknown as typeof fetch,
        now: () => fixedDate,
        saltGen: () => fixedSalt,
        enabled: true,
      })

      await adapter.send({
        ...validRequest,
        variables: {
          고객명: '홍길동',
          일시: '2026-11-07 14:00',
        },
      })

      expect(mockFetch).toHaveBeenCalledTimes(1)
      const parsed = JSON.parse(mockFetch.mock.calls[0][1].body)
      expect(parsed.messages[0].kakaoOptions.variables).toEqual({
        '#{고객명}': '홍길동',
        '#{일시}': '2026-11-07 14:00',
      })
    })
  })
})

describe('templateIdMap (코드 → 솔라피 templateId)', () => {
  const base = {
    idempotencyKey: 'alimtalk:w:b:e',
    recipientPhone: '01012345678',
    templateCode: 'SOHEE_BOOKING_CONFIRMED_V1',
    templateBody: '[#{매장명}] 안내',
    variables: { 매장명: '소희' },
    consent: 'informational' as const,
  }

  it('매핑이 없으면 네트워크 호출 없이 FAILED', async () => {
    const fetchImpl = vi.fn()
    const adapter = new SolapiAlimtalkAdapter({
      apiKey: 'k', apiSecret: 's', pfId: 'pf', enabled: true, templateIdMap: {}, fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    const r = await adapter.send(base)
    expect(r.status).toBe('FAILED')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('매핑이 있으면 솔라피 templateId 로 호출', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ messageList: { m1: { messageId: 'm1', statusCode: '2000' } } }), { status: 200 }),
    )
    const adapter = new SolapiAlimtalkAdapter({
      apiKey: 'k', apiSecret: 's', pfId: 'pf', enabled: true,
      templateIdMap: { SOHEE_BOOKING_CONFIRMED_V1: 'KA01TP-ABC' },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    await adapter.send(base)
    const body = JSON.parse((fetchImpl.mock.calls[0] as unknown as [string, { body: string }])[1].body)
    expect(body.messages[0].kakaoOptions.templateId).toBe('KA01TP-ABC')
  })
})
