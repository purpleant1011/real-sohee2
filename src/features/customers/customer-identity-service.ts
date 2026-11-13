import { createHash } from 'node:crypto'

export type CustomerIdentityChannel = 'INSTAGRAM' | 'THREADS' | 'KAKAO' | 'MANUAL'

const VALID_CHANNELS: readonly CustomerIdentityChannel[] = [
  'INSTAGRAM',
  'THREADS',
  'KAKAO',
  'MANUAL',
] as const

/**
 * 채널 문자열을 대문자 표준 채널(INSTAGRAM, THREADS, KAKAO, MANUAL)로 정규화합니다.
 * 허용되지 않은 채널인 경우 null을 반환합니다.
 */
export function normalizeIdentityChannel(raw: unknown): CustomerIdentityChannel | null {
  if (typeof raw !== 'string') return null
  const upper = raw.trim().toUpperCase()
  if (VALID_CHANNELS.includes(upper as CustomerIdentityChannel)) {
    return upper as CustomerIdentityChannel
  }
  return null
}

export interface LinkCustomerIdentityParams {
  admin: any
  workspaceId: string
  customerUuid: string
  channel: CustomerIdentityChannel | string
  subjectRef: string
}

export interface LinkCustomerIdentityResult {
  success: boolean
  identityId?: string
  updatedConversationsCount?: number
}

function normalizeToSha256(ref: string): string {
  if (/^[a-f0-9]{64}$/i.test(ref)) {
    return ref.toLowerCase()
  }
  return createHash('sha256').update(ref.trim()).digest('hex')
}

/**
 * 인스타그램 DM 대화자/채널 식별자 ↔ 정본 고객(UUID) 연결 서비스 (Customer Identity Linking).
 *
 * 1. customer_identities 테이블에 (workspace_id, customer_id, channel, subject_ref)를 upsert.
 * 2. 해당 subjectRef(해시 또는 원문 식별자)를 가진 customer_conversations의 customer_uuid를 동기화.
 * 3. PII 누락 또는 DB 오류 시 절대 예외를 던지지 않고 fail-open({ success: false }) 반환.
 */
export async function linkCustomerIdentity(
  params: LinkCustomerIdentityParams,
): Promise<LinkCustomerIdentityResult> {
  const fallback: LinkCustomerIdentityResult = { success: false }

  if (!params || typeof params !== 'object') return fallback
  if (!params.admin || typeof params.admin.from !== 'function') return fallback

  const workspaceId = typeof params.workspaceId === 'string' ? params.workspaceId.trim() : ''
  if (!workspaceId) return fallback

  const customerUuid = typeof params.customerUuid === 'string' ? params.customerUuid.trim() : ''
  if (!customerUuid) return fallback

  const channel = normalizeIdentityChannel(params.channel)
  if (!channel) return fallback

  const subjectRef = typeof params.subjectRef === 'string' ? params.subjectRef.trim() : ''
  if (!subjectRef) return fallback

  try {
    const admin = params.admin

    // 1. customer_identities 테이블에 upsert
    const { data: identityData, error: identityErr } = await admin
      .from('customer_identities')
      .upsert(
        {
          workspace_id: workspaceId,
          customer_id: customerUuid,
          channel,
          subject_ref: subjectRef,
        },
        {
          onConflict: 'workspace_id,channel,subject_ref',
        },
      )
      .select('id')
      .maybeSingle()

    if (identityErr) {
      return fallback
    }

    const identityId = identityData?.id

    // 2. customer_conversations 테이블의 customer_uuid 동기화
    const hash = normalizeToSha256(subjectRef)
    const orFilters = [
      `external_subject_reference_hash.eq.${hash}`,
      `customer_id.eq.${subjectRef}`,
    ]
    if (subjectRef !== hash) {
      orFilters.push(`external_subject_reference_hash.eq.${subjectRef}`)
    }
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(subjectRef)) {
      orFilters.push(`id.eq.${subjectRef}`)
    }

    const nowIso = new Date().toISOString()
    let updatedConversationsCount = 0

    try {
      const { data: updatedRows, error: convErr } = await admin
        .from('customer_conversations')
        .update({
          customer_uuid: customerUuid,
          updated_at: nowIso,
        })
        .eq('workspace_id', workspaceId)
        .or(orFilters.join(','))
        .select('id')

      if (!convErr && Array.isArray(updatedRows)) {
        updatedConversationsCount = updatedRows.length
      }
    } catch {
      // conversation 동기화 실패는 fail-open 처리 (customer_identities는 이미 연결됨)
    }

    return {
      success: true,
      identityId,
      updatedConversationsCount,
    }
  } catch {
    // PII를 일체 노출하지 않고 fail-open
    return fallback
  }
}
