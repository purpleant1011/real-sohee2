import 'server-only';

import {
  truncateToCodePoints,
} from './google-adapter-common';

export const DEFAULT_MAX_ROWS = 500;
export const DEFAULT_MAX_COLS = 50;
export const DEFAULT_MAX_CHARS = 500_000;
export const DEFAULT_SHEET_TIMEOUT_MS = 15_000;
export const MAX_SPREADSHEET_ID_LENGTH = 256;

export type GoogleSheetErrorCode =
  | 'INVALID_CREDENTIALS'
  | 'ACCESS_DENIED'
  | 'SPREADSHEET_NOT_FOUND'
  | 'RATE_LIMITED'
  | 'INVALID_INPUT'
  | 'TIMEOUT'
  | 'SERVER_ERROR'
  | 'INVALID_JSON'
  | 'UNEXPECTED_ERROR';

export class GoogleSheetError extends Error {
  readonly code: GoogleSheetErrorCode;
  readonly status?: number;

  constructor(code: GoogleSheetErrorCode, message: string, status?: number) {
    super(message);
    this.name = 'GoogleSheetError';
    this.code = code;
    this.status = status;
    Object.setPrototypeOf(this, GoogleSheetError.prototype);
  }
}

export interface FetchGoogleSheetInput {
  readonly spreadsheetId: string;
  readonly range: string;
  readonly accessToken: string;
  readonly maxRows?: number;
  readonly maxCols?: number;
  readonly maxChars?: number;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
}

export interface GoogleSheetGateway {
  readonly fetch?: typeof fetch;
}

export interface GoogleSheetResult {
  readonly spreadsheetId: string;
  readonly range: string;
  readonly rowCount: number;
  readonly columnCount: number;
  readonly headers: string[];
  readonly rows: string[][];
  readonly totalCharCount: number;
  readonly truncated: boolean;
  readonly warnings: string[];
  readonly derivedFromGoogle: true;
}

/**
 * Google Sheets URL 또는 순수 spreadsheetId에서 유효한 spreadsheetId를 추출한다.
 */
export function extractGoogleSpreadsheetId(urlOrId: unknown): string | null {
  if (typeof urlOrId !== 'string') return null;
  const trimmed = urlOrId.trim();
  if (!trimmed) return null;

  // 1. Google Sheets URL 형태 검사
  // e.g. https://docs.google.com/spreadsheets/d/{spreadsheetId}/edit...
  const urlMatch = /docs\.google\.com\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/.exec(trimmed);
  if (urlMatch?.[1]) {
    return urlMatch[1];
  }

  // 2. 순수 spreadsheetId 형태 검사 (알파벳, 숫자, 하이픈, 언더스코어 10~256자)
  if (/^[a-zA-Z0-9_-]{10,256}$/.test(trimmed)) {
    return trimmed;
  }

  return null;
}

/**
 * spreadsheetId 안전성 검증
 */
function validateSpreadsheetId(spreadsheetId: unknown): string {
  if (typeof spreadsheetId !== 'string') {
    throw new GoogleSheetError('INVALID_INPUT', 'spreadsheetId must be a non-empty string');
  }

  const trimmed = spreadsheetId.trim();
  if (!trimmed) {
    throw new GoogleSheetError('INVALID_INPUT', 'spreadsheetId cannot be empty');
  }

  if (trimmed.length > MAX_SPREADSHEET_ID_LENGTH) {
    throw new GoogleSheetError(
      'INVALID_INPUT',
      `spreadsheetId exceeds maximum length of ${MAX_SPREADSHEET_ID_LENGTH} characters`
    );
  }

  // 점 단독, 경로 탐색, 슬래시 차단
  if (
    trimmed === '.' ||
    trimmed === '..' ||
    trimmed.includes('..') ||
    trimmed.includes('/') ||
    trimmed.includes('\\')
  ) {
    throw new GoogleSheetError(
      'INVALID_INPUT',
      'Path traversal segments or slashes are not allowed in spreadsheetId'
    );
  }

  // 제어 문자 차단
  for (let i = 0; i < trimmed.length; i++) {
    const code = trimmed.charCodeAt(i);
    if ((code >= 0 && code <= 31) || code === 127) {
      throw new GoogleSheetError('INVALID_INPUT', 'Control characters are not allowed in spreadsheetId');
    }
  }

  // URL 형태인 경우 추출 시도, 아니면 문자열 검증
  const extracted = extractGoogleSpreadsheetId(trimmed);
  if (extracted) {
    return extracted;
  }

  // 유효한 ID 문자셋(알파벳, 숫자, _, -) 검사
  if (!/^[a-zA-Z0-9_-]+$/.test(trimmed)) {
    throw new GoogleSheetError('INVALID_INPUT', 'spreadsheetId contains invalid characters');
  }

  return trimmed;
}

