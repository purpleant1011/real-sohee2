import { describe, expect, it, vi } from 'vitest'
import { buildQuickCopyPrompt, composeQuickPostCopy } from '../quick-copy'

const base = { businessName: '모모 카페', industry: '카페', location: '성수동', summary: '직접 로스팅하는 동네 카페', brandVoice: '담백하게', topic: '이번 주말 딸기라떼 출시' }

function gemini(text: unknown, ok = true) {
  return vi.fn(async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: typeof text === 'string' ? text : JSON.stringify(text) }] } }] }), { status: ok ? 200 : 503 }))
}

describe('quick copy composer', () => {
  it('makes the owner topic the center of the prompt and forbids invented facts', () => {
    const prompt = buildQuickCopyPrompt(base)
    expect(prompt.indexOf('이번 주말 딸기라떼 출시')).toBeLessThan(prompt.indexOf('가게 정보'))
    expect(prompt).toContain('지어내지 마세요')
    expect(prompt).not.toContain('수정 요청')
  })

  it('separates approved effective facts from unverified owner instructions', () => {
    const prompt = buildQuickCopyPrompt({ ...base, confirmedFacts: ['라테 5,000원'] })
    expect(prompt).toContain('[사장님이 확인한 현재 유효 정보]')
    expect(prompt).toContain('라테 5,000원')
    expect(prompt).toContain('가격·행사·영업시간은 확인된 현재 유효 정보만')
  })

  it('includes feedback and the previous version for revisions', () => {
    const prompt = buildQuickCopyPrompt({ ...base, feedback: '더 담백하게', previous: { instagram: { caption: '이전 글', hashtags: [] }, threads: { content: '이전 스레드' } } })
    expect(prompt).toContain('더 담백하게')
    expect(prompt).toContain('이전 글')
  })

  it('parses fenced JSON and normalizes hashtags', async () => {
    const fetcher = gemini('```json\n{"instagram":{"caption":"딸기라떼가 나왔어요","hashtags":["딸기라떼","#성수카페"]},"threads":{"content":"딸기라떼 출시"}}\n```')
    const copies = await composeQuickPostCopy({ ...base, apiKey: 'k', fetcher: fetcher as any })
    expect(copies.instagram.hashtags).toEqual(['#딸기라떼', '#성수카페'])
    expect(copies.threads.content).toBe('딸기라떼 출시')
  })

  it('maps provider errors and malformed output to composer errors', async () => {
    await expect(composeQuickPostCopy({ ...base, apiKey: 'k', fetcher: gemini('x', false) as any })).rejects.toMatchObject({ code: 'PROVIDER_CALL_FAILED' })
    await expect(composeQuickPostCopy({ ...base, apiKey: 'k', fetcher: gemini('not json') as any })).rejects.toMatchObject({ code: 'MALFORMED_JSON' })
    await expect(composeQuickPostCopy({ ...base, apiKey: 'k', fetcher: gemini({ instagram: { caption: '' }, threads: {} }) as any })).rejects.toMatchObject({ code: 'MALFORMED_SHAPE' })
  })
})
