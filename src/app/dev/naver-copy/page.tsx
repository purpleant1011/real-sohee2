import { notFound } from 'next/navigation'
import { NaverCopyPreview } from './preview'

export const dynamic = 'force-dynamic'

export default function NaverCopyDevPage() {
  if (process.env.NODE_ENV === 'production') notFound()
  return <main className="mx-auto max-w-3xl min-w-0 px-4 py-8"><h1 className="mb-6 text-xl font-semibold">네이버 원고 복사 검증 · 테스트 전용</h1><NaverCopyPreview /></main>
}
