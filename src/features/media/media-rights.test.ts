import { describe, expect, it } from 'vitest'
import { evaluateUploadRights, canPublishUploadedMedia } from './media-rights'

const confirmed = { copyright: 'owned', commercialUse: true, identifiablePeople: 'none', consentReference: null } as const

describe('uploaded photo rights (ANI-1594)', () => {
  it('requires positive commercial and copyright evidence, not a checkbox default', () => {
    expect(evaluateUploadRights({ ...confirmed, copyright: 'unknown' }).publishEligible).toBe(false)
    expect(evaluateUploadRights({ ...confirmed, commercialUse: false }).publishEligible).toBe(false)
    expect(evaluateUploadRights(confirmed)).toMatchObject({ rightsStatus: 'confirmed', publishEligible: true })
  })
  it('blocks identifiable customers without a retained consent reference', () => {
    expect(evaluateUploadRights({ ...confirmed, identifiablePeople: 'consented' }).publishEligible).toBe(false)
    expect(evaluateUploadRights({ ...confirmed, identifiablePeople: 'unknown' }).publishEligible).toBe(false)
    expect(evaluateUploadRights({ ...confirmed, identifiablePeople: 'consented', consentReference: 'owner-retained:consent-1' }).publishEligible).toBe(true)
  })
  it('fails closed on stale flags, pending objects, withdrawal and foreign workspaces', () => {
    const row = { workspace_id: 'w1', provenance_kind: 'USER_UPLOAD', lifecycle_status: 'READY', rights_status: 'confirmed', publish_eligibility: true,
      generation_metadata: { uploadRights: confirmed, rightsWithdrawnAt: null } }
    expect(canPublishUploadedMedia(row, 'w1')).toBe(true)
    expect(canPublishUploadedMedia(row, 'w2')).toBe(false)
    expect(canPublishUploadedMedia({ ...row, lifecycle_status: 'PENDING_VALIDATION' }, 'w1')).toBe(false)
    expect(canPublishUploadedMedia({ ...row, generation_metadata: {} }, 'w1')).toBe(false)
    expect(canPublishUploadedMedia({ ...row, generation_metadata: { ...row.generation_metadata, rightsWithdrawnAt: '2026-10-21' } }, 'w1')).toBe(false)
  })
})
