import { Skeleton } from '@/components/ui/skeleton'

/** 화면 전환 중 보여 주는 자리표시. 글자만 있는 로딩 대신 제목·카드 모양을 미리 보여 줘 기다림이 짧게 느껴진다. */
export function PageSkeleton() {
  return (
    <div role="status" aria-label="데이터 확인 중" aria-busy="true" className="mx-auto w-full max-w-2xl space-y-4 px-4 pt-4">
      <div className="space-y-2">
        <Skeleton className="h-7 w-32 rounded-lg" />
        <Skeleton className="h-4 w-56 rounded-md" />
      </div>
      {[0, 1, 2].map(i => (
        <div key={i} data-skeleton-card className="space-y-3 rounded-2xl border border-border bg-card p-4">
          <Skeleton className="h-4 w-24 rounded-md" />
          <Skeleton className="h-5 w-4/5 rounded-md" />
          <Skeleton className="h-4 w-3/5 rounded-md" />
        </div>
      ))}
      <span className="sr-only">데이터 확인 중</span>
    </div>
  )
}
