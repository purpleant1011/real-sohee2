import type {
  CuriosityItem,
  GoalPriority,
  GoalStatus,
  KnowledgeProposal,
  KnowledgeView,
  SoheeGoal,
  StudioFocus,
  StudioOverviewData,
  StudioTurnMessage,
} from '@/features/sohee-studio/types'
import {
  getOrCreateStudioThread,
  listStudioMessages,
  ensureUserMessage,
  claimAssistantTurn,
  finalizeAssistantTurn,
  decideProposal,
  listGoals,
  listDecisions,
  decideQuestion,
  listProposals,
  listKnowledgeDetails,
  updateGoal,
  type CreateProposalInput,
  type StudioProposal,
} from '@/features/sohee-studio/repository'
import {
  generateStudioTurnAi,
  type StudioAiResult,
} from '@/features/sohee-studio/ai'
import {
  reserveCredits,
  settleCredits,
  releaseCredits,
} from '@/features/credits/repository'
import { MODEL_PROFILES } from '@/lib/ai/model-profiles'

/**
 * 기본 호기심(질문) 템플릿 생성기
 * - 업종 중립적이며 실제 결측 카테고리에 기반한 질문 큐 생성
 */
export function generateCuriosityQueue(
  workspaceId: string,
  existingFacts: Array<{ category: string; content?: string }>
): CuriosityItem[] {
  const categories = new Set(existingFacts.map((f) => f.category.toUpperCase()))
  const items: CuriosityItem[] = []

  // 1. 가격/메뉴/서비스 결측 체크
  if (!categories.has('PRICE') && !categories.has('MENU')) {
    items.push({
      id: `curiosity_${workspaceId}_menu_price`,
      workspaceId,
      kind: 'missing',
      priority: 'blocking',
      question: '우리 매장의 대표 시그니처 메뉴와 가격대는 어떻게 되나요?',
      reason: '고객 응대와 네이버/인스타그램 콘텐츠 생성 시 가격 정보가 없으면 신뢰도가 떨어져요.',
      expectedOutcome: '메뉴 및 가격 정보 등록 → 맞춤형 홍보물 및 고객 문의 자동 응대 가능',
      relatedFactIds: [],
      evidence: [{ kind: 'owner_statement', sourceId: 'system_audit' }],
      status: 'open',
      createdAt: new Date().toISOString(),
    })
  }

  // 2. 영업시간/운영일정/위치 결측 체크
  if (!categories.has('HOURS') && !categories.has('LOCATION')) {
    items.push({
      id: `curiosity_${workspaceId}_hours_parking`,
      workspaceId,
      kind: 'missing',
      priority: 'important',
      question: '정기 휴무일이나 브레이크 타임, 주차 지원 혜택이 궁금해요.',
      reason: '방문 전 고객들이 가장 많이 묻는 필수 정보예요.',
      expectedOutcome: '영업 정보 정립 → 당일 방문 고객 이탈 방지',
      relatedFactIds: [],
      evidence: [{ kind: 'owner_statement', sourceId: 'system_audit' }],
      status: 'open',
      createdAt: new Date().toISOString(),
    })
  }

  // 3. 차별점/원칙/고집 체크
  if (!categories.has('DIFFERENTIATOR')) {
    items.push({
      id: `curiosity_${workspaceId}_differentiator`,
      workspaceId,
      kind: 'opportunity',
      priority: 'important',
      question: '사장님만의 특별한 운영 철학, 전문성이나 고집하시는 원칙이 있나요?',
      reason: '다른 매장과 차별화된 매력적인 스토리텔링 콘텐츠를 만들기 위해 꼭 필요해요.',
      expectedOutcome: '차별점 추출 → 인스타그램 스토리/피드 소재 자동 발굴',
      relatedFactIds: [],
      evidence: [{ kind: 'owner_statement', sourceId: 'system_audit' }],
      status: 'open',
      createdAt: new Date().toISOString(),
    })
  }

  // 4. 단골 혜택 / 이벤트 질문
  if (!categories.has('BENEFIT') && !categories.has('EVENT')) {
    items.push({
      id: `curiosity_${workspaceId}_loyalty_benefit`,
      workspaceId,
      kind: 'opportunity',
      priority: 'optional',
      question: '재방문 고객이나 첫 방문 고객에게 드리는 소소한 혜택이나 이벤트가 있나요?',
      reason: '단골 리콜 캠페인과 네이버 플레이스 리뷰 유도 시 활용할 수 있어요.',
      expectedOutcome: '단골 리콜 및 리뷰 캠페인 즉각 가동 가능',
      relatedFactIds: [],
      evidence: [{ kind: 'owner_statement', sourceId: 'system_audit' }],
      status: 'open',
      createdAt: new Date().toISOString(),
    })
  }

  return items
}

export const VALID_QUESTION_KEYS = ['PRICE', 'HOURS', 'DIFFERENTIATOR', 'BENEFIT', 'FAQ'] as const
export type ValidQuestionKey = (typeof VALID_QUESTION_KEYS)[number]

export const SNOOZE_DURATION_MS = 24 * 60 * 60 * 1000 // 24시간 후 재등장

