import { Skeleton } from '@/components/feedback/skeleton'

export default function ReportsLoading() {
  return (
    <section aria-label="리포트 불러오는 중" aria-live="polite">
      <h1>리포트</h1>
      <p>확인된 자료를 불러오고 있어요.</p>
      <Skeleton />
    </section>
  )
}
