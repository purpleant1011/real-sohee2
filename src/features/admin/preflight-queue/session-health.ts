/**
 * 네이버·당근 브라우저 로그인 세션 건강 표시 — 자리만 확보한다.
 * 법무 확인(ANI-1571) 전에는 세션을 실제로 점검하는 코드를 만들지 않는다.
 * 쿠키·토큰 등 세션 값은 이 모듈의 입력·출력 어디에도 없다.
 */
export type SessionHealthState = 'NOT_LINKED' | 'HEALTHY' | 'RELOGIN_REQUIRED' | 'UNKNOWN'
export type SessionChannel = 'naver_blog' | 'daangn_business'

export const SESSION_HEALTH_LABEL: Readonly<Record<SessionHealthState, string>> = {
  NOT_LINKED: '연동 전',
  HEALTHY: '정상',
  RELOGIN_REQUIRED: '재로그인 필요',
  UNKNOWN: '확인 불가',
}
const CHANNEL_LABEL: Readonly<Record<SessionChannel, string>> = { naver_blog: '네이버 블로그', daangn_business: '당근 비즈프로필' }

/** 향후 실제 점검기가 채울 결과. 현재는 어떤 코드도 이 값을 만들지 않는다. */
export interface SessionProbeResult { result: 'OK' | 'LOGIN_REQUIRED'; checkedAt: string }
export interface SessionHealthInput {
  channel: SessionChannel
  /** false = 연동 없음, null = 연동 여부를 알 수 없음 */
  linked: boolean | null
  probe?: SessionProbeResult | null
}
export interface SessionHealthView { channel: SessionChannel; channelLabel: string; state: SessionHealthState; label: string }

const FRESH_MS = 24 * 60 * 60 * 1000

export function resolveSessionHealth(input: SessionHealthInput, now: Date = new Date()): SessionHealthView {
  const view = (state: SessionHealthState): SessionHealthView => ({
    channel: input.channel, channelLabel: CHANNEL_LABEL[input.channel], state, label: SESSION_HEALTH_LABEL[state],
  })
  if (input.linked === false) return view('NOT_LINKED')
  if (input.linked !== true) return view('UNKNOWN')
  const probe = input.probe
  const checked = probe ? Date.parse(probe.checkedAt) : NaN
  const age = now.getTime() - checked
  // 점검 근거가 없거나 오래됐거나 미래 시각이면 정상으로 보이지 않는다.
  if (!probe || !Number.isFinite(age) || age < 0 || age > FRESH_MS) return view('UNKNOWN')
  if (probe.result === 'LOGIN_REQUIRED') return view('RELOGIN_REQUIRED')
  return probe.result === 'OK' ? view('HEALTHY') : view('UNKNOWN')
}

/** 현재 단계: 연동 기능이 없으므로 두 채널 모두 "연동 전". */
export function currentSessionHealth(now: Date = new Date()): SessionHealthView[] {
  return (['naver_blog', 'daangn_business'] as const).map(channel => resolveSessionHealth({ channel, linked: false }, now))
}
