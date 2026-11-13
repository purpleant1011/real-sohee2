import { notFound } from 'next/navigation'
import { PersonalSettings } from '@/features/mobile-settings/personal-settings'

export const dynamic = 'force-dynamic'

/**
 * 모바일 개인정보 관리 화면 개발용 프리뷰 픽스처.
 * 개발 전용(운영 404 notFound).
 * 실제 Supabase 네트워크 호출이나 저장 없이 합성 계정 데이터로 UI를 검증합니다.
 */
export default function MobileAccountDevPage() {
  if (process.env.NODE_ENV === 'production') notFound()

  return (
    <div className="relative">
      <aside
        aria-label="개발 전용 프리뷰 안내"
        className="sticky top-0 z-50 border-b border-state-wait/40 bg-state-wait-soft px-4 py-2 text-center text-xs font-medium text-state-wait"
      >
        [개발 프리뷰] 실제 저장 및 개인정보 네트워크 호출이 없는 합성 계정 데모 상태예요.
      </aside>
      <PersonalSettings
        isDemo
        initialAvatarUrl={null}
        initialDisplayName="소희 테스트 대표"
        previewUser={{
          email: 'demo-owner@example.com',
          createdAt: '2026-03-01T10:00:00.000Z',
          provider: 'email',
        }}
      />
    </div>
  )
}
