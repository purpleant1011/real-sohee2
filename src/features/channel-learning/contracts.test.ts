import { describe, expect, it } from 'vitest'
import {
  capabilitySchema,
  evidenceLeaseSchema,
  learningCandidateSchema,
  learningDocumentSchema,
  learningPlatforms,
  learningSourceSchema,
  registerLearningSourceSchema,
  reviewLearningCandidatesSchema,
} from './contracts'
import {
  sampleCapabilities,
  tenantACandidate,
  tenantADocument,
  tenantALease,
  tenantASource,
  tenantBCandidate,
  tenantBDocument,
  tenantBLease,
  tenantBSource,
} from './test-fixtures'

describe('channel-learning contracts', () => {
  it('rejects_client_verified_status', () => {
    // Client attempts to send server-derived verification/status or revision
    const result = registerLearningSourceSchema.safeParse({
      platform: 'instagram',
      url: 'https://www.instagram.com/my_business/',
      consent: { text: true, images: false },
      verification: 'verified', // client claim should be rejected by strict schema
    })
    expect(result.success).toBe(false)
  })

  it('rejects_empty_consent', () => {
    // Consent where neither text nor images is agreed must be rejected
    const result = registerLearningSourceSchema.safeParse({
      platform: 'instagram',
      url: 'https://www.instagram.com/my_business/',
      consent: { text: false, images: false },
    })
    expect(result.success).toBe(false)
  })

  it('accepts_supported_platforms', () => {
    for (const platform of learningPlatforms) {
      const result = registerLearningSourceSchema.safeParse({
        platform,
        url: 'https://example.com/channel',
        consent: { text: true, images: true },
      })
      expect(result.success).toBe(true)
    }
  })

  it('reviewLearningCandidatesSchema rejects forged server status and empty decisions', () => {
    const emptyDecisions = reviewLearningCandidatesSchema.safeParse({
      source: {
        workspaceId: '10000000-0000-4000-8000-000000000001',
        sourceId: '20000000-0000-4000-8000-000000000001',
        revision: 1,
      },
      evidenceRevision: 1,
      decisions: [],
    })
    expect(emptyDecisions.success).toBe(false)

    const forgedStatus = reviewLearningCandidatesSchema.safeParse({
      source: {
        workspaceId: '10000000-0000-4000-8000-000000000001',
        sourceId: '20000000-0000-4000-8000-000000000001',
        revision: 1,
      },
      evidenceRevision: 1,
      status: 'approved', // client trying to set root status
      decisions: [
        {
          candidateId: '30000000-0000-4000-8000-000000000001',
          version: 1,
          decision: 'approved',
        },
      ],
    })
    expect(forgedStatus.success).toBe(false)
  })

  it('validates deterministic two-tenant fixtures against schemas', () => {
    expect(evidenceLeaseSchema.safeParse(tenantALease).success).toBe(true)
    expect(evidenceLeaseSchema.safeParse(tenantBLease).success).toBe(true)

    expect(learningSourceSchema.safeParse(tenantASource).success).toBe(true)
    expect(learningSourceSchema.safeParse(tenantBSource).success).toBe(true)

    expect(learningDocumentSchema.safeParse(tenantADocument).success).toBe(true)
    expect(learningDocumentSchema.safeParse(tenantBDocument).success).toBe(true)

    expect(learningCandidateSchema.safeParse(tenantACandidate).success).toBe(true)
    expect(learningCandidateSchema.safeParse(tenantBCandidate).success).toBe(true)

    for (const cap of sampleCapabilities) {
      expect(capabilitySchema.safeParse(cap).success).toBe(true)
    }
  })
})
