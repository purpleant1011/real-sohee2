// ANI-1781 (M03): quick-start GET 응답 → 화면 스냅샷/진행 판정 입력 어댑터 계약.
import { describe, expect, it } from 'vitest'
import {
  classifyOnboardingResponse,
  loadingOnboardingView,
  parseQuickStartSnapshot,
  staleOnboardingView,
  toOnboardingProgressInput,
  toOnboardingViewSnapshotFromResponse,
} from '../onboarding-source'
import { deriveOnboardingStep } from '../onboarding-progress'

const response = {
  workspaceId: 'ws-1',
  ready: false,
  stage: 'PREPARE_ONLY',
  progressPercent: 0,
  connectionHint: '채널을 연결하면 발행할 수 있어요',
  profile: { business_name: '봄날', industry: '카페·디저트', location: '서울', summary: '동네 카페' },
  preferences: { goal: '', tone: 'calm' },
  businessDetails: null,
  facts: { TEXT_HARNESS_CONFIRMED: true, INSTAGRAM_VERIFIED: false, THREADS_VERIFIED: false },
  blockers: [],
}

describe('parseQuickStartSnapshot', () => {
  it('정상 응답에서 진행 판정에 필요한 값만 남긴다', () => {
    expect(parseQuickStartSnapshot(response)).toEqual({
      workspaceId: 'ws-1',
      stage: 'PREPARE_ONLY',
      profile: { business_name: '봄날', industry: '카페·디저트', location: '서울', summary: '동네 카페' },
      preferences: { tone: 'calm' },
      facts: { TEXT_HARNESS_CONFIRMED: true, INSTAGRAM_VERIFIED: false, THREADS_VERIFIED: false },
    })
  })

  it('profile 이 null 이면 null 로 유지한다', () => {
    expect(parseQuickStartSnapshot({ ...response, profile: null })?.profile).toBeNull()
  })

  it('알 수 없는 말투 값은 null 로 낮춘다(임의 문자열을 화면에 쓰지 않는다)', () => {
    const parsed = parseQuickStartSnapshot({ ...response, preferences: { tone: 'shouty' } })
    expect(parsed?.preferences?.tone).toBeNull()
  })

  it('facts 가 없으면 모두 미확인이다', () => {
    expect(parseQuickStartSnapshot({ ...response, facts: undefined })?.facts).toEqual({
      TEXT_HARNESS_CONFIRMED: false,
      INSTAGRAM_VERIFIED: false,
      THREADS_VERIFIED: false,
    })
  })

  it('facts 의 true 가 아닌 값은 확인으로 세지 않는다', () => {
    const parsed = parseQuickStartSnapshot({ ...response, facts: { TEXT_HARNESS_CONFIRMED: 'yes' } })
    expect(parsed?.facts.TEXT_HARNESS_CONFIRMED).toBe(false)
  })

  it('workspaceId 가 없으면 조회 실패로 본다', () => {
    expect(parseQuickStartSnapshot({ ...response, workspaceId: '' })).toBeNull()
  })

  it('알 수 없는 stage 는 조회 실패로 본다', () => {
    expect(parseQuickStartSnapshot({ ...response, stage: 'UNKNOWN' })).toBeNull()
  })

  it('객체가 아니면 조회 실패로 본다', () => {
    expect(parseQuickStartSnapshot(null)).toBeNull()
    expect(parseQuickStartSnapshot('oops')).toBeNull()
  })
})

