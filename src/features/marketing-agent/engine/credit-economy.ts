/**
 * Sohee Credit Economy & AI Automation Cost Rating Engine
 * 
 * 1. Continuous Weekly Refill Token Bucket (CreditAccount)
 * 2. Provider-Agnostic Cost Catalog with versioning (OpenAI, Anthropic, Google, MiniMax, etc.)
 * 3. Fully Loaded Variable COGS (AI + Browser Runtime + Infrastructure + FX)
 * 4. Margin Guard (70% Target Gross Margin, 60% Hard Floor)
 * 5. Estimate -> Reserve -> Settle Protocol with Verification Reserve
 * 6. 4 Operational Modes (HEALTHY, CONSERVE, CRITICAL, DEPLETED) & Burn Governor
 * 7. Daily Operating Plan & Rolling 24h Credit Forecast
 * 8. Marketing Activity Portfolio Budget (6 distinct activity categories)
 */

export type CreditPlanId = 'FREE' | 'FREE_TASTE' | 'TRIAL_V1' | 'PLAN_150K' | 'PLAN_300K' | 'PLAN_500K'

export type CreditOperationalMode = 'HEALTHY' | 'CONSERVE' | 'CRITICAL' | 'DEPLETED'

export type MarketingActivityCategory = 
  | 'STRATEGY_MARKET'
  | 'CONTENT_DISTRIBUTION'
  | 'CUSTOMER_CONVERSION_CRM'
  | 'REPUTATION_LOCAL'
  | 'EXPERIMENT_LEARNING'
  | 'ANALYTICS_VERIFICATION'

export interface ProviderPrice {
  provider: 'OPENAI' | 'ANTHROPIC' | 'GOOGLE' | 'MINIMAX' | 'BROWSER_RUNTIME'
  modelId: string
  inputPerMillionUSD: number
  cachedInputPerMillionUSD: number
  outputPerMillionUSD: number
  reasoningPerMillionUSD?: number
  imageInPerMillionUSD?: number
  imageOutPerMillionUSD?: number
  imageUnitUSD?: number
  browserMinuteUSD?: number
  effectiveVersion: string
}

export interface CreditAccount {
  workspaceId: string
  planId: CreditPlanId
  weeklyCapacitySC: number
  refillRateSCPerSecond: number
  balanceSC: number
  reservedSC: number
  lastAccruedAt: number
  lastResetAt?: number
  status: 'ACTIVE' | 'CONSERVE' | 'CRITICAL' | 'DEPLETED' | 'BILLING_SUSPENDED'
}

export interface PlanConfig {
  planId: CreditPlanId
  name: string
  priceKRW: number
  weeklyCapacitySC: number
  refillRateSCPerSecond: number
  maxAutonomousSCPerMission: number
  maxAutonomousSCPerHour: number
  maxExperimentSCPerDay: number
  maxDiscoverySCPerWeek: number
}

