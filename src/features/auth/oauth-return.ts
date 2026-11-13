/**
 * ANI-1761 AC-3: OAuth(구글) 복귀 안내.
 *
 * 사장님이 구글 로그인 창에서 돌아왔을 때 세 가지 결과가 있다 — 취소, 실패, 성공.
 * 셋을 한 문구로 뭉뚱그리면 "왜 다시 로그인 화면이 나왔는지" 알 수 없다. 여기서는
 * 결과를 구분해 **무엇이 일어났는지**와 **다음에 무엇을 하면 되는지**만 내려준다.
 *
 * 정직성 규칙:
 * - 취소와 실패를 섞지 않는다. 사용자가 창을 닫은 것(access_denied)과 연결이 끊긴 것은 다르다.
 * - 결과를 알 수 없으면 아는 척하지 않는다("확인하지 못했어요").
 * - 영문 오류 코드·내부 용어·제공자 이름 대신 사장님 언어로 쓴다.
 * - 여기서 외부 호출은 하지 않는다. 순수 매핑이다(가입 처리·OAuth 재호출 없음).
 */

export type OAuthReturnReason = 'cancelled' | 'failed' | 'connected'

export type OAuthReturnNotice = {
  reason: OAuthReturnReason
  /** alert = 즉시 읽어야 하는 안내, success = 완료 안내(스크린리더가 부드럽게 읽음) */
  tone: 'alert' | 'success'
  title: string
  detail: string
  /**
   * 다음 행동. 성공 복귀는 이미 목적지에 도착한 상태라 링크가 필요 없다 —
   * 자기 자신을 가리키는 죽은 링크를 만들지 않기 위해 null 을 쓴다.
   */
  action: { label: string; href: string } | null
}

export type OAuthReturnInput = {
  /** 콜백이 직접 표시하는 결과 구분값(cancelled | failed | connected) */
  oauth?: string | null
  /** 레거시·제공자 오류 코드 */
  error?: string | null
  /** 복귀 후 이어갈 경로(이미 정규화된 값) */
  next?: string | null
  /** 성공 안내에 쓸 로그인 제공자. 지정하지 않으면 기존대로 구글. */
  provider?: 'google' | 'kakao' | null
}

const RETRY_LABEL = '다시 시도하기'

function retryHref(next: string): string {
  return `/login?next=${encodeURIComponent(next)}`
}

/**
 * 콜백 쿼리 → 사장님 안내.
 * 표시할 것이 없으면 null 을 돌려준다(정상 진입 시 아무 배너도 그리지 않는다).
 */
export function resolveOAuthReturnNotice(input: OAuthReturnInput): OAuthReturnNotice | null {
  const next = input.next || '/app'
  const signal = input.oauth || input.error || null
  if (!signal) return null

  if (signal === 'connected') {
    return {
      reason: 'connected',
      tone: 'success',
      title: input.provider === 'kakao' ? '카카오 계정으로 로그인했어요' : '구글 계정으로 로그인했어요',
      detail: '가게 정보만 알려주시면 첫 게시물까지 이어서 도와드릴게요.',
      action: null,
    }
  }

  if (signal === 'cancelled' || signal === 'access_denied') {
    return {
      reason: 'cancelled',
      tone: 'alert',
      title: '로그인을 취소하셨어요',
      detail: '구글 로그인 창에서 동의하지 않고 닫으셨어요. 소희 계정에는 아무 변화가 없어요.',
      action: { label: '다시 로그인하기', href: retryHref(next) },
    }
  }

  if (signal === 'exchange_failed') {
    return {
      reason: 'failed',
      tone: 'alert',
      title: '구글 로그인은 됐지만 연결을 마치지 못했어요',
      detail: '잠시 후 다시 시도해 주세요. 같은 문제가 반복되면 이메일로 로그인할 수 있어요.',
      action: { label: RETRY_LABEL, href: retryHref(next) },
    }
  }

  if (signal === 'callback_exception') {
    return {
      reason: 'failed',
      tone: 'alert',
      title: '로그인 처리 중 문제가 생겼어요',
      detail: '잠시 후 다시 시도해 주세요. 계속되면 이메일로 로그인해 주세요.',
      action: { label: RETRY_LABEL, href: retryHref(next) },
    }
  }

  if (signal === 'callback') {
    return {
      reason: 'failed',
      tone: 'alert',
      title: '로그인 링크를 확인할 수 없어요',
      detail: '링크가 만료되었을 수 있어요. 이메일 로그인을 다시 시도해 주세요.',
      action: { label: RETRY_LABEL, href: retryHref(next) },
    }
  }

  // 카카오 로그인 복귀. 구글 문구를 재사용하면 "구글에서 돌아오는 정보" 같은 거짓 안내가 되므로 따로 둔다.
  if (signal === 'kakao_cancelled') {
    return {
      reason: 'cancelled',
      tone: 'alert',
      title: '로그인을 취소하셨어요',
      detail: '카카오 로그인 창에서 동의하지 않고 닫으셨어요. 소희 계정에는 아무 변화가 없어요.',
      action: { label: '다시 로그인하기', href: retryHref(next) },
    }
  }

  if (signal === 'account_linking_prohibited') {
    return {
      reason: 'failed',
      tone: 'alert',
      title: '이미 다른 방법으로 가입된 이메일이에요',
      detail: '같은 이메일로 Google 또는 이메일 가입을 하셨어요. 처음 가입하신 방법으로 로그인해 주세요. 계정은 자동으로 합치지 않아요.',
      action: { label: '로그인으로 돌아가기', href: retryHref(next) },
    }
  }

  if (
    signal === 'kakao_error' ||
    signal === 'session_failed' ||
    signal === 'token_exchange_failed' ||
    signal === 'profile_fetch_failed' ||
    signal === 'invalid_state' ||
    signal === 'invalid_request' ||
    signal === 'disallowed_redirect_uri'
  ) {
    return {
      reason: 'failed',
      tone: 'alert',
      title: '카카오 로그인을 마치지 못했어요',
      detail: '잠시 후 다시 시도해 주세요. 계속되면 이메일이나 Google로 로그인할 수 있어요.',
      action: { label: RETRY_LABEL, href: retryHref(next) },
    }
  }

  // 구글 쪽에서 오류를 돌려준 경우(취소는 위에서 이미 걸렀다). 실패했다는 사실은 안다.
  if (signal === 'failed' || signal === 'server_error') {
    return {
      reason: 'failed',
      tone: 'alert',
      title: '로그인을 마치지 못했어요',
      detail: '잠시 후 다시 시도해 주세요. 계속되면 이메일로 로그인할 수 있어요.',
      action: { label: RETRY_LABEL, href: retryHref(next) },
    }
  }

  // no_code 등: 아무 결과도 받지 못해 취소인지 끊김인지 우리가 알 수 없는 경우다.
  // 모르면 모른다고 말한다 — 실패로 단정하지도, 성공으로 넘기지도 않는다.
  return {
    reason: 'failed',
    tone: 'alert',
    title: '로그인 결과를 확인하지 못했어요',
    detail: '구글에서 돌아오는 정보를 받지 못했어요. 취소하셨다면 다시 로그인해 주세요.',
    action: { label: RETRY_LABEL, href: retryHref(next) },
  }
}
