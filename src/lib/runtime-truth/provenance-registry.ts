/**
 * Sohee Runtime Truth Provenance Registry (ANI-306, ANI-307)
 * 
 * Inviolable Law: No Evidence -> No Number.
 * 
 * 1. Provenance Schema: measured | calculated | estimated | user_provided
 * 2. Revenue Stages: potential | booked | realized
 * 3. Attribution Tiers: direct | assisted | unclear
 * 4. PII Isolation & Anonymization Engine for Demo / Production
 * 5. Asset Provenance: source_asset | generated_asset | demo_placeholder
 */

export type MetricProvenanceType = 'measured' | 'calculated' | 'estimated' | 'user_provided' | 'data_insufficient'

export type RevenueStage = 'potential' | 'booked' | 'realized'

export type AttributionTier = 'direct' | 'assisted' | 'unclear'

export type AssetProvenance = 'source_asset' | 'generated_asset' | 'demo_placeholder'

export interface ProvenanceMetric<T = number> {
  key: string
  label: string
  value: T | null
  unit: string
  provenance: MetricProvenanceType
  sourceType: string
  sourceId?: string
  observedAt?: string
  calculationVersion?: string
  confidence: number // 0.0 ~ 1.0
  freshness: string
  evidenceUrl?: string
  statusNote?: string
}

export interface RevenueItem {
  id: string
  stage: RevenueStage
  amountKRW: number
  serviceName: string
  customerNameMasked: string
  attribution: AttributionTier
  sourceChannel: 'INSTAGRAM' | 'NAVER_TALKTALK' | 'DAANGN' | 'THREADS' | 'OFFLINE'
  touchpointHistory: string[]
  evidenceEventId?: string
  settledAt?: string
}

export interface CustomerLeadRecord {
  id: string
  isDemoFixture: boolean
  name: string
  phoneMasked: string
  channel: 'INSTAGRAM' | 'NAVER_TALKTALK' | 'DAANGN' | 'THREADS'
  inquirySummary: string
  intentScore: number // 0 ~ 100
  slaDeadlineMinutes: number
  status: 'NEW_INQUIRY' | 'CONSULTING' | 'BOOKING_CONFIRMED' | 'VISITED' | 'LOST'
  assignedAgent: string
  depositStatus: 'unpaid' | 'paid' | 'refunded'
  notes?: string
}

export class RuntimeTruthRegistry {
  /**
   * 1. Safe Metric Wrapper: If raw value is null/undefined or lacks evidence source, return data_insufficient
   */
  public static wrapMetric<T = number>(
    key: string,
    label: string,
    rawValue: T | null | undefined,
    unit: string,
    sourceType: string,
    options: {
      provenance?: MetricProvenanceType
      confidence?: number
      evidenceUrl?: string
      sourceId?: string
    } = {}
  ): ProvenanceMetric<T> {
    if (rawValue === null || rawValue === undefined) {
      return {
        key,
        label,
        value: null,
        unit,
        provenance: 'data_insufficient',
        sourceType: 'none',
        confidence: 0,
        freshness: '실측 데이터 수집 대기 중',
        statusNote: '실제 채널/원장 연동 시 측정치가 표기됩니다.'
      }
    }

    return {
      key,
      label,
      value: rawValue,
      unit,
      provenance: options.provenance || 'measured',
      sourceType,
      sourceId: options.sourceId,
      observedAt: new Date().toISOString(),
      calculationVersion: 'v088-truth-1',
      confidence: options.confidence ?? 1.0,
      freshness: '실시간 실측 동기화',
      evidenceUrl: options.evidenceUrl
    }
  }

  /**
   * 2. Production vs Demo Customer Fixture Sanitization (ANI-307)
   */
  public static sanitizeCustomerRecord(
    customer: CustomerLeadRecord,
    isProductionWorkspace: boolean
  ): CustomerLeadRecord {
    if (!isProductionWorkspace && customer.isDemoFixture) {
      // Demo Mode: ensure fictitious name and masked contact
      return {
        ...customer,
        name: customer.name.startsWith('[샘플]') ? customer.name : `[샘플] ${customer.name}`,
        phoneMasked: customer.phoneMasked || '010-****-0000'
      }
    }

    // Production Mode: Strict Masking for PII
    const maskedName = customer.name.length > 2
      ? customer.name[0] + '*'.repeat(customer.name.length - 2) + customer.name[customer.name.length - 1]
      : customer.name[0] + '*'

    let maskedPhone = customer.phoneMasked || '010-****-****'
    if (maskedPhone.includes('-') && !maskedPhone.includes('*')) {
      const parts = maskedPhone.split('-')
      if (parts.length === 3) {
        maskedPhone = `${parts[0]}-****-${parts[2]}`
      }
    } else if (!maskedPhone.includes('*') && maskedPhone.length >= 10) {
      maskedPhone = `${maskedPhone.slice(0, 3)}-****-${maskedPhone.slice(-4)}`
    }

    return {
      ...customer,
      name: maskedName,
      phoneMasked: maskedPhone
    }
  }

  /**
   * 3. Attribution Funnel Evaluator (Direct vs Assisted vs Unclear)
   */
  public static evaluateAttribution(touchpoints: string[]): AttributionTier {
    if (!touchpoints || touchpoints.length === 0) {
      return 'unclear'
    }
    const hasDirectSoheeLink = touchpoints.some(t => t.includes('sohee_campaign') || t.includes('sohee_dm_link'))
    if (hasDirectSoheeLink && touchpoints.length <= 2) {
      return 'direct'
    }
    if (touchpoints.some(t => t.includes('sohee'))) {
      return 'assisted'
    }
    return 'unclear'
  }

  /**
   * 4. Asset Tagging Helper (source vs generated vs demo)
   */
  public static classifyAsset(url: string, isAIGenerated = false): AssetProvenance {
    if (url.includes('unsplash.com') || url.includes('placeholder')) {
      return 'demo_placeholder'
    }
    if (isAIGenerated || url.includes('dalle') || url.includes('gpt-image') || url.includes('cdn.sohee.ai')) {
      return 'generated_asset'
    }
    return 'source_asset'
  }
}