export const PLAN_CONFIGS: Record<CreditPlanId, PlanConfig> = {
  FREE: {
    planId: 'FREE',
    name: '실제 사업자 무료 맛보기 (약 ₩5,000 상당)',
    priceKRW: 0,
    weeklyCapacitySC: 6000,
    refillRateSCPerSecond: 0,
    maxAutonomousSCPerMission: 1500,
    maxAutonomousSCPerHour: 3000,
    maxExperimentSCPerDay: 2000,
    maxDiscoverySCPerWeek: 5000
  },
  FREE_TASTE: {
    planId: 'FREE_TASTE',
    name: '실제 사업자 무료 맛보기 (50 Energy, 약 ₩5,000 상당)',
    priceKRW: 0,
    weeklyCapacitySC: 5000,
    refillRateSCPerSecond: 0,
    maxAutonomousSCPerMission: 1500,
    maxAutonomousSCPerHour: 3000,
    maxExperimentSCPerDay: 2000,
    maxDiscoverySCPerWeek: 5000
  },
  TRIAL_V1: {
    planId: 'TRIAL_V1',
    name: '실제 사업자 무료 맛보기 (약 ₩5,000 상당)',
    priceKRW: 0,
    weeklyCapacitySC: 6000,
    refillRateSCPerSecond: 0,
    maxAutonomousSCPerMission: 1500,
    maxAutonomousSCPerHour: 3000,
    maxExperimentSCPerDay: 2000,
    maxDiscoverySCPerWeek: 5000
  },
  PLAN_150K: {
    planId: 'PLAN_150K',
    name: '기본 마케팅 직원 (월 15만)',
    priceKRW: 150000,
    weeklyCapacitySC: 30000, // 30,000 SC / week (ANI-308)
    refillRateSCPerSecond: 30000 / (7 * 24 * 3600),
    maxAutonomousSCPerMission: 2500,
    maxAutonomousSCPerHour: 5000,
    maxExperimentSCPerDay: 4000,
    maxDiscoverySCPerWeek: 8000
  },
  PLAN_300K: {
    planId: 'PLAN_300K',
    name: '고성장 전담 직원 (월 30만)',
    priceKRW: 300000,
    weeklyCapacitySC: 60000, // 60,000 SC / week (ANI-308)
    refillRateSCPerSecond: 60000 / (7 * 24 * 3600),
    maxAutonomousSCPerMission: 5000,
    maxAutonomousSCPerHour: 10000,
    maxExperimentSCPerDay: 8000,
    maxDiscoverySCPerWeek: 16000
  },
  PLAN_500K: {
    planId: 'PLAN_500K',
    name: '최상위 멀티채널 총괄 (월 50만)',
    priceKRW: 500000,
    weeklyCapacitySC: 100000, // 100,000 SC / week (ANI-308)
    refillRateSCPerSecond: 100000 / (7 * 24 * 3600),
    maxAutonomousSCPerMission: 9000,
    maxAutonomousSCPerHour: 18000,
    maxExperimentSCPerDay: 15000,
    maxDiscoverySCPerWeek: 30000
  }
}

export const PROVIDER_PRICE_CATALOG: ProviderPrice[] = [
  {
    provider: 'GOOGLE',
    modelId: 'gemini-3.8-flash',
    inputPerMillionUSD: 0.15,
    cachedInputPerMillionUSD: 0.0375,
    outputPerMillionUSD: 0.60,
    reasoningPerMillionUSD: 0.60,
    effectiveVersion: '2026-09-v2'
  },
  {
    provider: 'GOOGLE',
    modelId: 'gemini-3.5-flash-lite',
    inputPerMillionUSD: 0.075,
    cachedInputPerMillionUSD: 0.01875,
    outputPerMillionUSD: 0.30,
    effectiveVersion: '2026-09-v2'
  },
  {
    provider: 'OPENAI',
    modelId: 'gpt-image-2',
    inputPerMillionUSD: 5.0,
    cachedInputPerMillionUSD: 2.0,
    outputPerMillionUSD: 30.0,
    effectiveVersion: '2026-09-v2'
  },
  {
    provider: 'GOOGLE',
    modelId: 'gemini-2.5-flash',
    inputPerMillionUSD: 0.075,
    cachedInputPerMillionUSD: 0.01875,
    outputPerMillionUSD: 0.30,
    effectiveVersion: '2026-09-v2'
  },
  {
    provider: 'BROWSER_RUNTIME',
    modelId: 'cloud-playwright-session',
    inputPerMillionUSD: 0,
    cachedInputPerMillionUSD: 0,
    outputPerMillionUSD: 0,
    browserMinuteUSD: 0.012,
    effectiveVersion: '2026-09-v2'
  }
]

export interface UsageInput {
  provider: 'OPENAI' | 'ANTHROPIC' | 'GOOGLE' | 'MINIMAX' | 'BROWSER_RUNTIME'
  modelId: string
  inputTokens?: number
  cachedInputTokens?: number
  outputTokens?: number
  reasoningTokens?: number
  imageUnits?: number
  imageInputTokens?: number
  imageOutputTokens?: number
  browserMinutes?: number
  externalApiCostUSD?: number
}

export interface ActivityPortfolioMix {
  category: MarketingActivityCategory
  name: string
  plannedSC: number
  actualSC: number
  sharePercentage: number
  dominanceReason?: string
}

