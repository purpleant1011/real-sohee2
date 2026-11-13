import type { ReactNode } from 'react'
import Link from 'next/link'

/** PC 정보구조만 담당한다. 원문·답안·권한·예약 상태는 공통 서버 원장을 사용한다. */
export function DesktopConversationReview({ children, title = '문의·예약 조건 검토', description = '선택한 문의의 원문과 답안을 확인하고, 같은 문의의 예약 관리로 이어가요.', backHref = '/app/engagement' }: { children: ReactNode; title?: string; description?: string; backHref?: '/app/engagement' | '/app/inbox' }) {
  return <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-4 lg:p-6">
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex flex-col gap-2"><h1 className="text-2xl font-semibold">{title}</h1><p className="text-sm text-muted-foreground">{description}</p></div>
      <Link href={backHref} className="inline-flex min-h-11 items-center rounded-lg border border-border px-4 text-sm focus-visible:outline-2 focus-visible:outline-ring">소통함으로 돌아가기</Link>
    </header>
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
      <section aria-label="선택한 대화 검토" className="min-w-0 rounded-xl border border-border bg-card p-4">{children}</section>
      <aside className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4"><h2 className="text-base font-semibold">예약 전 확인</h2><ul className="list-disc pl-5 text-sm leading-relaxed text-muted-foreground"><li>고객이 실제로 수락했는지 확인해요.</li><li>서비스·가격·예약 가능한 시간을 원장에서 확인해요.</li><li>대화를 여는 것만으로 발송·예약 확정이 실행되지는 않아요.</li></ul><p className="text-sm text-muted-foreground">연결을 확인하지 못하면 다시 확인하거나 원문으로 돌아가세요. 조회 실패는 예약이 없다는 뜻이 아니에요.</p></aside>
    </div>
  </div>
}
