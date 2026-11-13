/**
 * 네이버 블로그 외부 자동화 단일 정책 정본 (V1.2 ADR-01/02).
 * 어떤 기기·도메인·연결기·플래그에서도 네이버 자동 로그인/입력/발행/예약/댓글/HTML 수집은 허용하지 않는다.
 * 허용되는 것은 소희 내부 제작과 사용자가 직접 수행하는 수동 전달뿐이다.
 */
import { NextResponse } from 'next/server'

export const NAVER_CAPABILITIES = {
  draft_generate: true,
  image_generate: true,
  manual_copy: true,
  manual_export: true,
  open_official_editor_link: true,
  owner_report_url: true,
  owner_supplied_review: true,
  browser_login: false,
  browser_fill: false,
  browser_publish: false,
  browser_schedule: false,
  automated_comment_read: false,
  automated_comment_reply: false,
  implicit_html_readback: false,
} as const

export type NaverCapability = keyof typeof NAVER_CAPABILITIES

export const NAVER_AUTOMATION_ACTIONS = [
  'login',
  'fill',
  'draft_save',
  'publish',
  'schedule',
  'comment',
  'neighbor',
  'html_readback',
  'search_scrape',
] as const

export type NaverAutomationAction = (typeof NAVER_AUTOMATION_ACTIONS)[number]

export const NAVER_AUTOMATION_BLOCKED_MESSAGE =
  '네이버 자동 게시·예약·로그인 기능은 제공하지 않아요. 소희가 글과 사진을 준비해 드리니 네이버에서 직접 올려 주세요.'

export class NaverAutomationPolicyError extends Error {
  readonly code = 'POLICY_DISABLED' as const
  constructor(readonly action: NaverAutomationAction) {
    super(NAVER_AUTOMATION_BLOCKED_MESSAGE)
    this.name = 'NaverAutomationPolicyError'
  }
}

export function isNaverAutomationAction(value: string): value is NaverAutomationAction {
  return (NAVER_AUTOMATION_ACTIONS as readonly string[]).includes(value)
}

/** 외부 네이버 접근 직전의 최종 진입점에서 호출한다. 예외 없이 항상 거절한다(부수효과 0). */
export function assertNaverAutomationAllowed(action: NaverAutomationAction): never {
  throw new NaverAutomationPolicyError(action)
}

export function naverAutomationBlocked(action: NaverAutomationAction): NextResponse {
  return NextResponse.json(
    { error: NAVER_AUTOMATION_BLOCKED_MESSAGE, errorCode: 'POLICY_DISABLED', action },
    { status: 403, headers: { 'Cache-Control': 'no-store' } },
  )
}