export interface RoutineBlock {
  id: string
  window: string // e.g. '09:00 - 10:30'
  purpose: string
  marketingRole: string
  category: MarketingActivityCategory
  triggerType: 'SCHEDULED' | 'EVENT_DRIVEN'
  expectedSCLow: number
  expectedSCExpected: number
  expectedSCHigh: number
  actualSC?: number
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'DEFERRED'
  why: string
}

export interface DailyOperatingPlan {
  workspaceId: string
  localDate: string
  operatingMode: CreditOperationalMode
  startingAvailableSC: number
  expectedRefillSC24h: number
  alreadyReservedSC: number
  plannedSCLow: number
  plannedSCExpected: number
  plannedSCHigh: number
  projectedEndBalanceExpected: number
  forecastConfidence: number
  lastReforecastAt: string
  forecastChangeReason?: string
  routineBlocks: RoutineBlock[]
  portfolioMix: ActivityPortfolioMix[]
}

export class CreditEconomyEngine {
  public static readonly TARGET_GROSS_MARGIN = 0.70 // 70% Target Gross Margin (ANI-309)
  public static readonly HARD_FLOOR_GROSS_MARGIN = 0.60 // 60% Hard Floor
  public static readonly TARGET_COGS_PER_SC_KRW = 0.30 // Max allowed COGS per SC for 70% GM (1 SC ~ 1 KRW Retail Value)
  public static readonly FLOOR_COGS_PER_SC_KRW = 0.40 // Max allowed COGS per SC for 60% floor
  public static readonly RETAIL_VALUE_PER_SC_KRW = 1.0 // 1 SC = 1 KRW Retail Value
  public static readonly USD_KRW_EXCHANGE_RATE = 1369.4 // 2026-09-01 standard rate
  public static readonly FX_SAFETY_BUFFER = 1.05 // 5% FX safety buffer

  /**
   * 1. Continuous Weekly Refill / Reset Check
   */
  public static computeAccruedBalance(account: CreditAccount, now = Date.now()): {
    accruedBalance: number
    availableSC: number
    mode: CreditOperationalMode
  } {
    const elapsedSeconds = Math.max(0, (now - (account.lastAccruedAt || account.lastResetAt || now)) / 1000)
    const capacity = account.weeklyCapacitySC
    const refillRate = account.refillRateSCPerSecond || (capacity / (7 * 24 * 3600))
    const accrued = Math.min(capacity, account.balanceSC + elapsedSeconds * refillRate)
    const available = Math.max(0, accrued - account.reservedSC)

    const balanceRatio = accrued / capacity
    let mode: CreditOperationalMode = 'HEALTHY'
    if (accrued <= 0 || available <= 0) {
      mode = 'DEPLETED'
    } else if (balanceRatio <= 0.10) {
      mode = 'CRITICAL'
    } else if (balanceRatio <= 0.30) {
      mode = 'CONSERVE'
    }

    return {
      accruedBalance: Math.round(accrued),
      availableSC: Math.round(available),
      mode
    }
  }

