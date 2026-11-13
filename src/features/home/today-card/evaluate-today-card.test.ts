import { describe, expect, it } from 'vitest'
import type { QuickPostItem } from '@/components/quick-post/types'
import type { ReadinessView } from '@/features/readiness'
import type { VaultSummaryDto } from '@/features/vault/query/types'
import {
  buildHomeMetrics,
  evaluateTodayCard,
  formatVaultSummaryLine,
} from './evaluate-today-card'

const baseReadiness: ReadinessView = {
  stage: 'PUBLISH_READY',
  prepared: true,
  verifiedChannels: ['instagram'],
  businessVerified: true,
  progressPercent: 100,
  connectionHint: null,
  trialAutoPublishEnabled: false,
}

const baseVaultSummary: VaultSummaryDto = {
  stored_count: 3,
  needs_reapproval_count: 0,
  invalidated_count: 0,
  total_count: 3,
  external_action_count: 0,
  external_action_warning: null,
  this_week_count: 2,
}

const samplePost: QuickPostItem = {
  missionId: 'post-101',
  status: 'AWAITING_APPROVAL',
  topic: '봄맞이 신규 메뉴 소개',
  createdAt: '2026-10-07T00:00:00.000Z',
  imageUrl: 'https://example.com/sample.jpg',
  copies: { instagram: { caption: '메뉴 소개' }, threads: { content: '메뉴 소개' } },
  imageIds: [],
  channels: [],
  approvalFingerprint: 'fp-1',
  businessName: '햇살 가게',
  revision: 1,
  receipts: {},
}

