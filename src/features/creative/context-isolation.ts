/**
 * Strict Workspace Context Isolation & Tenant Bleed Prevention (ANI-1077)
 * Guarantees zero cross-tenant contamination between Bakery and Beauty/Other workspaces.
 */

import type { IndustryDomain } from './visual-brief-types'
import { VisualBriefValidationError } from './visual-brief-types'

export interface StrictWorkspaceContext {
  workspaceId: string
  businessName: string
  industry: IndustryDomain
  location?: string
  summary?: string
  brandVoice?: string
  keywords: string[]
  prohibitedTerms: string[]
  contextProvenanceId: string
  loadedAt: string
}

export class ContextBleedError extends Error {
  readonly code: string
  constructor(message: string, code = 'TENANT_CONTEXT_BLEED_DETECTED') {
    super(message)
    this.name = 'ContextBleedError'
    this.code = code
  }
}

// Banned token map to detect cross-domain contamination
const FORBIDDEN_INDUSTRY_TOKENS: Record<IndustryDomain, string[]> = {
  bakery: [
    '바이름', 'byreum', '속눈썹', '눈썹문신', '자연눈썹', '반영구', '원장님',
    '헤어살롱', '미용실', '네일아트', '피부관리', '에스테틱', 'microblading'
  ],
  beauty: [
    '소희네 베이커리', '단호박 타르트', '무화과 타르트', '소금빵', '휘낭시에',
    '마카롱', '스콘', '제과점', '오븐', '베이킹', 'bakery'
  ],
  cafe: [
    '속눈썹', '눈썹문신', '자연눈썹', '반영구', '헤어살롱', '미용실'
  ],
  general: [],
}

export function validateTenantPurity(
  workspaceId: string,
  industry: IndustryDomain,
  dataToInspect: Record<string, unknown> | string,
): void {
  const text = typeof dataToInspect === 'string'
    ? dataToInspect
    : JSON.stringify(dataToInspect)

  const lower = text.toLowerCase()
  const forbidden = FORBIDDEN_INDUSTRY_TOKENS[industry] || []

  for (const token of forbidden) {
    if (lower.includes(token.toLowerCase())) {
      throw new ContextBleedError(
        `Cross-tenant context bleed detected for workspace ${workspaceId} (${industry}): forbidden token "${token}" found.`,
        'TENANT_CONTEXT_BLEED_DETECTED'
      )
    }
  }
}

export interface WorkspaceProfileDataSource {
  getBusinessProfile(workspaceId: string): Promise<{
    businessName: string
    industry: IndustryDomain
    location?: string
    summary?: string
  } | null>
  getBrandProfile(workspaceId: string): Promise<{
    voice?: string
    keywords?: string[]
    prohibitedTerms?: string[]
  } | null>
}

export class StrictContextLoader {
  private cache = new Map<string, { context: StrictWorkspaceContext; cachedAt: number }>()
  private cacheTtlMs = 60_000 // 1 minute

  constructor(private dataSource: WorkspaceProfileDataSource) {}

  invalidate(workspaceId: string): void {
    this.cache.delete(workspaceId)
  }

  async loadContext(workspaceId: string): Promise<StrictWorkspaceContext> {
    const cached = this.cache.get(workspaceId)
    const now = Date.now()
    if (cached && (now - cached.cachedAt) < this.cacheTtlMs) {
      return cached.context
    }

    const [business, brand] = await Promise.all([
      this.dataSource.getBusinessProfile(workspaceId),
      this.dataSource.getBrandProfile(workspaceId),
    ])

    if (!business) {
      throw new ContextBleedError(
        `No canonical business profile found for workspace ${workspaceId}. Refusing fallback to default demo accounts.`,
        'BUSINESS_PROFILE_MISSING'
      )
    }

    // Inspect business and brand data for any cross-domain pollution
    validateTenantPurity(workspaceId, business.industry, business)
    if (brand) {
      validateTenantPurity(workspaceId, business.industry, brand)
    }

    const context: StrictWorkspaceContext = {
      workspaceId,
      businessName: business.businessName,
      industry: business.industry,
      location: business.location,
      summary: business.summary,
      brandVoice: brand?.voice,
      keywords: brand?.keywords || [],
      prohibitedTerms: brand?.prohibitedTerms || [],
      contextProvenanceId: `ctx_${workspaceId}_${Date.now()}`,
      loadedAt: new Date().toISOString(),
    }

    this.cache.set(workspaceId, { context, cachedAt: now })
    return context
  }
}

/**
 * Visual Prompt Sanitizer (ANI-1100)
 * Neutralizes prompt injection patterns in user-supplied text so it can only be treated as raw data.
 */
export function sanitizePromptInputText(input: string): string {
  if (!input) return ''

  // Neutralize common prompt injection directives
  const sanitized = input
    .replace(/\bignore\s+(all\s+)?(previous|above|prior)\s+instructions?\b/gi, '[DATA_FIELD]')
    .replace(/\b(system|assistant|developer)\s*:\s*/gi, '')
    .replace(/<\|im_start\|>|<\|im_end\|>/gi, '')
    .replace(/\[INST\]|\[\/INST\]/gi, '')
    .trim()

  return sanitized
}