  /**
   * 2. Calculate Fully Loaded Variable COGS in KRW
   */
  public static calculateFullyLoadedCOGS(usage: UsageInput): {
    rawUSD: number
    fullyLoadedUSD: number
    cogsKRW: number
    providerCostKRW: number
    browserCostKRW: number
  } {
    const price = PROVIDER_PRICE_CATALOG.find(
      p => p.provider === usage.provider && p.modelId === usage.modelId
    ) || PROVIDER_PRICE_CATALOG[0]

    let providerUSD = 0
    let browserUSD = 0

    if (usage.inputTokens) {
      providerUSD += (usage.inputTokens / 1_000_000) * price.inputPerMillionUSD
    }
    if (usage.cachedInputTokens) {
      providerUSD += (usage.cachedInputTokens / 1_000_000) * price.cachedInputPerMillionUSD
    }
    if (usage.outputTokens) {
      providerUSD += (usage.outputTokens / 1_000_000) * price.outputPerMillionUSD
    }
    if (usage.reasoningTokens && price.reasoningPerMillionUSD) {
      providerUSD += (usage.reasoningTokens / 1_000_000) * price.reasoningPerMillionUSD
    }
    if (usage.imageInputTokens) {
      providerUSD += (usage.imageInputTokens / 1_000_000) * (price.imageInPerMillionUSD || 8.0)
    }
    if (usage.imageOutputTokens) {
      providerUSD += (usage.imageOutputTokens / 1_000_000) * (price.imageOutPerMillionUSD || 30.0)
    } else if (usage.imageUnits) {
      providerUSD += usage.imageUnits * 0.04
    }
    if (usage.browserMinutes && price.browserMinuteUSD) {
      browserUSD += usage.browserMinutes * price.browserMinuteUSD
    }
    if (usage.externalApiCostUSD) {
      providerUSD += usage.externalApiCostUSD
    }

    const rawUSD = providerUSD + browserUSD
    const fullyLoadedUSD = rawUSD * this.FX_SAFETY_BUFFER
    const cogsKRW = fullyLoadedUSD * this.USD_KRW_EXCHANGE_RATE

    return {
      rawUSD,
      fullyLoadedUSD,
      cogsKRW: Math.round(cogsKRW * 100) / 100,
      providerCostKRW: Math.round(providerUSD * this.USD_KRW_EXCHANGE_RATE * this.FX_SAFETY_BUFFER * 100) / 100,
      browserCostKRW: Math.round(browserUSD * this.USD_KRW_EXCHANGE_RATE * this.FX_SAFETY_BUFFER * 100) / 100
    }
  }

  /**
   * 3. Margin Guard Rating: Target 70% Gross Margin Calculation (SC = ceil(COGS / 0.30))
   */
  public static calculateCreditsToCharge(cogsKRW: number): {
    creditsToChargeSC: number
    targetChargeSC: number
    floorMinSC: number
    projectedGrossMargin: number
    isAllowedByHardFloor: boolean
  } {
    if (cogsKRW <= 0) {
      return {
        creditsToChargeSC: 1,
        targetChargeSC: 1,
        floorMinSC: 1,
        projectedGrossMargin: 1.0,
        isAllowedByHardFloor: true
      }
    }

    // TargetChargeSC = ceil(COGS_KRW / 0.30) -> 70% Target Margin
    // FloorMinSC = ceil(COGS_KRW / 0.40) -> 60% Hard Floor
    const targetChargeSC = Math.max(1, Math.ceil(cogsKRW / this.TARGET_COGS_PER_SC_KRW))
    const floorMinSC = Math.max(1, Math.ceil(cogsKRW / this.FLOOR_COGS_PER_SC_KRW))

    const creditsToChargeSC = targetChargeSC
    const impliedRetailKRW = creditsToChargeSC * 1.0
    const projectedGrossMargin = (impliedRetailKRW - cogsKRW) / impliedRetailKRW
    const isAllowedByHardFloor = cogsKRW <= creditsToChargeSC * this.FLOOR_COGS_PER_SC_KRW

    return {
      creditsToChargeSC,
      targetChargeSC,
      floorMinSC,
      projectedGrossMargin: Math.round(projectedGrossMargin * 1000) / 1000,
      isAllowedByHardFloor
    }
  }

