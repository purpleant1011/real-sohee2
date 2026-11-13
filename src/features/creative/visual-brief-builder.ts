import { createHash } from 'node:crypto'
import type {
  VisualBrief,
  VisualBriefBuilderInput,
  IndustryDomain,
  ImageAspectRatio,
  CreativeDirection,
  NegativeConstraints,
} from './visual-brief-types'
import { VisualBriefValidationError } from './visual-brief-types'

const DOMAIN_FORBIDDEN_KEYWORDS: Record<IndustryDomain, string[]> = {
  bakery: [
    '속눈썹', '눈썹', '반영구', '헤어', '미용실', '살롱', '네일', '에스테틱', 
    'eyebrow', 'eyelash', 'microblading', 'hair salon', 'nail art', 'beauty parlor'
  ],
  beauty: [
    '타르트', '케이크', '베이커리', '소금빵', '휘낭시에', '마카롱', '스콘', '빵집', '디저트',
    'tart', 'cake', 'bakery', 'croissant', 'dessert', 'baking', 'pastry'
  ],
  cafe: [
    '속눈썹', '눈썹', '반영구', '헤어', '미용실', '살롱', '네일',
    'eyebrow', 'eyelash', 'microblading', 'hair salon'
  ],
  general: [],
}

const DEFAULT_ASPECT_RATIOS: Record<string, ImageAspectRatio> = {
  instagram: '1:1',
  threads: '1:1',
  naver_blog: '16:9',
}

export function calculatePromptDigest(promptText: string): string {
  return createHash('sha256').update(promptText.trim(), 'utf8').digest('hex')
}

export function validateDomainContamination(
  industry: IndustryDomain | undefined,
  textToScan?: string,
): void {
  if (!industry || !textToScan) return
  const forbidden = DOMAIN_FORBIDDEN_KEYWORDS[industry] || []
  const lower = textToScan.toLowerCase()
  for (const kw of forbidden) {
    if (lower.includes(kw.toLowerCase())) {
      throw new VisualBriefValidationError(
        `Cross-domain pollution detected: Keyword "${kw}" is forbidden for industry "${industry}".`,
        'CROSS_DOMAIN_CONTAMINATION_DETECTED'
      )
    }
  }
}

export function validateCaptionProductMatch(
  caption: string,
  productName?: string,
): void {
  if (!productName || productName.trim().length === 0) {
    // If product name is unconfirmed, skip hero product matching rather than throwing or inventing fake facts
    return
  }

  // If caption mentions a product name or primary ingredients, hero subject must be aligned
  const normalizedCaption = caption.replace(/\s+/g, ' ').toLowerCase()
  const normalizedProduct = productName.trim().toLowerCase()

  // Simple token check: at least one substantial token of product name must appear in caption or vice versa
  const productTokens = normalizedProduct.split(/\s+/).filter(t => t.length >= 2)
  const matches = productTokens.some(token => normalizedCaption.includes(token))

  if (productTokens.length > 0 && !matches) {
    // If the caption does not mention the product name at all, check if caption has specific product keywords that mismatch
    const commonDesserts = ['타르트', '스콘', '마카롱', '휘낭시에', '소금빵', '식빵', '크루아상']
    const captionDesserts = commonDesserts.filter(d => normalizedCaption.includes(d))
    const productDesserts = commonDesserts.filter(d => normalizedProduct.includes(d))

    if (captionDesserts.length > 0 && productDesserts.length > 0) {
      const hasOverlap = captionDesserts.some(d => productDesserts.includes(d))
      if (!hasOverlap) {
        throw new VisualBriefValidationError(
          `Caption refers to [${captionDesserts.join(', ')}] but product is [${productName}]. Hero subject mismatch.`,
          'CAPTION_HERO_MISMATCH'
        )
      }
    }
  }
}

import { validateWorkspaceContextEnvelope } from '@/features/workspace/workspace-context-envelope'

