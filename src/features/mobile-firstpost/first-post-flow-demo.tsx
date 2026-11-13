'use client'

import { FirstPostFlow } from './first-post-flow'
import { DEMO_PLACEHOLDER_IMAGE } from './demo-placeholder'
import type { DraftDto } from './draft-mapper'

/**
 * 프리뷰 전용: 목 서버 응답으로 흐름 전체(미리보기→승인→게시→결과)를 눌러 본다.
 * 실제 요청 없음. 실제 사진 대신 인라인 자리표시자를 쓰고 `SHOWCASE_DEMO` 로 표시한다.
 */
const DEMO_DRAFT: DraftDto = {
  missionId: 'demo-mission',
  workspaceId: 'demo-workspace',
  datasetMode: 'SHOWCASE_DEMO',
  copies: { instagram: { caption: '이번 주 새로 나온 메뉴를 소개해요.\n오시기 전에 예약해 주세요.', cta: '예약하기' }, threads: { content: '새 메뉴가 나왔어요!', cta: '문의하기' } },
  selectedImageIds: ['demo-asset'],
  mediaPreviews: [{ id: 'demo-asset', url: DEMO_PLACEHOLDER_IMAGE, width: 1080, height: 810 }],
  rights: { rightsStatus: 'OWNED', consentStatus: 'NOT_APPLICABLE' },
  channels: [{ provider: 'instagram', handle: '@example_shop', connection: 'CONNECTED', publishPermission: 'GRANTED' }],
  approvalFingerprint: 'demo-fingerprint',
  costQuote: { amountKrw: 0, source: 'POLICY' },
  executionSurface: 'MOBILE_OK',
}

const mockFetch = (async (url: string) => {
  await new Promise((r) => setTimeout(r, 400))
  const body = String(url).endsWith('/approve')
    ? { success: true }
    : { success: true, executionResult: { overallStatus: 'PARTIAL_SUCCESS', receipts: { instagram: { channel: 'instagram', stage: 'PROVIDER_ACCEPTED' } } } }
  return new Response(JSON.stringify(body), { status: 200 })
}) as unknown as typeof fetch

export function FirstPostFlowDemo() {
  return <FirstPostFlow draft={DEMO_DRAFT} fetchImpl={mockFetch} />
}
