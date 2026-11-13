import { describe, expect, it, vi } from 'vitest'
import {
  verifyKakaoWebhookAuth,
  parseKakaoUnlinkPayload,
  createUnlinkIdempotencyKey,
  maskUserId,
  sanitizePayloadForLogging,
  InMemoryIdempotencyStore,
  handleKakaoUnlinkWebhook,
  type KakaoUnlinkPayload,
} from './index'

describe('Kakao Webhook Auth Verification (verifyKakaoWebhookAuth)', () => {
  const secret = 'test-admin-secret-key-12345'

  it('유효한 KakaoAK 헤더와 일치하는 시크릿이면 true를 반환한다', () => {
    const header = `KakaoAK ${secret}`
    expect(verifyKakaoWebhookAuth(header, secret)).toBe(true)
  })

  it('공백이 포함된 KakaoAK 헤더도 정상 검증한다', () => {
    const header = `  KakaoAK   ${secret}  `
    expect(verifyKakaoWebhookAuth(header, secret)).toBe(true)
  })

  it('시크릿이 일치하지 않으면 false를 반환한다', () => {
    const header = 'KakaoAK wrong-secret'
    expect(verifyKakaoWebhookAuth(header, secret)).toBe(false)
  })

  it('KakaoAK 접두사가 없거나 잘못된 스킴(Bearer 등)이면 false를 반환한다', () => {
    expect(verifyKakaoWebhookAuth(`Bearer ${secret}`, secret)).toBe(false)
    expect(verifyKakaoWebhookAuth(secret, secret)).toBe(false)
  })

  it('헤더 또는 시크릿이 null/undefined/빈 문자열이면 false를 반환한다', () => {
    expect(verifyKakaoWebhookAuth(null, secret)).toBe(false)
    expect(verifyKakaoWebhookAuth(undefined, secret)).toBe(false)
    expect(verifyKakaoWebhookAuth('', secret)).toBe(false)
    expect(verifyKakaoWebhookAuth(`KakaoAK ${secret}`, null)).toBe(false)
    expect(verifyKakaoWebhookAuth(`KakaoAK ${secret}`, '')).toBe(false)
  })

  it('시크릿 길이가 달라도 타이밍 공격 없이 안전하게 false를 반환한다', () => {
    expect(verifyKakaoWebhookAuth(`KakaoAK short`, secret)).toBe(false)
    expect(verifyKakaoWebhookAuth(`KakaoAK a-very-very-long-secret-longer-than-expected`, secret)).toBe(false)
  })
})

describe('Kakao Unlink Payload Parser (parseKakaoUnlinkPayload)', () => {
  it('표준 JSON 페이로드를 KakaoUnlinkPayload로 파싱한다', () => {
    const raw = {
      app_id: '987654',
      user_id: '1234567890',
      referrer_type: 'UNLINK_FROM_APPS',
    }
    const result = parseKakaoUnlinkPayload(raw)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.payload).toEqual({
      appId: '987654',
      userId: '1234567890',
      referrerType: 'UNLINK_FROM_APPS',
      groupUserToken: undefined,
    })
  })

  it('숫자형 app_id와 user_id를 문자열로 정규화한다', () => {
    const raw = {
      app_id: 987654,
      user_id: 1234567890,
      referrer_type: 'ACCOUNT_DELETE',
    }
    const result = parseKakaoUnlinkPayload(raw)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.payload.appId).toBe('987654')
    expect(result.payload.userId).toBe('1234567890')
    expect(result.payload.referrerType).toBe('ACCOUNT_DELETE')
  })

  it('group_user_token이 제공되면 함께 파싱한다', () => {
    const raw = {
      app_id: '100',
      user_id: '200',
      referrer_type: 'FORCED_ACCOUNT_DELETE',
      group_user_token: 'grp-token-xyz',
    }
    const result = parseKakaoUnlinkPayload(raw)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.payload.groupUserToken).toBe('grp-token-xyz')
  })

  it('URLSearchParams 또는 객체 형태(GET/Form)도 파싱할 수 있다', () => {
    const params = new URLSearchParams()
    params.set('app_id', '111')
    params.set('user_id', '222')
    params.set('referrer_type', 'UNLINK_FROM_ADMIN')

    const result = parseKakaoUnlinkPayload(params)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.payload.appId).toBe('111')
    expect(result.payload.userId).toBe('222')
    expect(result.payload.referrerType).toBe('UNLINK_FROM_ADMIN')
  })

  it('필수 필드(user_id, referrer_type, app_id) 누락 시 에러를 반환한다', () => {
    expect(parseKakaoUnlinkPayload({ app_id: '1', referrer_type: 'ACCOUNT_DELETE' }).ok).toBe(false)
    expect(parseKakaoUnlinkPayload({ user_id: '1', referrer_type: 'ACCOUNT_DELETE' }).ok).toBe(false)
    expect(parseKakaoUnlinkPayload({ app_id: '1', user_id: '1' }).ok).toBe(false)
    expect(parseKakaoUnlinkPayload(null).ok).toBe(false)
    expect(parseKakaoUnlinkPayload('not an object').ok).toBe(false)
  })
})

