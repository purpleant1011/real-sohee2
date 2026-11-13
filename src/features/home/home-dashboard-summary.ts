export interface DashboardMetricsInput<TPost extends { status: string } = { status: string; [key: string]: any }> {
  posts: TPost[] | null
  postsError?: boolean
  pipelineData: { inquiryCount: number; bookedCount: number } | null
  pipelineError?: boolean
  approvalsSummary?: {
    total: number
    comments: number
    posts: number
    dms: number
    proposals: number
  } | null
}

export interface MetricCardValue {
  label: string
  value: number | null
  unit?: string
  subtext: string
  hasError: boolean
}

export interface DashboardMetricsResult {
  activeTasks: MetricCardValue
  published: MetricCardValue
  confirmedBookings: MetricCardValue
}

/**
 * 5차 신뢰 헌법 준수:
 * 1. synthetic success, hardcoded ACTUAL metrics, 0값을 4/10으로 조작하는 행위 전면 배제
 * 2. PUBLISHED_VERIFIED 등 게시 근거가 실제 확인된 게시물만 집계 (COMPLETED/LISTENING 제외)
 * 3. 오류 시 0이 아니라 hasError: true & value: null로 표시 (ERROR != EMPTY)
 * 4. 입증되지 않은 기간 단정('이번 주' 등) 배제
 */
export function evaluateDashboardMetrics<TPost extends { status: string } = { status: string; [key: string]: any }>(
  input: DashboardMetricsInput<TPost>
): DashboardMetricsResult {
  const { posts, postsError, pipelineData, pipelineError, approvalsSummary } = input

  // 1. 소희가 하는 일 (대기 및 진행 중인 업무)
  const pendingApprovalsCount = approvalsSummary?.total ?? 0
  const activeTasks: MetricCardValue = {
    label: '소희가 하는 일',
    value: pendingApprovalsCount,
    unit: '건',
    subtext: pendingApprovalsCount > 0 ? `결정 대기 ${pendingApprovalsCount}건` : '대기 항목 없음',
    hasError: false,
  }

  // 2. 게시 확인 (실제 PUBLISHED_VERIFIED 확인된 게시물만)
  let publishedValue: number | null = null
  let publishedError = Boolean(postsError)
  if (!publishedError && posts) {
    const verifiedPosts = posts.filter((p) => p.status === 'PUBLISHED_VERIFIED')
    publishedValue = verifiedPosts.length
  } else if (!publishedError && !posts) {
    publishedError = true
  }

  const published: MetricCardValue = {
    label: '게시 확인',
    value: publishedValue,
    unit: '건',
    subtext: publishedValue !== null && publishedValue > 0 ? '게시 근거 확인됨' : '확인된 게시 기록',
    hasError: publishedError,
  }

  // 3. 확인된 예약 (고객 파이프라인 실집계 기준)
  let bookingValue: number | null = null
  let bookingError = Boolean(pipelineError)
  if (!bookingError && pipelineData) {
    bookingValue = pipelineData.bookedCount ?? 0
  } else if (!bookingError && !pipelineData) {
    bookingError = true
  }

  const confirmedBookings: MetricCardValue = {
    label: '확인된 예약',
    value: bookingValue,
    unit: '건',
    subtext: bookingValue !== null && bookingValue > 0 ? '예약 기록 기준' : '예약 기록 없음',
    hasError: bookingError,
  }

  return {
    activeTasks,
    published,
    confirmedBookings,
  }
}

export function formatConversionText(inquiries: number | null, bookings: number | null): string {
  if (inquiries === null || bookings === null) {
    return '기록 확인 중'
  }
  return `${inquiries} → ${bookings}건`
}

export function formatRevenueText({
  hasPaymentConnected = false,
  verifiedRevenueKrw,
}: {
  hasPaymentConnected?: boolean
  verifiedRevenueKrw?: number | null
}): string {
  if (!hasPaymentConnected || verifiedRevenueKrw === undefined || verifiedRevenueKrw === null) {
    return '결제 내역 연결 필요'
  }
  return `${verifiedRevenueKrw.toLocaleString()}원`
}
