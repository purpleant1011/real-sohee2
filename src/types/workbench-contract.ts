/**
 * Sohee V0.9 5th Update · Wave 3 Workbenches
 * Chat-Native 7 Workbench Design Source of Truth & Universal Contract
 * 
 * Lineage: Figma Page '03 · 5차 수정 시안 · Chat-Native Workbenches' & '04 · 5차 Responsive & Agent States'
 * Traceability: ANI-935, ANI-934
 */

export type WorkbenchId = 
  | 'home'
  | 'content'
  | 'customers'
  | 'results'
  | 'sohee'
  | 'ads'
  | 'system';

export type WorkbenchViewport = 'DESKTOP_1440' | 'TABLET_768' | 'MOBILE_375';

export type DockPresentationMode = 'FIXED_DOCK' | 'OPS_DRAWER' | 'BOTTOM_SHEET';

export type WorkbenchAgentLifecycleState =
  | 'MESSAGE'
  | 'PLAN'
  | 'EXECUTION'
  | 'APPROVAL'
  | 'EVIDENCE'
  | 'RESULT_UNKNOWN'
  | 'VERIFIED'
  | 'BLOCKED';

export type DatasetMode = 'ACTUAL' | 'SHOWCASE_DEMO' | 'TEST';

export interface WorkbenchMetadata {
  id: WorkbenchId;
  route: string;
  koreanName: string;
  englishTitle: string;
  description: string;
  figmaLightNodeId: string;
  figmaDarkNodeId: string;
  primaryAction: string;
  defaultPromptQueries: string[];
  requiredDatasetMode: DatasetMode;
  supportsRealWriteback: boolean;
  requiredPluginCategory?: string;
}

export interface CanonicalWorkbenchLineage {
  workspaceId: string;
  workbenchId: WorkbenchId;
  agentSessionId: string;
  threadId: string;
  conversationId: string;
  goalId?: string;
  planId?: string;
  actionRunId?: string;
  providerAcceptedId?: string;
  evidenceId?: string;
  readbackVerifiedId?: string;
  currentState: WorkbenchAgentLifecycleState;
  datasetMode: DatasetMode;
  timestamp: string;
}

export interface ResponsiveDockConfig {
  viewport: WorkbenchViewport;
  minWidth: number;
  maxWidth?: number;
  presentationMode: DockPresentationMode;
  dockWidthPx?: number;
  isCollapsible: boolean;
}

export const WORKBENCH_RESPONSIVE_BREAKPOINTS: Record<WorkbenchViewport, ResponsiveDockConfig> = {
  DESKTOP_1440: {
    viewport: 'DESKTOP_1440',
    minWidth: 1024,
    presentationMode: 'FIXED_DOCK',
    dockWidthPx: 384,
    isCollapsible: false,
  },
  TABLET_768: {
    viewport: 'TABLET_768',
    minWidth: 640,
    maxWidth: 1023,
    presentationMode: 'OPS_DRAWER',
    isCollapsible: true,
  },
  MOBILE_375: {
    viewport: 'MOBILE_375',
    minWidth: 0,
    maxWidth: 639,
    presentationMode: 'BOTTOM_SHEET',
    isCollapsible: true,
  },
};

/**
 * 7대 워크벤치 정본 정의
 */
