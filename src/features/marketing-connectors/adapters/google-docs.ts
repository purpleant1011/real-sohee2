import 'server-only';

import {
  truncateToCodePoints,
} from './google-adapter-common';

export const DEFAULT_MAX_TABS = 20;
export const DEFAULT_MAX_CHARS = 500_000;
export const DEFAULT_DOC_TIMEOUT_MS = 15_000;

export type GoogleDocErrorCode =
  | 'INVALID_CREDENTIALS'
  | 'ACCESS_DENIED'
  | 'DOCUMENT_NOT_FOUND'
  | 'RATE_LIMITED'
  | 'INVALID_INPUT'
  | 'TIMEOUT'
  | 'SERVER_ERROR'
  | 'INVALID_JSON'
  | 'UNEXPECTED_ERROR';

export class GoogleDocError extends Error {
  readonly code: GoogleDocErrorCode;
  readonly status?: number;

  constructor(code: GoogleDocErrorCode, message: string, status?: number) {
    super(message);
    this.name = 'GoogleDocError';
    this.code = code;
    this.status = status;
    Object.setPrototypeOf(this, GoogleDocError.prototype);
  }
}

export interface FetchGoogleDocInput {
  readonly documentId: string;
  readonly accessToken: string;
  readonly maxTabs?: number;
  readonly maxChars?: number;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
}

export interface GoogleDocGateway {
  readonly fetch?: typeof fetch;
}

export interface GoogleDocTab {
  readonly tabId: string;
  readonly title: string;
  readonly text: string;
  readonly charCount: number;
}

export interface GoogleDocResult {
  readonly documentId: string;
  readonly title: string;
  readonly revisionId?: string;
  readonly tabs: readonly GoogleDocTab[];
  readonly totalCharCount: number;
  readonly truncated: boolean;
  readonly warnings: readonly string[];
  readonly derivedFromGoogle: true;
}

/**
 * Google Docs URL 또는 순수 documentId에서 유효한 documentId를 추출한다.
 */
export function extractGoogleDocId(urlOrId: unknown): string | null {
  if (typeof urlOrId !== 'string') return null;
  const trimmed = urlOrId.trim();
  if (!trimmed) return null;

  // 1. Google Docs URL 형태 검사
  // e.g. https://docs.google.com/document/d/{documentId}/edit...
  const urlMatch = /docs\.google\.com\/document\/d\/([a-zA-Z0-9_-]+)/.exec(trimmed);
  if (urlMatch?.[1]) {
    return urlMatch[1];
  }

  // 2. 순수 documentId 형태 검사 (알파벳, 숫자, 하이픈, 언더스코어 10~150자)
  if (/^[a-zA-Z0-9_-]{10,150}$/.test(trimmed)) {
    return trimmed;
  }

  return null;
}

/**
 * Google Docs API의 구조적 요소(StructuralElement)에서 텍스트를 추출한다.
 */
function extractTextFromStructuralElements(
  elements: unknown[],
  addWarning: (msg: string) => void
): string {
  if (!Array.isArray(elements)) return '';

  let text = '';

  for (const element of elements) {
    if (!element || typeof element !== 'object') continue;
    const elemObj = element as Record<string, unknown>;

    // 1. 단락 (Paragraph)
    if (elemObj.paragraph && typeof elemObj.paragraph === 'object') {
      const p = elemObj.paragraph as { elements?: unknown[] };
      if (Array.isArray(p.elements)) {
        for (const pe of p.elements) {
          if (!pe || typeof pe !== 'object') continue;
          const peObj = pe as Record<string, unknown>;

          if (peObj.textRun && typeof peObj.textRun === 'object') {
            const tr = peObj.textRun as { content?: string };
            if (typeof tr.content === 'string') {
              text += tr.content;
            }
          } else if (peObj.inlineObjectElement) {
            addWarning('Unsupported element skipped: inlineObjectElement');
          } else if (peObj.equation) {
            addWarning('Unsupported element skipped: equation');
          } else if (peObj.footnoteReference) {
            addWarning('Unsupported element skipped: footnoteReference');
          }
        }
      }
      continue;
    }

    // 2. 표 (Table)
    if (elemObj.table && typeof elemObj.table === 'object') {
      const table = elemObj.table as { tableRows?: unknown[] };
      if (Array.isArray(table.tableRows)) {
        const rowStrings: string[] = [];
        for (const tr of table.tableRows) {
          if (!tr || typeof tr !== 'object') continue;
          const rowObj = tr as { tableCells?: unknown[] };
          if (Array.isArray(rowObj.tableCells)) {
            const cellStrings: string[] = [];
            for (const tc of rowObj.tableCells) {
              if (!tc || typeof tc !== 'object') continue;
              const cellObj = tc as { content?: unknown[] };
              const cellText = extractTextFromStructuralElements(
                cellObj.content || [],
                addWarning
              );
              // 셀 끝의 불필요한 개행을 제거하고 탭 분리 준비
              cellStrings.push(cellText.replace(/\n+$/, '').replace(/\r/g, ''));
            }
            rowStrings.push(cellStrings.join('\t'));
          }
        }
        text += rowStrings.join('\n') + '\n';
      }
      continue;
    }

    // 3. 목차 (Table of Contents)
    if (elemObj.tableOfContents) {
      addWarning('Unsupported structural element skipped: tableOfContents');
      continue;
    }

    // 4. 섹션 나눔 (Section Break)
    if (elemObj.sectionBreak) {
      continue;
    }

    // 5. 기타 비정형 요소
    for (const key of Object.keys(elemObj)) {
      if (key !== 'startIndex' && key !== 'endIndex') {
        addWarning(`Unsupported structural element skipped: ${key}`);
      }
    }
  }

  return text;
}

