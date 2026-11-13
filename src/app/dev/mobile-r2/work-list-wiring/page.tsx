import { notFound } from 'next/navigation'
import { WorkListWiringHarness } from './harness'

export const dynamic = 'force-dynamic'

/** 개발 전용 실조회 훅 검증 화면. 운영에서는 404이며 게시·승인 API는 사용하지 않는다. */
export default function WorkListWiringDevPage() {
  if (process.env.NODE_ENV === 'production') notFound()
  return <main className="mx-auto min-h-dvh max-w-2xl bg-background p-4">
    <p className="mb-4 text-sm text-muted-foreground">개발 검증 화면 · 예시 작업 공간 조회 · 실제 회원 데이터 아님</p>
    <WorkListWiringHarness />
  </main>
}
