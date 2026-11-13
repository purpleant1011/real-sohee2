import { notFound } from 'next/navigation'
import { PrimaryTintPreview } from './preview'
import { isPrimaryTintSurface } from './surfaces'

export const dynamic = 'force-dynamic'

/**
 * ANI-1666 primary 틴트 표면 육안·대비 검수용 개발 페이지.
 * 개발 환경 전용 — 운영(production)에서는 404. 인증/데이터 조회/외부 요청 없음.
 *
 * /dev/mobile-r2-primary-tint?surface=mission|inbox|dm|all
 */
export default async function MobileR2PrimaryTintPage({
  searchParams,
}: Readonly<{ searchParams: Promise<Record<string, string | string[] | undefined>> }>) {
  if (process.env.NODE_ENV === 'production') notFound()

  const params = await searchParams
  const rawSurface = typeof params.surface === 'string' ? params.surface : 'all'
  const surface = isPrimaryTintSurface(rawSurface) ? rawSurface : 'all'

  return (
    <main className="min-h-dvh bg-muted/40">
      <PrimaryTintPreview surface={surface} />
    </main>
  )
}
