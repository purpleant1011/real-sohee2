/**
 * Apple 미리 알림(Reminders) 공식 지원 게이트 (MC/A04 - ANI-2173)
 *
 * 주요 보안 및 정책 원칙:
 * 1. Apple EventKit은 macOS/iOS 네이티브 전용 프레임워크이며 웹 브라우저/서버 REST API를 지원하지 않음.
 * 2. 비공식 iCloud 웹 스크래핑 및 Apple ID/비밀번호 수집 시도는 계정 보안 및 이용약관 위반 위험으로 절대 금지 (Fail-Closed).
 * 3. 현 단계에서는 `unsupported` 상태로 정직하게 종결 처리하며, 어떠한 가상 연결 레코드도 생성하지 않음.
 */

export const APPLE_REMINDERS_READINESS = 'unsupported' as const;
export const APPLE_REMINDERS_REASON = 'OFFICIAL_WEB_API_UNAVAILABLE' as const;

export type AppleRemindersSupportStatus = {
  readonly connectorId: 'apple_reminders';
  readonly providerId: 'apple';
  readonly readiness: typeof APPLE_REMINDERS_READINESS;
  readonly reason: typeof APPLE_REMINDERS_REASON;
  readonly canConnect: false;
  readonly message: string;
  readonly alternatives: {
    readonly icloudScraping: 'PROHIBITED';
    readonly appleShortcutsExport: 'UNDER_EVALUATION';
    readonly nativeCompanionApp: 'FUTURE_CONSIDERATION';
  };
};

export class AppleRemindersUnsupportedError extends Error {
  readonly code = 'REMINDERS_NOT_SUPPORTED' as const;

  constructor(
    message = 'Apple 미리 알림(Reminders)은 공식 웹 API 부재로 연결을 지원하지 않습니다.'
  ) {
    super(message);
    this.name = 'AppleRemindersUnsupportedError';
  }
}

/**
 * Apple Reminders의 현재 지원 상태 및 타당성 조사 결과를 반환합니다.
 */
export function getAppleRemindersSupportStatus(): AppleRemindersSupportStatus {
  return Object.freeze({
    connectorId: 'apple_reminders',
    providerId: 'apple',
    readiness: APPLE_REMINDERS_READINESS,
    reason: APPLE_REMINDERS_REASON,
    canConnect: false,
    message:
      'Apple Reminders는 공식 웹 REST API 및 웹 EventKit이 부재하여 현재 연결을 지원하지 않습니다. 비공식 iCloud 스크래핑 및 계정 정보 수집은 엄격히 금지됩니다.',
    alternatives: Object.freeze({
      icloudScraping: 'PROHIBITED' as const,
      appleShortcutsExport: 'UNDER_EVALUATION' as const,
      nativeCompanionApp: 'FUTURE_CONSIDERATION' as const,
    }),
  });
}

/**
 * Apple Reminders 연결 시도를 원천 차단하고 fail-closed 예외를 발생시킵니다.
 *
 * @param _attempt 연결 시도 payload (존재 여부와 관계없이 예외 발생)
 * @throws {AppleRemindersUnsupportedError} 항상 REMINDERS_NOT_SUPPORTED 예외 송출
 */
export function validateRemindersConnectAttempt(_attempt?: unknown): never {
  void _attempt;
  throw new AppleRemindersUnsupportedError(
    'Apple 미리 알림(Reminders) 연결 시도가 거부되었습니다. 공식 웹 API가 부재하며 보안 규정에 따라 연결이 비활성화되어 있습니다.'
  );
}
