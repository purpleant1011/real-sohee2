/**
 * 고객 수신 동의 표시 모델 — '동의 확인됨'을 근거 없이 만들지 않는다.
 *
 * 철회(withdrawn)와 미확인(unknown)은 다른 사건이다. 철회는 '고객이 거부했다'는 사실이고,
 * 미확인은 '모른다'이다. 둘 다 광고성 연락에는 쓸 수 없지만(fail-closed), 화면 문구는 달라야 한다.
 * 확인 시점을 읽을 수 없으면 날짜를 꾸며내지 않고 `dated: false` 로 내려보낸다.
 * 출처는 서버가 사용자 문구로 바꿔 준 값만 화이트리스트로 통과시킨다(내부 코드 노출 방지).
 */

export type ConsentStatus = 'granted' | 'withdrawn' | 'unknown'

export interface ConsentInput {
  /** 서버 DTO 의 consent.status. 모르는 값·없는 값은 모두 'unknown' 으로 다룬다. */
  status?: string | null
  /** 동의/철회를 확인한 시각(ISO). */
  checkedAt?: string | null
  /** 서버가 사용자 문구로 바꿔 준 출처 라벨. */
  source?: string | null
  /** 서버가 '동의 기록을 확인했다'고 명시한 경우에만 true. 없으면 확인되지 않은 것으로 본다. */
  verifiedByServer?: boolean | null
}

export interface ConsentView {
  status: ConsentStatus
  label: string
  detail: string
  /** YYYY-MM-DD. 읽을 수 없으면 null — 날짜를 꾸며내지 않는다. */
  checkedOn: string | null
  /** 화이트리스트를 통과한 출처 라벨만. 그 밖의 값은 null. */
  sourceLabel: string | null
  /** 광고성 안내를 보내도 되는가. 철회·미확인은 false (fail-closed). */
  canContact: boolean
  /** 동의 기록의 시점을 읽을 수 있는가. false 면 화면은 '확인 날짜를 알 수 없어요'를 쓴다. */
  dated: boolean
  /**
   * 서버가 '동의 기록을 확인했다'고 밝힌 경우에만 true.
   * 현재 서버는 `granted` 를 만들어 내지 않으므로(`customer-semantics.ts:15-18`) 이 값이 false 인
   * `granted` 는 화면에서 '확인된 기록'으로 그리지 않는다. 예시 화면에도 쓰지 않는다.
   */
  verifiedByServer: boolean
}

const COPY: Record<ConsentStatus, { label: string; detail: string }> = {
  granted: {
    label: '수신 동의 확인됨',
    detail: '광고성 안내를 보낼 수 있는 동의가 확인됐어요.',
  },
  withdrawn: {
    label: '수신 동의 철회',
    detail: '고객이 수신을 거부했어요. 다시 동의를 받기 전에는 광고성 안내를 보내지 않아요.',
  },
  unknown: {
    label: '수신 동의 미확인',
    detail: '동의 여부를 확인하지 못했어요. 확인되기 전에는 광고성 안내를 보내지 않아요.',
  },
}

/** 서버(`customer-semantics.ts:38-41`)가 실제로 내려보내는 출처 라벨만 허용한다. */
const SOURCE_LABEL = new Set(['고객 요청', '직접 등록', '채널 알림', '법적 요청'])

function normalizeStatus(status: string | null | undefined): ConsentStatus {
  if (typeof status !== 'string') return 'unknown'
  const value = status.trim().toLowerCase()
  if (value === 'granted' || value === 'withdrawn') return value
  return 'unknown'
}

function dateOnly(iso: string | null | undefined): string | null {
  if (typeof iso !== 'string' || iso.trim().length === 0) return null
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) return null
  return new Date(ms).toISOString().slice(0, 10)
}

export function consentStatusFor(input: ConsentInput): ConsentView {
  const status = normalizeStatus(input.status)
  const checkedOn = dateOnly(input.checkedAt)
  const sourceLabel = typeof input.source === 'string' && SOURCE_LABEL.has(input.source) ? input.source : null
  return {
    status,
    label: COPY[status].label,
    detail: COPY[status].detail,
    checkedOn,
    sourceLabel,
    canContact: status === 'granted',
    dated: checkedOn !== null,
    verifiedByServer: status === 'granted' && input.verifiedByServer === true,
  }
}

/**
 * 실제 응답 모양을 받아들인다. 화면마다 `consent` 를 문자열로만 주기도 하고
 * (`{ consent: 'unknown' }`), 객체로 주기도 한다(`{ consent: { status, checkedAt } }`).
 * 모르는 모양은 예외를 던지지 않고 '미확인'으로 둔다(fail-closed).
 */
export function normalizeConsentInput(value: unknown): ConsentInput {
  if (typeof value === 'string') return { status: value }
  if (typeof value !== 'object' || value === null) return { status: null }
  const record = value as Record<string, unknown>
  const status = typeof record.status === 'string' ? record.status : typeof record.consent === 'string' ? record.consent : null
  return {
    status,
    checkedAt: typeof record.checkedAt === 'string' ? record.checkedAt : null,
    source: typeof record.source === 'string' ? record.source : null,
    verifiedByServer: record.verifiedByServer === true,
  }
}

/** 응답 모양을 그대로 받아 화면 모델로 옮긴다. 모르는 모양은 '미확인'. */
export function consentViewFor(value: unknown): ConsentView {
  return consentStatusFor(normalizeConsentInput(value))
}
