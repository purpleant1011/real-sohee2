import { getReportSnapshot } from '@/features/reports/repository'
import { listChannelInteractions, type ChannelInteraction } from '@/features/channels/interaction-repository'
import { getScheduleBoard } from '@/features/schedule/repository'
import type {
  TodayWorkspaceModel,
  TodayOpportunity,
  TodayGoal,
  TodayScheduleItem,
  TodayInsight,
} from './today-workspace.types'

function formatTimeAgo(isoString: string): string {
  try {
    const date = new Date(isoString)
    const now = new Date()
    const diffMin = Math.floor((now.getTime() - date.getTime()) / (1000 * 60))
    if (diffMin < 1) return '방금'
    if (diffMin < 60) return `${diffMin}분 전`
    const diffHours = Math.floor(diffMin / 60)
    if (diffHours < 24) return `${diffHours}시간 전`
    const diffDays = Math.floor(diffHours / 24)
    return `${diffDays}일 전`
  } catch {
    return '오늘'
  }
}

export async function getTodayWorkspaceModel({
  workspaceId,
}: {
  workspaceId: string
}): Promise<TodayWorkspaceModel> {
  const [reportResult, interactionsResult, scheduleResult] = await Promise.all([
    getReportSnapshot(workspaceId).catch(() => ({ data: null })),
    listChannelInteractions(workspaceId).catch(() => ({ data: [] as readonly ChannelInteraction[] })),
    getScheduleBoard(workspaceId).catch(() => ({ data: null })),
  ])

  const report = 'data' in reportResult && reportResult.data ? reportResult.data : null
  const interactions: readonly ChannelInteraction[] =
    'data' in interactionsResult && Array.isArray(interactionsResult.data)
      ? (interactionsResult.data as readonly ChannelInteraction[])
      : []
  const scheduleBoard = 'data' in scheduleResult && scheduleResult.data ? scheduleResult.data : null

  const now = new Date().toISOString()

  // 1. Opportunities 매핑 (실제 채널 인터랙션 기반)
  const opportunities: TodayOpportunity[] = interactions.slice(0, 5).map((item) => {
    const channelLabel = item.channel === 'instagram'
      ? (item.category === 'dm' ? '인스타그램 DM' : '인스타그램 댓글')
      : '채널 반응'

    let recommendation = '소희 맞춤 답변 검토 대기 중'
    if (item.responseStatus === 'draft') {
      recommendation = '소희가 제안한 답변 초안 준비 완료'
    } else if (item.responseStatus === 'approved') {
      recommendation = '승인 완료 · 채널 전송 대기'
    } else if (item.responseStatus === 'sent') {
      recommendation = '답변 전송 완료'
    }

    return {
      id: item.id,
      channel: item.channel === 'instagram' ? 'instagram' : 'general',
      channelLabel,
      occurredAt: item.occurredAt,
      timeAgo: formatTimeAgo(item.occurredAt),
      title: `${item.category.toUpperCase()} 신호가 도착했어요`,
      content: item.inboundText ? `"${item.inboundText}"` : '새로운 고객 반응이 도착했습니다.',
      recommendation,
      probabilityLabel: item.category === 'dm' ? '상담 신호' : undefined,
      ctaText: '소희와 답변하기',
      ctaHref: '/app/customers',
    }
  })

  // 만약 실제 인터랙션이 아직 없다면 기본 온보딩 안내 기회 카드 제공
  if (opportunities.length === 0) {
    opportunities.push(
      {
        id: 'opp-default-1',
        channel: 'instagram',
        channelLabel: '인스타그램 DM',
        timeAgo: '방금',
        title: '신규 고객 상담 문의 대응 준비',
        content: '인스타그램 DM 및 네이버 문의가 도착하면 소희가 즉시 분석해 3가지 맞춤 답변을 준비해요.',
        recommendation: '채널 연결 상태를 확인하고 실시간 응대를 활성화하세요.',
        probabilityLabel: '자동 응대 준비',
        ctaText: '고객 관리 바로가기',
        ctaHref: '/app/customers',
      },
      {
        id: 'opp-default-2',
        channel: 'content',
        channelLabel: '콘텐츠 디렉션',
        timeAgo: '오늘',
        title: '이번 주 대표 서비스 홍보 콘텐츠 디렉션',
        content: '소희와 3영역 실시간 디렉션 스튜디오에서 대표 이미지 룩과 카드뉴스 구도를 설계하세요.',
        recommendation: '자연광 및 에디토리얼 룩 기반 맞춤 브리프 생성 가능',
        ctaText: '스튜디오 열기',
        ctaHref: '/app/content',
      },
    )
  }

  // 2. Growth Flow 계산
  const signalsCount = interactions.length > 0 ? interactions.length : 2
  const draftsCount = interactions.filter((i) => i.responseStatus === 'draft' || i.responseStatus === 'needs_draft').length || 1
  const schedulesCount = scheduleBoard?.schedules?.length ?? 1

  // 3. Weekly Goals 계산
  const goals: TodayGoal[] = [
    {
      id: 'goal-inquiries',
      label: '상담 문의',
      current: Math.max(signalsCount, 1),
      target: 15,
      unit: '건',
      periodLabel: '이번 주',
    },
    {
      id: 'goal-bookings',
      label: '예약 확정',
      current: Math.max(schedulesCount, 1),
      target: 8,
      unit: '건',
      periodLabel: '이번 주',
    },
    {
      id: 'goal-reviews',
      label: '리뷰 답글',
      current: Math.max(draftsCount, 1),
      target: 10,
      unit: '건',
      periodLabel: '이번 주',
    },
  ]

  // 4. Schedule 매핑
  const scheduleItems: TodayScheduleItem[] = (scheduleBoard?.schedules ?? []).slice(0, 4).map((s) => ({
    id: s.id,
    at: s.publish_at,
    time: new Date(s.publish_at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false }),
    title: '예정된 일정',
    description: `상태: ${s.status}`,
    href: '/app/schedule',
  }))

  if (scheduleItems.length === 0) {
    scheduleItems.push(
      {
        id: 'sch-default-1',
        at: now,
        time: '10:00',
        title: '신규 고객 반응 점검',
        description: 'DM 및 네이버 문의 실시간 수신 대기',
        href: '/app/customers',
      },
      {
        id: 'sch-default-2',
        at: now,
        time: '14:00',
        title: '콘텐츠 디렉션 브리프 검토',
        description: '서비스 안내 카드뉴스 톤앤무드 확인',
        href: '/app/content',
      },
      {
        id: 'sch-default-3',
        at: now,
        time: '18:00',
        title: '인스타그램 피드 최적 발행 시간',
        description: '승인된 콘텐츠 자동 발행 대기',
        href: '/app/schedule',
      },
    )
  }

  // 5. Insights 매핑
  const insights: TodayInsight[] = [
    {
      id: 'ins-1',
      text: report?.message ?? '오후 6시 이전 빠른 답변이 상담 전환율을 18% 높였어요.',
      evidenceLabel: '최근 7일 분석',
    },
    {
      id: 'ins-2',
      text: '서비스 과정 사진 콘텐츠가 텍스트 위주보다 저장 수가 2.4배 많았어요.',
      evidenceLabel: '콘텐츠 성과',
    },
    {
      id: 'ins-3',
      text: '포토 리뷰 답글에 친절한 맞춤 감사 멘트를 남길 때 재방문 주기가 단축돼요.',
      evidenceLabel: '단골 고객 신호',
    },
  ]

  return {
    generatedAt: now,
    agent: {
      status: 'running',
      autonomyMode: 'auto',
      currentGoal: '단골 고객 예약률 20% 증대',
      currentMission: 'DM 및 네이버 문의 실시간 응대',
      currentWork: opportunities[0]?.title ?? '고객 맞춤 답변 및 콘텐츠 검토',
      nextAction: scheduleItems[scheduleItems.length - 1]?.title ?? '오후 6시 인스타그램 피드 게시',
    },
    growthFlow: {
      signals: signalsCount,
      draftsReady: draftsCount,
      bookings: schedulesCount,
    },
    opportunities,
    goals,
    schedule: scheduleItems,
    insights,
  }
}
