import { requireOperatorAnyScope } from '../../../features/operator-auth/require-operator'
import { listOperatorAdmins } from '../../../features/operator-admin/repository'
import { DynamicOperatorAdminAccounts } from '../../../features/operator-refine/operator-dynamic-views'
import { listOperatorAdminApprovals } from '../../../features/operator-admin/approval-repository'
import { listOperatorAdminSelectors } from '../../../features/operator-admin/selector-repository'
import { LoadErrorNotice, PageHeader } from '@/components/admin-ui/data-state'

export default async function OperatorAdminsPage() {
  await requireOperatorAnyScope('admin.read')
  const [result, approvals, selectors] = await Promise.all([listOperatorAdmins(), listOperatorAdminApprovals(), listOperatorAdminSelectors()])

  if (result.error) {
    return (
      <main className="space-y-6 p-4 sm:p-6 max-w-6xl mx-auto">
        <PageHeader title="운영 관리자 계정" description="운영자 계정 및 권한을 관리합니다." />
        <LoadErrorNotice what="운영 관리자 계정 목록" retryHref="/admin/admins" />
      </main>
    )
  }

  return <DynamicOperatorAdminAccounts result={result} approvals={approvals} selectors={selectors} />
}

