import { requireOperator } from '@/features/operator-auth/require-operator'
import { listBulkGrantCampaigns } from '@/features/operator-credits/bulk-grant-repository'
import { BulkGrantForm } from '@/features/operator-credits/bulk-grant-form'
import { PageHeader, EmptyNotice, LoadErrorNotice } from '@/components/admin-ui/data-state'

export const dynamic = 'force-dynamic'

export default async function BulkGrantPage() {
  await requireOperator('credit.adjust.approve')
  let campaigns: Awaited<ReturnType<typeof listBulkGrantCampaigns>> | null = null
  try { campaigns = await listBulkGrantCampaigns() } catch { /* Report failure, not false empty. */ }
  return (
    <main className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
      <PageHeader title="크레딧 일괄 지급" description="실제 사업자 고객사에 크레딧을 지급합니다. 지급 전에 반드시 대상을 확인해 주세요." />
      <BulkGrantForm />
      <section aria-labelledby="campaign-heading" className="space-y-3">
        <h2 id="campaign-heading" className="text-lg font-semibold">이전 지급 캠페인</h2>
        {campaigns === null ? <LoadErrorNotice what="이전 지급 내역" retryHref="/admin/credits" /> : campaigns.length === 0 ?
          <EmptyNotice title="이전 지급 내역이 없어요" /> :
          <div className="overflow-x-auto rounded-xl border">
            <table className="min-w-[600px] w-full text-left text-sm">
              <thead className="bg-muted/40"><tr>{['일시', '대상', '1인당', '지급 수', '사유'].map((title) => <th className="px-3 py-3" scope="col" key={title}>{title}</th>)}</tr></thead>
              <tbody>{campaigns.map((campaign) => <tr className="border-t" key={campaign.id}>
                <td className="px-3 py-3 whitespace-nowrap">{new Date(campaign.created_at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}</td>
                <td className="px-3 py-3">{campaign.audience === 'all_active' ? '전체 고객사' : `최근 ${campaign.recent_days}일 신규 가입`}</td>
                <td className="px-3 py-3">{campaign.amount_per_workspace.toLocaleString('ko-KR')}</td>
                <td className="px-3 py-3">{campaign.granted_count.toLocaleString('ko-KR')}곳</td>
                <td className="px-3 py-3 break-words">{campaign.reason}</td>
              </tr>)}</tbody>
            </table>
          </div>}
      </section>
    </main>
  )
}
