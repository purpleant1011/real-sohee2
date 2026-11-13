import { notFound } from 'next/navigation'
import { ConversationWorkbenchPreview } from './workbench-preview'

export default function ConversationWorkbenchDevPage() {
  if (process.env.NODE_ENV !== 'development') notFound()
  return <main className="mx-auto min-h-dvh max-w-6xl p-3 md:p-5">
    <p className="mb-4 text-sm text-muted-foreground">대화 UI 검증 전용 · 예시 작업공간 · 실제 API 전송·게시·과금 없음</p>
    <ConversationWorkbenchPreview />
  </main>
}
