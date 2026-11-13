import { notFound } from 'next/navigation'
import { WorkApproveDevHarness } from './harness'

export const dynamic = 'force-dynamic'

/**
 * M07 게시 전 최종 확인 실라우트 R2WorkApprove dev 전용 fixture 하네스.
 * 개발 환경 전용(NODE_ENV === 'production' 시 notFound). 실제 계정/운영 API 쓰기 없음.
 *
 * /dev/mobile-r2/work-approve?state=unreviewed | approved | blocked | naver | naver_approved
 */
export default async function WorkApproveDevPage({
  searchParams,
}: Readonly<{ searchParams: Promise<Record<string, string | string[] | undefined>> }>) {
  if (process.env.NODE_ENV === 'production') notFound()

  const params = await searchParams
  const rawState = typeof params.state === 'string' ? params.state : 'unreviewed'

  return <WorkApproveDevHarness state={rawState} />
}
