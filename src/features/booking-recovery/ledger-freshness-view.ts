/**
 * ANI-1610 — 외부 예약장부 vs 내부장부 최신성·수동 대안 일관 UI.
 *
 * The server contract lives in `availability.ts` (`LedgerFreshness`, `getLedgerStatus`).
 * This module only turns that contract into owner-facing copy so every surface says the
 * same thing: a ledger that was not observed, went stale, or failed to load is
 * "확인 필요" — never "예약 가능".
 */
import type { LedgerFreshness, LedgerFreshnessEnvelope } from './availability'

/** ANI-1610: an owner confirmation older than this is stale and must be re-checked. */
export const LEDGER_FRESHNESS_TTL_MS = 15 * 60 * 1000

export interface LedgerFreshnessResolutionInput {
  /** True only when a real external booking ledger integration is connected. */
  hasExternalLedgerConnection: boolean
  /** Most recent owner confirmation / independent readback, ISO-8601. */
  lastConfirmedAt: string | null
  now?: string
}

export type LedgerFreshnessTone = 'current' | 'needs-check'

export interface LedgerFreshnessView {
  tone: LedgerFreshnessTone
  headline: string
  detail: string
  requiresOwnerConfirmation: boolean
  observedLabel: string | null
  sourceLabel: string | null
}

export const OWNER_CONFIRMATION_SOURCE = '사장님 직접 확인'

/**
 * Fail-closed freshness evaluation. Anything that is not a fresh, readable observation
 * resolves to a state that requires the owner to confirm the real ledger by hand.
 */
export function resolveLedgerFreshness(
  input: LedgerFreshnessResolutionInput,
): LedgerFreshnessEnvelope<null> {
  const nowMs = Date.parse(input.now ?? new Date().toISOString())

  if (!input.lastConfirmedAt) {
    return {
      freshness: 'NOT_OBSERVED',
      data: null,
      observedAt: null,
      requiresOwnerConfirmation: true,
      message: '확인된 장부 기록이 없습니다.',
    }
  }

  const observedMs = Date.parse(input.lastConfirmedAt)
  if (!Number.isFinite(nowMs) || Number.isNaN(observedMs)) {
    return {
      freshness: 'ERROR',
      data: null,
      observedAt: null,
      requiresOwnerConfirmation: true,
      message: '장부 확인 시각을 읽을 수 없습니다.',
    }
  }

  const ageMs = nowMs - observedMs
  if (ageMs < 0 || ageMs >= LEDGER_FRESHNESS_TTL_MS) {
    return {
      freshness: 'STALE',
      data: null,
      observedAt: input.lastConfirmedAt,
      requiresOwnerConfirmation: true,
      message: '마지막 확인 후 15분이 지나 다시 확인이 필요합니다.',
    }
  }

  return {
    freshness: 'CURRENT',
    data: null,
    observedAt: input.lastConfirmedAt,
    requiresOwnerConfirmation: false,
  }
}

function formatObservedAt(iso: string, timeZone: string): string | null {
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) return null
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(new Date(ms))
    const pick = (type: string) => parts.find((part) => part.type === type)?.value ?? ''
    const date = `${pick('year')}-${pick('month')}-${pick('day')}`
    const time = `${pick('hour')}:${pick('minute')}`
    if (!pick('year') || !pick('hour')) return null
    return `${date} ${time}`
  } catch {
    return null
  }
}

export function toLedgerFreshnessView(input: {
  freshness: LedgerFreshness
  observedAt?: string | null
  sourceLabel?: string | null
  timezone?: string
}): LedgerFreshnessView {
  const timezone = input.timezone ?? 'Asia/Seoul'
  const observedLabel = input.observedAt ? formatObservedAt(input.observedAt, timezone) : null
  const sourceLabel = input.sourceLabel ?? null

  if (input.freshness === 'CURRENT') {
    const detailParts: string[] = []
    if (observedLabel) detailParts.push(`마지막 확인 ${observedLabel}`)
    if (sourceLabel) detailParts.push(`출처: ${sourceLabel}`)
    return {
      tone: 'current',
      headline: '장부 확인 완료',
      detail: detailParts.length > 0 ? detailParts.join(' · ') : '최근 확인 기록을 기준으로 안내합니다.',
      requiresOwnerConfirmation: false,
      observedLabel,
      sourceLabel,
    }
  }

  if (input.freshness === 'STALE') {
    return {
      tone: 'needs-check',
      headline: '확인 필요',
      detail: observedLabel
        ? `마지막 확인은 ${observedLabel}이라 지금은 최신 상태가 아니에요. 빈 시간 맞나요? 실제 장부를 한 번 더 확인해 주세요.`
        : '장부 확인 시각이 오래되어 최신 상태가 아니에요. 빈 시간 맞나요? 실제 장부를 한 번 더 확인해 주세요.',
      requiresOwnerConfirmation: true,
      observedLabel,
      sourceLabel,
    }
  }

  if (input.freshness === 'ERROR') {
    return {
      tone: 'needs-check',
      headline: '확인 필요',
      detail: '예약 장부를 불러오지 못했어요. 지금은 빈 시간 여부를 알 수 없으니 실제 장부를 직접 확인해 주세요.',
      requiresOwnerConfirmation: true,
      observedLabel,
      sourceLabel,
    }
  }

  return {
    tone: 'needs-check',
    headline: '확인 필요',
    detail: '외부 예약 장부가 연결되어 있지 않아 빈 시간 여부를 알 수 없어요. 실제 장부를 직접 확인해 주세요.',
    requiresOwnerConfirmation: true,
    observedLabel,
    sourceLabel,
  }
}
