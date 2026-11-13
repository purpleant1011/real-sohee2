import type OpenAI from 'openai'
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import {
  createOpenAIRevisionProvider,
  OpenAIRevisionProviderError,
} from './openai-revision-provider'

const input = {
  workspaceId: '20000000-0000-4000-8000-000000000001',
  contentId: '30000000-0000-4000-8000-000000000001',
  versionId: '40000000-0000-4000-8000-000000000001',
  channel: 'instagram' as const,
  instruction: '문구를 더 따뜻하고 간결하게 바꿔 줘.',
  inputType: 'full' as const,
  currentVersionFingerprint: 'a'.repeat(64),
  currentCaption: '기존 가을 캠페인 문구',
  currentHashtags: ['#가을'],
  currentDisclosure: '기존 필수 고지',
}

function clientWith(outputText: string | undefined) {
  const create = vi.fn().mockResolvedValue({
    output_text: outputText,
    _request_id: 'req_test',
  })

  return {
    client: { responses: { create } } as unknown as Pick<OpenAI, 'responses'>,
    create,
  }
}

describe('createOpenAIRevisionProvider', () => {
  it('calls the Responses API and validates the visible revision result', async () => {
    const { client, create } = clientWith(
      JSON.stringify({
        caption: '따뜻한 새 문구\n\nAI를 활용해 제작한 이미지와 문안입니다.',
        hashtags: ['#소희'],
        disclosure: 'AI 생성 문구를 검토했습니다.',
        revisionReason: '소희 AI 수정',
      }),
    )
    const provider = createOpenAIRevisionProvider(client, 'gpt-5.5')

    await expect(provider.revise(input)).resolves.toEqual({
      caption: '따뜻한 새 문구',
      hashtags: ['#소희'],
      disclosure: '기존 필수 고지',
      revisionReason: '소희 AI 수정',
    })
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gpt-5.5',
        input: expect.stringContaining(input.instruction),
      }),
    )
    expect(create.mock.calls[0]?.[0]?.input).toContain(input.currentCaption)
    expect(create.mock.calls[0]?.[0]?.input).toContain('공개 caption과 hashtags에는 AI 제작, AI 생성, 검토용 초안, 자동 게시 같은 내부 제작·운영 문구를 넣지 마세요.')
  })

  it.each([
    ['invalid JSON', '{not-json'],
    ['empty output', undefined],
    [
      'invalid schema',
      JSON.stringify({
        caption: '가'.repeat(2_201),
        hashtags: ['#소희'],
        disclosure: '',
        revisionReason: '소희 AI 수정',
      }),
    ],
  ])('normalizes %s without exposing provider details', async (_label, outputText) => {
    const { client } = clientWith(outputText)
    const provider = createOpenAIRevisionProvider(client, 'gpt-5.5')

    await expect(provider.revise(input)).rejects.toEqual(
      new OpenAIRevisionProviderError('AI 문구 결과를 안전하게 처리하지 못했습니다.'),
    )
  })

  it('normalizes an API failure without rethrowing its body', async () => {
    const create = vi.fn().mockRejectedValue(new Error('secret upstream body'))
    const client = { responses: { create } } as unknown as Pick<OpenAI, 'responses'>
    const provider = createOpenAIRevisionProvider(client, 'gpt-5.5')

    await expect(provider.revise(input)).rejects.toEqual(
      new OpenAIRevisionProviderError('AI 문구 결과를 안전하게 처리하지 못했습니다.'),
    )
  })
})
