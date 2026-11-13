'use client'

import { useState } from 'react'
import { DEMO_PLACEHOLDER_IMAGE } from './demo-placeholder'
import { PreviewSetView } from './preview-set-view'
import { seedPreviewSet, type ChannelCapability, type PreviewAsset } from './preview-set'

/**
 * 프리뷰 전용 예시. 실제 사진을 쓰지 않고 인라인 자리표시자만 쓴다(외부 요청 없음).
 * 데이터셋 모드 `SHOWCASE_DEMO` 라벨이 화면에 항상 함께 보인다.
 */
const DEMO_ASSET: PreviewAsset = {
  assetId: 'demo-asset',
  imageUrl: DEMO_PLACEHOLDER_IMAGE,
  width: 1080,
  height: 810,
  rights: 'CONFIRMED',
}
const DEMO_CAPS: ChannelCapability[] = [
  { channel: 'instagram', connection: 'NOT_CONNECTED', canPublish: false },
  { channel: 'threads', connection: 'UNKNOWN', canPublish: false },
]

export function FirstPostPreviewDemo() {
  const [state, setState] = useState(() =>
    seedPreviewSet({
      channels: [
        { channel: 'instagram', copy: { text: '이번 주 새로 나온 메뉴를 소개해요.\n오시기 전에 예약해 주세요.', cta: '예약하기' } },
        { channel: 'threads', copy: { text: '새 메뉴가 나왔어요!', cta: '문의하기' } },
      ],
    }),
  )
  return <PreviewSetView asset={DEMO_ASSET} datasetMode="SHOWCASE_DEMO" state={state} capabilities={DEMO_CAPS} onChange={setState} />
}
