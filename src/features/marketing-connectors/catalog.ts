/**
 * 마케팅 커넥터 카탈로그 (MC-02)
 *
 * 공통 계약:
 * - 11개 커넥터 선언적 정의 및 불변(immutable) 카탈로그
 * - 소셜 커넥터는 기존 연동(/app/channels) 재사용 (method: existing, readiness: available)
 * - Google/Microsoft는 설정 또는 심사 필요 (setup_required / review_required)
 * - Apple Calendar는 ICS import 방식 (setup_required)
 * - Apple Reminders는 공식 API/웹 EventKit 미지원으로 미지원 (unsupported)
 *
 * 주의: readiness: 'available'은 신규 정보 수집 가능이 아니라 기존 관리 경로 사용 가능을 의미합니다.
 */

export type ConnectorId =
  | 'gmail'
  | 'google_calendar'
  | 'apple_calendar'
  | 'apple_reminders'
  | 'google_docs'
  | 'google_sheets'
  | 'outlook_mail'
  | 'threads'
  | 'instagram'
  | 'instagram_messages'
  | 'google_drive';

export type ConnectorCategory = 'productivity' | 'social';

export type ConnectorMethod = 'oauth' | 'import' | 'existing' | 'unavailable';

export type ConnectorReadiness =
  | 'available'
  | 'setup_required'
  | 'review_required'
  | 'unsupported';

export type ConnectorDefinition = {
  id: ConnectorId;
  name: string;
  category: ConnectorCategory;
  purpose: string;
  reads: readonly string[];
  excludes: readonly string[];
  method: ConnectorMethod;
  readiness: ConnectorReadiness;
  managementHref?: string;
  aliases: readonly string[];
};

export type ConnectorStatus =
  | 'connected'
  | 'reauth_required'
  | 'disconnected'
  | 'error';

export type ConnectorConnectionSummary = {
  connectorId: ConnectorId;
  status: ConnectorStatus;
  lastSyncAt: string | null;
  capabilities: readonly string[];
};

export type ConnectorHubSnapshot = {
  workspaceId: string;
  connections: readonly ConnectorConnectionSummary[];
  storageReady: boolean;
  pendingDeletions?: readonly ConnectorId[];
};

