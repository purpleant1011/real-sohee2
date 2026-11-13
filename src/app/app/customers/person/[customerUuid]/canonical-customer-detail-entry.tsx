'use client'

import { useMobileR2Active } from '@/features/mobile-shell/r2-gate'
import { R2CanonicalCustomerDetail } from '@/features/mobile-customers/r2-canonical-customer-detail'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

/**
 * 정본 고객 상세 진입점.
 *
 * 좁은 화면 + 플래그 ON 에서는 R2 상세(R2CanonicalCustomerDetail)를 마운트한다.
 * 플래그 OFF/PC에서는 고객 목록(/app/customers)으로 안전하게 이동한다.
 */
export function CanonicalCustomerDetailEntry({
  workspaceId,
  customerUuid,
}: {
  workspaceId: string
  customerUuid: string
}) {
  const active = useMobileR2Active()
  const router = useRouter()
  const decodedUuid = safeDecode(customerUuid)

  useEffect(() => {
    if (!active) {
      router.replace('/app/customers')
    }
  }, [active, router])

  if (!active) {
    return null
  }

  return (
    <R2CanonicalCustomerDetail
      workspaceId={workspaceId}
      customerUuid={decodedUuid}
    />
  )
}
