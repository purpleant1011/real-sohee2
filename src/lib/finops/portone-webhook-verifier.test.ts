import { describe, expect, it } from 'vitest'
import { WebhookVerificationError } from '@portone/server-sdk/webhook'
import type { Webhook } from '@portone/server-sdk/webhook'
import {
  decideWebhookHandling,
  mapWebhookToOrderEvent,
  verifyPortOneWebhook,
} from './portone-webhook-verifier'

describe('verifyPortOneWebhook', () => {
  const dummySecret = 'whsec_test_secret_12345'
  const dummyPayload = JSON.stringify({
    type: 'Transaction.Paid',
    timestamp: '2026-11-06T04:00:00Z',
    data: {
      paymentId: 'order_123',
      storeId: 'store_test',
      transactionId: 'tx_999',
    },
  })
  const dummyHeaders = {
    'webhook-id': 'evt_msg_123',
    'webhook-timestamp': '1762401600',
    'webhook-signature': 'v1,dummy_sig',
  }

  it('secret이 누락되면 { ok: false, reason: "missing_secret" } 반환', async () => {
    const result = await verifyPortOneWebhook({
      rawBody: dummyPayload,
      headers: dummyHeaders,
      secret: '',
    })

    expect(result).toEqual({ ok: false, reason: 'missing_secret' })
  })

  it('rawBody가 누락되면 { ok: false, reason: "missing_raw_body" } 반환', async () => {
    const result = await verifyPortOneWebhook({
      rawBody: '',
      headers: dummyHeaders,
      secret: dummySecret,
    })

    expect(result).toEqual({ ok: false, reason: 'missing_raw_body' })
  })

  it('headers가 누락되면 { ok: false, reason: "missing_headers" } 반환', async () => {
    const result = await verifyPortOneWebhook({
      rawBody: dummyPayload,
      // @ts-expect-error test invalid header
      headers: null,
      secret: dummySecret,
    })

    expect(result).toEqual({ ok: false, reason: 'missing_headers' })
  })

  it('주입된 verify 함수가 성공하면 { ok: true, webhook, webhookId } 반환', async () => {
    const expectedWebhook: Webhook = {
      type: 'Transaction.Paid',
      timestamp: '2026-11-06T04:00:00Z',
      data: {
        paymentId: 'order_123',
        storeId: 'store_test',
        transactionId: 'tx_999',
      },
    }

    const mockVerify = async () => expectedWebhook

    const result = await verifyPortOneWebhook({
      rawBody: dummyPayload,
      headers: dummyHeaders,
      secret: dummySecret,
      verify: mockVerify,
    })

    expect(result).toEqual({ ok: true, webhook: expectedWebhook, webhookId: 'evt_msg_123' })
  })

  it('headers의 webhook-id 가 대소문자 무시(WEBHOOK-ID, Webhook-Id) 및 배열이어도 올바른 webhookId 추출', async () => {
    const mockVerify = async () => ({
      type: 'Transaction.Paid',
      timestamp: '2026-11-06T04:00:00Z',
      data: { paymentId: 'o1', storeId: 's1', transactionId: 't1' },
    } as Webhook)

    const resultUpper = await verifyPortOneWebhook({
      rawBody: dummyPayload,
      headers: {
        'WEBHOOK-ID': 'evt_upper_1',
        'webhook-timestamp': '1762401600',
        'webhook-signature': 'v1,dummy',
      },
      secret: dummySecret,
      verify: mockVerify,
    })
    expect(resultUpper).toEqual({
      ok: true,
      webhook: expect.any(Object),
      webhookId: 'evt_upper_1',
    })

    const resultArray = await verifyPortOneWebhook({
      rawBody: dummyPayload,
      headers: {
        'Webhook-Id': ['evt_array_1', 'evt_array_2'],
        'webhook-timestamp': '1762401600',
        'webhook-signature': 'v1,dummy',
      },
      secret: dummySecret,
      verify: mockVerify,
    })
    expect(resultArray).toEqual({
      ok: true,
      webhook: expect.any(Object),
      webhookId: 'evt_array_1',
    })
  })

  it('webhook-id 헤더가 누락되거나 비어있으면 { ok: false, reason: "missing_webhook_id" } 반환', async () => {
    const mockVerify = async () => ({
      type: 'Transaction.Paid',
      timestamp: '2026-11-06T04:00:00Z',
      data: { paymentId: 'o1', storeId: 's1', transactionId: 't1' },
    } as Webhook)

    const result = await verifyPortOneWebhook({
      rawBody: dummyPayload,
      headers: {
        'webhook-timestamp': '1762401600',
        'webhook-signature': 'v1,dummy',
      },
      secret: dummySecret,
      verify: mockVerify,
    })

    expect(result).toEqual({ ok: false, reason: 'missing_webhook_id' })
  })

  it('주입된 verify 함수가 WebhookVerificationError(MISSING_REQUIRED_HEADERS)를 던지면 정규화된 reason 반환', async () => {
    const mockVerify = async () => {
      throw new WebhookVerificationError('MISSING_REQUIRED_HEADERS')
    }

    const result = await verifyPortOneWebhook({
      rawBody: dummyPayload,
      headers: { 'webhook-id': 'evt_123' },
      secret: dummySecret,
      verify: mockVerify,
    })

    expect(result).toEqual({ ok: false, reason: 'missing_required_headers' })
  })

  it('주입된 verify 함수가 WebhookVerificationError(NO_MATCHING_SIGNATURE)를 던지면 정규화된 reason 반환', async () => {
    const mockVerify = async () => {
      throw new WebhookVerificationError('NO_MATCHING_SIGNATURE')
    }

    const result = await verifyPortOneWebhook({
      rawBody: dummyPayload,
      headers: dummyHeaders,
      secret: dummySecret,
      verify: mockVerify,
    })

    expect(result).toEqual({ ok: false, reason: 'no_matching_signature' })
  })

  it('원문 에러에 secret이나 민감 정보가 포함되어 있어도 반환값/reason에 노출되지 않음', async () => {
    const sensitiveErrorMsg = `Failed with internal secret ${dummySecret} at db connection`
    const mockVerify = async () => {
      throw new Error(sensitiveErrorMsg)
    }

    const result = await verifyPortOneWebhook({
      rawBody: dummyPayload,
      headers: dummyHeaders,
      secret: dummySecret,
      verify: mockVerify,
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe('verification_failed')
      expect(result.reason).not.toContain(dummySecret)
      expect(result.reason).not.toContain('internal')
    }
  })

  it('기본 verify SDK를 사용할 때 유효하지 않은 서명이면 안전하게 거부', async () => {
    const result = await verifyPortOneWebhook({
      rawBody: dummyPayload,
      headers: dummyHeaders,
      secret: dummySecret,
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect([
        'no_matching_signature',
        'invalid_signature',
        'missing_required_headers',
        'timestamp_too_old',
        'timestamp_too_new',
        'invalid_input',
        'verification_failed',
      ]).toContain(result.reason)
    }
  })
})

describe('decideWebhookHandling', () => {
  it('seenIds에 존재하는 eventId이면 ignore_duplicate를 반환한다', () => {
    const seen = new Set(['evt_001', 'evt_002'])

    const decisionObj = decideWebhookHandling({ providerEventId: 'evt_001' }, seen)
    expect(decisionObj).toEqual({ action: 'ignore_duplicate', eventId: 'evt_001' })

    const decisionStr = decideWebhookHandling('evt_002', seen)
    expect(decisionStr).toEqual({ action: 'ignore_duplicate', eventId: 'evt_002' })
  })

  it('seenIds에 없는 새로운 eventId이면 process를 반환한다', () => {
    const seen = ['evt_001']

    const decision = decideWebhookHandling({ eventId: 'evt_new_999' }, seen)
    expect(decision).toEqual({ action: 'process', eventId: 'evt_new_999' })
  })

  it('webhookId가 있으면 페이로드 id보다 1순위로 사용된다', () => {
    const seen = new Set(['wh_primary'])

    const decision = decideWebhookHandling(
      { webhookId: 'wh_primary', id: 'payload_fallback', eventId: 'evt_fallback' },
      seen
    )
    expect(decision).toEqual({ action: 'ignore_duplicate', eventId: 'wh_primary' })

    const decisionNew = decideWebhookHandling(
      { webhookId: 'wh_new', id: 'wh_primary' },
      seen
    )
    expect(decisionNew).toEqual({ action: 'process', eventId: 'wh_new' })
  })

  it('event 객체에서 webhookId 가 없을 때만 id, eventId, providerEventId 필드를 폴백으로 탐색한다', () => {
    const seen = new Set<string>()

    expect(decideWebhookHandling({ webhookId: 'wh_1' }, seen)).toEqual({
      action: 'process',
      eventId: 'wh_1',
    })
    expect(decideWebhookHandling({ id: 'id_2' }, seen)).toEqual({
      action: 'process',
      eventId: 'id_2',
    })
  })

  it('eventId를 식별할 수 없으면 reject를 반환한다', () => {
    const seen = new Set<string>()

    expect(decideWebhookHandling({}, seen)).toEqual({
      action: 'reject',
      reason: 'missing_event_id',
    })
    expect(decideWebhookHandling('', seen)).toEqual({
      action: 'reject',
      reason: 'missing_event_id',
    })
  })
})

describe('mapWebhookToOrderEvent', () => {
  it('Transaction.Paid 이벤트를 paid 타입으로 변환한다', () => {
    const webhook = {
      type: 'Transaction.Paid' as const,
      timestamp: '2026-11-06T04:00:00Z',
      data: {
        paymentId: 'order_abc',
        storeId: 'store_xyz',
        transactionId: 'tx_123',
      },
    }

    const event = mapWebhookToOrderEvent(webhook)
    expect(event).toEqual({
      type: 'paid',
      paymentId: 'order_abc',
      storeId: 'store_xyz',
      transactionId: 'tx_123',
      cancellationId: undefined,
      timestamp: '2026-11-06T04:00:00Z',
      rawType: 'Transaction.Paid',
    })
  })

  it('Transaction.Cancelled 이벤트를 cancelled 타입으로 변환한다', () => {
    const webhook = {
      type: 'Transaction.Cancelled' as const,
      timestamp: '2026-11-06T05:00:00Z',
      data: {
        paymentId: 'order_abc',
        storeId: 'store_xyz',
        transactionId: 'tx_123',
        cancellationId: 'cn_456',
      },
    }

    const event = mapWebhookToOrderEvent(webhook)
    expect(event).toEqual({
      type: 'cancelled',
      paymentId: 'order_abc',
      storeId: 'store_xyz',
      transactionId: 'tx_123',
      cancellationId: 'cn_456',
      timestamp: '2026-11-06T05:00:00Z',
      rawType: 'Transaction.Cancelled',
    })
  })

  it('Transaction.PartialCancelled 이벤트를 partial_cancelled 타입으로 변환한다', () => {
    const event = mapWebhookToOrderEvent({
      type: 'Transaction.PartialCancelled',
      timestamp: '2026-11-06T06:00:00Z',
      data: {
        paymentId: 'order_abc',
        storeId: 'store_xyz',
        transactionId: 'tx_123',
        cancellationId: 'cn_partial_1',
      },
    })

    expect(event).toEqual({
      type: 'partial_cancelled',
      paymentId: 'order_abc',
      storeId: 'store_xyz',
      transactionId: 'tx_123',
      cancellationId: 'cn_partial_1',
      timestamp: '2026-11-06T06:00:00Z',
      rawType: 'Transaction.PartialCancelled',
    })
  })

  it('Transaction.Failed 이벤트를 failed 타입으로 변환한다', () => {
    const event = mapWebhookToOrderEvent({
      type: 'Transaction.Failed',
      timestamp: '2026-11-06T07:00:00Z',
      data: {
        paymentId: 'order_abc',
        storeId: 'store_xyz',
        transactionId: 'tx_123',
      },
    })

    expect(event).toEqual({
      type: 'failed',
      paymentId: 'order_abc',
      storeId: 'store_xyz',
      transactionId: 'tx_123',
      cancellationId: undefined,
      timestamp: '2026-11-06T07:00:00Z',
      rawType: 'Transaction.Failed',
    })
  })

  it('문자열 타입만 전달해도 기본 OrderTransitionEvent 형태로 변환한다', () => {
    expect(mapWebhookToOrderEvent('Transaction.Paid')).toEqual({
      type: 'paid',
      paymentId: undefined,
      storeId: undefined,
      transactionId: undefined,
      cancellationId: undefined,
      timestamp: undefined,
      rawType: 'Transaction.Paid',
    })

    expect(mapWebhookToOrderEvent('paid')).toEqual({
      type: 'paid',
      paymentId: undefined,
      storeId: undefined,
      transactionId: undefined,
      cancellationId: undefined,
      timestamp: undefined,
      rawType: 'paid',
    })
  })

  it('지원하지 않거나 알 수 없는 웹훅 타입은 null을 반환한다', () => {
    expect(mapWebhookToOrderEvent('Transaction.Ready')).toBeNull()
    expect(mapWebhookToOrderEvent({ type: 'BillingKey.Issued', timestamp: '', data: {} as any })).toBeNull()
    expect(mapWebhookToOrderEvent(null as any)).toBeNull()
    expect(mapWebhookToOrderEvent(undefined as any)).toBeNull()
  })
})
