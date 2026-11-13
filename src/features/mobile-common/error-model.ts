/**
 * 공통 에러 모델 — 실서버 응답(HTTP 상태 + `{ error, code }`)을 사용자 문구로 옮긴다.
 *
 * 화면에는 서버가 보낸 error 문자열을 그대로 그리지 않는다. 이 프로젝트의 API 는
 * `{ error: 'Failed to list evidence' }` 처럼 영문·내부 문구를 그대로 내려보내는 곳이 있고
 * (`src/app/api/evidence/route.ts:49`), 그 문구를 사용자 화면에 노출하면 내부 사정이 새어 나간다.
 * 상태 코드로 사용자 문구를 고르고, 원문·코드는 진단용으로만 보관한다.
 *
 * 2xx 가 들어와도 성공으로 바꾸지 않는다(호출 측 실수). 응답을 해석할 수 없을 때도
 * 0건·성공으로 위장하지 않고 '확인 실패'로 둔다(fail-closed).
 */
import type { StateKind } from '@/components/mobile-ui'

export type ErrorStatus = number | 'network'

/** 공통 상태 UI 가 실제로 그릴 수 있는 에러 계열만 쓴다. `ready`·`confirmed_empty` 는 에러가 아니다. */
export type CommonErrorKind = Extract<StateKind, 'error' | 'offline' | 'session_expired' | 'unauthorized'>

export type ErrorAction =
  | 'retry'
  | 'sign_in'
  | 'ask_admin'
  | 'confirm_changed'
  | 'wait_then_retry'
  | 'back'

export interface ServerErrorEnvelope {
  /** 서버가 보낸 error/message 문자열. 영문·내부 문구일 수 있으므로 화면에 그리지 않는다. */
  message: string | null
  /** 서버가 보낸 code. 있는 응답만 채워진다. 화면에 그리지 않는다. */
  code: string | null
}

export interface CommonError {
  kind: CommonErrorKind
  title: string
  description: string
  action: ErrorAction
  actionLabel: string
  /** 같은 요청을 자동으로 다시 보내도 되는가. 로그인·권한·충돌은 사람이 먼저 확인해야 한다. */
  retryable: boolean
  /** 진단용. 화면에 렌더하지 않는다. */
  status: ErrorStatus
  /** 진단용. 화면에 렌더하지 않는다. */
  envelope: ServerErrorEnvelope
}

/** 진단 문자열은 로그·전송 실패 보고에만 쓰고, 길이를 잘라 본문 전체가 쌓이지 않게 한다. */
const MAX_DIAGNOSTIC = 300

/** 403 이지만 권한 문제가 아닌 코드. 기다리거나 설정을 마쳐야 한다. */
const NOT_READY_CODES = new Set(['WORKSPACE_NOT_IN_LIVE_ROLLOUT', 'SOHEE_NOT_READY'])

/** 409 지만 내용 충돌이 아닌 상태 오류. 바뀐 내용을 확인해도 풀리지 않는다. */
const STATE_CONFLICT_CODES = new Set(['INVALID_MISSION_STATE', 'CONCURRENT_RETRY_IN_PROGRESS'])

/** 409 지만 충돌이 아니라 같은 작업이 이미 도는 중이다. 기다렸다 다시 보내면 된다. */
const IN_FLIGHT_CODES = new Set(['CHANNEL_PUBLISH_IN_PROGRESS', 'CONCURRENT_PUBLISH_IN_PROGRESS'])

/** 409 지만 사람이 이전 실행 결과를 먼저 확인해야 풀린다. 다시 보내면 안 된다. */
const REVIEW_BLOCKED_CODES = new Set(['STRANDED_EXECUTION_NEEDS_REVIEW', 'RESULT_UNKNOWN_RETRY_BLOCKED'])

/** 422 이지만 입력값 문제. 화면을 새로 여는 것으로는 풀리지 않는다. */
const INVALID_INPUT_CODES = new Set(['INVALID_INPUT', 'INVALID_MISSION_UUID', 'INVALID_RETRY_CHANNEL'])

/** 422 지만 이미 처리가 끝난 상태. 다시 시도할 일이 아니다. */
const ALREADY_DONE_CODES = new Set(['CHANNEL_ALREADY_VERIFIED'])

/** 422 지만 선행 기록(승인)이 없어 앞 단계로 돌아가야 한다. 입력 탓이 아니다. */
const PRECONDITION_MISSING_CODES = new Set(['CORRUPTED_APPROVAL_METADATA'])

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

function diagnosticText(value: string): string | null {
  const text = value.trim()
  if (text.length === 0) return null
  // 프록시·CDN 이 돌려준 HTML 오류 페이지는 사용자 문구도 진단 문구도 아니다.
  if (text.startsWith('<')) return null
  return text.slice(0, MAX_DIAGNOSTIC)
}

