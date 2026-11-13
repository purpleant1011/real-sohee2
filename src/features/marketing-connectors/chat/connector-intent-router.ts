/**
 * 대화의 연결 요청 -> 안전한 공급자 상세·자료 선택 deeplink 라우터 (MC/C01, ANI-2184)
 *
 * 핵심 보안 및 동작 원칙:
 * 1. 11개 커넥터 키워드 매칭 (Google/Apple/Microsoft/Meta).
 * 2. 자연어 권한 우회 원천 차단: 대화 텍스트만으로 scope 동의나 연결 완료를 절대 대체하지 않음.
 * 3. 안전한 딥링크 보장: 임의 외부 URL이나 다른 테넌트 경로를 차단하고 오직 내부 `/app/connectors?open=${connectorId}` 안전 딥링크만 생성.
 * 4. 정직한 지원 상태 안내: 미지원(Apple Reminders), 심사 준비 중(Gmail, Docs, Drive)인 경우 명확한 상태 안내.
 */

import {
  CONNECTOR_CATALOG,
  getConnectorDefinition,
  type ConnectorId,
} from '../catalog';

export interface IntentContext {
  readonly workspaceId?: string;
  readonly currentPath?: string;
  readonly preferModal?: boolean;
  readonly defaultActionType?: 'open_modal' | 'navigate';
  readonly preferredCalendar?: 'google_calendar' | 'apple_calendar';
  readonly preferredMail?: 'gmail' | 'outlook_mail';
  readonly connectedConnectorIds?: readonly ConnectorId[];
}

export interface ConnectorIntentResult {
  readonly isConnectorIntent: boolean;
  readonly matchedConnectorId?: ConnectorId;
  readonly actionType?: 'open_modal' | 'navigate';
  readonly targetHref?: string;
  readonly guidanceMessage?: string;
}

const NEGATION_PATTERN =
  /(?:하지\s*마|말아\s*줘|(?:^|\s)안\s*(?:할|해|올려|보여|연결|연동)|취소|필요\s*없)/;
const CONNECTOR_ACTION_PATTERN =
  /(?:연동|연결|동기화|가져오|확인|제안|보고|참조|불러오|모달|열어|등록|설정|추가|가자|이동|선택|스프레드시트|ics)/i;

const BYPASS_ATTEMPT_PATTERN =
  /(?:내가\s*권한|권한\s*줄|동의할\s*테|비밀번호|패스워드|password|자격증명|바로\s*(?:연결|연동)\s*완료|대화로\s*(?:동의|연결))/i;

const NAVIGATE_PATTERN = /(?:이동|가줘|페이지|화면으로)/;
const MODAL_PATTERN = /(?:모달|상세|팝업)/;

const KOREAN_CONNECTOR_NAMES: Record<ConnectorId, string> = {
  gmail: 'Gmail',
  google_calendar: '구글 캘린더',
  apple_calendar: '애플 캘린더',
  apple_reminders: '애플 미리알림',
  google_docs: '구글 문서',
  google_sheets: '구글 시트',
  outlook_mail: 'Outlook 메일',
  threads: '스레드',
  instagram: '인스타그램',
  instagram_messages: '인스타그램 메시지',
  google_drive: '구글 드라이브',
};

const VALID_CONNECTOR_IDS = new Set<ConnectorId>(
  CONNECTOR_CATALOG.map((c) => c.id)
);

/**
 * 대화 입력 텍스트로부터 커넥터 연결 의도를 안전하게 분석하고 정식 딥링크 및 안내를 생성합니다.
 */
export function routeConnectorIntent(
  messageText: string,
  context?: IntentContext
): ConnectorIntentResult {
  if (typeof messageText !== 'string') {
    return { isConnectorIntent: false };
  }

  const trimmed = messageText.trim();
  if (!trimmed || trimmed.length > 1000) {
    return { isConnectorIntent: false };
  }

  // 부정 또는 거부 발화는 연결 인텐트 제외
  if (NEGATION_PATTERN.test(trimmed)) {
    return { isConnectorIntent: false };
  }

  const matchedId = detectConnectorId(trimmed, context);
  if (!matchedId || !VALID_CONNECTOR_IDS.has(matchedId)) {
    return { isConnectorIntent: false };
  }

  // 액션 타입 결정
  let actionType: 'open_modal' | 'navigate' = 'open_modal';
  if (context?.defaultActionType) {
    actionType = context.defaultActionType;
  } else if (MODAL_PATTERN.test(trimmed)) {
    actionType = 'open_modal';
  } else if (NAVIGATE_PATTERN.test(trimmed)) {
    actionType = 'navigate';
  } else if (context?.preferModal !== undefined) {
    actionType = context.preferModal ? 'open_modal' : 'navigate';
  }

  // 엄격한 내부 안전 딥링크 생성 (외부 URL 주입 원천 차단)
  const targetHref = `/app/connectors?open=${encodeURIComponent(matchedId)}`;

  // 상태 및 보안 상황별 정직한 안내 메시지 생성
  const guidanceMessage = buildGuidanceMessage(matchedId, trimmed);

  return {
    isConnectorIntent: true,
    matchedConnectorId: matchedId,
    actionType,
    targetHref,
    guidanceMessage,
  };
}