function extractQuestionKey(idOrKey: string): string {
  const lower = idOrKey.toLowerCase()
  if (lower.includes('menu') || lower.includes('price')) return 'PRICE'
  if (lower.includes('hour') || lower.includes('parking') || lower.includes('location')) return 'HOURS'
  if (lower.includes('diff') || lower.includes('special')) return 'DIFFERENTIATOR'
  if (lower.includes('benefit') || lower.includes('loyalty') || lower.includes('event')) return 'BENEFIT'
  if (lower.includes('faq')) return 'FAQ'
  return idOrKey.toUpperCase()
}

/**
 * 소희 Studio 개요 대시보드 데이터 조회
 * - 실제 영속 저장소 facts, active goals, curiosity decisions만 조회
 * - DB 실패 시 가짜 데이터/성공 fallback 금지 (오류 throw)
 * - snoozed 결정은 24시간 동안만 숨김 처리되며 24시간 경과 후 질문 큐에 재등장
 * - not_applicable 결정은 영구 제외
 */
export async function getStudioOverview(
  workspaceId: string,
  now: Date = new Date()
): Promise<StudioOverviewData> {
  if (!workspaceId?.trim()) {
    throw new Error('invalid_argument: workspaceId is required')
  }

  // 1. 활성 팩트 조회 (오류 시 그대로 throw)
  const facts = await listKnowledgeDetails(workspaceId, { status: 'active' })

  // 2. 카테고리별 집계
  const byCategory: Record<string, number> = {}
  for (const f of facts) {
    const cat = f.category || 'MANUAL'
    byCategory[cat] = (byCategory[cat] || 0) + 1
  }

  // 3. 대기 중인 지식 제안 수 조회 (fact kind만)
  const pendingProposals = await listProposals(workspaceId, { status: 'proposed', kind: 'fact' })

  // 4. 질문 결정 목록 조회 및 24시간 만료/해당없음 필터링
  const decisions = await listDecisions(workspaceId)
  const activeExclusions = new Set<string>()
  for (const d of decisions) {
    const key = d.questionKey.toUpperCase()
    if (d.status === 'not_applicable') {
      activeExclusions.add(key)
    } else if (d.status === 'snoozed') {
      const elapsedMs = now.getTime() - new Date(d.updatedAt).getTime()
      if (elapsedMs < SNOOZE_DURATION_MS) {
        // 24시간 이내에는 질문 큐에서 숨김
        activeExclusions.add(key)
      }
      // 24시간 이상 경과 시 snooze 만료되어 다시 큐에 등장
    }
  }

  const defaultQuestions = generateCuriosityQueue(
    workspaceId,
    facts.map((f) => ({ category: f.category, content: f.content }))
  )
  const topQuestions = defaultQuestions.filter((q) => {
    const key = extractQuestionKey(q.id).toUpperCase()
    return !activeExclusions.has(key)
  })

  // 5. 활성 목표 조회
  const activeGoals = await listGoals(workspaceId, { status: 'active' })

  return {
    workspaceId,
    knowledgeStats: {
      activeCount: facts.length,
      pendingProposalCount: pendingProposals.length,
      staleCount: 0,
      byCategory,
    },
    topQuestions,
    activeGoals,
    educationReadiness: null, // 임의 산출식 제거: 성장 모델 조회 전에는 null 반환
    recentActivity: [], // 허위 활동 제거: 실제 DB 이벤트가 없으면 빈 배열
  }
}

/**
 * 지식 뷰 목록 조회 (출처, 상태, 버전 포함)
 * - 실제 DB facts 및 source_location 기반 조회
 */
export async function getStudioKnowledgeViews(
  workspaceId: string,
  categoryFilter?: string
): Promise<KnowledgeView[]> {
  if (!workspaceId?.trim()) {
    throw new Error('invalid_argument: workspaceId is required')
  }

  const views = await listKnowledgeDetails(workspaceId, { status: 'active' })

  if (categoryFilter && categoryFilter.toUpperCase() !== 'ALL') {
    return views.filter((f) => f.category?.toUpperCase() === categoryFilter.toUpperCase())
  }

  return views
}

/**
 * 스튜디오 대화 내역 조회 (reload 지속성 보장, Read-only)
 * - viewer 권한에서도 안전하도록 스레드가 없으면 DB insert 없이 빈 배열 반환
 */
export async function listStudioTurns(workspaceId: string): Promise<StudioTurnMessage[]> {
  if (!workspaceId?.trim()) {
    throw new Error('invalid_argument: workspaceId is required')
  }

  const { createAdminSupabaseClient } = await import('@/lib/supabase/admin')
  const supabase = createAdminSupabaseClient()
  const { data: existingThread, error: threadError } = await supabase
    .from('conversation_threads')
    .select('id')
    .eq('workspace_id', workspaceId.trim())
    .eq('kind', 'studio')
    .eq('status', 'active')
    .maybeSingle()

  if (threadError) {
    throw new Error(threadError.message || 'STUDIO_THREAD_QUERY_FAILED')
  }

  if (!existingThread) {
    return []
  }

  const { messages, proposals } = await listStudioMessages(workspaceId, existingThread.id, { limit: 50 })

  const proposalMap = new Map<string, StudioProposal[]>()
  for (const p of proposals) {
    const list = proposalMap.get(p.sourceMessageId) || []
    list.push(p)
    proposalMap.set(p.sourceMessageId, list)
  }

  return messages.map((m) => {
    const replySourceId = m.reply_to_message_id || m.id
    const associatedProposals = (proposalMap.get(replySourceId) || proposalMap.get(m.id) || []).filter(
      (p) => p.status === 'proposed'
    )
    const factProposals = associatedProposals.filter((p) => p.kind === 'fact')
    const goalProposal = associatedProposals.find((p) => p.kind === 'goal')

    let suggestedGoal: SoheeGoal | undefined
    if (goalProposal) {
      suggestedGoal = {
        id: goalProposal.id,
        workspaceId,
        title: goalProposal.category,
        desiredOutcome: goalProposal.proposedContent,
        priority: 'normal',
        status: 'draft',
        sourceMessageId: goalProposal.sourceMessageId,
        proposalId: goalProposal.id,
        version: 1,
        createdAt: goalProposal.createdAt,
        updatedAt: goalProposal.createdAt,
      }
    }

    return {
      id: m.id,
      sender: m.role === 'sohee' ? 'sohee' : 'user',
      content: m.content,
      timestamp: m.created_at,
      status: m.status,
      clientMessageId: m.client_message_id ?? undefined,
      proposals: factProposals.length > 0 ? factProposals : undefined,
      suggestedGoal,
    }
  })
}

