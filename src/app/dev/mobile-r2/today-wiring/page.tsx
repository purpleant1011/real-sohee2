import { notFound } from 'next/navigation'
import { TodayWiringHarness } from './harness'

export const dynamic = 'force-dynamic'

/**
 * 오늘 홈 R2 배선 플래그 ON/OFF 비교 하네스. 개발 환경 전용(운영 404). 로그인 없음.
 * /dev/mobile-r2/today-wiring?r2=1 (기본 OFF)
 */
export default async function TodayWiringPage({ searchParams }: Readonly<{ searchParams: Promise<Record<string, string | string[] | undefined>> }>) {
  if (process.env.NODE_ENV === 'production') notFound()
  const params = await searchParams
  return <TodayWiringHarness enabled={params.r2 === '1'} />
}
