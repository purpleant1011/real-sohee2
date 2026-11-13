import { cn } from '@/lib/utils'

/** 상태 변화 안내용 라이브 영역. 컨테이너는 항상 마운트해 두고 message 만 바꿔야 스크린리더가 읽는다.
 *  assertive(role=alert)는 실패처럼 즉시 알려야 할 때만 쓴다. */
export function LiveRegion({ message, politeness = 'polite', visible = false, className }: Readonly<{ message: string; politeness?: 'polite' | 'assertive'; visible?: boolean; className?: string }>) {
  return (
    <div
      role={politeness === 'assertive' ? 'alert' : 'status'}
      aria-live={politeness}
      aria-atomic="true"
      className={cn(!visible && 'sr-only', className)}
    >
      {message}
    </div>
  )
}
