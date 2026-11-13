import { describe, it, expect, beforeEach, vi } from 'vitest'
import { generateCalibrationSamples } from '@/features/text-harness/text-calibration-service'
import type { ConversationalBusinessKnowledgeDraft } from '@/features/knowledge/conversational-knowledge'

describe('ANI-1446: Business-Grounded Text Calibration', () => {
  const storeKnowledge: ConversationalBusinessKnowledgeDraft = {
    location: '청라 호수공원 인근',
    primaryServices: '프리미엄 레이어드컷 & 퍼스널 디자인펌',
    reservationPolicy: '100% 네이버 예약제',
    pricing: '컷 35,000원 / 펌 120,000원부터',
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('generates samples strictly grounded on confirmed business knowledge and rejects generic fallback', () => {
    const batch = generateCalibrationSamples(storeKnowledge)
    expect(batch.samples.length).toBe(3)

    // All samples must contain real store location and services
    const [sample1, sample2, sample3] = batch.samples

    expect(sample1.text).toContain('청라 호수공원 인근')
    expect(sample1.text).toContain('프리미엄 레이어드컷 & 퍼스널 디자인펌')
    expect(sample1.text).toContain('컷 35,000원 / 펌 120,000원부터')
    expect(sample1.text).not.toContain('[매장 인근]')

    expect(sample2.text).toContain('청라 호수공원 인근')
    expect(sample2.text).toContain('프리미엄 레이어드컷 & 퍼스널 디자인펌')

    expect(sample3.text).toContain('청라 호수공원 인근')
    expect(sample3.text).toContain('프리미엄 레이어드컷 & 퍼스널 디자인펌')
  })
})