export function buildVisualBrief(input: VisualBriefBuilderInput): VisualBrief {
  const {
    workspaceId,
    contentVersionId,
    businessContext,
    productContext,
    channel,
    caption,
    customDirection,
    envelope,
    learnedVisualContext,
  } = input

  if (!workspaceId) throw new VisualBriefValidationError('Workspace ID is required', 'WORKSPACE_REQUIRED')
  if (!contentVersionId) throw new VisualBriefValidationError('ContentVersion ID is required', 'CONTENT_VERSION_REQUIRED')

  if (envelope) {
    if (envelope.workspaceId !== workspaceId) {
      throw new VisualBriefValidationError(
        `Envelope workspace ID mismatch: input is "${workspaceId}", but envelope is "${envelope.workspaceId}".`,
        'ENVELOPE_WORKSPACE_MISMATCH'
      )
    }
    validateWorkspaceContextEnvelope(envelope)
  }

  const effectiveBusinessContext = envelope
    ? {
        name: envelope.businessName,
        industry: envelope.industry,
        keywords: envelope.keywords,
        targetAudience: businessContext?.targetAudience || undefined,
        location: envelope.location || undefined,
      }
    : businessContext

  if (!effectiveBusinessContext?.name) throw new VisualBriefValidationError('Business name is required', 'BUSINESS_NAME_REQUIRED')

  // 1. Cross-domain contamination checks
  validateDomainContamination(effectiveBusinessContext.industry, caption)
  if (productContext?.name) {
    validateDomainContamination(effectiveBusinessContext.industry, productContext.name)
  }
  if (productContext?.description) {
    validateDomainContamination(effectiveBusinessContext.industry, productContext.description)
  }

  // 2. Caption-Hero consistency
  validateCaptionProductMatch(caption, productContext?.name)

  // 3. Determine Aspect Ratio
  const aspectRatio = DEFAULT_ASPECT_RATIOS[channel] ?? '1:1'

  // 4. Creative Direction Assembly
  const defaultSubject = productContext?.name
    ? `${effectiveBusinessContext.name}의 ${productContext.name}`
    : `${effectiveBusinessContext.name}`
  const defaultComposition = effectiveBusinessContext.industry === 'bakery'
    ? 'Top-down flat lay or 45-degree appetizing hero angle, shallow depth of field'
    : effectiveBusinessContext.industry
    ? 'Clean balanced commercial hero angle, natural depth of field'
    : undefined
  const defaultEnvironment = effectiveBusinessContext.industry === 'bakery'
    ? 'Warm, cozy boutique bakery counter with clean marble or wooden textured tabletop, natural warm afternoon window sunlight'
    : undefined
  const defaultLighting = effectiveBusinessContext.industry === 'bakery'
    ? 'Soft natural golden hour sunlight, gentle shadows, premium editorial highlight'
    : undefined
  const defaultColorPalette = effectiveBusinessContext.industry === 'bakery'
    ? ['#F7DC6F', '#BA4A00', '#FDFEFE', '#D35400']
    : []

  const creativeDirection: CreativeDirection = {
    heroSubject: customDirection?.heroSubject || defaultSubject,
    composition: customDirection?.composition || defaultComposition,
    environment: customDirection?.environment || defaultEnvironment,
    lighting: customDirection?.lighting || defaultLighting,
    colorPalette: customDirection?.colorPalette || defaultColorPalette,
    stylePreset: customDirection?.stylePreset || 'editorial_photography',
  }

  // 5. Negative Constraints (No Text in image to prevent AI gibberish text on Instagram)
  const negativeConstraints: NegativeConstraints = {
    forbiddenTokens: [
      'distorted text', 'gibberish letters', 'watermark', 'ugly hands', 'artificial CGI plastic sheen',
      ...(effectiveBusinessContext.industry ? DOMAIN_FORBIDDEN_KEYWORDS[effectiveBusinessContext.industry] || [] : []),
    ],
    textRendering: 'NO_TEXT_IN_IMAGE',
    prohibitedDomains: effectiveBusinessContext.industry === 'bakery' ? ['beauty'] : effectiveBusinessContext.industry === 'beauty' ? ['bakery', 'cafe'] : [],
  }

  // 6. Generate detailed English/Korean hybrid prompt tailored for OpenAI image models (e.g. gpt-image-2.5)
  const promptParts: string[] = [
    `Ultra-high resolution authentic commercial editorial photograph.`,
  ]

  if (productContext?.name && productContext.name.trim().length > 0) {
    promptParts.push(`Hero Subject: ${productContext.name} (${effectiveBusinessContext.name}). High-end commercial visual presentation.`)
  } else {
    promptParts.push(`Hero Subject: Commercial visual scene for ${effectiveBusinessContext.name}.`)
  }

  if (productContext?.ingredientsOrMaterials && productContext.ingredientsOrMaterials.length > 0) {
    promptParts.push(`Key elements visibly featured: ${productContext.ingredientsOrMaterials.join(', ')}.`)
  }

  if (creativeDirection.environment) {
    promptParts.push(`Environment & Setting: ${creativeDirection.environment}.`)
  }
  if (creativeDirection.lighting) {
    promptParts.push(`Lighting: ${creativeDirection.lighting}.`)
  }
  if (creativeDirection.composition) {
    promptParts.push(`Composition: ${creativeDirection.composition}.`)
  }

  if (effectiveBusinessContext.industry) {
    promptParts.push(`Style: High-end lifestyle magazine commercial editorial, rich textures, authentic crisp details, 8k photo.`)
  } else {
    promptParts.push(`Style: Authentic photograph with natural clarity and crisp textures, 8k photo.`)
  }

  // Learned visual style from approved receipts (never claiming to restore proprietary harness/prompt)
  if (learnedVisualContext?.imageStyle && learnedVisualContext.imageStyle.trim().length > 0) {
    promptParts.push(
      `Learned visual style guidance from approved channel observation: ${learnedVisualContext.imageStyle.trim()}.`
    )
  }

  promptParts.push(`Strict constraint: Clean clean scene, absolutely NO letters, NO words, NO typo, NO watermark, NO logo.`)

  const promptText = promptParts.join(' ')
  const promptDigest = calculatePromptDigest(promptText)

  return {
    briefVersion: 'v10.0',
    workspaceId,
    contentVersionId,
    businessContext: effectiveBusinessContext,
    productContext,
    channelSpec: {
      channel,
      aspectRatio,
    },
    creativeDirection,
    negativeConstraints,
    captionSummary: caption.slice(0, 100),
    promptText,
    promptDigest,
    createdAt: new Date().toISOString(),
    contextProvenance: envelope ? {
      fingerprint: envelope.contextFingerprint,
      businessProfileVersion: envelope.businessProfileVersion,
      brandVersion: envelope.brandVersion,
    } : undefined,
    learningProvenance: learnedVisualContext ? {
      epoch: learnedVisualContext.epoch,
      dependencies: learnedVisualContext.dependencies,
    } : undefined,
  }
}
