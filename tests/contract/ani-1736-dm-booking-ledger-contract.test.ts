import { describe, it, expect, vi } from 'vitest'
import { readMobileInbox } from '@/features/mobile-inbox/server/read-inbox'
import { isRecoveryIntent } from '@/features/booking-recovery/conversation-adapter'
import {
  classifyAcceptance,
  projectInboundMessageToRecovery,
} from '@/features/booking-recovery/inbound-projector'
import {
  entryDisplay,
  findConflicts,
  groupByDay,
  isMismatch,
  type LedgerEntryDto,
} from '@/features/mobile-inbox/ledger-model'
import {
  LEDGER_FRESHNESS_TTL_MS,
  resolveLedgerFreshness,
  toLedgerFreshnessView,
} from '@/features/booking-recovery/ledger-freshness-view'
import { calculateRecoveryOutcome, type RecoveryEventRecord } from '@/features/booking-recovery/outcomes'
import type { DatasetMode } from '@/features/mobile-decision/contracts'

/**
 * ANI-1736: DM 수신 → 예약 문의 분류 → 장부 반영 계약.
 *
 * 범위는 테스트뿐이다. 제품 코드(mobile-inbox 장부·채팅·예약)는 다른 창이 작업 중이라 건드리지 않는다.
 * 각 단계는 실제 모듈을 그대로 호출하고, 외부 경계(Supabase·Provider)만 가짜로 세운다.
 *
 * 실 Provider 구간(실제 Instagram DM 발송/readback, 실 예약표 readback)은 이 창에서 열 수 없다.
 * 아래 마지막 describe 의 todo 로만 남긴다 — skip/todo 는 통과가 아니다.
 */

const WS = '11111111-1111-4111-8111-111111111111'
const NOW = '2026-10-24T10:01:00.000Z'

function dmRow(over: Record<string, unknown> = {}) {
  return {
    id: '55555555-5555-4555-8555-555555555555',
    workspaceId: WS,
    channel: 'instagram_dm',
    customerName: '김고객',
    consent: 'granted',
    status: 'needs_reply',
    unread: true,
    lastMessage: {
      text: '예약 문의드려요',
      receivedAt: '2026-10-24T10:00:00.000Z',
      fromCustomer: true,
    },
    draft: null,
    sendBlockers: [],
    ...over,
  }
}

function inboxDeps(over: {
  rows?: unknown[]
  complete?: boolean
  observedAt?: string
  datasetMode?: DatasetMode
} = {}) {
  return {
    now: () => NOW,
    readThreads: async () => ({
      rows: over.rows ?? [dmRow()],
      complete: over.complete ?? true,
      observedAt: over.observedAt ?? '2026-10-24T10:00:30.000Z',
      datasetMode: over.datasetMode ?? 'ACTUAL',
    }),
  }
}

