/**
 * Sohee V0.8.9 Conversation Brain (ANI-649, ANI-965)
 *
 * Model: Google Gemini 3.5 Flash Lite (Conversation Brain Profile)
 * Responsibilities:
 * 1. 사장님과의 일상 대화, 매장 운영 고충 공감, 마케팅 조언 (따뜻하고 정중한 극존칭)
 * 2. Intent & Goal 이해 및 필요한 작업 범위 설명
 * 3. Multi-step Interview 대화형 질문/선택지 제시
 * 4. Action Worker가 반환한 도구 실행 결과를 종합하여 사용자 친화적 최종 보고 합성
 * 5. 외부 시스템 직접 쓰기 금지 (모든 mutation은 Action Worker / Orchestrator에 위임)
 * 6. Unknown-Safe Guard: 미확인/오류/차단 상태에서 허위 안심 카피 전면 차단 (ANI-965)
 * 7. Operational Control Bypass: PAUSE/RESUME/STATUS 등 단순 운영 제어 시 4단계 CoT 우회 및 간결 브리핑 (ANI-965)
 */

import { getModelProfile, getGeminiApiKey, getGeminiApiBaseUrl } from './model-profiles'
import type { WorkspaceMarketingContext } from '@/lib/agent-os/workspace-marketing-context'
import type { CanonicalSurfaceContext } from '@/features/agent-session/types'

export const FORBIDDEN_OPTIMISTIC_PHRASES = [
  '소희가 매장 상태를 안전하게 지키고 있습니다',
  '매장 상태를 안전하게 지키고 있습니다',
  '안전하게 가동 중',
  '안전하게 운영 중',
  '정상적으로 가동 중',
  '정상 가동 중',
  '문제없이 가동',
  '모든 시스템이 정상',
  '안전하게 실행되었습니다',
]

export const DRAFT_HONESTY_INSTRUCTION =
  '도구 결과에 명시되지 않은 저장 위치를 말하지 마세요. content.generate 결과에 openInStudioPath가 있으면 초안을 \'콘텐츠 센터의 4채널 글 만들기\'에서 확인·수정하거나 대화창의 미리보기 카드에서 확인할 수 있다고 안내하고, 보관함에는 사장님이 직접 \'보관하기\'를 누르기 전까지 들어가지 않는다고 말하세요. needsAttention이 참이거나 needsCheck가 참이면 statusLabel과 issues를 먼저 알리고 보관할 수 있다고 말하지 마세요. 발행·게시·예약은 도구 결과에서 해당 발행 도구(publish)의 성공과 게시 확인이 명시된 경우에만 했다고 말하고, 그 외에는 하지 않았다고 말하세요. 인스타그램, 스레드는 사장님 승인을 거쳐 실발행이 가능합니다. 네이버 블로그는 자동 게시·예약·로그인을 제공하지 않으며, 소희가 원고와 사진을 준비하면 사장님이 제목·본문·태그를 복사하고 사진을 받아 네이버에서 직접 올린 뒤 글 주소를 알려 주는 방식만 지원한다고 안내하세요. 당근은 미리보기로 지원됩니다. 고객 댓글 및 리뷰 답글(review.respond, comment.reply)은 사장님 승인을 거쳐 답변을 전송할 수 있습니다. 도구 목록에 없거나 지원되지 않는 기능(예: 예약 발행, 문자 발송 등)은 실행한 척하지 말고 "아직 지원하지 않아요"라고 솔직하게 안내하고 대신 할 수 있는 대안을 제시하세요.'

export interface UnknownSafeParams {
  errorCode: string
  traceId: string
  reconcileCTA: string
  reason?: string
  channel?: string
}

export function formatUnknownSafeResponse(params: UnknownSafeParams): string {
  return '사장님, 아직 실행 결과를 확인하지 못했어요. 완료됐다고 안내하지 않을게요. 중복 게시·전송을 막기 위해 같은 작업을 다시 실행하지 않아요. 소희에게 “방금 작업 결과 확인해 줘”라고 말씀해 주세요.'
}