export const SEVEN_SERVICE_WORKBENCHES: Record<WorkbenchId, WorkbenchMetadata> = {
  home: {
    id: 'home',
    route: '/app',
    koreanName: '홈',
    englishTitle: 'Executive Home & Mission Control',
    description: '일일 마케팅 미션, 자율 근무 진행률, 사장님 판단 대기 항목 요약',
    figmaLightNodeId: '63:2',
    figmaDarkNodeId: '64:2',
    primaryAction: '오늘의 자율 미션 점검 및 시작',
    defaultPromptQueries: ['오늘 소희가 할 일 브리핑해줘', '사장님 승인 대기 건 확인해줘'],
    requiredDatasetMode: 'ACTUAL',
    supportsRealWriteback: true,
  },
  content: {
    id: 'content',
    route: '/app/content',
    koreanName: '콘텐츠',
    englishTitle: 'Production Studio',
    description: '대기열, 기획 브리프, 시각 프리뷰, 품질 QC, 채널 발행 및 독립 재조회',
    figmaLightNodeId: '63:292',
    figmaDarkNodeId: '64:275',
    primaryAction: '콘텐츠 기획 및 채널 발행',
    defaultPromptQueries: ['이번 주 인스타 피드용 매장 대표 메뉴 카드뉴스 기획해줘', '대기 중인 네이버 블로그 포스트 검수해줘'],
    requiredDatasetMode: 'ACTUAL',
    supportsRealWriteback: true,
    requiredPluginCategory: 'publishing',
  },
  customers: {
    id: 'customers',
    route: '/app/customers',
    koreanName: '고객',
    englishTitle: 'Booking & Consultation CRM',
    description: '고객 대화, 문의 의도 분석, 예약 가예약/확정, 방문 및 서비스 매출 완결 루프',
    figmaLightNodeId: '63:582',
    figmaDarkNodeId: '64:549',
    primaryAction: '고객 문의 응대 및 예약 확정',
    defaultPromptQueries: ['어제 인스타 DM으로 가격 문의하고 예약 안 한 고객들에게 안내 보내줘', '내일 예약 고객 리마인더 발송해줘'],
    requiredDatasetMode: 'ACTUAL',
    supportsRealWriteback: true,
    requiredPluginCategory: 'messaging',
  },
  results: {
    id: 'results',
    route: '/app/results',
    koreanName: '성과',
    englishTitle: 'True Attribution & Revenue Lineage',
    description: '캠페인·콘텐츠·대화·예약·매출 전 과정의 검증된 상업적 기여도 및 증거 분석',
    figmaLightNodeId: '63:878',
    figmaDarkNodeId: '64:829',
    primaryAction: '상업적 성과 및 기여도 분석',
    defaultPromptQueries: ['지난달 실제 예약과 매출로 이어진 콘텐츠만 분석해줘', '인스타 광고와 블로그 유기적 유입 ROAS 비교해줘'],
    requiredDatasetMode: 'ACTUAL',
    supportsRealWriteback: false,
  },
  sohee: {
    id: 'sohee',
    route: '/app/sohee',
    koreanName: '나의 소희',
    englishTitle: 'Autonomy & Knowledge Control Center',
    description: '매장 지식·톤앤매너 교육, 플러그인 연결 권한, 자율 루틴 및 안심 가드레일 통제',
    figmaLightNodeId: '63:1168',
    figmaDarkNodeId: '64:1103',
    primaryAction: '지식 교육 및 자율 정책 통제',
    defaultPromptQueries: ['봄 신규 할인 서비스 가이드라인 추가해줘', '예약금 정책 변경 사항 학습해줘'],
    requiredDatasetMode: 'ACTUAL',
    supportsRealWriteback: true,
  },
  ads: {
    id: 'ads',
    route: '/app/ads',
    koreanName: '광고',
    englishTitle: 'Sohee Ad Agency',
    description: '성과 검증 유기적 콘텐츠의 유료 광고 전환, 예산 집행 한도 및 실시간 대사',
    figmaLightNodeId: '63:1448',
    figmaDarkNodeId: '64:1358',
    primaryAction: '고성과 콘텐츠 광고 부스팅',
    defaultPromptQueries: ['반응 좋은 인기 포스트 메타 스폰서드 광고로 집행 검토해줘', '이번 달 광고비 잔여 예산 확인해줘'],
    requiredDatasetMode: 'ACTUAL',
    supportsRealWriteback: true,
    requiredPluginCategory: 'advertising',
  },
  system: {
    id: 'system',
    route: '/app/system',
    koreanName: '시스템',
    englishTitle: 'Account & Trust Center',
    description: '사업자 정보, 크레딧 원장, 권한 및 데이터 보안, 서비스 건강도 진단',
    figmaLightNodeId: '63:1728',
    figmaDarkNodeId: '64:1631',
    primaryAction: '계정 및 신뢰 보안 설정',
    defaultPromptQueries: ['소희 크레딧 사용 내역과 잔액 보여줘', '연결된 SNS 채널 권한 상태 확인해줘'],
    requiredDatasetMode: 'ACTUAL',
    supportsRealWriteback: true,
  },
};

/**
 * 금지된 Figma 내부 라벨 및 테스트 패턴 목록
 * 프로덕션 화면에 Figma 내부 노드 ID나 디버그 라벨이 노출되는 것을 방지
 */
export const FORBIDDEN_UI_LABELS = [
  /Frame\s*\d+/i,
  /Node\s*\d+:\d+/i,
  /Figma/i,
  /Draft/i,
  /\[Sample\]/i,
  /\[Demo\]/i,
  /\[Test\]/i,
  /mock/i,
  /placeholder/i,
  /dummy/i,
  /Agent Energy/i,
  /10 Energy/i,
  /V0\.3/i,
  /V0\.2/i,
];

export function sanitizeProductionDisplayLabel(rawText: string): string {
  let sanitized = rawText;
  for (const forbidden of FORBIDDEN_UI_LABELS) {
    sanitized = sanitized.replace(forbidden, '').trim();
  }
  return sanitized;
}

export function resolveDockPresentationMode(viewportWidth: number): DockPresentationMode {
  if (viewportWidth >= 1024) {
    return 'FIXED_DOCK';
  }
  if (viewportWidth >= 640) {
    return 'OPS_DRAWER';
  }
  return 'BOTTOM_SHEET';
}
