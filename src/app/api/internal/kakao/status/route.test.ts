import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { GET } from './route'
import { ALIMTALK_TEMPLATE_LIST } from '@/features/kakao/notify/templates'

describe('GET /api/internal/kakao/status', () => {
  const originalEnv = { ...process.env }
  const VALID_CRON_SECRET = 'super-secret-cron-token-at-least-20-chars'
  const ALL_KNOWN_TEMPLATE_CODES = ALIMTALK_TEMPLATE_LIST.map((t) => t.code)

  const FULL_VALID_TEMPLATE_MAP: Record<string, string> = {
    SOHEE_BOOKING_CONFIRMED_V1: 'KA01TP240001',
    SOHEE_BOOKING_CHANGED_V1: 'KA01TP240002',
    SOHEE_BOOKING_CANCELLED_V1: 'KA01TP240003',
    SOHEE_PAYMENT_CONFIRMED_V1: 'KA01TP240004',
    SOHEE_REMINDER_24H_V1: 'KA01TP240005',
    SOHEE_REMINDER_2H_V1: 'KA01TP240006',
  }

  beforeEach(() => {
    process.env = { ...originalEnv }
    delete process.env.CRON_SECRET
    delete process.env.SOLAPI_ENABLED
    delete process.env.SOLAPI_API_KEY
    delete process.env.SOLAPI_API_SECRET
    delete process.env.SOLAPI_PF_ID
    delete process.env.KAKAO_LOGIN_ENABLED
    delete process.env.SOLAPI_WEBHOOK_SECRET
    delete process.env.SOLAPI_TEMPLATE_IDS
  })

  afterEach(() => {
    process.env = originalEnv
  })

  describe('authentication', () => {
    it('returns 401 when CRON_SECRET is not configured', async () => {
      const req = new Request('http://localhost/api/internal/kakao/status', {
        headers: { authorization: `Bearer ${VALID_CRON_SECRET}` },
      })
      const res = await GET(req)
      expect(res.status).toBe(401)
      const body = await res.json()
      expect(body.error).toBeDefined()
    })

    it('returns 401 when authorization header is invalid or missing', async () => {
      process.env.CRON_SECRET = VALID_CRON_SECRET

      const reqNoAuth = new Request('http://localhost/api/internal/kakao/status')
      const resNoAuth = await GET(reqNoAuth)
      expect(resNoAuth.status).toBe(401)

      const reqWrongAuth = new Request('http://localhost/api/internal/kakao/status', {
        headers: { authorization: 'Bearer wrong-token' },
      })
      const resWrongAuth = await GET(reqWrongAuth)
      expect(resWrongAuth.status).toBe(401)
    })
  })

  describe('status payload and readiness', () => {
    it('returns default status with readiness sub-field when variables are unconfigured', async () => {
      process.env.CRON_SECRET = VALID_CRON_SECRET

      const req = new Request('http://localhost/api/internal/kakao/status', {
        headers: { authorization: `Bearer ${VALID_CRON_SECRET}` },
      })
      const res = await GET(req)
      expect(res.status).toBe(200)

      const body = await res.json()
      expect(body).toEqual({
        kakaoLogin: false,
        alimtalk: {
          enabled: false,
          missing: ['SOLAPI_API_KEY', 'SOLAPI_API_SECRET', 'SOLAPI_PF_ID'],
          dryRun: true,
        },
        webhookSecretConfigured: false,
        readiness: {
          configurationReady: false,
          liveEnabled: false,
          missing: [
            'SOLAPI_API_KEY',
            'SOLAPI_API_SECRET',
            'SOLAPI_PF_ID',
            'SOLAPI_WEBHOOK_SECRET',
          ],
          unmappedTemplateCodes: ALL_KNOWN_TEMPLATE_CODES,
          approvalVerified: false,
          deliveryVerified: false,
        },
      })
    })

    it('returns full enabled status with readiness when all environment variables and templates are set', async () => {
      process.env.CRON_SECRET = VALID_CRON_SECRET
      process.env.SOLAPI_ENABLED = 'true'
      process.env.SOLAPI_API_KEY = 'test-solapi-api-key'
      process.env.SOLAPI_API_SECRET = 'test-solapi-api-secret'
      process.env.SOLAPI_PF_ID = 'test-solapi-pf-id'
      process.env.KAKAO_LOGIN_ENABLED = 'true'
      process.env.SOLAPI_WEBHOOK_SECRET = 'test-kakao-webhook-secret'
      process.env.SOLAPI_TEMPLATE_IDS = JSON.stringify(FULL_VALID_TEMPLATE_MAP)

      const req = new Request('http://localhost/api/internal/kakao/status', {
        headers: { authorization: `Bearer ${VALID_CRON_SECRET}` },
      })
      const res = await GET(req)
      expect(res.status).toBe(200)

      const body = await res.json()
      expect(body).toEqual({
        kakaoLogin: true,
        alimtalk: {
          enabled: true,
          missing: [],
          dryRun: false,
        },
        webhookSecretConfigured: true,
        readiness: {
          configurationReady: true,
          liveEnabled: true,
          missing: [],
          unmappedTemplateCodes: [],
          approvalVerified: false,
          deliveryVerified: false,
        },
      })

      // Security check: ensure no secret values leaked in the response JSON
      const jsonString = JSON.stringify(body)
      expect(jsonString).not.toContain('test-solapi-api-key')
      expect(jsonString).not.toContain('test-solapi-api-secret')
      expect(jsonString).not.toContain('test-solapi-pf-id')
      expect(jsonString).not.toContain('test-kakao-webhook-secret')
      expect(jsonString).not.toContain(VALID_CRON_SECRET)
      expect(jsonString).not.toContain('KA01TP240001')
    })

    it('reports dryRun=true when keys exist but SOLAPI_ENABLED is false', async () => {
      process.env.CRON_SECRET = VALID_CRON_SECRET
      process.env.SOLAPI_ENABLED = 'false'
      process.env.SOLAPI_API_KEY = 'key'
      process.env.SOLAPI_API_SECRET = 'secret'
      process.env.SOLAPI_PF_ID = 'pf'

      const req = new Request('http://localhost/api/internal/kakao/status', {
        headers: { authorization: `Bearer ${VALID_CRON_SECRET}` },
      })
      const res = await GET(req)
      expect(res.status).toBe(200)

      const body = await res.json()
      expect(body.alimtalk).toEqual({
        enabled: false,
        missing: [],
        dryRun: true,
      })
      expect(body.readiness.liveEnabled).toBe(false)
    })

    it('reports missing variables when only partial keys are provided', async () => {
      process.env.CRON_SECRET = VALID_CRON_SECRET
      process.env.SOLAPI_ENABLED = 'true'
      process.env.SOLAPI_API_KEY = 'key'
      // missing SOLAPI_API_SECRET, SOLAPI_PF_ID

      const req = new Request('http://localhost/api/internal/kakao/status', {
        headers: { authorization: `Bearer ${VALID_CRON_SECRET}` },
      })
      const res = await GET(req)
      expect(res.status).toBe(200)

      const body = await res.json()
      expect(body.alimtalk.enabled).toBe(false)
      expect(body.alimtalk.dryRun).toBe(true)
      expect(body.alimtalk.missing).toEqual(['SOLAPI_API_SECRET', 'SOLAPI_PF_ID'])
      expect(body.readiness.missing).toContain('SOLAPI_API_SECRET')
      expect(body.readiness.missing).toContain('SOLAPI_PF_ID')
      expect(body.readiness.missing).toContain('SOLAPI_WEBHOOK_SECRET')
    })

    it('guards secrets with canary injection and confirms no leak in status response', async () => {
      const CANARY_CRON_SECRET = 'canary-cron-secret-long-token-99999'
      const CANARY_SOLAPI_KEY = 'canary-solapi-api-key-88888'
      const CANARY_SOLAPI_SECRET = 'canary-solapi-api-secret-77777'
      const CANARY_PF_ID = 'canary-solapi-pf-id-66666'
      const CANARY_WEBHOOK_SECRET = 'canary-solapi-webhook-secret-55555'
      const CANARY_TEMPLATE_ID = 'canary-solapi-tpl-id-44444'

      process.env.CRON_SECRET = CANARY_CRON_SECRET
      process.env.SOLAPI_ENABLED = 'true'
      process.env.SOLAPI_API_KEY = CANARY_SOLAPI_KEY
      process.env.SOLAPI_API_SECRET = CANARY_SOLAPI_SECRET
      process.env.SOLAPI_PF_ID = CANARY_PF_ID
      process.env.SOLAPI_WEBHOOK_SECRET = CANARY_WEBHOOK_SECRET
      process.env.SOLAPI_TEMPLATE_IDS = JSON.stringify({
        SOHEE_BOOKING_CONFIRMED_V1: CANARY_TEMPLATE_ID,
      })

      const req = new Request('http://localhost/api/internal/kakao/status', {
        headers: { authorization: `Bearer ${CANARY_CRON_SECRET}` },
      })
      const res = await GET(req)
      expect(res.status).toBe(200)

      const body = await res.json()
      const serialized = JSON.stringify(body)

      expect(serialized).not.toContain(CANARY_CRON_SECRET)
      expect(serialized).not.toContain(CANARY_SOLAPI_KEY)
      expect(serialized).not.toContain(CANARY_SOLAPI_SECRET)
      expect(serialized).not.toContain(CANARY_PF_ID)
      expect(serialized).not.toContain(CANARY_WEBHOOK_SECRET)
      expect(serialized).not.toContain(CANARY_TEMPLATE_ID)

      // 승인 정보 없는 상태는 approvalVerified: false, deliveryVerified: false
      expect(body.readiness.approvalVerified).toBe(false)
      expect(body.readiness.deliveryVerified).toBe(false)
      expect(body.readiness.unmappedTemplateCodes).not.toContain('SOHEE_BOOKING_CONFIRMED_V1')
      expect(body.readiness.unmappedTemplateCodes).toContain('SOHEE_BOOKING_CHANGED_V1')
    })
  })
})
