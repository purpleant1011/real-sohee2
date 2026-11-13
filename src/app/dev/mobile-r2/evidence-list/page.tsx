import { notFound } from 'next/navigation'
import { EvidenceListHarness } from './harness'

export const dynamic = 'force-dynamic'

/**
 * M20 근거 기록 목록 화면 육안·axe 검수용 개발 페이지 (ANI-1783 2단계).
 * 개발 환경 전용 — 운영(production)에서는 404. 인증/데이터 조회/외부 요청 없음.
 *
 * 실서비스 진입점은 플래그 `NEXT_PUBLIC_MOBILE_R2_EVIDENCE_LIST` 뒤의
 * `/app/results/:metric/evidence` 이고, 이 페이지는 같은 화면 컴포넌트에 고정 스냅샷만 넣는다.
 *
 * /dev/mobile-r2/evidence-list
 */
export default function EvidenceListDevPage() {
  if (process.env.NODE_ENV === 'production') notFound()

  return (
    <div className="min-h-dvh bg-muted/40">
      <EvidenceListHarness nowIso={new Date().toISOString()} />
    </div>
  )
}
