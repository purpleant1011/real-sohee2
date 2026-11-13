'use client'

import { useMobileR2Active } from '@/features/mobile-shell/r2-gate'
import { R2CustomerDetail } from '@/features/mobile-customers/r2-customer-detail'
import CustomersView from '../customers-view'

/** 기존 화면(쿼리 경로)으로 되돌아갈 곳. */
export function legacyCustomerDetailPath(): string {
  return '/app/customers'
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

/**
 * 고객 상세 진입점(ANI-1664).
 *
 * 좁은 화면 + 플래그 ON 에서는 R2 상세를 마운트한다.
 * 넓은 화면(PC)에서는 같은 MasterDetail 화면에서 해당 고객이 선택된 상태로 연다.
 */
export function CustomerDetailEntry({ workspaceId, customerId }: { workspaceId: string; customerId: string }) {
  const active = useMobileR2Active()
  const decodedId = safeDecode(customerId)

  if (!active) {
    return <CustomersView initialCustomerId={decodedId} />
  }
  return <R2CustomerDetail workspaceId={workspaceId} customerId={decodedId} />
}