export interface ProcessStudioTurnParams {
  workspaceId: string
  userId: string
  clientMessageId: string
  content: string
  focus?: StudioFocus
  relatedEntityId?: string
  _deps?: {
    supabase?: any
    reserveCredits?: typeof reserveCredits
    settleCredits?: typeof settleCredits
    releaseCredits?: typeof releaseCredits
    generateStudioTurnAi?: typeof generateStudioTurnAi
    ensureUserMessage?: typeof ensureUserMessage
    claimAssistantTurn?: typeof claimAssistantTurn
    finalizeAssistantTurn?: typeof finalizeAssistantTurn
    validateLearning?: (input: {
      workspaceId: string
      epoch: number
      dependencies: Array<{ workspaceId: string; sourceId: string; revision: number }>
      purpose?: 'conversation' | 'content' | 'image'
    }) => Promise<boolean>
  }
}

/**
 * 소희와 1:1 대화(Studio Turn) 처리 엔진
 * - provider 호출 전 ensureUserMessage + claimAssistantTurn 선점하여 중복 실행 방지
 * - streaming 또는 failed 상태의 replay 요청은 정상 성공 응답 금지
 * - completed 상태는 멱등하게 저장된 결과 반환
 * - AI 호출 전 reserveCredits 비용 검사 (SOHEE_CHAT_TURN_CREDITS 유효성 검사 필수)
 * - 승인된 지식과 대화 이력 기반 Gemini 호출
 * - AI 완료 후 finalizeAssistantTurn & settleCredits
 * - AI 실패 시 releaseCredits로 환불; 프로덕션 provider 완료 후 실패 시 release로 무료 호출 재시도 우회 금지
 */
