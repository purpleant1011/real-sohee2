import type { QuickPostItem } from '@/components/quick-post/types'
import type { VaultSummaryDto } from '@/features/vault/query/types'
import type {
  EvaluateTodayCardInput,
  HomeMetricsData,
  TodayCardData,
  VaultSummaryLineData,
} from './types'

export const PUBLISHED_STATUSES = ['PUBLISHED_VERIFIED', 'COMPLETED', 'LISTENING'] as const

/**
 * 1. 홈 최상단 "오늘 할 일 1개" 카드 상태 판정 순수 함수
 * 우선순위:
 * 1) 준비된 글 있음 (AWAITING_APPROVAL 상태 게시물)
 * 2) 보관함에 재확인 필요 (vaultSummary.needs_reapproval_count > 0)
 * 3) 채널 연결 필요 (readiness.stage === 'PREPARE_ONLY' & 채널 미연결)
 * 4) 아직 없음 (기본 첫 주 계획 유도)
 */
export function evaluateTodayCard(input: EvaluateTodayCardInput): TodayCardData {
  const { readiness, vaultSummary, posts, channelsConnected, inquiryCount, upcomingPlannedTheme, autonomousSchedule } = input

  if (vaultSummary?.intervention?.blocked) return {
    state: 'PAUSED', title: vaultSummary.intervention.label ?? '소희가 잠시 멈췄어요',
    description: vaultSummary.intervention.detail ?? '보관함은 그대로 있어요. 운영팀에 확인해 주세요.',
    ctaLabel: '보관함 확인하기', ctaHref: '/app/vault', badgeLabel: '잠시 멈춤',
  }

  // 1) 새로운 고객 문의/예약 대기 있음 (골든타임 대응 최우선)
  if (typeof inquiryCount === 'number' && inquiryCount > 0) {
    return {
      state: 'INQUIRY_RECEIVED',
      title: '새로운 고객 문의가 도착했어요',
      description: `고객님의 문의 및 예약 ${inquiryCount}건이 대기 중이에요. 늦기 전에 소통함에서 답변해 보세요.`,
      ctaLabel: '소통함 확인하기',
      ctaHref: '/app/engagement',
      badgeLabel: '문의 대기',
    }
  }

  // 2) 준비된 글 있음
  const awaitingPost = posts?.find((p) => p.status === 'AWAITING_APPROVAL')
  if (awaitingPost) {
    const postTopic = awaitingPost.topic?.trim()
    return {
      state: 'READY_POST',
      title: '오늘 올릴 글 소희가 준비했어요',
      description: postTopic
        ? `"${postTopic}" 소희가 준비한 글을 확인하고 발행해 보세요.`
        : '소희가 사장님을 위해 정성껏 준비한 글을 확인해 보세요.',
      ctaLabel: '미리보기 열기',
      ctaHref: `/app/content?post=${encodeURIComponent(awaitingPost.missionId)}`,
      badgeLabel: '확인 대기',
      postId: awaitingPost.missionId,
      postTopic: postTopic || undefined,
      postImageUrl: awaitingPost.imageUrl,
    }
  }

  // 3) 오늘 L3 자동 발행 예정
  if (autonomousSchedule?.scheduledToday) {
    const slotTimeStr = autonomousSchedule.slotTime ? `오늘 저녁 ${autonomousSchedule.slotTime}에` : '오늘'
    return {
      state: 'AUTONOMOUS_POST_DUE',
      title: `${slotTimeStr} 글이 자동 발행돼요`,
      description: autonomousSchedule.topic
        ? `"${autonomousSchedule.topic}" 소희가 알아서 준비하고 발행할 예정이에요.`
        : '소희가 가게 소식을 알아서 작성해 둘 예정이에요. 미리보기에서 주제를 변경하거나 바로 확인할 수 있어요.',
      ctaLabel: '발행 내용 확인하기',
      ctaHref: '/app/content',
      badgeLabel: '자동 발행 예정',
    }
  } else if (upcomingPlannedTheme) {
    return {
      state: 'AUTONOMOUS_POST_DUE',
      title: `오늘 저녁 7시 [${upcomingPlannedTheme}] 자동 발행 예정이에요`,
      description: '소희가 매장 지식을 바탕으로 정성껏 준비한 정기 소식이에요. 원하시면 미리 검토하거나 수정할 수 있어요.',
      ctaLabel: '예정 소식 확인하기',
      ctaHref: '/app/vault',
      badgeLabel: '자동 발행 예정',
    }
  }

  // 4) 보관함에 재확인 필요
  if (vaultSummary && vaultSummary.needs_reapproval_count > 0) {
    return {
      state: 'NEEDS_REAPPROVAL',
      title: '보관함에 다시 확인할 글이 있어요',
      description: `보관함에 보관된 글 중 다시 확인이 필요한 글 ${vaultSummary.needs_reapproval_count}건이 있어요.`,
      ctaLabel: '보관함에서 확인하기',
      ctaHref: '/app/vault?status=needs_reapproval',
      badgeLabel: '재확인 필요',
    }
  }

  // 3) 채널 연결 필요 (PREPARE_ONLY 단계이거나 채널이 미연결 상태)
  const isChannelMissing =
    (readiness && readiness.stage === 'PREPARE_ONLY' && readiness.verifiedChannels.length === 0) ||
    channelsConnected === false

  if (isChannelMissing) {
    return {
      state: 'CONNECT_CHANNEL',
      title: '채널을 연결하면 소희가 소식을 올려요',
      description:
        readiness?.connectionHint ||
        '인스타그램이나 스레드를 연결하면 소희가 준비한 소식을 바로 발행할 수 있어요.',
      ctaLabel: '채널 연결하기',
      ctaHref: '/app/channels',
      badgeLabel: '연결 필요',
    }
  }

  // 4) 아직 없음 (기본 상태)
  return {
    state: 'NO_POST_YET',
    title: '소희의 첫 주 계획으로 시작해요',
    description: '이번 주에 사장님의 가게 소식을 어떻게 알릴지 소희와 함께 준비해 보세요.',
    ctaLabel: '첫 소식 준비하기',
    ctaHref: `/app/content?compose=${encodeURIComponent('이번 주 소식')}`,
    badgeLabel: '새 소식',
  }
}

