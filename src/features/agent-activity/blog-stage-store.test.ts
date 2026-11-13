import { describe, expect, it, vi } from 'vitest'
import { appendBlogStageFact, createStageRecorder, replayBlogStageFacts } from './blog-stage-store'

const W = '11111111-1111-4111-8111-111111111111'
const R = '22222222-2222-4222-8222-222222222222'
const row = (over: Record<string, unknown> = {}) => ({
  event_id: '33333333-3333-4333-8333-333333333333', workspace_id: W, run_id: R, sequence: 1,
  observed_at: '2026-10-28T01:30:00Z', stage: 'keyword_lookup', status: 'verified', provenance: 'server_record',
  source_id: 'naver_search', sample_size: 20, covered: 18, total: 20, ...over,
})
const input = { workspaceId: W, runId: R, stage: 'keyword_lookup', status: 'verified', provenance: 'server_record', sourceId: 'naver_search', sampleSize: 20, coverage: { covered: 18, total: 20 }, dedupeKey: 'k1' } as const

describe('블로그 단계 기록 저장소', () => {
  it('RPC에 범위·출처·표본·커버리지를 전달하고 사실로 되돌린다', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [row()], error: null })
    const fact = await appendBlogStageFact({ rpc } as never, input)
    expect(rpc).toHaveBeenCalledWith('append_blog_stage_fact', expect.objectContaining({ p_covered: 18, p_total: 20, p_source_id: 'naver_search', p_dedupe_key: 'k1' }))
    expect(fact).toMatchObject({ sequence: 1, sampleSize: 20, coverage: { covered: 18, total: 20 } })
  })
  it('다른 workspace 응답이나 DB 오류는 내부 세부 없이 실패한다', async () => {
    await expect(appendBlogStageFact({ rpc: vi.fn().mockResolvedValue({ data: [row({ workspace_id: R })], error: null }) } as never, input)).rejects.toThrow('BLOG_STAGE_INVALID')
    await expect(appendBlogStageFact({ rpc: vi.fn().mockResolvedValue({ data: null, error: { message: 'secret' } }) } as never, input)).rejects.toThrow('BLOG_STAGE_UNAVAILABLE')
  })
  it('재생은 순번이 역행하면 거부하고 after 이후만 요청한다', async () => {
    const chain = (data: unknown[]) => {
      const q: Record<string, unknown> = {}
      for (const m of ['select', 'eq', 'gt']) q[m] = vi.fn(() => q)
      q.order = vi.fn(() => q); q.limit = vi.fn().mockResolvedValue({ data, error: null })
      return q
    }
    const ok = chain([row({ sequence: 3 }), row({ sequence: 4, event_id: '44444444-4444-4444-8444-444444444444' })])
    const facts = await replayBlogStageFacts({ from: () => ok } as never, { workspaceId: W, runId: R, after: 2 })
    expect(facts.map(f => f.sequence)).toEqual([3, 4])
    expect(ok.gt).toHaveBeenCalledWith('sequence', 2)
    const bad = chain([row({ sequence: 2 })])
    await expect(replayBlogStageFacts({ from: () => bad } as never, { workspaceId: W, runId: R, after: 2 })).rejects.toThrow('BLOG_STAGE_INVALID')
  })
  it('생성 단계 기록기는 요청 키를 붙인 멱등 키로 server_record를 남긴다', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [row({ stage: 'image_generation', source_id: 'business_facts', sample_size: null })], error: null })
    await createStageRecorder({ rpc } as never, { workspaceId: W, runId: R, requestKey: 'req-1' })(
      { stage: 'image_generation', status: 'verified', sourceId: 'business_facts', coverage: { covered: 18, total: 20 }, dedupeKey: 'image:verified' })
    expect(rpc).toHaveBeenCalledWith('append_blog_stage_fact', expect.objectContaining({
      p_provenance: 'server_record', p_dedupe_key: 'req-1:image:verified', p_covered: 18, p_total: 20 }))
  })
})
