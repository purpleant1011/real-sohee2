import { z } from 'zod'
import type { WorkspaceRole } from '@/features/auth/workspace-context'

export type ConversationOperationState = 'EXECUTABLE' | 'PREPARE_ONLY' | 'CONNECT_OR_APPROVE' | 'OPEN_EXISTING_UI' | 'UNAVAILABLE'
export type ConversationOperationGroup = 'content' | 'customers' | 'operations'
export type ConversationOperation = Readonly<{
  id: string; group: ConversationOperationGroup; title: string; description: string
  state: ConversationOperationState; stateLabel: string; canAsk: boolean; prompt: string
  directHref: string; requiresDecision: boolean
}>
export type ConversationOperationCatalog = Readonly<{
  workspaceId: string; role: WorkspaceRole; observedAt: string; items: readonly ConversationOperation[]
}>

type Definition = Omit<ConversationOperation, 'state' | 'stateLabel' | 'canAsk'> & {
  pipeline: 'existing' | 'agent' | 'direct'; decision?: boolean
}
const definitions: readonly Definition[] = [
  { id: 'marketing-plan', group: 'content', title: '기획·프로모션',
    description: '가게 지식과 실제 고객·업무 자료를 확인해 목표와 실행안을 제안해요.',
    pipeline: 'agent', prompt: '우리 가게 지식과 최근 고객 문의를 참고해서 이번 주 프로모션 계획을 기획해줘.', directHref: '/app/sohee', requiresDecision: false },
  { id: 'social-content', group: 'content', title: 'SNS 글·사진 준비',
    description: '가게 정보와 사용 가능한 사진으로 채널별 원고를 만들고 검토해요.',
    pipeline: 'existing', prompt: '우리 가게 지식을 참고해서 인스타그램 게시물 초안을 만들어줘.', directHref: '/app/content', requiresDecision: false },
  { id: 'naver-blog', group: 'content', title: '네이버 블로그 원고',
    description: '주제와 근거·사진을 확인하고 저장된 원고의 수정과 직접 게시를 준비해요.',
    pipeline: 'existing', prompt: '네이버 블로그 글 작성해줘.', directHref: '/app/content', requiresDecision: false },
  { id: 'publish', group: 'content', title: '게시·예약 게시',
    description: '실제 계정·원고·사진·비용·시각을 검토한 뒤 승인한 내용만 실행해요.',
    pipeline: 'agent', decision: true, prompt: '준비된 원고의 게시 조건과 승인 전에 확인할 내용을 정리해줘.', directHref: '/app/work', requiresDecision: true },
  { id: 'video', group: 'content', title: '영상·다른 채널 준비',
    description: '영상·당근 등 채널별 제공 조건은 달라요. 자동 제작·게시를 완료했다고 표시하지 않아요.',
    pipeline: 'direct', prompt: '', directHref: '/app/content', requiresDecision: true },
  { id: 'comments', group: 'customers', title: '댓글·문의 답변',
    description: '저장된 수신 내용을 확인하고 답변 초안을 검토해요. 실제 발송은 별도 승인이 필요해요.',
    pipeline: 'agent', prompt: '오늘 고객 댓글과 문의를 확인해서 답변 초안을 제안해줘.', directHref: '/app/engagement', requiresDecision: true },
  { id: 'instagram-dm', group: 'customers', title: 'Instagram DM 응대',
    description: '실제 수신 대화와 최신 고객 메시지를 확인해 답변을 준비해요. 발송 권한과 가능 시간은 따로 확인해요.',
    pipeline: 'agent', prompt: '받은 Instagram DM 중 답장이 필요한 대화를 확인하고 답변 초안을 제안해줘.', directHref: '/app/engagement', requiresDecision: true },
  { id: 'reservations', group: 'customers', title: '고객·예약 장부',
    description: '실제 예약 기록과 상담 내용을 확인해요. 고객 수락 없이 예약 확정이나 수납을 만들지 않아요.',
    pipeline: 'agent', prompt: '예약 장부를 확인하고 이번 주 예약과 확인이 필요한 문의를 정리해줘.', directHref: '/app/customers#reservation-ledger', requiresDecision: true },
  { id: 'knowledge', group: 'operations', title: '가게 지식·브랜드',
    description: '확인된 가게 정보와 운영 규칙을 활용하고 부족하거나 충돌하는 내용을 구분해요.',
    pipeline: 'agent', prompt: '우리 가게 지식에서 확인된 정보와 보완할 내용을 정리해줘.', directHref: '/app/sohee', requiresDecision: false },
  { id: 'performance', group: 'operations', title: '성과·다음 제안',
    description: '관측된 기록과 아직 확인되지 않은 지표를 구분해 다음 마케팅 계획을 검토해요.',
    pipeline: 'agent', prompt: '이번 주 성과 기록과 아직 확인되지 않은 지표를 구분해서 다음 계획을 제안해줘.', directHref: '/app/results', requiresDecision: false },
  { id: 'ads', group: 'operations', title: '광고·예산 관리',
    description: '광고 계정별 연결·집행 권한과 예산 상한을 기존 광고 화면에서 확인해요.',
    pipeline: 'direct', prompt: '', directHref: '/app/ads', requiresDecision: true },
  { id: 'channels', group: 'operations', title: '연결·크레딧·설정',
    description: '연결 상태와 크레딧을 확인해요. 결제나 권한 변경은 확인 없이 실행하지 않아요.',
    pipeline: 'direct', prompt: '', directHref: '/app/system', requiresDecision: true },
]
const labels: Record<ConversationOperationState, string> = {
  EXECUTABLE: '조회 요청 가능', PREPARE_ONLY: '검토·초안 준비', CONNECT_OR_APPROVE: '연결·승인 확인',
  OPEN_EXISTING_UI: '직접 화면에서 확인', UNAVAILABLE: '제공 조건 확인 필요',
}

