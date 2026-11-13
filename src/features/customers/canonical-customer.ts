import { createHash } from 'node:crypto'
import { normalizeKrPhone } from '@/features/kakao/notify/alimtalk-contract'

function calculateSha256(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

export interface ResolveCanonicalCustomerParams {
  admin: any
  workspaceId: string
  displayName: string
  phone010: string | null | undefined
}

export interface ResolveCanonicalCustomerResult {
  customerUuid: string | null
}

/**
 * 010 전화번호를 E.164 규격으로 정규화하고 SHA256 해시를 산출하여
 * upsert_customer_by_phone RPC를 호출, 정본 고객 UUID를 조회/생성합니다.
 *
 * - 번호 누락, 정규화 실패, RPC 오류 시 예외를 던지지 않고 { customerUuid: null } 반환 (fail-open)
 * - 번호 및 고객명 등 PII는 로그에 기록하지 않음
 */
export async function resolveCanonicalCustomer(
  params: ResolveCanonicalCustomerParams,
): Promise<ResolveCanonicalCustomerResult> {
  const fallback: ResolveCanonicalCustomerResult = { customerUuid: null }

  if (!params) return fallback

  const wsId = typeof params.workspaceId === 'string' ? params.workspaceId.trim() : ''
  if (!wsId) return fallback

  const rawPhone = typeof params.phone010 === 'string' ? params.phone010.trim() : ''
  if (!rawPhone) return fallback

  let phoneE164: string
  try {
    phoneE164 = normalizeKrPhone(rawPhone)
  } catch {
    return fallback
  }

  const phoneSha256 = calculateSha256(phoneE164)
  const displayName = typeof params.displayName === 'string' ? params.displayName.trim() : ''

  try {
    if (!params.admin || typeof params.admin.rpc !== 'function') {
      return fallback
    }

    const { data, error } = await params.admin.rpc('upsert_customer_by_phone', {
      p_workspace_id: wsId,
      p_display_name: displayName,
      p_phone_e164: phoneE164,
      p_phone_sha256: phoneSha256,
    })

    if (error || !data) {
      return fallback
    }

    return {
      customerUuid: typeof data === 'string' ? data : String(data),
    }
  } catch {
    // 번호·이름 등 PII를 남기지 않고 안전하게 null 반환
    return fallback
  }
}