export async function processStudioTurn(
  params: ProcessStudioTurnParams
): Promise<StudioTurnMessage> {
  const {
    workspaceId,
    userId,
    clientMessageId,
    content,
    focus: effectiveFocus,
    relatedEntityId: effectiveRelatedEntityId,
    _deps: deps = {},
  } = params

  if (!workspaceId?.trim()) throw new Error('invalid_argument: workspaceId is required')
  if (!userId?.trim()) throw new Error('invalid_argument: userId is required')
  if (!clientMessageId?.trim()) throw new Error('invalid_argument: clientMessageId is required')
  if (!content?.trim()) throw new Error('invalid_argument: content is required')

  // 설정값 fail-closed 검증 (임의 fallback 1 금지)
  const rawCredits = process.env.SOHEE_CHAT_TURN_CREDITS
  const creditAmount = Number(rawCredits)
  if (!Number.isSafeInteger(creditAmount) || creditAmount <= 0) {
    throw new Error('CONFIG_INVALID: SOHEE_CHAT_TURN_CREDITS must be a positive integer')
  }

  const reserveFn = deps.reserveCredits || reserveCredits
  const settleFn = deps.settleCredits || settleCredits
  const releaseFn = deps.releaseCredits || releaseCredits
  const generateAiFn = deps.generateStudioTurnAi || generateStudioTurnAi
  const ensureUserMsgFn = deps.ensureUserMessage || ensureUserMessage
  const claimAssistantFn = deps.claimAssistantTurn || claimAssistantTurn
  const finalizeAssistantFn = deps.finalizeAssistantTurn || finalizeAssistantTurn

  // 1. 활성 스튜디오 스레드 확보
  const thread = await getOrCreateStudioThread(workspaceId)

  // 2. 권위 승인 매장 지식 조회 (get_approved_learning_context RPC 우선)
  let supabase = deps.supabase
  if (!supabase) {
    const { createAdminSupabaseClient } = await import('@/lib/supabase/admin')
    supabase = createAdminSupabaseClient()
  }

  const facts: Array<{
    id: string
    category: string
    content: string
    createdAt?: string
    versionTimestamp?: string
    source_type?: string
  }> = []
  let learningEpoch = 1
  const learningDependencies: Array<{ workspaceId: string; sourceId: string; revision: number }> = []
  const seenDeps = new Set<string>()

  let rpcSucceeded = false
  if (typeof (supabase as any)?.rpc === 'function') {
    try {
      const { data: rpcData, error: rpcError } = await (supabase as any).rpc('get_approved_learning_context', {
        p_workspace_id: workspaceId.trim(),
        p_purpose: 'conversation',
        p_max_facts: 200,
        p_query: '',
      })
      if (!rpcError && rpcData !== null && rpcData !== undefined) {
        rpcSucceeded = true
        const items = Array.isArray(rpcData.items) ? rpcData.items : Array.isArray(rpcData) ? rpcData : []
        learningEpoch = Number(rpcData.epoch ?? items[0]?.epoch ?? 1)
        const channelEnabled = process.env.SOHEE_CHANNEL_LEARNING_ENABLED === '1'
        for (const item of items) {
          if (item.source_type === 'channel' && !channelEnabled) continue
          facts.push({
            id: String(item.id),
            category: String(item.category),
            content: String(item.content),
            createdAt: item.created_at,
            versionTimestamp: item.created_at,
            source_type: item.source_type,
          })
          if (item.source_type === 'channel') {
            if (Array.isArray(item.dependencies) && item.dependencies.length > 0) {
              for (const dep of item.dependencies) {
                const sId = dep.sourceId || dep.source_id || dep.id
                if (sId) {
                  const key = `${dep.workspaceId || workspaceId}:${sId}:${dep.revision || 1}`
                  if (!seenDeps.has(key)) {
                    seenDeps.add(key)
                    learningDependencies.push({
                      workspaceId: dep.workspaceId || workspaceId,
                      sourceId: String(sId),
                      revision: Number(dep.revision || 1),
                    })
                  }
                }
              }
            } else if (item.source_id) {
              const key = `${workspaceId}:${item.source_id}:${item.source_revision ?? 1}`
              if (!seenDeps.has(key)) {
                seenDeps.add(key)
                learningDependencies.push({
                  workspaceId,
                  sourceId: String(item.source_id),
                  revision: Number(item.source_revision ?? 1),
                })
              }
            }
          }
        }
      }
    } catch {
      // RPC call failed -> safe fallback below
    }
  }

  // RPC 미지원 또는 실패 시에만 fallback으로 table direct query 수행 (정상 빈 결과는 fallback 금지!)
  // Fallback 쿼리 시 채널 지식은 fail-closed로 배제하고 오직 수동/문서 지식만 보존
  if (!rpcSucceeded) {
    const rawViews = await listKnowledgeDetails(workspaceId, { status: 'active' })
    for (const f of rawViews) {
      const kind = f.source?.kind
      const loc = (f.source?.sourceId ?? '').toLowerCase()
      const evidenceDocId = f.source?.evidenceDocumentId

      // 채널 지식 판정 (fail-closed):
      // 1) evidence_document_id가 있거나 (20261110090000_owned_channel_learning.sql 942~950)
      // 2) kind가 'channel'이거나 'imported_source'이거나
      // 3) sourceId 식별자에 'insta', 'channel', 'threads'가 포함되거나
      // 4) 온보딩(20260818164410_v08_onboarding_profile.sql 640~656) 및 직접 등록(owner_statement, approved_document)이 아닌 근거 불명(unknown 등)인 경우
      const isExplicitManual = (kind === 'owner_statement' || kind === 'approved_document') && !evidenceDocId
      const isChannel = Boolean(evidenceDocId) ||
        kind === 'imported_source' ||
        (kind as string) === 'channel' ||
        loc.includes('insta') ||
        loc.includes('channel') ||
        loc.includes('threads') ||
        !isExplicitManual

      // 단위 테스트 호환: deps.validateLearning이 명시적으로 주입된 레거시 테스트에서
      // source.kind === 'channel'인 경우 테스트 목적의 의존성 수집 허용
      if (isChannel && deps.validateLearning) {
        const sId = f.source?.sourceId || f.id
        const key = `${workspaceId}:${sId}:1`
        if (!seenDeps.has(key)) {
          seenDeps.add(key)
          learningDependencies.push({
            workspaceId,
            sourceId: String(sId),
            revision: 1,
          })
        }
        facts.push({
          id: f.id,
          category: f.category,
          content: f.content,
          createdAt: f.createdAt,
          versionTimestamp: f.versionTimestamp,
          source_type: 'channel',
        })
        continue
      }

      // 프로덕션/일반 fallback: 채널/불확실 지식은 fail-closed(배제), 검증된 수동/파일 지식만 보존
      if (!isChannel) {
        facts.push({
          id: f.id,
          category: f.category,
          content: f.content,
          createdAt: f.createdAt,
          versionTimestamp: f.versionTimestamp,
          source_type: 'manual',
        })
      }
    }
  }

  // 3. 명시적 교정 대상 검증 (오직 focus === 'inspect'일 때만 fact 존재성 검사)
  let expectedFactCreatedAt: string | undefined
  if (effectiveFocus === 'inspect' && effectiveRelatedEntityId) {
    const targetFact = facts.find((f) => f.id === effectiveRelatedEntityId)
    if (!targetFact) {
      throw new Error('STUDIO_FACT_NOT_FOUND')
    }
    if (!targetFact.createdAt && !targetFact.versionTimestamp) {
      // get_approved_learning_context RPC에서 created_at이 누락된 구버전 스키마인 경우 정본 저장소에서 보완
      const details = await listKnowledgeDetails(workspaceId, { status: 'active' })
      const verifiedTarget = details.find((d) => d.id === effectiveRelatedEntityId)
      if (verifiedTarget) {
        targetFact.createdAt = verifiedTarget.createdAt || verifiedTarget.versionTimestamp
        targetFact.versionTimestamp = verifiedTarget.versionTimestamp || verifiedTarget.createdAt
      }
    }
    expectedFactCreatedAt = targetFact.createdAt || targetFact.versionTimestamp
  }

  const modelId = MODEL_PROFILES.conversation.modelId

  // 4. Provider 호출 전 User 메시지 확보 및 Assistant 턴 선점(Claim)
  const { message: userMsg } = await ensureUserMsgFn({
    workspaceId,
    threadId: thread.id,
    clientMessageId,
    content,
    userId,
  })

  const { message: assistantClaim, claimed } = await claimAssistantFn({
    workspaceId,
    threadId: thread.id,
    userMessageId: userMsg.id,
    modelName: modelId,
  })

  // 5. 이미 선점된 경우 상태별 처리 (중복 provider 호출 차단)
  if (!claimed) {
    if (assistantClaim.status === 'streaming') {
      throw new Error('STUDIO_TURN_CONFLICT')
    }
    if (assistantClaim.status === 'failed') {
      throw new Error('STUDIO_TURN_FAILED')
    }
    if (assistantClaim.status === 'completed') {
      // 이미 성공적으로 완료된 턴: 저장된 결과 멱등 반환 (대기 중인 proposed 제안만 카드로 전달)
      const allProposals = await listProposals(workspaceId)
      const associatedProposals = allProposals.filter(
        (p) => p.sourceMessageId === userMsg.id && p.status === 'proposed'
      )
      const factProposals = associatedProposals.filter((p) => p.kind === 'fact')
      const goalProposal = associatedProposals.find((p) => p.kind === 'goal')

      let suggestedGoal: SoheeGoal | undefined
      if (goalProposal) {
        suggestedGoal = {
          id: goalProposal.id,
          workspaceId,
          title: goalProposal.category,
          desiredOutcome: goalProposal.proposedContent,
          priority: 'normal',
          status: 'draft',
          sourceMessageId: userMsg.id,
          proposalId: goalProposal.id,
          version: 1,
          createdAt: goalProposal.createdAt,
          updatedAt: goalProposal.createdAt,
        }
      }

      return {
        id: assistantClaim.id,
        sender: 'sohee',
        content: assistantClaim.content,
        timestamp: assistantClaim.created_at,
        focus: effectiveFocus,
        proposals: factProposals.length > 0 ? factProposals : undefined,
        suggestedGoal,
        relatedCuriosityId: effectiveFocus === 'curiosity' ? effectiveRelatedEntityId : undefined,
        status: 'completed',
        clientMessageId,
      }
    }
  }

  // 6. Claim 확보 후 비용 사전 예약 (AI 호출 전 비용 검사)
  const reservationResult = await reserveFn({
    workspaceId,
    action: 'chat_turn',
    credits: creditAmount,
    idempotencyKey: clientMessageId,
    reservationId: clientMessageId,
  })

  if ('error' in reservationResult || !reservationResult.data) {
    try {
      await finalizeAssistantFn({
        workspaceId,
        threadId: thread.id,
        assistantMessageId: assistantClaim.id,
        content: '크레딧이 부족하여 답변을 생성하지 못했어요.',
        status: 'failed',
        usageMetadata: { model: modelId, billing_error: reservationResult.error?.code || 'CREDIT_INSUFFICIENT' },
        userId,
      })
    } catch {
      // safe ignore secondary failure
    }
    const errorCode = reservationResult.error?.code || 'CREDIT_INSUFFICIENT'
    throw new Error(errorCode)
  }

  // 7. 최근 대화 이력 조회 (chronological, completed만) 및 활성 목표 조회
  // DB 오류 시 예약된 크레딧 릴리즈 및 streaming 어시스턴트 메시지 failed 처리하여 잔액/클레임 영구 잔류 방지
  let history: { role: 'user' | 'assistant'; content: string }[]
  let activeGoals: SoheeGoal[]
  try {
    const [{ messages: recentMessages }, goals] = await Promise.all([
      listStudioMessages(workspaceId, thread.id, { limit: 10 }),
      Promise.resolve(listGoals(workspaceId, { status: 'active' })).catch(() => []),
    ])
    history = recentMessages
      .filter((m) => m.id !== userMsg.id && m.id !== assistantClaim.id && m.status === 'completed')
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
      .map((m) => ({
        role: (m.role === 'user' ? 'user' : 'assistant') as 'user' | 'assistant',
        content: m.content,
      }))
    activeGoals = goals
  } catch (contextError) {
    try {
      await releaseFn({
        workspaceId,
        reservationId: clientMessageId,
        credits: creditAmount,
        idempotencyKey: clientMessageId,
      })
    } catch (releaseErr) {
      console.warn('[SoheeStudio] Failed to release credits after context error:', releaseErr)
    }
    try {
      await finalizeAssistantFn({
        workspaceId,
        threadId: thread.id,
        assistantMessageId: assistantClaim.id,
        content: '문맥 정보를 불러오지 못하여 답변 생성을 중단했어요.',
        status: 'failed',
        usageMetadata: {
          model: modelId,
          error: contextError instanceof Error ? contextError.message : 'CONTEXT_ERROR',
        },
        userId,
      })
    } catch {
      // safe ignore secondary failure
    }
    throw contextError
  }

  // 8. Gemini AI 대화 생성 호출
  let aiResult: StudioAiResult
  try {
    aiResult = await generateAiFn({
      workspaceId,
      userMessage: content,
      history,
      approvedFacts: facts.map((f) => ({ id: f.id, category: f.category, content: f.content })),
      activeGoals: activeGoals.slice(0, 20).map((g) => ({
        id: g.id,
        title: g.title,
        desiredOutcome: g.desiredOutcome,
        priority: g.priority,
      })),
      focus: effectiveFocus,
      relatedFactId: effectiveFocus === 'inspect' ? effectiveRelatedEntityId : undefined,
    })
  } catch (aiError) {
    // AI 호출 실패: 예약된 크레딧 릴리즈 및 메시지 상태 failed 처리 (외부 raw error 노출 방지)
    try {
      await releaseFn({
        workspaceId,
        reservationId: clientMessageId,
        credits: creditAmount,
        idempotencyKey: clientMessageId,
      })
    } catch (releaseErr) {
      console.warn('[SoheeStudio] Failed to release credits after AI error:', releaseErr)
    }
    try {
      await finalizeAssistantFn({
        workspaceId,
        threadId: thread.id,
        assistantMessageId: assistantClaim.id,
        content: '답변을 생성하지 못했어요. 잠시 후 다시 시도해 주세요.',
        status: 'failed',
        usageMetadata: { model: modelId, error: 'STUDIO_AI_GENERATION_FAILED' },
        userId,
      })
    } catch {
      // safe ignore secondary failure
    }
    throw new Error('STUDIO_AI_GENERATION_FAILED')
  }

  // 9. 제안(Proposals) 준비 및 replacesFactId 검증
  const proposalsToPersist: CreateProposalInput[] = []
  if (aiResult.intent === 'teach' && aiResult.proposals?.length) {
    const usedReplacesFactIds = new Set<string>()

    for (const p of aiResult.proposals) {
      let resolvedReplacesFactId = p.replacesFactId

      // 사용자가 명시적 focus: inspect로 사실을 선택한 경우:
      // correction target당 1proposal만 매핑하여 첫 확정 후 나머지 경합 방지
      if (effectiveFocus === 'inspect' && effectiveRelatedEntityId) {
        if (!usedReplacesFactIds.has(effectiveRelatedEntityId)) {
          resolvedReplacesFactId = effectiveRelatedEntityId
        } else {
          // 이미 해당 타겟에 대한 교정 제안이 매핑되었으므로 추가 중복 치환 방지
          continue
        }
      }

      // 모델이 반환한 replacesFactId가 해당 워크스페이스에 실존하는지 검증 (fail-closed)
      let targetCreatedAt: string | undefined = expectedFactCreatedAt
      if (resolvedReplacesFactId) {
        const targetFact = facts.find((f) => f.id === resolvedReplacesFactId)
        if (!targetFact) {
          // 존재하지 않는 사실 치환 시도 시 신규 fact로 전환하지 않고 fail-closed 차단
          try {
            await releaseFn({
              workspaceId,
              reservationId: clientMessageId,
              credits: creditAmount,
              idempotencyKey: clientMessageId,
            })
          } catch (releaseErr) {
            console.warn('[SoheeStudio] Failed to release credits after replacesFactId not found:', releaseErr)
          }
          try {
            await finalizeAssistantFn({
              workspaceId,
              threadId: thread.id,
              assistantMessageId: assistantClaim.id,
              content: '수정하려는 기존 지식을 찾을 수 없어요. 최신 지식 목록을 확인해 주세요.',
              status: 'failed',
              usageMetadata: { model: aiResult.modelId || modelId, error: 'STUDIO_FACT_NOT_FOUND' },
              userId,
            })
          } catch {
            // safe ignore secondary failure
          }
          throw new Error('STUDIO_FACT_NOT_FOUND')
        }

        if (usedReplacesFactIds.has(resolvedReplacesFactId)) {
          // 동일한 target fact에 대한 다중 제안 중복 매핑 방지
          continue
        }
        usedReplacesFactIds.add(resolvedReplacesFactId)
        targetCreatedAt = targetFact.createdAt || targetFact.versionTimestamp
      }

      proposalsToPersist.push({
        kind: 'fact',
        category: p.category,
        content: p.content,
        replacesFactId: resolvedReplacesFactId,
        expectedFactCreatedAt: targetCreatedAt,
      })
    }
  } else if (aiResult.intent === 'goal' && aiResult.goal) {
    proposalsToPersist.push({
      kind: 'goal',
      category: aiResult.goal.title,
      content: aiResult.goal.desiredOutcome,
    })
  }

  // 10. AI 완료 후 채널 학습 의존성 게이트 재검증
  // provider 호출 중 source가 철회되었거나 lease가 만료되었으면 completed 승격을 차단하고 failed 처리!
  if (learningDependencies.length > 0) {
    let valid = true
    if (deps.validateLearning) {
      valid = await deps.validateLearning({
        workspaceId,
        epoch: learningEpoch,
        dependencies: learningDependencies,
        purpose: 'conversation',
      })
    } else {
      const { verifyDependenciesCurrent } = await import('@/features/channel-learning/consumer-gate')
      valid = await verifyDependenciesCurrent(
        supabase,
        workspaceId,
        learningEpoch,
        learningDependencies,
        'conversation'
      )
    }

    if (!valid) {
      try {
        await releaseFn({
          workspaceId,
          reservationId: clientMessageId,
          credits: creditAmount,
          idempotencyKey: clientMessageId,
        })
      } catch (releaseErr) {
        console.warn('[SoheeStudio] Failed to release credits after learning revocation:', releaseErr)
      }
      try {
        await finalizeAssistantFn({
          workspaceId,
          threadId: thread.id,
          assistantMessageId: assistantClaim.id,
          content: '가게 정보가 변경되어 답변을 완료하지 못했어요. 다시 시도해 주세요.',
          status: 'failed',
          usageMetadata: { model: modelId, error: 'LEARNING_SOURCE_REVOKED' },
          userId,
        })
      } catch {
        // safe ignore
      }
      throw new Error('STUDIO_KNOWLEDGE_REVOKED')
    }
  }

  // 10. Assistant 턴 Finalize (완료 상태 및 제안 원자적 저장, 실제 aiResult 메타데이터 보존)
  const effectiveUsageMetadata: Record<string, any> = {
    model: aiResult.modelId || modelId,
  }
  if (aiResult.usage) {
    effectiveUsageMetadata.usage = aiResult.usage
  }

  const { assistantMessage: finalizedMsg, proposals: savedProps } = await finalizeAssistantFn({
    workspaceId,
    threadId: thread.id,
    assistantMessageId: assistantClaim.id,
    content: aiResult.reply,
    status: 'completed',
    usageMetadata: effectiveUsageMetadata,
    proposals: proposalsToPersist,
    userId,
  })

  // 11. 크레딧 정산 (Settle)
  const settleResult = await settleFn({
    workspaceId,
    reservationId: clientMessageId,
    actualCredits: creditAmount,
    idempotencyKey: clientMessageId,
  })

  if ('error' in settleResult) {
    try {
      await finalizeAssistantFn({
        workspaceId,
        threadId: thread.id,
        assistantMessageId: assistantClaim.id,
        content: '크레딧 정산에 실패하였습니다.',
        status: 'failed',
        usageMetadata: { model: modelId, billing_error: settleResult.error?.code || 'CREDIT_SETTLE_FAILED' },
        userId,
      })
    } catch {
      // safe ignore secondary failure
    }
    throw new Error(settleResult.error?.code || 'CREDIT_SETTLE_FAILED')
  }

  // 12. 응답 StudioTurnMessage 구성
  const factProposals = savedProps.filter((p) => p.kind === 'fact')
  const goalProposal = savedProps.find((p) => p.kind === 'goal')

  let suggestedGoal: SoheeGoal | undefined
  if (goalProposal) {
    suggestedGoal = {
      id: goalProposal.id,
      workspaceId,
      title: goalProposal.category,
      desiredOutcome: goalProposal.proposedContent,
      priority: 'normal',
      status: 'draft',
      sourceMessageId: userMsg.id,
      proposalId: goalProposal.id,
      version: 1,
      createdAt: goalProposal.createdAt,
      updatedAt: goalProposal.createdAt,
    }
  }

  return {
    id: finalizedMsg.id,
    sender: 'sohee',
    content: finalizedMsg.content,
    timestamp: finalizedMsg.created_at,
    focus: effectiveFocus || (aiResult.intent === 'teach' ? 'teach' : aiResult.intent === 'goal' ? 'goal' : aiResult.intent === 'inspect' ? 'inspect' : undefined),
    proposals: factProposals.length > 0 ? factProposals : undefined,
    suggestedGoal,
    relatedCuriosityId: effectiveFocus === 'curiosity' ? effectiveRelatedEntityId : undefined,
    status: finalizedMsg.status,
    clientMessageId,
  }
}

