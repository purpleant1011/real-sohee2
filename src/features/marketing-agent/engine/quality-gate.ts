/**
 * Sohee V0.8.8 Quality Gate Engine
 * [ANI-180] Marketing Quality Gate — 게시·발송 전 서버측 품질검수
 */

export interface QualityCheckResult {
  passed: boolean
  overallScore: number // 0 ~ 100
  brandFit: {
    passed: boolean
    score: number
    violations: string[]
  }
  claimSafety: {
    passed: boolean
    score: number
    unverifiedClaims: string[]
  }
  platformFit: {
    passed: boolean
    score: number
    issues: string[]
  }
  linkSafety: {
    passed: boolean
    validLinks: string[]
    brokenLinks: string[]
  }
  recommendations: string[]
}

export interface ContentPayload {
  channel: 'instagram' | 'threads' | 'naver_blog' | 'daangn'
  title?: string
  body: string
  images?: string[]
  externalLinks?: string[]
  statedPrices?: number[]
}

// Prohibited medical / exaggerated claims
const PROHIBITED_WORDS = [
  '완치',
  '영구적',
  '100% 보장',
  '부작용 전혀 없음',
  '의학적 치료',
  '성형 효과',
  '최저가 보장',
  '무조건'
]

// Known verified service facts for Byreum
const VERIFIED_PRICE_CATALOG = [100000, 120000, 150000, 180000, 200000]

export class QualityGateEngine {
  /**
   * Run full pre-publish quality inspection
   */
  static inspect(payload: ContentPayload): QualityCheckResult {
    const brandViolations: string[] = []
    const unverifiedClaims: string[] = []
    const platformIssues: string[] = []
    const brokenLinks: string[] = []
    const validLinks: string[] = []
    const recommendations: string[] = []

    const textToScan = `${payload.title || ''} ${payload.body}`

    // 1. Brand Fit & Prohibited Expressions
    for (const badWord of PROHIBITED_WORDS) {
      if (textToScan.includes(badWord)) {
        brandViolations.push(`금지/과대광고 표현 감지: "${badWord}"`)
      }
    }

    // 2. Factual & Claim Safety (Price check)
    if (payload.statedPrices && payload.statedPrices.length > 0) {
      for (const price of payload.statedPrices) {
        if (!VERIFIED_PRICE_CATALOG.includes(price)) {
          unverifiedClaims.push(`미등록 시술 가격 (${price}원)이 본문에 포함되어 있습니다.`)
        }
      }
    }

    // 3. Platform Fit Check
    const charCount = payload.body.length
    if (payload.channel === 'threads' && charCount > 500) {
      platformIssues.push(`스레드 글자 수 초과 (${charCount}/500자)`)
    } else if (payload.channel === 'instagram' && charCount > 2200) {
      platformIssues.push(`인스타그램 본문 글자 수 초과 (${charCount}/2200자)`)
    }

    if (payload.channel === 'instagram' && (!payload.images || payload.images.length === 0)) {
      platformIssues.push('인스타그램 피드는 최소 1장 이상의 이미지가 필요합니다.')
    }

    // 4. Link & UTM Safety Check
    if (payload.externalLinks && payload.externalLinks.length > 0) {
      for (const link of payload.externalLinks) {
        try {
          const parsed = new URL(link)
          if (!['http:', 'https:'].includes(parsed.protocol)) {
            brokenLinks.push(`안전하지 않은 링크 프로토콜: ${link}`)
          } else {
            validLinks.push(link)
            if (!parsed.searchParams.has('utm_source')) {
              recommendations.push(`마케팅 유입 추적을 위해 UTM 파라미터(utm_source) 추가를 권장합니다.`)
            }
          }
        } catch {
          brokenLinks.push(`잘못된 URL 형식: ${link}`)
        }
      }
    }

    // Calculate Scores
    const brandScore = Math.max(0, 100 - brandViolations.length * 25)
    const claimScore = Math.max(0, 100 - unverifiedClaims.length * 30)
    const platformScore = Math.max(0, 100 - platformIssues.length * 20)
    const linkScore = brokenLinks.length === 0 ? 100 : 0

    const overallScore = Math.round(brandScore * 0.35 + claimScore * 0.25 + platformScore * 0.25 + linkScore * 0.15)
    const passed = brandViolations.length === 0 && unverifiedClaims.length === 0 && brokenLinks.length === 0 && overallScore >= 80

    return {
      passed,
      overallScore,
      brandFit: {
        passed: brandViolations.length === 0,
        score: brandScore,
        violations: brandViolations
      },
      claimSafety: {
        passed: unverifiedClaims.length === 0,
        score: claimScore,
        unverifiedClaims
      },
      platformFit: {
        passed: platformIssues.length === 0,
        score: platformScore,
        issues: platformIssues
      },
      linkSafety: {
        passed: brokenLinks.length === 0,
        validLinks,
        brokenLinks
      },
      recommendations
    }
  }
}
