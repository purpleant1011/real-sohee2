/**
 * Sohee V0.8.9 MCP Capability Registry (ANI-650, ANI-659)
 * 
 * Master Registry for all Sohee Autonomous Operating System Capabilities
 * - Strict Metadata: id, version, riskTier, isWrite, requiredScopes, entitlement, idempotency, evidenceContract
 * - Covers all 12 Domains specified in 03_MCP_External_Action Document:
 *   1. Content (content.generate, content.rewrite, content.list, content.schedule)
 *   2. Image (image.generate, image.regenerate)
 *   3. Campaign (campaign.create, campaign.plan, campaign.status)
 *   4. Channel (channel.list, channel.status, channel.capabilities, channel.test_publish)
 *   5. Publishing (publish.create, publish.verify)
 *   6. Interaction (interaction.list, comment.reply, dm.send)
 *   7. Customer / Reservation (customer.search, reservation.list, reservation.create)
 *   8. Review (review.list, review.respond)
 *   9. Knowledge (knowledge.search, knowledge.propose)
 *   10. Report (report.generate, performance.summary)
 *   11. Autonomy / Credit / System (autonomy.get, autonomy.update, credit.status, emergency_killswitch)
 *   12. UI Navigation (app.navigate, app.focus)
 * 
 * - Binds existing Done runtimes: ANI-598/618 (Publish), ANI-605 (Capability), ANI-607 (FinOps), ANI-617 (Consent/KillSwitch), ANI-619 (Interactions), ANI-627 (Browser)
 * - Zero Synthetic/Mock Success (ANI-648): All capabilities execute against real domain services or fail-closed.
 */

export type CapabilityRiskTier = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'

export interface CapabilityDefinition {
  id: string
  version: string
  name: string
  description: string
  domain: 
    | 'CONTENT' 
    | 'IMAGE' 
    | 'CAMPAIGN' 
    | 'CHANNEL' 
    | 'PUBLISHING' 
    | 'INTERACTION' 
    | 'CRM' 
    | 'REVIEW' 
    | 'KNOWLEDGE' 
    | 'REPORT' 
    | 'SYSTEM' 
    | 'NAVIGATION'
  riskTier: CapabilityRiskTier
  isWrite: boolean
  requiresOwnerApproval: boolean
  idempotencyRequired: boolean
  supportedChannels?: ('INSTAGRAM' | 'THREADS' | 'NAVER_BLOG' | 'DAANGN' | 'KAKAO')[]
  requiredScopes?: string[]
  evidenceContract: string
  parametersSchema: {
    type: 'object'
    properties: Record<string, { type: string; description: string; enum?: string[]; minimum?: number; maximum?: number }>
    required?: string[]
  }
}

