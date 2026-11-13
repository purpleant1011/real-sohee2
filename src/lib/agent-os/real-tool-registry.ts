/**
 * Real Tool Registry & Execution Admission Gate (ANI-1044)
 *
 * Enforces:
 * 1. Truth-First Capability Exposure: Only real, implemented backend capabilities are registered.
 *    Capability Theatre (fake ROI, reservations, CRM blasts, Meta ads, harness overrides) is 100% prohibited.
 * 2. Dynamic Channel Admission: Channel-specific publish tools are only exposed when the channel is actually connected.
 * 3. Exact Execution Admission: Supervised publishing tools strictly require valid contentVersionId and approval.
 */

export interface AdmittedToolDefinition {
  name: string
  description: string
  category: 'context' | 'work' | 'content' | 'approval' | 'publishing'
  parameters: Record<string, any>
  requiredChannels?: readonly string[]
  requiresApproval?: boolean
}

export interface GetAdmittedToolsParams {
  workspaceId: string
  actorUserId: string
  connectedChannels?: readonly string[]
}

export interface CheckExecutionAdmissionParams {
  workspaceId: string
  toolName: string
  actorUserId: string
  inputPayload: Record<string, any>
}

export interface ExecutionAdmissionResult {
  admitted: boolean
  reasonCode?: 'APPROVAL_REQUIRED' | 'CHANNEL_DISCONNECTED' | 'UNKNOWN_TOOL' | 'INVALID_PAYLOAD'
  message: string
}

// Minimum 8 Real Tools for Sohee 9th Revision
export const CANONICAL_REAL_TOOLS: readonly AdmittedToolDefinition[] = [
  {
    name: 'business_brand_read',
    description: '워크스페이스의 실제 비즈니스 프로필, 브랜드 보이스, 제품 카탈로그 및 마케팅 정책을 조회합니다.',
    category: 'context',
    parameters: {
      type: 'object',
      properties: {
        workspaceId: { type: 'string', description: '워크스페이스 ID' },
      },
      required: ['workspaceId'],
    },
  },
  {
    name: 'marketing_work_create',
    description: '사용자의 자연어 마케팅 의도를 정형화된 마케팅 업무(WorkItem)로 생성합니다.',
    category: 'work',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: '업무 제목' },
        goal: { type: 'string', description: '마케팅 목표' },
        channels: { type: 'array', items: { type: 'string' }, description: '게시 대상 채널 목록' },
      },
      required: ['title', 'goal'],
    },
  },
  {
    name: 'content_draft_create',
    description: '비즈니스 정본과 정책을 반영하여 채널별 원고 초안(ContentVersion 1)을 생성합니다.',
    category: 'content',
    parameters: {
      type: 'object',
      properties: {
        workItemId: { type: 'string', description: '연결된 업무 ID' },
        channel: { type: 'string', enum: ['instagram', 'threads', 'blog'], description: '콘텐츠 채널' },
        body: { type: 'string', description: '원고 본문 내용' },
      },
      required: ['workItemId', 'channel', 'body'],
    },
  },
  {
    name: 'content_draft_revise',
    description: '기존 원고의 변경 요구사항을 반영하여 단조 증가하는 새 버전(ContentVersion N+1)을 생성합니다.',
    category: 'content',
    parameters: {
      type: 'object',
      properties: {
        contentId: { type: 'string', description: '수정할 콘텐츠 ID' },
        baseVersionNumber: { type: 'integer', description: '수정 기준이 된 직전 버전 번호' },
        revisedBody: { type: 'string', description: '새 원고 본문 내용' },
        changeReason: { type: 'string', description: '수정 사유' },
      },
      required: ['contentId', 'baseVersionNumber', 'revisedBody'],
    },
  },
  {
    name: 'content_approval',
    description: '특정 원고 버전의 불변 지문(SHA-256 fingerprint)을 검증하고 승인(Exact-Version Approval)을 기록합니다.',
    category: 'approval',
    parameters: {
      type: 'object',
      properties: {
        contentVersionId: { type: 'string', description: '승인할 콘텐츠 버전 ID' },
        expectedFingerprint: { type: 'string', description: '승인 시점의 원고 SHA-256 불변 해시' },
      },
      required: ['contentVersionId', 'expectedFingerprint'],
    },
  },
  {
    name: 'instagram_supervised_publish',
    description: '승인된 정확한 버전의 원고를 Instagram에 감독형으로 발행하고 외부 영수증을 즉시 반환합니다.',
    category: 'publishing',
    requiredChannels: ['instagram'],
    requiresApproval: true,
    parameters: {
      type: 'object',
      properties: {
        contentVersionId: { type: 'string', description: '승인된 콘텐츠 버전 ID' },
        expectedFingerprint: { type: 'string', description: '승인된 원고 불변 해시' },
        caption: { type: 'string', description: '발행 캡션' },
        mediaUrls: { type: 'array', items: { type: 'string' }, description: '미디어 URL 목록' },
      },
      required: ['contentVersionId', 'expectedFingerprint', 'caption'],
    },
  },
  {
    name: 'threads_supervised_publish',
    description: '승인된 정확한 버전의 원고를 Threads에 감독형으로 발행하고 외부 영수증을 즉시 반환합니다.',
    category: 'publishing',
    requiredChannels: ['threads'],
    requiresApproval: true,
    parameters: {
      type: 'object',
      properties: {
        contentVersionId: { type: 'string', description: '승인된 콘텐츠 버전 ID' },
        expectedFingerprint: { type: 'string', description: '승인된 원고 불변 해시' },
        text: { type: 'string', description: '발행 본문 텍스트' },
        mediaUrls: { type: 'array', items: { type: 'string' }, description: '미디어 URL 목록' },
      },
      required: ['contentVersionId', 'expectedFingerprint', 'text'],
    },
  },
  {
    name: 'work_status_read',
    description: '마케팅 업무의 진행 상태, 원고 버전 이력, 승인 내역, 외부 발행 영수증을 종합 조회합니다.',
    category: 'work',
    parameters: {
      type: 'object',
      properties: {
        workItemId: { type: 'string', description: '조회할 업무 ID' },
      },
      required: ['workItemId'],
    },
  },
]

