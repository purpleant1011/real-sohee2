/**
 * Visual Brief Domain Types & Constraints (ANI-1074)
 * Business-aware Visual Brief Contract for GPT Image 2 Generation
 */

export type IndustryDomain = 'bakery' | 'beauty' | 'cafe' | 'general'

export type TargetChannel = 'instagram' | 'threads' | 'naver_blog'

export type ImageAspectRatio = '1:1' | '4:5' | '16:9'

export interface BusinessContext {
  name: string
  industry?: IndustryDomain
  keywords?: string[]
  targetAudience?: string
  location?: string
}

export interface ProductContext {
  name?: string
  description?: string
  ingredientsOrMaterials?: string[]
  sellingPoints?: string[]
}

export interface CreativeDirection {
  heroSubject: string
  composition?: string
  environment?: string
  lighting?: string
  colorPalette: string[]
  stylePreset: 'editorial_photography' | 'lifestyle_candid' | 'commercial_product' | 'artisan_craft'
}

export interface NegativeConstraints {
  forbiddenTokens: string[]
  textRendering: 'NO_TEXT_IN_IMAGE' | 'OPTIONAL_TEXT'
  prohibitedDomains: IndustryDomain[]
}

import type { WorkspaceContextEnvelope } from '@/features/workspace/workspace-context-envelope'

export interface VisualBrief {
  briefVersion: string
  workspaceId: string
  contentVersionId: string
  businessContext: BusinessContext
  productContext: ProductContext
  channelSpec: {
    channel: TargetChannel
    aspectRatio: ImageAspectRatio
  }
  creativeDirection: CreativeDirection
  negativeConstraints: NegativeConstraints
  captionSummary: string
  promptText: string
  promptDigest: string // SHA-256 hex string of promptText
  createdAt: string
  contextProvenance?: {
    fingerprint: string
    businessProfileVersion: number
    brandVersion: number
  }
  learningProvenance?: {
    epoch?: number
    dependencies?: Array<{ workspaceId: string; sourceId: string; revision: number }>
  }
}

export interface VisualBriefBuilderInput {
  workspaceId: string
  contentVersionId: string
  businessContext: BusinessContext
  productContext: ProductContext
  channel: TargetChannel
  caption: string
  customDirection?: Partial<CreativeDirection>
  envelope?: WorkspaceContextEnvelope
  learnedVisualContext?: {
    imageStyle?: string | null
    dependencies?: Array<{ workspaceId: string; sourceId: string; revision: number }>
    epoch?: number
  }
}

export class VisualBriefValidationError extends Error {
  readonly code: string
  constructor(message: string, code = 'VISUAL_BRIEF_INVALID') {
    super(message)
    this.name = 'VisualBriefValidationError'
    this.code = code
  }
}