  /**
   * 4. Estimate -> Reserve Protocol with Verification Reserve
   */
  public static estimateAndReserve(
    account: CreditAccount,
    estimatedUsage: UsageInput,
    hasIrreversibleExternalAction = true
  ): {
    canProceed: boolean
    reservedSC: number
    verificationReserveSC: number
    estimatedSC: number
    lowEstimateSC: number
    highEstimateSC: number
    updatedAccount: CreditAccount
    rejectionReason?: string
  } {
    const { availableSC } = this.computeAccruedBalance(account)
    const { cogsKRW } = this.calculateFullyLoadedCOGS(estimatedUsage)
    const { creditsToChargeSC, isAllowedByHardFloor } = this.calculateCreditsToCharge(cogsKRW)

    if (!isAllowedByHardFloor) {
      return {
        canProceed: false,
        reservedSC: 0,
        verificationReserveSC: 0,
        estimatedSC: creditsToChargeSC,
        lowEstimateSC: Math.max(1, Math.floor(creditsToChargeSC * 0.8)),
        highEstimateSC: Math.ceil(creditsToChargeSC * 1.3),
        updatedAccount: account,
        rejectionReason: 'GROSS_MARGIN_HARD_FLOOR_VIOLATION'
      }
    }

    // Verification Reserve: 15% safety lock for read-after-write post-submit checks
    const verificationReserveSC = hasIrreversibleExternalAction ? Math.max(5, Math.ceil(creditsToChargeSC * 0.15)) : 0
    const totalRequiredSC = creditsToChargeSC + verificationReserveSC

    const lowEstimateSC = Math.max(1, Math.floor(creditsToChargeSC * 0.85))
    const highEstimateSC = Math.ceil((creditsToChargeSC + verificationReserveSC) * 1.25)

    if (availableSC < totalRequiredSC) {
      return {
        canProceed: false,
        reservedSC: 0,
        verificationReserveSC,
        estimatedSC: creditsToChargeSC,
        lowEstimateSC,
        highEstimateSC,
        updatedAccount: account,
        rejectionReason: `INSUFFICIENT_CREDITS (Available: ${availableSC} SC, Required: ${totalRequiredSC} SC)`
      }
    }

    const updatedAccount: CreditAccount = {
      ...account,
      reservedSC: account.reservedSC + totalRequiredSC
    }

    return {
      canProceed: true,
      reservedSC: totalRequiredSC,
      verificationReserveSC,
      estimatedSC: creditsToChargeSC,
      lowEstimateSC,
      highEstimateSC,
      updatedAccount
    }
  }

  /**
   * 5. Settle Actual Real Usage
   */
  public static settleUsage(
    account: CreditAccount,
    reservedSC: number,
    actualUsage: UsageInput,
    isSystemFault = false
  ): {
    finalDebitedSC: number
    releasedSC: number
    systemSubsidySC: number
    updatedAccount: CreditAccount
    cogsKRW: number
    grossMargin: number
  } {
    const { cogsKRW } = this.calculateFullyLoadedCOGS(actualUsage)
    const { creditsToChargeSC, projectedGrossMargin } = this.calculateCreditsToCharge(cogsKRW)

    let finalDebitedSC = creditsToChargeSC
    let systemSubsidySC = 0

    if (isSystemFault) {
      systemSubsidySC = finalDebitedSC
      finalDebitedSC = 0
    }

    const newBalance = Math.max(0, account.balanceSC - finalDebitedSC)
    const newReserved = Math.max(0, account.reservedSC - reservedSC)
    const releasedSC = Math.max(0, reservedSC - finalDebitedSC)

    const updatedAccount: CreditAccount = {
      ...account,
      balanceSC: newBalance,
      reservedSC: newReserved,
      lastAccruedAt: Date.now()
    }

    return {
      finalDebitedSC,
      releasedSC,
      systemSubsidySC,
      updatedAccount,
      cogsKRW,
      grossMargin: projectedGrossMargin
    }
  }

  /**
   * Helper: Create Account for Workspace
   */
  public static createAccount(workspaceId: string, planId: CreditPlanId = 'PLAN_150K'): CreditAccount {
    const config = PLAN_CONFIGS[planId] || PLAN_CONFIGS.PLAN_150K
    return {
      workspaceId,
      planId,
      weeklyCapacitySC: config.weeklyCapacitySC,
      refillRateSCPerSecond: config.refillRateSCPerSecond,
      balanceSC: config.weeklyCapacitySC,
      reservedSC: 0,
      lastAccruedAt: Date.now(),
      status: 'ACTIVE'
    }
  }

  /**
   * Helper: Direct SC Reserve
   */
  public static reserveSC(account: CreditAccount, amountSC: number, _reason?: string): CreditAccount {
    return {
      ...account,
      reservedSC: account.reservedSC + amountSC
    }
  }