export const SOHEE_CAPABILITY_REGISTRY: Record<string, CapabilityDefinition> = {
  // ==========================================
  // 1. Content Domain (5.1)
  // ==========================================
  'content.generate': {
    id: 'content.generate',
    version: '1.0.0',
    name: '신규 마케팅 콘텐츠 원고 생성',
    description: '매장의 차별화 포인트와 타깃 고객을 반영하여 인스타/블로그/스레드용 마케팅 원고를 생성합니다.',
    domain: 'CONTENT',
    riskTier: 'LOW',
    isWrite: true,
    requiresOwnerApproval: false,
    idempotencyRequired: true,
    evidenceContract: 'content_draft_record',
    parametersSchema: {
      type: 'object',
      properties: {
        topic: { type: 'string', description: '콘텐츠 주제 또는 시술 항목' },
        channel: { type: 'string', enum: ['INSTAGRAM', 'THREADS', 'NAVER_BLOG', 'DAANGN'], description: '발행 대상 채널' },
        tone: { type: 'string', description: '원고 톤앤매너' },
        includeImage: { type: 'boolean', description: '매장 맞춤형 AI 이미지 동시 생성 여부 (인스타그램 룩북용 고품질 사진 결합)' }
      },
      required: ['topic', 'channel']
    }
  },
  'content.rewrite': {
    id: 'content.rewrite',
    version: '1.0.0',
    name: '기존 원고 톤앤매너 재작성',
    description: '기존에 작성된 마케팅 원고의 문체를 채널 성격에 맞게 변환합니다.',
    domain: 'CONTENT',
    riskTier: 'LOW',
    isWrite: true,
    requiresOwnerApproval: false,
    idempotencyRequired: false,
    evidenceContract: 'content_draft_record',
    parametersSchema: {
      type: 'object',
      properties: {
        contentId: { type: 'string', description: '원본 콘텐츠 ID' },
        targetChannel: { type: 'string', enum: ['INSTAGRAM', 'THREADS', 'NAVER_BLOG', 'DAANGN'], description: '변환할 대상 채널' }
      },
      required: ['contentId', 'targetChannel']
    }
  },
  'content.list': {
    id: 'content.list',
    version: '1.0.0',
    name: '작성된 콘텐츠 목록 조회',
    description: '초안 또는 발행 대기 중인 콘텐츠 목록을 조회합니다.',
    domain: 'CONTENT',
    riskTier: 'LOW',
    isWrite: false,
    requiresOwnerApproval: false,
    idempotencyRequired: false,
    evidenceContract: 'db_query_result',
    parametersSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['draft', 'approved', 'scheduled', 'published'], description: '상태 필터' }
      }
    }
  },
  'content.schedule': {
    id: 'content.schedule',
    version: '1.0.0',
    name: '콘텐츠 예약 발행 설정',
    description: '지정된 일시에 콘텐츠가 자동 발행되도록 예약합니다.',
    domain: 'CONTENT',
    riskTier: 'MEDIUM',
    isWrite: true,
    requiresOwnerApproval: true,
    idempotencyRequired: true,
    evidenceContract: 'schedule_ledger_entry',
    parametersSchema: {
      type: 'object',
      properties: {
        contentId: { type: 'string', description: '예약할 콘텐츠 ID' },
        scheduledAt: { type: 'string', description: '발행 희망 일시 (ISO 8601)' }
      },
      required: ['contentId', 'scheduledAt']
    }
  },

  // ==========================================
  // 2. Image Domain (5.2) - GPT-Image-2
  // ==========================================
  'image.generate': {
    id: 'image.generate',
    version: '1.0.0',
    name: 'GPT-Image-2 초고화질 비주얼 이미지 생성',
    description: '매장 시술 룩북, 비포애프터 시안, 시즌 프로모션 이미지를 GPT-Image-2 엔진으로 생성합니다.',
    domain: 'IMAGE',
    riskTier: 'LOW',
    isWrite: true,
    requiresOwnerApproval: false,
    idempotencyRequired: true,
    evidenceContract: 'image_asset_id_and_provenance_verified',
    parametersSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: '생성할 이미지의 구체적인 피사체 및 장면 설명' },
        style: { type: 'string', description: '이미지 화풍 및 스타일 (예: 자연광 감성 스마트폰 실사 샷)' }
      },
      required: ['prompt']
    }
  },
  'image.regenerate': {
    id: 'image.regenerate',
    version: '1.0.0',
    name: '이미지 변형 및 재생성',
    description: '기존 생성된 이미지를 다른 화풍이나 조건으로 재생성합니다.',
    domain: 'IMAGE',
    riskTier: 'LOW',
    isWrite: true,
    requiresOwnerApproval: false,
    idempotencyRequired: true,
    evidenceContract: 'image_asset_id_and_provenance_verified',
    parametersSchema: {
      type: 'object',
      properties: {
        baseAssetId: { type: 'string', description: '기존 이미지 에셋 ID' },
        modificationPrompt: { type: 'string', description: '수정 요청 사항' }
      },
      required: ['baseAssetId', 'modificationPrompt']
    }
  },

  // ==========================================
  // 3. Campaign Domain (5.3)
  // ==========================================
  'campaign.create': {
    id: 'campaign.create',
    version: '1.0.0',
    name: '마케팅 캠페인 생성',
    description: '유휴 슬롯 소진이나 시즌 이벤트를 위한 마케팅 캠페인을 신규 개설합니다.',
    domain: 'CAMPAIGN',
    riskTier: 'MEDIUM',
    isWrite: true,
    requiresOwnerApproval: true,
    idempotencyRequired: true,
    evidenceContract: 'campaign_record',
    parametersSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: '캠페인 제목' },
        goal: { type: 'string', description: '캠페인 목표' },
        targetChannels: { type: 'string', description: '집행 채널 쉼표 구분' }
      },
      required: ['title', 'goal']
    }
  },
  'campaign.plan': {
    id: 'campaign.plan',
    version: '1.0.0',
    name: '캠페인 세부 실행 계획 수립',
    description: '캠페인 기간 동안 발행될 콘텐츠 일정 및 예산을 구조화된 플랜으로 작성합니다.',
    domain: 'CAMPAIGN',
    riskTier: 'LOW',
    isWrite: false,
    requiresOwnerApproval: false,
    idempotencyRequired: false,
    evidenceContract: 'campaign_plan_projection',
    parametersSchema: {
      type: 'object',
      properties: {
        campaignId: { type: 'string', description: '캠페인 식별자' }
      },
      required: ['campaignId']
    }
  },
  'campaign.status': {
    id: 'campaign.status',
    version: '1.0.0',
    name: '캠페인 진행 현황 및 성과 조회',
    description: '현재 진행 중인 캠페인의 발행 진척도와 유입 반응을 조회합니다.',
    domain: 'CAMPAIGN',
    riskTier: 'LOW',
    isWrite: false,
    requiresOwnerApproval: false,
    idempotencyRequired: false,
    evidenceContract: 'campaign_status_summary',
    parametersSchema: {
      type: 'object',
      properties: {
        campaignId: { type: 'string', description: '조회할 캠페인 ID' }
      }
    }
  },
  'ads.list': {
    id: 'ads.list',
    version: '1.0.0',
    name: '광고 캠페인 및 집행 목록 조회',
    description: '연결된 광고 채널(Meta, Google 등)의 광고 캠페인 목록과 실시간 집행 상태를 조회합니다.',
    domain: 'CAMPAIGN',
    riskTier: 'LOW',
    isWrite: false,
    requiresOwnerApproval: false,
    idempotencyRequired: false,
    evidenceContract: 'ads_list_query',
    parametersSchema: {
      type: 'object',
      properties: {}
    }
  },
  'ads.status': {
    id: 'ads.status',
    version: '1.0.0',
    name: '광고 캠페인 상태 및 성과 조회',
    description: '특정 광고 캠페인의 집행 현황, 일일 예산, 소진액 및 ROAS 성과를 조회합니다.',
    domain: 'CAMPAIGN',
    riskTier: 'LOW',
    isWrite: false,
    requiresOwnerApproval: false,
    idempotencyRequired: false,
    evidenceContract: 'ads_status_summary',
    parametersSchema: {
      type: 'object',
      properties: {
        campaignId: { type: 'string', description: '조회할 광고 캠페인 ID' }
      }
    }
  },

  // ==========================================
  // 4. Channel Domain (5.4)
  // ==========================================
  'channel.list': {
    id: 'channel.list',
    version: '1.0.0',
    name: '연동된 공식 채널 목록 및 상태 조회',
    description: '인스타그램, 스레드, 네이버 블로그, 당근 등의 계정 연결 상태를 점검합니다.',
    domain: 'CHANNEL',
    riskTier: 'LOW',
    isWrite: false,
    requiresOwnerApproval: false,
    idempotencyRequired: false,
    evidenceContract: 'channel_connections_status',
    parametersSchema: {
      type: 'object',
      properties: {}
    }
  },
  'channel.status': {
    id: 'channel.status',
    version: '1.0.0',
    name: '개별 채널 헬스체크',
    description: '특정 채널의 토큰 만료 여부 및 API 정상 통신 상태를 확인합니다.',
    domain: 'CHANNEL',
    riskTier: 'LOW',
    isWrite: false,
    requiresOwnerApproval: false,
    idempotencyRequired: false,
    evidenceContract: 'channel_health_check',
    parametersSchema: {
      type: 'object',
      properties: {
        channel: { type: 'string', enum: ['INSTAGRAM', 'THREADS', 'NAVER_BLOG', 'DAANGN', 'KAKAO'], description: '점검할 채널' }
      },
      required: ['channel']
    }
  },
  'channel.capabilities': {
    id: 'channel.capabilities',
    version: '1.0.0',
    name: '채널별 지원 기능 매트릭스 조회',
    description: '채널별로 공식 API 및 브라우저에서 수행 가능한 권한(포스팅, 댓글, DM 등)을 확인합니다.',
    domain: 'CHANNEL',
    riskTier: 'LOW',
    isWrite: false,
    requiresOwnerApproval: false,
    idempotencyRequired: false,
    evidenceContract: 'channel_capability_matrix',
    parametersSchema: {
      type: 'object',
      properties: {
        channel: { type: 'string', description: '확인할 채널' }
      }
    }
  },
  'channel.test_publish': {
    id: 'channel.test_publish',
    version: '1.0.0',
    name: '채널 연동 테스트 발행',
    description: '채널 연동 정상 여부를 검증하기 위한 무해한 테스트 포스팅을 수행합니다.',
    domain: 'CHANNEL',
    riskTier: 'HIGH',
    isWrite: true,
    requiresOwnerApproval: true,
    idempotencyRequired: true,
    evidenceContract: 'test_publish_receipt',
    parametersSchema: {
      type: 'object',
      properties: {
        channel: { type: 'string', enum: ['INSTAGRAM', 'THREADS', 'NAVER_BLOG', 'DAANGN'], description: '테스트할 채널' }
      },
      required: ['channel']
    }
  },

  // ==========================================
  // 5. Publishing Domain (5.5) - ANI-598, ANI-618, ANI-655
  // ==========================================
  'publish.create': {
    id: 'publish.create',
    version: '1.1.0',
    name: '공식 SNS 채널 실시간 즉시 발행',
    description: '서버에서 정확 승인된 원고·사진 묶음을 연결된 인스타그램 또는 스레드 계정에 게시하고 외부 결과를 검증합니다.',
    domain: 'PUBLISHING',
    riskTier: 'CRITICAL',
    isWrite: true,
    requiresOwnerApproval: true,
    idempotencyRequired: true,
    supportedChannels: ['INSTAGRAM', 'THREADS'],
    evidenceContract: 'external_action_receipt_and_readback_verified',
    parametersSchema: {
      type: 'object',
      properties: {
        channel: { type: 'string', enum: ['INSTAGRAM', 'THREADS'], description: '발행할 공식 채널' },
        contentVersionId: { type: 'string', description: '서버에서 준비하고 검토한 콘텐츠 버전 ID. 임의 생성 금지' },
        bundleId: { type: 'string', description: '서버가 반환한 정확한 게시 묶음 ID' },
        expectedFingerprint: { type: 'string', description: '검토한 게시 묶음의 서버 지문. 원고나 URL만으로 게시할 수 없음' },
        missionId: { type: 'string', description: '게시를 요청한 업무 ID' },
        idempotencyKey: { type: 'string', description: '중복 발행 방지 고유 멱등키' }
      },
      required: ['channel', 'contentVersionId', 'expectedFingerprint']
    }
  },
  'publish.verify': {
    id: 'publish.verify',
    version: '1.0.0',
    name: '발행된 외부 포스트 검증 (Read-After-Write)',
    description: '외부 프로바이더 API 또는 브라우저로 실제 게시물이 게시되었는지 조회하여 확인합니다.',
    domain: 'PUBLISHING',
    riskTier: 'LOW',
    isWrite: false,
    requiresOwnerApproval: false,
    idempotencyRequired: false,
    evidenceContract: 'external_readback_receipt',
    parametersSchema: {
      type: 'object',
      properties: {
        postId: { type: 'string', description: '외부 게시물 ID 또는 영수증 ID' }
      },
      required: ['postId']
    }
  },

  // ==========================================
  // 6. Interaction Domain (5.6) - ANI-619, ANI-656
  // ==========================================
  'interaction.list': {
    id: 'interaction.list',
    version: '1.0.0',
    name: '수집된 댓글 및 Instagram DM 수신 기록 조회',
    description: '저장된 Instagram·Threads 댓글과 Instagram DM을 원문 기준과 함께 조회합니다. partial이면 전체 확인 완료가 아닙니다. 이 조회는 초안 생성·발송·상태 변경을 하지 않습니다.',
    domain: 'INTERACTION',
    riskTier: 'LOW',
    isWrite: false,
    requiresOwnerApproval: false,
    idempotencyRequired: false,
    evidenceContract: 'unified_inbox_query',
    parametersSchema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['all', 'comments', 'dm'], description: '조회할 수신 기록 종류' },
        channel: { type: 'string', enum: ['all', 'instagram', 'threads', 'instagram_dm'], description: 'Threads DM은 지원하지 않습니다.' },
        unreadOnly: { type: 'boolean', description: '답변이 필요한 기록만 조회' },
        limit: { type: 'integer', minimum: 1, maximum: 10, description: '이번 조회 범위. 일부 결과를 전체로 표시하지 마세요.' }
      }
    }
  },
  'comment.reply_draft': {
    id: 'comment.reply_draft', version: '1.0.0', name: '댓글 답안 준비·저장',
    description: 'interaction.list로 확인한 실제 댓글 원문과 승인 지식에 근거한 답안을 기존 초안 원장에 저장합니다. 발송하지 않습니다. sourceRef는 조회 결과의 sourceFingerprint를 그대로 사용하세요. 기존 사람의 초안을 임의로 덮어쓰지 않습니다.',
    domain: 'INTERACTION', riskTier: 'LOW', isWrite: true, requiresOwnerApproval: false, idempotencyRequired: true,
    evidenceContract: '기존 댓글 답안 ID·본문 fingerprint·원문 fingerprint 및 별도 발송 승인 필요 상태',
    parametersSchema: { type: 'object', properties: {
      targetId: { type: 'string', description: '조회한 댓글 ID(UUID)' },
      draftText: { type: 'string', description: '승인된 가게 지식으로 작성한 답안. 확인하지 않은 가격·예약·혜택을 만들지 마세요.' },
      sourceRef: { type: 'string', description: '조회 결과의 sourceFingerprint. 추측하거나 새로 계산하지 마세요.' },
    }, required: ['targetId', 'draftText', 'sourceRef'] },
  },
  'dm.reply_draft': {
    id: 'dm.reply_draft', version: '1.0.0', name: 'Instagram DM 답안 준비·저장',
    description: 'interaction.list로 확인한 최신 고객 메시지에 대한 답안을 기존 DM 초안 원장에 저장합니다. 발송하지 않습니다. sourceRef는 latestCustomerMessageId를 그대로 사용하세요. 답장 가능 시간·현재 역할·원문 변경을 다시 검사합니다.',
    domain: 'INTERACTION', riskTier: 'LOW', isWrite: true, requiresOwnerApproval: false, idempotencyRequired: true,
    evidenceContract: '기존 DM 답안 ID·본문 fingerprint·최신 고객 메시지 ID 및 별도 발송 승인 필요 상태',
    parametersSchema: { type: 'object', properties: {
      targetId: { type: 'string', description: '조회한 DM 대화 ID(UUID)' },
      draftText: { type: 'string', description: '1,000자 이내의 근거 있는 답안. 예약 확정이나 수납 완료를 추측하지 마세요.' },
      sourceRef: { type: 'string', description: '조회 결과의 latestCustomerMessageId(UUID)' },
    }, required: ['targetId', 'draftText', 'sourceRef'] },
  },
  'comment.reply': {
    id: 'comment.reply',
    version: '1.0.0',
    name: '댓글/답글 작성 및 전송 (DRAFT / EXECUTE)',
    description: '고객 댓글에 맞춤 답변을 작성하거나 승인 후 실제 외부 채널로 발송합니다.',
    domain: 'INTERACTION',
    riskTier: 'HIGH',
    isWrite: true,
    requiresOwnerApproval: true,
    idempotencyRequired: true,
    supportedChannels: ['INSTAGRAM', 'THREADS', 'NAVER_BLOG'],
    evidenceContract: 'interaction_receipt_and_reply_id_verified',
    parametersSchema: {
      type: 'object',
      properties: {
        commentId: { type: 'string', description: '대상 댓글 ID' },
        channel: { type: 'string', enum: ['INSTAGRAM', 'THREADS'], description: '발송할 SNS 채널 (기본값: 인스타그램 또는 댓글 출처 채널)' },
        replyText: { type: 'string', description: '답변 본문 내용' },
        intentMode: { type: 'string', enum: ['DRAFT', 'EXECUTE'], description: '초안 작성만: DRAFT, 실제 외부 전송: EXECUTE' }
      },
      required: ['commentId', 'replyText']
    }
  },
  'dm.send': {
    id: 'dm.send',
    version: '1.0.0',
    name: '1:1 DM 고객 답변 전송 (DRAFT / EXECUTE)',
    description: '인스타그램 DM 또는 1:1 상담 메시지에 맞춤 답변을 전송합니다.',
    domain: 'INTERACTION',
    riskTier: 'HIGH',
    isWrite: true,
    requiresOwnerApproval: true,
    idempotencyRequired: true,
    supportedChannels: ['INSTAGRAM', 'DAANGN'],
    evidenceContract: 'interaction_receipt_and_message_id_verified',
    parametersSchema: {
      type: 'object',
      properties: {
        recipientId: { type: 'string', description: '수신 고객 ID' },
        messageText: { type: 'string', description: '전송할 메시지 본문' },
        intentMode: { type: 'string', enum: ['DRAFT', 'EXECUTE'], description: '초안 작성만: DRAFT, 실제 외부 전송: EXECUTE' }
      },
      required: ['recipientId', 'messageText']
    }
  },

  // ==========================================
  // 7. Customer / Reservation Domain (5.7)
  // ==========================================
  'customer.search': {
    id: 'customer.search',
    version: '1.0.0',
    name: '수집된 고객 상담 요약 조회',
    description: '수집된 고객 상담 요약만 조회합니다. 예약·수납은 관측하지 않습니다. totalConfirmedBookings=null이나 bookingState=NOT_OBSERVED를 0건으로 해석하지 마세요. 실제 예약 건수는 reservation.list를 호출해야 합니다.',
    domain: 'CRM',
    riskTier: 'LOW',
    isWrite: false,
    requiresOwnerApproval: false,
    idempotencyRequired: false,
    evidenceContract: 'db_workspace_customer_read_model',
    parametersSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '고객명 또는 문의 내용 검색어' }
      }
    }
  },
  'reservation.list': {
    id: 'reservation.list',
    version: '1.0.0',
    name: '정본 예약 장부 조회',
    description: '실제 예약 장부의 등록 기록과 상태를 조회합니다. 고객 상담 요약과 다릅니다. 기간 필터는 확정 기록 시각 기준이며 예약 가능 슬롯이나 실제 수납은 관측하지 않습니다. count는 반환된 기록 수이고 전체 합계로 확대하지 마세요.',
    domain: 'CRM',
    riskTier: 'LOW',
    isWrite: false,
    requiresOwnerApproval: false,
    idempotencyRequired: false,
    evidenceContract: 'reservation_ledger_query',
    parametersSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', description: '정본 상태 필터. 모르면 미지정하거나 ALL을 사용하세요.' },
        startDate: { type: 'string', description: '확정 기록 시각의 조회 시작(ISO datetime). 예약 예정 시간이 아닙니다.' },
        endDate: { type: 'string', description: '확정 기록 시각의 조회 종료(ISO datetime)' },
        limit: { type: 'integer', minimum: 1, maximum: 50, description: '반환할 기록 수. 제한된 결과를 전체 합계로 표시하지 마세요.' }
      }
    }
  },
  'reservation.create': {
    id: 'reservation.create',
    version: '1.0.0',
    name: '고객 예약 슬롯 및 예약금 상태 등록/업데이트',
    description: '고객의 예약 희망 시간 배정 및 예약금 입금 상태를 업데이트합니다.',
    domain: 'CRM',
    riskTier: 'MEDIUM',
    isWrite: true,
    requiresOwnerApproval: true,
    idempotencyRequired: true,
    evidenceContract: 'reservation_ledger_record',
    parametersSchema: {
      type: 'object',
      properties: {
        customerName: { type: 'string', description: '고객 성함' },
        dateSlot: { type: 'string', description: '예약 희망 일시' },
        treatment: { type: 'string', description: '시술 항목' },
        depositStatus: { type: 'string', enum: ['paid', 'pending'], description: '예약금 상태' }
      },
      required: ['customerName', 'dateSlot']
    }
  },

  // ==========================================
  // 8. Review Domain (5.8)
  // ==========================================
  'review.list': {
    id: 'review.list',
    version: '1.0.0',
    name: '네이버 플레이스/당근 후기 조회',
    description: '매장에 등록된 실제 방문 고객 리뷰 및 평점을 조회합니다.',
    domain: 'REVIEW',
    riskTier: 'LOW',
    isWrite: false,
    requiresOwnerApproval: false,
    idempotencyRequired: false,
    evidenceContract: 'review_ledger_query',
    parametersSchema: {
      type: 'object',
      properties: {}
    }
  },
  'review.respond': {
    id: 'review.respond',
    version: '1.0.0',
    name: '고객 리뷰 공식 답글 작성',
    description: '고객 리뷰에 감사의 마음을 담은 공식 답글을 작성합니다.',
    domain: 'REVIEW',
    riskTier: 'MEDIUM',
    isWrite: true,
    requiresOwnerApproval: true,
    idempotencyRequired: true,
    evidenceContract: 'review_response_receipt',
    parametersSchema: {
      type: 'object',
      properties: {
        reviewId: { type: 'string', description: '대상 리뷰 ID' },
        responseText: { type: 'string', description: '답글 본문' }
      },
      required: ['reviewId', 'responseText']
    }
  },

  // ==========================================
  // 9. Knowledge Domain (5.9) - ANI-654
  // ==========================================
  'automation.list': {
    id: 'automation.list', version: '1.0.0', name: '저장된 보고 자동화 설정 조회',
    description: '현재 가게의 report-only 루틴 설정·활성 상태·버전·실행 시각·비용 상한을 최신 25개 범위에서 조회합니다. 저장·활성화·중지·게시를 실행하지 않으며 활성 상태는 실행 완료가 아닙니다.',
    domain: 'SYSTEM', riskTier: 'LOW', isWrite: false, requiresOwnerApproval: false,
    idempotencyRequired: false, evidenceContract: 'native_automation_configuration_observation',
    parametersSchema: { type: 'object', properties: {} },
  },
  'knowledge.search': {
    id: 'knowledge.search',
    version: '1.0.0',
    name: '매장 맞춤 비법 및 시술 사실 검색',
    description: '매장의 1:1 시술 기법, 가격표, 환불 정책, 단골 관리 노하우를 장기기억에서 검색합니다.',
    domain: 'KNOWLEDGE',
    riskTier: 'LOW',
    isWrite: false,
    requiresOwnerApproval: false,
    idempotencyRequired: false,
    evidenceContract: 'knowledge_search_provenance',
    parametersSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '검색할 매장 정보 키워드' }
      },
      required: ['query']
    }
  },
  'knowledge.propose': {
    id: 'knowledge.propose',
    version: '1.0.0',
    name: '새로운 매장 운영 규칙/지식 승격 제안',
    description: '대화 중 파악된 새로운 매장 운영 정책이나 시술 가격을 장기기억 후보로 등록합니다.',
    domain: 'KNOWLEDGE',
    riskTier: 'LOW',
    isWrite: true,
    requiresOwnerApproval: false,
    idempotencyRequired: true,
    evidenceContract: 'knowledge_candidate_record',
    parametersSchema: {
      type: 'object',
      properties: {
        subject: { type: 'string', description: '지식 주제' },
        factContent: { type: 'string', description: '지식 내용' },
        memoryClass: { type: 'string', enum: ['episodic', 'semantic', 'procedural'], description: '지식 분류' }
      },
      required: ['subject', 'factContent']
    }
  },

  // ==========================================
  // 10. Report Domain (5.10) - ANI-607 FinOps
  // ==========================================
  'report.generate': {
    id: 'report.generate',
    version: '1.0.0',
    name: '주간/월간 마케팅 종합 성과표 생성',
    description: '채널별 발행 결과, 유입 고객, 확정 매출을 집계한 성과 보고서를 생성합니다.',
    domain: 'REPORT',
    riskTier: 'LOW',
    isWrite: true,
    requiresOwnerApproval: false,
    idempotencyRequired: true,
    evidenceContract: 'report_snapshot_asset',
    parametersSchema: {
      type: 'object',
      properties: {
        period: { type: 'string', enum: ['weekly', 'monthly'], description: '보고서 주기' }
      }
    }
  },
  'performance.summary': {
    id: 'performance.summary',
    version: '1.0.0',
    name: '실제 마케팅 ROI 및 순수익 장부 조회',
    description: '워크스페이스 실제 집행 내역 기반 ROAS, CAC, 순수익 지표를 산출합니다. (허위 수치 없음)',
    domain: 'REPORT',
    riskTier: 'LOW',
    isWrite: false,
    requiresOwnerApproval: false,
    idempotencyRequired: false,
    evidenceContract: 'finops_ledger_aggregation',
    parametersSchema: {
      type: 'object',
      properties: {
        timeframe: { type: 'string', description: '분석 기간' }
      }
    }
  },

  // ==========================================
  // 11. Autonomy / Credit / System Domain (5.11) - ANI-617
  // ==========================================
  'autonomy.get': {
    id: 'autonomy.get',
    version: '1.0.0',
    name: '소희 24시간 자율근무 모드 조회',
    description: '소희의 실시간 채널 감시 및 자동화 마케팅 근무 가동 상태를 조회합니다.',
    domain: 'SYSTEM',
    riskTier: 'LOW',
    isWrite: false,
    requiresOwnerApproval: false,
    idempotencyRequired: false,
    evidenceContract: 'autonomy_state_query',
    parametersSchema: {
      type: 'object',
      properties: {}
    }
  },
  'autonomy.update': {
    id: 'autonomy.update',
    version: '1.0.0',
    name: '소희 24시간 자율근무 모드 제어',
    description: '소희의 실시간 채널 감시 및 자동화 마케팅 근무 상태를 가동(start)하거나 일시 정지(pause)합니다.',
    domain: 'SYSTEM',
    riskTier: 'MEDIUM',
    isWrite: true,
    requiresOwnerApproval: true,
    idempotencyRequired: true,
    evidenceContract: 'workspace_autonomy_state_mutation_receipt',
    parametersSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['start', 'pause'], description: '가동 시작: start, 일시정지: pause' }
      },
      required: ['action']
    }
  },
  'credit.status': {
    id: 'credit.status',
    version: '1.0.0',
    name: '크레딧 잔여량 및 채널 연동 헬스체크',
    description: '실제 잔여 SC와 인스타/스레드/네이버/당근 토큰 연결 상태를 점검합니다.',
    domain: 'SYSTEM',
    riskTier: 'LOW',
    isWrite: false,
    requiresOwnerApproval: false,
    idempotencyRequired: false,
    evidenceContract: 'system_health_and_credit_ledger',
    parametersSchema: {
      type: 'object',
      properties: {}
    }
  },
  'emergency_killswitch': {
    id: 'emergency_killswitch',
    version: '1.0.0',
    name: '전사 긴급 킬스위치 (모든 외부 발송 즉시 차단)',
    description: '모든 외부 채널의 자동 포스팅, 댓글/DM 답변, 브라우저 자동화를 즉시 강제 중단합니다.',
    domain: 'SYSTEM',
    riskTier: 'CRITICAL',
    isWrite: true,
    requiresOwnerApproval: true,
    idempotencyRequired: true,
    evidenceContract: 'killswitch_audit_log_entry',
    parametersSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['kill', 'release'], description: '긴급 차단: kill, 차단 해제: release' },
        reason: { type: 'string', description: '킬스위치 가동/해제 사유' }
      },
      required: ['action']
    }
  },

  // ==========================================
  // 12. UI Navigation Domain (5.12)
  // ==========================================
  'app.navigate': {
    id: 'app.navigate',
    version: '1.0.0',
    name: '소희 콘솔 화면 이동 및 포커스',
    description: '사장님이 작업 결과를 직접 확인하실 수 있도록 관련 메뉴 화면으로 이동합니다.',
    domain: 'NAVIGATION',
    riskTier: 'LOW',
    isWrite: false,
    requiresOwnerApproval: false,
    idempotencyRequired: false,
    evidenceContract: 'client_navigation_action',
    parametersSchema: {
      type: 'object',
      properties: {
        target: { 
          type: 'string', 
          enum: ['home', 'content', 'customers', 'results', 'sohee', 'system', 'channels'],
          description: '이동할 대상 화면'
        },
        entityId: { type: 'string', description: '포커스할 특정 객체 ID' }
      },
      required: ['target']
    }
  },
  'app.focus': {
    id: 'app.focus',
    version: '1.0.0',
    name: '특정 UI 컴포넌트 하이라이트',
    description: '화면 내 특정 카드나 승인 대상 요소를 일시적으로 시각적 강조합니다.',
    domain: 'NAVIGATION',
    riskTier: 'LOW',
    isWrite: false,
    requiresOwnerApproval: false,
    idempotencyRequired: false,
    evidenceContract: 'client_focus_action',
    parametersSchema: {
      type: 'object',
      properties: {
        entityType: { type: 'string', description: '객체 유형 (content, post, reservation 등)' },
        entityId: { type: 'string', description: '객체 ID' }
      },
      required: ['entityType', 'entityId']
    }
  },

  // ==========================================
  // 12. Booking Recovery Domain (ANI-1512)
  // ==========================================
  'recovery.list': {
    id: 'recovery.list',
    version: '1.0.0',
    name: '예약 문의 회수 케이스 목록 조회',
    description: '처리 대기 중인 예약 문의 회수 케이스 목록을 조회합니다.',
    domain: 'CRM',
    riskTier: 'LOW',
    isWrite: false,
    requiresOwnerApproval: false,
    idempotencyRequired: false,
    evidenceContract: 'recovery_cases_query',
    parametersSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: '조회할 최대 케이스 수' }
      }
    }
  },
  'recovery.get': {
    id: 'recovery.get',
    version: '1.0.0',
    name: '예약 회수 케이스 상세 조회',
    description: '특정 회수 케이스의 제안 상태, 슬롯, 수락 근거 및 승인 대기 상태를 조회합니다.',
    domain: 'CRM',
    riskTier: 'LOW',
    isWrite: false,
    requiresOwnerApproval: false,
    idempotencyRequired: false,
    evidenceContract: 'recovery_case_query',
    parametersSchema: {
      type: 'object',
      properties: {
        caseId: { type: 'string', description: '조회할 회수 케이스 UUID' }
      },
      required: ['caseId']
    }
  },
  'recovery.open': {
    id: 'recovery.open',
    version: '1.0.0',
    name: '수신 고객 문의 회수 케이스 생성/연결',
    description: '인스타그램/당근 등 고객 수신 DM으로부터 회수 케이스를 열거나 기존 케이스를 반환합니다.',
    domain: 'CRM',
    riskTier: 'LOW',
    isWrite: true,
    requiresOwnerApproval: false,
    idempotencyRequired: true,
    evidenceContract: 'recovery_case_opened',
    parametersSchema: {
      type: 'object',
      properties: {
        sourceInboundMessageId: { type: 'string', description: '수신 고객 메시지 UUID' }
      },
      required: ['sourceInboundMessageId']
    }
  },
  'recovery.prepare': {
    id: 'recovery.prepare',
    version: '1.0.0',
    name: '예약 회수 답변 제안 초안 작성',
    description: '확인된 카탈로그 서비스와 가용 슬롯을 바탕으로 회수 답변 초안과 지문을 생성합니다.',
    domain: 'CRM',
    riskTier: 'LOW',
    isWrite: true,
    requiresOwnerApproval: false,
    idempotencyRequired: true,
    evidenceContract: 'recovery_proposal_prepared',
    parametersSchema: {
      type: 'object',
      properties: {
        caseId: { type: 'string', description: '대상 케이스 UUID' },
        expectedVersion: { type: 'number', description: '현재 케이스 버전' },
        slotId: { type: 'string', description: '배정할 가용 예약 슬롯 UUID' }
      },
      required: ['caseId', 'expectedVersion']
    }
  },
  'recovery.request_send_approval': {
    id: 'recovery.request_send_approval',
    version: '1.0.0',
    name: '답변 발송 사장님 승인 요청 카드 제시',
    description: '준비된 회수 답변 제안을 사장님께 제시하여 직접 검토 및 발송 승인할 수 있도록 카드를 표시합니다.',
    domain: 'CRM',
    riskTier: 'MEDIUM',
    isWrite: false,
    requiresOwnerApproval: true,
    idempotencyRequired: false,
    evidenceContract: 'recovery_send_approval_card',
    parametersSchema: {
      type: 'object',
      properties: {
        caseId: { type: 'string', description: '대상 케이스 UUID' }
      },
      required: ['caseId']
    }
  },
  'recovery.request_booking_approval': {
    id: 'recovery.request_booking_approval',
    version: '1.0.0',
    name: '예약 확정 사장님 승인 요청 카드 제시',
    description: '고객의 예약 수락이 확인된 제안에 대해 사장님께 최종 예약 확정 승인 카드를 표시합니다.',
    domain: 'CRM',
    riskTier: 'HIGH',
    isWrite: false,
    requiresOwnerApproval: true,
    idempotencyRequired: false,
    evidenceContract: 'recovery_booking_approval_card',
    parametersSchema: {
      type: 'object',
      properties: {
        caseId: { type: 'string', description: '대상 케이스 UUID' }
      },
      required: ['caseId']
    }
  }
}

