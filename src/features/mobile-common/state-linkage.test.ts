import { describe, expect, it } from 'vitest'
import { classifyCommonError } from './error-model'
import {
  classifyServerResponse,
  classifyTransportFailure,
  isFailure,
  loadingState,
  reentryVerdict,
} from './state-linkage'

/**
 * 수용 기준 6상태 = 권한 없음 · 부분데이터 · 만료 · 진행 · 실패 · 되돌아옴.
 * 에러 모델에 자리가 없던 2xx 응답들이 성공·0건으로 뒤섞이지 않는지 고정한다.
 */
describe('classifyServerResponse', () => {
  describe('Given 2xx 이고 내용이 온전할 때', () => {
    it('Then ready 로 두고 확인 시각을 함께 넘긴다', () => {
      const state = classifyServerResponse({
        status: 200,
        body: { items: [{ id: 'a' }] },
        itemCount: 1,
        checkedAt: '2026-10-24T01:00:00.000Z',
      })
      expect(isFailure(state)).toBe(false)
      if (isFailure(state)) throw new Error('unreachable')
      expect(state.kind).toBe('ready')
      expect(state.checkedAt).toBe('2026-10-24T01:00:00.000Z')
      // 진단용 상태·봉투는 보관하되 화면 문구에는 쓰지 않는다.
      expect(state.status).toBe(200)
    })

    it('Then 204 는 빈 목록이지 오류가 아니다', () => {
      const state = classifyServerResponse({ status: 204 })
      expect(isFailure(state)).toBe(false)
      expect(state.kind).toBe('confirmed_empty')
    })

    it('Then 조회 결과 0건은 confirmed_empty 로 두고 성공 문구를 쓰지 않는다', () => {
      const state = classifyServerResponse({ status: 200, body: { items: [] }, itemCount: 0 })
      expect(state.kind).toBe('confirmed_empty')
      expect(state.title).toBe('아직 아무것도 없어요')
    })

    it('Then 확인하지 않은 목록을 0건으로 만들지 않는다', () => {
      // itemCount 를 넘기지 않으면 '비었다'고 단정할 근거가 없다.
      const state = classifyServerResponse({ status: 200, body: {} })
      expect(state.kind).toBe('ready')
    })
  })

  describe('Given 2xx 이지만 내용이 일부만 왔을 때', () => {
    it('Then partial 로 두고 나머지를 다시 확인한다고 알린다', () => {
      const state = classifyServerResponse({ status: 200, complete: false, itemCount: 3 })
      expect(isFailure(state)).toBe(false)
      expect(state.kind).toBe('partial')
      expect(state.description).toContain('나머지')
    })

    it('Then 오래된 내용은 stale 로 두고 최신이 아니라고 알린다', () => {
      const state = classifyServerResponse({ status: 200, loadState: 'stale', itemCount: 2 })
      expect(state.kind).toBe('stale')
      expect(state.description).toContain('최신')
    })
  })

  describe('Given 2xx 처럼 보이지만 서버가 확인 실패를 뜻할 때', () => {
    it('Then 0건으로 위장하지 않고 확인 실패로 둔다', () => {
      const state = classifyServerResponse({ status: 200, loadState: 'error', body: { error: 'snapshot unavailable' } })
      expect(isFailure(state)).toBe(true)
      if (!isFailure(state)) throw new Error('unreachable')
      expect(state.kind).toBe('error')
      expect(state.retryable).toBe(true)
      expect(state.description).toContain('아니라')
      expect(state.envelope.message).toBe('snapshot unavailable')
    })

    it('Then itemCount 0 이어도 확인 실패를 빈 목록으로 덮지 않는다', () => {
      const state = classifyServerResponse({ status: 200, loadState: 'error', itemCount: 0 })
      expect(isFailure(state)).toBe(true)
    })
  })

  describe('Given 실제 오류 응답일 때', () => {
    it('Then 기존 에러 모델의 판정을 그대로 쓴다', () => {
      for (const status of [400, 401, 403, 404, 409, 422, 429, 500, 502]) {
        const state = classifyServerResponse({ status })
        const error = classifyCommonError(status)
        expect(isFailure(state)).toBe(true)
        if (!isFailure(state)) throw new Error('unreachable')
        expect(state.kind).toBe(error.kind)
        expect(state.action).toBe(error.action)
        expect(state.title).toBe(error.title)
      }
    })

    it('Then 초안 복원(first-post) GET 실반환 코드(401/404/422/500)를 구분한다', () => {
      // 401: 인증 세션 필요
      const s401 = classifyServerResponse({ status: 401, body: { error: '인증 세션이 필요합니다.' } })
      expect(isFailure(s401)).toBe(true)
      if (isFailure(s401)) {
        expect(s401.kind).toBe('session_expired')
        expect(s401.action).toBe('sign_in')
      }

      // 404: MISSION_NOT_FOUND (삭제/주소 변경)
      const s404 = classifyServerResponse({ status: 404, body: { error: '초안을 찾을 수 없습니다.', code: 'MISSION_NOT_FOUND' } })
      expect(isFailure(s404)).toBe(true)
      if (isFailure(s404)) {
        expect(s404.description).toContain('삭제')
        expect(s404.action).toBe('back')
      }

      // 422: INVALID_MISSION_UUID (입력 형식 확인)
      const s422 = classifyServerResponse({ status: 422, body: { error: 'missionId는 유효한 UUID 형식이어야 합니다.', code: 'INVALID_MISSION_UUID' } })
      expect(isFailure(s422)).toBe(true)
      if (isFailure(s422)) {
        expect(s422.title).toBe('입력한 내용을 확인해 주세요')
        expect(s422.action).toBe('back')
      }

      // 500: DB_READ_ERROR (다시 확인)
      const s500 = classifyServerResponse({ status: 500, body: { error: '미션 조회 중 오류가 발생했어요.', code: 'DB_READ_ERROR' } })
      expect(isFailure(s500)).toBe(true)
      if (isFailure(s500)) {
        expect(s500.kind).toBe('error')
        expect(s500.retryable).toBe(true)
      }
    })
  })

  describe('Given 6상태 표본', () => {
    it('Then 각 상태가 서로 다른 자리로 떨어진다', () => {
      const states = [
        classifyServerResponse({ status: 403 }), // 권한 없음
        classifyServerResponse({ status: 200, complete: false }), // 부분데이터
        classifyServerResponse({ status: 401 }), // 만료
        loadingState(), // 진행
        classifyServerResponse({ status: 500 }), // 실패
        classifyServerResponse({ status: 200, loadState: 'stale' }), // 되돌아옴
      ]
      expect(states.map((state) => state.kind)).toEqual([
        'unauthorized',
        'partial',
        'session_expired',
        'loading',
        'error',
        'stale',
      ])
      for (const state of states) {
        expect(state.title).not.toContain('성공')
        expect(state.title).not.toContain('완료')
      }
    })
  })
})

