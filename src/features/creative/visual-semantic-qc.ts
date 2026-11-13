/**
 * Visual Semantic QC Gate (ANI-1078)
 * Verifies semantic alignment between Caption, Visual Brief, and Generated MediaAsset.
 * Enforces Fail-Closed gate: Only QC PASS assets can be admitted for publishing.
 */

import type { MediaAsset } from '../media/media-asset-types'
import type { VisualBrief, IndustryDomain } from './visual-brief-types'

export type QCDecision = 'PASS' | 'REVIEW_REQUIRED' | 'FAIL'

export interface VisualSemanticQCResult {
  decision: QCDecision
  score: number // 0.0 to 1.0
  passed: boolean
  reasons: string[]
  violations: string[]
  evidence: {
    captionKeywords: string[]
    briefHeroSubject: string
    mediaProvenance: string
    mediaSha256: string
    checkedRules: string[]
  }
  evaluatedAt: string
}

export interface QCInput {
  caption: string
  visualBrief: VisualBrief
  mediaAsset: MediaAsset
}

const INCONGRUENT_MEDIA_MARKERS: Record<IndustryDomain, string[]> = {
  bakery: [
    'salon', 'hair', 'eyebrow', 'eyelash', 'beauty', 'spa', 'microblading',
    'clinic', 'dermatology', 'botox', 'laser', 'watermark', 'shutterstock', 'getty', 'stock',
    '살롱', '미용실', '눈썹', '반영구', '피부과', '클리닉', '워터마크'
  ],
  beauty: ['bakery', 'tart', 'bread', 'cake', 'pastry', '타르트', '케이크', '소금빵', 'watermark', '워터마크'],
  cafe: ['salon', 'hair', 'eyebrow', 'eyelash', 'clinic', 'watermark'],
  general: ['watermark', 'shutterstock', 'getty', '워터마크'],
}

export function evaluateVisualSemanticQC(input: QCInput): VisualSemanticQCResult {
  const { caption, visualBrief, mediaAsset } = input
  const reasons: string[] = []
  const violations: string[] = []
  const checkedRules: string[] = []

  let score = 1.0
  const industry = visualBrief.businessContext.industry

  // 1. Media Provenance & Integrity Rule
  checkedRules.push('RULE_PROVENANCE_VALIDITY')
  if (mediaAsset.source_type.startsWith('LEGACY_')) {
    violations.push('LEGACY_ASSET_DISALLOWED_FOR_NEW_PUBLISH')
    reasons.push(`Asset provenance kind "${mediaAsset.source_type}" is not eligible for production publishing.`)
    score -= 0.5
  }

  if (!mediaAsset.sha256_digest || !/^[a-f0-9]{64}$/i.test(mediaAsset.sha256_digest)) {
    violations.push('INVALID_SHA256_DIGEST')
    reasons.push('Media asset is missing valid 64-char SHA-256 digest.')
    score -= 0.5
  }

  if (mediaAsset.lifecycle_status !== 'READY' && mediaAsset.lifecycle_status !== 'ACTIVE') {
    violations.push('INVALID_LIFECYCLE_STATUS')
    reasons.push(`Media asset lifecycle status is "${mediaAsset.lifecycle_status}", expected READY or ACTIVE.`)
    score -= 0.4
  }

  // 2. Cross-Domain Incongruence Rule (Tart vs Salon check)
  checkedRules.push('RULE_DOMAIN_CONGRUENCE')
  const assetPathLower = mediaAsset.object_path.toLowerCase()
  const metadataStr = JSON.stringify(mediaAsset.generation_metadata || {}).toLowerCase()

  const incongruentMarkers = industry ? (INCONGRUENT_MEDIA_MARKERS[industry] || []) : []
  for (const marker of incongruentMarkers) {
    const isKorean = /[가-힣]/.test(marker)
    const matchesPath = isKorean
      ? assetPathLower.includes(marker)
      : new RegExp(`(^|[^a-z0-9])${marker}([^a-z0-9]|$)`, 'i').test(assetPathLower)
    const matchesMeta = isKorean
      ? metadataStr.includes(marker)
      : new RegExp(`(^|[^a-z0-9])${marker}([^a-z0-9]|$)`, 'i').test(metadataStr)

    if (matchesPath || matchesMeta) {
      violations.push('DOMAIN_INCONGRUENCE_DETECTED')
      reasons.push(
        `Critical domain incongruence: Asset metadata or path contains "${marker}" which is forbidden in ${industry || 'unknown'} domain.`
      )
      score = 0.0
      break
    }
  }

  // 3. Hero Product Match Rule
  checkedRules.push('RULE_HERO_PRODUCT_MATCH')
  const normalizedCaption = caption.toLowerCase()
  const rawProductName = visualBrief.productContext?.name
  const productTokens = rawProductName
    ? rawProductName.toLowerCase().split(/\s+/).filter(t => t.length >= 2)
    : []

  if (rawProductName) {
    const productName = rawProductName.toLowerCase()
    const heroSubject = visualBrief.creativeDirection.heroSubject.toLowerCase()

    const isProductMentionedInCaption = productTokens.some(t => normalizedCaption.includes(t))
    const isProductInHero = heroSubject.includes(productName) || productTokens.some(t => heroSubject.includes(t))

    if (!isProductInHero) {
      violations.push('HERO_SUBJECT_PRODUCT_MISMATCH')
      reasons.push(`Hero subject "${visualBrief.creativeDirection.heroSubject}" does not represent product "${rawProductName}".`)
      score -= 0.4
    }

    if (!isProductMentionedInCaption && productTokens.length > 0) {
      // Caption mentions a completely different product class?
      const commonDesserts = ['타르트', '스콘', '마카롱', '휘낭시에', '소금빵']
      const captionDesserts = commonDesserts.filter(d => normalizedCaption.includes(d))
      const productDesserts = commonDesserts.filter(d => productName.includes(d))
      if (captionDesserts.length > 0 && productDesserts.length > 0) {
        const match = captionDesserts.some(d => productDesserts.includes(d))
        if (!match) {
          violations.push('CAPTION_PRODUCT_DISCREPANCY')
          reasons.push(`Caption features [${captionDesserts.join(', ')}] but media hero product is [${rawProductName}].`)
          score = 0.0
        }
      }
    }
  }

  // 4. Decision Formulation
  score = Math.max(0.0, Math.min(1.0, score))
  let decision: QCDecision = 'PASS'
  if (violations.length > 0 || score < 0.7) {
    decision = score <= 0.3 || violations.includes('DOMAIN_INCONGRUENCE_DETECTED') || violations.includes('LEGACY_ASSET_DISALLOWED_FOR_NEW_PUBLISH')
      ? 'FAIL'
      : 'REVIEW_REQUIRED'
  }

  return {
    decision,
    score,
    passed: decision === 'PASS',
    reasons,
    violations,
    evidence: {
      captionKeywords: productTokens,
      briefHeroSubject: visualBrief.creativeDirection.heroSubject,
      mediaProvenance: mediaAsset.source_type,
      mediaSha256: mediaAsset.sha256_digest,
      checkedRules,
    },
    evaluatedAt: new Date().toISOString(),
  }
}