/**
 * A1 범위 표기법 유효성 검사
 */
function validateRange(range: unknown): string {
  if (typeof range !== 'string') {
    throw new GoogleSheetError('INVALID_INPUT', 'range must be a non-empty A1 notation string');
  }

  const trimmed = range.trim();
  if (!trimmed) {
    throw new GoogleSheetError(
      'INVALID_INPUT',
      'range cannot be empty (automatic fallback to entire sheet is forbidden)'
    );
  }

  return trimmed;
}

const FORMULA_PREFIXES = ['=', '+', '-', '@'] as const;

/**
 * Google Sheets API v4 규격을 준수하여 명시된 A1 범위의 셀 데이터를 안전하게 읽어온다.
 */
export async function fetchGoogleSheetValues(
  input: FetchGoogleSheetInput,
  gateway?: GoogleSheetGateway
): Promise<GoogleSheetResult> {
  // 1. 입력 유효성 검증 (Fail-Closed)
  if (!input) {
    throw new GoogleSheetError('INVALID_INPUT', 'Input is required');
  }

  if (input.signal?.aborted) {
    throw input.signal.reason || new Error('Operation was aborted');
  }

  const spreadsheetId = validateSpreadsheetId(input.spreadsheetId);
  const range = validateRange(input.range);

  if (typeof input.accessToken !== 'string' || !input.accessToken.trim()) {
    throw new GoogleSheetError('INVALID_INPUT', 'accessToken must be a non-empty string');
  }
  const accessToken = input.accessToken.trim();

  const maxRows = typeof input.maxRows === 'number' && input.maxRows > 0 ? input.maxRows : DEFAULT_MAX_ROWS;
  const maxCols = typeof input.maxCols === 'number' && input.maxCols > 0 ? input.maxCols : DEFAULT_MAX_COLS;
  const maxChars = typeof input.maxChars === 'number' && input.maxChars > 0 ? input.maxChars : DEFAULT_MAX_CHARS;
  const timeoutMs = typeof input.timeoutMs === 'number' && input.timeoutMs > 0 ? input.timeoutMs : DEFAULT_SHEET_TIMEOUT_MS;

  const warnings: string[] = [];
  const addWarning = (msg: string) => {
    if (!warnings.includes(msg)) {
      warnings.push(msg);
    }
  };

  // 2. Fetch 준비 및 타임아웃 레이스
  const fetchFn = gateway?.fetch ?? fetch;
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}?valueRenderOption=FORMATTED_VALUE`;

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
      reject(new GoogleSheetError('TIMEOUT', `Google Sheets request timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

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

    if (
      timedOut ||
      (err instanceof Error && (err.name === 'TimeoutError' || (err as GoogleSheetError).code === 'TIMEOUT'))
    ) {
      throw new GoogleSheetError('TIMEOUT', `Google Sheets request timed out after ${timeoutMs}ms`);
    }

    if (input.signal?.aborted) {
      throw input.signal.reason || new Error('Operation was aborted');
    }

    if (err instanceof GoogleSheetError) {
      throw err;
    }

    throw new GoogleSheetError(
      'UNEXPECTED_ERROR',
      `Google Sheets network request failed: ${err instanceof Error ? err.message : String(err)}`
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
      throw new GoogleSheetError('INVALID_CREDENTIALS', 'Google Sheets authentication failed: invalid or expired credentials', 401);
    }
    if (status === 403) {
      throw new GoogleSheetError('ACCESS_DENIED', 'Google Sheets permission denied: insufficient scope or access restricted', 403);
    }
    if (status === 404) {
      throw new GoogleSheetError('SPREADSHEET_NOT_FOUND', 'Google Spreadsheet or range not found', 404);
    }
    if (status === 429) {
      throw new GoogleSheetError('RATE_LIMITED', 'Google Sheets API rate limit exceeded', 429);
    }
    if (status >= 500 && status < 600) {
      throw new GoogleSheetError('SERVER_ERROR', `Google Sheets upstream server error (HTTP ${status})`, status);
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
    throw new GoogleSheetError('UNEXPECTED_ERROR', `Google Sheets API request failed with status ${status}${errorDetail}`, status);
  }

  // 4. JSON 파싱
  let data: { values?: unknown[][] };
  try {
    data = (await response.json()) as { values?: unknown[][] };
  } catch (err) {
    throw new GoogleSheetError('INVALID_JSON', `Failed to parse Google Sheets response as JSON: ${err instanceof Error ? err.message : String(err)}`);
  }

  // 5. 셀 값 가공, 수식 인젝션 방어 및 예산(행/열/글자 수) 제한
  const rawValues = Array.isArray(data.values) ? data.values : [];
  if (rawValues.length === 0) {
    return {
      spreadsheetId,
      range,
      rowCount: 0,
      columnCount: 0,
      headers: [],
      rows: [],
      totalCharCount: 0,
      truncated: false,
      warnings,
      derivedFromGoogle: true,
    };
  }

  let truncated = false;

  // 5-1. 행 수 절삭
  let rowsToProcess = rawValues;
  if (rowsToProcess.length > maxRows) {
    rowsToProcess = rowsToProcess.slice(0, maxRows);
    truncated = true;
    addWarning(`Exceeded maximum rows (${maxRows}). Truncated to ${maxRows} rows.`);
  }

  // 5-2. 최대 열 수 계산 및 열 수 절삭
  let observedMaxCols = 0;
  for (const r of rowsToProcess) {
    if (Array.isArray(r) && r.length > observedMaxCols) {
      observedMaxCols = r.length;
    }
  }

  if (observedMaxCols > maxCols) {
    truncated = true;
    addWarning(`Exceeded maximum columns (${maxCols}). Truncated to ${maxCols} columns.`);
  }

  const columnCount = Math.min(observedMaxCols, maxCols);

  // 5-3. 셀 값 수식 인젝션 방어, 문자수 누적 및 절삭
  let totalCharCount = 0;
  let charBudgetExceeded = false;
  const processedGrid: string[][] = [];

  for (let rIdx = 0; rIdx < rowsToProcess.length; rIdx++) {
    const rawRow = Array.isArray(rowsToProcess[rIdx]) ? rowsToProcess[rIdx] : [];
    const processedRow: string[] = [];

    for (let cIdx = 0; cIdx < columnCount; cIdx++) {
      if (charBudgetExceeded) {
        processedRow.push('');
        continue;
      }

      const rawCell = cIdx < rawRow.length ? rawRow[cIdx] : '';
      let cellStr = rawCell == null ? '' : String(rawCell);

      // 수식 인젝션 방어 (=, +, -, @ 로 시작하는 경우 홑따옴표 접두사 추가)
      if (FORMULA_PREFIXES.some((prefix) => cellStr.startsWith(prefix))) {
        cellStr = `'${cellStr}`;
        addWarning(`Formula injection detected and sanitized at [row ${rIdx + 1}, col ${cIdx + 1}].`);
      }

      // 문자수 예산 검증
      const remainingChars = maxChars - totalCharCount;
      if (cellStr.length > remainingChars) {
        const { text: truncatedText } = truncateToCodePoints(cellStr, Math.max(0, remainingChars));
        processedRow.push(truncatedText);
        totalCharCount += truncatedText.length;
        charBudgetExceeded = true;
        truncated = true;
        addWarning(`Exceeded maximum character count (${maxChars}). Data truncated.`);
      } else {
        processedRow.push(cellStr);
        totalCharCount += cellStr.length;
      }
    }

    processedGrid.push(processedRow);
  }

  const headers = processedGrid.length > 0 ? processedGrid[0] : [];
  const rows = processedGrid.length > 1 ? processedGrid.slice(1) : [];

  return {
    spreadsheetId,
    range,
    rowCount: processedGrid.length,
    columnCount,
    headers,
    rows,
    totalCharCount,
    truncated,
    warnings,
    derivedFromGoogle: true,
  };
}
