import { notFound } from 'next/navigation'
import { ImageStyleSettings } from '@/features/image-style/image-style-settings'
import { SettingsPage } from '@/features/settings/settings-page'

/** 레이아웃 확인 전용. 실제 작업공간·고객 사진을 사용하지 않는다. */
export default function ImageStyleWorkbenchPage() {
  if (process.env.NODE_ENV !== 'development') notFound()
  return (
    <main className="mx-auto min-h-dvh max-w-3xl p-3">
      <p role="note">개발 화면 검증용 합성 설정입니다. 운영 데이터가 아니며 저장·분석 버튼은 실행하지 마세요.</p>
      <SettingsPage title="이미지 스타일" description="사업자별 설정 화면의 모바일 레이아웃을 확인합니다.">
        <ImageStyleSettings
          canEdit
          workspaceId="11111111-1111-4111-8111-111111111111"
          initialStyle={{
            subject: '꽃다발과 계절 소품의 디테일',
            composition: '제품을 중앙에 두고 여백 확보',
            setting: '밝은 매장 진열대',
            mood: '싱그럽고 자연스러운',
            lookAndColor: '부드러운 자연광',
            people: 'none',
            avoid: ['과한 보정'],
            extra: '',
            guide: '다른 업종의 고정 사진 대신 우리 가게의 설정만 사용합니다.',
            referenceAssetIds: [],
            referenceNotes: {},
          }}
        />
      </SettingsPage>
    </main>
  )
}
