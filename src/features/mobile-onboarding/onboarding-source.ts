// ANI-1781 (M03): GET /api/onboarding/quick-start 응답 → 화면 스냅샷/진행 판정 입력 변환.
//
// 응답(2026-10-24 확인)은 workspaceId/stage/profile/preferences/facts 를 내려준다.
// 단계 판정은 이 값만 쓰고, 사진은 화면의 사진 선택 영역(MediaUploadCard)이 스스로 조회한다.
// 실 응답은 5상태로 가른다 — 2xx+계약 일치 ready(빈/채움 구분) / 2xx+계약 밖 unknown /
// 4xx·5xx·응답 없음 error / 조회 전 loading / 재조회 실패 시 이전 확인 유지 stale.
// 어느 경우에도 빈 상태나 처음부터 다시 입력으로 위장하지 않는다(fail-closed).
import { TONE_PRESET_KEYS, type TonePresetKey } from '@/features/quick-start/tone-presets'
import type { LoadState } from '@/features/mobile-decision/contracts'
import type { OnboardingFacts, OnboardingProgressInput } from './onboarding-progress'

export type QuickStartProfilePayload = {
  business_name?: string
  industry?: string
  location?: string
  summary?: string
}

export type QuickStartSnapshot = {
  workspaceId: string
  stage: 'PREPARE_ONLY' | 'PUBLISH_READY'
  profile: QuickStartProfilePayload | null
  preferences: { tone: TonePresetKey | null } | null
  facts: OnboardingFacts
}

/** 화면이 받는 뷰 모델. 서버 값만 담고, 확인 시각을 함께 넘긴다. */
export type OnboardingViewSnapshot = {
  loadState: LoadState
  workspaceId: string | null
  profile: QuickStartProfilePayload | null
  preferences: { tone: TonePresetKey | null } | null
  facts: OnboardingFacts
  checkedAt: string | null
  /**
   * 서버에 저장된 가게 정보가 아직 없다(정상적인 첫 진입).
   * 조회 실패(error/unknown)와 다른 축이다 — 오류가 아니라 빈 상태다.
   */
  empty: boolean
}

/** GET 응답 한 건. status 가 null 이면 응답을 받지 못했다(네트워크·예외). */
export type OnboardingReadResponse = {
  status: number | null
  payload: unknown
}

const EMPTY_FACTS: OnboardingFacts = {
  TEXT_HARNESS_CONFIRMED: false,
  INSTAGRAM_VERIFIED: false,
  THREADS_VERIFIED: false,
}

function asText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined
}

function asFacts(value: unknown): OnboardingFacts {
  const raw = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
  return {
    TEXT_HARNESS_CONFIRMED: raw.TEXT_HARNESS_CONFIRMED === true,
    INSTAGRAM_VERIFIED: raw.INSTAGRAM_VERIFIED === true,
    THREADS_VERIFIED: raw.THREADS_VERIFIED === true,
  }
}

function asTone(value: unknown): TonePresetKey | null {
  return (TONE_PRESET_KEYS as readonly string[]).includes(value as string) ? (value as TonePresetKey) : null
}

/**
 * GET 응답 JSON 을 검증한다. 형태가 어긋나면 null — 호출자는 error 로 다뤄야 한다.
 */
export function parseQuickStartSnapshot(payload: unknown): QuickStartSnapshot | null {
  if (typeof payload !== 'object' || payload === null) return null
  const record = payload as Record<string, unknown>

  const workspaceId = asText(record.workspaceId)
  if (!workspaceId) return null

  const stage = record.stage
  if (stage !== 'PREPARE_ONLY' && stage !== 'PUBLISH_READY') return null

  let profile: QuickStartProfilePayload | null = null
  if (record.profile !== null && record.profile !== undefined) {
    if (typeof record.profile !== 'object') return null
    const raw = record.profile as Record<string, unknown>
    profile = {
      business_name: asText(raw.business_name),
      industry: asText(raw.industry),
      location: asText(raw.location),
      summary: asText(raw.summary),
    }
  }

  let preferences: QuickStartSnapshot['preferences'] = null
  if (typeof record.preferences === 'object' && record.preferences !== null) {
    preferences = { tone: asTone((record.preferences as Record<string, unknown>).tone) }
  }

  return { workspaceId, stage, profile, preferences, facts: asFacts(record.facts) }
}

/** 진행 판정 입력으로 바꾼다. 응답이 깨지면 error 로 구분한다. */
export function toOnboardingProgressInput(payload: unknown): OnboardingProgressInput {
  const snapshot = parseQuickStartSnapshot(payload)
  if (!snapshot) return { error: true }
  return { profile: snapshot.profile, facts: snapshot.facts }
}

/**
 * 실 서버 응답 한 건을 5상태로 나눈다.
 *
 * | 응답 | loadState | 근거 |
 * | --- | --- | --- |
 * | 2xx + 계약 일치 | ready (empty 로 빈/채움 구분) | 서버가 확인한 값 |
 * | 2xx + 계약 밖(JSON 아님·형식 불일치) | unknown | 판정 불가 — 빈 상태로 위장하지 않는다 |
 * | 4xx·5xx | error | 서버가 실패를 확정(권한 없음 포함) |
 * | 응답 없음(네트워크·예외) | error | 조회 실패 |
 *
 * 로딩(loading)과 이전 확인 유지(stale)는 조회 전/재조회 실패 시점에 정해진다.
 */
export function classifyOnboardingResponse(response: OnboardingReadResponse): {
  loadState: LoadState
  snapshot: QuickStartSnapshot | null
} {
  if (response.status === null) return { loadState: 'error', snapshot: null }
  if (response.status < 200 || response.status >= 300) return { loadState: 'error', snapshot: null }
  const snapshot = parseQuickStartSnapshot(response.payload)
  if (!snapshot) return { loadState: 'unknown', snapshot: null }
  return { loadState: 'ready', snapshot }
}

/**
 * 화면 스냅샷으로 바꾼다. 조회에 실패하면 error/unknown 스냅샷을 돌려준다 —
 * 빈 프로필(=처음부터 다시 입력)로 보이게 하지 않는다.
 */
export function toOnboardingViewSnapshotFromResponse(
  response: OnboardingReadResponse,
  checkedAt: string,
): OnboardingViewSnapshot {
  const { loadState, snapshot } = classifyOnboardingResponse(response)
  if (!snapshot) {
    return {
      loadState,
      workspaceId: null,
      profile: null,
      preferences: null,
      facts: EMPTY_FACTS,
      checkedAt,
      empty: false,
    }
  }
  return {
    loadState,
    workspaceId: snapshot.workspaceId,
    profile: snapshot.profile,
    preferences: snapshot.preferences,
    facts: snapshot.facts,
    checkedAt,
    // 저장된 프로필 행이 없다 = 사장님이 아직 입력한 값이 없다(정상 빈 상태).
    empty: snapshot.profile === null,
  }
}

/**
 * 마지막으로 확인한 내용을 유지한 채 재조회 실패를 알린다(stale).
 * 확인 시각은 마지막 성공 시각 그대로 — 보여주는 값의 근거 시각을 바꾸지 않는다.
 */
export function staleOnboardingView(previous: OnboardingViewSnapshot): OnboardingViewSnapshot {
  return { ...previous, loadState: 'stale' }
}

/** 아직 조회 전(첫 페인트) 상태. */
export function loadingOnboardingView(): OnboardingViewSnapshot {
  return {
    loadState: 'loading',
    workspaceId: null,
    profile: null,
    preferences: null,
    facts: EMPTY_FACTS,
    checkedAt: null,
    empty: false,
  }
}
