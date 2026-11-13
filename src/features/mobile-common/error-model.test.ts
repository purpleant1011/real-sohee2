import { describe, expect, it } from 'vitest'
import { classifyCommonError, readErrorEnvelope, type ErrorStatus } from './error-model'

/** 이 프로젝트 API 가 실제로 내려보내는 응답 형태 그대로. */
const REAL_RESPONSES: { status: ErrorStatus; body: unknown; source: string }[] = [
  { status: 401, body: { error: '인증 세션이 필요합니다.' }, source: 'src/app/api/evidence/route.ts:21' },
  { status: 403, body: { error: '해당 워크스페이스에 대한 접근 권한이 없습니다.' }, source: 'src/app/api/evidence/route.ts:33' },
  { status: 404, body: { error: '초안을 찾을 수 없습니다.', code: 'MISSION_NOT_FOUND' }, source: 'src/app/api/missions/first-post/[missionId]/route.ts:41' },
  { status: 422, body: { error: 'missionId는 유효한 UUID 형식이어야 합니다.', code: 'INVALID_MISSION_UUID' }, source: 'src/app/api/missions/first-post/[missionId]/route.ts:15' },
  { status: 500, body: { error: 'Failed to list evidence' }, source: 'src/app/api/evidence/route.ts:49' },
  { status: 500, body: { error: '미션 조회 중 오류가 발생했어요.', code: 'DB_READ_ERROR' }, source: 'src/app/api/missions/first-post/[missionId]/route.ts:39' },
]

