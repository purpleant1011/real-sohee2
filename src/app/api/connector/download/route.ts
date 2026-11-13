import { naverAutomationBlocked } from '@/features/naver-publish/automation-policy'

export const dynamic = 'force-dynamic'

export async function GET(_request?: Request) {
  // V1.2 G0-02: 네이버 외부 자동화 단일 정책 정본에 따라 네이버 연결기 확장 ZIP 배포 중단
  return naverAutomationBlocked('publish')
}
