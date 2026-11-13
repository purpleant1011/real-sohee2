import { requireOperatorAnyScope } from '@/features/operator-auth/require-operator'
import { getOperatorEngagementOverview } from '@/features/operator-engagement/engagement-repository'
import { EngagementView } from '@/features/operator-engagement/engagement-view'
import { LoadErrorNotice, MfaRequiredNotice } from '@/components/admin-ui/data-state'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function OperatorEngagementPage() {
  let isMfaRequired = false
  try {
    await requireOperatorAnyScope('publish.read')
  } catch (err: any) {
    if (err?.code === 'MFA_REQUIRED') {
      isMfaRequired = true
    } else {
      throw err
    }
  }

  if (isMfaRequired) {
    return (
      <div className="w-full space-y-7">
        <MfaRequiredNotice />
      </div>
    )
  }

  const { data, error } = await getOperatorEngagementOverview()

  if (error || !data) {
    return (
      <div className="w-full space-y-7">
        <LoadErrorNotice what="소통함 관제 데이터" retryHref="/admin/engagement" />
      </div>
    )
  }

  return <EngagementView initialData={data} />
}
