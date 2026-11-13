import { notFound } from 'next/navigation'
import { BlogCopyPreview } from './preview'
import { getRevenueCommandReadModel } from '@/lib/read-models/revenue-command-read-model'

export const dynamic = 'force-dynamic'

export default function BlogCopyDevPage() {
  if (process.env.NODE_ENV === 'production') notFound()
  return <main className="mx-auto max-w-3xl min-w-0 px-4 py-8">
    <h1 className="mb-2 text-xl font-semibold">네이버 원고 미리보기·복사 검증 · 테스트 전용</h1>
    <p className="mb-6 text-sm">가게 정보와 원고는 모두 예시예요. 복사해도 게시되지 않아요.</p>
    <BlogCopyPreview missingSource={getRevenueCommandReadModel('11111111-1111-4111-8111-111111111111')} />
  </main>
}
