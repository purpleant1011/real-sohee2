import { requireOperatorAnyScope } from "@/features/operator-auth/require-operator"
import { listOperatorAdmins } from "@/features/operator-admin/repository"
import { GovernanceView } from "@/features/operator-governance/governance-view"

export const dynamic = 'force-dynamic'

export default async function GovernancePage() {
  await requireOperatorAnyScope("admin.read")
  const adminSummary = await listOperatorAdmins()
  return <GovernanceView adminSummary={adminSummary} />
}

