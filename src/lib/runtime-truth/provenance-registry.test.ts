import { describe, it, expect } from 'vitest'
import { 
  RuntimeTruthRegistry, 
  type CustomerLeadRecord 
} from './provenance-registry'

describe('Runtime Truth Provenance Registry (ANI-306, ANI-307)', () => {
  it('1. Returns data_insufficient when raw metric has no evidence source', () => {
    const metric = RuntimeTruthRegistry.wrapMetric('roi', '투자 대비 수익률', null, '%', 'none')
    
    expect(metric.provenance).toBe('data_insufficient')
    expect(metric.value).toBeNull()
    expect(metric.confidence).toBe(0)
    expect(metric.statusNote).toContain('측정치가 표기됩니다')
  })

  it('2. Properly attaches provenance metadata when evidence is verified', () => {
    const metric = RuntimeTruthRegistry.wrapMetric('booked_revenue', '확정 예약 매출', 450000, 'KRW', 'naver_booking', {
      provenance: 'measured',
      confidence: 1.0,
      evidenceUrl: 'https://partner.booking.naver.com/b/12345'
    })

    expect(metric.provenance).toBe('measured')
    expect(metric.value).toBe(450000)
    expect(metric.confidence).toBe(1.0)
    expect(metric.evidenceUrl).toBeDefined()
  })

  it('3. Sanitizes demo vs production customer records and masks PII', () => {
    const demoLead: CustomerLeadRecord = {
      id: 'lead-001',
      isDemoFixture: true,
      name: '김지현',
      phoneMasked: '010-1234-5678',
      channel: 'INSTAGRAM',
      inquirySummary: '자연눈썹 유지 기간 및 시술 예약 문의',
      intentScore: 92,
      slaDeadlineMinutes: 15,
      status: 'NEW_INQUIRY',
      assignedAgent: '김소희',
      depositStatus: 'unpaid'
    }

    const demoSanitized = RuntimeTruthRegistry.sanitizeCustomerRecord(demoLead, false)
    expect(demoSanitized.name).toContain('[샘플]')

    const prodSanitized = RuntimeTruthRegistry.sanitizeCustomerRecord(demoLead, true)
    expect(prodSanitized.name).toBe('김*현')
    expect(prodSanitized.phoneMasked).toContain('****')
  })

  it('4. Classifies multi-touch marketing attribution accurately', () => {
    const directAttr = RuntimeTruthRegistry.evaluateAttribution(['sohee_dm_link', 'naver_booking_direct'])
    expect(directAttr).toBe('direct')

    const assistedAttr = RuntimeTruthRegistry.evaluateAttribution(['organic_search', 'sohee_blog_post', 'offline_visit'])
    expect(assistedAttr).toBe('assisted')

    const unclearAttr = RuntimeTruthRegistry.evaluateAttribution([])
    expect(unclearAttr).toBe('unclear')
  })

  it('5. Classifies asset provenance strictly distinguishing AI, source, and demo placeholder', () => {
    expect(RuntimeTruthRegistry.classifyAsset('https://images.unsplash.com/photo-123')).toBe('demo_placeholder')
    expect(RuntimeTruthRegistry.classifyAsset('https://cdn.sohee.ai/generated/eyes-01.png', true)).toBe('generated_asset')
    expect(RuntimeTruthRegistry.classifyAsset('https://store.byreum.com/original-photo.jpg', false)).toBe('source_asset')
  })
})

