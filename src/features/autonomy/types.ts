/**
 * A3 Autonomy Charter Types (ANI-900)
 */

export type AutonomyCharterStatus = 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'SUPERSEDED' | 'REVOKED'

export interface AutonomyEnvelope {
  allowedChannels: string[]
  prohibitedActions: string[]
  maxCreditPerAction: number
  maxCreditPerWeek: number
  maxExternalSpendKrw: number
  maxPostingFrequencyPerDay: number
  quietHoursStart?: string // 'HH:mm' format
  quietHoursEnd?: string // 'HH:mm' format
  maxDiscountRatePercent: number
  customerResponseScope: string[]
}

export interface AutonomyCharter {
  autonomyCharterId: string
  workspaceId: string
  version: number
  title: string
  status: AutonomyCharterStatus
  envelope: AutonomyEnvelope
  activatedAt?: string
  approvedByActorId?: string
  createdAt: string
  updatedAt: string
}

export interface AutonomousActionCandidate {
  actionId: string
  actionType: string
  channel: string
  creditCost: number
  externalSpendKrw?: number
  discountRatePercent?: number
  timestamp?: string // ISO format
  payload?: Record<string, unknown>
}

export type EnvelopeViolationCode =
  | 'CHARTER_NOT_ACTIVE'
  | 'CHANNEL_NOT_ALLOWED'
  | 'ACTION_PROHIBITED'
  | 'EXCEEDS_ACTION_CREDIT_CAP'
  | 'EXCEEDS_EXTERNAL_SPEND_CAP'
  | 'EXCEEDS_DISCOUNT_CAP'
  | 'QUIET_HOURS_VIOLATION'

export type EnvelopeDecision =
  | {
      allowed: true
      decision: 'IN_ENVELOPE'
      inheritedApprovalId: string
      charterId: string
      charterVersion: number
    }
  | {
      allowed: false
      decision: 'OUT_OF_ENVELOPE'
      violationCode: EnvelopeViolationCode
      reason: string
      requestedDelta: string
    }

export interface A3ActionEnvelope {
  maxDailyBudgetKRW: number
  maxCreditsPerAction: number
  allowedChannels: string[]
  requireExplicitApprovalRiskTier: string
  quietHoursStartHour: number
  quietHoursEndHour: number
}

export interface A3AutonomyCharter {
  id: string
  version: string
  workspaceId: string
  status: 'ACTIVE' | 'PAUSED' | 'EXPIRED' | 'REVOKED' | 'DRAFT'
  envelope: A3ActionEnvelope
  authorizedByOwnerId: string
  authorizedAt: string
}
