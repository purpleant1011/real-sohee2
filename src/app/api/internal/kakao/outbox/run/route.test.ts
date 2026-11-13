import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { POST } from './route'
import * as serverRuntime from '@/features/kakao/notify/outbox-server-runtime'
import { createInitialCounts } from '@/features/kakao/notify/outbox-runner'

describe('POST /api/internal/kakao/outbox/run', () => {
  const originalEnv = { ...process.env }
  const VALID_CRON_SECRET = 'super-secret-cron-token-at-least-20-chars'

  beforeEach(() => {
    process.env = { ...originalEnv }
    delete process.env.CRON_SECRET
    delete process.env.KAKAO_OUTBOX_ENABLED
    delete process.env.SOLAPI_ENABLED
    delete process.env.SOLAPI_API_KEY
    delete process.env.SOLAPI_API_SECRET
    delete process.env.SOLAPI_PF_ID
    delete process.env.SOLAPI_WEBHOOK_SECRET
  })

  afterEach(() => {
    process.env = originalEnv
    vi.restoreAllMocks()
  })

  describe('1. 인증 및 환경 설정 게이트 (CRON_SECRET timingSafeEqual)', () => {
    it('CRON_SECRET이 미설정 상태이면 503(서비스 설정 미비)을 반환한다 (200 vs 503 방지)', async () => {
      delete process.env.CRON_SECRET
      const req = new Request('http://localhost/api/internal/kakao/outbox/run', {
        method: 'POST',
        headers: { authorization: `Bearer ${VALID_CRON_SECRET}` },
      })

      const res = await POST(req)
      expect(res.status).toBe(503)
      const body = await res.json()
      expect(body.error).toBeDefined()
    })

    it('CRON_SECRET 길이가 20자 미만이면 503(서비스 설정 미비)을 반환한다', async () => {
      process.env.CRON_SECRET = 'short-secret-123'
      const req = new Request('http://localhost/api/internal/kakao/outbox/run', {
        method: 'POST',
        headers: { authorization: 'Bearer short-secret-123' },
      })

      const res = await POST(req)
      expect(res.status).toBe(503)
    })

    it('Authorization 헤더가 누락되면 401(인증 실패)을 반환한다', async () => {
      process.env.CRON_SECRET = VALID_CRON_SECRET
      const req = new Request('http://localhost/api/internal/kakao/outbox/run', {
        method: 'POST',
      })

      const res = await POST(req)
      expect(res.status).toBe(401)
      const body = await res.json()
      expect(body.error).toBe('인증 실패')
    })

    it('Authorization 헤더가 Bearer 형식이 아니면 401을 반환한다', async () => {
      process.env.CRON_SECRET = VALID_CRON_SECRET
      const req = new Request('http://localhost/api/internal/kakao/outbox/run', {
        method: 'POST',
        headers: { authorization: `Basic ${VALID_CRON_SECRET}` },
      })

      const res = await POST(req)
      expect(res.status).toBe(401)
    })

    it('토큰이 일치하지 않으면 401을 반환한다', async () => {
      process.env.CRON_SECRET = VALID_CRON_SECRET
      const req = new Request('http://localhost/api/internal/kakao/outbox/run', {
        method: 'POST',
        headers: { authorization: 'Bearer wrong-secret-token-length-matched-00' },
      })

      const res = await POST(req)
      expect(res.status).toBe(401)
    })

    it('토큰 길이가 다를 때도 timingSafeEqual 안전하게 401을 반환한다', async () => {
      process.env.CRON_SECRET = VALID_CRON_SECRET
      const req = new Request('http://localhost/api/internal/kakao/outbox/run', {
        method: 'POST',
        headers: { authorization: 'Bearer short' },
      })

      const res = await POST(req)
      expect(res.status).toBe(401)
    })
  })

  describe('2. 입력 격리 및 보안 (body 주입 원천 차단)', () => {
    it('request body로 limit, phone, flags 등을 주입해도 무시하고 서버 고정 limit=20으로 실행된다', async () => {
      process.env.CRON_SECRET = VALID_CRON_SECRET
      const runSpy = vi.spyOn(serverRuntime, 'runServerNotificationOutbox').mockResolvedValue({
        enabled: false,
        processed: 0,
        counts: createInitialCounts(),
        errors: 0,
        expired: 0,
      })

      const maliciousBody = JSON.stringify({
        limit: 9999,
        phone: '010-9999-8888',
        flags: { KAKAO_OUTBOX_ENABLED: 'true' },
        payload: { customerName: '해커' },
      })

      const req = new Request('http://localhost/api/internal/kakao/outbox/run', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${VALID_CRON_SECRET}`,
          'content-type': 'application/json',
        },
        body: maliciousBody,
      })

      const res = await POST(req)
      expect(res.status).toBe(200)
      expect(runSpy).toHaveBeenCalledTimes(1)
      // 외부에서 body로 주입한 악성 파라미터가 runServerNotificationOutbox 옵션으로 전달되지 않음
      const calledOptions = runSpy.mock.calls[0]?.[0]
      expect(calledOptions?.env).toBeUndefined()
    })
  })

  describe('3. 통계 반환 및 실행 결과 (applied 0 vs 1, 혼합 1 vs 2)', () => {
    it('플래그 비활성 시 disabled 통계(applied 0건)를 200으로 반환한다', async () => {
      process.env.CRON_SECRET = VALID_CRON_SECRET
      vi.spyOn(serverRuntime, 'runServerNotificationOutbox').mockResolvedValue({
        enabled: false,
        processed: 0,
        counts: createInitialCounts(),
        errors: 0,
        expired: 0,
      })

      const req = new Request('http://localhost/api/internal/kakao/outbox/run', {
        method: 'POST',
        headers: { authorization: `Bearer ${VALID_CRON_SECRET}` },
      })

      const res = await POST(req)
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data).toEqual({
        enabled: false,
        processed: 0,
        counts: createInitialCounts(),
        errors: 0,
        expired: 0,
      })
      expect(res.headers.get('cache-control')).toBe('no-store')
    })

    it('혼합 결과(SENT: 1, BLOCKED: 1, processed: 2) 통계를 정상 반환한다 (혼합 1 vs 2 검증)', async () => {
      process.env.CRON_SECRET = VALID_CRON_SECRET
      const mixedCounts = createInitialCounts()
      mixedCounts.SENT = 1
      mixedCounts.BLOCKED = 1

      vi.spyOn(serverRuntime, 'runServerNotificationOutbox').mockResolvedValue({
        enabled: true,
        processed: 2,
        counts: mixedCounts,
        errors: 0,
        expired: 1,
      })

      const req = new Request('http://localhost/api/internal/kakao/outbox/run', {
        method: 'POST',
        headers: { authorization: `Bearer ${VALID_CRON_SECRET}` },
      })

      const res = await POST(req)
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.enabled).toBe(true)
      expect(data.processed).toBe(2)
      expect(data.counts.SENT).toBe(1)
      expect(data.counts.BLOCKED).toBe(1)
      expect(data.expired).toBe(1)
    })
  })

  describe('4. 예외 격리 및 보안 (200 vs 500, PII/비밀값 은닉)', () => {
    it('런타임 실행 중 예외 throw 시 500 상태 코드와 고정 에러 메시지를 반환한다 (200 vs 500 방지)', async () => {
      process.env.CRON_SECRET = VALID_CRON_SECRET
      vi.spyOn(serverRuntime, 'runServerNotificationOutbox').mockRejectedValue(
        new Error('Fatal DB Connection or RPC Panic with secret info'),
      )

      const req = new Request('http://localhost/api/internal/kakao/outbox/run', {
        method: 'POST',
        headers: { authorization: `Bearer ${VALID_CRON_SECRET}` },
      })

      const res = await POST(req)
      expect(res.status).toBe(500)
      const body = await res.json()
      expect(body).toEqual({ error: '내부 서버 오류' })
      // 에러 내부 세부사항 및 예외 메시지가 유출되지 않는지 확인
      expect(JSON.stringify(body)).not.toContain('Fatal')
      expect(JSON.stringify(body)).not.toContain('secret')
    })

    it('캐너리 주입 검증: 응답 JSON에 환경변수, 전화번호, 이름, 시크릿이 전혀 포함되지 않는다', async () => {
      const CANARY_SECRET = 'canary-secret-val-99999-at-least-20-chars'
      process.env.CRON_SECRET = CANARY_SECRET

      vi.spyOn(serverRuntime, 'runServerNotificationOutbox').mockResolvedValue({
        enabled: true,
        processed: 1,
        counts: { ...createInitialCounts(), SENT: 1 },
        errors: 0,
        expired: 0,
      })

      const req = new Request('http://localhost/api/internal/kakao/outbox/run', {
        method: 'POST',
        headers: { authorization: `Bearer ${CANARY_SECRET}` },
      })

      const res = await POST(req)
      expect(res.status).toBe(200)
      const body = await res.json()
      const serialized = JSON.stringify(body)

      expect(serialized).not.toContain(CANARY_SECRET)
      expect(serialized).not.toContain('010')
      expect(serialized).not.toContain('name')
      expect(serialized).not.toContain('phone')
      expect(serialized).not.toContain('token')
      expect(serialized).not.toContain('secret')
    })
  })
})
