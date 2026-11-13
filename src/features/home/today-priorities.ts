import type { QuickPostItem } from '@/components/quick-post/types'

export const POST_REMINDER_DAYS = 7

export interface TodayPriorityInput {
  channelsConnected: boolean | null
  posts: QuickPostItem[] | null
  recentActionsCount: number | null
  now: Date
}

export type TodayCard = {
  kind: 'connect' | 'approve' | 'compose' | 'summary' | 'connected' | 'upToDate' | 'unavailable'
  title: string
  description: string
  href: string
  actionLabel: string
  complete: boolean
}

const CONTENT = '/app/content'
const COMPOSE = `${CONTENT}?compose=${encodeURIComponent('이번 주 소식')}`

function validTime(raw: string): number | null {
  if (!raw?.trim()) return null
  const value = Date.parse(raw)
  return Number.isFinite(value) ? value : null
}

/** Only act on known facts. A failed request must never look like an empty workspace. */
export function buildTodayPriorities({ channelsConnected, posts, recentActionsCount, now }: TodayPriorityInput): TodayCard[] {
  const cards: TodayCard[] = []
  if (channelsConnected === false) {
    cards.push({ kind: 'connect', title: '인스타그램·스레드 연결하기', description: '채널을 연결하면 소희가 게시물을 준비할 수 있어요.', href: '/app/channels', actionLabel: '채널 연결하기', complete: false })
  }

  if (posts) {
    const pending = posts.filter((post) => post.status === 'AWAITING_APPROVAL').length
    if (pending > 0) {
      cards.push({ kind: 'approve', title: `확인할 게시물 ${pending}개 보기`, description: '소희가 준비한 글을 확인하고 발행 여부를 결정해 주세요.', href: CONTENT, actionLabel: `게시물 ${pending}개 확인하기`, complete: false })
    }

    // QuickPostItem has no publication timestamp. Use the creation time of a published
    // item as the best available signal; unknown or future times are not called overdue.
    const published = posts.filter((post) => ['PUBLISHED_VERIFIED', 'COMPLETED', 'LISTENING'].includes(post.status))
    const publishedTimes = published.map((post) => validTime(post.createdAt))
    const hasUnknownTime = publishedTimes.some((time) => time === null || time > now.getTime())
    const newest = publishedTimes.filter((time): time is number => time !== null && time <= now.getTime())
    const knownDraftTimes = posts.map((post) => validTime(post.createdAt))
    const noPublishedPost = published.length === 0 && knownDraftTimes.every((time) => time !== null && time <= now.getTime()) && !posts.some((post) => ['APPROVED', 'EXECUTING'].includes(post.status))
    if (posts.length === 0 || noPublishedPost || (newest.length > 0 && !hasUnknownTime && now.getTime() - Math.max(...newest) >= POST_REMINDER_DAYS * 86_400_000)) {
      cards.push({ kind: 'compose', title: '이번 주 소식 올리기', description: '최근 발행한 글이 없어요. 새 소식을 준비해 볼까요?', href: COMPOSE, actionLabel: '이번 주 소식 작성하기', complete: false })
    }
  }

  if (cards.length < 3 && posts !== null && recentActionsCount !== null) {
    cards.push({ kind: 'summary', title: '소희가 오늘 한 일', description: recentActionsCount != null && recentActionsCount > 0 ? `최근 기록된 작업 ${recentActionsCount}건을 확인해 보세요.` : '아직 기록된 작업이 없어요. 진행 상황을 확인해 보세요.', href: '/app/sohee', actionLabel: '소희의 작업 보기', complete: true })
  }

  if (channelsConnected === true && cards.length < 3) {
    cards.push({ kind: 'connected', title: '채널 연결 완료', description: '연결된 채널을 확인하거나 변경할 수 있어요.', href: '/app/channels', actionLabel: '연결된 채널 보기', complete: true })
  }
  if (posts && cards.length < 3) {
    cards.push({ kind: 'upToDate', title: '게시물 둘러보기', description: posts.length > 0 ? '작성한 글과 발행 상태를 확인해 보세요.' : '아직 게시물이 없어요. 첫 소식을 준비해 보세요.', href: CONTENT, actionLabel: '게시물 보기', complete: posts.length > 0 })
  }
  while (cards.length < 3) {
    cards.push({ kind: 'unavailable', title: '오늘의 할 일을 확인해 주세요', description: '아직 정보를 확인할 수 없어요. 잠시 후 다시 살펴봐 주세요.', href: CONTENT, actionLabel: '콘텐츠 확인하기', complete: false })
  }
  return cards.slice(0, 3)
}