export interface BlockedParams {
  errorCode: string
  traceId: string
  reconcileCTA: string
  reason?: string
  channel?: string
}

export function formatBlockedResponse(params: BlockedParams): string {
  switch (params.errorCode) {
    case 'ARTIFACT_REVIEW_REQUIRED':
    case 'MISSING_APPROVED_ASSET':
      return '아직 게시하지 않았어요. 게시할 원고와 사진을 먼저 준비하고, 사장님이 최종 내용을 승인하면 소희가 연결과 권한을 확인해 게시해요. [원고 준비하기](/app/work/new)에서 이어가거나, 대화로 원하시는 내용을 알려 주세요.'
    case 'KILL_SWITCH_ENGAGED':
      return '서비스의 외부 실행이 일시 중지되어 게시·전송을 시작하지 않았어요. 사장님이 설정을 바꾸실 필요는 없어요. 소희에게 실행 상태 확인을 요청해 주세요.'
    case 'NO_SEND_SCOPE':
    case 'CHANNEL_NOT_CONNECTED':
      return '채널의 연결 또는 전송 권한이 확인되지 않아 아직 실행하지 않았어요. 소희에게 “채널 연결 도와줘”라고 말씀해 주세요. 연결된 뒤에도 최종 승인 전에는 보내지 않아요.'
    default:
      return '실행에 필요한 조건을 확인하지 못해 아직 시작하지 않았어요. 사장님이 직접 점검하실 필요는 없어요. 소희에게 “이 작업을 이어서 준비해 줘”라고 말씀해 주세요. 최종 승인 전에는 게시하거나 전송하지 않아요.'
  }
}

export function isOperationalControlCommand(message: string): boolean {
  const normalized = message.trim().toUpperCase()
  const operationalKeywords = [
    'PAUSE',
    'RESUME',
    'STATUS',
    '일시정지',
    '일시 정지',
    '일시중지',
    '일시 중지',
    '멈춰',
    '정지해',
    '재개',
    '다시 시작',
    '다시시작',
    '계속해',
    '상태 확인',
    '상태조회',
    '상태 조회',
    '현재 상태',
    '가동 상태',
    '현황 보고',
  ]
  return operationalKeywords.some(kw => normalized.includes(kw))
}

