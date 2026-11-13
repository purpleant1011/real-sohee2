import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET, POST, dynamic, runtime, setKakaoUnlinkHandlerForTesting, resetKakaoWebhookForTesting } from './route'

describe('/api/webhooks/kakao/unlink route', () => {
  const SECRET = 'test-kakao-webhook-secret-999'
  const originalEnv = process.env.KAKAO_WEBHOOK_SECRET

  beforeEach(() => {
    resetKakaoWebhookForTesting()
    process.env.KAKAO_WEBHOOK_SECRET = SECRET
  })

  afterEach(() => {
    resetKakaoWebhookForTesting()
    if (originalEnv !== undefined) {
      process.env.KAKAO_WEBHOOK_SECRET = originalEnv
    } else {
      delete process.env.KAKAO_WEBHOOK_SECRET
    }
  })

  it('force-dynamic 및 nodejs runtime 설정을 갖는다', () => {
    expect(dynamic).toBe('force-dynamic')
    expect(runtime).toBe('nodejs')
  })

  it('환경변수 미설정 시 503을 반환한다', async () => {
    delete process.env.KAKAO_WEBHOOK_SECRET

    const req = new NextRequest('http://localhost/api/webhooks/kakao/unlink', {
      method: 'POST',
      headers: {
        authorization: `KakaoAK ${SECRET}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        app_id: '123',
        user_id: '456',
        referrer_type: 'UNLINK_FROM_APPS',
      }),
    })

    const res = await POST(req)
    expect(res.status).toBe(503)
    const json = await res.json()
    expect(json.ok).toBe(false)
    expect(json.code).toBe('ENV_NOT_CONFIGURED')
  })

  it('인증 헤더가 없거나 유효하지 않으면 401을 반환한다', async () => {
    const req = new NextRequest('http://localhost/api/webhooks/kakao/unlink', {
      method: 'POST',
      headers: {
        authorization: 'KakaoAK invalid-secret',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        app_id: '123',
        user_id: '456',
        referrer_type: 'UNLINK_FROM_APPS',
      }),
    })

    const res = await POST(req)
    expect(res.status).toBe(401)
    const json = await res.json()
    expect(json.ok).toBe(false)
    expect(json.code).toBe('UNAUTHORIZED')
  })

  it('잘못된 JSON 또는 필수 필드 누락 시 400을 반환한다', async () => {
    const req = new NextRequest('http://localhost/api/webhooks/kakao/unlink', {
      method: 'POST',
      headers: {
        authorization: `KakaoAK ${SECRET}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        app_id: '123',
        // user_id missing
      }),
    })

    const res = await POST(req)
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.ok).toBe(false)
    expect(json.code).toBe('INVALID_PAYLOAD')
  })

  it('유효한 POST 요청 시 onUnlinked 핸들러를 호출하고 200을 반환한다', async () => {
    const mockHandler = vi.fn().mockResolvedValue(undefined)
    setKakaoUnlinkHandlerForTesting(mockHandler)

    const req = new NextRequest('http://localhost/api/webhooks/kakao/unlink', {
      method: 'POST',
      headers: {
        authorization: `KakaoAK ${SECRET}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        app_id: 'app-999',
        user_id: 'user-777',
        referrer_type: 'ACCOUNT_DELETE',
      }),
    })

    const res = await POST(req)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(json.code).toBe('PROCESSED')
    expect(mockHandler).toHaveBeenCalledTimes(1)
    expect(mockHandler).toHaveBeenCalledWith('user-777', {
      appId: 'app-999',
      userId: 'user-777',
      referrerType: 'ACCOUNT_DELETE',
      groupUserToken: undefined,
    })
  })

  it('중복 요청인 경우 200 멱등 응답을 반환하고 핸들러를 재호출하지 않는다', async () => {
    const mockHandler = vi.fn().mockResolvedValue(undefined)
    setKakaoUnlinkHandlerForTesting(mockHandler)

    const createReq = () =>
      new NextRequest('http://localhost/api/webhooks/kakao/unlink', {
        method: 'POST',
        headers: {
          authorization: `KakaoAK ${SECRET}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          app_id: 'app-999',
          user_id: 'user-777',
          referrer_type: 'ACCOUNT_DELETE',
        }),
      })

    const res1 = await POST(createReq())
    expect(res1.status).toBe(200)
    const json1 = await res1.json()
    expect(json1.code).toBe('PROCESSED')
    expect(mockHandler).toHaveBeenCalledTimes(1)

    // Repeat identical request
    const res2 = await POST(createReq())
    expect(res2.status).toBe(200)
    const json2 = await res2.json()
    expect(json2.code).toBe('DUPLICATE_EVENT')
    expect(json2.duplicate).toBe(true)
    expect(mockHandler).toHaveBeenCalledTimes(1)
  })

  it('GET 쿼리 파라미터 요청도 정상 수신하여 200을 반환한다', async () => {
    const mockHandler = vi.fn().mockResolvedValue(undefined)
    setKakaoUnlinkHandlerForTesting(mockHandler)

    const req = new NextRequest(
      'http://localhost/api/webhooks/kakao/unlink?app_id=app-get&user_id=user-get&referrer_type=UNLINK_FROM_ADMIN',
      {
        method: 'GET',
        headers: {
          authorization: `KakaoAK ${SECRET}`,
        },
      },
    )

    const res = await GET(req)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(mockHandler).toHaveBeenCalledTimes(1)
    expect(mockHandler).toHaveBeenCalledWith('user-get', {
      appId: 'app-get',
      userId: 'user-get',
      referrerType: 'UNLINK_FROM_ADMIN',
      groupUserToken: undefined,
    })
  })
})