describe('PII Masking & Safe Logging', () => {
  it('userId의 중간 문자열을 마스킹하여 PII 노출을 차단한다', () => {
    const masked = maskUserId('1234567890')
    expect(masked).not.toBe('1234567890')
    expect(masked).toBe('12******90')
  })

  it('짧은 userId도 안전하게 마스킹한다', () => {
    expect(maskUserId('1234')).toBe('1**4')
    expect(maskUserId('12')).toBe('**')
    expect(maskUserId('')).toBe('***')
  })

  it('sanitizePayloadForLogging 결과에 원본 user_id가 평문으로 남지 않는다', () => {
    const payload: KakaoUnlinkPayload = {
      appId: 'app-999',
      userId: 'user-sensitive-12345',
      referrerType: 'UNLINK_FROM_APPS',
    }
    const sanitized = sanitizePayloadForLogging(payload)
    expect(sanitized.userIdMasked).toBeDefined()
    expect(sanitized).not.toHaveProperty('userId')
    expect(JSON.stringify(sanitized)).not.toContain('user-sensitive-12345')
  })
})

describe('Idempotency Key & Store', () => {
  const payload: KakaoUnlinkPayload = {
    appId: '1000',
    userId: '2000',
    referrerType: 'UNLINK_FROM_APPS',
  }

  it('결정적인 멱등키를 생성한다', () => {
    const key1 = createUnlinkIdempotencyKey(payload)
    const key2 = createUnlinkIdempotencyKey(payload)
    expect(key1).toBe(key2)
    expect(key1).toContain('1000')
    expect(key1).toContain('2000')
    expect(key1).toContain('UNLINK_FROM_APPS')
  })

  it('InMemoryIdempotencyStore가 has 및 set 동작을 정상 수행한다', () => {
    const store = new InMemoryIdempotencyStore()
    const key = createUnlinkIdempotencyKey(payload)

    expect(store.has(key)).toBe(false)
    store.set(key)
    expect(store.has(key)).toBe(true)
  })
})

describe('handleKakaoUnlinkWebhook', () => {
  const secret = 'valid-webhook-secret-xyz'
  const validPayload = {
    app_id: 'app-1',
    user_id: 'user-1',
    referrer_type: 'ACCOUNT_DELETE',
  }

  it('시크릿 환경변수가 설정되지 않았으면 503을 반환한다', async () => {
    const result = await handleKakaoUnlinkWebhook({
      authHeader: `KakaoAK ${secret}`,
      secret: undefined,
      rawBody: validPayload,
    })
    expect(result.status).toBe(503)
    expect(result.body.ok).toBe(false)
    expect(result.body.code).toBe('ENV_NOT_CONFIGURED')
  })

  it('헤더 검증 실패 시 401을 반환한다', async () => {
    const result = await handleKakaoUnlinkWebhook({
      authHeader: 'KakaoAK wrong-secret',
      secret,
      rawBody: validPayload,
    })
    expect(result.status).toBe(401)
    expect(result.body.ok).toBe(false)
    expect(result.body.code).toBe('UNAUTHORIZED')
  })

  it('페이로드가 유효하지 않으면 400을 반환한다', async () => {
    const result = await handleKakaoUnlinkWebhook({
      authHeader: `KakaoAK ${secret}`,
      secret,
      rawBody: { invalid: 'data' },
    })
    expect(result.status).toBe(400)
    expect(result.body.ok).toBe(false)
    expect(result.body.code).toBe('INVALID_PAYLOAD')
  })

  it('유효한 요청이면 onUnlinked 콜백을 호출하고 200 PROCESSED를 반환한다', async () => {
    const onUnlinked = vi.fn().mockResolvedValue(undefined)
    const store = new InMemoryIdempotencyStore()

    const result = await handleKakaoUnlinkWebhook({
      authHeader: `KakaoAK ${secret}`,
      secret,
      rawBody: validPayload,
      onUnlinked,
      idempotencyStore: store,
    })

    expect(result.status).toBe(200)
    expect(result.body.ok).toBe(true)
    expect(result.body.code).toBe('PROCESSED')
    expect(onUnlinked).toHaveBeenCalledTimes(1)
    expect(onUnlinked).toHaveBeenCalledWith('user-1', {
      appId: 'app-1',
      userId: 'user-1',
      referrerType: 'ACCOUNT_DELETE',
      groupUserToken: undefined,
    })
  })

  it('중복 요청인 경우 onUnlinked를 중복 호출하지 않고 200 DUPLICATE_EVENT를 반환한다 (멱등성 보장)', async () => {
    const onUnlinked = vi.fn().mockResolvedValue(undefined)
    const store = new InMemoryIdempotencyStore()

    // First request
    const first = await handleKakaoUnlinkWebhook({
      authHeader: `KakaoAK ${secret}`,
      secret,
      rawBody: validPayload,
      onUnlinked,
      idempotencyStore: store,
    })
    expect(first.status).toBe(200)
    expect(first.body.code).toBe('PROCESSED')
    expect(onUnlinked).toHaveBeenCalledTimes(1)

    // Second request (duplicate)
    const second = await handleKakaoUnlinkWebhook({
      authHeader: `KakaoAK ${secret}`,
      secret,
      rawBody: validPayload,
      onUnlinked,
      idempotencyStore: store,
    })
    expect(second.status).toBe(200)
    expect(second.body.code).toBe('DUPLICATE_EVENT')
    expect(second.body.duplicate).toBe(true)
    // onUnlinked should NOT be called again
    expect(onUnlinked).toHaveBeenCalledTimes(1)
  })
})