/**
 * 2. 보관함 요약 한 줄 포맷팅 ("보관 3건 · 외부 게시 0건 · 이번 주 2건")
 * 값은 실제 집계값이며, 조회 실패(ERROR) 시 ERROR를 정직하게 표시한다. (ERROR != EMPTY)
 * externalPublishedCount가 제공되면 성과 요약(발행 영수증)과 일치하는 실발행 건수를 사용한다.
 */
export function formatVaultSummaryLine(
  summary: VaultSummaryDto | null,
  isError: boolean,
  externalPublishedCount?: number | null,
): VaultSummaryLineData {
  if (isError || !summary) {
    return {
      storedCount: null,
      externalActionCount: null,
      thisWeekCount: null,
      hasError: true,
      lineText: '보관함을 불러오지 못했어요 · 잠시 후 다시 시도해 주세요',
    }
  }

  const stored = summary.stored_count ?? 0
  const external = externalPublishedCount ?? summary.external_action_count ?? 0
  const thisWeek = summary.this_week_count ?? 0

  return {
    storedCount: stored,
    externalActionCount: external,
    thisWeekCount: thisWeek,
    hasError: false,
    lineText: `보관 ${stored}건 · 외부 게시 ${external}건 · 이번 주 ${thisWeek}건`,
  }
}

/**
 * 3. 성과 위젯 3지표 ("올린 글·문의·예약")
 * 실제 데이터가 없거나 0건인 신규 계정에서는 가짜 수치(0건/더미 수치) 대신
 * "아직 없어요" 라벨과 다음 행동 링크를 제공한다.
 */
export interface LiveEngagementMetricsInput {
  inquiryCount?: number | null
  reservationCount?: number | null
}

export function buildHomeMetrics(
  posts: QuickPostItem[] | null,
  liveMetrics?: LiveEngagementMetricsInput
): HomeMetricsData {
  const publishedCount = posts
    ? posts.filter((p) => (PUBLISHED_STATUSES as readonly string[]).includes(p.status)).length
    : 0

  const inqCount = liveMetrics?.inquiryCount && liveMetrics.inquiryCount > 0 ? liveMetrics.inquiryCount : null
  const resCount = liveMetrics?.reservationCount && liveMetrics.reservationCount > 0 ? liveMetrics.reservationCount : null

  return {
    posts: {
      key: 'posts',
      label: '올린 글',
      value: publishedCount > 0 ? publishedCount : null,
      emptyLabel: '아직 없어요',
      actionLabel: publishedCount > 0 ? '새 글 만들기' : '첫 소식 올리기',
      actionHref: publishedCount > 0 ? '/app/content' : `/app/content?compose=${encodeURIComponent('첫 소식')}`,
    },
    inquiries: {
      key: 'inquiries',
      label: '문의',
      value: inqCount,
      emptyLabel: '아직 없어요',
      actionLabel: inqCount ? '소통함 가기' : '채널 연결하기',
      actionHref: inqCount ? '/app/engagement' : '/app/channels',
    },
    reservations: {
      key: 'reservations',
      label: '예약',
      value: resCount,
      emptyLabel: '아직 없어요',
      actionLabel: resCount ? '주간 캘린더 보기' : '예약 안내 설정하기',
      actionHref: resCount ? '/app/customers?view=calendar' : '/app/sohee',
    },
  }
}
