import 'server-only'

import type OpenAI from 'openai'
import { z } from 'zod'
import type { InstagramGenerationContext } from '@/features/auth/workspace-context'
import { sanitizePublicMetaCopy } from '@/features/publishing/meta-content-text'
import { collapseDuplicateCta, dedupeCaption } from '@/features/content/caption-dedupe'
import type { ContentBrief } from './content-interview'
import { mapTextResponseUsage, type UsageEventInput } from '@/features/credits/usage-event'

const safeMessage = '인스타그램 문안 결과를 안전하게 처리하지 못했습니다.'

const shortTextSchema = z.string().trim().min(1).max(500)
const optionalShortTextSchema = z.string().trim().max(500)
const draftSchema = z.object({
  caption: z.string().trim().min(1).max(2_200),
  hashtags: z.array(z.string().trim().regex(/^#[^\s#]+$/u).max(100)).max(30),
  cta: optionalShortTextSchema,
  disclosure: z.string().trim().max(500),
  observations: z.array(shortTextSchema).max(12),
  limitations: z.array(shortTextSchema).max(12),
  evidence: z.array(shortTextSchema).max(12),
  unresolvedQuestions: z.array(shortTextSchema).max(12),
  needs_facts: z.boolean().optional(),
}).strict()

export type InstagramDraft = Readonly<{
  caption: string
  hashtags: readonly string[]
  cta: string
  disclosure: string
  observations: readonly string[]
  limitations: readonly string[]
  evidence: readonly string[]
  unresolvedQuestions: readonly string[]
  needs_facts?: boolean
}>

export type InstagramDraftProviderInput = Readonly<{
  prompt: string
  context: InstagramGenerationContext
  channel: 'instagram' | 'threads'
  contentBrief?: ContentBrief
  stricterInstruction?: string
  signal?: AbortSignal
  onUsage?(usage: UsageEventInput): void
}>

export type InstagramDraftProvider = Readonly<{
  generate(input: InstagramDraftProviderInput): Promise<InstagramDraft>
}>

export class InstagramDraftProviderError extends Error {
  constructor() {
    super(safeMessage)
    this.name = 'InstagramDraftProviderError'
  }
}

const instagramDraftJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'caption',
    'hashtags',
    'cta',
    'disclosure',
    'observations',
    'limitations',
    'evidence',
    'unresolvedQuestions',
  ],
  properties: {
    caption: { type: 'string', minLength: 1, maxLength: 2_200 },
    hashtags: {
      type: 'array',
      maxItems: 30,
      items: { type: 'string', pattern: '^#[^\\s#]+$', maxLength: 100 },
    },
    cta: { type: 'string', minLength: 0, maxLength: 500 },
    disclosure: { type: 'string', maxLength: 500 },
    observations: { type: 'array', maxItems: 12, items: { type: 'string', minLength: 1, maxLength: 500 } },
    limitations: { type: 'array', maxItems: 12, items: { type: 'string', minLength: 1, maxLength: 500 } },
    evidence: { type: 'array', maxItems: 12, items: { type: 'string', minLength: 1, maxLength: 500 } },
    unresolvedQuestions: { type: 'array', maxItems: 12, items: { type: 'string', minLength: 1, maxLength: 500 } },
  },
} as const

export function parseInstagramDraftOutput(rawOutput: unknown): InstagramDraft {
  try {
    if (typeof rawOutput !== 'string' || rawOutput.trim().length === 0) {
      throw new InstagramDraftProviderError()
    }
    const parsed = draftSchema.parse(JSON.parse(rawOutput))
    const caption = dedupeCaption(
      z.string().trim().min(1).max(2_200).parse(sanitizePublicMetaCopy(parsed.caption)),
    )
    const rawCta = optionalShortTextSchema.parse(sanitizePublicMetaCopy(parsed.cta))
    const cta = rawCta ? collapseDuplicateCta(rawCta, { caption }) : ''
    return Object.freeze({
      ...parsed,
      caption,
      cta,
      disclosure: '',
      hashtags: Object.freeze([...parsed.hashtags]),
      observations: Object.freeze([...parsed.observations]),
      limitations: Object.freeze([...parsed.limitations]),
      evidence: Object.freeze([...parsed.evidence]),
      unresolvedQuestions: Object.freeze([...parsed.unresolvedQuestions]),
    })
  } catch {
    throw new InstagramDraftProviderError()
  }
}

