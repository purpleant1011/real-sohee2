import { isoOrNull, read, type InboxClient, type Raw } from '@/features/mobile-inbox/server/inbox-source'
import { UNKNOWN_NAME_LABEL, maskName, type MobileCustomerDto } from '../customer-model'
import { channelLabel, deriveConsent, deriveSegment, deriveVerifiedContacts, statusLabel, type OptOutRow } from './customer-semantics'

export const CUSTOMER_PAGE_LIMIT = 100
const OPT_OUT_LIMIT = 1000

/** 화면 DTO 한 줄에 딸린 중복 판정 정보. dedupe 는 계약 검증 뒤에 해야 한다. */
export interface CustomerRowKey {
  /** 같은 사람을 가리키는 키. customer_id 가 없으면 null(합치지 않는다). */
  customerKey: string | null
  /** 관측 시각(ms). 최신 상담을 고르는 기준. 없으면 0. */
  observedAtMs: number
}

export interface CustomerSourceResult {
  rows: unknown[]
  /**
   * rows 와 같은 순서·같은 길이의 중복 판정 정보.
   * 중복 제거를 여기서 하지 않는 이유: 계약을 못 지킨 행이 '중복'으로 먼저 사라지면
   * rejectedRows 가 0 이 되어 '전체를 읽었다'는 표시가 과대해진다. 검증은 read-model 이 먼저 한다.
   */
  keys: CustomerRowKey[]
  /** 목록과 수신거부 원장을 모두 끝까지 읽었는지. */
  complete: boolean
  observedAt: string
}

/**
 * 사용자 세션(RLS) 클라이언트로 상담 행과 수신거부 원장을 읽어 고객 DTO 로 바꾼다.
 * 연락처 컬럼은 select 하지 않는다. 익명화된 행은 이름이 지워진 것이므로 목록에서 뺀다.
 * 하나라도 읽기에 실패하면 던진다(일부만 성공한 목록을 완전한 것처럼 내리지 않는다).
 */
