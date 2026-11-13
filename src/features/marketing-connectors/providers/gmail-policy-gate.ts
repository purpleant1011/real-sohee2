/**
 * Gmail 업무 읽기 전용 OAuth 정책 게이트 (ANI-2165 / MC-M01)
 *
 * Google Restricted Scope 보안 원칙:
 * 1. 발송/답장/삭제/수정 등 비인가 쓰기 scope를 원천 차단
 * 2. 오직 읽기 전용 scope (gmail.readonly) 단일 scope만 허용
 * 3. 빈 scope 또는 미인가 scope 포함 시 fail-closed 예외 송출
 */

export const GMAIL_READONLY_SCOPE =
  'https://www.googleapis.com/auth/gmail.readonly' as const;

export const PROHIBITED_GMAIL_SCOPES = [
  'https://mail.google.com/',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.compose',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.labels',
  'https://www.googleapis.com/auth/gmail.insert',
  'https://www.googleapis.com/auth/gmail.settings.basic',
  'https://www.googleapis.com/auth/gmail.settings.sharing',
] as const;

export type GmailPolicyErrorCode = 'MISSING_SCOPE' | 'PROHIBITED_SCOPE';

export class GmailPolicyViolationError extends Error {
  readonly code: GmailPolicyErrorCode;
  readonly scope?: string;

  constructor(code: GmailPolicyErrorCode, message: string, scope?: string) {
    super(message);
    this.name = 'GmailPolicyViolationError';
    this.code = code;
    this.scope = scope;
  }
}

/**
 * 요청된 Gmail OAuth scope 목록을 검증하여 읽기 전용 scope만 엄격히 허용합니다.
 *
 * @param requestedScopes 요청된 scope 문자열 배열
 * @returns 검증된 읽기 전용 scope 불변 배열
 * @throws {GmailPolicyViolationError} 빈 scope 또는 허용되지 않은 scope 포함 시
 */
export function validateGmailScopeRequest(
  requestedScopes: readonly string[]
): readonly string[] {
  if (!requestedScopes || !Array.isArray(requestedScopes) || requestedScopes.length === 0) {
    throw new GmailPolicyViolationError(
      'MISSING_SCOPE',
      '요청된 Gmail OAuth scope 목록이 비어 있습니다.'
    );
  }

  const cleanedScopes = requestedScopes
    .map((s) => (typeof s === 'string' ? s.trim() : ''))
    .filter((s) => s.length > 0);

  if (cleanedScopes.length === 0) {
    throw new GmailPolicyViolationError(
      'MISSING_SCOPE',
      '유효한 Gmail OAuth scope가 제공되지 않았습니다.'
    );
  }

  for (const scope of cleanedScopes) {
    // 허용된 유일한 scope 대조
    if (scope !== GMAIL_READONLY_SCOPE) {
      throw new GmailPolicyViolationError(
        'PROHIBITED_SCOPE',
        `비인가 또는 쓰기 권한이 포함된 Gmail scope는 허용되지 않습니다: ${scope}`,
        scope
      );
    }
  }

  return Object.freeze([GMAIL_READONLY_SCOPE]);
}
