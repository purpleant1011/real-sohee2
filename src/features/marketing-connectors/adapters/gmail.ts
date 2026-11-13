import 'server-only';

import { truncateToCodePoints } from './google-adapter-common';

export const DEFAULT_MAX_MESSAGES = 20;
export const MAX_MESSAGES_LIMIT = 100;
export const DEFAULT_NEWER_THAN_DAYS = 30;
export const MAX_BODY_CHARS = 5000;
export const DEFAULT_GMAIL_TIMEOUT_MS = 15000;

export type GmailErrorCode =
  | 'INVALID_CREDENTIALS'
  | 'ACCESS_DENIED'
  | 'NOT_FOUND'
  | 'HISTORY_EXPIRED'
  | 'RATE_LIMITED'
  | 'INVALID_INPUT'
  | 'TIMEOUT'
  | 'SERVER_ERROR'
  | 'INVALID_JSON'
  | 'UNEXPECTED_ERROR';

export class GmailError extends Error {
  readonly code: GmailErrorCode;
  readonly status?: number;
  readonly retryAfterMs?: number;

  constructor(
    code: GmailErrorCode,
    message: string,
    status?: number,
    retryAfterMs?: number
  ) {
    super(message);
    this.name = 'GmailError';
    this.code = code;
    this.status = status;
    this.retryAfterMs = retryAfterMs;
    Object.setPrototypeOf(this, GmailError.prototype);
  }
}

export interface GmailGateway {
  readonly fetch?: typeof fetch;
}

export interface FetchGmailInput {
  readonly accessToken: string;
  readonly labelId?: string;
  readonly query?: string;
  readonly maxMessages?: number;
  readonly newerThanDays?: number;
  readonly pageToken?: string;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
}

export interface FetchGmailHistoryInput {
  readonly accessToken: string;
  readonly startHistoryId: string;
  readonly labelId?: string;
  readonly maxResults?: number;
  readonly pageToken?: string;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
}

export interface GmailMessageItem {
  readonly id: string;
  readonly threadId: string;
  readonly historyId?: string;
  readonly subject: string;
  readonly from: string; // 이름만 추출 (없으면 마스킹된 이메일)
  readonly senderName?: string;
  readonly senderEmailMasked?: string;
  readonly date: string;
  readonly internalDate: string;
  readonly snippet?: string;
  readonly bodyText: string;
  readonly charCount: number;
  readonly truncated: boolean;
  readonly labelIds: readonly string[];
}

export interface GmailMessagesResult {
  readonly messages: readonly GmailMessageItem[];
  readonly nextPageToken?: string;
  readonly resultSizeEstimate?: number;
  readonly latestHistoryId?: string;
  readonly warnings: readonly string[];
  readonly derivedFromGoogle: true;
}

export interface GmailHistoryItem {
  readonly id: string;
  readonly messages?: readonly { id: string; threadId?: string }[];
  readonly messagesAdded?: readonly {
    message: { id: string; threadId?: string; labelIds?: string[] };
  }[];
  readonly messagesDeleted?: readonly {
    message: { id: string; threadId?: string };
  }[];
  readonly labelsAdded?: readonly {
    message: { id: string; threadId?: string };
    labelIds: string[];
  }[];
  readonly labelsRemoved?: readonly {
    message: { id: string; threadId?: string };
    labelIds: string[];
  }[];
}

export interface GmailHistoryResult {
  readonly historyId: string;
  readonly history: readonly GmailHistoryItem[];
  readonly addedMessageIds: readonly string[];
  readonly deletedMessageIds: readonly string[];
  readonly nextPageToken?: string;
  readonly derivedFromGoogle: true;
}

export interface GmailMessageHeader {
  name: string;
  value: string;
}

export interface GmailMessagePartBody {
  attachmentId?: string;
  size?: number;
  data?: string;
}

export interface GmailMessagePayload {
  partId?: string;
  mimeType?: string;
  filename?: string;
  headers?: GmailMessageHeader[];
  body?: GmailMessagePartBody;
  parts?: GmailMessagePayload[];
}