export async function readCustomerSource(
  client: InboxClient,
  workspaceId: string,
  opts: { now: () => string },
): Promise<CustomerSourceResult> {
  const [conversations, optOuts] = await Promise.all([
    read(client.from('customer_conversations')
      .select('id, workspace_id, customer_id, customer_uuid, display_label, channel, status, latest_message_at, updated_at, is_anonymized')
      .eq('workspace_id', workspaceId).order('latest_message_at', { ascending: false }), CUSTOMER_PAGE_LIMIT),
    read(client.from('customer_opt_outs')
      .select('customer_id, opted_out_at, source')
      .eq('workspace_id', workspaceId).order('opted_out_at', { ascending: false }), OPT_OUT_LIMIT),
  ])
  const optOutById = new Map<string, OptOutRow>()
  for (const o of optOuts) if (typeof o.customer_id === 'string') optOutById.set(o.customer_id, o as unknown as OptOutRow)

  // 중복 제거는 여기서 하지 않는다. 계약을 못 지킨 행을 먼저 버리면 '전체를 읽었다'는
  // 표시가 과대해지기 때문이다. 이 함수는 원본 줄을 그대로 넘기고, 판정에 필요한 키만 함께 준다.
  //
  // 합치는 단위는 customer_uuid 가 있으면 (workspace_id, uuid::customer_uuid),
  // 없으면 (workspace_id, customer_id) 다.
  // 익명화 신호가 있는 고객 그룹. 익명화가 '고객 단위 삭제 요청'인지 '대화 단위'인지 정책 정본이
  // 아직 없다. 그래서 삭제를 단정하지 않고, 같은 그룹에 익명화 신호가 하나라도 있으면 옛 비익명
  // 행의 이름·최근 진행만 감춘다(가역 조치). 정책이 확정되면 이 블록만 지우면 된다.
  const anonymizedGroups = new Set<string>()
  for (const c of conversations) {
    if (c.is_anonymized !== true) continue
    const customerUuid = typeof c.customer_uuid === 'string' && c.customer_uuid.trim() ? c.customer_uuid.trim() : null
    if (customerUuid) anonymizedGroups.add(`${String(c.workspace_id)}::uuid::${customerUuid}`)
    const customerId = typeof c.customer_id === 'string' ? c.customer_id : ''
    if (customerId) anonymizedGroups.add(`${String(c.workspace_id)}::${customerId}`)
  }

  const kept = conversations.filter(c => c.is_anonymized !== true)
  const groupKeyOf = (c: Raw) => {
    const customerUuid = typeof c.customer_uuid === 'string' && c.customer_uuid.trim() ? c.customer_uuid.trim() : null
    if (customerUuid) return `${String(c.workspace_id)}::uuid::${customerUuid}`
    const customerId = typeof c.customer_id === 'string' ? c.customer_id : ''
    return customerId ? `${String(c.workspace_id)}::${customerId}` : null
  }
  let suppressed = 0
  const rows = kept.map(c => {
    const key = groupKeyOf(c)
    if (!key || !anonymizedGroups.has(key)) return toDto(c, optOutById)
    // 계약을 못 지킨 행은 그대로 넘긴다. 여기서 이름을 대체 문구로 '고치면' 스키마 검증을
    // 통과해 버려 rejectedRows 신호가 사라진다(감지 신호 보존).
    const originalName = typeof c.display_label === 'string' ? c.display_label.trim() : ''
    if (!originalName) return toDto(c, optOutById)
    suppressed += 1
    // 이름은 대체 문구로, 최근 진행·출처는 비운다. 고객을 목록에서 지우지는 않는다 —
    // 지우면 '없음'으로 읽혀 삭제가 끝난 것처럼 보인다.
    return toDto(
      {
        ...c,
        display_label: UNKNOWN_NAME_LABEL,
        status: null,
        channel: null,
        latest_message_at: null,
        updated_at: null,
      },
      optOutById,
    )
  })

  return {
    rows,
    keys: kept.map(c => ({ customerKey: groupKeyOf(c), observedAtMs: observedAt(c) })),
    // 감춘 그룹이 있으면 완전한 목록이라고 주장하지 않는다. 화면은 '일부만 불러왔어요'로 남는다.
    complete: conversations.length < CUSTOMER_PAGE_LIMIT && optOuts.length < OPT_OUT_LIMIT && suppressed === 0,
    observedAt: opts.now(),
  }
}

/** 상담 한 줄의 관측 시각(ms). 둘 다 없으면 0 — 없는 시각을 '가장 최근'으로 만들지 않는다. */
function observedAt(c: Raw): number {
  const iso = isoOrNull(c.latest_message_at) ?? isoOrNull(c.updated_at)
  const at = iso ? Date.parse(iso) : NaN
  return Number.isNaN(at) ? 0 : at
}

function toDto(c: Raw, optOutById: Map<string, OptOutRow>): MobileCustomerDto {
  const consent = deriveConsent(c.customer_id, optOutById)
  const name = String(c.display_label ?? '')
  const at = isoOrNull(c.latest_message_at) ?? isoOrNull(c.updated_at)
  const label = statusLabel(c.status)
  const customerUuid = typeof c.customer_uuid === 'string' && c.customer_uuid.trim() ? c.customer_uuid.trim() : null
  return {
    id: String(c.id),
    workspaceId: String(c.workspace_id),
    // 수신거부 고객은 서버에서 먼저 마스킹한다(화면에서도 한 번 더 마스킹).
    displayName: consent.status === 'withdrawn' ? maskName(name) : name,
    segment: deriveSegment(),
    consent,
    verifiedContacts: deriveVerifiedContacts(),
    lastAction: label && at ? { label, at } : null,
    sourceLabel: channelLabel(c.channel),
    ...(customerUuid ? { customerUuid } : {}),
  }
}