/**
 * Legacy `mcp_*` name alias mapping for seamless backwards-compatibility
 */
export const CAPABILITY_ALIAS_MAP: Record<string, string> = {
  'mcp_generate_visual_image': 'image.generate',
  'mcp_control_autonomy': 'autonomy.update',
  'mcp_emergency_killswitch': 'emergency_killswitch',
  'mcp_publish_live': 'publish.create',
  'mcp_query_customers': 'customer.search',
  'mcp_manage_reservation': 'reservation.create',
  'mcp_get_roi_analytics': 'performance.summary',
  'mcp_get_slot_occupancy': 'customer.search',
  'mcp_get_labor_savings': 'performance.summary',
  'mcp_export_marketing_report': 'report.generate',
  'mcp_inspect_harness': 'knowledge.search',
  'mcp_search_knowledge': 'knowledge.search',
  'mcp_generate_content': 'content.generate',
  'mcp_check_credits': 'credit.status',
  'mcp_check_system': 'credit.status',
  'mcp_navigate_console': 'app.navigate',
  'mcp_get_ad_campaigns': 'ads.list',
  'mcp_get_marketing_performance': 'performance.summary',
  'mcp_get_content_calendar': 'content.calendar.list',
  'mcp_get_customer_metrics': 'customer.search',
  // Reverse aliases
  'image.generate': 'image.generate',
  'publish.create': 'publish.create',
  'customer.search': 'customer.search',
  'autonomy.update': 'autonomy.update',
  'app.navigate': 'app.navigate'
}