/**
 * 쿼리 파라미터 빌더
 * 필수 라벨 및 기간(최대 30일 이내)을 안전하게 강제
 */
export function buildGmailQuery(options: {
  labelId?: string;
  newerThanDays?: number;
  query?: string;
}): string {
  const parts: string[] = [];

  if (options.labelId && options.labelId.trim().length > 0) {
    parts.push(`label:${options.labelId.trim()}`);
  }

  const days = options.newerThanDays ?? DEFAULT_NEWER_THAN_DAYS;
  parts.push(`newer_than:${days}d`);

  if (options.query && options.query.trim().length > 0) {
    parts.push(options.query.trim());
  }

  return parts.join(' ');
}

/**
 * 이메일 주소 마스킹 함수
 * e.g. gildong@example.com -> g***g@example.com
 */
function maskEmail(email: string): string {
  const atIndex = email.indexOf('@');
  if (atIndex === -1) {
    if (email.length <= 2) return '*'.repeat(email.length);
    return `${email[0]}***${email[email.length - 1]}`;
  }

  const user = email.slice(0, atIndex);
  const domain = email.slice(atIndex);

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
 * From 헤더 파싱: 이름만 추출 및 이메일 주소 마스킹
 */
export function parseFromHeader(fromHeader: string): {
  from: string;
  senderName?: string;
  senderEmailMasked?: string;
} {
  if (!fromHeader || typeof fromHeader !== 'string') {
    return { from: '알 수 없음' };
  }

  const trimmed = fromHeader.trim();
  if (!trimmed) {
    return { from: '알 수 없음' };
  }

  // 매칭: "이름" <email@domain.com> 또는 이름 <email@domain.com>
  const angleMatch = /(.*?)\s*<([^>]+)>/i.exec(trimmed);
  if (angleMatch) {
    let rawName = angleMatch[1].trim();
    const rawEmail = angleMatch[2].trim();

    // 양쪽 따옴표 제거
    if (
      (rawName.startsWith('"') && rawName.endsWith('"')) ||
      (rawName.startsWith("'") && rawName.endsWith("'"))
    ) {
      rawName = rawName.slice(1, -1).trim();
    }

    const maskedEmail = maskEmail(rawEmail);

    if (rawName.length > 0) {
      return {
        from: rawName,
        senderName: rawName,
        senderEmailMasked: maskedEmail,
      };
    }

    return {
      from: maskedEmail,
      senderEmailMasked: maskedEmail,
    };
  }

  // <email> 형태 없이 이메일만 있는 경우
  if (trimmed.includes('@')) {
    const masked = maskEmail(trimmed);
    return {
      from: masked,
      senderEmailMasked: masked,
    };
  }

  return { from: trimmed };
}

/**
 * HTML 문자열 디코딩 및 태그/스크립트 제거
 */
function cleanHtml(html: string): string {
  // script 태그 및 내부 내용 제거
  let text = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  // style 태그 및 내부 내용 제거
  text = text.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');
  // HTML 태그 제거
  text = text.replace(/<[^>]+>/g, ' ');

  // HTML entities 디코딩
  text = text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(Number(dec)));

  // 다중 공백 정리
  text = text.replace(/[ \t]+/g, ' ');
  text = text.replace(/\n\s*\n/g, '\n\n');
  return text.trim();
}

/**
 * base64url 문자열 디코딩
 */
function decodeBase64Url(data: string): string {
  try {
    return Buffer.from(data, 'base64url').toString('utf-8');
  } catch {
    return '';
  }
}

/**
 * Gmail payload에서 본문 평문 추출
 * - 첨부 파일(attachments) 원천 배제
 * - text/plain 우선 추출
 * - text/html에서 script/태그 제거
 * - 최대 5,000자 절삭
 */
