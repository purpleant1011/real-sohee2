import 'server-only';

import {
  type GoogleAdapterResult,
  type InjectedFetch,
  DEFAULT_PAGE_TIMEOUT_MS,
  MAX_CALENDAR_PAGE_BYTES,
  TimeoutError,
  safeCancelBody,
  readBoundedStream,
  fetchWithTimeout,
  mapHttpStatusToAdapterError,
  truncateToCodePoints,
} from './google-adapter-common';
import {
  loadConnectorCredential,
  CredentialVaultError,
  type CredentialVaultGateway,
} from '../credentials/credential-vault';

export interface GoogleCalendarSourceItem {
  readonly id: string;
  readonly summary: string;
  readonly primary: boolean;
  readonly timeZone: string;
}

export interface ListGoogleCalendarsOptions {
  readonly generation?: number;
  readonly injectedFetch?: InjectedFetch;
  readonly keyBase64?: string;
  readonly timeoutMs?: number;
}

/**
 * F03 Token Vault에서 복호화된 토큰을 받아 Google Calendar list API를 호출하여
 * 사장님이 선택 가능한 캘린더 목록(id, summary, primary, timeZone)을 안전하게 조회한다.
 */
export async function listGoogleCalendars(
  workspaceId: string,
  gateway: CredentialVaultGateway,
  options?: ListGoogleCalendarsOptions
): Promise<GoogleAdapterResult<GoogleCalendarSourceItem[]>> {
  if (!workspaceId || typeof workspaceId !== 'string' || !workspaceId.trim()) {
    return {
      ok: false,
      error: { code: 'invalid_input', message: 'workspaceId must be a non-empty string' },
    };
  }

  const cleanWorkspaceId = workspaceId.trim();

  // 1. 활성 세대(generation) 확인
  let generation = options?.generation;
  if (generation === undefined) {
    const record = await gateway.getCredential(cleanWorkspaceId, 'google_calendar');
    if (!record) {
      return {
        ok: false,
        error: {
          code: 'not_found',
          message: `Credential for google_calendar not found in workspace ${cleanWorkspaceId}`,
        },
      };
    }
    generation = record.consentGeneration;
  }

  // 2. F03 Token Vault에서 토큰 복호화 로드
  let credential;
  try {
    credential = await loadConnectorCredential(
      cleanWorkspaceId,
      'google_calendar',
      generation,
      gateway,
      { keyBase64: options?.keyBase64 }
    );
  } catch (err) {
    if (err instanceof CredentialVaultError) {
      if (err.code === 'CREDENTIAL_NOT_FOUND') {
        return { ok: false, error: { code: 'not_found', message: err.message } };
      }
      if (err.code === 'DECRYPTION_FAILED' || err.code === 'INVALID_KEY') {
        return { ok: false, error: { code: 'unauthorized', message: err.message } };
      }
    }
    return { ok: false, error: { code: 'server_error', message: 'Failed to load credential' } };
  }

  // 3. Google Calendar list API 호출
  const url = 'https://www.googleapis.com/calendar/v3/users/me/calendarList';
  const fetchFn = options?.injectedFetch ?? fetch;
  const timeoutMs = options?.timeoutMs ?? DEFAULT_PAGE_TIMEOUT_MS;
  const controller = new AbortController();

  let response: Response;
  try {
    response = await fetchWithTimeout(
      fetchFn,
      url,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${credential.accessToken}`,
          Accept: 'application/json',
        },
      },
      timeoutMs,
      controller
    );
  } catch (err) {
    if (err instanceof TimeoutError) {
      return { ok: false, error: { code: 'timeout', message: 'Google API request timed out' } };
    }
    return { ok: false, error: { code: 'network_error', message: 'Failed to connect to Google API' } };
  }

  if (!response.ok) {
    await safeCancelBody(response.body);
    return { ok: false, error: mapHttpStatusToAdapterError(response.status) };
  }

  const bodyResult = await readBoundedStream(response, MAX_CALENDAR_PAGE_BYTES, timeoutMs);
  if (!bodyResult.ok) {
    return bodyResult;
  }

  let json: unknown;
  try {
    json = JSON.parse(bodyResult.text);
  } catch {
    return { ok: false, error: { code: 'invalid_json', message: 'Failed to parse Google API response as JSON' } };
  }

  if (!json || typeof json !== 'object' || Array.isArray(json)) {
    return { ok: false, error: { code: 'invalid_schema', message: 'Response payload is not a valid object' } };
  }

  const rawResponse = json as { items?: unknown };
  if (!Array.isArray(rawResponse.items)) {
    return { ok: false, error: { code: 'invalid_schema', message: 'Response items field must be an array' } };
  }

  const calendars: GoogleCalendarSourceItem[] = [];
  for (const rawItem of rawResponse.items) {
    if (!rawItem || typeof rawItem !== 'object' || Array.isArray(rawItem)) {
      continue;
    }
    const item = rawItem as Record<string, unknown>;
    if (typeof item.id !== 'string' || !item.id.trim()) {
      continue;
    }

    const rawSummary = typeof item.summary === 'string' ? item.summary : '';
    const summary = truncateToCodePoints(rawSummary, 1024).text;
    const primary = Boolean(item.primary);
    const timeZone =
      typeof item.timeZone === 'string' && item.timeZone.trim()
        ? item.timeZone.trim()
        : 'UTC';

    calendars.push({
      id: item.id.trim(),
      summary,
      primary,
      timeZone,
    });
  }

  return {
    ok: true,
    data: calendars,
    derivedFromGoogle: true,
  };
}