function generationInput(
  prompt: string,
  context: InstagramGenerationContext,
  channel: 'instagram' | 'threads',
  contentBrief?: ContentBrief,
  stricterInstruction?: string,
): string {
  const hasActiveVoice = Boolean(
    context.brandVoice ||
    context.activeTextHarnesses?.some((h) => !h.channels?.length || h.channels.includes(channel)),
  )

  const constraints = [
    '확인되지 않은 사실을 단정하지 마세요.',
    '부족한 정보는 limitations 또는 unresolvedQuestions에 기록하세요.',
    'prohibitedTerms의 표현은 결과에 사용하지 마세요.',
    '사용자 요청의 브랜드와 현재 채널에 적용되는 활성 텍스트 하네스가 일치하면, 하네스의 검증된 사업 사실과 채널 규칙을 기본 사업 프로필보다 우선하세요.',
    '자동 게시하지 말고 사람이 검토할 초안만 작성하세요.',
    'caption과 hashtags에는 AI 제작, AI 생성, 검토용 초안, 자동 게시 같은 내부 제작·운영 문구를 넣지 마세요.',
    'disclosure는 항상 빈 문자열로 반환하세요. 생성 근거와 공개 여부는 소희 시스템이 별도로 관리합니다.',
    ...(hasActiveVoice
      ? [
          '등록된 활성 문체(brandVoice 또는 활성 텍스트 하네스의 toneAndManner)를 말투의 기준으로 삼으세요.',
          'contentBrief는 글의 목적, 대상 독자, 글 흐름, 행동 유도를 조정하며, contentBrief의 제네릭 tone은 등록된 활성 문체를 덮어쓰지 않습니다. 단, 사실성과 채널 제한은 항상 최우선입니다.',
        ]
      : [
          'contentBrief의 목적, 독자, 글 흐름, 말투와 행동 유도를 공개 문안에 반영하세요. 단, 사실성과 채널 제한은 항상 최우선입니다.',
        ]),
    'contentBrief.mustAvoid의 표현과 장면을 공개 문안에 넣지 마세요.',
    '이벤트 상세 정보(기간·혜택·참여 방법)가 제공되지 않은 경우, 날짜·가격·혜택을 지어내지 않고 점주에게 말을 걸거나 질문하지 마세요. 확인된 매장 정보를 바탕으로 사실적인 티저 문안을 작성하고 사실이 필요한 곳에만 [이벤트 기간]과 같이 명확한 대괄호 슬롯을 사용하세요.',
    '문의·상담 안내 문장은 캡션 전체에서 단 한 번만 쓴다.',
    '사용자가 별도의 행동 유도나 상담 링크를 원하지 않는 경우, cta는 빈 문자열("")로 반환하세요.',
    ...(stricterInstruction ? [stricterInstruction] : []),
  ]

  return JSON.stringify({
    task: `현재 작업공간의 확인된 정보만 사용해 검토 가능한 ${channel === 'instagram' ? '인스타그램' : '스레드'} 문안 초안을 작성하세요.`,
    constraints,
    userPrompt: prompt,
    channel,
    contentBrief: contentBrief ?? null,
    workspaceContext: context,
  })
}

export function createOpenAIInstagramDraftProvider(
  client: Pick<OpenAI, 'responses'>,
  model: string,
): InstagramDraftProvider {
  return Object.freeze({
    async generate(input) {
      try {
        const prompt = z.string().trim().min(1).max(1_500).parse(input.prompt)
        if (input.signal?.aborted) throw new InstagramDraftProviderError()
        const request = {
          model,
          instructions: `JSON 스키마에 맞는 한국어 ${input.channel === 'instagram' ? '인스타그램' : '스레드'} 문안 초안만 반환하세요.`,
          input: generationInput(prompt, input.context, input.channel, input.contentBrief, input.stricterInstruction),
          text: {
            format: {
              type: 'json_schema' as const,
              name: 'instagram_draft',
              strict: true,
              schema: instagramDraftJsonSchema,
            },
          },
          store: false,
        }
        const response = input.signal
          ? await client.responses.create(request, { signal: input.signal })
          : await client.responses.create(request)
        if (input.onUsage) {
          try {
            input.onUsage(mapTextResponseUsage(response.id, model, response.usage))
          } catch {
            // The caller owns the explicit estimated usage fallback.
          }
        }
        return parseInstagramDraftOutput(response.output_text)
      } catch {
        throw new InstagramDraftProviderError()
      }
    },
  })
}
