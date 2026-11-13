import { Skeleton } from '@/components/feedback/skeleton'

export default function EngagementLoading() {
  return (
    <main aria-label="소통함 불러오는 중" aria-live="polite" className="mx-auto w-full max-w-4xl px-4 sm:px-6 py-6 sm:py-8 space-y-6">
      <header className="space-y-1.5">
        <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-foreground">소통함</h1>
        <p className="text-sm text-muted-foreground leading-relaxed">
          고객 댓글을 읽고, 소희가 쓴 답글 초안을 확인한 뒤 보내요.
        </p>
      </header>
      <div className="space-y-4 py-4">
        <Skeleton />
      </div>
    </main>
  )
}
