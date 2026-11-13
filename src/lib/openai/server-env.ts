import 'server-only'

import { z } from 'zod'

const keySchema = z.string().min(20)
const modelSchema = z.string().trim().min(1).max(100)

type Environment = Record<string, string | undefined>

export function parseGeminiTextConfig(input: Environment) {
  const key = keySchema.safeParse(input.GEMINI_API_KEY || input.GOOGLE_GENERATIVE_AI_API_KEY)
  if (!key.success) {
    throw new Error('GEMINI_API_KEY 서버 비밀값이 설정되지 않았습니다.')
  }
  const conversationModel = modelSchema.safeParse(input.GEMINI_CONVERSATION_MODEL ?? 'gemini-3.5-flash-lite')
  const actionModel = modelSchema.safeParse(input.GEMINI_ACTION_MODEL ?? 'gemini-3.8-flash')
  return {
    apiKey: key.data,
    conversationModel: conversationModel.success ? conversationModel.data : 'gemini-3.5-flash-lite',
    actionModel: actionModel.success ? actionModel.data : 'gemini-3.8-flash',
  }
}

export function readGeminiTextConfig() {
  return parseGeminiTextConfig(process.env)
}

export function parseOpenAIImageConfig(input: Environment) {
  const key = keySchema.safeParse(input.OPENAI_IMAGE_API_KEY)
  if (!key.success) {
    throw new Error('OPENAI_IMAGE_API_KEY 서버 비밀값이 설정되지 않았습니다.')
  }

  const model = modelSchema.safeParse(input.OPENAI_IMAGE_MODEL ?? 'gpt-image-2.5-sunburst')
  if (!model.success) {
    throw new Error('OPENAI_IMAGE_MODEL 값을 확인해 주세요.')
  }

  return { apiKey: key.data, model: model.data }
}

export function readOpenAIImageConfig() {
  return parseOpenAIImageConfig(process.env)
}
