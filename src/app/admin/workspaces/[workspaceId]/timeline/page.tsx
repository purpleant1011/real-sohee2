import { requireOperator } from '@/features/operator-auth/require-operator'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { readCustomer360 } from '@/features/admin/customer360/service'
import { Customer360TimelineView } from '@/features/admin/customer360/Customer360TimelineView'

type Props = Readonly<{ params: Promise<{ workspaceId: string }> }>

export default async function AdminCustomerTimelinePage({ params }: Props) {
  const { workspaceId } = await params
  const operator = await requireOperator('workspace.read', workspaceId)
  const data = await readCustomer360(createAdminSupabaseClient() as never, { workspaceId, operatorId: operator.userId })
  return <Customer360TimelineView data={data} />
}
