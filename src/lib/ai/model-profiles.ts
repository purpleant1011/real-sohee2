/**
 * Sohee V0.8.9 6차 수정 AI Model Profiles & Runtime Registry (ANI-649, ANI-657)
 * 
 * 3대 독립 AI 역할 분리:
 * 1. Conversation Brain: 대화·추론 (GPT 5.6 Luna Max)
 * 2. Action Worker: 실제 액션/MCP 실행 (GPT 5.6 Luna Max, 별도 Runtime Profile)
 * 3. Image Worker: 이미지 생성 (GPT-Image-2)
 * 
 * Provider Failover & Gemini 3.8 Flash Adapter:
 * - 기본 active: OpenAI (GPT 5.6 Luna Max / GPT-Image-2)
 * - Gemini 3.8 Flash (`gemini-3.8-flash`)는 환경변수/워크스페이스 설정에 따라 전환 가능한 Adapter 및 Fallback 아키텍처 지원
 */

export type AIRole = 'conversation' | 'action' | 'image'
export type AIProvider = 'openai' | 'gemini'

export interface ModelProfile {
  role: AIRole
  provider: AIProvider
  modelId: string
  versionTag: string
  temperature: number
  maxTokens: number
  timeoutMs: number
  retryCount: number
  structuredOutput: boolean
  costPer1kTokensWon: number
  costPerImageUnitWon: number
  creditCostSC: number
  description: string
}

/**
 * Server-only API Key Resolvers
 */
export function getTextApiKey(): string {
  return (
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_GENERATIVE_AI_API_KEY ||
    process.env.GOOGLE_API_KEY ||
    ''
  )
}

export function getImageApiKey(): string {
  return (
    process.env.OPENAI_IMAGE_API_KEY ||
    ''
  )
}

export function getGeminiApiKey(): string {
  return (
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_GENERATIVE_AI_API_KEY ||
    process.env.GOOGLE_API_KEY ||
    ''
  )
}

export function getGeminiApiBaseUrl(): string {
  return process.env.GEMINI_API_BASE_URL?.trim() || 'https://generativelanguage.googleapis.com'
}

/**
 * Global AI Model Profile Registry
 * Production Default:
 * - Conversation: Google Gemini 3.5 Flash Lite (Ultra Cost-Effective)
 * - Action: Google Gemini 3.8 Flash (Autonomous Agent Completion)
 * - Image: OpenAI 2.5 Image (gpt-image-2) with Flare/Sunburst presets
 */
export const MODEL_PROFILES: Record<AIRole, ModelProfile> = {
  conversation: {
    role: 'conversation',
    provider: (process.env.AI_CONVERSATION_PROVIDER as AIProvider) || 'gemini',
    modelId: process.env.GEMINI_CONVERSATION_MODEL || 'gemini-3.5-flash-lite',
    versionTag: 'v0.9.0-13th-gemini-lite-conv',
    temperature: 0.7,
    maxTokens: 4096,
    timeoutMs: 25000,
    retryCount: 2,
    structuredOutput: false,
    costPer1kTokensWon: 1, // 저가 가성비
    costPerImageUnitWon: 0,
    creditCostSC: 1,
    description: '대화 전담 가성비 AI (Gemini 3.5 Flash Lite). 사장님 일상 대화, 상담, 질의응답, 인터뷰 안내'
  },
  action: {
    role: 'action',
    provider: (process.env.AI_ACTION_PROVIDER as AIProvider) || 'gemini',
    modelId: process.env.GEMINI_ACTION_MODEL || 'gemini-3.8-flash',
    versionTag: 'v0.9.0-13th-gemini-flash-agent',
    temperature: 0.1, // 결정론적/엄격한 플래닝
    maxTokens: 4096,
    timeoutMs: 35000,
    retryCount: 3,
    structuredOutput: true,
    costPer1kTokensWon: 5,
    costPerImageUnitWon: 0,
    creditCostSC: 2,
    description: '실제 업무 완결 전담 AI (Gemini 3.8 Flash). 마케팅 플래닝, 카피라이팅, 채널 게시 완결'
  },
  image: {
    role: 'image',
    provider: 'openai',
    modelId: (() => {
      const configured = process.env.OPENAI_IMAGE_MODEL?.trim()
      if (configured === 'gpt-image-2.5-flare') return 'gpt-image-2.5-flare'
      if (configured && configured !== 'gpt-image-2' && configured !== 'gpt-image-2.5') return configured
      return 'gpt-image-2.5-sunburst'
    })(),
    versionTag: 'v0.9.1-r3-gpt-image-2.5-sunburst',
    temperature: 0.0,
    maxTokens: 0,
    timeoutMs: 45000,
    retryCount: 2,
    structuredOutput: false,
    costPer1kTokensWon: 0,
    costPerImageUnitWon: 60,
    creditCostSC: 150, // 1장당 150 SC
    description: '이미지 생성 전담 AI (OpenAI GPT Image 2.5). Flare(무드/일반) 및 Sunburst(실사 인물/정밀) 2대 모드'
  }
}

/**
 * Gemini 3.8 Flash Fallback Profile Definition
 */
export const GEMINI_FALLBACK_PROFILE: ModelProfile = {
  role: 'conversation',
  provider: 'gemini',
  modelId: process.env.GEMINI_FALLBACK_MODEL || 'gemini-3.8-flash',
  versionTag: 'v0.8.9-6th-gemini-adapter',
  temperature: 0.6,
  maxTokens: 4096,
  timeoutMs: 25000,
  retryCount: 2,
  structuredOutput: false,
  costPer1kTokensWon: 5,
  costPerImageUnitWon: 0,
  creditCostSC: 1,
  description: '제미나이 3.8 플래시 어댑터 및 향후 고속 추론 폴백 프로파일'
}

/**
 * Get active profile for role
 */
export function getModelProfile(role: AIRole): ModelProfile {
  const base = MODEL_PROFILES[role]
  const profile = { ...base }
  if (role === 'conversation' && process.env.AI_CONVERSATION_PROVIDER) {
    profile.provider = process.env.AI_CONVERSATION_PROVIDER as AIProvider
  } else if (role === 'action' && process.env.AI_ACTION_PROVIDER) {
    profile.provider = process.env.AI_ACTION_PROVIDER as AIProvider
  }
  return profile
}
