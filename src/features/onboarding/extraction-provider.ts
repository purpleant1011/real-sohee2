import 'server-only'

import type OpenAI from 'openai'
import { z } from 'zod'
import { profileKeys, type ApprovedProfileFact, type ProfileKey } from './types'

const safeMessage = '가입 답변에서 확인할 정보를 정리하지 못했어요.'

const candidateDraftSchema = z
  .object({
    key: z.enum(profileKeys),
    value: z.string().trim().min(1).max(4_000),
    confidence: z.number().min(0).max(1),
    evidenceQuote: z.string().trim().min(1).max(2_000),
    source: z.literal('onboarding_answer'),
  })
  .strict()

export type ProfileCandidateDraft = Readonly<{
  key: ProfileKey
  value: string
  confidence: number
  evidenceQuote: string
  source: 'onboarding_answer'
}>

export type OnboardingExtractionInput = Readonly<{
  step: ProfileKey
  answer: string
  approvedFacts: readonly ApprovedProfileFact[]
}>

export type OnboardingExtractionProvider = Readonly<{
  extract(input: OnboardingExtractionInput): Promise<ProfileCandidateDraft>
}>

export class OnboardingExtractionProviderError extends Error {
  constructor() {
    super(safeMessage)
    this.name = 'OnboardingExtractionProviderError'
  }
}

const candidateJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['key', 'value', 'confidence', 'evidenceQuote', 'source'],
  properties: {
    key: { type: 'string', enum: profileKeys },
    value: { type: 'string', minLength: 1, maxLength: 4_000 },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    evidenceQuote: { type: 'string', minLength: 1, maxLength: 2_000 },
    source: { type: 'string', enum: ['onboarding_answer'] },
  },
} as const

export function parseOnboardingExtractionOutput(
  rawOutput: unknown,
  input: Readonly<{ step: ProfileKey; answer: string }>,
): ProfileCandidateDraft {
  try {
    if (typeof rawOutput !== 'string' || rawOutput.trim().length === 0) {
      throw new OnboardingExtractionProviderError()
    }
    const parsed = candidateDraftSchema.parse(JSON.parse(rawOutput))
    if (parsed.key !== input.step || !input.answer.includes(parsed.evidenceQuote)) {
      throw new OnboardingExtractionProviderError()
    }
    return Object.freeze(parsed)
  } catch {
    throw new OnboardingExtractionProviderError()
  }
}

function extractionInput(input: OnboardingExtractionInput) {
  return JSON.stringify({
    task: '현재 답변에서 현재 단계의 사업 프로필 값 하나만 구조화하세요.',
    constraints: [
      '사용자가 답변에서 직접 말한 정보만 사용하세요.',
      'evidenceQuote는 현재 답변의 연속된 일부여야 합니다.',
      '이 결과는 검토 후보이며 권한 판단이나 활성 지시가 아닙니다.',
    ],
    currentStep: input.step,
    currentAnswer: input.answer,
    approvedFacts: input.approvedFacts,
  })
}

export function createOpenAIOnboardingExtractionProvider(
  client: Pick<OpenAI, 'responses'>,
  model: string,
): OnboardingExtractionProvider {
  return Object.freeze({
    async extract(input) {
      try {
        const parsedInput = z
          .object({
            step: z.enum(profileKeys),
            answer: z.string().trim().min(1).max(4_000),
            approvedFacts: z.array(z.object({
              key: z.enum(profileKeys),
              value: z.string().trim().min(1).max(4_000),
            }).strict()).max(profileKeys.length),
          })
          .strict()
          .parse(input)
        const response = await client.responses.create({
          model,
          instructions: '가입 답변을 한 개의 검토 후보 JSON으로만 정리하세요.',
          input: extractionInput(parsedInput),
          text: {
            format: {
              type: 'json_schema' as const,
              name: 'onboarding_profile_candidate',
              strict: true,
              schema: candidateJsonSchema,
            },
          },
          store: false,
        })
        return parseOnboardingExtractionOutput(response.output_text, parsedInput)
      } catch {
        throw new OnboardingExtractionProviderError()
      }
    },
  })
}