export function extractBodyText(payload?: GmailMessagePayload): {
  text: string;
  charCount: number;
  truncated: boolean;
} {
  if (!payload) {
    return { text: '', charCount: 0, truncated: false };
  }

  let plainText = '';
  let htmlText = '';

  function walkParts(part: GmailMessagePayload): void {
    // 첨부 파일 배제: filename이 있거나 attachmentId가 존재하는 경우 건너뜀
    if (
      (part.filename && part.filename.trim().length > 0) ||
      part.body?.attachmentId
    ) {
      return;
    }

    const mime = part.mimeType?.toLowerCase();
    const data = part.body?.data;

    if (data && mime === 'text/plain') {
      plainText += decodeBase64Url(data);
    } else if (data && mime === 'text/html') {
      htmlText += decodeBase64Url(data);
    }

    if (Array.isArray(part.parts)) {
      for (const subPart of part.parts) {
        walkParts(subPart);
      }
    }
  }

  walkParts(payload);

  let raw = plainText.trim();
  if (!raw && htmlText) {
    raw = cleanHtml(htmlText);
  }

  const { text: truncatedText, truncated } = truncateToCodePoints(
    raw,
    MAX_BODY_CHARS
  );

  return {
    text: truncatedText,
    charCount: Array.from(truncatedText).length,
    truncated,
  };
}

/**
 * HTTP 응답 에러 핸들러
 */
async function handleHttpError(response: Response, resourceName: string): Promise<never> {
  const status = response.status;

  if (status === 401) {
    throw new GmailError(
      'INVALID_CREDENTIALS',
      'Gmail authentication failed: invalid or expired credentials',
      401
    );
  }

  if (status === 403) {
    throw new GmailError(
      'ACCESS_DENIED',
      'Gmail permission denied: insufficient scope or restricted resource',
      403
    );
  }

  if (status === 404) {
    throw new GmailError(
      resourceName === 'history' ? 'HISTORY_EXPIRED' : 'NOT_FOUND',
      `Gmail ${resourceName} not found`,
      404
    );
  }

  if (status === 429) {
    let retryAfterMs: number | undefined;
    const retryHeader = response.headers.get('Retry-After');
    if (retryHeader) {
      const parsedSeconds = Number(retryHeader);
      if (Number.isFinite(parsedSeconds) && parsedSeconds > 0) {
        retryAfterMs = parsedSeconds * 1000;
      }
    }
    throw new GmailError(
      'RATE_LIMITED',
      'Gmail API rate limit exceeded',
      429,
      retryAfterMs
    );
  }

  if (status >= 500 && status < 600) {
    throw new GmailError(
      'SERVER_ERROR',
      `Gmail upstream server error (HTTP ${status})`,
      status
    );
  }

  let errorDetail = '';
  try {
    const errJson = (await response.json()) as { error?: { message?: string } };
    if (errJson?.error?.message) {
      errorDetail = `: ${errJson.error.message}`;
    }
  } catch {
    // ignore
  }

  throw new GmailError(
    'UNEXPECTED_ERROR',
    `Gmail API request failed with status ${status}${errorDetail}`,
    status
  );
}

/**
 * 단건 Gmail 메시지 조회 및 파싱
 */
