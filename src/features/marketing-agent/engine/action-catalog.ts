import { ChannelKey } from '../types';

export type ActionCategory = 
  | 'content'
  | 'instagram'
  | 'threads'
  | 'naver_blog'
  | 'customer'
  | 'reservation'
  | 'review'
  | 'performance'
  | 'report';

export type ActionRiskLevel = 'GREEN' | 'YELLOW' | 'RED';
export type ApprovalPolicy = 'always_auto' | 'conditional_auto' | 'approval_required' | 'blocked';
export type VerificationStrategy = 'permalink_check' | 'reply_check' | 'db_verification' | 'none';

export interface ActionDefinition {
  actionType: string;
  category: ActionCategory;
  name: string;
  description: string;
  provider: 'openai' | 'meta' | 'naver' | 'internal' | 'supabase';
  channelKey?: ChannelKey;
  requiredCapability?: string;
  riskLevel: ActionRiskLevel;
  defaultApprovalPolicy: ApprovalPolicy;
  idempotencyScope: 'workspace_rule_occurrence' | 'customer_message' | 'daily_singleton';
  verificationStrategy: VerificationStrategy;
  creditCost: number;
}

export const ACTION_CATALOG: Record<string, ActionDefinition> = {
  // 1. Content Actions
  'content.research': {
    actionType: 'content.research',
    category: 'content',
    name: '콘텐츠 트렌드 및 키워드 리서치',
    description: '바이름 업종 및 지역 타겟 인기 키워드 검색 및 분석',
    provider: 'internal',
    riskLevel: 'GREEN',
    defaultApprovalPolicy: 'always_auto',
    idempotencyScope: 'workspace_rule_occurrence',
    verificationStrategy: 'none',
    creditCost: 2,
  },
  'content.generate_text': {
    actionType: 'content.generate_text',
    category: 'content',
    name: '브랜드 맞춤 텍스트/카피 생성',
    description: '매장 브랜드 인텔리전스 기반 인스타 캡션/스레드 텍스트/블로그 본문 작성',
    provider: 'openai',
    riskLevel: 'GREEN',
    defaultApprovalPolicy: 'always_auto',
    idempotencyScope: 'workspace_rule_occurrence',
    verificationStrategy: 'none',
    creditCost: 3,
  },
  'content.generate_image': {
    actionType: 'content.generate_image',
    category: 'content',
    name: '시각 콘텐츠 이미지 생성',
    description: 'DALL-E 3 기반 고품질 매장 감성 이미지 생성',
    provider: 'openai',
    riskLevel: 'GREEN',
    defaultApprovalPolicy: 'always_auto',
    idempotencyScope: 'workspace_rule_occurrence',
    verificationStrategy: 'none',
    creditCost: 10,
  },

  // 2. Instagram Actions
  'instagram.publish': {
    actionType: 'instagram.publish',
    category: 'instagram',
    name: '인스타그램 피드/릴스 게시물 실제 발행',
    description: 'Meta Graph API를 통한 실제 미디어 컨테이너 생성 및 게시',
    provider: 'meta',
    channelKey: 'instagram',
    requiredCapability: 'instagram.publish_photo',
    riskLevel: 'YELLOW',
    defaultApprovalPolicy: 'always_auto',
    idempotencyScope: 'workspace_rule_occurrence',
    verificationStrategy: 'permalink_check',
    creditCost: 15,
  },
  'instagram.read_comments': {
    actionType: 'instagram.read_comments',
    category: 'instagram',
    name: '인스타그램 댓글 및 멘션 조회',
    description: '최근 게시물의 신규 댓글 수집 및 감정/인텐트 분석',
    provider: 'meta',
    channelKey: 'instagram',
    requiredCapability: 'instagram.read_comments',
    riskLevel: 'GREEN',
    defaultApprovalPolicy: 'always_auto',
    idempotencyScope: 'workspace_rule_occurrence',
    verificationStrategy: 'none',
    creditCost: 1,
  },
  'instagram.reply_comment': {
    actionType: 'instagram.reply_comment',
    category: 'instagram',
    name: '인스타그램 댓글 답글 초안 추천',
    description: '안전 정책(GREEN) 범위 내 칭찬/감사/위치 안내 답글 초안 추천',
    provider: 'meta',
    channelKey: 'instagram',
    requiredCapability: 'instagram.reply_comments',
    riskLevel: 'YELLOW',
    defaultApprovalPolicy: 'conditional_auto',
    idempotencyScope: 'customer_message',
    verificationStrategy: 'reply_check',
    creditCost: 2,
  },
  'instagram.read_dm': {
    actionType: 'instagram.read_dm',
    category: 'instagram',
    name: '인스타그램 DM 수신 및 조회',
    description: '영업시간 중 실시간 고객 DM 인바운드 수집',
    provider: 'meta',
    channelKey: 'instagram',
    requiredCapability: 'instagram.read_messages',
    riskLevel: 'GREEN',
    defaultApprovalPolicy: 'always_auto',
    idempotencyScope: 'workspace_rule_occurrence',
    verificationStrategy: 'none',
    creditCost: 1,
  },
  'instagram.reply_dm': {
    actionType: 'instagram.reply_dm',
    category: 'instagram',
    name: '인스타그램 DM 응답 초안 추천',
    description: '운영시간, 가격표, 예약 방법 등 안전 범위 DM 회신 가이드 및 초안',
    provider: 'meta',
    channelKey: 'instagram',
    requiredCapability: 'instagram.send_message',
    riskLevel: 'YELLOW',
    defaultApprovalPolicy: 'conditional_auto',
    idempotencyScope: 'customer_message',
    verificationStrategy: 'reply_check',
    creditCost: 4,
  },

  // 3. Threads Actions
  'threads.publish': {
    actionType: 'threads.publish',
    category: 'threads',
    name: '스레드(Threads) 텍스트/미디어 발행',
    description: 'Meta Threads API를 통한 실제 포스트 발행 및 영구 링크 검증',
    provider: 'meta',
    channelKey: 'threads',
    requiredCapability: 'threads.publish_post',
    riskLevel: 'GREEN',
    defaultApprovalPolicy: 'always_auto',
    idempotencyScope: 'workspace_rule_occurrence',
    verificationStrategy: 'permalink_check',
    creditCost: 5,
  },
  'threads.read_replies': {
    actionType: 'threads.read_replies',
    category: 'threads',
    name: '스레드 답글 및 멘션 조회',
    description: '스레드 포스트의 실시간 반응 및 질문 수집',
    provider: 'meta',
    channelKey: 'threads',
    requiredCapability: 'threads.read_replies',
    riskLevel: 'GREEN',
    defaultApprovalPolicy: 'always_auto',
    idempotencyScope: 'workspace_rule_occurrence',
    verificationStrategy: 'none',
    creditCost: 1,
  },
  'threads.reply': {
    actionType: 'threads.reply',
    category: 'threads',
    name: '스레드 실시간 답글 작성',
    description: '친근한 브랜드 톤으로 고객 질문 및 관심에 즉시 답변',
    provider: 'meta',
    channelKey: 'threads',
    requiredCapability: 'threads.reply',
    riskLevel: 'GREEN',
    defaultApprovalPolicy: 'always_auto',
    idempotencyScope: 'customer_message',
    verificationStrategy: 'reply_check',
    creditCost: 2,
  },

  // 4. Naver Blog Actions
  'naver_blog.publish': {
    actionType: 'naver_blog.publish',
    category: 'naver_blog',
    name: '네이버 블로그 전문 칼럼 원고 준비',
    description: '블로그 발행용 전문 칼럼 원고 작성 및 등록 지원',
    provider: 'naver',
    channelKey: 'naver_blog',
    requiredCapability: 'naver_blog.local_connector',
    riskLevel: 'YELLOW',
    defaultApprovalPolicy: 'conditional_auto',
    idempotencyScope: 'workspace_rule_occurrence',
    verificationStrategy: 'permalink_check',
    creditCost: 25,
  },

  // 5. Customer Domain Actions
  'customer.classify': {
    actionType: 'customer.classify',
    category: 'customer',
    name: '고객 인텐트 분류 및 프로파일링',
    description: '인바운드 메시지 분석(단순문의 / 예약의도 / 클레임 / 재방문)',
    provider: 'internal',
    riskLevel: 'GREEN',
    defaultApprovalPolicy: 'always_auto',
    idempotencyScope: 'customer_message',
    verificationStrategy: 'db_verification',
    creditCost: 1,
  },
  'customer.follow_up': {
    actionType: 'customer.follow_up',
    category: 'customer',
    name: '미예약/미응답 고객 리마인더 제안',
    description: '상담 후 24시간 미예약 고객 대상 부드러운 안부 및 슬롯 안내',
    provider: 'internal',
    riskLevel: 'YELLOW',
    defaultApprovalPolicy: 'conditional_auto',
    idempotencyScope: 'daily_singleton',
    verificationStrategy: 'db_verification',
    creditCost: 3,
  },

  // 6. Reservation Domain Actions (P0)
  'reservation.check_availability': {
    actionType: 'reservation.check_availability',
    category: 'reservation',
    name: '예약 가능 슬롯 유효성 검증',
    description: '존재하지 않거나 중복된 예약 시간 차단 및 캘린더 실시간 대조',
    provider: 'internal',
    riskLevel: 'GREEN',
    defaultApprovalPolicy: 'always_auto',
    idempotencyScope: 'workspace_rule_occurrence',
    verificationStrategy: 'db_verification',
    creditCost: 0,
  },
  'reservation.propose_slot': {
    actionType: 'reservation.propose_slot',
    category: 'reservation',
    name: '검증된 예약 슬롯 고객에게 제안',
    description: '유효한 시간대 2~3개를 고객 DM/메시지로 정중히 제안',
    provider: 'internal',
    riskLevel: 'YELLOW',
    defaultApprovalPolicy: 'always_auto',
    idempotencyScope: 'customer_message',
    verificationStrategy: 'db_verification',
    creditCost: 2,
  },
  'reservation.create': {
    actionType: 'reservation.create',
    category: 'reservation',
    name: '신규 예약 후보 생성 (SLOT_PROPOSED)',
    description: '고객 선택 슬롯 기반 예약 도메인 엔티티 생성',
    provider: 'internal',
    riskLevel: 'YELLOW',
    defaultApprovalPolicy: 'always_auto',
    idempotencyScope: 'customer_message',
    verificationStrategy: 'db_verification',
    creditCost: 5,
  },
  'reservation.confirm': {
    actionType: 'reservation.confirm',
    category: 'reservation',
    name: '예약 최종 확정 (CONFIRMED)',
    description: '사장님 확인 또는 자동 승인 정책에 따른 최종 예약 확정 및 안내',
    provider: 'internal',
    riskLevel: 'YELLOW',
    defaultApprovalPolicy: 'always_auto',
    idempotencyScope: 'daily_singleton',
    verificationStrategy: 'db_verification',
    creditCost: 5,
  },

  // 7. Review Actions
  'review.read': {
    actionType: 'review.read',
    category: 'review',
    name: '고객 리뷰 피드백 분석',
    description: '방문자 리뷰 및 피드백 내용 분석과 감정 분석',
    provider: 'naver',
    riskLevel: 'GREEN',
    defaultApprovalPolicy: 'always_auto',
    idempotencyScope: 'workspace_rule_occurrence',
    verificationStrategy: 'none',
    creditCost: 1,
  },
  'review.reply': {
    actionType: 'review.reply',
    category: 'review',
    name: '리뷰 감사 답글 초안 작성',
    description: '긍정 리뷰 감사 답글 초안 추천 및 주요 리뷰 사장님 확인 안내',
    provider: 'naver',
    riskLevel: 'YELLOW',
    defaultApprovalPolicy: 'conditional_auto',
    idempotencyScope: 'customer_message',
    verificationStrategy: 'reply_check',
    creditCost: 3,
  },

  // 8. Performance & Reports
  'performance.collect': {
    actionType: 'performance.collect',
    category: 'performance',
    name: '멀티채널 성과 및 전환 데이터 수집',
    description: '노출수, 클릭수, DM 유입, 예약 전환율 종합 집계',
    provider: 'internal',
    riskLevel: 'GREEN',
    defaultApprovalPolicy: 'always_auto',
    idempotencyScope: 'daily_singleton',
    verificationStrategy: 'db_verification',
    creditCost: 0,
  },
  'report.generate': {
    actionType: 'report.generate',
    category: 'report',
    name: '소희 일일/주간 마케팅 업무 보고서 생성',
    description: '소희가 수행한 일, 성과, 다음 액션 계획 브리핑 생성',
    provider: 'openai',
    riskLevel: 'GREEN',
    defaultApprovalPolicy: 'always_auto',
    idempotencyScope: 'daily_singleton',
    verificationStrategy: 'db_verification',
    creditCost: 4,
  },
};

export function getActionDefinition(actionType: string): ActionDefinition | undefined {
  return ACTION_CATALOG[actionType];
}