/**
 * Resolve canonical capability ID from either canonical or legacy alias
 */
export function resolveCapabilityId(toolName: string): string {
  if (SOHEE_CAPABILITY_REGISTRY[toolName]) return toolName
  if (CAPABILITY_ALIAS_MAP[toolName] && SOHEE_CAPABILITY_REGISTRY[CAPABILITY_ALIAS_MAP[toolName]]) {
    return CAPABILITY_ALIAS_MAP[toolName]
  }
  return toolName
}

/**
 * Convert SOHEE_CAPABILITY_REGISTRY to OpenAI Function Calling Tools array
 */
export function getOpenAIToolDefinitions(): Array<{
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}> {
  return Object.values(SOHEE_CAPABILITY_REGISTRY).map(cap => ({
    type: 'function' as const,
    function: {
      name: cap.id,
      description: `[${cap.domain}] ${cap.name} - ${cap.description}`,
      parameters: cap.parametersSchema
    }
  }))
}

// =========================================================================
// Task 2.3: Operational READY Lifecycle State Machine & Contracts (ANI-954, ANI-976, ANI-977, ANI-978)
// =========================================================================

export type OperationalState =
  | 'PUBLISHED'
  | 'ARTIFACT_VERIFIED'
  | 'INSTALLED'
  | 'CREDENTIAL_CONNECTED'
  | 'PROVIDER_PROBED'
  | 'OPERATIONAL_READY';