function detectConnectorId(
  text: string,
  context?: IntentContext
): ConnectorId | null {
  const lower = text.toLowerCase();

  // 1. 애플 미리알림 (최우선 판별: 미지원 안내 필요)
  if (/(?:애플\s*미리알림|미리알림|apple\s*reminders|reminders)/i.test(lower)) {
    return 'apple_reminders';
  }

  // 2. 인스타그램 메시지 / DM
  if (
    /(?:인스타\s*(?:디엠|dm)|인스타그램\s*(?:디엠|dm|메시지)|(?:디엠|dm)\s*(?:연결|연동))/i.test(
      lower
    )
  ) {
    return 'instagram_messages';
  }

  // 3. 인스타그램 일반
  if (/(?:인스타그램|인스타|instagram|insta)/i.test(lower)) {
    if (CONNECTOR_ACTION_PATTERN.test(lower)) {
      return 'instagram';
    }
  }

  // 4. 스레드
  if (/(?:스레드|쓰레드|threads)/i.test(lower)) {
    if (CONNECTOR_ACTION_PATTERN.test(lower)) {
      return 'threads';
    }
  }

  // 5. 구글 드라이브
  if (/(?:구글\s*드라이브|google\s*drive)/i.test(lower)) {
    return 'google_drive';
  }

  // 6. 구글 시트 / 스프레드시트
  if (/(?:구글\s*시트|구글\s*스프레드시트|스프레드시트|google\s*sheets|시트)/i.test(lower)) {
    if (CONNECTOR_ACTION_PATTERN.test(lower)) {
      return 'google_sheets';
    }
  }

  // 7. 구글 문서 / 닥스
  if (/(?:구글\s*닥스|구글\s*문서|google\s*docs|docs|닥스)/i.test(lower)) {
    if (CONNECTOR_ACTION_PATTERN.test(lower)) {
      return 'google_docs';
    }
  }

  // 8. 명시적 애플 캘린더 / ICS
  if (/(?:애플\s*캘린더|아이폰\s*캘린더|apple\s*calendar|ics)/i.test(lower)) {
    return 'apple_calendar';
  }

  // 9. 명시적 구글 캘린더
  if (/(?:구글\s*캘린더|google\s*calendar)/i.test(lower)) {
    return 'google_calendar';
  }

  // 10. 일반 캘린더 / 일정
  if (/(?:캘린더|일정)/i.test(lower)) {
    if (CONNECTOR_ACTION_PATTERN.test(lower)) {
      if (context?.preferredCalendar) {
        return context.preferredCalendar;
      }
      if (
        context?.connectedConnectorIds?.includes('apple_calendar') &&
        !context?.connectedConnectorIds?.includes('google_calendar')
      ) {
        return 'apple_calendar';
      }
      return 'google_calendar';
    }
  }

  // 11. 명시적 아웃룩 메일
  if (/(?:아웃룩|outlook|ms\s*mail|마이크로소프트\s*메일)/i.test(lower)) {
    return 'outlook_mail';
  }

  // 12. 명시적 지메일
  if (/(?:지메일|구글\s*메일|gmail|google\s*mail)/i.test(lower)) {
    return 'gmail';
  }

  // 13. 일반 메일
  if (/(?:메일|이메일)/i.test(lower)) {
    if (CONNECTOR_ACTION_PATTERN.test(lower)) {
      if (context?.preferredMail) {
        return context.preferredMail;
      }
      if (
        context?.connectedConnectorIds?.includes('outlook_mail') &&
        !context?.connectedConnectorIds?.includes('gmail')
      ) {
        return 'outlook_mail';
      }
      return 'gmail';
    }
  }

  return null;
}

function buildGuidanceMessage(connectorId: ConnectorId, rawText: string): string {
  const isBypassAttempt = BYPASS_ATTEMPT_PATTERN.test(rawText);
  const bypassWarning = isBypassAttempt
    ? '대화창에서는 직접 권한 동의나 자격증명 전달을 통한 연결을 처리할 수 없어요. 안전한 정식 연동을 위해 화면에서 직접 권한을 승인해 주세요. '
    : '';

  const def = getConnectorDefinition(connectorId);
  const connectorName = KOREAN_CONNECTOR_NAMES[connectorId] ?? def?.name ?? connectorId;

  // 1. 미지원 (unsupported)
  if (def?.readiness === 'unsupported' || connectorId === 'apple_reminders') {
    return `${connectorName}은(는) 웹 EventKit 및 공식 API 미지원으로 현재 직접 연동을 지원하지 않습니다. 캘린더나 파일 연동을 대안으로 활용하실 수 있어요.`;
  }

  // 2. 심사 준비 중 (review_required)
  if (def?.readiness === 'review_required') {
    return `${bypassWarning}${connectorName} 연동은 현재 보안 및 앱 심사 준비 중이에요. 심사 완료 후 공식 이용하실 수 있도록 준비 중이며, 커넥터 상세 모달에서 준비 상황을 확인하실 수 있어요.`;
  }

  // 3. 설정 필요 (setup_required)
  if (def?.readiness === 'setup_required') {
    if (connectorId === 'apple_calendar') {
      return `${bypassWarning}${connectorName} 연동을 위해 ICS 파일 가져오기 모달로 안내해 드릴게요. 매장 일정 파일을 직접 업로드해 주세요.`;
    }
    return `${bypassWarning}${connectorName} 연동을 위해 상세 설정 화면으로 안내해 드릴게요. 필요한 권한과 자료를 직접 선택해 주세요.`;
  }

  // 4. 연동 가능 (available - existing SNS channels 등)
  return `${bypassWarning}${connectorName} 연동 상태 확인 및 관리를 위해 커넥터 화면으로 안내해 드릴게요.`;
}
