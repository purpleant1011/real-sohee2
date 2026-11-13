import type { PeriodPlanCardArtifact } from '@/features/plans/period-plan-card'
import type { ResearchPlan } from './research-flow-model'

const CHANNEL_LABEL: Record<string, string> = {
  instagram: '인스타그램', threads: '스레드', naver_blog: '네이버 블로그', naver_place: '네이버 플레이스', daangn: '당근 비즈프로필',
}

function day(value: string): string {
  const [, month, date] = value.split('-').map(Number)
  return `${month}월 ${date}일`
}

/** 서버가 만든 기간 계획(크레딧·채널·수량)을 딥리서치식 승인 카드 모양으로 바꾼다. 숫자와 승인 조건은 그대로 옮긴다. */
export function periodPlanToResearchPlan(artifact: PeriodPlanCardArtifact): ResearchPlan {
  const insufficient = artifact.status === 'insufficient' || artifact.expectedRemainingCredits < 0
  const direction = [
    `${day(artifact.periodStart)}부터 ${day(artifact.periodEnd)}까지 진행해요.`,
    `채널은 ${artifact.channels.map(c => CHANNEL_LABEL[c.channel] ?? c.channel).join(', ')}예요.`,
    '승인하기 전에는 저장하거나 크레딧을 쓰지 않아요.',
  ]
  if (insufficient) direction.push('크레딧이 부족해요. 범위를 줄인 뒤에 시작할 수 있어요.')
  return {
    summary: `${artifact.goal}을(를) 위한 계획`,
    direction,
    tasks: artifact.channels.map(c => ({
      id: c.channel,
      title: `${CHANNEL_LABEL[c.channel] ?? c.channel} 게시물 ${c.postCount}개 만들기`,
      detail: `이미지 ${c.postCount * c.imagesPerPost}장 포함`,
      channel: c.channel,
    })),
    totalCredits: artifact.estimatedCredits,
  }
}
