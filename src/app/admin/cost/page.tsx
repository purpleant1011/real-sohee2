import { requireOperator } from '@/features/operator-auth/require-operator'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { formatBuildLabel, getBuildMeta } from '@/features/admin/build-meta/build-meta'
import { buildCostValue } from '@/features/admin/cost-value/cost-value'
import { SupabaseCostValueRepository } from '@/features/admin/cost-value/repository'
import { CostValueView } from '@/features/admin/cost-value/cost-value-view'

export const dynamic = 'force-dynamic'

export default async function AdminCostValuePage() {
  await requireOperator('billing.read')
  const result = await buildCostValue(new SupabaseCostValueRepository(createAdminSupabaseClient() as never))
  return (
    <main className="mx-auto max-w-6xl p-4 sm:p-6">
      <CostValueView result={result} versionLabel={formatBuildLabel(getBuildMeta())} />
    </main>
  )
}
