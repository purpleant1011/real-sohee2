import { resolveCurrentWorkspaceContext } from '@/features/auth/current-workspace'
import { getCreditBalance, listCreditLedger, listCreditUsageDetail } from '@/features/credits/repository'
import { getWorkspaceAuthoritativeCreditBalance } from '@/features/credits/actual-spend-balance.server'
import { CreditSummary } from '@/features/credits/credit-summary'
import { CreditLedger } from '@/features/credits/credit-ledger'
import { CreditUsageDetailList } from '@/features/credits/credit-usage-detail'
import { buildAuthFailureCreditSnapshot, buildCreditSnapshot } from '@/features/mobile-settings/server/credit-snapshot'
import { redirect } from 'next/navigation'
import { CreditsEntry } from './credits-entry'

export default async function CreditsPage() {
  const resolved = await resolveCurrentWorkspaceContext()

  if (resolved.status !== 'ready') {
    // 로그인 만료(401)·권한 없음(403)은 '가게 없음'과 다른 사유다(ANI-1714).
    // R2 가 켜진 배포에서만 사유를 화면으로 넘기고, 그 밖에는 지금까지와 똑같이 서버에서 보낸다.
    if ((resolved.status === 'expired' || resolved.status === 'forbidden') && process.env.MOBILE_R2_UI_ENABLED === '1') {
      return <CreditsEntry snapshot={buildAuthFailureCreditSnapshot(resolved.status)} legacy={null} />
    }
    redirect('/app/onboarding')
  }

  const workspace = resolved.context

  const [result, ledger, usage, authBalance] = await Promise.all([
    getCreditBalance(workspace.workspaceId),
    listCreditLedger(workspace.workspaceId),
    listCreditUsageDetail(workspace.workspaceId),
    getWorkspaceAuthoritativeCreditBalance(workspace.workspaceId),
  ])

  const hasValidAuthBalance =
    authBalance !== null &&
    typeof authBalance?.authoritativeAvailableCredits === 'number' &&
    Number.isFinite(authBalance.authoritativeAvailableCredits)

  const synchronizedBalance = result.data && hasValidAuthBalance
    ? {
        ...result.data,
        available: authBalance.authoritativeAvailableCredits,
      }
    : null

  // 모바일 R2(M25)는 같은 서버 읽기 결과만 옮겨 담는다. 조회 실패는 0 이 아니라 error 로 닫는다.
  const snapshot = buildCreditSnapshot({
    balance: result.data ?? null,
    authoritativeAvailable: hasValidAuthBalance ? authBalance.authoritativeAvailableCredits : null,
    checkedAt: new Date().toISOString(),
  })

  return (
    <CreditsEntry
      snapshot={snapshot}
      legacy={
        <>
          <CreditSummary balance={synchronizedBalance} />
          <CreditLedger entries={ledger.data ?? []} />
          <CreditUsageDetailList entries={usage.data ?? []} />
        </>
      }
    />
  )
}