describe('1단계 · DM 수신 계약 (소통함 읽기 모델)', () => {
  it('고객 DM 한 건이 같은 가게 소통함 항목으로 들어오고, 고객 발화로 표시된다', async () => {
    const result = await readMobileInbox({ workspaceId: WS, userId: 'u1' }, inboxDeps())

    expect(result.ok).toBe(true)
    expect(result.datasetMode).toBe('ACTUAL')
    expect(result.rejectedRows).toBe(0)
    expect(result.snapshot.loadState).toBe('ready')
    expect(result.snapshot.complete).toBe(true)
    expect(result.snapshot.threads).toHaveLength(1)
    expect(result.snapshot.threads[0]).toMatchObject({
      workspaceId: WS,
      channel: 'instagram_dm',
      customerName: '김고객',
      lastMessage: { text: '예약 문의드려요', fromCustomer: true },
    })
  })

  it('ACTUAL 이 아닌 데이터가 오면 목록을 만들지 않는다 (fail-closed)', async () => {
    for (const datasetMode of ['DEMO', 'TEST', 'UNKNOWN'] as const) {
      const result = await readMobileInbox(
        { workspaceId: WS, userId: 'u1' },
        inboxDeps({ datasetMode }),
      )
      expect(result.ok).toBe(false)
      expect(result.snapshot.loadState).toBe('error')
      expect(result.snapshot.threads).toHaveLength(0)
    }
  })

  it('다른 가게 행은 잘라내고 complete=false 로 알린다 (빈 목록으로 단정하지 않음)', async () => {
    const result = await readMobileInbox(
      { workspaceId: WS, userId: 'u1' },
      inboxDeps({
        rows: [
          dmRow(),
          dmRow({ id: 'other-thread', workspaceId: '22222222-2222-4222-8222-222222222222' }),
        ],
      }),
    )

    expect(result.ok).toBe(true)
    expect(result.snapshot.threads).toHaveLength(1)
    expect(result.snapshot.threads[0].workspaceId).toBe(WS)
    expect(result.rejectedRows).toBe(1)
    expect(result.snapshot.complete).toBe(false)
  })

  it('스키마를 벗어난 행은 버리고 complete=false 로 알린다', async () => {
    const result = await readMobileInbox(
      { workspaceId: WS, userId: 'u1' },
      inboxDeps({ rows: [dmRow(), dmRow({ id: 'bad', status: 'made_up' })] }),
    )
    expect(result.snapshot.threads).toHaveLength(1)
    expect(result.snapshot.complete).toBe(false)
  })

  it('조회 실패는 빈 목록이 아니라 error 다', async () => {
    const result = await readMobileInbox(
      { workspaceId: WS, userId: 'u1' },
      {
        now: () => NOW,
        readThreads: async () => {
          throw new Error('provider down')
        },
      },
    )
    expect(result.ok).toBe(false)
    expect(result.snapshot.loadState).toBe('error')
    expect(result.snapshot.checkedAt).toBeNull()
  })

  it('읽은 지 오래된 목록은 ready 가 아니라 stale 이다', async () => {
    const result = await readMobileInbox(
      { workspaceId: WS, userId: 'u1' },
      inboxDeps({ observedAt: '2026-10-24T09:30:00.000Z' }),
    )
    expect(result.ok).toBe(true)
    expect(result.snapshot.loadState).toBe('stale')
    expect(result.snapshot.checkedAt).toBe('2026-10-24T09:30:00.000Z')
  })
})