export const OPERATIONAL_STATE_ORDER: readonly OperationalState[] = [
  'PUBLISHED',
  'ARTIFACT_VERIFIED',
  'INSTALLED',
  'CREDENTIAL_CONNECTED',
  'PROVIDER_PROBED',
  'OPERATIONAL_READY',
] as const;

export function canTransitionOperationalState(
  from: OperationalState,
  to: OperationalState
): boolean {
  const fromIndex = OPERATIONAL_STATE_ORDER.indexOf(from);
  const toIndex = OPERATIONAL_STATE_ORDER.indexOf(to);
  if (fromIndex === -1 || toIndex === -1) return false;
  // Transitions must be sequential forward by 1 step
  return toIndex === fromIndex + 1;
}

export function transitionCapabilityState(
  currentState: OperationalState,
  targetState: OperationalState
): OperationalState {
  if (!canTransitionOperationalState(currentState, targetState)) {
    throw new Error(
      `Invalid state transition: Cannot transition from ${currentState} to ${targetState}. Expected next state in order: ${OPERATIONAL_STATE_ORDER.join(' -> ')}`
    );
  }
  return targetState;
}

export interface OperationalReadyContract {
  capabilityId: string;
  name: string;
  provider: 'META' | 'NAVER' | 'DAANGN' | 'KAKAO' | 'OPENAI' | 'INTERNAL';
  requiredCredentialType: 'OAUTH_TOKEN' | 'API_KEY' | 'SESSION_VAULT' | 'WORKSPACE_INTERNAL';
  requiredScopes: string[];
  minCreditRequired: number;
  evidenceContract: string;
  policyRequirements: string[];
}

