import { notFound } from 'next/navigation'
import { ComingSoonRoadmap, EmptyState, FirstWeekPlan } from '@/features/empty-states/empty-state'

export const dynamic = 'force-dynamic'

// 정적 UI 샘플 전용: 인증, 데이터 조회, 외부 요청 없음.
export default function EmptyStatesGallery() {
  if (process.env.NODE_ENV === 'production') notFound()
  return <main className="mx-auto min-w-0 max-w-5xl space-y-10 bg-background px-4 py-8 text-foreground">
    <h1 className="text-2xl font-bold">빈 상태 미리보기</h1>
    {(['home', 'content', 'vault', 'customers', 'results'] as const).map((area) =>
      <section key={area} data-gallery-area={area} aria-label={`${area} 빈 상태`} className="space-y-3"><h2 className="text-lg font-semibold">{area}</h2><EmptyState area={area} /></section>,
    )}
    <FirstWeekPlan />
    <ComingSoonRoadmap />
  </main>
}