describe('evaluateTodayCard (오늘 할 일 1개 카드 상태 판정)', () => {
  it('prioritizes server pause over a ready post while retaining vault access', () => {
    const result = evaluateTodayCard({ readiness: null, vaultSummary: { ...baseVaultSummary, intervention: { blocked: true, label: '소희가 잠시 멈췄어요', detail: '보관함은 그대로 있어요' } }, posts: [] })
    expect(result).toMatchObject({ state: 'PAUSED', title: '소희가 잠시 멈췄어요', ctaHref: '/app/vault' })
  })
  it('1. 준비된 글이 있는 경우 READY_POST 상태를 반환한다', () => {
    const result = evaluateTodayCard({
      readiness: baseReadiness,
      vaultSummary: baseVaultSummary,
      posts: [samplePost],
    })

    expect(result.state).toBe('READY_POST')
    expect(result.title).toBe('오늘 올릴 글 소희가 준비했어요')
    expect(result.description).toContain('봄맞이 신규 메뉴 소개')
    expect(result.ctaLabel).toBe('미리보기 열기')
    expect(result.ctaHref).toContain('post-101')
    expect(result.postId).toBe('post-101')
  })

  it('2. 준비된 글이 없고 보관함에 재확인 필요한 글이 있는 경우 NEEDS_REAPPROVAL 상태를 반환한다', () => {
    const summaryWithReapproval: VaultSummaryDto = {
      ...baseVaultSummary,
      needs_reapproval_count: 2,
    }

    const result = evaluateTodayCard({
      readiness: baseReadiness,
      vaultSummary: summaryWithReapproval,
      posts: [],
    })

    expect(result.state).toBe('NEEDS_REAPPROVAL')
    expect(result.title).toBe('보관함에 다시 확인할 글이 있어요')
    expect(result.description).toContain('2건')
    expect(result.ctaLabel).toBe('보관함에서 확인하기')
    expect(result.ctaHref).toBe('/app/vault?status=needs_reapproval')
  })

  it('3. 채널 연결이 필요한 경우 (PREPARE_ONLY & 미연결) CONNECT_CHANNEL 상태를 반환한다', () => {
    const unverifiedReadiness: ReadinessView = {
      ...baseReadiness,
      stage: 'PREPARE_ONLY',
      verifiedChannels: [],
      connectionHint: '채널을 연결하면 발행할 수 있어요',
    }

    const result = evaluateTodayCard({
      readiness: unverifiedReadiness,
      vaultSummary: baseVaultSummary,
      posts: [],
      channelsConnected: false,
    })

    expect(result.state).toBe('CONNECT_CHANNEL')
    expect(result.title).toBe('채널을 연결하면 소희가 소식을 올려요')
    expect(result.ctaLabel).toBe('채널 연결하기')
    expect(result.ctaHref).toBe('/app/channels')
  })

  it('4. 대기 글, 재확인, 채널 연결 이슈가 모두 없을 때는 NO_POST_YET 상태를 반환한다', () => {
    const result = evaluateTodayCard({
      readiness: baseReadiness,
      vaultSummary: baseVaultSummary,
      posts: [],
      channelsConnected: true,
    })

    expect(result.state).toBe('NO_POST_YET')
    expect(result.title).toBe('소희의 첫 주 계획으로 시작해요')
    expect(result.ctaLabel).toBe('첫 소식 준비하기')
    expect(result.ctaHref).toContain('/app/content?compose=')
  })

  it('5. 우선순위: 준비된 글이 있으면 재확인 및 채널 미연결보다 최우선된다', () => {
    const unverifiedReadiness: ReadinessView = {
      ...baseReadiness,
      stage: 'PREPARE_ONLY',
      verifiedChannels: [],
    }
    const summaryWithReapproval: VaultSummaryDto = {
      ...baseVaultSummary,
      needs_reapproval_count: 5,
    }

    const result = evaluateTodayCard({
      readiness: unverifiedReadiness,
      vaultSummary: summaryWithReapproval,
      posts: [samplePost],
      channelsConnected: false,
    })

    expect(result.state).toBe('READY_POST')
    expect(result.ctaLabel).toBe('미리보기 열기')
  })

  it('6. 대기 중인 문의/예약이 있는 경우 INQUIRY_RECEIVED 상태를 반환하고 최우선된다', () => {
    const result = evaluateTodayCard({
      readiness: baseReadiness,
      vaultSummary: baseVaultSummary,
      posts: [samplePost],
      inquiryCount: 3,
    })

    expect(result.state).toBe('INQUIRY_RECEIVED')
    expect(result.title).toBe('새로운 고객 문의가 도착했어요')
    expect(result.description).toContain('3건')
    expect(result.ctaLabel).toBe('소통함 확인하기')
    expect(result.ctaHref).toBe('/app/engagement')
    expect(result.badgeLabel).toBe('문의 대기')
  })

  it('7. 오늘 자율 발행 예정인 경우 AUTONOMOUS_POST_DUE 상태를 반환한다', () => {
    const result = evaluateTodayCard({
      readiness: baseReadiness,
      vaultSummary: baseVaultSummary,
      posts: [],
      autonomousSchedule: {
        scheduledToday: true,
        slotTime: '19:00',
        topic: '가을 제철 신메뉴',
      },
    })

    expect(result.state).toBe('AUTONOMOUS_POST_DUE')
    expect(result.title).toContain('19:00')
    expect(result.description).toContain('가을 제철 신메뉴')
    expect(result.ctaLabel).toBe('발행 내용 확인하기')
    expect(result.ctaHref).toBe('/app/content')
    expect(result.badgeLabel).toBe('자동 발행 예정')
  })

  it('7-1. L3 점장형 오늘 자동 발행 예정(upcomingPlannedTheme)이 있으면 AUTONOMOUS_POST_DUE 상태를 반환한다', () => {
    const result = evaluateTodayCard({
      readiness: baseReadiness,
      vaultSummary: baseVaultSummary,
      posts: [],
      upcomingPlannedTheme: '속눈썹펌 홈케어 팁',
    })

    expect(result.state).toBe('AUTONOMOUS_POST_DUE')
    expect(result.title).toContain('오늘 저녁 7시 [속눈썹펌 홈케어 팁] 자동 발행 예정이에요')
    expect(result.ctaLabel).toBe('예정 소식 확인하기')
    expect(result.ctaHref).toBe('/app/vault')
    expect(result.badgeLabel).toBe('자동 발행 예정')
  })

  it('8. 준비된 글이 있으면 자동 발행 예정보다 우선하여 승인을 유도한다', () => {
    const result = evaluateTodayCard({
      readiness: baseReadiness,
      vaultSummary: baseVaultSummary,
      posts: [samplePost],
      autonomousSchedule: {
        scheduledToday: true,
        slotTime: '19:00',
      },
    })

    expect(result.state).toBe('READY_POST')
    expect(result.ctaLabel).toBe('미리보기 열기')
  })
})

