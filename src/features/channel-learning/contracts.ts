import { z } from 'zod'

export const learningPlatforms = [
  'instagram',
  'threads',
  'naver_blog',
  'naver_place',
  'daangn_business',
  'website',
] as const

export type LearningPlatform = (typeof learningPlatforms)[number]

export const sourceRefSchema = z.object({
  workspaceId: z.string().uuid(),
  sourceId: z.string().uuid(),
  revision: z.number().int().positive(),
}).strict()

export type SourceRef = z.infer<typeof sourceRefSchema>

export const evidenceLeaseMethods = ['oauth', 'profile_marker', 'dns_txt'] as const
export type EvidenceLeaseMethod = (typeof evidenceLeaseMethods)[number]

export const evidenceLeaseSchema = sourceRefSchema.extend({
  providerAccountId: z.string().nullable(),
  method: z.enum(evidenceLeaseMethods),
  verifiedAt: z.string().datetime({ offset: true }),
  expiresAt: z.string().datetime({ offset: true }),
  revokedAt: z.string().datetime({ offset: true }).nullable(),
  evidenceRevision: z.number().int().positive(),
}).strict()

export type EvidenceLease = z.infer<typeof evidenceLeaseSchema>

export const collectionModes = ['official_api', 'safe_public', 'manual_only', 'blocked'] as const
export type CollectionMode = (typeof collectionModes)[number]

export const capabilitySchema = z.object({
  platform: z.enum(learningPlatforms),
  verificationMethods: z.array(z.enum(evidenceLeaseMethods)),
  collectionMode: z.enum(collectionModes),
  blockerCode: z.string().nullable(),
}).strict()

export type Capability = z.infer<typeof capabilitySchema>

export const verificationStatuses = ['pending', 'verified', 'expired', 'revoked', 'failed'] as const
export type VerificationStatus = (typeof verificationStatuses)[number]

export const collectionStatuses = [
  'blocked',
  'queued',
  'collecting',
  'extracting',
  'review_required',
  'partial',
  'failed',
  'cancelled',
] as const
export type CollectionStatus = (typeof collectionStatuses)[number]

export const consentRecordSchema = z.object({
  text: z.boolean(),
  images: z.boolean(),
  revision: z.number().int().positive(),
}).strict()

export type ConsentRecord = z.infer<typeof consentRecordSchema>

export const learningSourceSchema = sourceRefSchema.extend({
  platform: z.enum(learningPlatforms),
  canonicalUrl: z.string().url(),
  canonicalIdentity: z.string().min(1),
  verification: z.enum(verificationStatuses),
  collection: z.enum(collectionStatuses),
  lease: evidenceLeaseSchema.nullable(),
  consent: consentRecordSchema,
  deletedAt: z.string().datetime({ offset: true }).nullable(),
}).strict()

export type LearningSource = z.infer<typeof learningSourceSchema>

export const learningDocumentImageSchema = z.object({
  mediaId: z.string().min(1),
  url: z.string().url(),
  mimeType: z.string().min(1),
}).strict()

export type LearningDocumentImage = z.infer<typeof learningDocumentImageSchema>

export const learningDocumentSchema = z.object({
  id: z.string().uuid(),
  source: sourceRefSchema,
  providerDocumentId: z.string().min(1),
  authorAccountId: z.string().min(1),
  url: z.string().url(),
  publishedAt: z.string().datetime({ offset: true }).nullable(),
  collectedAt: z.string().datetime({ offset: true }),
  text: z.string(),
  contentHash: z.string().min(1),
  images: z.array(learningDocumentImageSchema),
}).strict()

export type LearningDocument = z.infer<typeof learningDocumentSchema>

export const candidateCategories = [
  'business',
  'offering',
  'price',
  'location',
  'hours',
  'policy',
  'faq',
  'tone',
  'content',
  'visual',
] as const
export type CandidateCategory = (typeof candidateCategories)[number]

export const evidenceStates = ['observed', 'inferred', 'recommended'] as const
export type EvidenceState = (typeof evidenceStates)[number]

export const candidateStatuses = ['review_required', 'conflict', 'approved', 'rejected'] as const
export type CandidateStatus = (typeof candidateStatuses)[number]

export const candidateEvidenceSchema = z.object({
  documentId: z.string().uuid(),
  excerpt: z.string().nullable(),
  visionReceiptId: z.string().nullable(),
}).strict()

export type CandidateEvidence = z.infer<typeof candidateEvidenceSchema>

export const learningCandidateSchema = z.object({
  id: z.string().uuid(),
  source: sourceRefSchema,
  version: z.number().int().positive(),
  category: z.enum(candidateCategories),
  content: z.string().min(1),
  evidence: candidateEvidenceSchema,
  evidenceState: z.enum(evidenceStates),
  status: z.enum(candidateStatuses),
  conflictsWithFactId: z.string().uuid().nullable(),
}).strict()

export type LearningCandidate = z.infer<typeof learningCandidateSchema>

export const learningPurposes = ['conversation', 'content', 'image'] as const
export type LearningPurpose = (typeof learningPurposes)[number]

export class LearningError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'LearningError'
    this.code = code
  }
}

const clientConsentSchema = z.object({
  text: z.boolean(),
  images: z.boolean(),
}).strict().refine((data) => data.text || data.images, {
  message: 'consent_must_agree_to_text_or_images',
})

export const registerLearningSourceSchema = z.object({
  platform: z.enum(learningPlatforms),
  url: z.string().url().max(2048),
  consent: clientConsentSchema,
}).strict()

export type RegisterLearningSourceInput = z.infer<typeof registerLearningSourceSchema>

export const reviewDecisionItemSchema = z.object({
  candidateId: z.string().uuid(),
  version: z.number().int().positive(),
  decision: z.enum(['approved', 'rejected']),
  editedContent: z.string().min(1).max(10000).optional(),
}).strict()

export type ReviewDecisionItem = z.infer<typeof reviewDecisionItemSchema>

export const reviewLearningCandidatesSchema = z.object({
  source: sourceRefSchema,
  evidenceRevision: z.number().int().positive(),
  decisions: z.array(reviewDecisionItemSchema).min(1),
}).strict()

export type ReviewLearningCandidatesInput = z.infer<typeof reviewLearningCandidatesSchema>