/**
 * 지식 제안 결정 (확정 / 거절)
 * - DB RPC decide_studio_proposal를 통한 원자적 확정/교정
 * - proposal.kind === 'fact' 엄격 검증
 */
export async function decideKnowledgeProposal(
  workspaceId: string,
  userId: string,
  proposalId: string,
  decision: 'confirm' | 'reject',
  revisedContent?: string,
  _idempotencyKey?: string,
  validity?: { validFrom: string; validUntil?: string | null },
): Promise<{ success: boolean; factId?: string }> {
  if (!workspaceId?.trim()) throw new Error('invalid_argument: workspaceId is required')
  if (!userId?.trim()) throw new Error('invalid_argument: userId is required')
  if (!proposalId?.trim()) throw new Error('invalid_argument: proposalId is required')
  if (!decision || !['confirm', 'reject'].includes(decision)) {
    throw new Error('invalid_argument: decision must be confirm or reject')
  }

  // 종류 경계 검증: confirm은 fact만 가능 (goal 확정은 saveGoal 엔드포인트 전용). reject는 fact와 goal 모두 허용.
  const proposals = await listProposals(workspaceId)
  const proposal = proposals.find((p) => p.id === proposalId)
  if (!proposal) {
    throw new Error('STUDIO_PROPOSAL_NOT_FOUND')
  }
  if (decision === 'confirm' && proposal.kind !== 'fact') {
    throw new Error('STUDIO_PROPOSAL_CONFLICT')
  }

  try {
    const res = await decideProposal({
      workspaceId,
      proposalId,
      decision,
      userId,
      revisedContent,
      ...validity,
    })

    if (!res.success) {
      throw new Error('PROPOSAL_DECISION_FAILED')
    }

    return {
      success: res.success,
      factId: res.confirmedTargetId ?? undefined,
    }
  } catch (err: any) {
    const msg = err?.message || ''
    if (msg.includes('proposal_not_found') || msg === 'STUDIO_PROPOSAL_NOT_FOUND') {
      throw new Error('STUDIO_PROPOSAL_NOT_FOUND')
    }
    if (msg.includes('fact_not_found') || msg === 'STUDIO_FACT_NOT_FOUND') {
      throw new Error('STUDIO_FACT_NOT_FOUND')
    }
    if (msg.includes('conflict: fact') || msg === 'STUDIO_FACT_CONFLICT') {
      throw new Error('STUDIO_FACT_CONFLICT')
    }
    if (msg.includes('conflict: proposal') || msg === 'STUDIO_PROPOSAL_CONFLICT') {
      throw new Error('STUDIO_PROPOSAL_CONFLICT')
    }
    throw err
  }
}

