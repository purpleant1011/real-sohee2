/**
 * 저장된 첫 포스팅 초안 복원 로더 (ANI-1788).
 *
 * 기존 GET /api/missions/first-post/{missionId} 읽기 전용 엔드포인트만 호출한다.
 * 새 서버 GET 엔드포인트나 버전 필드, 상태 모델을 추가하지 않는다.
 * URL에 사용자 원고나 자산, 지문을 싣지 않고 기존 post UUID 쿼리만 사용한다.
 */
import { classifyCommonError, type CommonError } from '@/features/mobile-common/error-model'
import { classifyServerResponse, classifyTransportFailure, isFailure } from '@/features/mobile-common/state-linkage'
import type { DraftDto } from './draft-mapper'

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type StoredDraftLoadResult =
  | { kind: 'ready'; draft: DraftDto; missionStatus: string | null }
  | { kind: 'invalid_id'; error: CommonError }
  | { kind: 'session_expired'; error: CommonError }
  | { kind: 'forbidden'; error: CommonError }
  | { kind: 'missing'; error: CommonError }
  | { kind: 'conflict'; error: CommonError }
  | { kind: 'invalid'; error: CommonError }
  | { kind: 'error'; error: CommonError }
  | { kind: 'offline'; error: CommonError }
  | { kind: 'cancelled' }

export interface LoadStoredFirstPostDraftParams {
  missionId: string
  workspaceId?: string
  fetchImpl?: typeof fetch
  signal?: AbortSignal
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasValidChannels(channels: unknown): boolean {
  if (channels === undefined || channels === null) return true
  if (!Array.isArray(channels)) return false
  return channels.every((item) => isRecord(item) && typeof item.provider === 'string' && item.provider.trim() !== '')
}

function hasValidSelectedImageIds(ids: unknown): boolean {
  if (ids === undefined || ids === null) return true
  if (!Array.isArray(ids)) return false
  return ids.every((item) => typeof item === 'string' && item.trim() !== '')
}

function hasValidMediaPreviews(previews: unknown): boolean {
  if (previews === undefined || previews === null) return true
  if (!Array.isArray(previews)) return false
  return previews.every((item) => isRecord(item) && typeof item.id === 'string' && typeof item.url === 'string')
}

export async function loadStoredFirstPostDraft({
  missionId,
  workspaceId,
  fetchImpl = fetch,
  signal,
}: LoadStoredFirstPostDraftParams): Promise<StoredDraftLoadResult> {
  if (signal?.aborted) {
    return { kind: 'cancelled' }
  }

  const trimmedId = missionId?.trim() ?? ''
  if (!UUID_REGEX.test(trimmedId)) {
    const error = classifyCommonError(422, {
      error: 'missionId는 유효한 UUID 형식이어야 합니다.',
      code: 'INVALID_MISSION_UUID',
    })
    return { kind: 'invalid_id', error }
  }

  const headers: Record<string, string> = {}
  if (workspaceId) {
    headers['x-workspace-id'] = workspaceId
  }

  let res: Response
  try {
    res = await fetchImpl(`/api/missions/first-post/${encodeURIComponent(trimmedId)}`, {
      method: 'GET',
      cache: 'no-store',
      headers,
      signal,
    })
  } catch (err: unknown) {
    const transport = classifyTransportFailure(err)
    if (transport === 'aborted' || signal?.aborted) {
      return { kind: 'cancelled' }
    }
    const error = classifyCommonError('network')
    return { kind: 'offline', error }
  }

  if (signal?.aborted) {
    return { kind: 'cancelled' }
  }

  let parsedBody: unknown = null
  try {
    if (typeof res.json === 'function') {
      parsedBody = await res.json()
    } else if (typeof res.text === 'function') {
      const text = await res.text()
      try {
        parsedBody = text ? JSON.parse(text) : null
      } catch {
        parsedBody = text || null
      }
    }
  } catch (err: unknown) {
    const transport = classifyTransportFailure(err)
    if (transport === 'aborted' || signal?.aborted) {
      return { kind: 'cancelled' }
    }
    parsedBody = null
  }

  if (signal?.aborted) {
    return { kind: 'cancelled' }
  }

  // 404의 경우 삭제 확정/권한 없음/주소 오타 등 특정 원인으로 단정하지 않는 중립 안내로 fail-closed
  if (res.status === 404) {
    const base404 = classifyCommonError(404)
    const neutralMissingError: CommonError = {
      ...base404,
      title: '초안을 확인할 수 없어요',
      description: '초안을 확인할 수 없어요. 접근 권한이나 상태를 확인해 주세요.',
    }
    return { kind: 'missing', error: neutralMissingError }
  }

  const state = classifyServerResponse({
    status: res.status ?? (res.ok ? 200 : 500),
    body: parsedBody,
    loadState: isRecord(parsedBody) && typeof parsedBody.loadState === 'string' ? parsedBody.loadState : null,
  })

  if (isFailure(state)) {
    if (state.kind === 'session_expired') return { kind: 'session_expired', error: state }
    if (state.kind === 'unauthorized') return { kind: 'forbidden', error: state }
    if (res.status === 409) return { kind: 'conflict', error: state }
    if (res.status === 422) return { kind: 'invalid', error: state }
    return { kind: 'error', error: state }
  }

  // HTTP 200 정상 응답 내부 shape 및 일관성 검증 (consumer 책임)
  if (!isRecord(parsedBody) || parsedBody.success !== true || !isRecord(parsedBody.draft)) {
    return {
      kind: 'error',
      error: classifyCommonError(500, { error: 'Invalid draft response shape' }),
    }
  }

  // success: true 라도 error 봉투가 함께 존재하면 fail-closed
  if ('error' in parsedBody && parsedBody.error !== null && parsedBody.error !== undefined) {
    return {
      kind: 'error',
      error: classifyCommonError(500, { error: 'Response contains error envelope despite success flag' }),
    }
  }

  const draft = parsedBody.draft as DraftDto

  // missionId는 반드시 유효 UUID string 이어야 하며 요청 ID와 일치해야 함
  if (typeof draft.missionId !== 'string' || !UUID_REGEX.test(draft.missionId) || draft.missionId !== trimmedId) {
    return {
      kind: 'error',
      error: classifyCommonError(500, { error: 'Mission ID invalid or mismatch' }),
    }
  }

  // channels 필드 및 요소 검증
  if (!hasValidChannels(draft.channels)) {
    return {
      kind: 'error',
      error: classifyCommonError(500, { error: 'Invalid channels field shape' }),
    }
  }

  // selectedImageIds 필드 및 요소 검증
  if (!hasValidSelectedImageIds(draft.selectedImageIds)) {
    return {
      kind: 'error',
      error: classifyCommonError(500, { error: 'Invalid selectedImageIds field shape' }),
    }
  }

  // mediaPreviews 필드 및 요소 검증
  if (!hasValidMediaPreviews(draft.mediaPreviews)) {
    return {
      kind: 'error',
      error: classifyCommonError(500, { error: 'Invalid mediaPreviews field shape' }),
    }
  }

  // 요청 workspaceId가 지정된 경우 초안 내부 workspaceId 불일치 차단
  if (workspaceId && typeof draft.workspaceId === 'string' && draft.workspaceId !== workspaceId) {
    return {
      kind: 'error',
      error: classifyCommonError(500, { error: 'Workspace ID mismatch' }),
    }
  }

  const missionStatus = typeof parsedBody.missionStatus === 'string' ? parsedBody.missionStatus : null

  return {
    kind: 'ready',
    draft,
    missionStatus,
  }
}
