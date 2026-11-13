import { requireOperator } from '@/features/operator-auth/require-operator'
import { RevenueView } from '@/features/operator-revenue/revenue-view'
import { getOperatorRevenueData } from '@/features/operator-revenue/revenue-repository'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function RevenuePage() {
  await requireOperator('billing.read')
  const { data, error } = await getOperatorRevenueData()

  return <RevenueView data={data} error={error} />
}