  /**
   * Helper: Direct SC Settle
   */
  public static settleSC(account: CreditAccount, amountSC: number, _reason?: string): CreditAccount {
    return {
      ...account,
      balanceSC: Math.max(0, account.balanceSC - amountSC),
      reservedSC: Math.max(0, account.reservedSC - amountSC),
      lastAccruedAt: Date.now()
    }
  }

  /**
   * 6. 100% Weekly Utilization Worst-Case Gross Margin Simulator (ANI-309)
   */
  public static simulate100PercentUtilizationMargin(planId: CreditPlanId): {
    planName: string
    monthlyPriceKRW: number
    weeklyRevenueKRW: number
    weeklyAllocationSC: number
    maxCOGSAt100PercentKRW: number
    realizedGrossMargin: number
    isCompliant: boolean
  } {
    const config = PLAN_CONFIGS[planId]
    const vatExcludedMonthlyRevenue = config.priceKRW / 1.1
    const netMonthlyRevenue = vatExcludedMonthlyRevenue * (1 - 0.033) // 3.3% PG fee
    const weeklyRevenueKRW = netMonthlyRevenue * (12 / 52) // weekly recognized revenue

    const maxCOGSAt100PercentKRW = config.weeklyCapacitySC * this.TARGET_COGS_PER_SC_KRW
    const realizedGrossMargin = (weeklyRevenueKRW - maxCOGSAt100PercentKRW) / weeklyRevenueKRW

    return {
      planName: config.name,
      monthlyPriceKRW: config.priceKRW,
      weeklyRevenueKRW: Math.round(weeklyRevenueKRW),
      weeklyAllocationSC: config.weeklyCapacitySC,
      maxCOGSAt100PercentKRW: Math.round(maxCOGSAt100PercentKRW),
      realizedGrossMargin: Math.round(realizedGrossMargin * 1000) / 1000,
      isCompliant: realizedGrossMargin >= this.HARD_FLOOR_GROSS_MARGIN
    }
  }

