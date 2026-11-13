import { notFound } from 'next/navigation'
import { StateChip, StateView, type StateChipKind } from '@/components/mobile-ui'

export const dynamic = 'force-dynamic'

const KINDS: readonly StateChipKind[] = ['loading', 'partial', 'stale', 'error', 'offline']
const CHECKED_AT = '2026-10-22T07:40:00Z'

/** 공통 5상태 UI 프리뷰(ANI-1669). 개발 전용(운영 404). /dev/mobile-r2/states */
export default function StatesPreviewPage() {
  if (process.env.NODE_ENV === 'production') notFound()
  return (
    <main className="mx-auto flex max-w-[480px] flex-col gap-8 px-4 py-6">
      <p className="text-xs text-muted-foreground">예시 화면 · 실제 데이터가 아닙니다</p>
      {KINDS.map((kind) => (
        <section key={kind} aria-label={kind} className="flex flex-col gap-3">
          <StateChip kind={kind} />
          <StateView kind={kind} checkedAt={kind === 'loading' ? undefined : CHECKED_AT} skeleton="list" skeletonRows={2}>
            <p className="text-[15px] text-foreground">확인된 내용 예시</p>
          </StateView>
        </section>
      ))}
    </main>
  )
}