/**
 * The 18 Core Operational Capabilities across marketing OS domains
 */
export const CORE_18_OPERATIONAL_CAPABILITIES: Record<string, OperationalReadyContract> = {
  'content.generate': {
    capabilityId: 'content.generate',
    name: '신규 마케팅 콘텐츠 원고 생성',
    provider: 'OPENAI',
    requiredCredentialType: 'API_KEY',
    requiredScopes: ['ai_copywriting'],
    minCreditRequired: 10,
    evidenceContract: 'content_draft_record',
    policyRequirements: ['PROMPT_SAFETY', 'BRAND_GUARDRAILS'],
  },
  'content.rewrite': {
    capabilityId: 'content.rewrite',
    name: '기존 원고 톤앤매너 재작성',
    provider: 'OPENAI',
    requiredCredentialType: 'API_KEY',
    requiredScopes: ['ai_copywriting'],
    minCreditRequired: 10,
    evidenceContract: 'content_draft_record',
    policyRequirements: ['PROMPT_SAFETY'],
  },
  'content.schedule': {
    capabilityId: 'content.schedule',
    name: '콘텐츠 예약 발행 설정',
    provider: 'INTERNAL',
    requiredCredentialType: 'WORKSPACE_INTERNAL',
    requiredScopes: ['schedule_manage'],
    minCreditRequired: 0,
    evidenceContract: 'schedule_ledger_entry',
    policyRequirements: ['FUTURE_TIME_VALIDATION'],
  },
  'image.generate': {
    capabilityId: 'image.generate',
    name: 'GPT-Image-2 비주얼 이미지 생성',
    provider: 'OPENAI',
    requiredCredentialType: 'API_KEY',
    requiredScopes: ['image_generation'],
    minCreditRequired: 150,
    evidenceContract: 'image_asset_id_and_provenance_verified',
    policyRequirements: ['VISUAL_SAFETY_FILTER'],
  },
  'campaign.create': {
    capabilityId: 'campaign.create',
    name: '마케팅 캠페인 생성',
    provider: 'META',
    requiredCredentialType: 'OAUTH_TOKEN',
    requiredScopes: ['ads_management'],
    minCreditRequired: 50,
    evidenceContract: 'campaign_record',
    policyRequirements: ['BUDGET_GUARD', 'OWNER_APPROVAL'],
  },
  'campaign.status': {
    capabilityId: 'campaign.status',
    name: '캠페인 진행 현황 조회',
    provider: 'META',
    requiredCredentialType: 'OAUTH_TOKEN',
    requiredScopes: ['ads_read'],
    minCreditRequired: 0,
    evidenceContract: 'campaign_status_summary',
    policyRequirements: [],
  },
  'ads.list': {
    capabilityId: 'ads.list',
    name: '광고 캠페인 목록 및 집행 현황 조회',
    provider: 'META',
    requiredCredentialType: 'OAUTH_TOKEN',
    requiredScopes: ['ads_read'],
    minCreditRequired: 0,
    evidenceContract: 'ads_campaign_ledger_query',
    policyRequirements: [],
  },
  'channel.list': {
    capabilityId: 'channel.list',
    name: '연동된 공식 채널 목록 및 상태 조회',
    provider: 'INTERNAL',
    requiredCredentialType: 'WORKSPACE_INTERNAL',
    requiredScopes: ['channel_read'],
    minCreditRequired: 0,
    evidenceContract: 'channel_connections_status',
    policyRequirements: [],
  },
  'channel.status': {
    capabilityId: 'channel.status',
    name: '개별 채널 헬스체크',
    provider: 'INTERNAL',
    requiredCredentialType: 'WORKSPACE_INTERNAL',
    requiredScopes: ['channel_read'],
    minCreditRequired: 0,
    evidenceContract: 'channel_health_check',
    policyRequirements: [],
  },
  'channel.test_publish': {
    capabilityId: 'channel.test_publish',
    name: '채널 연동 테스트 발행',
    provider: 'META',
    requiredCredentialType: 'OAUTH_TOKEN',
    requiredScopes: ['instagram_content_publish'],
    minCreditRequired: 30,
    evidenceContract: 'test_publish_receipt',
    policyRequirements: ['OWNER_APPROVAL'],
  },
  'publish.create': {
    capabilityId: 'publish.create',
    name: '공식 SNS 채널 실시간 즉시 발행',
    provider: 'META',
    requiredCredentialType: 'OAUTH_TOKEN',
    requiredScopes: ['instagram_content_publish', 'threads_content_publish'],
    minCreditRequired: 30,
    evidenceContract: 'external_action_receipt_and_readback_verified',
    policyRequirements: ['OWNER_APPROVAL', 'KILL_SWITCH_CHECK', 'APPROVED_ASSET_ONLY'],
  },
  'publish.verify': {
    capabilityId: 'publish.verify',
    name: '발행된 외부 포스트 검증',
    provider: 'META',
    requiredCredentialType: 'OAUTH_TOKEN',
    requiredScopes: ['instagram_basic'],
    minCreditRequired: 0,
    evidenceContract: 'external_readback_receipt',
    policyRequirements: [],
  },
  'interaction.list': {
    capabilityId: 'interaction.list',
    name: '실시간 댓글 및 DM 인바운드 목록 조회',
    provider: 'META',
    requiredCredentialType: 'OAUTH_TOKEN',
    requiredScopes: ['instagram_manage_comments', 'instagram_manage_messages'],
    minCreditRequired: 0,
    evidenceContract: 'unified_inbox_query',
    policyRequirements: [],
  },
  'comment.reply': {
    capabilityId: 'comment.reply',
    name: '댓글/답글 작성 및 전송',
    provider: 'META',
    requiredCredentialType: 'OAUTH_TOKEN',
    requiredScopes: ['instagram_manage_comments'],
    minCreditRequired: 20,
    evidenceContract: 'interaction_receipt_and_reply_id_verified',
    policyRequirements: ['OWNER_APPROVAL_IF_EXECUTE'],
  },
  'dm.send': {
    capabilityId: 'dm.send',
    name: '1:1 DM 고객 답변 전송',
    provider: 'META',
    requiredCredentialType: 'OAUTH_TOKEN',
    requiredScopes: ['instagram_manage_messages'],
    minCreditRequired: 20,
    evidenceContract: 'interaction_receipt_and_message_id_verified',
    policyRequirements: ['OWNER_APPROVAL_IF_EXECUTE'],
  },
  'customer.search': {
    capabilityId: 'customer.search',
    name: '수집된 고객 상담 요약 조회',
    provider: 'INTERNAL',
    requiredCredentialType: 'WORKSPACE_INTERNAL',
    requiredScopes: ['customer_read'],
    minCreditRequired: 0,
    evidenceContract: 'db_workspace_customer_read_model',
    policyRequirements: ['TENANT_ISOLATION'],
  },
  'reservation.create': {
    capabilityId: 'reservation.create',
    name: '고객 예약 슬롯 등록 및 갱신',
    provider: 'INTERNAL',
    requiredCredentialType: 'WORKSPACE_INTERNAL',
    requiredScopes: ['reservation_write'],
    minCreditRequired: 0,
    evidenceContract: 'reservation_ledger_record',
    policyRequirements: ['SLOT_CONFLICT_CHECK'],
  },
  'report.generate': {
    capabilityId: 'report.generate',
    name: '주간/월간 마케팅 종합 성과표 생성',
    provider: 'INTERNAL',
    requiredCredentialType: 'WORKSPACE_INTERNAL',
    requiredScopes: ['analytics_read'],
    minCreditRequired: 0,
    evidenceContract: 'report_snapshot_asset',
    policyRequirements: ['ZERO_SYNTHETIC_DATA'],
  },
};

