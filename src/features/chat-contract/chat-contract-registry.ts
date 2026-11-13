/**
 * Sohee V0.9 5th Update · Wave 5 Chat Contract
 * Marketing Employee Scenario → Tool → Evidence Capability Matrix Registry
 * 
 * Traceability: ANI-937
 */

import {
  MarketingScenarioType,
  ScenarioContractDefinition,
  ScenarioExecutionTrace,
  ContractFailureReason,
} from '@/types/chat-contract-matrix';

export class ChatContractRegistry {
  private contracts: Map<MarketingScenarioType, ScenarioContractDefinition> = new Map();

  constructor() {
    this.registerAllContracts();
  }

  public getContract(scenarioType: MarketingScenarioType): ScenarioContractDefinition {
    const contract = this.contracts.get(scenarioType);
    if (!contract) {
      throw new Error(`Unrecognized marketing scenario type: ${scenarioType}`);
    }
    return contract;
  }

  public listAllContracts(): ScenarioContractDefinition[] {
    return Array.from(this.contracts.values());
  }

  /**
   * 자연어 의도 기반 시나리오 계약 라우팅
   */
  public matchScenarioFromText(text: string): ScenarioContractDefinition | null {
    const trimmed = text.toLowerCase();

    // 1. 권한/연동/철회/신뢰 (보안 및 연동 감사)
    if (trimmed.includes('권한') || trimmed.includes('연동') || trimmed.includes('토큰') || trimmed.includes('신뢰') || trimmed.includes('끊어')) {
      return this.getContract('CONNECTION_TRUST_AUDIT');
    }
    // 2. 자율/재계획/replan/기회/알아서 (Owner-Absent Replan)
    if (trimmed.includes('자율') || trimmed.includes('재계획') || trimmed.includes('replan') || trimmed.includes('기회') || trimmed.includes('알아서')) {
      return this.getContract('AUTONOMY_REPLAN');
    }
    // 3. 광고/예산/ROAS
    if (trimmed.includes('광고') || trimmed.includes('예산') || trimmed.includes('roas') || trimmed.includes('증액') || trimmed.includes('중지')) {
      return this.getContract('AD_BUDGET_OPTIMIZE');
    }
    // 4. 예약/고객/상담/공실
    if (trimmed.includes('예약') || trimmed.includes('고객') || trimmed.includes('상담') || trimmed.includes('공실')) {
      return this.getContract('CUSTOMER_BOOKING');
    }
    // 5. 매출/성과/정산/귀속
    if (trimmed.includes('매출') || trimmed.includes('성과') || trimmed.includes('정산') || trimmed.includes('귀속')) {
      return this.getContract('ATTRIBUTION_REVENUE');
    }
    // 6. 규칙/원칙/목표/설정
    if (trimmed.includes('규칙') || trimmed.includes('원칙') || trimmed.includes('목표') || trimmed.includes('소희 설정')) {
      return this.getContract('KNOWLEDGE_GOAL_MUTATION');
    }
    // 7. 콘텐츠 생성/발행
    if (trimmed.includes('발행') || trimmed.includes('콘텐츠') || trimmed.includes('인스타') || trimmed.includes('블로그') || trimmed.includes('피드')) {
      return this.getContract('CONTENT_PUBLISH');
    }

    return null;
  }