export function formatSurfaceContextSystemPrompt(
  surfaceContext?: CanonicalSurfaceContext | Record<string, unknown> | string
): string | null {
  if (!surfaceContext) return null

  const ctx: { route?: string; routeName?: string; tab?: string; selectedItemId?: string; entityType?: string } =
    typeof surfaceContext === 'string'
      ? { route: surfaceContext }
      : (surfaceContext as any)

  const route = ctx.route || '/app'
  const routeName = ctx.routeName || 'home'

  const displayNameMap: Record<string, string> = {
    home: '홈 워크벤치',
    content: '콘텐츠 센터',
    vault: '보관함',
    customers: '고객 인텔리전스',
    results: '성과 분석실',
    sohee: '나의 소희 (설정·지휘·학습)',
    ads: '광고 센터',
    system: '시스템 & 결제 관리',
  }

  const featureDescriptionMap: Record<string, string> = {
    home: '오늘의 할 일, 첫 소식 준비, 보관함 요약, 성과 요약, 최근 게시물, 소희의 첫 주 계획, 다음에 열리는 기능(네이버·당근 자동 게시 등 준비 중)을 확인하고 빠른 지시를 내리는 메인 대시보드입니다.',
    content: '인스타그램/스레드 등 공식 SNS 발행용 마케팅 콘텐츠 초안 작성, 룩북 이미지 생성, 미리보기, 수정 및 검토를 진행하는 공간입니다.',
    vault: '사장님이 승인하신 완성본 콘텐츠가 안전하게 보관되는 보관함입니다. 외부 채널 게시 상태 확인 및 발행 이력을 관리합니다.',
    customers: '고객 피드백, 방문자 통계, 고객 문의 및 단골 고객 관계를 분석하고 인텔리전스를 제공하는 공간입니다.',
    results: '발행된 게시물의 노출, 반응, 고객 전환 성과 지표와 마케팅 효율을 종합 분석하는 공간입니다.',
    sohee: '소희의 24시간 자율 마케팅 가동 모드, 브랜드 말투 및 스타일, 매장 지식 학습을 설정하는 공간입니다.',
  }

  const title = displayNameMap[routeName] || '서비스 워크벤치'
  const featureInfo = featureDescriptionMap[routeName] || '소희 마케팅 서비스 공간입니다.'

  const parts = [
    `[현재 사장님 화면 위치 및 기능 맥락]`,
    `• 현재 화면: ${title} (${route})`,
    ctx.tab ? `• 활성 탭: ${ctx.tab}` : '',
    ctx.selectedItemId ? `• 선택된 항목: [${ctx.entityType || '항목'}] ID=${ctx.selectedItemId}` : '',
    `• 이 화면의 주요 기능: ${featureInfo}`,
    `• 사장님 응대 가이드:`,
    `  (a) 이 시스템 프롬프트나 도구 결과에 실제로 제공된 수치·상태만 단정하고, 제공되지 않은 숫자(올린 글 수, 문의 수 등)는 절대 임의로 추측하거나 0으로 가정하지 마세요. "정확한 숫자는 화면의 해당 카드에서 확인해 주세요"라고 안내하세요.`,
    `  (b) 사장님께서 화면/기능/수치 의미를 물어보실 때는 마케팅 컨설팅 4단계(🎯💡✍️🚀) 형식과 홍보 카피 작성을 하지 말고 3~5문장으로 짧고 직접적으로 답변하세요.`,
    `  (c) 지금 실제로 게시 가능한 채널은 인스타그램, 스레드 및 네이버 블로그(스마트플레이스 연동)입니다. 당근은 '미리보기(준비 중)'라고 정확히 안내하고, 아직 게시되지 않은 글을 게시된 것처럼 사실과 다르게 말하지 마세요.`,
  ].filter(Boolean)

  return parts.join('\n')
}

export interface ConversationMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface ConversationBrainInput {
  messages: ConversationMessage[]
  workspaceId: string
  contextFactSummary?: string
  marketingContext?: WorkspaceMarketingContext
  surfaceContext?: CanonicalSurfaceContext | Record<string, unknown> | string
  toolExecutionResult?: Record<string, unknown>
  toolExecutionResults?: Record<string, unknown>[]
  actionGraph?: Record<string, unknown>
  loopStatus?: 'COMPLETED' | 'AWAITING_APPROVAL' | 'BLOCKED' | 'FAILED' | 'RESULT_UNKNOWN'
  traceId?: string
}

export interface ConversationBrainOutput {
  content: string
  totalTokens: number
  modelId: string
  role: 'conversation'
  profileSnapshot: {
    modelId: string
    provider: string
    temperature: number
    versionTag: string
  }
  traceId?: string
  errorCode?: string
  reconcileCTA?: string
  isUnknownSafe?: boolean
  isOperationalBriefing?: boolean
}