export interface CapabilityEvaluationContext {
  isArtifactVerified: boolean;
  isInstalled: boolean;
  isCredentialConnected: boolean;
  isProviderProbed: boolean;
  policyPassed?: boolean;
  creditSufficient?: boolean;
}

export interface CapabilityEvaluationResult {
  state: OperationalState;
  ready: boolean;
  blockReason?:
    | 'ARTIFACT_UNVERIFIED'
    | 'UNINSTALLED'
    | 'CREDENTIAL_MISSING'
    | 'PROVIDER_UNPROBED'
    | 'POLICY_BLOCKED'
    | 'INSUFFICIENT_CREDIT';
}

export function evaluateCapabilityOperationalState(
  capabilityId: string,
  context: CapabilityEvaluationContext
): CapabilityEvaluationResult {
  if (!context.isArtifactVerified) {
    return {
      state: 'PUBLISHED',
      ready: false,
      blockReason: 'ARTIFACT_UNVERIFIED',
    };
  }

  if (!context.isInstalled) {
    return {
      state: 'ARTIFACT_VERIFIED',
      ready: false,
      blockReason: 'UNINSTALLED',
    };
  }

  if (!context.isCredentialConnected) {
    return {
      state: 'INSTALLED',
      ready: false,
      blockReason: 'CREDENTIAL_MISSING',
    };
  }

  if (!context.isProviderProbed) {
    return {
      state: 'CREDENTIAL_CONNECTED',
      ready: false,
      blockReason: 'PROVIDER_UNPROBED',
    };
  }

  if (context.policyPassed === false) {
    return {
      state: 'PROVIDER_PROBED',
      ready: false,
      blockReason: 'POLICY_BLOCKED',
    };
  }

  if (context.creditSufficient === false) {
    return {
      state: 'PROVIDER_PROBED',
      ready: false,
      blockReason: 'INSUFFICIENT_CREDIT',
    };
  }

  return {
    state: 'OPERATIONAL_READY',
    ready: true,
  };
}