describe('loadingState', () => {
  it('Then 에러가 아니라 진행 상태다', () => {
    const state = loadingState()
    expect(isFailure(state)).toBe(false)
    expect(state.kind).toBe('loading')
    expect(state.checkedAt).toBeNull()
    expect(state.status).toBeNull()
  })
})

describe('classifyTransportFailure', () => {
  it('Then 화면을 떠난 abort 를 오류로 승격하지 않는다', () => {
    const error = new Error('aborted')
    error.name = 'AbortError'
    expect(classifyTransportFailure(error)).toBe('aborted')
  })

  it('Then 시간 초과는 다시 시도할 수 있는 사건이다', () => {
    const error = new Error('timed out')
    error.name = 'TimeoutError'
    expect(classifyTransportFailure(error)).toBe('timeout')
  })

  it('Then 나머지 예외는 네트워크 실패로 본다', () => {
    expect(classifyTransportFailure(new TypeError('Failed to fetch'))).toBe('network')
    expect(classifyTransportFailure('boom')).toBe('network')
    expect(classifyTransportFailure(null)).toBe('network')
  })
})

describe('reentryVerdict', () => {
  const input = { checkedAt: '2026-10-24T01:00:00.000Z', maxAgeMs: 60_000 }

  it('Then 허용 시간 안에 돌아오면 서버 기준 그대로다', () => {
    expect(reentryVerdict({ ...input, returnedAt: '2026-10-24T01:00:30.000Z' })).toBe('fresh')
  })

  it('Then 허용 시간을 넘겨 돌아오면 다시 확인해야 한다', () => {
    expect(reentryVerdict({ ...input, returnedAt: '2026-10-24T01:05:00.000Z' })).toBe('stale')
  })

  it('Then 시각을 읽을 수 없으면 최신이라고 하지 않는다', () => {
    expect(reentryVerdict({ checkedAt: '어제', returnedAt: '2026-10-24T01:00:00.000Z', maxAgeMs: 60_000 })).toBe('stale')
    expect(reentryVerdict({ checkedAt: input.checkedAt, returnedAt: null, maxAgeMs: 60_000 })).toBe('stale')
  })
})
