import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

type MasterDetailProps = Readonly<{
  /** 왼쪽 목록 영역 (스크린리더 이름) */
  listLabel: string
  /** 오른쪽 상세 영역 (스크린리더 이름) */
  detailLabel: string
  list: ReactNode
  detail: ReactNode
  /** 상세가 비어 있을 때 넓은 화면에서 보여줄 안내 */
  emptyDetail?: ReactNode
  /** 항목이 선택됐는지. 좁은 화면에서는 선택되면 상세만, 아니면 목록만 보인다. */
  hasSelection?: boolean
  className?: string
}>

/**
 * PC 전용 "왼쪽 목록 + 오른쪽 상세" 2단 구성.
 * - lg(1024px) 이상: 목록 360px + 상세 나머지, 각자 스크롤
 * - 그보다 좁으면 한 칸씩: 선택이 없으면 목록, 선택되면 상세
 */
export function MasterDetail({
  listLabel,
  detailLabel,
  list,
  detail,
  emptyDetail,
  hasSelection = detail != null,
  className,
}: MasterDetailProps) {
  return (
    <div className={cn('grid min-w-0 gap-4 lg:grid lg:grid-cols-[22.5rem_minmax(0,1fr)] lg:items-start', className)}>
      <section
        aria-label={listLabel}
        className={cn('min-w-0 lg:max-h-[calc(100dvh-8rem)] lg:overflow-y-auto', hasSelection ? 'hidden lg:block' : 'block')}
      >
        {list}
      </section>
      <section
        aria-label={detailLabel}
        className={cn('min-w-0 lg:max-h-[calc(100dvh-8rem)] lg:overflow-y-auto', hasSelection ? 'block' : 'hidden lg:block')}
      >
        {detail ?? (
          <div className="rounded-xl border border-dashed bg-muted/30 p-8 text-center text-sm text-muted-foreground">
            {emptyDetail}
          </div>
        )}
      </section>
    </div>
  )
}