interface RawTab {
  tabProperties?: {
    tabId?: string;
    title?: string;
    index?: number;
  };
  documentTab?: {
    body?: {
      content?: unknown[];
    };
  };
  childTabs?: RawTab[];
}

/**
 * 탭 트리(childTabs 포함)를 평탄화하여 수집한다.
 */
function collectTabsRecursively(tabs: RawTab[]): RawTab[] {
  const result: RawTab[] = [];
  for (const tab of tabs) {
    result.push(tab);
    if (Array.isArray(tab.childTabs) && tab.childTabs.length > 0) {
      result.push(...collectTabsRecursively(tab.childTabs));
    }
  }
  return result;
}

/**
 * Google Docs API v1 어댑터: 다중 탭, 본문, 표 구조에서 안전하게 텍스트를 추출하고 예산/타임아웃을 강제한다.
 */
export async function fetchGoogleDocument(
  input: FetchGoogleDocInput,
  gateway?: GoogleDocGateway
): Promise<GoogleDocResult> {
  // 1. 입력 유효성 검증 (Fail-Closed)
  if (!input || typeof input !== 'object') {
    throw new GoogleDocError('INVALID_INPUT', 'Input must be a valid object');
  }

  const documentId = typeof input.documentId === 'string' ? input.documentId.trim() : '';
  if (!documentId) {
    throw new GoogleDocError('INVALID_INPUT', 'documentId must be a non-empty string');
  }

  // 경로 조작 및 부적격 문자 방어
  if (
    documentId.includes('..') ||
    documentId.includes('/') ||
    documentId.includes('\\') ||
    /[\x00-\x1f\x7f]/.test(documentId)
  ) {
    throw new GoogleDocError('INVALID_INPUT', 'documentId contains invalid characters or path traversal');
  }

  const accessToken = typeof input.accessToken === 'string' ? input.accessToken.trim() : '';
  if (!accessToken) {
    throw new GoogleDocError('INVALID_INPUT', 'accessToken is required and cannot be empty');
  }

  if (input.signal?.aborted) {
    throw input.signal.reason || new Error('Operation was aborted');
  }

  const maxTabs = typeof input.maxTabs === 'number' && input.maxTabs > 0 ? input.maxTabs : DEFAULT_MAX_TABS;
  const maxChars = typeof input.maxChars === 'number' && input.maxChars > 0 ? input.maxChars : DEFAULT_MAX_CHARS;
  const timeoutMs = typeof input.timeoutMs === 'number' && input.timeoutMs > 0 ? input.timeoutMs : DEFAULT_DOC_TIMEOUT_MS;

  const warnings: string[] = [];
  const addWarning = (msg: string) => {
    if (!warnings.includes(msg)) {
      warnings.push(msg);
    }
  };

  // 2. Fetch 준비 및 타임아웃 레이스
  const fetchFn = gateway?.fetch ?? fetch;
  const url = `https://docs.googleapis.com/v1/documents/${encodeURIComponent(documentId)}?includeTabsContent=true`;

  const controller = new AbortController();
  let timedOut = false;
  let timerId: ReturnType<typeof setTimeout> | undefined;

  const cleanupTimer = () => {
    if (timerId !== undefined) {
      clearTimeout(timerId);
      timerId = undefined;
    }
  };

  const timeoutPromise = new Promise<never>((_, reject) => {
    timerId = setTimeout(() => {
      timedOut = true;
      try {
        controller.abort();
      } catch {
        // ignore
      }
      reject(new GoogleDocError('TIMEOUT', `Google Docs request timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  // 외부 signal 리스너 연결
  const onExternalAbort = () => {
    try {
      controller.abort();
    } catch {
      // ignore
    }
  };

  if (input.signal) {
    input.signal.addEventListener('abort', onExternalAbort, { once: true });
  }

  let response: Response;
  try {
    const fetchPromise = fetchFn(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
      signal: controller.signal,
    });

    response = await Promise.race([fetchPromise, timeoutPromise]);
  } catch (err: unknown) {
    cleanupTimer();
    if (input.signal) {
      input.signal.removeEventListener('abort', onExternalAbort);
    }

    if (timedOut || (err instanceof Error && (err.name === 'TimeoutError' || (err as GoogleDocError).code === 'TIMEOUT'))) {
      throw new GoogleDocError('TIMEOUT', `Google Docs request timed out after ${timeoutMs}ms`);
    }

    if (input.signal?.aborted) {
      throw input.signal.reason || new Error('Operation was aborted');
    }

    if (err instanceof GoogleDocError) {
      throw err;
    }

    throw new GoogleDocError(
      'UNEXPECTED_ERROR',
      `Google Docs network request failed: ${err instanceof Error ? err.message : String(err)}`
    );
  } finally {
    cleanupTimer();
    if (input.signal) {
      input.signal.removeEventListener('abort', onExternalAbort);
    }
  }

  // 3. HTTP 응답 상태 코드 매핑 (Fail-Closed)
  if (!response.ok) {
    const status = response.status;
    if (status === 401) {
      throw new GoogleDocError('INVALID_CREDENTIALS', 'Google Docs authentication failed: invalid or expired credentials', 401);
    }
    if (status === 403) {
      throw new GoogleDocError('ACCESS_DENIED', 'Access to Google Document was denied: insufficient permissions', 403);
    }
    if (status === 404) {
      throw new GoogleDocError('DOCUMENT_NOT_FOUND', 'Google Document not found', 404);
    }
    if (status === 429) {
      throw new GoogleDocError('RATE_LIMITED', 'Google Docs API rate limit exceeded', 429);
    }
    if (status >= 500 && status < 600) {
      throw new GoogleDocError('SERVER_ERROR', `Google Docs API server error (${status})`, status);
    }
    throw new GoogleDocError('UNEXPECTED_ERROR', `Google Docs API request failed with status ${status}`, status);
  }

  // 4. JSON 파싱
  let docData: Record<string, unknown>;
  try {
    docData = (await response.json()) as Record<string, unknown>;
  } catch {
    throw new GoogleDocError('INVALID_JSON', 'Failed to parse Google Docs response as JSON');
  }

  const docTitle = typeof docData.title === 'string' ? docData.title : 'Untitled Document';
  const revisionId = typeof docData.revisionId === 'string' ? docData.revisionId : undefined;
  let truncated = false;

  // 5. 탭 목록 수집 및 텍스트 추출
  const rawTabs = Array.isArray(docData.tabs) ? (docData.tabs as RawTab[]) : [];
  const tabResults: Array<{ tabId: string; title: string; text: string; charCount: number }> = [];

  if (rawTabs.length > 0) {
    const flattenedTabs = collectTabsRecursively(rawTabs);
    let selectedTabs = flattenedTabs;

    if (flattenedTabs.length > maxTabs) {
      selectedTabs = flattenedTabs.slice(0, maxTabs);
      truncated = true;
      addWarning(`Maximum tabs limit exceeded (${maxTabs}). Remaining tabs were omitted.`);
    }

    for (const [index, tab] of selectedTabs.entries()) {
      const tabId = tab.tabProperties?.tabId || `tab-${index}`;
      const title = tab.tabProperties?.title || `Untitled Tab ${index + 1}`;
      const content = tab.documentTab?.body?.content || [];
      const extractedText = extractTextFromStructuralElements(content, addWarning);

      tabResults.push({
        tabId,
        title,
        text: extractedText,
        charCount: extractedText.length,
      });
    }
  } else {
    // 최상위 body 폴백
    const rootBody = docData.body as { content?: unknown[] } | undefined;
    const content = Array.isArray(rootBody?.content) ? rootBody.content : [];
    const extractedText = extractTextFromStructuralElements(content, addWarning);

    tabResults.push({
      tabId: 'root',
      title: docTitle,
      text: extractedText,
      charCount: extractedText.length,
    });
  }

  // 6. 글자 수 예산(maxChars) 강제 및 절삭
  let remainingBudget = maxChars;
  const budgetedTabs: GoogleDocTab[] = [];

  for (const tab of tabResults) {
    if (remainingBudget <= 0) {
      budgetedTabs.push({
        tabId: tab.tabId,
        title: tab.title,
        text: '',
        charCount: 0,
      });
      truncated = true;
      addWarning(`Maximum character budget exceeded (${maxChars}). Document content was truncated.`);
    } else {
      const { text: safeText, truncated: textTruncated } = truncateToCodePoints(tab.text, remainingBudget);
      if (textTruncated) {
        truncated = true;
        addWarning(`Maximum character budget exceeded (${maxChars}). Document content was truncated.`);
      }
      const charCount = safeText.length;
      remainingBudget -= charCount;

      budgetedTabs.push({
        tabId: tab.tabId,
        title: tab.title,
        text: safeText,
        charCount,
      });
    }
  }

  const totalCharCount = budgetedTabs.reduce((acc, tab) => acc + tab.charCount, 0);

  return {
    documentId: typeof docData.documentId === 'string' ? docData.documentId : documentId,
    title: docTitle,
    revisionId,
    tabs: budgetedTabs,
    totalCharCount,
    truncated,
    warnings,
    derivedFromGoogle: true,
  };
}
