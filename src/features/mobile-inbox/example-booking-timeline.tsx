'use client'

import type { RecoveryView } from '@/features/booking-recovery/contracts'
import { MobileAppShell, ShellScreen } from '@/features/mobile-shell'
import { BookingTimelineBody, bookingTimelineScreenConfig } from './booking-timeline-view'
import { recoveryTimeline } from './recovery-timeline-model'

/**
 * M14 예약 문의 타임라인의 예시 마운트(프로토타입용).
 *
 * 실화면과 같은 어댑터(`recoveryTimeline`)를 쓴다. 예시 값이지만 수락 시각은 서버 계약의
 * `acceptance`(확인된 인바운드 메시지) 자리에만 넣었고, 확인 시각(`checkedAt`)은 넘기지 않는다.
 * 예시 화면에 '서버 확인' 시각을 지어내지 않기 위해서다. 조회·전송 요청은 하지 않는다(fetch 없음).
 */
export function ExampleBookingTimelineScreen() {
  const { mode, title } = bookingTimelineScreenConfig()
  return (
    <MobileAppShell>
      <ShellScreen mode={mode} title={title} backHref="/dev/mobile-r2">
        {/* 본문(BookingTimelineBody)과 같은 폭 제한을 써서 데스크톱에서 안내문만 넓어지지 않게 한다. */}
        <div data-example-booking-timeline className="mx-auto w-full max-w-2xl space-y-4">
          <p
            data-example-notice
            className="rounded-xl bg-muted/40 px-3 py-2 text-sm leading-relaxed text-muted-foreground"
          >
            예시 화면이에요. 실제 문의가 아니라 화면 모양을 보여드리는 내용이고, 고객에게 보내거나
            예약을 확정하지 않아요.
          </p>
          <BookingTimelineBody
            inquiryId={EXAMPLE_VIEW.caseId}
            timeline={recoveryTimeline(EXAMPLE_VIEW)}
            customerName="김예시"
            inquiryText="안녕하세요, 이번 주 금요일 오후에 속눈썹펌 가능할까요?"
            stateChip={null}
            checkedAt={null}
          />
        </div>
      </ShellScreen>
    </MobileAppShell>
  )
}

/** 고객이 제안 시간을 수락한 직후(예약표 반영 전) 상태. */
const EXAMPLE_VIEW: RecoveryView = {
  caseId: '11111111-1111-4111-8111-111111111111',
  missionId: '33333333-3333-4333-8333-333333333333',
  version: 2,
  stage: 'CUSTOMER_ACCEPTED',
  statusLabel: '고객 수락 확인',
  sourceThreadId: '22222222-2222-4222-8222-222222222222',
  sourceInboundMessageId: '44444444-4444-4444-8444-444444444444',
  observedAt: '2026-10-23T05:00:00.000Z',
  reply: { text: '금요일 오후 3시 어떠세요?', fingerprint: 'a'.repeat(64) },
  offer: {
    slotId: '55555555-5555-4555-8555-555555555555',
    serviceId: '66666666-6666-4666-8666-666666666666',
    serviceName: '속눈썹펌',
    startsAt: '2026-10-24T06:00:00.000Z',
    endsAt: '2026-10-24T07:00:00.000Z',
    timezone: 'Asia/Seoul',
    totalAmountKrw: 80000,
    depositKrw: 0,
    validUntil: '2026-10-24T05:00:00.000Z',
    proposalRevision: 1,
  },
  acceptance: {
    inboundMessageId: '77777777-7777-4777-8777-777777777777',
    receivedAt: '2026-10-23T05:00:00.000Z',
  },
  approval: { kind: 'send', fingerprint: 'a'.repeat(64) },
  proposal: null,
  booking: null,
  nextAction: 'approve_booking',
  revenue: { status: 'NOT_OBSERVED', amountKrw: null },
}