describe('toOnboardingProgressInput', () => {
  it('서버가 확인한 프로필과 사실만 넘긴다', () => {
    expect(toOnboardingProgressInput(response)).toEqual({
      profile: { business_name: '봄날', industry: '카페·디저트', location: '서울', summary: '동네 카페' },
      facts: { TEXT_HARNESS_CONFIRMED: true, INSTAGRAM_VERIFIED: false, THREADS_VERIFIED: false },
    })
  })

  it('응답이 깨지면 빈 상태가 아니라 error 로 구분한다', () => {
    expect(toOnboardingProgressInput({ stage: 'PREPARE_ONLY' })).toEqual({ error: true })
  })

  it('어댑터 결과로 온보딩 단계가 이어진다', () => {
    expect(deriveOnboardingStep(toOnboardingProgressInput({ ...response, profile: null })).step).toBe('shop')
  })

  it('가게 정보와 말투가 확인되면 계정 단계까지 이어진다', () => {
    expect(deriveOnboardingStep(toOnboardingProgressInput(response)).step).toBe('channels')
  })
})

describe('toOnboardingViewSnapshotFromResponse', () => {
  it('정상 응답이면 ready 스냅샷에 서버 값을 그대로 담는다', () => {
    expect(
      toOnboardingViewSnapshotFromResponse({ status: 200, payload: response }, '2026-10-24T00:00:00.000Z'),
    ).toEqual({
      loadState: 'ready',
      workspaceId: 'ws-1',
      profile: { business_name: '봄날', industry: '카페·디저트', location: '서울', summary: '동네 카페' },
      preferences: { tone: 'calm' },
      facts: { TEXT_HARNESS_CONFIRMED: true, INSTAGRAM_VERIFIED: false, THREADS_VERIFIED: false },
      checkedAt: '2026-10-24T00:00:00.000Z',
      empty: false,
    })
  })

  it('응답이 깨지면 빈 프로필이 아니라 판정 불가(unknown) 스냅샷이다 — 처음부터 다시 입력으로 위장하지 않는다', () => {
    const snapshot = toOnboardingViewSnapshotFromResponse({ status: 200, payload: null }, '2026-10-24T00:00:00.000Z')
    expect(snapshot.loadState).toBe('unknown')
    expect(snapshot.profile).toBeNull()
    expect(snapshot.workspaceId).toBeNull()
    expect(snapshot.checkedAt).toBe('2026-10-24T00:00:00.000Z')
    expect(snapshot.empty).toBe(false)
  })

  it('조회 전 상태는 loading 이고 확인 시각이 없다', () => {
    expect(loadingOnboardingView()).toMatchObject({ loadState: 'loading', checkedAt: null, workspaceId: null })
  })
})

describe('실 서버 응답 5상태 분류', () => {
  it('2xx + 계약 일치 → ready (저장된 프로필이 없으면 empty=true, 오류 아님)', () => {
    expect(classifyOnboardingResponse({ status: 200, payload: response }).loadState).toBe('ready')
    const empty = toOnboardingViewSnapshotFromResponse(
      { status: 200, payload: { ...response, profile: null } },
      '2026-10-24T00:00:00.000Z',
    )
    expect(empty).toMatchObject({ loadState: 'ready', empty: true, profile: null })
    expect(empty.workspaceId).toBe('ws-1')
  })

  it('2xx 인데 계약 밖 응답(JSON 아님·형식 불일치) → unknown', () => {
    expect(classifyOnboardingResponse({ status: 200, payload: null }).loadState).toBe('unknown')
    expect(classifyOnboardingResponse({ status: 200, payload: { success: true } }).loadState).toBe('unknown')
  })

  it('4xx·5xx → error (권한 없음 포함, 서버가 실패를 확정했다)', () => {
    for (const status of [401, 403, 422, 500, 503]) {
      expect(classifyOnboardingResponse({ status, payload: { error: 'nope' } }).loadState).toBe('error')
    }
  })

  it('응답 없음(네트워크·예외) → error', () => {
    expect(classifyOnboardingResponse({ status: null, payload: null }).loadState).toBe('error')
  })

  it('stale 은 마지막 확인 시각과 내용을 그대로 지킨다', () => {
    const ready = toOnboardingViewSnapshotFromResponse({ status: 200, payload: response }, '2026-10-24T00:00:00.000Z')
    expect(staleOnboardingView(ready)).toEqual({ ...ready, loadState: 'stale' })
  })
})
