'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import type { ActionResult } from '@/lib/errors/result'
import { createProductionTextClient } from '@/lib/ai/gemini-responses-adapter'
import {
  createOpenAIOnboardingExtractionProvider,
  type OnboardingExtractionProvider,
} from '../extraction-provider'
import { createOnboardingGateway, type OnboardingGateway } from '../repository'
import { onboardingAnswerSchema } from '../schema'
import { profileKeys } from '../types'

const inputSchema = onboardingAnswerSchema.extend({ workspaceId: z.string().uuid() })
const resultSchema = z.object({
  sessionId: z.string().uuid(),
  workspaceId: z.string().uuid(),
  answerId: z.string().uuid(),
  candidateId: z.string().uuid().nullable(),
  status: z.enum(['in_progress', 'review_required', 'completed']),
  activeStep: z.enum([...profileKeys, 'summary', 'completed']),
}).strict()
const approvedFactRowSchema = z.object({
  workspace_id: z.string().uuid(),
  category: z.enum(profileKeys),
  content: z.string().trim().min(1).max(4_000),
  status: z.literal('active'),
}).strict()

type SaveResult = z.infer<typeof resultSchema>

const failure = (message: string): ActionResult<SaveResult> => ({
  error: { message, requestId: 'onboarding-answer' },
})

async function productionDependencies() {
  return {
    gateway: await createOnboardingGateway(),
    extractor: createOpenAIOnboardingExtractionProvider(
      createProductionTextClient() as never,
      'gemini',
    ),
  }
}

export async function saveOnboardingAnswerAction(
  input: unknown,
  provided?: Readonly<{
    gateway: OnboardingGateway
    extractor: OnboardingExtractionProvider
  }>,
): Promise<ActionResult<SaveResult>> {
  const parsed = inputSchema.safeParse(input)
  if (!parsed.success) return failure('현재 질문에 대한 답변을 확인해 주세요.')

  const mutationInput = {
    workspaceId: parsed.data.workspaceId,
    sessionId: parsed.data.sessionId,
    step: parsed.data.step,
    content: parsed.data.content,
    clientRequestId: parsed.data.clientRequestId,
  }

  try {
    const dependencies = provided ?? await productionDependencies()
    const saved = await dependencies.gateway.saveAnswer(mutationInput)
    const savedData = resultSchema.safeParse(saved.data)
    if (
      saved.error
      || !savedData.success
      || savedData.data.workspaceId !== parsed.data.workspaceId
      || savedData.data.sessionId !== parsed.data.sessionId
    ) {
      return failure('답변을 저장하지 못했어요. 잠시 후 다시 시도해 주세요.')
    }

    const factsResult = await dependencies.gateway.listApprovedFacts(parsed.data.workspaceId)
    const factRows = z.array(approvedFactRowSchema).safeParse(factsResult.data)
    if (
      factsResult.error
      || !factRows.success
      || factRows.data.some((row) => row.workspace_id !== parsed.data.workspaceId)
    ) {
      return failure('답변은 저장했지만 정보를 정리하지 못했어요. 다시 검토해 주세요.')
    }

    const candidate = await dependencies.extractor.extract({
      step: parsed.data.step,
      answer: parsed.data.content,
      approvedFacts: factRows.data.map((row) => Object.freeze({
        key: row.category,
        value: row.content,
      })),
    })
    if (candidate.key !== parsed.data.step) {
      return failure('답변은 저장했지만 정보를 정리하지 못했어요. 다시 검토해 주세요.')
    }

    const created = await dependencies.gateway.createCandidate(mutationInput, candidate)
    const createdData = resultSchema.safeParse(created.data)
    if (
      created.error
      || !createdData.success
      || createdData.data.workspaceId !== parsed.data.workspaceId
      || createdData.data.sessionId !== parsed.data.sessionId
      || createdData.data.candidateId === null
    ) {
      return failure('답변은 저장했지만 확인할 정보를 저장하지 못했어요. 다시 검토해 주세요.')
    }

    revalidatePath('/app/onboarding')
    return { data: Object.freeze(createdData.data) }
  } catch {
    return failure('답변은 저장했지만 정보를 정리하지 못했어요. 다시 검토해 주세요.')
  }
}
