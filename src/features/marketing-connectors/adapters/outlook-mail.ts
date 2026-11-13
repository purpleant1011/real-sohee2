import 'server-only';

import { truncateToCodePoints } from './google-adapter-common';

export const MAX_BODY_PREVIEW_CHARS = 5000;
export const DEFAULT_OUTLOOK_TIMEOUT_MS = 15000;

export type OutlookErrorCode =
  | 'INVALID_CREDENTIALS'
  | 'ACCESS_DENIED'
  | 'NOT_FOUND'
  | 'RATE_LIMITED'
  | 'INVALID_INPUT'
  | 'INVALID_GRAPH_URL'
  | 'TIMEOUT'
  | 'SERVER_ERROR'
  | 'INVALID_JSON'
  | 'UNEXPECTED_ERROR';

export class OutlookError extends Error {
  readonly code: OutlookErrorCode;
  readonly status?: number;
  readonly retryAfterMs?: number;

  constructor(
    code: OutlookErrorCode,
    message: string,
    status?: number,
    retryAfterMs?: number
  ) {
    super(`[${code}] ${message}`);
    this.name = 'OutlookError';
    this.code = code;
    this.status = status;
    this.retryAfterMs = retryAfterMs;
    Object.setPrototypeOf(this, OutlookError.prototype);
  }
}

export interface OutlookGateway {
  readonly fetch?: typeof fetch;
}

export interface FetchOutlookDeltaInput {
  readonly accessToken: string;
  readonly folderId?: string;
  readonly deltaLink?: string;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
}

export interface OutlookMessageItem {
  readonly id: string;
  readonly subject: string;
  readonly from: string;
  readonly senderName?: string;
  readonly senderEmailMasked?: string;
  readonly receivedDateTime: string;
  readonly bodyPreview: string;
  readonly isRemoved: boolean;
}

export interface OutlookDeltaResult {
  readonly messages: readonly OutlookMessageItem[];
  readonly nextLink?: string;
  readonly deltaLink?: string;
  readonly removedMessageIds: readonly string[];
}

/**
 * Microsoft Graph URL SSRF 검증 가드
 * - protocol: 반드시 https:
 * - hostname: graph.microsoft.com 엄격 일치
 * - port: 기본 포트 (443 또는 없음)
 * - pathname: /v1.0/ 또는 /beta/ 경로로 시작
 */