export class ConversationBrain {
  private static extractUnknownOrBlockedState(input: ConversationBrainInput): {
    isBlocked: boolean
    isUnknown: boolean
    errorCode: string
    traceId: string
    reconcileCTA: string
  } {
    const traceId =
      input.traceId || `trace_cb_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`

    const results = [input.toolExecutionResult, ...(input.toolExecutionResults ?? [])].filter(Boolean) as Record<string, any>[]
    // Unknown delivery outranks a blocked step: never claim nothing started after an uncertain write.
    const unknownResult = results.find(result =>
      result.stage === 'RESULT_UNKNOWN' || result.status === 'RESULT_UNKNOWN' ||
      result.errorCode === 'READBACK_FAILED' || result.error?.code === 'RESULT_UNKNOWN',
    )
    const toolRes = unknownResult ?? results.find(result =>
      result.blocked === true || result.stage === 'BLOCKED' || result.status === 'BLOCKED' ||
      result.errorCode || result.error?.code,
    )
    const isUnknown = Boolean(unknownResult) || input.loopStatus === 'FAILED' || input.loopStatus === 'RESULT_UNKNOWN'
    const isBlocked = !isUnknown && (
      input.loopStatus === 'BLOCKED' || toolRes?.blocked === true ||
      toolRes?.stage === 'BLOCKED' || toolRes?.status === 'BLOCKED' ||
      toolRes?.errorCode === 'KILL_SWITCH_ENGAGED'
    )

    const errorCode =
      toolRes?.errorCode ||
      toolRes?.error?.code ||
      (isBlocked ? 'EXECUTION_BLOCKED' : isUnknown ? 'RESULT_UNKNOWN' : 'UNKNOWN')

    const reconcileCTA =
      (isUnknown
        ? '중복 실행하지 말고 소희에게 방금 작업의 결과 확인을 요청해 주세요.'
        : '소희에게 이 작업을 이어서 준비해 달라고 말씀해 주세요.')

    return { isBlocked, isUnknown, errorCode, traceId, reconcileCTA }
  }

  private static sanitizeContent(
    rawContent: string,
    state: { isBlocked: boolean; isUnknown: boolean; errorCode: string; traceId: string; reconcileCTA: string }
  ): { content: string; sanitized: boolean } {
    if (!state.isBlocked && !state.isUnknown) {
      return { content: rawContent, sanitized: false }
    }

    const hasForbidden = FORBIDDEN_OPTIMISTIC_PHRASES.some(phrase => rawContent.includes(phrase))
    if (hasForbidden || state.isUnknown) {
      const content = state.isBlocked
        ? formatBlockedResponse({
            errorCode: state.errorCode,
            traceId: state.traceId,
            reconcileCTA: state.reconcileCTA,
          })
        : formatUnknownSafeResponse({
            errorCode: state.errorCode,
            traceId: state.traceId,
            reconcileCTA: state.reconcileCTA,
          })
      return { content, sanitized: true }
    }

    return { content: rawContent, sanitized: false }
  }

  public static async generateResponse(
    input: ConversationBrainInput
  ): Promise<ConversationBrainOutput> {
    const profile = getModelProfile('conversation')
    const stateGuard = this.extractUnknownOrBlockedState(input)
    const modelId = profile.modelId || 'gemini-3.5-flash-lite'

    try {
      return await this.callGeminiAdapter(input, modelId)
    } catch (err: unknown) {
      console.error('[ConversationBrain] Gemini execution failed, synthesizing unknown-safe response:', err)

      const errorCode = stateGuard.isBlocked
        ? stateGuard.errorCode
        : stateGuard.isUnknown
        ? stateGuard.errorCode
        : 'MODEL_FAILURE'

      const reconcileCTA = stateGuard.isBlocked
        ? stateGuard.reconcileCTA
        : stateGuard.isUnknown
        ? stateGuard.reconcileCTA
        : '잠시 후 다시 질문해 주시거나 [작업 대시보드]에서 최신 상태를 확인해 주세요.'

      const content = stateGuard.isBlocked
        ? formatBlockedResponse({
            errorCode,
            traceId: stateGuard.traceId,
            reconcileCTA,
            reason: err instanceof Error ? err.message : String(err),
          })
        : formatUnknownSafeResponse({
            errorCode,
            traceId: stateGuard.traceId,
            reconcileCTA,
            reason: err instanceof Error ? err.message : String(err),
          })

      return {
        content,
        totalTokens: 0,
        modelId,
        role: 'conversation',
        traceId: stateGuard.traceId,
        errorCode,
        reconcileCTA,
        isUnknownSafe: true,
        profileSnapshot: {
          modelId,
          provider: 'gemini',
          temperature: 0.65,
          versionTag: 'v0.9.0-13th-gemini-lite',
        },
      }
    }
  }

