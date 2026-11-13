import { Suspense } from 'react'
import { notFound } from 'next/navigation'
import { PcHomePreview } from './preview'

export const dynamic = 'force-dynamic'

interface PageProps {
  searchParams: Promise<{ state?: string }>
}

/**
 * PC 3열 관제 홈 시각 검수용 개발 페이지.
 * 운영(production)에서는 404를 반환하며, 로그인 및 실서버 호출 없이 고정 fixture로 동작합니다.
 */
export default async function PcHomeDevPage({ searchParams }: PageProps) {
  if (process.env.NODE_ENV === 'production') notFound()

  const resolvedSearchParams = await searchParams
  const state = resolvedSearchParams?.state || 'full'

  return (
    <Suspense fallback={<div className="p-8 text-center text-sm text-muted-foreground">PC 홈 미리보기를 준비하고 있어요...</div>}>
      <PcHomePreview state={state as 'full' | 'empty' | 'error'} />
    </Suspense>
  )
}
