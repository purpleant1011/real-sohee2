export type ProfileField =
  | 'business_name'
  | 'business_hours'
  | 'address'
  | 'phone'
  | 'introduction'
  | 'news'

export type CapabilityDecision = 'supervised_allowed' | 'manual_assist_only' | 'unsupported'

export type ProfileChangeProposal = Readonly<{
  workspaceId: string
  channel: 'naver_place' | 'daangn_business'
  targetExternalId: string
  targetLabel: string
  field: ProfileField
  before: string
  after: string
  reason: string
  capability: CapabilityDecision
  evidenceUrl: string
}>
