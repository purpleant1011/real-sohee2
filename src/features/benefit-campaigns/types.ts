export type BenefitCampaignType =
  | 'PROMO_CREDIT'
  | 'COUPON'
  | 'TRIAL_EXTENSION'
  | 'COMPENSATION'
  | 'WELCOME_GIFT'
  | 'MILESTONE_CELEBRATION'

export type BenefitCampaignStatus =
  | 'DRAFT'
  | 'SCHEDULED'
  | 'RUNNING'
  | 'COMPLETED'
  | 'PARTIAL'
  | 'STOPPED'
  | 'CANCELLED'

export type BenefitGrantStatus = 'PENDING' | 'GRANTED' | 'FAILED' | 'REDEEMED' | 'EXPIRED' | 'REVERSED'

export interface BenefitAudienceRule {
  target: 'ALL_ACTIVE' | 'NEW_SIGNUPS_TODAY' | 'TRIAL_ENDING_SOON' | 'FIRST_VERIFIED_ACTION' | 'INACTIVE_7D' | 'SPECIFIC_WORKSPACES' | 'INCIDENT_AFFECTED'
  workspaceIds?: string[]
  planKeys?: string[]
}

export interface BenefitCampaign {
  id: string
  type: BenefitCampaignType
  title: string
  message: string
  audienceRule: BenefitAudienceRule
  startsAt: string
  endsAt?: string
  budgetCapSc?: number
  perWorkspaceSc: number
  status: BenefitCampaignStatus
  createdBy: string
  approvedBy?: string
  totalRecipientsCount: number
  grantedRecipientsCount: number
  totalGrantedSc: number
  estimatedCogsKrw: number
  realizedCogsKrw: number
  createdAt: string
  updatedAt: string
}

export interface BenefitGrant {
  id: string
  campaignId: string
  workspaceId: string
  status: BenefitGrantStatus
  grantedSc: number
  grantedAt?: string
  redeemedAt?: string
  expiredAt?: string
  ledgerEntryId?: string
  idempotencyKey: string
  errorMessage?: string
  createdAt: string
}

export interface CouponDefinition {
  id: string
  campaignId?: string
  code: string
  benefitType: 'CREDIT_DISCOUNT' | 'CREDIT_GRANT' | 'SUBSCRIPTION_DISCOUNT'
  valueAmount: number
  eligiblePlans: string[]
  startsAt: string
  expiresAt?: string
  maxRedemptions: number
  redemptionCount: number
  status: 'ACTIVE' | 'EXHAUSTED' | 'EXPIRED' | 'DISABLED'
  createdAt: string
}
