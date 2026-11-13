import { describe, expect, it } from 'vitest'
import { getStudioReadiness } from './studio-readiness'

const profile = { business_name: '우리 가게', industry: '카페', location: '서울', summary: '동네 카페' }
const harness = { version_no: 2, is_active: true, business_identity: null, offerings: [{ name: '아메리카노' }], policies: null, audience: null, brand_voice: null }
function client(rows: { profile?: unknown; harness?: unknown; fail?: boolean }) {
  const make = (data: unknown) => {
    const chain: any = { select: () => chain, eq: () => chain, order: () => chain, limit: () => chain,
      maybeSingle: async () => (rows.fail ? { data: null, error: { message: 'boom' } } : { data, error: null }) }
    return chain
  }
  return { from: (table: string) => make(table === 'business_profiles' ? rows.profile : table === 'workspace_knowledge_harnesses' ? rows.harness : null) }
}

describe('스튜디오 준비 상태(생성과 같은 기준)', () => {
  it('활성 지식과 쓸 수 있는 정보가 있으면 준비됨', async () => {
    expect(await getStudioReadiness(client({ profile, harness }), 'ws')).toEqual({ state: 'ready' })
  })
  it('활성 지식이 없으면 부족함', async () => {
    expect(await getStudioReadiness(client({ profile, harness: null }), 'ws')).toEqual({ state: 'missing' })
  })
  it('읽기 오류는 부족함이 아니라 오류로 구분한다', async () => {
    const result = await getStudioReadiness(client({ fail: true }), 'ws')
    expect(result.state).toBe('error')
  })
})