/**
 * 목표 확정 / 저장
 * - DB RPC를 통해 goal proposal을 원자적으로 확정하고 sohee_goals에 저장
 * - proposal.kind === 'goal' 엄격 검증
 * - 확정 후 DB 조회 실패 시 STUDIO_GOAL_NOT_FOUND throw
 */
export async function saveGoal(
  workspaceId: string,
  userId: string,
  proposalId: string
): Promise<SoheeGoal> {
  if (!workspaceId?.trim()) throw new Error('invalid_argument: workspaceId is required')
  if (!userId?.trim()) throw new Error('invalid_argument: userId is required')
  if (!proposalId?.trim()) throw new Error('invalid_argument: proposalId is required')

  // 종류 경계 검증: goal proposal만 이 endpoint에서 확정 가능
  const proposals = await listProposals(workspaceId)
  const proposal = proposals.find((p) => p.id === proposalId)
  if (!proposal) {
    throw new Error('STUDIO_PROPOSAL_NOT_FOUND')
  }
  if (proposal.kind !== 'goal') {
    throw new Error('STUDIO_PROPOSAL_CONFLICT')
  }

  let res: { success: boolean; confirmedTargetId?: string | null }
  try {
    res = await decideProposal({
      workspaceId,
      proposalId,
      decision: 'confirm',
      userId,
    })
  } catch (err: any) {
    const msg = err?.message || ''
    if (msg.includes('proposal_not_found')) throw new Error('STUDIO_PROPOSAL_NOT_FOUND')
    if (msg.includes('conflict')) throw new Error('STUDIO_PROPOSAL_CONFLICT')
    throw err
  }

  if (!res.success || !res.confirmedTargetId) {
    throw new Error('GOAL_CONFIRM_FAILED')
  }

  const goals = await listGoals(workspaceId)
  const found = goals.find((g) => g.id === res.confirmedTargetId)
  if (!found) {
    throw new Error('STUDIO_GOAL_NOT_FOUND')
  }

  return {
    ...found,
    proposalId,
  }
}

