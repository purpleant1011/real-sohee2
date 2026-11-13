import { describe, expect, it } from 'vitest'
import { loadGrowthEvidence } from '../load-evidence'

type Rows = Record<string, unknown>

function fakeAdmin(tables: Record<string, unknown>) {
  return {
    from(table: string) {
      const data = tables[table]
      const failing = data && typeof data === 'object' && '__error' in (data as Rows)
      const result = failing
        ? { data: null, error: { message: String((data as Rows).__error) } }
        : { data: data ?? null, error: null }
      const builder: any = {
        select: () => builder,
        eq: () => builder,
        limit: () => builder,
        maybeSingle: async () => (Array.isArray(result.data) ? { data: result.data[0] ?? null, error: result.error } : result),
        then: (resolve: (v: unknown) => unknown) => resolve({ data: Array.isArray(result.data) ? result.data : result.data ? [result.data] : [], error: result.error }),
      }
      return builder
    },
  }
}

const WS = '3f1c2b4e-5a6d-4e7f-8a9b-0c1d2e3f4a5b'

const deps = (tables: Record<string, unknown>, extra: Partial<{ ig: boolean; th: boolean; tier: string }> = {}) => ({
  admin: fakeAdmin(tables) as any,
  isChannelVerified: async (_ws: string, channel: 'instagram' | 'threads') => (channel === 'instagram' ? Boolean(extra.ig) : Boolean(extra.th)),
  getTier: async () => (extra.tier ?? 'TRIAL') as any,
})

describe('loadGrowthEvidence', () => {
  it('저장된 데이터만 증거로 바꾼다', async () => {
    const evidence = await loadGrowthEvidence(
      WS,
      deps(
        {
          business_profiles: { business_name: '모모 카페', industry: '카페·디저트', location: '청라동', summary: '직접 로스팅한 원두를 써요.' },
          brand_profiles: { voice: '친근한 말투', keywords: ['원두', '디저트'], prohibited_terms: ['최저가'] },
          knowledge_facts: [{ category: 'menu' }, { category: 'PRICE' }, { category: 'faq' }, { category: 'FAQ' }],
          harness_rules: [
            { rule_type: 'text_generation', status: 'active', approved_at: '2026-10-01' },
            { rule_type: 'approval_policy', status: 'active', approved_at: '2026-10-01' },
          ],
          knowledge_sources: [{ status: 'approved' }, { status: 'registered' }, { status: 'failed' }, { status: 'rejected' }, { status: 'paused' }],
        },
        { ig: true, tier: 'FORMAL' },
      ),
    )
    expect(evidence).toEqual({
      profile: { nameValid: true, industryValid: true, locationValid: true, summaryValid: true, voiceValid: true, keywordCount: 2, prohibitedTermCount: 1 },
      factCounts: { MENU: 1, PRICE: 1, FAQ: 2 },
      harness: { text: true, image: false, approvalPolicy: true },
      sourceCount: 2,
      channels: { instagram: true, threads: false },
      tier: 'FORMAL',
    })
  })

  it('미리 채워진 기본 문구는 유효로 세지 않는다', async () => {
    const evidence = await loadGrowthEvidence(
      WS,
      deps({
        business_profiles: { business_name: '신규 매장', industry: '뷰티/미용', location: '매장 위치 등록 대기', summary: '고객 맞춤 전문 서비스를 제공합니다.' },
        brand_profiles: { voice: '따뜻하고 신뢰감 있는 전문가 톤, 친절한 설명체 (~해요, ~해 드려요)', keywords: [], prohibited_terms: [] },
      }),
    )
    expect(evidence.profile).toMatchObject({ nameValid: false, locationValid: false, summaryValid: false, voiceValid: false })
  })

  it('프로필이 아직 없으면 모두 무효', async () => {
    const evidence = await loadGrowthEvidence(WS, deps({}))
    expect(evidence.profile).toEqual({
      nameValid: false, industryValid: false, locationValid: false, summaryValid: false, voiceValid: false, keywordCount: 0, prohibitedTermCount: 0,
    })
    expect(evidence.factCounts).toEqual({})
    expect(evidence.sourceCount).toBe(0)
  })

  it('운영 규칙은 승인 시각이 있어야 확정으로 본다', async () => {
    const evidence = await loadGrowthEvidence(
      WS,
      deps({ harness_rules: [{ rule_type: 'approval_policy', status: 'active', approved_at: null }] }),
    )
    expect(evidence.harness.approvalPolicy).toBe(false)
  })

  it('knowledge_items는 status가 approved인 것만 sourceCount에 합산한다 (checking/review_required 제외)', async () => {
    const evidence = await loadGrowthEvidence(
      WS,
      deps({
        knowledge_sources: [
          { status: 'approved' },
          { status: 'failed' },
        ],
        knowledge_items: [
          { status: 'checking' },
          { status: 'review_required' },
          { status: 'approved' },
          { status: 'failed' },
          { status: 'rejected' },
          { status: 'archived' },
        ],
      }),
    )
    expect(evidence.sourceCount).toBe(2)
  })

  it('쿼리 오류는 조용히 넘기지 않고 던진다', async () => {
    await expect(loadGrowthEvidence(WS, deps({ knowledge_facts: { __error: 'permission denied' } }))).rejects.toThrow('GROWTH_EVIDENCE_READ_FAILED')
  })
})