describe('formatVaultSummaryLine (보관함 요약 한 줄 실집계 및 ERROR 처리)', () => {
  it('실제 집계된 데이터로 한 줄 요약을 포맷팅한다', () => {
    const result = formatVaultSummaryLine(baseVaultSummary, false)
    expect(result.hasError).toBe(false)
    expect(result.lineText).toBe('보관 3건 · 외부 게시 0건 · 이번 주 2건')
  })

  it('성과 요약(발행 영수증)의 실제 발행 건수가 전달되면 외부 게시 건수를 일치시킨다', () => {
    // 보관함 DB에는 외부 게시가 0건(불변식)이지만, 실제 첫 포스팅 발행 성공(1건)이 있는 경우
    const zeroVaultSummary: VaultSummaryDto = {
      ...baseVaultSummary,
      stored_count: 0,
      external_action_count: 0,
      this_week_count: 0,
    }
    const result = formatVaultSummaryLine(zeroVaultSummary, false, 1)
    expect(result.hasError).toBe(false)
    expect(result.externalActionCount).toBe(1)
    expect(result.lineText).toBe('보관 0건 · 외부 게시 1건 · 이번 주 0건')
  })

  it('조회 실패 시 EMPTY가 아니라 ERROR를 명시적으로 표시한다', () => {
    const result = formatVaultSummaryLine(null, true)
    expect(result.hasError).toBe(true)
    expect(result.lineText).toBe('보관함을 불러오지 못했어요 · 잠시 후 다시 시도해 주세요')
  })
})

describe('buildHomeMetrics (성과 위젯 3지표 가짜 수치 방지)', () => {
  it('신규 계정(데이터 없음)에서 가짜 0건 대신 "아직 없어요" 라벨을 반환한다', () => {
    const metrics = buildHomeMetrics([])
    expect(metrics.posts.value).toBeNull()
    expect(metrics.posts.emptyLabel).toBe('아직 없어요')
    expect(metrics.posts.actionLabel).toBe('첫 소식 올리기')

    expect(metrics.inquiries.value).toBeNull()
    expect(metrics.inquiries.emptyLabel).toBe('아직 없어요')

    expect(metrics.reservations.value).toBeNull()
    expect(metrics.reservations.emptyLabel).toBe('아직 없어요')
  })

  it('실제 발행된 글이 있는 경우 정확한 카운트를 반영하고 새 글 만들기 액션을 제공한다', () => {
    const publishedPost: QuickPostItem = {
      ...samplePost,
      status: 'PUBLISHED_VERIFIED',
    }
    const metrics = buildHomeMetrics([publishedPost])
    expect(metrics.posts.value).toBe(1)
    expect(metrics.posts.actionLabel).toBe('새 글 만들기')
    expect(metrics.posts.actionHref).toBe('/app/content')
    expect(metrics.inquiries.value).toBeNull()
    expect(metrics.reservations.value).toBeNull()
  })

  it('reflects live inquiryCount and reservationCount when provided', () => {
    const publishedPost: QuickPostItem = {
      ...samplePost,
      status: 'PUBLISHED_VERIFIED',
    }
    const metrics = buildHomeMetrics([publishedPost], {
      inquiryCount: 1,
      reservationCount: 1,
    })

    expect(metrics.posts.value).toBe(1)
    expect(metrics.inquiries.value).toBe(1)
    expect(metrics.inquiries.actionHref).toBe('/app/engagement')
    expect(metrics.reservations.value).toBe(1)
    expect(metrics.reservations.actionLabel).toBe('주간 캘린더 보기')
    expect(metrics.reservations.actionHref).toBe('/app/customers?view=calendar')
  })
})
