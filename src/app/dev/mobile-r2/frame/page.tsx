import { notFound } from 'next/navigation'
import { parseFrameWidth } from '../frame-width'

export const dynamic = 'force-dynamic'

/**
 * 모바일 셸 프리뷰를 지정 폭으로 감싸 보는 개발 프레임 (ANI-1662).
 * 개발 환경 전용 — 운영(production)에서는 404.
 *
 * /dev/mobile-r2/frame?w=390 (허용 320~480, 기본 390)
 */
export default async function MobileR2FramePage({
  searchParams,
}: Readonly<{ searchParams: Promise<Record<string, string | string[] | undefined>> }>) {
  if (process.env.NODE_ENV === 'production') notFound()

  const params = await searchParams
  const width = parseFrameWidth(params.w)

  return (
    <main className="min-h-dvh bg-muted/40 px-4 py-6">
      <div className="mx-auto flex flex-col gap-2" style={{ width }}>
        <p className="text-xs text-muted-foreground">미리보기 폭 {width}px · 예시 화면</p>
        <iframe
          title="모바일 셸 미리보기"
          src="/dev/mobile-r2"
          data-mobile-r2-frame
          style={{ width }}
          className="h-[720px] rounded-2xl border border-border bg-background"
        />
      </div>
    </main>
  )
}
