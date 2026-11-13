import { notFound } from 'next/navigation'
import { InboxWiringHarness } from './harness'

export const dynamic = 'force-dynamic'

/**
 * M13 소통함(`/app/inbox`) 플래그 ON/OFF 비교 하네스(ANI-1766).
 * 개발 환경 전용(운영 404). 로그인·서버 조회 없음.
 *
 * /dev/mobile-r2/inbox-wiring?r2=1   R2 소통함(767px 이하)
 * /dev/mobile-r2/inbox-wiring        플래그 OFF → 기존 R1 소통함
 */
export default async function InboxWiringDevPage({
  searchParams,
}: Readonly<{ searchParams: Promise<Record<string, string | string[] | undefined>> }>) {
  if (process.env.NODE_ENV === 'production') notFound()
  const params = await searchParams
  return <InboxWiringHarness enabled={params.r2 === '1'} />
}
