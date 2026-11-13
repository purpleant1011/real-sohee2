import type { CreditBalance } from './types'

const LIMIT_REACHED_MESSAGE =
  '이용 한도에 도달했어요 — 이번 주기의 이용 한도를 모두 사용했어요. 다음 갱신 주기에 다시 이용할 수 있어요. 더 많은 작업이 필요하면 플랜 변경을 문의해 주세요.'

export function CreditSummary({ balance }: Readonly<{ balance: CreditBalance | null }>) {
  if (!balance) {
    return (
      <section aria-label="이용 현황 요약" className="space-y-2">
        <h1 className="text-xl font-bold">이용 현황</h1>
        <p className="text-sm text-muted-foreground">현재 서비스 이용 상태를 확인해요.</p>
        <p className="text-sm">이용 상태 확인 필요</p>
      </section>
    )
  }

  const isLimitReached = balance.available <= 0

  return (
    <section aria-label="이용 현황 요약" className="space-y-2">
      <h1 className="text-xl font-bold">이용 현황</h1>
      <p className="text-sm text-muted-foreground">현재 서비스 이용 상태를 확인해요.</p>
      {isLimitReached ? (
        <p className="text-sm text-destructive font-medium">{LIMIT_REACHED_MESSAGE}</p>
      ) : (
        <>
          <p className="text-sm text-foreground font-medium">정상 이용 중</p>
          <p className="text-xs text-muted-foreground">다음 초기화 {balance.periodEnd}</p>
        </>
      )}
    </section>
  )
}
