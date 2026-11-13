import { Skeleton } from '@/components/feedback/skeleton'

export default function KnowledgeLoading() {
  return (
    <section aria-label="지식 자료 불러오는 중" aria-live="polite">
      <h1>지식 자료</h1>
      <p>비공개 자료와 검토 상태를 불러오고 있어요.</p>
      <Skeleton />
    </section>
  )
}
