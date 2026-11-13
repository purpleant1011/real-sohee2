import { notFound } from 'next/navigation'
import { StartApproveHarness } from './harness'

export const dynamic = 'force-dynamic'

/**
 * M06 첫 포스팅 진입 가드 + M07 게시 전 최종 확인 육안 검수 하네스(ANI-1680).
 * 개발 환경 전용 — 운영(production)에서는 404. 로그인·서버 조회·외부 요청 없음.
 *
 * /dev/mobile-r2/start-approve?r2=1&screen=firstpost|approve
 *   - r2=1 이면 플래그 ON, 없으면 OFF
 *   - screen 기본값은 approve(게시 전 최종 확인), firstpost 는 첫 포스팅 진입 화면
 */
export default async function StartApproveDevPage({
  searchParams,
}: Readonly<{ searchParams: Promise<Record<string, string | string[] | undefined>> }>) {
  if (process.env.NODE_ENV === 'production') notFound()

  const params = await searchParams
  const screen = params.screen === 'firstpost' ? 'firstpost' : 'approve'
  return <StartApproveHarness r2Enabled={params.r2 === '1'} screen={screen} />
}