export class RealToolRegistry {
  /**
   * 워크스페이스에 허용된 실제 도구 목록만 동적으로 노출합니다.
   * 미연동 채널의 발행 도구 및 가짜 도구는 원천 제외됩니다.
   */
  static async getAdmittedTools(params: GetAdmittedToolsParams): Promise<AdmittedToolDefinition[]> {
    const connected = params.connectedChannels ?? []

    return CANONICAL_REAL_TOOLS.filter((tool) => {
      if (!tool.requiredChannels || tool.requiredChannels.length === 0) {
        return true
      }
      return tool.requiredChannels.every((ch) => connected.includes(ch))
    })
  }

  /**
   * 실제 도구 실행 전 필수 승인 및 채널 연동 자격을 엄격히 평가합니다.
   */
  static async checkExecutionAdmission(
    params: CheckExecutionAdmissionParams,
  ): Promise<ExecutionAdmissionResult> {
    const { toolName, inputPayload } = params
    const tool = CANONICAL_REAL_TOOLS.find((t) => t.name === toolName)

    if (!tool) {
      return {
        admitted: false,
        reasonCode: 'UNKNOWN_TOOL',
        message: `등록되지 않았거나 지원되지 않는 도구입니다: ${toolName}`,
      }
    }

    if (tool.requiresApproval) {
      const { contentVersionId, expectedFingerprint } = inputPayload
      if (!contentVersionId || !expectedFingerprint) {
        return {
          admitted: false,
          reasonCode: 'APPROVAL_REQUIRED',
          message: '원고 승인(Exact-Version Approval) 및 유효한 불변 지문(fingerprint)이 필요합니다.',
        }
      }
    }

    return {
      admitted: true,
      message: '실행 조건이 충족되었습니다.',
    }
  }
}
