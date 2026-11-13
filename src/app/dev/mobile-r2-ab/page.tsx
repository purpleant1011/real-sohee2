import { notFound } from 'next/navigation'
import { MobileAbPreview, isAbState, isAbVariant } from './preview'

export const dynamic = 'force-dynamic'

/**
 * W2 모바일 비주얼 A/B 검수용 개발 페이지 (ANI-1671).
 * 개발 환경 전용 — 운영(production)에서는 404. 인증/데이터 조회/외부 요청 없음.
 *
 * /dev/mobile-r2-ab?variant=a|b&state=ready|loading|empty|partial|stale|error|offline|unauthorized&nav=1
 */
export default async function MobileR2AbPage({
  searchParams,
}: Readonly<{ searchParams: Promise<Record<string, string | string[] | undefined>> }>) {
  if (process.env.NODE_ENV === 'production') notFound()

  const params = await searchParams
  const rawVariant = typeof params.variant === 'string' ? params.variant : 'a'
  const rawState = typeof params.state === 'string' ? params.state : 'ready'

  const variant = isAbVariant(rawVariant) ? rawVariant : 'a'
  const state = isAbState(rawState) ? rawState : 'ready'

  return (
    <main className="min-h-dvh bg-muted/40">
      <MobileAbPreview variant={variant} state={state} nav={params.nav === '1'} />
    </main>
  )
}
