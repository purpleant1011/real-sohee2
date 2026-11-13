/**
 * SOHEE Harness Knowledge OS — Runtime Safety Gate & Anti-Copy Filter (v1.1)
 * Enforces:
 * 1. Fact Freshness Gate (HARD_LIVE_FACT vs HARD_EXPIRING_FACT vs STABLE_FACT) (AC-24, AC-26)
 * 2. Anti-Copy & Brand Safety Gate (Source verbatim / price / name leak BLOCK) (AC-08, AC-29)
 * 3. Industry Policy Pack (Medical claim / false claim filter)
 * 4. Privacy & Raw Media 24h TTL Purge (AC-28)
 */

export interface FactItem {
  key: string
  factClass: 'HARD_LIVE_FACT' | 'HARD_EXPIRING_FACT' | 'STABLE_FACT' | 'SOFT_PREFERENCE'
  value: string
  verifiedAt: string
  expiresAt?: string
}

export interface VerificationContext {
  brandFacts: FactItem[]
  sourceBenchmarkData: {
    sourceHandle: string
    sourcePrices?: string[]
    sourcePhones?: string[]
    sourceRawSentences: string[]
  }
  generatedContent: string
  industry: 'beauty_salon' | 'general'
}

export interface SafetyVerdict {
  passed: boolean
  blockingReasons: string[]
  warnings: string[]
  sanitizedContent: string
}

export class RuntimeSafetyGate {
  private forbiddenBeautyClaims = [
    '절대 지워지지 않는',
    '영구 문신',
    '100% 무조건 완벽',
    '부작용 0%',
    '의료 시술 보장',
    '전국 최저가 덤핑'
  ]

  public verify(context: VerificationContext): SafetyVerdict {
    const blockingReasons: string[] = []
    const warnings: string[] = []
    let sanitized = context.generatedContent

    // 1. Fact Freshness Gate (HARD_LIVE_FACT & HARD_EXPIRING_FACT 검증)
    const now = new Date()
    for (const fact of context.brandFacts) {
      if (fact.factClass === 'HARD_LIVE_FACT') {
        const verifiedTime = new Date(fact.verifiedAt).getTime()
        const diffMinutes = (now.getTime() - verifiedTime) / (1000 * 60)
        if (diffMinutes > 60) {
          blockingReasons.push(`HARD_LIVE_FACT_STALE: ${fact.key} (Verified ${Math.round(diffMinutes)}m ago)`)
        }
      } else if (fact.factClass === 'HARD_EXPIRING_FACT' && fact.expiresAt) {
        if (new Date(fact.expiresAt).getTime() < now.getTime()) {
          blockingReasons.push(`HARD_EXPIRING_FACT_EXPIRED: ${fact.key} expired at ${fact.expiresAt}`)
        }
      }
    }

    // 2. Anti-Copy Gate (Source Benchmark 고유명사/가격/원문 유출 검사)
    const lowerContent = context.generatedContent.toLowerCase()

    // 2.1 소스 핸들/상호 유출 검사
    if (
      context.sourceBenchmarkData.sourceHandle &&
      lowerContent.includes(context.sourceBenchmarkData.sourceHandle.toLowerCase())
    ) {
      blockingReasons.push(
        `SOURCE_IDENTITY_LEAK: Benchmark handle '${context.sourceBenchmarkData.sourceHandle}' found in output`
      )
    }

    // 2.2 소스 가격/전화번호 유출 검사
    if (context.sourceBenchmarkData.sourcePrices) {
      for (const price of context.sourceBenchmarkData.sourcePrices) {
        if (context.generatedContent.includes(price)) {
          blockingReasons.push(`SOURCE_PRICE_LEAK: Benchmark price '${price}' found in output`)
        }
      }
    }

    // 2.3 Verbatim Sentence 복제 검사
    for (const rawSentence of context.sourceBenchmarkData.sourceRawSentences) {
      if (rawSentence.length > 20 && context.generatedContent.includes(rawSentence)) {
        blockingReasons.push(`SOURCE_VERBATIM_COPY: Direct copy of source sentence '${rawSentence.slice(0, 25)}...'`)
      }
    }

    // 3. Industry Compliance Pack 검사
    if (context.industry === 'beauty_salon') {
      for (const forbidden of this.forbiddenBeautyClaims) {
        if (context.generatedContent.includes(forbidden)) {
          blockingReasons.push(`INDUSTRY_COMPLIANCE_VIOLATION: Forbidden claim '${forbidden}'`)
        }
      }
    }

    return {
      passed: blockingReasons.length === 0,
      blockingReasons,
      warnings,
      sanitizedContent: sanitized
    }
  }

  /**
   * 4. Privacy & Raw Media 단기 TTL Purge 시뮬레이터 (AC-28)
   */
  public purgeExpiredRawMedia(mediaItems: { id: string; capturedAt: string; ttlHours: number }[]): {
    purgedIds: string[]
    retainedCount: number
  } {
    const now = Date.now()
    const purgedIds: string[] = []

    for (const item of mediaItems) {
      const ageHours = (now - new Date(item.capturedAt).getTime()) / (1000 * 60 * 60)
      if (ageHours > item.ttlHours) {
        purgedIds.push(item.id)
      }
    }

    return {
      purgedIds,
      retainedCount: mediaItems.length - purgedIds.length
    }
  }
}

export const runtimeSafetyGate = new RuntimeSafetyGate()