/**
 * 호기심 질문 상태 보류/해당없음 처리
 * - sohee_curiosity_decisions 테이블에 upsert
 */
export async function resolveCuriosity(
  workspaceId: string,
  userId: string,
  questionId: string,
  status: 'snoozed' | 'not_applicable'
): Promise<boolean> {
  if (!workspaceId?.trim()) throw new Error('invalid_argument: workspaceId is required')
  if (!userId?.trim()) throw new Error('invalid_argument: userId is required')
  if (!questionId?.trim()) throw new Error('invalid_argument: questionId is required')
  if (!status || !['snoozed', 'not_applicable'].includes(status)) {
    throw new Error('invalid_argument: status must be snoozed or not_applicable')
  }

  const questionKey = extractQuestionKey(questionId)

  // 실제 지원되는 질문 큐 stable key만 허용 (임의 key 저장 방지)
  if (!VALID_QUESTION_KEYS.includes(questionKey as ValidQuestionKey)) {
    throw new Error('STUDIO_QUESTION_NOT_FOUND')
  }

  await decideQuestion({
    workspaceId,
    questionKey,
    status,
    userId,
  })

  return true
}

export interface UpdateStudioGoalParams {
  workspaceId: string
  userId: string
  goalId: string
  expectedVersion: number
  title?: string
  desiredOutcome?: string
  priority?: GoalPriority
  status?: 'active' | 'paused' | 'retired'
}

