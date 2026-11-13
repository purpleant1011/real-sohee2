import { cn } from '@/lib/utils'

const bar = (w: string, h = 'h-4') => <span className={cn('m-skel block', h, w)} />

/** 레이아웃을 미리 잡아 CLS 0 — 실제 화면과 같은 줄 높이로 만든다. 번쩍임 없는 호흡 애니메이션. */
export function SkeletonBlocks({ variant = 'list', rows = 4 }: Readonly<{ variant?: 'list' | 'detail' | 'text'; rows?: number }>) {
  if (variant === 'detail') {
    return (
      <div className="space-y-4" aria-hidden>
        {bar('w-2/3', 'h-6')}
        {bar('w-1/3', 'h-4')}
        <span className="m-skel block h-40 w-full rounded-2xl" />
        {bar('w-full')}
        {bar('w-5/6')}
      </div>
    )
  }
  if (variant === 'text') {
    return (
      <div className="space-y-2.5" aria-hidden>
        {Array.from({ length: rows }, (_, i) => (
          <span key={i}>{bar(i === rows - 1 ? 'w-1/2' : 'w-full')}</span>
        ))}
      </div>
    )
  }
  return (
    <ul className="divide-y divide-border" aria-hidden>
      {Array.from({ length: rows }, (_, i) => (
        <li key={i} className="flex items-center gap-3 py-3.5">
          <span className="m-skel size-10 shrink-0 rounded-full" />
          <span className="flex-1 space-y-2">
            {bar('w-3/5')}
            {bar('w-4/5', 'h-3.5')}
          </span>
        </li>
      ))}
    </ul>
  )
}