export async function fetchSingleGmailMessage(
  id: string,
  accessToken: string,
  gateway?: GmailGateway,
  signal?: AbortSignal
): Promise<GmailMessageItem> {
  const fetchFn = gateway?.fetch ?? fetch;
  const url = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(
    id
  )}?format=full`;

  const response = await fetchFn(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
    signal,
  });

  if (!response.ok) {
    await handleHttpError(response, 'message');
  }

  let data: any;
  try {
    data = await response.json();
  } catch {
    throw new GmailError('INVALID_JSON', 'Failed to parse Gmail message JSON');
  }

  const payload: GmailMessagePayload = data.payload || {};
  const headers = payload.headers || [];

  const getHeader = (name: string): string => {
    const h = headers.find(
      (item) => item.name.toLowerCase() === name.toLowerCase()
    );
    return h?.value || '';
  };

  const subject = getHeader('Subject') || '(제목 없음)';
  const fromHeader = getHeader('From');
  const dateHeader = getHeader('Date');

  const { from, senderName, senderEmailMasked } = parseFromHeader(fromHeader);
  const { text: bodyText, charCount, truncated } = extractBodyText(payload);

  return {
    id: data.id,
    threadId: data.threadId,
    historyId: data.historyId,
    subject,
    from,
    senderName,
    senderEmailMasked,
    date: dateHeader,
    internalDate: data.internalDate || '',
    snippet: data.snippet,
    bodyText,
    charCount,
    truncated,
    labelIds: data.labelIds || [],
  };
}

/**
 * Gmail 메시지 목록 및 내용 일괄 수집 순수 어댑터
 */
export async function fetchGmailMessages(
  input: FetchGmailInput,
  gateway?: GmailGateway
): Promise<GmailMessagesResult> {
  if (!input.accessToken || typeof input.accessToken !== 'string') {
    throw new GmailError('INVALID_INPUT', 'accessToken must be a non-empty string');
  }

  const fetchFn = gateway?.fetch ?? fetch;
  const timeoutMs = input.timeoutMs ?? DEFAULT_GMAIL_TIMEOUT_MS;
  const controller = new AbortController();

  let timedOut = false;
  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  const onExternalAbort = () => controller.abort(input.signal?.reason);
  if (input.signal) {
    input.signal.addEventListener('abort', onExternalAbort);
  }

  try {
    const q = buildGmailQuery({
      labelId: input.labelId,
      newerThanDays: input.newerThanDays,
      query: input.query,
    });

    const maxResults = Math.min(
      Math.max(input.maxMessages ?? DEFAULT_MAX_MESSAGES, 1),
      MAX_MESSAGES_LIMIT
    );

    const queryParams = new URLSearchParams({
      q,
      maxResults: String(maxResults),
    });

    if (input.pageToken) {
      queryParams.set('pageToken', input.pageToken);
    }

    const listUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages?${queryParams.toString()}`;

    const listResponse = await fetchFn(listUrl, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${input.accessToken}`,
        Accept: 'application/json',
      },
      signal: controller.signal,
    });

    if (!listResponse.ok) {
      await handleHttpError(listResponse, 'messages');
    }

    let listData: {
      messages?: { id: string; threadId: string }[];
      nextPageToken?: string;
      resultSizeEstimate?: number;
    };

    try {
      listData = (await listResponse.json()) as any;
    } catch {
      throw new GmailError('INVALID_JSON', 'Failed to parse Gmail messages list response');
    }

    const messageRefs = Array.isArray(listData.messages) ? listData.messages : [];
    if (messageRefs.length === 0) {
      return {
        messages: [],
        nextPageToken: listData.nextPageToken,
        resultSizeEstimate: listData.resultSizeEstimate,
        warnings: [],
        derivedFromGoogle: true,
      };
    }

    // 각 메시지 단건 조회 (병렬)
    const messagePromises = messageRefs.map((ref) =>
      fetchSingleGmailMessage(
        ref.id,
        input.accessToken,
        gateway,
        controller.signal
      )
    );

    const messages = await Promise.all(messagePromises);

    // 최신 historyId 추출 (가장 큰 historyId)
    let latestHistoryId: string | undefined;
    for (const msg of messages) {
      if (msg.historyId) {
        if (!latestHistoryId) {
          latestHistoryId = msg.historyId;
        } else {
          const isBothNumeric =
            /^\d+$/.test(msg.historyId) && /^\d+$/.test(latestHistoryId);
          if (isBothNumeric) {
            if (BigInt(msg.historyId) > BigInt(latestHistoryId)) {
              latestHistoryId = msg.historyId;
            }
          } else if (msg.historyId.localeCompare(latestHistoryId) > 0) {
            latestHistoryId = msg.historyId;
          }
        }
      }
    }

    return {
      messages,
      nextPageToken: listData.nextPageToken,
      resultSizeEstimate: listData.resultSizeEstimate,
      latestHistoryId,
      warnings: [],
      derivedFromGoogle: true,
    };
  } catch (err: unknown) {
    if (timedOut) {
      throw new GmailError('TIMEOUT', `Gmail request timed out after ${timeoutMs}ms`);
    }
    if (input.signal?.aborted) {
      throw input.signal.reason || new Error('Gmail operation was aborted');
    }
    if (err instanceof GmailError) {
      throw err;
    }
    throw new GmailError(
      'UNEXPECTED_ERROR',
      `Gmail operation failed: ${err instanceof Error ? err.message : String(err)}`
    );
  } finally {
    clearTimeout(timeoutId);
    if (input.signal) {
      input.signal.removeEventListener('abort', onExternalAbort);
    }
  }
}

/**
 * Gmail History 증분 변경사항 조회 순수 어댑터
 */
export async function fetchGmailHistory(
  input: FetchGmailHistoryInput,
  gateway?: GmailGateway
): Promise<GmailHistoryResult> {
  if (!input.accessToken || typeof input.accessToken !== 'string') {
    throw new GmailError('INVALID_INPUT', 'accessToken must be a non-empty string');
  }
  if (!input.startHistoryId || typeof input.startHistoryId !== 'string') {
    throw new GmailError('INVALID_INPUT', 'startHistoryId must be a non-empty string');
  }

  const fetchFn = gateway?.fetch ?? fetch;
  const timeoutMs = input.timeoutMs ?? DEFAULT_GMAIL_TIMEOUT_MS;
  const controller = new AbortController();

  let timedOut = false;
  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  const onExternalAbort = () => controller.abort(input.signal?.reason);
  if (input.signal) {
    input.signal.addEventListener('abort', onExternalAbort);
  }

  try {
    const params = new URLSearchParams({
      startHistoryId: input.startHistoryId,
    });
    if (input.labelId) {
      params.set('labelId', input.labelId);
    }
    if (input.maxResults) {
      params.set('maxResults', String(input.maxResults));
    }
    if (input.pageToken) {
      params.set('pageToken', input.pageToken);
    }

    const url = `https://gmail.googleapis.com/gmail/v1/users/me/history?${params.toString()}`;

    const response = await fetchFn(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${input.accessToken}`,
        Accept: 'application/json',
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      await handleHttpError(response, 'history');
    }

    let data: {
      historyId?: string;
      history?: GmailHistoryItem[];
      nextPageToken?: string;
    };

    try {
      data = (await response.json()) as any;
    } catch {
      throw new GmailError('INVALID_JSON', 'Failed to parse Gmail history response');
    }

    const rawHistory = Array.isArray(data.history) ? data.history : [];
    const addedSet = new Set<string>();
    const deletedSet = new Set<string>();

    for (const h of rawHistory) {
      if (Array.isArray(h.messagesAdded)) {
        for (const m of h.messagesAdded) {
          if (m?.message?.id) {
            addedSet.add(m.message.id);
          }
        }
      }
      if (Array.isArray(h.messagesDeleted)) {
        for (const m of h.messagesDeleted) {
          if (m?.message?.id) {
            deletedSet.add(m.message.id);
          }
        }
      }
    }

    return {
      historyId: data.historyId || input.startHistoryId,
      history: rawHistory,
      addedMessageIds: Array.from(addedSet),
      deletedMessageIds: Array.from(deletedSet),
      nextPageToken: data.nextPageToken,
      derivedFromGoogle: true,
    };
  } catch (err: unknown) {
    if (timedOut) {
      throw new GmailError('TIMEOUT', `Gmail history request timed out after ${timeoutMs}ms`);
    }
    if (input.signal?.aborted) {
      throw input.signal.reason || new Error('Gmail history operation was aborted');
    }
    if (err instanceof GmailError) {
      throw err;
    }
    throw new GmailError(
      'UNEXPECTED_ERROR',
      `Gmail history operation failed: ${err instanceof Error ? err.message : String(err)}`
    );
  } finally {
    clearTimeout(timeoutId);
    if (input.signal) {
      input.signal.removeEventListener('abort', onExternalAbort);
    }
  }
}