const catalogSchema = z.object({
  workspaceId: z.string().uuid(), role: z.enum(['owner', 'manager', 'reviewer', 'viewer']),
  observedAt: z.string().datetime({ offset: true }),
  items: z.array(z.object({
    id: z.string().min(1).max(80), group: z.enum(['content', 'customers', 'operations']),
    title: z.string().min(1).max(200), description: z.string().max(1000),
    state: z.enum(['EXECUTABLE', 'PREPARE_ONLY', 'CONNECT_OR_APPROVE', 'OPEN_EXISTING_UI', 'UNAVAILABLE']),
    stateLabel: z.string().min(1).max(100), canAsk: z.boolean(), prompt: z.string().max(1000),
    directHref: z.string().max(300), requiresDecision: z.boolean(),
  }).strict()).max(50),
}).strict()

export function parseConversationOperationCatalog(value: unknown, workspaceId: string): ConversationOperationCatalog {
  const parsed = catalogSchema.safeParse(value)
  if (!parsed.success) throw new Error('CONVERSATION_CATALOG_INVALID')
  if (parsed.data.workspaceId !== workspaceId) throw new Error('CONVERSATION_CATALOG_SCOPE_MISMATCH')
  const ids = new Set<string>()
  for (const item of parsed.data.items) {
    const definition = definitions.find(row => row.id === item.id)
    if (!definition || ids.has(item.id) || definition.directHref !== item.directHref || definition.prompt !== item.prompt) {
      throw new Error('CONVERSATION_CATALOG_INVALID')
    }
    ids.add(item.id)
  }
  return parsed.data
}

/** Discovery is not execution permission; live actor/provider/domain gates still run at every command. */
export function buildConversationOperationCatalog(input: {
  workspaceId: string; role: WorkspaceRole; observedAt: string
  workbenchEnabled: boolean; agentEnabled: boolean; modelConfigured: boolean; connectedChannels: readonly string[]
}): ConversationOperationCatalog {
  const canRequest = input.role !== 'viewer' && input.workbenchEnabled && input.modelConfigured
  const items = definitions.map(definition => {
    const { pipeline, decision, ...item } = definition
    const canAsk = canRequest && pipeline !== 'direct' && (pipeline === 'existing' || input.agentEnabled)
    const state: ConversationOperationState = decision ? 'CONNECT_OR_APPROVE' : pipeline === 'direct' || !canAsk
      ? 'OPEN_EXISTING_UI' : 'PREPARE_ONLY'
    const description = definition.id === 'publish' && !input.connectedChannels.some(channel => channel === 'instagram' || channel === 'threads')
      ? '게시할 계정 연결이 필요해요. 원고 준비와 검토는 계정 연결 전에도 할 수 있어요.' : definition.description
    return Object.freeze({ ...item, description, canAsk, state, stateLabel: labels[state] })
  })
  return Object.freeze({ workspaceId: input.workspaceId, role: input.role, observedAt: input.observedAt, items: Object.freeze(items) })
}