/**
 * 실제 API 응답 본문에서 `{ error, code }` 를 안전하게 읽는다.
 * 본문이 문자열이거나 JSON 이 아니거나 null 이어도 던지지 않는다.
 */
export function readErrorEnvelope(body: unknown): ServerErrorEnvelope {
  if (typeof body === 'string') return { message: diagnosticText(body), code: null }
  if (!isRecord(body)) return { message: null, code: null }
  // 이 프로젝트의 일부 라우트는 `{ error: { code, message } }` 중첩 봉투를 쓴다.
  if (isRecord(body.error)) {
    return {
      message: typeof body.error.message === 'string' ? diagnosticText(body.error.message) : null,
      code: typeof body.error.code === 'string' ? diagnosticText(body.error.code) : null,
    }
  }
  const message =
    typeof body.error === 'string'
      ? diagnosticText(body.error)
      : typeof body.message === 'string'
        ? diagnosticText(body.message)
        : null
  const code = typeof body.code === 'string' ? diagnosticText(body.code) : null
  return { message, code }
}

const base = (status: ErrorStatus, body: unknown) => ({
  status,
  envelope: readErrorEnvelope(body),
})

/** 상태 코드 하나로 사용자 문구·다음 행동을 고른다. 모르는 상태는 '확인 실패'로 둔다. */
export function classifyCommonError(status: ErrorStatus, body?: unknown): CommonError {
  if (status === 'network' || status === 0) {
    return {
      ...base(status, body),
      kind: 'offline',
      title: '네트워크에 연결되지 않았어요',
      description: '연결되면 서버에서 다시 확인해요. 지금 보이는 내용은 최신이 아닐 수 있어요.',
      action: 'retry',
      actionLabel: '다시 확인',
      retryable: true,
    }
  }

  if (status === 401) {
    return {
      ...base(status, body),
      kind: 'session_expired',
      title: '로그인이 만료됐어요',
      description: '다시 로그인하면 이어서 볼 수 있어요.',
      action: 'sign_in',
      actionLabel: '다시 로그인',
      retryable: false,
    }
  }

  if (status === 403) {
    const code = readErrorEnvelope(body).code
    // 403 이 항상 '권한이 없다'는 뜻은 아니다. 준비가 덜 된 가게는 기다려야 한다.
    if (code !== null && NOT_READY_CODES.has(code)) {
      return {
        ...base(status, body),
        kind: 'error',
        title: '아직 준비 중이에요',
        description: '가게 설정이 끝나면 이용할 수 있어요. 설정을 마친 뒤 다시 확인해 주세요.',
        action: 'wait_then_retry',
        actionLabel: '잠시 뒤 다시',
        retryable: true,
      }
    }
    return {
      ...base(status, body),
      kind: 'unauthorized',
      title: '이 내용을 볼 권한이 없어요',
      description: '가게 관리자에게 권한을 요청해 주세요.',
      action: 'ask_admin',
      actionLabel: '권한 요청',
      retryable: false,
    }
  }

  if (status === 404) {
    const code = readErrorEnvelope(body).code
    // 404 는 삭제만 뜻하지 않는다. 권한 은닉·주소 오타일 수 있으니 코드가 확실할 때만 단정한다.
    const definitelyGone = code !== null && /_NOT_FOUND$/.test(code)
    return {
      ...base(status, body),
      kind: 'error',
      title: '찾을 수 없어요',
      description: definitelyGone
        ? '이미 삭제되었거나 주소가 달라졌을 수 있어요.'
        : '이 주소로는 열 수 없어요. 주소가 바뀌었거나 지금은 열 수 없는 내용일 수 있어요.',
      action: 'back',
      actionLabel: '돌아가기',
      retryable: false,
    }
  }

  if (status === 409) {
    const code = readErrorEnvelope(body).code
    // 409 가 항상 '다른 곳에서 먼저 바뀜'은 아니다. 같은 작업이 도는 중이면 기다리면 풀린다.
    if (code !== null && IN_FLIGHT_CODES.has(code)) {
      return {
        ...base(status, body),
        kind: 'error',
        title: '지금 처리 중이에요',
        description: '같은 작업이 이미 진행 중이에요. 조금 기다렸다가 다시 확인해 주세요.',
        action: 'wait_then_retry',
        actionLabel: '잠시 뒤 다시',
        retryable: true,
      }
    }
    // 이전 실행 결과가 확인되지 않았으면 다시 보내면 안 된다.
    if (code !== null && REVIEW_BLOCKED_CODES.has(code)) {
      return {
        ...base(status, body),
        kind: 'error',
        title: '결과를 확인하는 중이에요',
        description: '이전 실행 결과가 아직 확인되지 않아 다시 시도하지 않았어요. 확인이 끝나면 결과를 볼 수 있어요.',
        action: 'back',
        actionLabel: '돌아가기',
        retryable: false,
      }
    }
    // 409 가 항상 '다른 곳에서 먼저 바뀜'은 아니다. 상태 오류는 다시 확인해도 그대로다.
    if (code !== null && STATE_CONFLICT_CODES.has(code)) {
      return {
        ...base(status, body),
        kind: 'error',
        title: '지금 상태에서는 할 수 없어요',
        description: '이미 처리됐거나 순서가 달라서 진행하지 않았어요. 화면을 새로 열어 현재 상태를 확인해 주세요.',
        action: 'back',
        actionLabel: '돌아가기',
        retryable: false,
      }
    }
    return {
      ...base(status, body),
      kind: 'error',
      title: '내용이 바뀌었어요',
      description: '다른 곳에서 먼저 바뀌어서 지금 내용으로 진행하지 않았어요. 바뀐 내용을 다시 확인해 주세요.',
      action: 'confirm_changed',
      actionLabel: '바뀐 내용 확인',
      retryable: false,
    }
  }

  if (status === 422) {
    const code = readErrorEnvelope(body).code
    // 입력값 문제는 화면을 새로 여는 것으로 풀리지 않는다. 무엇을 고쳐야 하는지 알린다.
    if (code !== null && INVALID_INPUT_CODES.has(code)) {
      return {
        ...base(status, body),
        kind: 'error',
        title: '입력한 내용을 확인해 주세요',
        description: '보낸 내용 중 형식이 맞지 않는 항목이 있어 진행하지 않았어요.',
        action: 'back',
        actionLabel: '돌아가기',
        retryable: false,
      }
    }
    // 이미 처리가 끝난 것을 다시 시도하게 만들지 않는다.
    if (code !== null && ALREADY_DONE_CODES.has(code)) {
      return {
        ...base(status, body),
        kind: 'error',
        title: '이미 처리됐어요',
        description: '이미 발행 확인이 끝난 채널이에요. 다시 진행하지 않았어요.',
        action: 'back',
        actionLabel: '돌아가기',
        retryable: false,
      }
    }
    // 승인 같은 앞 단계 기록이 없으면 입력 문제가 아니다.
    if (code !== null && PRECONDITION_MISSING_CODES.has(code)) {
      return {
        ...base(status, body),
        kind: 'error',
        title: '다시 승인이 필요해요',
        description: '이전 승인 기록을 확인할 수 없어 진행하지 않았어요. 승인부터 다시 진행해 주세요.',
        action: 'back',
        actionLabel: '돌아가기',
        retryable: false,
      }
    }
  }

  if (status === 429) {
    return {
      ...base(status, body),
      kind: 'error',
      title: '잠시 뒤에 다시 확인해 주세요',
      description: '요청이 많아 잠깐 멈췄어요. 조금 기다렸다가 다시 확인할게요.',
      action: 'wait_then_retry',
      actionLabel: '잠시 뒤 다시',
      retryable: true,
    }
  }

  if (status === 408) {
    return {
      ...base(status, body),
      kind: 'error',
      title: '연결이 오래 걸렸어요',
      description: '서버 응답이 오지 않아 확인을 마치지 못했어요. 다시 확인해 주세요.',
      action: 'retry',
      actionLabel: '다시 확인',
      retryable: true,
    }
  }

  if (status >= 400 && status < 500) {
    return {
      ...base(status, body),
      kind: 'error',
      title: '요청을 처리하지 못했어요',
      description: '보내는 내용에 문제가 있어 진행하지 않았어요. 화면을 새로 열어 다시 시도해 주세요.',
      action: 'back',
      actionLabel: '돌아가기',
      retryable: false,
    }
  }

  if (status >= 500) {
    return {
      ...base(status, body),
      kind: 'error',
      title: '서버에서 확인하지 못했어요',
      description: '내용이 없는 것이 아니라 확인에 실패한 상태예요. 다시 확인해 주세요.',
      action: 'retry',
      actionLabel: '다시 확인',
      retryable: true,
    }
  }

  // 2xx·음수·NaN 등 에러로 부르면 안 되는 값. 성공으로 추정하지 않고 확인 실패로 둔다.
  return {
    ...base(status, body),
    kind: 'error',
    title: '응답을 확인하지 못했어요',
    description: '서버 응답을 해석하지 못했어요. 내용이 없는 것이 아니니 다시 확인해 주세요.',
    action: 'retry',
    actionLabel: '다시 확인',
    retryable: true,
  }
}
