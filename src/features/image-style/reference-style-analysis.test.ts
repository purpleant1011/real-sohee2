import { describe, expect, it, vi } from 'vitest'
import {
  analyzeReferenceImages,
  parseReferenceAnalysis,
  validateReferenceFiles,
} from './reference-style-analysis'

const png = { mimeType: 'image/png', base64: 'AAAA' }

function gemini(text: string, ok = true) {
  return vi.fn(async () => ({
    ok,
    status: ok ? 200 : 500,
    text: async () => text,
    json: async () => ({ candidates: [{ content: { parts: [{ text }] } }] }),
  })) as unknown as typeof fetch
}

describe('parseReferenceAnalysis', () => {
  it('maps a JSON answer into style form fields and trims long values', () => {
    const parsed = parseReferenceAnalysis(JSON.stringify({
      subject: '파스텔 네일 클로즈업', setting: '밝은 테이블', mood: '화사한', lookAndColor: '자연광, 파스텔',
      people: 'hands', avoid: ['네온', '글자'], extra: 'x'.repeat(900), composition: '정면 45도, 제품 오른쪽',
    }))
    expect(parsed).toMatchObject({ subject: '파스텔 네일 클로즈업', people: 'hands', avoid: '네온, 글자', composition: '정면 45도, 제품 오른쪽' })
    expect(parsed?.extra.length).toBeLessThanOrEqual(600)
  })
  it('accepts fenced JSON and rejects garbage or unknown people values', () => {
    expect(parseReferenceAnalysis('```json\n{"subject":"카페","people":"weird"}\n```')).toMatchObject({ subject: '카페', people: 'any' })
    expect(parseReferenceAnalysis('not json')).toBeNull()
    expect(parseReferenceAnalysis('{}')).toBeNull()
  })
})

describe('deep analysis fields', () => {
  it('returns per-photo role notes and a long analysis note', () => {
    const parsed = parseReferenceAnalysis(JSON.stringify({
      subject: '마스크 쓴 인물 포트레이트', notes: ['여성 정면 상반신, 네이비 카디건', '남성 정면, 흰 티셔츠', 5, 'x'.repeat(300)], analysis: '카메라는 아이레벨, 얼굴이 화면 폭의 50%. ' .repeat(60),
    }))
    expect(parsed?.notes).toEqual(['여성 정면 상반신, 네이비 카디건', '남성 정면, 흰 티셔츠', '', 'x'.repeat(120)])
    expect(parsed?.analysis?.length).toBeLessThanOrEqual(1200)
  })
  it('asks the model for photographic detail and one role note per photo', async () => {
    const fetcher = gemini('{"subject":"a"}')
    await analyzeReferenceImages([png, png, png], { apiKey: 'k', fetcher, baseUrl: 'https://g.test', model: 'm' })
    const body = JSON.parse(((fetcher as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, { body: string }])[1].body)
    const instruction = body.contents[0].parts[0].text as string
    expect(instruction).toContain('notes')
    expect(instruction).toContain('3개')
    expect(instruction).toContain('analysis')
  })
})

describe('validateReferenceFiles', () => {
  const file = (type: string, size: number) => ({ type, size })
  it('requires 1 to 8 supported images under 4MB', () => {
    expect(validateReferenceFiles([])).toMatchObject({ ok: false })
    expect(validateReferenceFiles(Array.from({ length: 9 }, () => file('image/png', 10)))).toMatchObject({ ok: false })
    expect(validateReferenceFiles([file('image/gif', 10)])).toMatchObject({ ok: false })
    expect(validateReferenceFiles([file('image/png', 5 * 1024 * 1024)])).toMatchObject({ ok: false })
    expect(validateReferenceFiles([file('image/png', 10), file('image/jpeg', 20), file('image/webp', 30)])).toEqual({ ok: true })
  })
})

describe('analyzeReferenceImages', () => {
  it('sends the images inline to Gemini and returns the parsed style', async () => {
    const fetcher = gemini('{"subject":"카페 라떼","mood":"따뜻한"}')
    const result = await analyzeReferenceImages([png, png], { apiKey: 'k', fetcher, baseUrl: 'https://g.test', model: 'm' })
    expect(result).toMatchObject({ subject: '카페 라떼', mood: '따뜻한' })
    const [url, init] = (fetcher as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, { body: string }]
    expect(url).toContain('/v1beta/models/m:generateContent')
    const body = JSON.parse(init.body)
    expect(body.contents[0].parts.filter((p: { inlineData?: unknown }) => p.inlineData)).toHaveLength(2)
    expect(JSON.stringify(body)).toContain('특정 인물')
  })
  it('throws a safe error when the key is missing, the call fails or the answer is unusable', async () => {
    await expect(analyzeReferenceImages([png], { apiKey: '', fetcher: gemini('{}') })).rejects.toThrow('REFERENCE_ANALYSIS_UNAVAILABLE')
    await expect(analyzeReferenceImages([png], { apiKey: 'k', fetcher: gemini('x', false) })).rejects.toThrow('REFERENCE_ANALYSIS_UNAVAILABLE')
    await expect(analyzeReferenceImages([png], { apiKey: 'k', fetcher: gemini('not json') })).rejects.toThrow('REFERENCE_ANALYSIS_UNUSABLE')
  })
})
