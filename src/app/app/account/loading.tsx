import { Skeleton } from '@/components/feedback/skeleton'

export default function AccountLoading() {
  return (
    <section aria-label="나의 소희 불러오는 중" aria-live="polite">
      <h1>나의 소희</h1>
      <p>여섯 준비 항목을 모두 확인하고 있어요.</p>
      <Skeleton />
    </section>
  )
}
