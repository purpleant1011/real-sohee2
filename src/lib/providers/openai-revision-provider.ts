import 'server-only'

import type OpenAI from 'openai'
import {
  revisionInputSchema,
  revisionResultSchema,
} from '@/features/content/version-schema'
import type {
  RevisionInput,
  RevisionProvider,
  RevisionResult,
} from './revision-provider'
import { sanitizePublicMetaCopy } from '@/features/publishing/meta-content-text'

const safeMessage = 'AI 문구 결과를 안전하게 처리하지 못했습니다.'

export class OpenAIRevisionProviderError extends Error {
  constructor(message = safeMessage) {
    super(message)
    this.name = 'OpenAIRevisionProviderError'
  }
}

function instructionFor(input: RevisionInput): string {
  return JSON.stringify({
    task: '한국어 소셜 콘텐츠를 수정하고 JSON 객체만 반환하세요.',
    constraints: {
      caption: '공백이 아닌 1자 이상 2200자 이하',
      hashtags: '#으로 시작하고 공백이 없는 문자열, 최대 30개',
      disclosure: '500자 이하',
      revisionReason: '공백이 아닌 1자 이상 500자 이하',
      automaticPublish: false,
      publicCopy: '공개 caption과 hashtags에는 AI 제작, AI 생성, 검토용 초안, 자동 게시 같은 내부 제작·운영 문구를 넣지 마세요.',
      disclosureHandling: 'disclosure는 새로 작성하지 말고 현재 값을 그대로 반환하세요. 생성 근거는 소희 시스템이 별도로 관리합니다.',
    },
    content: {
      channel: input.channel,
      inputType: input.inputType,
      instruction: input.instruction,
      currentCaption: input.currentCaption ?? '',
      currentHashtags: input.currentHashtags ?? [],
      currentDisclosure: input.currentDisclosure ?? '',
    },
    output: {
      caption: 'string',
      hashtags: ['#string'],
      disclosure: 'string',
      revisionReason: 'string',
    },
  })
}

export function createOpenAIRevisionProvider(
  client: Pick<OpenAI, 'responses'>,
  model: string,
): RevisionProvider {
  return {
    mode: 'openai',
    async revise(rawInput: RevisionInput): Promise<RevisionResult> {
      try {
        const input = revisionInputSchema.parse(rawInput)
        const response = await client.responses.create({
          model,
          input: instructionFor(input),
        })
        if (typeof response.output_text !== 'string' || response.output_text.trim().length === 0) {
          throw new OpenAIRevisionProviderError()
        }

        const decoded = revisionResultSchema.parse(JSON.parse(response.output_text))
        return revisionResultSchema.parse({
          ...decoded,
          caption: sanitizePublicMetaCopy(decoded.caption),
          disclosure: input.currentDisclosure ?? '',
        })
      } catch {
        throw new OpenAIRevisionProviderError()
      }
    },
  }
}
