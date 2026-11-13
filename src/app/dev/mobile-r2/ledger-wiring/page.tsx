import { notFound } from 'next/navigation'
import { LedgerWiringHarness } from './harness'

export const dynamic = 'force-dynamic'

/**
 * M15 예약 장부(`/app/schedule`) 실라우트 진입점 ON/OFF 비교 하네스(ANI-1691).
 * 개발 환경 전용(운영 404). 로그인·서버 조회 없음.
 *
 * /dev/mobile-r2/ledger-wiring?r2=1              R2 예약 장부(767px 이하)
 * /dev/mobile-r2/ledger-wiring?r2=1&snapshot=0   승인 밖·조회 안 함 → 기존 일정 화면
 */
export default async function LedgerWiringDevPage({
  searchParams,
}: Readonly<{ searchParams: Promise<Record<string, string | string[] | undefined>> }>) {
  if (process.env.NODE_ENV === 'production') notFound()
  const params = await searchParams
  return (
    <LedgerWiringHarness
      enabled={params.r2 === '1'}
      hasSnapshot={params.snapshot !== '0'}
      nowIso={new Date().toISOString()}
    />
  )
}
