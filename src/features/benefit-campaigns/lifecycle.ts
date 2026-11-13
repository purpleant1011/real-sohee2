import type { BenefitCampaign, BenefitGrant, BenefitAudienceRule, BenefitCampaignType } from './types'

// 1,000 SC당 예상 LLM/인프라 원가(COGS) KRW 기준 (예: 1,000 SC = 약 150원)
export const ESTIMATED_COGS_KRW_PER_1000_SC = 150

/**
 * 캠페인 생성 및 COGS 추정
 */
export function createBenefitCampaignDraft(input: {
  type: BenefitCampaignType
  title: string
  message: string
  audienceRule: BenefitAudienceRule
  perWorkspaceSc: number
  budgetCapSc?: number
  createdBy: string
  estimatedAudienceCount: number
}): BenefitCampaign {
  const totalEstimatedSc = input.perWorkspaceSc * input.estimatedAudienceCount
  const effectiveTotalSc = input.budgetCapSc ? Math.min(totalEstimatedSc, input.budgetCapSc) : totalEstimatedSc
  const estimatedCogsKrw = Math.round((effectiveTotalSc / 1000) * ESTIMATED_COGS_KRW_PER_1000_SC)

  const now = new Date().toISOString()
  return {
    id: `camp-${Date.now()}`,
    type: input.type,
    title: input.title,
    message: input.message,
    audienceRule: input.audienceRule,
    perWorkspaceSc: input.perWorkspaceSc,
    budgetCapSc: input.budgetCapSc,
    status: 'DRAFT',
    createdBy: input.createdBy,
    totalRecipientsCount: input.estimatedAudienceCount,
    grantedRecipientsCount: 0,
    totalGrantedSc: 0,
    estimatedCogsKrw,
    realizedCogsKrw: 0,
    createdAt: now,
    updatedAt: now,
    startsAt: now,
  }
}

/**
 * 멱등키 생성 규칙
 */
export function generateGrantIdempotencyKey(campaignId: string, workspaceId: string): string {
  return `benefit-grant:${campaignId}:${workspaceId}`
}

export interface GrantExecutionResult {
  successfulGrants: BenefitGrant[]
  failedGrants: Array<{ workspaceId: string; error: string }>
  totalGrantedSc: number
  isFullyCompleted: boolean
}

/**
 * 배치 지급 실행기 (메모리/DB 원장 연동 멱등 처리)
 */
export function executeBatchBenefitGrant(
  campaign: BenefitCampaign,
  targetWorkspaceIds: string[],
  existingGrants: BenefitGrant[] = []
): GrantExecutionResult {
  const successfulGrants: BenefitGrant[] = []
  const failedGrants: Array<{ workspaceId: string; error: string }> = []
  const existingGrantByKey = new Map(existingGrants.map((g) => [g.idempotencyKey, g] as const))

  let currentGrantedSc = campaign.totalGrantedSc

  // 이미 지급된 기존 건들의 금액을 먼저 반영
  for (const g of existingGrants) {
    if (g.status === 'GRANTED') {
      currentGrantedSc += g.grantedSc
    }
  }

  for (const wsId of targetWorkspaceIds) {
    const key = generateGrantIdempotencyKey(campaign.id, wsId)

    // 이미 지급된 경우 중복 지급 스킵 (멱등성)
    const existing = existingGrantByKey.get(key)
    if (existing) {
      successfulGrants.push(existing)
      continue
    }

    // 예산 상한(Budget Cap) 초과 검사
    if (campaign.budgetCapSc && currentGrantedSc + campaign.perWorkspaceSc > campaign.budgetCapSc) {
      failedGrants.push({ workspaceId: wsId, error: '예산 상한(Budget Cap)을 초과하여 지급이 중단되었습니다.' })
      continue
    }

    // 신규 지급 생성
    const grant: BenefitGrant = {
      id: `grant-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      campaignId: campaign.id,
      workspaceId: wsId,
      status: 'GRANTED',
      grantedSc: campaign.perWorkspaceSc,
      grantedAt: new Date().toISOString(),
      idempotencyKey: key,
      createdAt: new Date().toISOString(),
    }

    successfulGrants.push(grant)
    currentGrantedSc += campaign.perWorkspaceSc
  }

  return {
    successfulGrants,
    failedGrants,
    totalGrantedSc: currentGrantedSc,
    isFullyCompleted: failedGrants.length === 0,
  }
}
