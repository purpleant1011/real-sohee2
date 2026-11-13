import { notFound } from 'next/navigation'
import { WorkPreviewHarness } from './harness'

export const dynamic = 'force-dynamic'

/**
 * M06 홍보 세트 실라우트 진입점 ON/OFF·조회 실패 비교 하네스(ANI-1678).
 * 개발 환경 전용(운영 404). 로그인·서버 조회 없음.
 *
 * /dev/mobile-r2/work-preview?r2=1&snapshot=1 (기본 OFF / 스냅샷 있음)
 */
export default async function WorkPreviewDevPage({
  searchParams,
}: Readonly<{ searchParams: Promise<Record<string, string | string[] | undefined>> }>) {
  if (process.env.NODE_ENV === 'production') notFound()
  const params = await searchParams
  return (
    <WorkPreviewHarness
      enabled={params.r2 === '1'}
      hasSnapshot={params.snapshot !== '0'}
      // 사진 비율을 바꿔 세로형 틀의 여백 처리(자르지 않음)를 눈으로 확인한다.
      photo={params.photo === 'square' ? 'square' : 'landscape'}
    />
  )
}
