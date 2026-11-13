import { describe, expect, it } from 'vitest'
import {
  SAMPLE_ACADEMY_DRAFT,
  SAMPLE_CAFE_DRAFT,
  SAMPLE_CHANNEL_DRAFTS,
  SAMPLE_SALON_DRAFT,
} from './sample-draft'
import { STUDIO_CHANNELS } from '../types'

describe('sample-draft fixtures', () => {
  it('provides 3 distinct industry drafts', () => {
    expect(SAMPLE_CHANNEL_DRAFTS).toHaveLength(3)
    expect(SAMPLE_CHANNEL_DRAFTS).toContain(SAMPLE_CAFE_DRAFT)
    expect(SAMPLE_CHANNEL_DRAFTS).toContain(SAMPLE_SALON_DRAFT)
    expect(SAMPLE_CHANNEL_DRAFTS).toContain(SAMPLE_ACADEMY_DRAFT)
  })

  it.each(SAMPLE_CHANNEL_DRAFTS)('draft $requestKey covers all 4 studio channels', (draft) => {
    const presentChannels = draft.variants.map((v) => v.channel)
    expect(presentChannels).toEqual(expect.arrayContaining([...STUDIO_CHANNELS]))
    expect(presentChannels).toHaveLength(4)
  })

  it.each(SAMPLE_CHANNEL_DRAFTS)('draft $requestKey has at least one READY variant', (draft) => {
    const readyVariants = draft.variants.filter((v) => v.status === 'READY')
    expect(readyVariants.length).toBeGreaterThanOrEqual(1)
    for (const v of readyVariants) {
      expect(v.statusLabel).toBe('준비 완료')
    }
  })

  it.each(SAMPLE_CHANNEL_DRAFTS)('draft $requestKey has at least one NEEDS_CHECK variant with unverified claim reasons', (draft) => {
    const needsCheckVariants = draft.variants.filter((v) => v.status === 'NEEDS_CHECK')
    expect(needsCheckVariants.length).toBeGreaterThanOrEqual(1)
    for (const v of needsCheckVariants) {
      expect(v.statusLabel).toBe('확인 필요')
      expect(v.issues.length).toBeGreaterThanOrEqual(1)
      for (const issue of v.issues) {
        // Reason must be Korean and explain missing evidence
        expect(issue).toMatch(/[가-힣]/)
      }
    }
  })

  it.each(SAMPLE_CHANNEL_DRAFTS)('draft $requestKey does not leak English status codes or UUIDs in user-facing fields', (draft) => {
    const uuidRegex = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
    const forbiddenEnglishStatus = /\b(ERROR|EMPTY|UNKNOWN|FAIL|PASS|VERIFIED|NOT_VERIFIED|NEEDS_CHECK|NEEDS_FIX|READY)\b/

    expect(draft.topic).not.toMatch(uuidRegex)
    expect(draft.topic).not.toMatch(forbiddenEnglishStatus)

    for (const note of draft.basisNotes) {
      expect(note).not.toMatch(uuidRegex)
      expect(note).not.toMatch(forbiddenEnglishStatus)
    }

    for (const v of draft.variants) {
      expect(v.statusLabel).not.toMatch(forbiddenEnglishStatus)
      expect(v.statusLabel).toMatch(/[가-힣]/)

      for (const issue of v.issues) {
        expect(issue).not.toMatch(uuidRegex)
        expect(issue).not.toMatch(forbiddenEnglishStatus)
      }
    }
  })
})