describe('classifyCommonError', () => {
  describe('Given 이 프로젝트 API 가 실제로 내려보내는 오류 응답일 때', () => {
    it('Then 상태마다 다른 다음 행동을 고르고 성공으로 두지 않는다', () => {
      const expected: Record<number, string> = {
        401: 'sign_in',
        403: 'ask_admin',
        404: 'back',
        422: 'back',
        409: 'confirm_changed',
        429: 'wait_then_retry',
        500: 'retry',
      }
      for (const [status, action] of Object.entries(expected)) {
        expect(classifyCommonError(Number(status)).action).toBe(action)
      }
    })

    it('Then 401·403 은 자동 재시도하지 않고, 5xx 는 재시도한다', () => {
      expect(classifyCommonError(401).retryable).toBe(false)
      expect(classifyCommonError(403).retryable).toBe(false)
      expect(classifyCommonError(409).retryable).toBe(false)
      expect(classifyCommonError(500).retryable).toBe(true)
      expect(classifyCommonError('network').retryable).toBe(true)
    })
  })

  describe('Given 서버가 영문·내부 문구를 그대로 내려보냈을 때', () => {
    it('Then 화면 문구에 서버 원문을 그대로 쓰지 않는다', () => {
      for (const response of REAL_RESPONSES) {
        const error = classifyCommonError(response.status, response.body)
        expect(error.title).not.toContain('Failed')
        expect(error.description).not.toContain('Failed')
        expect(error.title).not.toContain('인증 세션이 필요합니다')
        expect(error.description).not.toContain('인증 세션이 필요합니다')
      }
    })

    it('Then 원문과 코드는 진단용으로만 보관한다', () => {
      const error = classifyCommonError(404, { error: '초안을 찾을 수 없습니다.', code: 'MISSION_NOT_FOUND' })
      expect(error.envelope).toEqual({ message: '초안을 찾을 수 없습니다.', code: 'MISSION_NOT_FOUND' })
      expect(error.status).toBe(404)
    })
  })

  describe('Given 응답 본문이 JSON 이 아니거나 비어 있을 때', () => {
    it('Then 던지지 않고 진단 문구를 비운다', () => {
      for (const body of [null, undefined, '', '   ', '<html>502 Bad Gateway</html>', [], 42, { error: 42 }]) {
        const envelope = readErrorEnvelope(body)
        expect(envelope.message).toBeNull()
        expect(envelope.code).toBeNull()
      }
      expect(classifyCommonError(502, '<html>502 Bad Gateway</html>').kind).toBe('error')
    })

    it('Then 긴 진단 문구는 잘라서 보관한다', () => {
      const envelope = readErrorEnvelope({ error: 'x'.repeat(1000) })
      expect(envelope.message).toHaveLength(300)
    })
  })

  describe('Given 에러가 아닌 상태값이 들어왔을 때', () => {
    it('Then 2xx 를 성공으로 바꾸지 않고 확인 실패로 둔다', () => {
      const error = classifyCommonError(200)
      expect(error.kind).toBe('error')
      expect(error.title).toBe('응답을 확인하지 못했어요')
      expect(error.retryable).toBe(true)
    })

    it('Then 네트워크 끊김과 0 은 오프라인으로 다룬다', () => {
      expect(classifyCommonError('network').kind).toBe('offline')
      expect(classifyCommonError(0).kind).toBe('offline')
    })
  })

  describe('Given 403 인데 권한 문제가 아닌 코드일 때', () => {
    it('Then 기다리면 풀리는 일로 안내하고 다시 시도하게 한다', () => {
      for (const code of ['WORKSPACE_NOT_IN_LIVE_ROLLOUT', 'SOHEE_NOT_READY']) {
        const error = classifyCommonError(403, { error: 'Forbidden', code })
        expect(error.kind).toBe('error')
        expect(error.title).toBe('아직 준비 중이에요')
        expect(error.action).toBe('wait_then_retry')
        expect(error.retryable).toBe(true)
        expect(error.description).not.toContain('권한')
      }
    })

    it('Then 코드가 없는 403 은 기존 권한 안내를 유지한다', () => {
      const error = classifyCommonError(403, { error: 'Forbidden' })
      expect(error.kind).toBe('unauthorized')
      expect(error.action).toBe('ask_admin')
    })
  })

  describe('Given 409 인데 내용 충돌이 아닌 상태 오류일 때', () => {
    it('Then 바뀐 내용을 보게 하지 않고 현재 상태를 다시 열게 한다', () => {
      for (const code of ['INVALID_MISSION_STATE', 'CONCURRENT_RETRY_IN_PROGRESS']) {
        const error = classifyCommonError(409, { error: 'Conflict', code })
        expect(error.title).toBe('지금 상태에서는 할 수 없어요')
        expect(error.action).toBe('back')
        expect(error.retryable).toBe(false)
      }
    })

    it('Then 코드가 없는 409 는 기존 충돌 안내를 유지한다', () => {
      expect(classifyCommonError(409, { error: 'Conflict' }).action).toBe('confirm_changed')
    })
  })

  describe('Given 409 인데 같은 작업이 이미 진행 중일 때', () => {
    // 근거: retry/route.ts:97, publish/route.ts:394(중복 발행 방지), 채널 가드 409
    it('Then 바뀐 내용 확인이 아니라 기다렸다 다시 확인하게 한다', () => {
      for (const code of ['CHANNEL_PUBLISH_IN_PROGRESS', 'CONCURRENT_PUBLISH_IN_PROGRESS']) {
        const error = classifyCommonError(409, { error: 'Conflict', code })
        expect(error.title).toBe('지금 처리 중이에요')
        expect(error.action).toBe('wait_then_retry')
        expect(error.retryable).toBe(true)
        expect(error.title).not.toContain('바뀌')
        expect(error.actionLabel).not.toContain('바뀐')
      }
    })
  })

  describe('Given 409 인데 사람이 결과를 먼저 확인해야 할 때', () => {
    // 근거: retry/route.ts:109-125(STRANDED_EXECUTION_NEEDS_REVIEW, RESULT_UNKNOWN_RETRY_BLOCKED)
    it('Then 다시 시도시키지 않고 확인이 끝날 때까지 막는다', () => {
      for (const code of ['STRANDED_EXECUTION_NEEDS_REVIEW', 'RESULT_UNKNOWN_RETRY_BLOCKED']) {
        const error = classifyCommonError(409, { error: 'Conflict', code })
        expect(error.title).toBe('결과를 확인하는 중이에요')
        expect(error.action).toBe('back')
        expect(error.retryable).toBe(false)
        expect(error.title).not.toContain('바뀌')
      }
    })
  })

  describe('Given 422 인데 입력값 문제일 때', () => {
    // 근거: retry/route.ts:40,85,91, missions/first-post/[missionId]/route.ts:15
    it('Then 화면을 새로 열라고 하지 않고 입력한 내용을 확인하게 한다', () => {
      for (const code of ['INVALID_INPUT', 'INVALID_MISSION_UUID', 'INVALID_RETRY_CHANNEL']) {
        const error = classifyCommonError(422, { error: 'Unprocessable', code })
        expect(error.title).toBe('입력한 내용을 확인해 주세요')
        expect(error.action).toBe('back')
        expect(error.retryable).toBe(false)
        expect(error.description).not.toContain('화면을 새로 열어')
      }
    })
  })

  describe('Given 422 인데 이미 처리가 끝난 상태일 때', () => {
    // 근거: retry/route.ts:94 CHANNEL_ALREADY_VERIFIED
    it('Then 다시 시도가 아니라 이미 끝났다는 사실을 알린다', () => {
      const error = classifyCommonError(422, { error: 'Unprocessable', code: 'CHANNEL_ALREADY_VERIFIED' })
      expect(error.title).toBe('이미 처리됐어요')
      expect(error.description).toContain('발행 확인')
      expect(error.action).toBe('back')
      expect(error.retryable).toBe(false)
    })
  })

  describe('Given 422 인데 선행 조건 기록이 없을 때', () => {
    // 근거: retry/route.ts:85 CORRUPTED_APPROVAL_METADATA
    it('Then 입력 탓으로 돌리지 않고 승인부터 다시 하게 안내한다', () => {
      const error = classifyCommonError(422, { error: 'Unprocessable', code: 'CORRUPTED_APPROVAL_METADATA' })
      expect(error.title).toBe('다시 승인이 필요해요')
      expect(error.action).toBe('back')
      expect(error.retryable).toBe(false)
      expect(error.description).not.toContain('보내는 내용에 문제')
    })
  })

  describe('Given 코드가 없는 422 일 때', () => {
    it('Then 기존 일반 4xx 안내를 유지한다', () => {
      const error = classifyCommonError(422, { error: 'Unprocessable' })
      expect(error.title).toBe('요청을 처리하지 못했어요')
      expect(error.action).toBe('back')
    })
  })

  describe('Given 404 인데 삭제를 뜻하는 코드가 없을 때', () => {
    it('Then 삭제됐다고 단정하지 않는다', () => {
      const withCode = classifyCommonError(404, { error: 'Not Found', code: 'MISSION_NOT_FOUND' })
      expect(withCode.description).toContain('삭제')
      const noCode = classifyCommonError(404, { error: 'Not Found' })
      expect(noCode.description).not.toContain('삭제')
      expect(noCode.description).toContain('열 수 없는')
      expect(noCode.title).toBe('찾을 수 없어요')
    })
  })

  describe('Given 서버가 { error: { code, message } } 중첩 봉투를 보냈을 때', () => {
    it('Then 안쪽 코드를 읽어 판정에 쓴다', () => {
      const envelope = readErrorEnvelope({ error: { code: 'SOHEE_NOT_READY', message: 'not ready' } })
      expect(envelope).toEqual({ code: 'SOHEE_NOT_READY', message: 'not ready' })
      expect(classifyCommonError(403, { error: { code: 'SOHEE_NOT_READY', message: 'not ready' } }).action).toBe(
        'wait_then_retry',
      )
    })

    it('Then 안쪽 message 도 화면에 그리지 않는다', () => {
      const error = classifyCommonError(500, { error: { code: 'DB_READ_ERROR', message: 'Failed to read table' } })
      expect(error.description).not.toContain('Failed')
    })
  })

  describe('Given 어떤 오류든', () => {
    it('Then 사용자 문구에 성공·완료 어휘를 쓰지 않는다', () => {
      const statuses: ErrorStatus[] = ['network', 0, 400, 401, 403, 404, 408, 409, 422, 429, 500, 502, 200]
      for (const status of statuses) {
        const error = classifyCommonError(status, { error: 'Internal failure: provider token' })
        for (const text of [error.title, error.description, error.actionLabel]) {
          expect(text).not.toContain('성공')
          expect(text).not.toContain('완료')
          expect(text).not.toContain('확인됨')
          expect(text).not.toContain('Internal failure')
          expect(text).not.toContain('token')
        }
      }
    })
  })
})
