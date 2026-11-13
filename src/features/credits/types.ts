export const creditActions = [
  'chat_turn',
  'source_analysis',
  'text_generation',
  'image_generation',
  'harness_generation',
  'period_plan_generation',
  'performance_collection',
  'performance_report',
  'external_action_prepare',
  'external_action_execute',
] as const

export type CreditAction = typeof creditActions[number]

export type CreditUnits = Readonly<{
  chatTurns: number
  textGenerations: number
  imageGenerations: number
  sourceAnalyses: number
  externalActions: number
}>

export type CreditRate = Readonly<{
  baseCredits: number
  perUnit: CreditUnits
}>

export type CreditRateCatalog = Readonly<{
  catalogVersion: number
  rates: Readonly<Partial<Record<CreditAction, CreditRate>>>
}>

export type CreditCostRequest = Readonly<{
  action: CreditAction | string
  units: CreditUnits
}>

export type CreditPreview = Readonly<{
  catalogVersion: number
  estimatedCredits: number
}>

export type CreditLedgerKind = 'grant' | 'reserve' | 'consume' | 'release' | 'refund' | 'adjustment'

export type CreditLedgerEntry = Readonly<{
  id: string
  workspaceId: string
  accountId: string
  reservationId: string | null
  kind: CreditLedgerKind
  action: CreditAction | null
  amount: number
  idempotencyKey: string
  occurredAt: string
}>

export type CreditBalance = Readonly<{
  workspaceId: string
  periodStart: string
  periodEnd: string
  granted: number
  adjustments: number
  released: number
  consumed: number
  reserved: number
  available: number
  weeklyLimit: number
  policyVersion: string
}>

export type CreditReservation = Readonly<{
  id: string
  workspaceId: string
  action: CreditAction
  requestedCredits: number
  settledCredits: number
  releasedCredits: number
  state: 'reserved' | 'settled' | 'released'
  idempotencyKey: string
}>

export type CreditUsageDetail = Readonly<{
  occurredAt: string
  operation: 'text_response' | 'image_generation' | 'image_edit'
  usageSource: 'actual' | 'estimated_missing_usage'
  textInputTokens: number
  cachedTextInputTokens: number
  textOutputTokens: number
  imageInputTokens: number
  imageOutputTokens: number
  providerTotalTokens: number
  requestedCredits: number
  settledCredits: number
  releasedCredits: number
  policyVersion: string
}>