  private static async callGeminiAdapter(input: ConversationBrainInput, modelId: string): Promise<ConversationBrainOutput> {
    const geminiKey = getGeminiApiKey()
    if (!geminiKey) {
      throw new Error('GEMINI_API_KEY is not configured')
    }

    const stateGuard = this.extractUnknownOrBlockedState(input)
    const addressTerm = input.marketingContext?.dynamicPersona?.addressTerm || '사장님'
    const lastUserMessage = [...input.messages].reverse().find(m => m.role === 'user')?.content || ''
    const isOperational = isOperationalControlCommand(lastUserMessage)

    // Build system instruction parts
    const systemParts: string[] = []
    if (isOperational) {
      systemParts.push(`당신은 소희 에이전트 OS의 두뇌이자 매장 총괄 AI 운영 파트너 '소희(Sohee)'입니다.
현재 ${addressTerm}께서 운영 제어 명령(PAUSE, RESUME, STATUS 조회)을 전달하셨습니다.
[운영 제어 브리핑 강령]
1. 마케팅 컨설팅 4단계 CoT를 절대 출력하지 마십시오.
2. 현재 실행 상태, 자율 가동 모드, 또는 조회된 운영 현황에 대해 간결하고 사실에 기반하여(Factual Truth) 명확하게 2~3문장 이내로 브리핑하십시오.
3. 정중하고 품격 있는 극존칭(${addressTerm})을 사용하십시오.`)
    } else {
      const toneGuidelines = input.marketingContext?.dynamicPersona?.toneGuidelines || '다정하고 따뜻하면서도 실력 있는 전문 마케터로서의 품격 있는 극존칭'
      systemParts.push(`당신은 소희 에이전트 OS의 두뇌이자 매장 총괄 AI 마케팅 파트너 '소희(Sohee)'입니다.
엔진: Google Gemini (대화 전담 가성비 엔진: ${modelId}).
[소희의 핵심 정체성 및 응답 강령]
1. ${addressTerm}을 진심으로 존중하는 가장 든든한 러닝메이트입니다. 항상 "${addressTerm}"으로 부르며, ${toneGuidelines}을 씁니다.
2. 절대 단순한 일반론이나 영혼 없는 뻔한 조언을 하지 않고, 매장의 실제 업종 특성과 데이터를 사실대로 반영합니다.
3. 매장 상황과 상권, 고객 심리를 깊게 고려하여 다음 4단계 구조화된 통찰을 담아 답변합니다:
   - 🎯 [1단계: 현상 진단 & 고객 심리 분석]
   - 💡 [2단계: 마케팅 전략 인과관계]
   - ✍️ [3단계: 즉시 복사해서 쓸 수 있는 실전 솔루션 및 완성형 카피]
   - 🚀 [4단계: 든든한 실행 및 다음 단계 제안]`)
    }

    if (input.marketingContext?.contextSummary) {
      systemParts.push(`[매장 비즈니스 프로필]\n${input.marketingContext.contextSummary}`)
    }
    if (input.contextFactSummary) {
      systemParts.push(`[매장 및 운영 장기 기억(Long-term Memory Context)]\n${input.contextFactSummary}`)
    }

    const surfacePromptGemini = formatSurfaceContextSystemPrompt(input.surfaceContext)
    if (surfacePromptGemini) {
      systemParts.push(surfacePromptGemini)
    }

    if (input.actionGraph || (input.toolExecutionResults && input.toolExecutionResults.length > 0)) {
      const summaryPayload = {
        status: input.loopStatus || 'COMPLETED',
        executedStepsCount: input.toolExecutionResults?.length || 0,
        results: input.toolExecutionResults || [input.toolExecutionResult],
        ...(input.actionGraph ? { actionGraph: input.actionGraph } : {}),
      }
      systemParts.push(`[실행된 도구 순차 결과 및 액션 그래프 (Real Truth)]\n${JSON.stringify(summaryPayload, null, 2)}\n\n위 다단계 실행 결과를 사장님께 친절하고 정중하게 단계별로 보고하고 다음 액션을 제안해 드려. 만약 승인 대기(AWAITING_APPROVAL) 상태라면 승인이 필요한 이유를 안내해 드려. 만약 실행 차단(BLOCKED) 상태라면 사유를 솔직하게 알리고 조치 방안을 제시해 드려.\n\n${DRAFT_HONESTY_INSTRUCTION}`)
    } else if (input.toolExecutionResult) {
      systemParts.push(`[방금 실행된 MCP 도구 실제 결과 (Truth)]\n${JSON.stringify(input.toolExecutionResult, null, 2)}\n\n위 실행 결과를 ${addressTerm}께 친절하고 정중하게 보고하고 다음 추천 액션을 제안해 드려.\n\n${DRAFT_HONESTY_INSTRUCTION}`)
    }

    if (input.marketingContext?.brand?.prohibitedTerms && input.marketingContext.brand.prohibitedTerms.length > 0) {
      systemParts.push(`[절대 사용 금지어 강령]\n금지어: [${input.marketingContext.brand.prohibitedTerms.join(', ')}]. 답변에 절대 포함 금지.`)
    }

    if (stateGuard.isBlocked || stateGuard.isUnknown) {
      systemParts.push(`[안전 강령: 허위 안심 카피 절대 금지]
상태 미확인(RESULT_UNKNOWN) 또는 차단(BLOCKED) 상태입니다. '안전하게 가동 중', '정상 가동' 등의 근거 없는 표현을 절대 금지합니다.
식별된 오류 코드(${stateGuard.errorCode})와 조치 방안(Reconcile CTA: ${stateGuard.reconcileCTA})을 솔직하게 안내하십시오.`)
    }

    // Build Gemini contents (alternating user/model)
    const contents: Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }> = []
    for (const msg of input.messages) {
      if (msg.role === 'system') continue // handled via systemInstruction
      contents.push({
        role: msg.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: msg.content }],
      })
    }

    if (contents.length === 0) {
      contents.push({ role: 'user', parts: [{ text: '안녕하세요 소희님!' }] })
    }

    const payload: any = {
      contents,
      generationConfig: {
        temperature: isOperational ? 0.2 : 0.65,
        maxOutputTokens: 2048,
      },
    }

    if (systemParts.length > 0) {
      payload.systemInstruction = {
        parts: systemParts.map(t => ({ text: t })),
      }
    }

    const baseUrl = getGeminiApiBaseUrl()
    const url = `${baseUrl}/v1beta/models/${modelId}:generateContent?key=${geminiKey}`
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })

    if (!res.ok) {
      const errText = await res.text()
      console.warn(`[ConversationBrain] Gemini call failed with status ${res.status}: ${errText}`)
      throw new Error(`Gemini Conversation Error: ${res.status} - ${errText}`)
    }

    const data = (await res.json()) as any
    const rawContent = data.candidates?.[0]?.content?.parts?.[0]?.text || '사장님! 말씀 확인했습니다 😊 항상 매장 곁에서 든든하게 챙겨드릴게요!'
    const { content, sanitized } = this.sanitizeContent(rawContent, stateGuard)
    const totalTokens = data.usageMetadata?.totalTokenCount || 350
    const isUnknownSafe = stateGuard.isBlocked || stateGuard.isUnknown || sanitized

    return {
      content,
      totalTokens,
      modelId,
      role: 'conversation',
      traceId: stateGuard.traceId,
      errorCode: isUnknownSafe ? stateGuard.errorCode : undefined,
      reconcileCTA: isUnknownSafe ? stateGuard.reconcileCTA : undefined,
      isUnknownSafe: isUnknownSafe ? true : undefined,
      isOperationalBriefing: isOperational ? true : undefined,
      profileSnapshot: {
        modelId,
        provider: 'gemini',
        temperature: isOperational ? 0.2 : 0.65,
        versionTag: 'v0.9.0-13th-gemini-lite',
      },
    }
  }
}