export function validateGraphUrl(urlString: string): string {
  if (!urlString || typeof urlString !== 'string') {
    throw new OutlookError(
      'INVALID_GRAPH_URL',
      'Graph URL must be a non-empty string'
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(urlString);
  } catch {
    throw new OutlookError(
      'INVALID_GRAPH_URL',
      `Malformed Graph URL: ${urlString}`
    );
  }

  if (parsed.protocol !== 'https:') {
    throw new OutlookError(
      'INVALID_GRAPH_URL',
      `Insecure protocol for Graph URL: ${parsed.protocol}`
    );
  }

  if (parsed.hostname.toLowerCase() !== 'graph.microsoft.com') {
    throw new OutlookError(
      'INVALID_GRAPH_URL',
      `Untrusted host for Graph API: ${parsed.hostname}`
    );
  }

  if (parsed.port && parsed.port !== '443') {
    throw new OutlookError(
      'INVALID_GRAPH_URL',
      `Non-standard port for Graph API: ${parsed.port}`
    );
  }

  const pathname = parsed.pathname;
  if (!pathname.startsWith('/v1.0/') && !pathname.startsWith('/beta/')) {
    throw new OutlookError(
      'INVALID_GRAPH_URL',
      `Invalid Graph API path: ${pathname}`
    );
  }

  return urlString;
}

/**
 * 이메일 마스킹 (PII 보호)
 */
export function maskEmail(email: string): string {
  const atIdx = email.indexOf('@');
  if (atIdx === -1) {
    return email.length <= 2 ? '*'.repeat(email.length) : `${email[0]}***${email[email.length - 1]}`;
  }

  const user = email.slice(0, atIdx);
  const domain = email.slice(atIdx);

  let maskedUser: string;
  if (user.length <= 1) {
    maskedUser = '*';
  } else if (user.length === 2) {
    maskedUser = `${user[0]}*`;
  } else {
    maskedUser = `${user[0]}***${user[user.length - 1]}`;
  }

  return `${maskedUser}${domain}`;
}

/**
 * Outlook 발신자(From) 파싱 및 PII 마스킹
 */
export function parseOutlookFrom(fromInput: any): {
  from: string;
  senderName?: string;
  senderEmailMasked?: string;
} {
  if (!fromInput) {
    return { from: '알 수 없음' };
  }

  // Graph 객체 형태: { emailAddress: { name: "...", address: "..." } }
  if (typeof fromInput === 'object' && fromInput.emailAddress) {
    const rawName = (fromInput.emailAddress.name || '').trim();
    const rawAddress = (fromInput.emailAddress.address || '').trim();
    const maskedEmail = rawAddress ? maskEmail(rawAddress) : undefined;

    if (rawName.length > 0) {
      return {
        from: rawName,
        senderName: rawName,
        senderEmailMasked: maskedEmail,
      };
    }

    if (maskedEmail) {
      return {
        from: maskedEmail,
        senderEmailMasked: maskedEmail,
      };
    }

    return { from: '알 수 없음' };
  }

  // 문자열 형태: "홍길동 <email@test.com>" 또는 "email@test.com"
  if (typeof fromInput === 'string') {
    const trimmed = fromInput.trim();
    if (!trimmed) {
      return { from: '알 수 없음' };
    }

    const angleMatch = /(.*?)\s*<([^>]+)>/i.exec(trimmed);
    if (angleMatch) {
      let rawName = angleMatch[1].trim();
      const rawEmail = angleMatch[2].trim();

      if (
        (rawName.startsWith('"') && rawName.endsWith('"')) ||
        (rawName.startsWith("'") && rawName.endsWith("'"))
      ) {
        rawName = rawName.slice(1, -1).trim();
      }

      const masked = maskEmail(rawEmail);
      if (rawName.length > 0) {
        return {
          from: rawName,
          senderName: rawName,
          senderEmailMasked: masked,
        };
      }
      return {
        from: masked,
        senderEmailMasked: masked,
      };
    }

    if (trimmed.includes('@')) {
      const masked = maskEmail(trimmed);
      return {
        from: masked,
        senderEmailMasked: masked,
      };
    }

    return { from: trimmed };
  }

  return { from: '알 수 없음' };
}

/**
 * HTML 엔티티 디코딩 및 태그 제거
 */
export function cleanOutlookBodyPreview(raw: string): string {
  if (!raw || typeof raw !== 'string') {
    return '';
  }

  // script 및 style 제거
  let text = raw.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  text = text.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');

  // HTML 태그 제거
  text = text.replace(/<[^>]+>/g, ' ');

  // 일반적인 HTML 엔티티 변환
  text = text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');

  // 다중 공백 정리
  text = text.replace(/\s+/g, ' ').trim();

  // 5,000자 절삭 (surrogate pair 안전)
  const truncated = truncateToCodePoints(text, MAX_BODY_PREVIEW_CHARS);
  return truncated.text;
}

/**
 * HTTP 응답 에러 핸들러
 */
async function handleHttpError(response: Response): Promise<never> {
  const status = response.status;

  if (status === 401) {
    throw new OutlookError(
      'INVALID_CREDENTIALS',
      'Microsoft Graph API token is invalid or expired',
      401
    );
  }

  if (status === 403) {
    throw new OutlookError(
      'ACCESS_DENIED',
      'Microsoft Graph API access denied or Mail.Read scope missing',
      403
    );
  }

  if (status === 404) {
    throw new OutlookError(
      'NOT_FOUND',
      'Requested Outlook folder or messages not found',
      404
    );
  }

  if (status === 429) {
    let retryAfterMs: number | undefined;
    const retryHeader = response.headers?.get('Retry-After');
    if (retryHeader) {
      const parsedSeconds = Number(retryHeader);
      if (Number.isFinite(parsedSeconds) && parsedSeconds > 0) {
        retryAfterMs = parsedSeconds * 1000;
      }
    }
    throw new OutlookError(
      'RATE_LIMITED',
      'Microsoft Graph API rate limit exceeded',
      429,
      retryAfterMs
    );
  }

  if (status >= 500 && status < 600) {
    throw new OutlookError(
      'SERVER_ERROR',
      `Microsoft Graph API server error (HTTP ${status})`,
      status
    );
  }

  let detail = '';
  try {
    const errJson = (await response.json()) as { error?: { message?: string } };
    if (errJson?.error?.message) {
      detail = `: ${errJson.error.message}`;
    }
  } catch {
    // ignore
  }

  throw new OutlookError(
    'UNEXPECTED_ERROR',
    `Microsoft Graph API request failed with status ${status}${detail}`,
    status
  );
}

/**
 * Microsoft Graph API /me/mailFolders/{folderId}/messages/delta 증분 메시지 읽기 어댑터
 */
export async function fetchOutlookDeltaMessages(
  input: FetchOutlookDeltaInput,
  gateway?: OutlookGateway
): Promise<OutlookDeltaResult> {
  const {
    accessToken,
    folderId = 'inbox',
    deltaLink,
    timeoutMs = DEFAULT_OUTLOOK_TIMEOUT_MS,
    signal,
  } = input;

  if (!accessToken || typeof accessToken !== 'string') {
    throw new OutlookError('INVALID_INPUT', 'Access token is required');
  }

  let requestUrl: string;
  if (deltaLink) {
    requestUrl = validateGraphUrl(deltaLink);
  } else {
    const safeFolderId = encodeURIComponent(folderId.trim() || 'inbox');
    requestUrl = `https://graph.microsoft.com/v1.0/me/mailFolders/${safeFolderId}/messages/delta`;
    validateGraphUrl(requestUrl);
  }

  const fetchFn = gateway?.fetch ?? fetch;

  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;

  if (timeoutMs > 0) {
    timer = setTimeout(() => {
      controller.abort();
    }, timeoutMs);
  }

  const handleAbort = () => {
    controller.abort();
  };

  if (signal) {
    if (signal.aborted) {
      controller.abort();
    } else {
      signal.addEventListener('abort', handleAbort, { once: true });
    }
  }

  let response: Response;
  try {
    response = await fetchFn(requestUrl, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
      signal: controller.signal,
    });
  } catch (err: any) {
    if (err?.name === 'AbortError' || controller.signal.aborted) {
      throw new OutlookError('TIMEOUT', `Request timed out after ${timeoutMs}ms`);
    }
    throw new OutlookError(
      'UNEXPECTED_ERROR',
      `Network or fetch error: ${err?.message || 'unknown'}`
    );
  } finally {
    if (timer) clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', handleAbort);
  }

  if (!response.ok) {
    await handleHttpError(response);
  }

  let data: any;
  try {
    data = await response.json();
  } catch {
    throw new OutlookError('INVALID_JSON', 'Failed to parse Microsoft Graph API JSON response');
  }

  const rawNextLink = data['@odata.nextLink'];
  const rawDeltaLink = data['@odata.deltaLink'];

  const nextLink = rawNextLink ? validateGraphUrl(rawNextLink) : undefined;
  const deltaLinkResult = rawDeltaLink ? validateGraphUrl(rawDeltaLink) : undefined;

  const rawValues = Array.isArray(data.value) ? data.value : [];
  const messages: OutlookMessageItem[] = [];
  const removedMessageIds: string[] = [];

  for (const item of rawValues) {
    const id = item.id || '';
    const isRemoved = Boolean(item['@removed']);

    if (isRemoved) {
      if (id) {
        removedMessageIds.push(id);
      }
      messages.push({
        id,
        subject: item.subject || '',
        from: '',
        receivedDateTime: item.receivedDateTime || '',
        bodyPreview: '',
        isRemoved: true,
      });
      continue;
    }

    const { from, senderName, senderEmailMasked } = parseOutlookFrom(item.from);
    const cleanedPreview = cleanOutlookBodyPreview(item.bodyPreview || '');

    messages.push({
      id,
      subject: item.subject || '(제목 없음)',
      from,
      senderName,
      senderEmailMasked,
      receivedDateTime: item.receivedDateTime || '',
      bodyPreview: cleanedPreview,
      isRemoved: false,
    });
  }

  return {
    messages,
    nextLink,
    deltaLink: deltaLinkResult,
    removedMessageIds,
  };
}