// =========================================================================
// Provider Capability Matrix: Meta, Naver, Daangn, Kakao
// =========================================================================

export interface ProviderMatrixEntry {
  provider: 'META' | 'NAVER' | 'DAANGN' | 'KAKAO';
  channels: string[];
  readCapabilities: string[];
  writeCapabilities: string[];
  readbackMethod:
    | 'GRAPH_API_GET'
    | 'SEARCH_ADS_API_GET'
    | 'BROWSER_DOM_OR_API_READBACK'
    | 'BROWSER_SESSION_READBACK'
    | 'MESSAGING_RECEIPT_READBACK';
  authoritativeVerification: boolean;
  evidenceContract: string;
  supportedExecutionModes: ('API' | 'BROWSER_SESSION' | 'MANUAL_HANDOFF')[];
}

export const PROVIDER_CAPABILITY_MATRIX: Record<
  'META' | 'NAVER' | 'DAANGN' | 'KAKAO',
  ProviderMatrixEntry
> = {
  META: {
    provider: 'META',
    channels: ['INSTAGRAM', 'THREADS', 'META_ADS'],
    readCapabilities: ['interaction.list', 'publish.verify', 'ads.list', 'campaign.status', 'channel.status'],
    writeCapabilities: ['publish.create', 'comment.reply', 'dm.send', 'campaign.create', 'channel.test_publish'],
    readbackMethod: 'GRAPH_API_GET',
    authoritativeVerification: true,
    evidenceContract: 'external_action_receipt_and_readback_verified',
    supportedExecutionModes: ['API'],
  },
  NAVER: {
    provider: 'NAVER',
    channels: ['NAVER_BLOG', 'NAVER_SEARCH_ADS'],
    readCapabilities: ['publish.verify', 'review.list', 'ads.list', 'campaign.status'],
    writeCapabilities: ['campaign.create'],
    readbackMethod: 'BROWSER_DOM_OR_API_READBACK',
    authoritativeVerification: true,
    evidenceContract: 'browser_publish_screenshot_and_dom_receipt',
    supportedExecutionModes: ['MANUAL_HANDOFF'],
  },
  DAANGN: {
    provider: 'DAANGN',
    channels: ['DAANGN'],
    readCapabilities: ['interaction.list', 'review.list'],
    writeCapabilities: ['publish.create', 'dm.send'],
    readbackMethod: 'BROWSER_SESSION_READBACK',
    authoritativeVerification: true,
    evidenceContract: 'daangn_business_post_and_chat_receipt',
    supportedExecutionModes: ['BROWSER_SESSION'],
  },
  KAKAO: {
    provider: 'KAKAO',
    channels: ['KAKAO'],
    readCapabilities: ['interaction.list', 'customer.search'],
    writeCapabilities: ['dm.send'],
    readbackMethod: 'MESSAGING_RECEIPT_READBACK',
    authoritativeVerification: true,
    evidenceContract: 'kakao_alimtalk_receipt_verified',
    supportedExecutionModes: ['API', 'MANUAL_HANDOFF'],
  },
};

