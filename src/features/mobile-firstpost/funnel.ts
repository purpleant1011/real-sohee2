/**
 * 첫 포스팅 10분 퍼널 집계 (ANI-1682).
 *
 * 가입 → 가게 정보 → 사진 → 사용 확인 → 미리보기 → 승인 → 게시 확인.
 * - 시간은 이벤트가 가진 서버/기록 시각만 쓴다. 비어 있거나 읽을 수 없으면 '측정 불가'다(0초로 두지 않는다).
 * - 첫 가치(`FIRST_VALUE`)는 독립 readback 근거(`PROVIDER_READBACK`)일 때만 인정한다.
 *   '승인함'·'요청 보냄'은 첫 가치가 아니다.
 * - 10분 이내 판정은 첫 가치까지 구간이 측정 가능할 때만 true/false 이고, 아니면 null 이다.
 *
 * 네트워크를 모른다. 이벤트 수집·실계정 실행은 호출 측(총사령관 승인 하에 실계정 E2E) 몫이다.
 */
export const FUNNEL_STEPS = [
  'SIGNUP',
  'SHOP_INFO',
  'PHOTO',
  'RIGHTS',
  'PREVIEW',
  'APPROVAL',
  'FIRST_VALUE',
] as const
export type FunnelStep = (typeof FUNNEL_STEPS)[number]

export const FUNNEL_STEP_LABEL: Record<FunnelStep, string> = {
  SIGNUP: '가입',
  SHOP_INFO: '가게 정보',
  PHOTO: '사진 등록',
  RIGHTS: '사진 사용 확인',
  PREVIEW: '미리보기',
  APPROVAL: '최종 승인',
  FIRST_VALUE: '게시 확인',
}

export const FIRST_POST_BUDGET_MS = 10 * 60 * 1000

export interface FunnelEvent {
  step: FunnelStep
  /** ISO 시각. 읽을 수 없으면 측정 불가로 취급한다. */
  at: string
  /** FIRST_VALUE 에서만 의미가 있다. */
  source?: 'PROVIDER_READBACK' | 'API_RESPONSE' | 'MANUAL'
}

export interface FunnelStepResult {
  step: FunnelStep
  label: string
  reached: boolean
  /** 직전 도달 단계에서 걸린 시간(ms). 측정 불가면 null. */
  sinceMs: number | null
}

export interface FunnelReport {
  steps: readonly FunnelStepResult[]
  /** 도달하지 못한 첫 단계(이탈 지점). 모두 도달하면 null. */
  stoppedBefore: FunnelStep | null
  /** 가입 → 첫 가치 소요(ms). 측정 불가·미도달이면 null. */
  totalMs: number | null
  /** 10분 이내 여부. 측정 불가·미도달이면 null(성공으로 세지 않는다). */
  withinBudget: boolean | null
}

function ms(iso: string | undefined): number | null {
  if (!iso) return null
  const t = Date.parse(iso)
  return Number.isFinite(t) ? t : null
}

export function buildFunnelReport(events: readonly FunnelEvent[], budgetMs = FIRST_POST_BUDGET_MS): FunnelReport {
  const earliest = new Map<FunnelStep, number | null>()
  for (const event of events) {
    if (event.step === 'FIRST_VALUE' && event.source !== 'PROVIDER_READBACK') continue
    const t = ms(event.at)
    const prev = earliest.get(event.step)
    if (prev === undefined || (t !== null && (prev === null || t < prev))) earliest.set(event.step, t)
  }

  let last: number | null = null
  let stoppedBefore: FunnelStep | null = null
  const steps = FUNNEL_STEPS.map((step): FunnelStepResult => {
    const reached = earliest.has(step)
    if (!reached) {
      stoppedBefore ??= step
      return { step, label: FUNNEL_STEP_LABEL[step], reached, sinceMs: null }
    }
    const t = earliest.get(step) ?? null
    const sinceMs = t !== null && last !== null && t >= last ? t - last : null
    if (t !== null) last = t
    return { step, label: FUNNEL_STEP_LABEL[step], reached, sinceMs }
  })

  const start = earliest.get('SIGNUP') ?? null
  const end = earliest.get('FIRST_VALUE') ?? null
  const totalMs = start !== null && end !== null && end >= start ? end - start : null
  return { steps, stoppedBefore, totalMs, withinBudget: totalMs === null ? null : totalMs <= budgetMs }
}
