/**
 * Charter Policy Executor (ANI-900)
 * 
 * Invariants:
 * 1. Action Preflight vs Approved Envelope is evaluated deterministically.
 * 2. In-envelope work inherits Charter approval and executes with 0 redundant approval prompts.
 * 3. Out-of-envelope work is strictly blocked prior to Provider/Executor invocation.
 * 4. LLM output can NEVER override Charter, policy, credit, or kill-switch boundaries.
 */

import type {
  AutonomyCharter,
  AutonomousActionCandidate,
  EnvelopeDecision,
  EnvelopeViolationCode,
} from './types'

export function isWithinQuietHours(
  date: Date,
  startStr?: string,
  endStr?: string
): boolean {
  if (!startStr || !endStr) return false

  const [startH, startM] = startStr.split(':').map(Number)
  const [endH, endM] = endStr.split(':').map(Number)

  // Use KST hours (UTC+9)
  const utcHours = date.getUTCHours()
  const kstHours = (utcHours + 9) % 24
  const kstMinutes = date.getUTCMinutes()
  const currentTotal = kstHours * 60 + kstMinutes

  const startTotal = startH * 60 + startM
  const endTotal = endH * 60 + endM

  if (startTotal <= endTotal) {
    return currentTotal >= startTotal && currentTotal < endTotal
  } else {
    // Spans midnight (e.g. 22:00 to 08:00)
    return currentTotal >= startTotal || currentTotal < endTotal
  }
}

export function evaluateActionEnvelope(
  action: AutonomousActionCandidate,
  charter: AutonomyCharter,
  baseDate: Date = new Date()
): EnvelopeDecision {
  // 1. Charter must be ACTIVE
  if (charter.status !== 'ACTIVE') {
    return {
      allowed: false,
      decision: 'OUT_OF_ENVELOPE',
      violationCode: 'CHARTER_NOT_ACTIVE',
      reason: `비법 헌장 상태가 [${charter.status}] 상태이므로 자율 실행이 차단되었습니다.`,
      requestedDelta: '헌장을 활성화(ACTIVE)해야 합니다.',
    }
  }

  const { envelope } = charter

  // 2. Channel check
  if (!envelope.allowedChannels.includes(action.channel)) {
    return {
      allowed: false,
      decision: 'OUT_OF_ENVELOPE',
      violationCode: 'CHANNEL_NOT_ALLOWED',
      reason: `채널 [${action.channel}]은(는) 승인된 헌장 허용 채널(${envelope.allowedChannels.join(', ')})에 포함되지 않습니다.`,
      requestedDelta: `채널 [${action.channel}] 추가 승인 요청`,
    }
  }

  // 3. Prohibited Action check
  if (envelope.prohibitedActions.includes(action.actionType)) {
    return {
      allowed: false,
      decision: 'OUT_OF_ENVELOPE',
      violationCode: 'ACTION_PROHIBITED',
      reason: `작업 [${action.actionType}]은(는) 헌장 금지 행동에 등록되어 실행할 수 없습니다.`,
      requestedDelta: `금지 행동 [${action.actionType}] 예외 허용 요청`,
    }
  }

  // 4. Per-action credit cap
  if (action.creditCost > envelope.maxCreditPerAction) {
    return {
      allowed: false,
      decision: 'OUT_OF_ENVELOPE',
      violationCode: 'EXCEEDS_ACTION_CREDIT_CAP',
      reason: `필요 크레딧(${action.creditCost} SC)이 헌장 단일 작업 한도(${envelope.maxCreditPerAction} SC)를 초과했습니다.`,
      requestedDelta: `단일 작업 크레딧 한도 ${action.creditCost} SC로 증액 승인 요청`,
    }
  }

  // 5. External spend cap
  const spendKrw = action.externalSpendKrw ?? 0
  if (spendKrw > envelope.maxExternalSpendKrw) {
    return {
      allowed: false,
      decision: 'OUT_OF_ENVELOPE',
      violationCode: 'EXCEEDS_EXTERNAL_SPEND_CAP',
      reason: `외부 광고 집행비(${spendKrw.toLocaleString()}원)가 헌장 허용 예산(${envelope.maxExternalSpendKrw.toLocaleString()}원)을 초과했습니다.`,
      requestedDelta: `외부 광고 집행비 ${spendKrw.toLocaleString()}원으로 증액 승인 요청`,
    }
  }

  // 6. Discount rate cap
  const discount = action.discountRatePercent ?? 0
  if (discount > envelope.maxDiscountRatePercent) {
    return {
      allowed: false,
      decision: 'OUT_OF_ENVELOPE',
      violationCode: 'EXCEEDS_DISCOUNT_CAP',
      reason: `제안된 할인율(${discount}%)이 헌장 최대 허용 할인율(${envelope.maxDiscountRatePercent}%)을 초과했습니다.`,
      requestedDelta: `할인율 ${discount}% 승인 요청`,
    }
  }

  // 7. Quiet hours check
  if (isWithinQuietHours(baseDate, envelope.quietHoursStart, envelope.quietHoursEnd)) {
    return {
      allowed: false,
      decision: 'OUT_OF_ENVELOPE',
      violationCode: 'QUIET_HOURS_VIOLATION',
      reason: `현재 시각은 매장 침묵 시간대(${envelope.quietHoursStart} ~ ${envelope.quietHoursEnd})에 해당하여 외부 발행이 제한됩니다.`,
      requestedDelta: '침묵 시간대 종료 후 예약 발송 또는 즉시 발송 승인 요청',
    }
  }

  // In-Envelope: Inherits charter approval
  return {
    allowed: true,
    decision: 'IN_ENVELOPE',
    inheritedApprovalId: `appr_charter_${charter.autonomyCharterId}_v${charter.version}`,
    charterId: charter.autonomyCharterId,
    charterVersion: charter.version,
  }
}