describe('2단계 · 예약 문의 분류 계약', () => {
  const singleSlot = {
    customerRef: 'cust_1',
    sentAt: '2026-10-16T01:00:00Z',
    serviceName: '맞춤 펌',
    slots: [{ id: 's1', label: '목요일 16시', startsAt: '2026-10-22T16:00:00+09:00' }],
  }
  const multiSlot = {
    ...singleSlot,
    slots: [
      { id: 's1', label: '목요일 16시', startsAt: '2026-10-22T16:00:00+09:00' },
      { id: 's2', label: '금요일 14시', startsAt: '2026-10-23T14:00:00+09:00' },
    ],
  }
  const inbound = (text: string, over: Partial<{ customerRef: string; senderType: 'customer' | 'business'; sentAt: string }> = {}) => ({
    id: 'm2',
    customerRef: over.customerRef ?? 'cust_1',
    senderType: over.senderType ?? ('customer' as const),
    text,
    sentAt: over.sentAt ?? '2026-10-16T02:00:00Z',
  })

  it('예약 문의로 인식하되 마케팅 글 생성 요청은 가로채지 않는다', () => {
    expect(isRecoveryIntent('예약 문의 챙겨줘')).toBe(true)
    expect(isRecoveryIntent('DM 문의 확인해줘')).toBe(true)
    expect(isRecoveryIntent('인스타 글 써줘')).toBe(false)
    expect(isRecoveryIntent('카드뉴스 만들어줘')).toBe(false)
    // 명령만으로는 예약 실행이 아니다 — 복구 의도로 분류되지 않는다.
    expect(isRecoveryIntent('예약해줘')).toBe(false)
  })

  it('명시적으로 날짜·시각을 고른 고객 수락만 accepted 로 분류된다', () => {
    expect(classifyAcceptance({ message: inbound('금요일 14시로 진행할게요'), proposal: multiSlot }))
      .toMatchObject({ kind: 'accepted', slotId: 's2' })
    expect(classifyAcceptance({ message: inbound('네 그 시간으로 예약해 주세요!'), proposal: singleSlot }))
      .toMatchObject({ kind: 'accepted', slotId: 's1' })
  })

  it('어느 슬롯인지 모르는 "네"는 추측하지 않고 확인 대기로 보낸다', () => {
    expect(classifyAcceptance({ message: inbound('네'), proposal: multiSlot }))
      .toMatchObject({ kind: 'needs_review' })
  })

  it('질문·거절·조건 변경은 수락으로 처리하지 않는다', () => {
    for (const text of ['예약 안 할게요', '그 시간은 불가능해요', '가격이 얼마죠?', '다른 시간으로 할게요']) {
      expect(classifyAcceptance({ message: inbound(text), proposal: singleSlot }).kind)
        .not.toBe('accepted')
    }
  })

  it('발신자가 고객이 아니거나 다른 고객이거나 제안보다 과거면 근거가 아니다 (ignored)', () => {
    expect(classifyAcceptance({
      message: inbound('목요일 16시로 할게요', { senderType: 'business' }),
      proposal: singleSlot,
    }).kind).toBe('ignored')
    expect(classifyAcceptance({
      message: inbound('목요일 16시로 할게요', { customerRef: 'cust_other' }),
      proposal: singleSlot,
    }).kind).toBe('ignored')
    expect(classifyAcceptance({
      message: inbound('목요일 16시로 할게요', { sentAt: '2026-10-16T00:50:00Z' }),
      proposal: singleSlot,
    }).kind).toBe('ignored')
  })

  describe('수신 메시지를 복구 케이스로 투영할 때', () => {
    const FINGERPRINT = 'a'.repeat(64)

    function projectorClient(options: {
      withSendEvidence: boolean
      rpcError?: { code: string } | null
      text?: string
    }) {
      const rpc = vi.fn().mockResolvedValue({ data: null, error: options.rpcError ?? null })
      const upsert = vi.fn().mockResolvedValue({ data: null, error: null })
      const from = vi.fn((table: string) => {
        const chain = {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          in: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn(),
        }
        if (table === 'booking_recovery_cases') {
          chain.maybeSingle.mockResolvedValue({
            data: {
              id: 'case_1',
              workspace_id: 'ws_1',
              source_thread_id: 'th_1',
              customer_ref: 'cust_1',
              stage: 'AWAITING_CUSTOMER',
              version: 2,
            },
            error: null,
          })
        } else if (table === 'booking_recovery_proposals') {
          chain.maybeSingle.mockResolvedValue({
            data: {
              workspace_id: 'ws_1',
              case_id: 'case_1',
              payload_fingerprint: FINGERPRINT,
              revision: 1,
              slot_id: 's1',
              service_name: '맞춤 펌',
              starts_at: '2026-10-22T16:00:00+09:00',
              timezone: 'Asia/Seoul',
            },
            error: null,
          })
        } else if (table === 'booking_recovery_steps') {
          chain.maybeSingle.mockResolvedValue({
            data: options.withSendEvidence
              ? {
                  workspace_id: 'ws_1',
                  case_id: 'case_1',
                  actor_id: 'owner_1',
                  provider_message_id: 'provider_1',
                  input_fingerprint: FINGERPRINT,
                  occurred_at: '2026-10-16T01:10:00Z',
                  evidence_ref: JSON.stringify({
                    schemaVersion: 1,
                    channel: 'instagram',
                    providerMessageId: 'provider_1',
                    payloadFingerprint: FINGERPRINT,
                    senderId: 'business_1',
                    recipientRef: 'cust_1',
                    requestedAt: '2026-10-16T01:09:00Z',
                    observedAt: '2026-10-16T01:10:00Z',
                  }),
                }
              : null,
            error: null,
          })
        } else if (table === 'booking_recovery_outbox') {
          return { upsert }
        }
        return chain
      })
      return { client: { from, rpc } as any, rpc, upsert }
    }

    const msg = (text: string, over: Partial<{ sender_type: string; sender_id: string }> = {}) => ({
      id: 'msg_accept_1',
      sender_type: over.sender_type ?? 'customer',
      sender_id: over.sender_id ?? 'cust_1',
      text,
      sent_at: '2026-10-16T01:20:00Z',
    })

    it('검증된 발송 증거 + 명시 수락이면 CUSTOMER_ACCEPTED 로 전이하고 outbox 를 남긴다', async () => {
      const { client, rpc, upsert } = projectorClient({ withSendEvidence: true })
      await projectInboundMessageToRecovery(client, {
        workspaceId: 'ws_1',
        threadId: 'th_1',
        message: msg('네 그 시간으로 예약해 주세요!'),
      })

      expect(rpc).toHaveBeenCalledWith(
        'transition_booking_recovery',
        expect.objectContaining({
          p_next_stage: 'CUSTOMER_ACCEPTED',
          p_evidence_ref: 'msg_accept_1',
          p_idempotency_key: 'acceptance:msg_accept_1',
        }),
      )
      expect(upsert).toHaveBeenCalledTimes(1)
    })

    it('검증된 발송 증거가 없으면 DM 수신만으로 케이스를 전이하지 않는다', async () => {
      const { client, rpc, upsert } = projectorClient({ withSendEvidence: false })
      await projectInboundMessageToRecovery(client, {
        workspaceId: 'ws_1',
        threadId: 'th_1',
        message: msg('네 그 시간으로 예약해 주세요!'),
      })
      expect(rpc).not.toHaveBeenCalled()
      expect(upsert).not.toHaveBeenCalled()
    })

    it('수락이 아닌 문의(질문·거절)는 확정 대신 사람 확인 단계로 보낸다', async () => {
      const { client, rpc, upsert } = projectorClient({ withSendEvidence: true })
      await projectInboundMessageToRecovery(client, {
        workspaceId: 'ws_1',
        threadId: 'th_1',
        message: msg('가격이 얼마인가요?'),
      })
      expect(rpc).toHaveBeenCalledWith(
        'transition_booking_recovery',
        expect.objectContaining({ p_next_stage: 'HUMAN_REVIEW', p_evidence_ref: null }),
      )
      expect(upsert).not.toHaveBeenCalled()
    })

    it('사장님(비즈니스) 발화 에코는 수락 증거가 아니다', async () => {
      const { client, rpc } = projectorClient({ withSendEvidence: true })
      await projectInboundMessageToRecovery(client, {
        workspaceId: 'ws_1',
        threadId: 'th_1',
        message: msg('네 10시로 예약해 주세요', { sender_type: 'business' }),
      })
      expect(rpc).not.toHaveBeenCalled()
    })

    it('같은 수락 메시지가 중복 도착해도 outbox 를 다시 만들지 않는다 (멱등)', async () => {
      const { client, rpc, upsert } = projectorClient({
        withSendEvidence: true,
        rpcError: { code: '23505' },
      })
      await projectInboundMessageToRecovery(client, {
        workspaceId: 'ws_1',
        threadId: 'th_1',
        message: msg('네 그 시간으로 예약해 주세요!'),
      })
      expect(rpc).toHaveBeenCalledTimes(1)
      expect(upsert).not.toHaveBeenCalled()
    })
  })
})

