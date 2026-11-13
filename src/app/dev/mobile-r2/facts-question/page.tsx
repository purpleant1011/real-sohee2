import { notFound } from 'next/navigation'
import { FactsQuestionHarness } from './harness'

export const dynamic = 'force-dynamic'

/**
 * M05 사실 확인(FactsQuestionView) 육안 검수 하네스(ANI-1677).
 * 개발 환경 전용 — 운영(production)에서는 404 notFound().
 * 서버 조회·인증 세션·API 쓰기·외부 호출 0건.
 *
 * /dev/mobile-r2/facts-question?r2=1&preset=empty|with_memory|full_sample
 */
export default async function FactsQuestionDevPage({
  searchParams,
}: Readonly<{ searchParams: Promise<Record<string, string | string[] | undefined>> }>) {
  if (process.env.NODE_ENV === 'production') notFound()

  const params = await searchParams
  const r2 = params.r2 === '1'
  const preset = typeof params.preset === 'string' ? params.preset : 'empty'

  return <FactsQuestionHarness r2Enabled={r2} preset={preset} />
}
