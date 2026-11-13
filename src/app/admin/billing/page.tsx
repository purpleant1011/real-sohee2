import { requireOperatorAnyScope } from '@/features/operator-auth/require-operator'
import { listOperatorBillingOverviewForFormalMembers } from '@/features/operator-billing/billing-read-repository'
import { DynamicBillingOverview } from '@/features/operator-refine/operator-dynamic-views'
import { PageHeader, LoadErrorNotice, MfaRequiredNotice } from '@/components/admin-ui/data-state'

export default async function OperatorBillingPage() {
  await requireOperatorAnyScope('billing.read')
  const result = await listOperatorBillingOverviewForFormalMembers()
  if (result.error !== null || result.data === null) {
    return (
      <main className="mx-auto max-w-6xl p-4 sm:p-6 space-y-4">
        <PageHeader title="결제·구독" description="고객사별 구독 요금제, 크레딧 잔액 및 결제 상태를 확인합니다." />
        {result.error === 'MFA_REQUIRED'
          ? <MfaRequiredNotice />
          : <LoadErrorNotice what="결제·구독 정보" retryHref="/admin/billing" />}
      </main>
    )
  }
  return <DynamicBillingOverview data={result.data} />
}
