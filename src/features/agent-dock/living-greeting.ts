export interface LivingGreetingParams {
  businessName?: string
  urgentDmCount?: number
  earliestDmHoursLeft?: number
  pendingCommentCount?: number
}

export interface LivingGreetingResult {
  greetingText: string
  badgeText: string
  badgeVariant: 'urgent' | 'info' | 'success'
  quickAction?: {
    label: string
    href: string
  }
}

export function generateLivingGreeting(
  params: LivingGreetingParams
): LivingGreetingResult {
  const name = params.businessName || '사장님 매장'
  const dmCount = params.urgentDmCount ?? 0
  const hoursLeft = params.earliestDmHoursLeft ?? 24
  const commentCount = params.pendingCommentCount ?? 0

  if (dmCount > 0) {
    return {
      greetingText: `안녕하세요 사장님! ${name} 마케팅 직원 소희예요.\n인스타그램으로 새로운 예약 문의가 도착해 있어요 (${hoursLeft}시간 내 답변 권장). 아래 추천 답글을 확인해 보실래요?`,
      badgeText: '예약 문의 대기 중',
      badgeVariant: 'urgent',
      quickAction: {
        label: '예약 문의 확인하기',
        href: '/app/engagement?tab=messages',
      },
    }
  }

  if (commentCount > 0) {
    return {
      greetingText: `안녕하세요 사장님! ${name} 마케팅 직원 소희예요.\n스레드와 인스타그램에 새로운 댓글 ${commentCount}건이 도착했어요. 매장 분위기에 어울리는 따뜻한 답글 초안을 준비해 두었습니다.`,
      badgeText: '새 댓글 확인 필요',
      badgeVariant: 'info',
      quickAction: {
        label: '답글 검토하기',
        href: '/app/engagement?tab=comments',
      },
    }
  }

  return {
    greetingText: `안녕하세요 사장님! ${name} 마케팅 직원 소희예요.\n현재 모든 고객 반응에 답장을 마쳤어요. 오늘 매장 홍보를 위해 어떤 글을 작성해 볼까요?`,
    badgeText: '정상 가동 중',
    badgeVariant: 'success',
  }
}
