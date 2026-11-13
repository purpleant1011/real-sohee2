export const periodPlanChannels = [
  'instagram',
  'threads',
  'naver_blog',
  'naver_place',
  'daangn',
] as const

export const generationDepths = ['fast', 'balanced', 'deep'] as const

export type PeriodPlanChannel = typeof periodPlanChannels[number]
export type GenerationDepth = typeof generationDepths[number]

export type PeriodPlanChannelRequest = Readonly<{
  channel: PeriodPlanChannel
  postCount: number
  imagesPerPost: number
}>

export type PeriodPlanRequest = Readonly<{
  periodStart: string
  periodEnd: string
  timezone: string
  goal: string
  channels: readonly PeriodPlanChannelRequest[]
  generationDepth: GenerationDepth
  idempotencyKey: string
}>

export type PeriodPlan = Readonly<PeriodPlanRequest & {
  id: string
  workspaceId: string
  status: 'draft' | 'approved' | 'cancelled'
  catalogVersion: number
  estimatedCredits: number
  version: number
  approvedAt: string | null
}>

export type PeriodPlanAdjustmentKind =
  | 'reduce_images'
  | 'move_channels'
  | 'plan_only'
  | 'priority_first'
  | 'use_fast_depth'

export type PeriodPlanAdjustment = Readonly<{
  kind: PeriodPlanAdjustmentKind
  label: string
}>