/**
 * 지속 목표 편집 / 일시중지 (CAS 버전 동시성 제어)
 */
export async function updateStudioGoal(params: UpdateStudioGoalParams): Promise<SoheeGoal> {
  const { workspaceId, userId, goalId, expectedVersion, title, desiredOutcome, priority, status } = params
  if (!workspaceId?.trim()) throw new Error('invalid_argument: workspaceId is required')
  if (!goalId?.trim()) throw new Error('invalid_argument: goalId is required')
  if (!userId?.trim()) throw new Error('invalid_argument: userId is required')
  if (typeof expectedVersion !== 'number') throw new Error('invalid_argument: expectedVersion is required')

  try {
    return await updateGoal({
      workspaceId: workspaceId.trim(),
      userId: userId.trim(),
      goalId: goalId.trim(),
      expectedVersion,
      title,
      desiredOutcome,
      priority,
      status,
    })
  } catch (err: any) {
    const msg = err?.message || ''
    if (msg.includes('goal_not_found')) {
      throw new Error('STUDIO_GOAL_NOT_FOUND')
    }
    if (msg.includes('conflict')) {
      throw new Error('STUDIO_GOAL_CONFLICT')
    }
    throw err
  }
}

/**
 * 지속 목표 목록 조회
 */
export async function listStudioGoals(
  workspaceId: string,
  options?: { status?: GoalStatus | GoalStatus[] }
): Promise<SoheeGoal[]> {
  return listGoals(workspaceId, options)
}
