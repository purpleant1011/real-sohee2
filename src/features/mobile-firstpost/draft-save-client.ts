import type { FirstPostMissionDraft } from '@/features/missions/conversational-first-post'
import { verifyDraftReadback } from './draft-readback-match'

export interface SaveFirstPostDraftCopiesParams {
  draft: FirstPostMissionDraft
  copies: FirstPostMissionDraft['copies']
  fetchImpl?: typeof fetch
  /**
   * 실제 재조회 콜백 주입 필수 (가짜 자동 저장 성공 금지).
   * 세 번째 인자로 취소용 signal 을 받는다. 주입 구현이 signal 을 무시해도
   * 호출부는 상한 시간(race)으로 반드시 종료되지만, 실제 취소 효과는 보장되지 않는다.
   */
  readback: (missionId: string, workspaceId: string, options?: { signal: AbortSignal }) => Promise<unknown>
  /** 요청 및 재조회 상한 타임아웃 (ms, 기본 8000ms) */
  timeoutMs?: number
  /** 호출자(예: 화면 unmount)가 요청·재조회를 취소할 때 쓰는 외부 signal (선택) */
  signal?: AbortSignal
}

export type SaveFirstPostDraftCopiesResult =
  | { kind: 'saved'; newFingerprint: string; draft: FirstPostMissionDraft }
  | { kind: 'conflict'; latestDraft?: unknown }
  | { kind: 'invalid'; error?: string }
  | { kind: 'unauthorized'; error?: string }
  | { kind: 'unknown'; doNotRetry: true; reason: string; mismatches?: string[] }

// SHA-256 16진수 소문자 64자리 정규식
const FP_PATTERN = /^[a-f0-9]{64}$/

const POST_TIMEOUT_MESSAGE = '수정 요청 시간 초과'
const READBACK_TIMEOUT_MESSAGE = '재조회 시간 초과'
const READBACK_ABORT_MESSAGE = '재조회 취소됨'

function isPlainObject(val: unknown): val is Record<string, unknown> {
  return typeof val === 'object' && val !== null && !Array.isArray(val)
}

/**
 * 첫 포스팅 초안의 원고를 서버에 수정 요청(POST /api/missions/first-post/revise)하고,
 * 응답 직후 필수 readback을 수행하여 verifyDraftReadback이 100% 일치할 때만 kind: 'saved'로 완결한다.
 *
 * - W1 기존 응답 봉투 `{ draft: { approvalFingerprint } }` 및 `{ approvalFingerprint }` 양방향 호환
 * - 409/422/401 비정상 json 응답 안전 처리
 * - 전 구간(POST fetch + body parsing, readback) Bounded Timeout 적용으로 영구 대기 방지
 * - readback 에 AbortSignal 을 주입하고 timeout/unmount 취소를 연동
 * - expectedFingerprint 가 hex SHA-256 이 아니면 POST 없이 invalid
 * - 지문 hex SHA-256 [a-f0-9]{64} 엄격 정합
 */
