import { notFound } from 'next/navigation'
import { ResultsRangeHarness } from './harness'

export const dynamic = 'force-dynamic'

/**
 * M20 성과 화면 '직접 선택' 기간 UI 육안 검수용 개발 페이지(ANI-1782).
 * 개발 환경 전용 — 운영(production)에서는 404. 로그인·실제 서버 조회 없음.
 * 주간 리포트 응답은 하네스의 fetch 스텁이 예시 값으로 돌려준다.
 *
 * /dev/mobile-r2/results-range
 */
export default function ResultsRangeDevPage() {
  if (process.env.NODE_ENV === 'production') notFound()

  return (
    <main className="min-h-dvh w-full bg-muted/40">
      {/*
        앱 셸이 화면 전체(fixed)를 덮으므로 흐름 안의 안내는 가려진다. 탭 바 바로 위에 띄우되
        헤더·기간 컨트롤·확인 버튼은 덮지 않게 아래쪽 오른편에 작게 둔다(검수 화면 전용).
      */}
      <p className="pointer-events-none fixed bottom-20 right-2 z-50 rounded-full bg-background/95 px-2.5 py-1 text-[11px] leading-none text-muted-foreground shadow-sm">
        예시 화면 · 실제 데이터가 아닙니다
      </p>
      <ResultsRangeHarness />
    </main>
  )
}