const RAW_CATALOG: readonly ConnectorDefinition[] = [
  {
    id: 'gmail',
    name: 'Gmail',
    category: 'productivity',
    purpose: '업무 메일에서 행사·예약·공지사항 관련 내용 파악 및 마케팅 제안 도출',
    reads: ['선택한 라벨의 업무 메일 제목 및 본문 발췌'],
    excludes: ['개인 사서함 전체', '비밀번호 및 금융 데이터', '고객 개인 식별 정보'],
    method: 'oauth',
    readiness: 'review_required',
    aliases: ['지메일', '구글메일', 'gmail', 'google mail', '메일', '이메일'],
  },
  {
    id: 'google_calendar',
    name: 'Google Calendar',
    category: 'productivity',
    purpose: '매장 휴무일, 행사 일정, 프로모션 캘린더 파악 및 예약 가능 시간 연계',
    reads: ['선택한 업무 캘린더의 일정 제목, 일시, 설명'],
    excludes: ['개인 일정', '참석자 개인정보', '비공개 메모'],
    method: 'oauth',
    readiness: 'setup_required',
    aliases: ['구글 캘린더', '구글캘린더', 'google calendar', '캘린더', '일정'],
  },
  {
    id: 'apple_calendar',
    name: 'Apple Calendar',
    category: 'productivity',
    purpose: 'ICS 파일 가져오기를 통한 매장 운영 일정 및 프로모션 일정 연계',
    reads: ['가져온 ICS 파일의 일정 제목 및 일시'],
    excludes: ['iCloud 계정 자격증명', '개인 캘린더 자동 동기화'],
    method: 'import',
    readiness: 'setup_required',
    aliases: ['애플 캘린더', '아이폰 캘린더', 'apple calendar', 'ics', '캘린더'],
  },
  {
    id: 'apple_reminders',
    name: 'Apple Reminders',
    category: 'productivity',
    purpose: '미지원 (웹 EventKit 및 공식 API 미지원으로 직접 연동 불가)',
    reads: [],
    excludes: ['iCloud 계정 정보', '미리알림 전체 데이터'],
    method: 'unavailable',
    readiness: 'unsupported',
    aliases: ['애플 미리알림', '미리알림', 'apple reminders', 'reminders'],
  },
  {
    id: 'google_docs',
    name: 'Google Docs',
    category: 'productivity',
    purpose: '선택한 매장 매뉴얼, 프로모션 기획서 등 업무 문서 참조',
    reads: ['Google Picker로 사장님이 직접 선택한 문서의 텍스트'],
    excludes: ['전체 Drive 탐색', '선택되지 않은 문서'],
    method: 'oauth',
    readiness: 'review_required',
    aliases: ['구글 닥스', '구글 문서', 'google docs', '문서'],
  },
  {
    id: 'google_sheets',
    name: 'Google Sheets',
    category: 'productivity',
    purpose: '선택한 가격표, 메뉴 목록, 예약 현황 시트 데이터 참조',
    reads: ['Google Picker로 선택한 스프레드시트의 특정 시트/셀'],
    excludes: ['전체 Drive 탐색', '미선택 시트', '민감 개인정보 열'],
    method: 'oauth',
    readiness: 'setup_required',
    aliases: ['구글 시트', '구글 스프레드시트', 'google sheets', '시트', '스프레드시트'],
  },
  {
    id: 'outlook_mail',
    name: 'Outlook Mail',
    category: 'productivity',
    purpose: '업무용 Outlook 메일에서 프로모션 및 매장 운영 소식 확인',
    reads: ['선택한 업무 폴더의 메일 제목 및 본문 발췌'],
    excludes: ['개인 사서함 전체', '비밀번호 및 금융 데이터'],
    method: 'oauth',
    readiness: 'setup_required',
    aliases: ['아웃룩', 'outlook', '마이크로소프트 메일', 'ms mail', '이메일'],
  },
  {
    id: 'threads',
    name: 'Threads',
    category: 'social',
    purpose: '기존 SNS 연동을 통한 스레드 포스팅 현황 파악 및 마케팅 연계',
    reads: ['연결된 스레드 프로필 및 공개 게시글'],
    excludes: ['비공개 개인 활동', '인증 자격증명 원문'],
    method: 'existing',
    readiness: 'available',
    managementHref: '/app/channels',
    aliases: ['스레드', 'threads', '쓰레드'],
  },
  {
    id: 'instagram',
    name: 'Instagram',
    category: 'social',
    purpose: '기존 SNS 연동을 통한 인스타그램 피드/스토리 게시 현황 확인',
    reads: ['연결된 인스타그램 비즈니스 프로필 및 게시물 데이터'],
    excludes: ['개인 계정 활동', '인증 토큰 원본'],
    method: 'existing',
    readiness: 'available',
    managementHref: '/app/channels',
    aliases: ['인스타그램', '인스타', 'instagram', 'insta'],
  },
  {
    id: 'instagram_messages',
    name: 'Instagram Messages',
    category: 'social',
    purpose: '기존 SNS 연동을 통한 고객 반복 문의 분석 및 FAQ/예약 제안',
    reads: ['권한이 확인된 비즈니스 DM 대화 내역 발췌'],
    excludes: ['개인 DM', '고객 개인식별정보 원문 장기 저장', '인증 토큰'],
    method: 'existing',
    readiness: 'available',
    managementHref: '/app/channels',
    aliases: ['인스타 디엠', '인스타그램 메시지', 'instagram messages', '인스타 메시지', 'dm', '디엠'],
  },
  {
    id: 'google_drive',
    name: 'Google Drive',
    category: 'productivity',
    purpose: 'Google Picker를 통한 업무 파일 선택 및 권한 확인',
    reads: ['선택한 파일 메타데이터 및 내용 발췌'],
    excludes: ['드라이브 전체 스캔', '개인 폴더'],
    method: 'oauth',
    readiness: 'review_required',
    aliases: ['구글 드라이브', 'google drive', '드라이브'],
  },
];

/**
 * 불변(immutable) 카탈로그
 */
export const CONNECTOR_CATALOG: readonly ConnectorDefinition[] = Object.freeze(
  RAW_CATALOG.map((item) =>
    Object.freeze({
      ...item,
      reads: Object.freeze([...item.reads]),
      excludes: Object.freeze([...item.excludes]),
      aliases: Object.freeze([...item.aliases]),
    })
  )
);

/**
 * 커넥터 정의 조회 (런타임 fail-closed)
 */
export function getConnectorDefinition(id: string): ConnectorDefinition | undefined {
  if (typeof id !== 'string' || !id) {
    return undefined;
  }
  return CONNECTOR_CATALOG.find((connector) => connector.id === id);
}
