import { createHash } from 'node:crypto'
import { z } from 'zod'

const ref = z.string().trim().min(1).max(200)
const text = z.string().trim().min(1).max(1000)
const timestamp = z.string().datetime({ offset: true })
const bookingSchema = z.object({
  workspaceId: ref, bookingId: ref, customerId: ref, version: z.number().int().positive(),
  status: z.literal('CONFIRMED'), shopName: text, serviceName: text, startsAt: timestamp,
  location: text, supportContact: text, changeInstructions: text,
})
const scopeSchema = z.object({ workspaceId: ref, bookingId: ref, customerId: ref, bookingVersion: z.number().int().positive() })
const actionSchema = z.object({
  type: z.enum(['COPIED', 'OWNER_CONFIRMED_SENT']), actorRef: ref, occurredAt: timestamp,
}).strict()
export type ManualNotice = Readonly<{
  workspaceId: string; bookingId: string; customerId: string; bookingVersion: number
  body: string; fingerprint: string; checklist: readonly string[]
  state: 'PREPARED' | 'COPIED' | 'OWNER_CONFIRMED_SENT'; providerVerified: false
  confirmedBy: string | null; confirmedAt: string | null
}>

/** Facts must be loaded from the authorized server reservation reader, not a client request. */
export function composeManualNotice(currentBooking: unknown, scopeInput: unknown): ManualNotice {
  const booking = bookingSchema.parse(currentBooking)
  const scope = scopeSchema.parse(scopeInput)
  if (booking.workspaceId !== scope.workspaceId || booking.bookingId !== scope.bookingId ||
      booking.customerId !== scope.customerId || booking.version !== scope.bookingVersion) {
    throw new Error('NOTICE_BOOKING_MISMATCH')
  }
  const when = new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(new Date(booking.startsAt))
  const body = [
    `${booking.shopName} 예약 안내입니다.`, `서비스: ${booking.serviceName}`, `예약 일시: ${when} (한국 시간)`,
    `장소: ${booking.location}`, booking.changeInstructions, `문의: ${booking.supportContact}`,
  ].join('\n')
  const fingerprint = createHash('sha256').update(JSON.stringify([
    scope.workspaceId, scope.bookingId, scope.customerId, scope.bookingVersion, body,
  ])).digest('hex')
  return Object.freeze({
    ...scope, body, fingerprint,
    checklist: Object.freeze(['예약 일시와 서비스를 다시 확인해 주세요.', '받는 고객이 맞는지 확인해 주세요.', '문구를 복사한 뒤 고객에게 직접 보내 주세요.', '실제로 보내셨다면 전달 여부를 기록해 주세요.']),
    state: 'PREPARED', providerVerified: false, confirmedBy: null, confirmedAt: null,
  })
}

/** Domain-only progress; caller must persist with CAS and verify actor membership on the server. */
export function recordManualProgress(notice: ManualNotice, input: unknown, currentBooking: unknown): ManualNotice {
  const action = actionSchema.parse(input)
  const fresh = composeManualNotice(currentBooking, notice)
  if (notice.fingerprint !== fresh.fingerprint || notice.body !== fresh.body || notice.providerVerified !== false) {
    throw new Error('NOTICE_STALE_OR_CHANGED')
  }
  if (notice.state === 'OWNER_CONFIRMED_SENT') return notice
  if (action.type === 'COPIED') return Object.freeze({ ...notice, state: 'COPIED' })
  return Object.freeze({ ...notice, state: 'OWNER_CONFIRMED_SENT', confirmedBy: action.actorRef, confirmedAt: action.occurredAt })
}
