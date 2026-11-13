import { describe, expect, it, vi } from 'vitest'
import { createGeminiResponsesClient, extractJsonText } from './gemini-responses-adapter'

describe('extractJsonText', () => {
  it('코드펜스와 앞뒤 설명을 걷어 내고 첫 JSON 객체만 남긴다', () => {
    expect(extractJsonText('```json\n{"a":1}\n```')).toBe('{"a":1}')
    expect(extractJsonText('결과입니다 {"a":{"b":2}} 끝')).toBe('{"a":{"b":2}}')
  })
})

describe('createGeminiResponsesClient', () => {
  const schema = { type: 'object', properties: { title: { type: 'string' } } }

  it('Responses 요청의 지시문·입력·스키마를 한 프롬프트로 묶어 Gemini JSON 모드로 호출한다', async () => {
    const generateText = vi.fn().mockResolvedValue('{"title":"안녕"}')
    const client = createGeminiResponsesClient({ generateText })
    const response = await client.responses.create({
      model: 'ignored', instructions: '한국어 초안만 반환하세요.', input: '{"topic":"눈썹"}',
      text: { format: { type: 'json_schema', name: 'draft', strict: true, schema } },
    })
    expect(response.output_text).toBe('{"title":"안녕"}')
    const [prompt, options] = generateText.mock.calls[0]!
    expect(prompt).toContain('한국어 초안만 반환하세요.')
    expect(prompt).toContain('{"topic":"눈썹"}')
    expect(prompt).toContain(JSON.stringify(schema))
    expect(options).toMatchObject({ responseMimeType: 'application/json' })
  })

  it('JSON 이 아니면 한 번만 다시 요청한다', async () => {
    const generateText = vi.fn().mockResolvedValueOnce('설명만').mockResolvedValueOnce('{"ok":true}')
    const response = await createGeminiResponsesClient({ generateText }).responses.create({ model: 'x', input: 'hi', text: { format: { type: 'json_schema', name: 'd', strict: true, schema } } })
    expect(response.output_text).toBe('{"ok":true}')
    expect(generateText).toHaveBeenCalledTimes(2)
  })

  it('스키마 없는 요청은 그대로 텍스트를 돌려주고 입력 배열도 문자열로 합친다', async () => {
    const generateText = vi.fn().mockResolvedValue('수정된 문장')
    const response = await createGeminiResponsesClient({ generateText }).responses.create({
      model: 'x', input: [{ role: 'user', content: '문장을 고쳐 주세요' }],
    })
    expect(response.output_text).toBe('수정된 문장')
    expect(generateText.mock.calls[0]?.[0]).toContain('문장을 고쳐 주세요')
    expect(generateText.mock.calls[0]?.[1]).toMatchObject({ responseMimeType: 'text/plain' })
  })

  it('중단 신호가 이미 켜져 있으면 호출하지 않고 거절한다', async () => {
    const generateText = vi.fn()
    const controller = new AbortController(); controller.abort()
    await expect(createGeminiResponsesClient({ generateText }).responses.create({ model: 'x', input: 'a' }, { signal: controller.signal })).rejects.toThrow()
    expect(generateText).not.toHaveBeenCalled()
  })
})
