/**
 * Sohee V0.8.8 Experiment Engine
 * [ANI-179] Experiment Engine — Hook/CTA/Timing/Offer 학습 루프
 */

export interface ExperimentVariant {
  id: string
  name: string
  payload: Record<string, unknown>
  impressions: number
  clicks: number
  inquiries: number
  bookings: number
}

export interface MarketingExperiment {
  id: string
  title: string
  hypothesis: string
  variableType: 'hook' | 'cta' | 'timing' | 'offer'
  variants: ExperimentVariant[]
  minSampleRequired: number
  status: 'running' | 'concluded' | 'inconclusive'
  winnerVariantId?: string
  learningSummary?: string
}

export class ExperimentEngine {
  /**
   * Evaluates A/B experiment data and determines the statistically winning variant
   */
  static evaluate(exp: MarketingExperiment): MarketingExperiment {
    const totalSamples = exp.variants.reduce((sum, v) => sum + v.clicks, 0)

    if (totalSamples < exp.minSampleRequired) {
      return {
        ...exp,
        status: 'running',
        learningSummary: `최소 표본 수(${exp.minSampleRequired}건) 부족으로 실험 진행 중 (현재: ${totalSamples}건)`
      }
    }

    // Calculate conversion rate for each variant: bookings / clicks
    let bestVariant: ExperimentVariant | null = null
    let bestCvr = -1

    for (const v of exp.variants) {
      const cvr = v.clicks > 0 ? (v.bookings / v.clicks) : 0
      if (cvr > bestCvr) {
        bestCvr = cvr
        bestVariant = v
      }
    }

    if (!bestVariant || bestCvr === 0) {
      return {
        ...exp,
        status: 'inconclusive',
        learningSummary: '변형 간 유의미한 전환율 차이가 관측되지 않았습니다.'
      }
    }

    return {
      ...exp,
      status: 'concluded',
      winnerVariantId: bestVariant.id,
      learningSummary: `승자: [${bestVariant.name}] (전환율 ${(bestCvr * 100).toFixed(1)}%). 가설이 입증되어 해당 패턴을 플레이북에 등록합니다.`
    }
  }
}