describe('3단계 · 장부 반영 계약', () => {
  const entry = (over: Partial<LedgerEntryDto> = {}): LedgerEntryDto => ({
    id: 'bk_1',
    workspaceId: WS,
    customerName: '김고객',
    serviceLabel: '맞춤 펌',
    startsAt: '2026-10-24T11:00:00+09:00',
    endsAt: '2026-10-24T13:00:00+09:00',
    status: 'confirmed',
    source: 'customer_accepted',
    ledgerVerifiedAt: '2026-10-24T09:00:00.000Z',
    otherSurfaceStatus: null,
    ...over,
  })

  it('고객 수락 + 예약표 readback 이 있을 때만 "확정"으로 그린다', () => {
    expect(entryDisplay(entry())).toBe('confirmed')
    // readback 시각이 없으면 확정으로 그리지 않는다.
    expect(entryDisplay(entry({ ledgerVerifiedAt: null }))).toBe('unverified')
    // 근거가 unverified 면 시각이 있어도 확정이 아니다.
    expect(entryDisplay(entry({ source: 'unverified' }))).toBe('unverified')
    expect(entryDisplay(entry({ status: 'pending_confirmation' }))).toBe('pending')
    expect(entryDisplay(entry({ status: 'completed' }))).toBe('completed')
    expect(entryDisplay(entry({ status: 'cancelled' }))).toBe('cancelled')
  })

  it('같은 가게의 겹치는 유효 예약만 충돌로 표시하고, 취소·다른 가게는 제외한다', () => {
    const conflictIds = findConflicts(
      [
        entry({ id: 'a' }),
        entry({ id: 'b', startsAt: '2026-10-24T12:00:00+09:00', endsAt: '2026-10-24T14:00:00+09:00' }),
        entry({ id: 'cancelled', status: 'cancelled', startsAt: '2026-10-24T12:00:00+09:00' }),
        entry({ id: 'other-ws', workspaceId: '22222222-2222-4222-8222-222222222222' }),
      ],
      WS,
    )
    expect([...conflictIds].sort()).toEqual(['a', 'b'])
  })

  it('날짜별 묶음은 가게 경계를 지키고, 시각을 읽을 수 없는 예약을 숨기지 않는다', () => {
    const { days, unreadable } = groupByDay(
      [
        entry({ id: 'today' }),
        entry({ id: 'broken-time', startsAt: 'not-a-date' }),
        entry({ id: 'other-ws', workspaceId: '22222222-2222-4222-8222-222222222222' }),
      ],
      WS,
      'Asia/Seoul',
      '2026-10-24',
      '2026-10-24',
    )
    expect(days.flatMap(day => day.entries.map(e => e.id))).toEqual(['today'])
    expect(unreadable.map(e => e.id)).toEqual(['broken-time'])
  })

  it('PC 화면과 상태가 다르면 불일치로 표시한다', () => {
    expect(isMismatch(entry({ otherSurfaceStatus: 'cancelled' }))).toBe(true)
    expect(isMismatch(entry({ otherSurfaceStatus: 'confirmed' }))).toBe(false)
    expect(isMismatch(entry({ otherSurfaceStatus: null }))).toBe(false)
  })

  it('장부 확인 전·오래됨은 "확인 필요"이고 예약 가능으로 표시되지 않는다', () => {
    const never = resolveLedgerFreshness({ hasExternalLedgerConnection: false, lastConfirmedAt: null })
    expect(never.freshness).toBe('NOT_OBSERVED')
    expect(never.requiresOwnerConfirmation).toBe(true)
    expect(toLedgerFreshnessView({ freshness: never.freshness }).headline).toBe('확인 필요')

    const stale = resolveLedgerFreshness({
      hasExternalLedgerConnection: true,
      lastConfirmedAt: new Date(Date.parse(NOW) - LEDGER_FRESHNESS_TTL_MS - 1000).toISOString(),
      now: NOW,
    })
    expect(stale.freshness).toBe('STALE')
    expect(stale.requiresOwnerConfirmation).toBe(true)

    const current = resolveLedgerFreshness({
      hasExternalLedgerConnection: true,
      lastConfirmedAt: '2026-10-24T10:00:00.000Z',
      now: NOW,
    })
    expect(current.freshness).toBe('CURRENT')
    expect(current.requiresOwnerConfirmation).toBe(false)
    expect(toLedgerFreshnessView({ freshness: current.freshness }).headline).not.toBe('확인 필요')
  })

  it('예약 확정 집계는 중복 이벤트를 한 건으로 세고, 비ACTUAL 증거와 지어낸 매출을 쓰지 않는다', () => {
    const events: RecoveryEventRecord[] = [
      {
        id: 'e1', workspaceId: WS, caseId: 'case_1', eventType: 'BOOKING_CONFIRMED',
        reservationId: 'bk_1', amountKrw: 30000, occurredAt: '2026-10-24T10:00:00Z', isActual: true,
      },
      {
        // 같은 예약이 재수집된 중복 이벤트 — 두 번 세지 않는다.
        id: 'e2', workspaceId: WS, caseId: 'case_1', eventType: 'BOOKING_CONFIRMED',
        reservationId: 'bk_1', amountKrw: 30000, occurredAt: '2026-10-24T10:00:05Z', isActual: true,
      },
      {
        // 시연/테스트 증거 — ACTUAL 집계에서 제외한다.
        id: 'e3', workspaceId: WS, caseId: 'case_2', eventType: 'BOOKING_CONFIRMED',
        reservationId: 'bk_demo', amountKrw: 120000, occurredAt: '2026-10-24T10:00:10Z', isActual: false,
      },
      {
        id: 'e4', workspaceId: WS, caseId: 'case_1', eventType: 'BOOKING_CANCELLED',
        reservationId: 'bk_1', amountKrw: null, occurredAt: '2026-10-24T10:00:20Z', isActual: true,
      },
    ]

    const outcome = calculateRecoveryOutcome(events, { requireActual: true })
    expect(outcome.confirmedBookings).toBe(1)
    expect(outcome.activeConfirmedBookings).toBe(0)
    expect(outcome.cancelledBookings).toBe(1)
    // 결제 관측이 없으므로 매출은 지어내지 않는다.
    expect(outcome.revenue).toEqual({ status: 'NOT_OBSERVED', amountKrw: null })
  })
})

describe('실 Provider 구간 — blocked: 실계정 필요', () => {
  // 통과가 아니다. 실제 계정·실 Provider 승인 없이는 이 창에서 열 수 없다.
  it.todo('blocked: 실계정 필요 — Instagram DM 실제 발송 + provider readback')
  it.todo('blocked: 실계정 필요 — 실 예약표(외부 장부) readback 과 내부 장부 same-truth')
})