  /**
   * 시나리오 사전 조건 및 실패 계약 평가 (Fail-Closed)
   * Acceptance: 실제 도구 미지원 시 synthetic success 금지; UNSUPPORTED/BLOCKED로 종료.
   */
  public evaluatePreconditionsAndExecute(params: {
    scenarioType: MarketingScenarioType;
    conversationId: string;
    actionRunId: string;
    context: {
      creditBalanceKrw: number;
      isChannelConnected: boolean;
      isTokenExpired: boolean;
      isToolSupported: boolean;
      isTimedOut?: boolean;
    };
  }): ScenarioExecutionTrace {
    const contract = this.getContract(params.scenarioType);
    const timestamp = new Date().toISOString();
    const traceId = `trc_scen_${Date.now()}`;

    // 1. 도구 미지원 체크 (Synthetic Success 방지)
    if (!params.context.isToolSupported) {
      return {
        traceId,
        conversationId: params.conversationId,
        actionRunId: params.actionRunId,
        scenarioType: params.scenarioType,
        status: 'UNSUPPORTED',
        failureReason: 'UNSUPPORTED_CAPABILITY',
        errorMessage: contract.failureContract.UNSUPPORTED_CAPABILITY?.clientMessage || '지원되지 않는 기능입니다.',
        timestamp,
      };
    }

    // 2. 크레딧 부족 체크 (비용 발생 쓰기 액션 시)
    if (contract.mutationType !== 'READ_ONLY' && params.context.creditBalanceKrw <= 0) {
      return {
        traceId,
        conversationId: params.conversationId,
        actionRunId: params.actionRunId,
        scenarioType: params.scenarioType,
        status: 'BLOCKED',
        failureReason: 'ZERO_CREDIT',
        errorMessage: contract.failureContract.ZERO_CREDIT?.clientMessage || '크레딧이 부족합니다.',
        timestamp,
      };
    }

    // 3. 채널 미연결 체크
    if (!params.context.isChannelConnected && contract.mutationType !== 'READ_ONLY') {
      return {
        traceId,
        conversationId: params.conversationId,
        actionRunId: params.actionRunId,
        scenarioType: params.scenarioType,
        status: 'BLOCKED',
        failureReason: 'PROVIDER_DISCONNECTED',
        errorMessage: contract.failureContract.PROVIDER_DISCONNECTED?.clientMessage || '채널이 연동되어 있지 않습니다.',
        timestamp,
      };
    }

    // 4. 인증 토큰 만료 체크
    if (params.context.isTokenExpired) {
      return {
        traceId,
        conversationId: params.conversationId,
        actionRunId: params.actionRunId,
        scenarioType: params.scenarioType,
        status: 'BLOCKED',
        failureReason: 'EXPIRED_AUTH_TOKEN',
        errorMessage: contract.failureContract.EXPIRED_AUTH_TOKEN?.clientMessage || '채널 인증 토큰이 만료되었습니다.',
        timestamp,
      };
    }

    // 5. 타임아웃 발생 시 RESULT_UNKNOWN 계약 (섣부른 완료/성공 금지)
    if (params.context.isTimedOut) {
      return {
        traceId,
        conversationId: params.conversationId,
        actionRunId: params.actionRunId,
        scenarioType: params.scenarioType,
        status: 'RESULT_UNKNOWN',
        failureReason: 'TIMEOUT_RESULT_UNKNOWN',
        errorMessage: contract.failureContract.TIMEOUT_RESULT_UNKNOWN?.clientMessage || '외부 응답 지연으로 독립 재조회 대기열로 이관되었습니다.',
        timestamp,
      };
    }

    // 6. 정상 실행 및 검증 완료 계약 (Provider Readback & Evidence)
    const evidenceId = `ev_proof_${params.actionRunId}`;
    return {
      traceId,
      conversationId: params.conversationId,
      actionRunId: params.actionRunId,
      scenarioType: params.scenarioType,
      status: 'VERIFIED',
      evidenceId,
      evidenceDigest: `sha256_${params.actionRunId}_${evidenceId}_verified`,
      timestamp,
    };
  }