  /**
   * 6. Generate Daily Operating Plan & 24h Rolling Forecast
   */
  public static generateDailyOperatingPlan(
    account: CreditAccount,
    workspaceName = '바이름 청라점'
  ): DailyOperatingPlan {
    const { availableSC, mode } = this.computeAccruedBalance(account)
    const expectedRefill24h = Math.round(account.refillRateSCPerSecond * 86400)

    const routineBlocks: RoutineBlock[] = [
      {
        id: 'rb-1',
        window: '09:00 - 10:30',
        purpose: '상권 기회 탐지 및 모닝 브리핑 수립',
        marketingRole: 'Strategic Planner & Market Scout',
        category: 'STRATEGY_MARKET',
        triggerType: 'SCHEDULED',
        expectedSCLow: 40,
        expectedSCExpected: 70,
        expectedSCHigh: 120,
        actualSC: 65,
        status: 'COMPLETED',
        why: '주중 유휴 슬롯 6개 소진을 위한 봄맞이 프로모션 전략 수립'
      },
      {
        id: 'rb-2',
        window: '11:00 - 13:00',
        purpose: '네이버 블로그 칼럼 및 인스타그램 카드뉴스 제작',
        marketingRole: 'Content Lead',
        category: 'CONTENT_DISTRIBUTION',
        triggerType: 'SCHEDULED',
        expectedSCLow: 250,
        expectedSCExpected: 380,
        expectedSCHigh: 520,
        actualSC: 360,
        status: 'COMPLETED',
        why: '청라 봄맞이 자연눈썹 맞춤 가이드 2,400자 칼럼 및 고화질 AI 시안 생성'
      },
      {
        id: 'rb-3',
        window: '14:00 - 16:00',
        purpose: '스마트에디터 ONE 자동화 발행 & 사전 품질 게이트',
        marketingRole: 'Quality Gate & Growth Operator',
        category: 'CONTENT_DISTRIBUTION',
        triggerType: 'SCHEDULED',
        expectedSCLow: 180,
        expectedSCExpected: 240,
        expectedSCHigh: 320,
        status: 'RUNNING',
        why: '브랜드 가이드 검증 및 네이버 블로그/당근마켓 발행용 원고 준비'
      },
      {
        id: 'rb-4',
        window: '16:30 - 18:00',
        purpose: '인스타그램 DM 및 당근 채팅 문의 실시간 전환 응대',
        marketingRole: 'CRM & Retention Manager',
        category: 'CUSTOMER_CONVERSION_CRM',
        triggerType: 'EVENT_DRIVEN',
        expectedSCLow: 100,
        expectedSCExpected: 180,
        expectedSCHigh: 260,
        status: 'PENDING',
        why: '시술 직후 3일차 관리 팁 발송 및 잔흔 커버 상담 전환 안내'
      },
      {
        id: 'rb-5',
        window: '19:00 - 21:00',
        purpose: '네이버 플레이스 리뷰 모니터링 & 감사 답변',
        marketingRole: 'Reputation Manager',
        category: 'REPUTATION_LOCAL',
        triggerType: 'SCHEDULED',
        expectedSCLow: 60,
        expectedSCExpected: 90,
        expectedSCHigh: 140,
        status: 'PENDING',
        why: '최근 방문 고객 5점 포토 후기 감사 답변 및 재방문 혜택 안내'
      },
      {
        id: 'rb-6',
        window: '21:30 - 22:30',
        purpose: '외부 URL HTTP 200 검증 & 마케팅 기여도 결산',
        marketingRole: 'Marketing Analyst',
        category: 'ANALYTICS_VERIFICATION',
        triggerType: 'SCHEDULED',
        expectedSCLow: 40,
        expectedSCExpected: 70,
        expectedSCHigh: 110,
        status: 'PENDING',
        why: '발행된 외부 링크 200 OK 실존 검증 및 주간 예약 전환 매출 집계'
      }
    ]

    const portfolioMix: ActivityPortfolioMix[] = [
      {
        category: 'STRATEGY_MARKET',
        name: '전략 & 시장 탐지',
        plannedSC: 70,
        actualSC: 65,
        sharePercentage: 7
      },
      {
        category: 'CONTENT_DISTRIBUTION',
        name: '콘텐츠 기획·제작·배포',
        plannedSC: 620,
        actualSC: 360,
        sharePercentage: 58,
        dominanceReason: '봄맞이 신규 유치 집중을 위해 네이버 블로그 및 고화질 AI 실사 제작에 집중 배정'
      },
      {
        category: 'CUSTOMER_CONVERSION_CRM',
        name: '고객 응대 & 예약 전환',
        plannedSC: 180,
        actualSC: 0,
        sharePercentage: 17
      },
      {
        category: 'REPUTATION_LOCAL',
        name: '평판 & 지역 플레이스',
        plannedSC: 90,
        actualSC: 0,
        sharePercentage: 9
      },
      {
        category: 'EXPERIMENT_LEARNING',
        name: '실험 & A/B 학습',
        plannedSC: 60,
        actualSC: 0,
        sharePercentage: 5
      },
      {
        category: 'ANALYTICS_VERIFICATION',
        name: '결과 검증 & 성과 분석',
        plannedSC: 70,
        actualSC: 0,
        sharePercentage: 4
      }
    ]

    const plannedSCLow = routineBlocks.reduce((sum, r) => sum + r.expectedSCLow, 0)
    const plannedSCExpected = routineBlocks.reduce((sum, r) => sum + r.expectedSCExpected, 0)
    const plannedSCHigh = routineBlocks.reduce((sum, r) => sum + r.expectedSCHigh, 0)
    const projectedEnd = Math.max(0, availableSC + expectedRefill24h - 3500)

    return {
      workspaceId: account.workspaceId,
      localDate: new Date().toISOString().split('T')[0],
      operatingMode: mode,
      startingAvailableSC: availableSC,
      expectedRefillSC24h: expectedRefill24h,
      alreadyReservedSC: account.reservedSC,
      plannedSCLow,
      plannedSCExpected,
      plannedSCHigh,
      projectedEndBalanceExpected: Math.round(projectedEnd),
      forecastConfidence: 0.94,
      lastReforecastAt: '16:00',
      forecastChangeReason: `${workspaceName} 실시간 가용 크레딧 및 상권 변동 반영`,
      routineBlocks,
      portfolioMix
    }
  }
}
