import { requireOperatorAnyScope } from '@/features/operator-auth/require-operator'
import { PageHeader } from '@/components/admin-ui/data-state'
import { InterventionForm } from '@/features/admin/interventions/intervention-form'

export const dynamic = 'force-dynamic'

export default async function InterventionsPage() {
  await requireOperatorAnyScope('system.read')
  return (
    <main className="mx-auto max-w-3xl space-y-6 p-4 sm:p-8">
      <PageHeader
        title="긴급 개입"
        description="이상 징후가 발견된 채널이나 기능의 실행을 긴급 차단합니다. 미리 영향 범위를 확인하고 명확한 사유를 남긴 뒤 실행하세요."
      />
      <InterventionForm />
    </main>
  )
}