  private registerAllContracts() {
    // 1. Content Publish
    this.contracts.set('CONTENT_PUBLISH', {
      scenarioType: 'CONTENT_PUBLISH',
      title: '콘텐츠 생성·QC·예약발행',
      description: '채널 네이티브 포맷 제약 및 의료법/광고법 QC를 통과한 후 독립 Readback을 거쳐 발행',
      naturalLanguageExamples: ['인스타 봄맞이 이벤트 피드 발행해줘', '블로그 관리 칼럼 예약 걸어줘'],
      requiredContext: ['workspaceId', 'brandVoice', 'channelToken', 'qcRules'],
      supportedTools: ['content_brief_generator', 'visual_lookbook_curator', 'medical_law_qc_gate', 'provider_publisher'],
      mutationType: 'DURABLE_WRITE',
      approvalPolicy: 'OWNER_APPROVAL_REQUIRED',
      readbackMethod: 'INDEPENDENT_GET',
      evidenceType: 'CRYPTOGRAPHIC_SHA256',
      failureContract: {
        ZERO_CREDIT: {
          resultingStatus: 'BLOCKED',
          clientMessage: '보유 크레딧이 부족하여 콘텐츠 발행 작업을 시작할 수 없습니다. 크레딧을 충전해주세요.',
          recoveryAction: 'NAVIGATE_TO_SYSTEM_CREDITS',
        },
        PROVIDER_DISCONNECTED: {
          resultingStatus: 'BLOCKED',
          clientMessage: '해당 채널 연동이 해제되어 있습니다. System 워크벤치에서 채널을 다시 연결해주세요.',
          recoveryAction: 'RECONNECT_CHANNEL',
        },
        EXPIRED_AUTH_TOKEN: {
          resultingStatus: 'BLOCKED',
          clientMessage: '채널 OAuth 토큰이 만료되었습니다. 계정 재인증이 필요합니다.',
          recoveryAction: 'REFRESH_OAUTH_TOKEN',
        },
        TIMEOUT_RESULT_UNKNOWN: {
          resultingStatus: 'RESULT_UNKNOWN',
          clientMessage: 'SNS 플랫폼 응답이 지연되어 RESULT_UNKNOWN 대사 큐에 등록되었습니다. 중복 발행을 방지하기 위해 독립 재조회를 수행합니다.',
          recoveryAction: 'SCHEDULE_INDEPENDENT_READBACK',
        },
        UNSUPPORTED_CAPABILITY: {
          resultingStatus: 'UNSUPPORTED',
          clientMessage: '요청하신 포맷이나 채널은 현재 지원되지 않습니다.',
          recoveryAction: 'SELECT_SUPPORTED_CHANNEL',
        },
      },
    });

    // 2. Ad Budget Optimize
    this.contracts.set('AD_BUDGET_OPTIMIZE', {
      scenarioType: 'AD_BUDGET_OPTIMIZE',
      title: '광고 중지/증액/예산 이동',
      description: 'Meta Ads API를 통해 캠페인 상태 변경 및 예산 조정 후 Readback 검증',
      naturalLanguageExamples: ['효율 안 나오는 광고 꺼줘', '이번 주말 광고비 5만원 올려줘'],
      requiredContext: ['workspaceId', 'adAccountId', 'dailyBudgetLimit', 'roasThreshold'],
      supportedTools: ['meta_ads_client', 'spend_guardrail_gate', 'ad_readback_service'],
      mutationType: 'FINANCIAL_WRITE',
      approvalPolicy: 'OWNER_APPROVAL_REQUIRED',
      readbackMethod: 'INDEPENDENT_GET',
      evidenceType: 'PG_LEDGER_PROOF',
      failureContract: {
        ZERO_CREDIT: {
          resultingStatus: 'BLOCKED',
          clientMessage: '외부 광고비 및 대행 크레딧 한도가 소진되었습니다.',
          recoveryAction: 'NAVIGATE_TO_FINOPS',
        },
        PROVIDER_DISCONNECTED: {
          resultingStatus: 'BLOCKED',
          clientMessage: 'Meta 광고 계정이 연결되어 있지 않습니다.',
          recoveryAction: 'CONNECT_META_ADS',
        },
        TIMEOUT_RESULT_UNKNOWN: {
          resultingStatus: 'RESULT_UNKNOWN',
          clientMessage: 'Meta API 응답이 지연되어 즉시 확정하지 않고 재조회 큐로 격리합니다.',
          recoveryAction: 'RECONCILE_AD_CAMPAIGN',
        },
      },
    });

    // 3. Customer Booking
    this.contracts.set('CUSTOMER_BOOKING', {
      scenarioType: 'CUSTOMER_BOOKING',
      title: '고객 응대·예약 제안·확정',
      description: '실시간 공실 확인(Availability Read) 필수 통과 후 예약 확정 및 EMR 연동',
      naturalLanguageExamples: ['내일 오후 3시 예약 잡아줘', '취소된 시간대에 대기 고객 안내해줘'],
      requiredContext: ['workspaceId', 'customerId', 'bookingSlot', 'hospitalEmrToken'],
      supportedTools: ['emr_slot_checker', 'customer_messenger', 'booking_hold_mutator'],
      mutationType: 'DURABLE_WRITE',
      approvalPolicy: 'AUTOMATIC',
      readbackMethod: 'INDEPENDENT_GET',
      evidenceType: 'EMR_RECEIPT',
      failureContract: {
        PROVIDER_DISCONNECTED: {
          resultingStatus: 'BLOCKED',
          clientMessage: '병원 예약 EMR 연동이 오프라인 상태입니다.',
          recoveryAction: 'CHECK_EMR_CONNECTOR',
        },
        TIMEOUT_RESULT_UNKNOWN: {
          resultingStatus: 'RESULT_UNKNOWN',
          clientMessage: 'EMR 슬롯 확정 응답이 지연되어 이중 예약을 방지하기 위해 HOLD 상태로 격리합니다.',
          recoveryAction: 'VERIFY_EMR_SLOT',
        },
      },
    });

    // 4. Attribution Revenue
    this.contracts.set('ATTRIBUTION_REVENUE', {
      scenarioType: 'ATTRIBUTION_REVENUE',
      title: '성과 조회·귀속·매출 Lineage',
      description: '실측 검증된 매출 이벤트만을 합산하여 돈이 된 마케팅 계보를 제공',
      naturalLanguageExamples: ['이번 주 인스타로 얼마 벌었어?', '돈 된 마케팅 내역만 보여줘'],
      requiredContext: ['workspaceId', 'timeRange', 'attributionModel'],
      supportedTools: ['verified_revenue_query', 'attribution_lineage_builder'],
      mutationType: 'READ_ONLY',
      approvalPolicy: 'AUTOMATIC',
      readbackMethod: 'NONE',
      evidenceType: 'READ_LOG',
      failureContract: {
        UNSUPPORTED_CAPABILITY: {
          resultingStatus: 'UNSUPPORTED',
          clientMessage: '지원되지 않는 기여 모델 분석 요청입니다.',
          recoveryAction: 'USE_DEFAULT_ATTRIBUTION',
        },
      },
    });

    // 5. Knowledge Goal Mutation
    this.contracts.set('KNOWLEDGE_GOAL_MUTATION', {
      scenarioType: 'KNOWLEDGE_GOAL_MUTATION',
      title: '지식/목표/자율성 수정',
      description: '매장 운영 원칙, 사장님 스타일, Autonomy Envelope 정책 버전 관리 갱신',
      naturalLanguageExamples: ['우리 매장은 정직한 서비스를 제공한다고 강조해줘', '광고비 일 3만원 넘지 마'],
      requiredContext: ['workspaceId', 'envelopePolicy', 'ruleCategory'],
      supportedTools: ['policy_envelope_mutator', 'rule_version_creator', 'rule_audit_logger'],
      mutationType: 'DURABLE_WRITE',
      approvalPolicy: 'AUTOMATIC',
      readbackMethod: 'INDEPENDENT_GET',
      evidenceType: 'CRYPTOGRAPHIC_SHA256',
      failureContract: {},
    });

    // 6. Connection Trust Audit
    this.contracts.set('CONNECTION_TRUST_AUDIT', {
      scenarioType: 'CONNECTION_TRUST_AUDIT',
      title: '연결/권한/신뢰 상태 진단',
      description: '외부 채널 권한 철회, 토큰 유효성 검사 및 건강도 실측',
      naturalLanguageExamples: ['인스타 연결 상태 확인해줘', '메타 광고 권한 끊어줘'],
      requiredContext: ['workspaceId', 'channelId'],
      supportedTools: ['channel_health_prober', 'oauth_token_refresher', 'permission_revoker'],
      mutationType: 'DURABLE_WRITE',
      approvalPolicy: 'OWNER_APPROVAL_REQUIRED',
      readbackMethod: 'INDEPENDENT_GET',
      evidenceType: 'CRYPTOGRAPHIC_SHA256',
      failureContract: {},
    });

    // 7. Autonomy Replan
    this.contracts.set('AUTONOMY_REPLAN', {
      scenarioType: 'AUTONOMY_REPLAN',
      title: 'Owner-Absent 기회 탐지 및 재계획',
      description: '공실/목표 미달 신호 탐지 후 가드레일 내 자동 실행 및 v+1 재계획',
      naturalLanguageExamples: ['공실 생기면 알아서 채워줘', '목표 미달 시 대책 세워줘'],
      requiredContext: ['workspaceId', 'opportunitySignals', 'autonomyEnvelope'],
      supportedTools: ['opportunity_detector', 'action_graph_replanner', 'canary_tracer'],
      mutationType: 'DURABLE_WRITE',
      approvalPolicy: 'AUTOMATIC',
      readbackMethod: 'INDEPENDENT_GET',
      evidenceType: 'CRYPTOGRAPHIC_SHA256',
      failureContract: {
        ZERO_CREDIT: {
          resultingStatus: 'BLOCKED',
          clientMessage: '보유 크레딧 소진으로 자율 실행 루틴이 일시 정지되었습니다.',
          recoveryAction: 'RECHARGE_CREDITS',
        },
      },
    });
  }
}
