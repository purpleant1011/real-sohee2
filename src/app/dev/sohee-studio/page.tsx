import { notFound } from 'next/navigation'
import { SoheeStudioView } from '@/features/sohee-studio/components/sohee-studio-view'

// 개발 환경 전용 브라우저 시각 검증 페이지
// 프로덕션 배포 시 원천 차단 (notFound)
export default function DevSoheeStudioPage() {
  if (process.env.NODE_ENV !== 'development') {
    notFound()
  }

  // 표준 UUID fixture workspaceId 사용
  const devWorkspaceId = '11111111-1111-4111-8111-111111111111'

  return (
    <main className="min-h-screen bg-background p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-4">
      <div className="border-b pb-3">
        <h1 className="text-xl font-bold text-foreground">소희 스튜디오 — 시각 검증 (Dev Preview)</h1>
        <p className="text-xs text-muted-foreground">
          실제 컴포넌트 렌더링, 390px 반응형 및 API 에러 상태를 시각적으로 확인하는 개발 전용 공간입니다.
        </p>
      </div>

      <SoheeStudioView workspaceId={devWorkspaceId} />
    </main>
  )
}