export async function saveFirstPostDraftCopies(
  params: SaveFirstPostDraftCopiesParams
): Promise<SaveFirstPostDraftCopiesResult> {
  const { draft, copies, fetchImpl = fetch, readback, timeoutMs = 8000, signal: externalSignal } = params
  const { missionId, workspaceId, approvalFingerprint: expectedFingerprint, selectedImageIds } = draft

  // 0. POST 전 기준 지문 사전 검증 — 형식이 틀리면 서버를 두드리지 않는다.
  if (typeof expectedFingerprint !== 'string' || !FP_PATTERN.test(expectedFingerprint)) {
    return { kind: 'invalid', error: '기준 지문 형식이 올바르지 않아 저장을 시작하지 않았어요.' }
  }

  // 0-1. 진입 시점에 이미 취소된 요청은 서버를 호출하지 않는다(성공 승격 0).
  if (externalSignal?.aborted) {
    return { kind: 'unknown', doNotRetry: true, reason: '요청이 취소되었습니다' }
  }

  // --- 1. POST 구간 (fetch + body parsing 전체를 deadline 레이스로 감쌈) ---
  const postController = new AbortController()
  let postTimerId: ReturnType<typeof setTimeout> | undefined
  let postExternalListener: (() => void) | undefined

  if (externalSignal) {
    if (externalSignal.aborted) {
      postController.abort()
    } else {
      postExternalListener = () => postController.abort()
      externalSignal.addEventListener('abort', postExternalListener)
    }
  }

  type PostExecutionResult =
    | { status: 'handled'; result: SaveFirstPostDraftCopiesResult }
    | { status: 'ok'; newFingerprint: string }

  const executePost = async (): Promise<PostExecutionResult> => {
    const res = await fetchImpl('/api/missions/first-post/revise', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-workspace-id': workspaceId,
      },
      body: JSON.stringify({
        missionId,
        copies,
        expectedFingerprint,
      }),
      signal: postController.signal,
    })

    if (res.status === 409) {
      const raw = await res.json().catch(() => null)
      const latest = isPlainObject(raw) && 'currentDraft' in raw ? raw.currentDraft : undefined
      return { status: 'handled', result: { kind: 'conflict', latestDraft: latest } }
    }

    if (res.status === 422) {
      const raw = await res.json().catch(() => null)
      const errText = isPlainObject(raw) && typeof raw.error === 'string' ? raw.error : '유효하지 않은 요청입니다.'
      return { status: 'handled', result: { kind: 'invalid', error: errText } }
    }

    if (res.status === 401 || res.status === 403) {
      const raw = await res.json().catch(() => null)
      const errText = isPlainObject(raw) && typeof raw.error === 'string' ? raw.error : '권한이 없습니다.'
      return { status: 'handled', result: { kind: 'unauthorized', error: errText } }
    }

    if (!res.ok) {
      return { status: 'handled', result: { kind: 'unknown', doNotRetry: true, reason: `서버 오류 (${res.status})` } }
    }

    let body: unknown
    try {
      body = await res.json()
    } catch {
      return { status: 'handled', result: { kind: 'unknown', doNotRetry: true, reason: '서버 응답 파싱 실패' } }
    }

    if (!isPlainObject(body)) {
      return { status: 'handled', result: { kind: 'unknown', doNotRetry: true, reason: '서버 응답 형식 불일치' } }
    }

    let newFingerprint: unknown = body.approvalFingerprint
    if (!newFingerprint && isPlainObject(body.draft)) {
      newFingerprint = body.draft.approvalFingerprint
    }

    if (typeof newFingerprint !== 'string' || !FP_PATTERN.test(newFingerprint)) {
      return { status: 'handled', result: { kind: 'unknown', doNotRetry: true, reason: '유효하지 않은 신규 지문 응답' } }
    }

    return { status: 'ok', newFingerprint }
  }

  const postTimeoutPromise = new Promise<never>((_, reject) => {
    postTimerId = setTimeout(() => {
      postController.abort()
      reject(new Error(POST_TIMEOUT_MESSAGE))
    }, timeoutMs)
  })

  let postOutcome: PostExecutionResult
  try {
    postOutcome = await Promise.race([executePost(), postTimeoutPromise])
  } catch (err: unknown) {
    const isAbort = err instanceof Error && (err.name === 'AbortError' || /aborted|취소/i.test(err.message))
    const isTimeout = err instanceof Error && err.message === POST_TIMEOUT_MESSAGE
    const msg = isTimeout ? POST_TIMEOUT_MESSAGE : isAbort ? '수정 요청이 취소되었습니다' : (err instanceof Error ? err.message : 'network error')
    return { kind: 'unknown', doNotRetry: true, reason: msg }
  } finally {
    clearTimeout(postTimerId)
    if (externalSignal && postExternalListener) externalSignal.removeEventListener('abort', postExternalListener)
  }

  if (postOutcome.status === 'handled') {
    return postOutcome.result
  }

  const newFingerprint = postOutcome.newFingerprint

  // --- 2. Readback 구간 (AbortSignal 주입 + race + finally timeout 정리) ---
  const readbackController = new AbortController()
  let readbackTimerId: ReturnType<typeof setTimeout> | undefined
  let readbackExternalListener: (() => void) | undefined
  let readbackAbortReason = READBACK_ABORT_MESSAGE

  // 게이트 리스너를 먼저 등록한다. 취소를 그 뒤에 트리거해야 이미 abort 된 signal 도
  // 이벤트를 놓치지 않고 레이스를 즉시 종료한다.
  const readbackGate = new Promise<never>((_, reject) => {
    readbackTimerId = setTimeout(() => {
      readbackAbortReason = READBACK_TIMEOUT_MESSAGE
      readbackController.abort()
      reject(new Error(readbackAbortReason))
    }, timeoutMs)
    readbackController.signal.addEventListener(
      'abort',
      () => reject(new Error(readbackAbortReason)),
      { once: true },
    )
  })

  if (externalSignal) {
    readbackExternalListener = () => readbackController.abort()
    externalSignal.addEventListener('abort', readbackExternalListener)
    // 리스너 등록 후 검사 — 이미 취소된 signal 도 게이트가 확실히 거절한다.
    if (externalSignal.aborted) readbackController.abort()
  }

  let actual: unknown
  try {
    actual = await Promise.race([
      readback(missionId, workspaceId, { signal: readbackController.signal }),
      readbackGate,
    ])
  } catch (readbackErr: unknown) {
    const msg = readbackErr instanceof Error ? readbackErr.message : 'readback error'
    return { kind: 'unknown', doNotRetry: true, reason: `재조회 실패: ${msg}` }
  } finally {
    clearTimeout(readbackTimerId)
    if (externalSignal && readbackExternalListener) externalSignal.removeEventListener('abort', readbackExternalListener)
  }

  const matchRes = verifyDraftReadback(
    {
      ...draft,
      missionId,
      workspaceId,
      copies,
      selectedImageIds,
      approvalFingerprint: newFingerprint,
    },
    actual
  )

  if (!matchRes.matches) {
    return {
      kind: 'unknown',
      doNotRetry: true,
      reason: '저장 후 재조회 내용 불일치',
      mismatches: matchRes.mismatches,
    }
  }

  // 최종 안전망: 검증 중 취소되었으면 saved 로 승격하지 않는다.
  if (externalSignal?.aborted) {
    return { kind: 'unknown', doNotRetry: true, reason: '요청이 취소되었습니다' }
  }

  return {
    kind: 'saved',
    newFingerprint,
    draft: actual as FirstPostMissionDraft,
  }
}
