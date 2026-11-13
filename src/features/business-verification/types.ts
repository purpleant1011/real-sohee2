export type BusinessVerificationStatus = 'INCOMPLETE' | 'PENDING_REVIEW' | 'VERIFIED' | 'REJECTED'

export type ServiceEligibility = 'BLOCKED' | 'LIMITED' | 'ELIGIBLE'

export interface BusinessProfile {
  id: string
  workspaceId: string
  businessName: string
  registrationNumber: string // 10자리 형식: XXX-XX-XXXXX 또는 10자리 숫자
  representativeName: string
  category: string
  address?: string
  contactPhone: string
  websiteUrl?: string
  operatingHours?: Record<string, unknown>
  verificationStatus: BusinessVerificationStatus
  serviceEligibility: ServiceEligibility
  verifiedAt?: string
  reviewedBy?: string
  rejectionReason?: string
  evidenceHash?: string
  createdAt: string
  updatedAt: string
}

export interface BusinessVerificationEvent {
  id: string
  workspaceId: string
  previousStatus?: BusinessVerificationStatus
  newStatus: BusinessVerificationStatus
  reviewerId?: string
  reason?: string
  evidenceSource: 'MANUAL_REVIEW' | 'SYSTEM_PROVISIONAL' | 'EXTERNAL_API'
  evidencePayload?: Record<string, unknown>
  idempotencyKey?: string
  createdAt: string
}

export interface BusinessRegistrationInput {
  businessName: string
  registrationNumber: string
  representativeName: string
  category: string
  address?: string
  contactPhone: string
  websiteUrl?: string
}
