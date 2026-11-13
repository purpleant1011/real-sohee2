import type { ReportMetrics, SocialPerformanceReport } from './types'

export type AarrrStage = Readonly<{
  key: 'acquisition' | 'activation' | 'retention' | 'revenue' | 'referral'
  acronym: 'A' | 'A' | 'R' | 'R' | 'R'
  label: '유입' | '첫 반응' | '재방문' | '예약 가치' | '추천 확산'
  value: number | null
  displayValue: string
  state: 'actual' | 'collecting' | 'not_connected'
  description: string
  note: string
}>

function measuredStage(
  stage: Omit<AarrrStage, 'value' | 'displayValue' | 'state'>,
  value: number | null,
): AarrrStage {
  return Object.freeze({
    ...stage,
    value,
    displayValue: value === null ? '수집 중' : String(value),
    state: value === null ? 'collecting' : 'actual',
  })
}

function referralStage(report: SocialPerformanceReport | undefined): AarrrStage {
  const shared = {
    key: 'referral' as const,
    acronym: 'R' as const,
    label: '추천 확산' as const,
    description: '공유·재게시·인용',
    note: '채널에서 확인된 공유, 재게시, 인용만 합산해요.',
  }
  if (report === undefined || report.posts.length === 0) {
    return Object.freeze({ ...shared, value: null, displayValue: '수집 중', state: 'collecting' as const })
  }

  const referralMetrics = report.posts.flatMap((post) => post.metrics.filter((metric) => (
    metric.metric === 'shares' || metric.metric === 'reposts' || metric.metric === 'quotes'
  )))
  const available = referralMetrics.filter((metric) => metric.state === 'available')
  if (available.length === 0) {
    return Object.freeze({
      ...shared,
      value: null,
      displayValue: '측정 연결 전',
      state: 'not_connected' as const,
    })
  }

  const value = available.reduce((total, metric) => total + (metric.value ?? 0), 0)
  return Object.freeze({ ...shared, value, displayValue: String(value), state: 'actual' as const })
}

function retentionStage(report: SocialPerformanceReport | undefined): AarrrStage {
  const shared = {
    key: 'retention' as const,
    acronym: 'R' as const,
    label: '재방문' as const,
    description: '다시 찾아온 고객',
    note: '포스트 추적 태그로 확인된 익명 재방문만 합산해요.',
  }
  if (report === undefined || report.posts.length === 0) {
    return Object.freeze({ ...shared, value: null, displayValue: '측정 연결 전', state: 'not_connected' as const })
  }
  const values = report.posts.map((post) => post.returnVisits).filter((value): value is number => value !== null && value !== undefined)
  if (values.length === 0) return Object.freeze({ ...shared, value: null, displayValue: '측정 연결 전', state: 'not_connected' as const })
  const value = values.reduce((total, item) => total + item, 0)
  return Object.freeze({ ...shared, value, displayValue: String(value), state: 'actual' as const })
}

export function buildAarrrStages(
  metrics: ReportMetrics,
  socialReport?: SocialPerformanceReport,
): readonly AarrrStage[] {
  return Object.freeze([
    measuredStage({
      key: 'acquisition',
      acronym: 'A',
      label: '유입',
      description: '채널에서 확인된 방문',
      note: '연결된 SNS 채널이 제공한 방문 지표예요.',
    }, metrics.visits),
    measuredStage({
      key: 'activation',
      acronym: 'A',
      label: '첫 반응',
      description: '관심을 보인 반응',
      note: '확인된 좋아요, 댓글, 저장 등 관심 반응이에요.',
    }, metrics.engagements),
    retentionStage(socialReport),
    measuredStage({
      key: 'revenue',
      acronym: 'R',
      label: '예약 가치',
      description: '예약으로 이어진 흐름',
      note: '예약 전환 지표이며 실제 매출액이 아니에요.',
    }, metrics.reservations),
    referralStage(socialReport),
  ])
}
