export const profileKeys = [
  'business_identity',
  'primary_offering',
  'primary_audience',
  'marketing_goal',
  'approval_policy',
  'channel_presence',
] as const

export type ProfileKey = (typeof profileKeys)[number]

export type OnboardingStep = 'welcome' | ProfileKey | 'summary' | 'completed'

export type OnboardingStatus =
  | 'not_started'
  | 'in_progress'
  | 'review_required'
  | 'completed'

export type ProfileCandidateStatus =
  | 'review_required'
  | 'active'
  | 'rejected'
  | 'superseded'

export type OnboardingAnswer = Readonly<{
  id: string
  step: ProfileKey
  content: string
  createdAt: string
}>

export type ProfileCandidate = Readonly<{
  id: string
  answerId: string
  key: ProfileKey
  originalValue: string
  proposedValue: string
  confirmedValue: string | null
  confidence: number
  evidenceQuote: string
  source: 'onboarding_answer'
  status: ProfileCandidateStatus
  version: number
  reviewedAt: string | null
  createdAt: string
  updatedAt: string
}>

export type ApprovedProfileFact = Readonly<{
  key: ProfileKey
  value: string
}>

export type OnboardingSnapshot = Readonly<{
  sessionId: string | null
  workspaceId: string | null
  threadId: string | null
  status: OnboardingStatus
  activeStep: OnboardingStep
  approvedProfileKeys: readonly ProfileKey[]
  approvedFacts: readonly ApprovedProfileFact[]
  answers: readonly OnboardingAnswer[]
  candidates: readonly ProfileCandidate[]
}>
