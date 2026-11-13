import { notFound } from 'next/navigation'
import { KnowledgeJournalPreview } from './preview'

export default function KnowledgeJournalDevPage() {
  if (process.env.NODE_ENV !== 'development') notFound()
  return <main className="mx-auto min-h-dvh max-w-3xl p-4 md:p-6">
    <p className="mb-4 text-sm text-muted-foreground">지식 일지 검증 전용 · 합성 기록 · 실제 자동화·게시·과금 없음</p>
    <KnowledgeJournalPreview />
  </main>
}
