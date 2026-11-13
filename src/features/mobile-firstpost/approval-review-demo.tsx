'use client'

import { ApprovalReviewView } from './approval-review-view'
import { DEMO_PLACEHOLDER_IMAGE } from './demo-placeholder'
import type { ApprovalReviewInput } from './approval-review'

/** 프리뷰 전용 예시. 전송은 하지 않고 즉시 성공 처리한다. */
const DEMO_INPUT: ApprovalReviewInput = {
  workspaceName: '예시 가게',
  targets: [{ channel: 'instagram', handle: '@example_shop', connection: 'CONNECTED', publishPermission: 'GRANTED' }],
  copies: [{ channel: 'instagram', text: '이번 주 새로 나온 메뉴를 소개해요.\n오시기 전에 예약해 주세요.', cta: '예약하기' }],
  imageIds: ['demo-asset'],
  rights: 'CONFIRMED',
  saved: true,
  cost: { amountKrw: 0, source: 'POLICY' },
  executionSurface: 'MOBILE_OK',
  serverFingerprint: 'demo-fingerprint',
  approved: null,
}

export function ApprovalReviewDemo() {
  return (
    <ApprovalReviewView
      input={DEMO_INPUT}
      imageUrlFor={() => DEMO_PLACEHOLDER_IMAGE}
      onSubmit={() => new Promise((resolve) => setTimeout(resolve, 600))}
    />
  )
}
