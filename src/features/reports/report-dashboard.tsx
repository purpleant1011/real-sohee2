'use client'

import { AppLink as Link } from '@/components/navigation/app-link'
import {
  AlertCircle,
  ArrowRight,
  CalendarCheck2,
  ChartNoAxesCombined,
  Clock3,
  ExternalLink,
  MessageSquareText,
  UserRound,
  X,
} from 'lucide-react'
import { useState } from 'react'
import { SocialPostPreview } from '@/features/social-post-preview/social-post-preview'
import type { SocialPostPreviewMap } from '@/features/social-post-preview/types'
import { ReportBriefingView } from './report-briefing'
import { ReportContentPerformance } from './report-content-performance'
import { ReportDataHealth } from './report-data-health'
import { ReportDecisionLedger } from './report-decision-ledger'
import type { ReportDecisionSummary } from './report-decision-repository'
import { buildReportExperience } from './report-experience'
import { ReportInsightDetail } from './report-insight-detail'
import { ReportExperimentBuilder } from './report-experiment-builder'
import { ReportPlanBuilder } from './report-plan-builder'
import { ReportSignalRadar } from './report-signal-radar'
import type {
  CustomerConversation,
  ReportExperience,
  ReportSurface,
  ReportSnapshot,
  SocialPerformanceReport,
  SocialPostReport,
  SocialReportMetric,
} from './types'
import styles from './report-dashboard.module.css'

type ReportView = 'performance' | 'reactions' | 'reservations'
type ConversationState = 'ready' | 'unavailable'

const reportViews = [
  { id: 'performance', label: '업무·게시 성과', icon: ChartNoAxesCombined },
  { id: 'reactions', label: '고객 반응', icon: MessageSquareText },
  { id: 'reservations', label: '예약 전환', icon: CalendarCheck2 },
] as const

function formatDateTime(value: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: 'Asia/Seoul',
  }).formatToParts(new Date(value))
  const valueByPart = new Map(parts.map((part) => [part.type, part.value]))
  return `${valueByPart.get('year')}.${valueByPart.get('month')}.${valueByPart.get('day')} ${valueByPart.get('hour')}:${valueByPart.get('minute')}`
}

const channelLabels = {
  instagram: '인스타그램',
  threads: '스레드',
  naver_blog: '네이버 블로그',
  naver_place: '네이버 플레이스',
} as const

const conversationStatusLabels = {
  open: '대화 진행 중',
  needs_attention: '확인 필요',
  waiting_customer: '고객 답변 대기',
  resolved: '처리 완료',
  archived: '보관됨',
} as const

const socialMetricLabels = {
  views: '조회',
  likes: '좋아요',
  comments: '댓글',
  saved: '저장',
  shares: '공유',
  replies: '답글',
  reposts: '재게시',
  quotes: '인용',
  visits: '방문',
  inquiries: '문의',
} as const

const reactionLabels = {
  comment: '댓글',
  reply: '답글',
  mention: '멘션',
  dm: 'DM',
} as const

function formatSocialMetric(metric: SocialReportMetric): string {
  const label = socialMetricLabels[metric.metric]
  if (metric.state === 'available') return `${label} ${metric.value}`
  if (metric.state === 'no_data') return `${label} 데이터 없음`
  if (metric.state === 'not_supported') return `${label} 미지원`
  if (metric.state === 'permission_denied') return `${label} 권한 없음`
  return `${label} 수집 실패`
}

function SocialPostCards({
  report,
  view,
  previews,
}: Readonly<{ report: SocialPerformanceReport; view: ReportView; previews: SocialPostPreviewMap }>) {
  if (report.posts.length === 0 && report.unlinkedReactions.length === 0) {
    return (
      <div className={styles.conversationEmpty} role="status">
        <ChartNoAxesCombined aria-hidden="true" />
        <div>
          <strong>이 기간에 연결된 실제 게시 결과가 없어요.</strong>
          <span>승인된 버전의 게시 결과와 웹훅 반응이 저장되면 업무별로 나타납니다.</span>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.socialReportSection}>
      <div className={styles.conversationHeading}>
        <div>
          <p>업무·정확한 버전·채널 연결</p>
          <h3>게시 결과 {report.posts.length}건</h3>
        </div>
        <span>{formatDateTime(report.periodStart)} – {formatDateTime(report.periodEnd)}</span>
      </div>
      <ol className={styles.socialPostList}>
        {report.posts.map((post) => (
          <SocialPostCard key={post.publishAttemptId} post={post} preview={previews[post.contentVersionId]} showReactions={view === 'reactions'} />
        ))}
      </ol>
      {view === 'reactions' && report.unlinkedReactions.length > 0 ? (
        <section className={styles.unlinkedReactions}>
          <h3>연결 업무 확인 전 반응</h3>
          <p>공급자가 게시물 참조를 주지 않은 DM 등은 업무를 추정하지 않고 채널·기간에만 보존합니다.</p>
          <ul>
            {report.unlinkedReactions.map((reaction) => (
              <li key={reaction.id}>
                <strong>{channelLabels[reaction.channel]} · {reactionLabels[reaction.category]}</strong>
                <span>{reaction.text ?? '원문 열람 권한 없음'}</span>
                <time dateTime={reaction.occurredAt}>{formatDateTime(reaction.occurredAt)}</time>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  )
}

function SocialPostCard({
  post,
  preview,
  showReactions,
}: Readonly<{ post: SocialPostReport; preview?: SocialPostPreviewMap[string]; showReactions: boolean }>) {
  const available = (names: readonly SocialReportMetric['metric'][]) => post.metrics
    .filter((metric) => names.includes(metric.metric) && metric.state === 'available')
    .reduce((total, metric) => total + (metric.value ?? 0), 0)
  const hasAvailable = (names: readonly SocialReportMetric['metric'][]) => post.metrics
    .some((metric) => names.includes(metric.metric) && metric.state === 'available')
  const acquisition = hasAvailable(['visits']) ? available(['visits']) : hasAvailable(['views']) ? available(['views']) : null
  const activation = hasAvailable(['likes', 'comments', 'saved', 'replies']) ? available(['likes', 'comments', 'saved', 'replies']) : null
  const referral = hasAvailable(['shares', 'reposts', 'quotes']) ? available(['shares', 'reposts', 'quotes']) : null
  const stages = [
    ['유입', acquisition === null ? '수집 전' : `${acquisition}`],
    ['첫 반응', activation === null ? '수집 전' : `${activation}`],
    ['재방문', post.returnVisits === null || post.returnVisits === undefined ? '추적 연결 전' : `${post.returnVisits}`],
    ['예약 가치', post.reservationValue === null || post.reservationValue === undefined ? '가치 설정 전' : `${post.reservationValue.toLocaleString('ko-KR')}원`],
    ['추천 확산', referral === null ? '수집 전' : `${referral}`],
  ] as const
  return (
    <li aria-label={`${post.workTitle} 포스트 분석`} className={styles.socialPostCard}>
      <header>
        <div>
          <p>{channelLabels[post.channel]} · 게시 버전 v{post.versionNumber}</p>
          <h3>{post.workTitle}</h3>
        </div>
        <span data-status={post.deliveryStatus}>
          {post.deliveryStatus === 'succeeded'
            ? '게시 성공'
            : post.deliveryStatus === 'failed' ? '게시 실패' : '전송 중'}
        </span>
      </header>
      {preview ? <div className={styles.reportPostPreview}><SocialPostPreview preview={preview} /></div> : null}
      <section aria-label="포스트별 AARRR 분석" className={styles.postAarrr}>
        {stages.map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}
      </section>
      <div className={styles.trackingRow}>
        <span>추적 태그</span><code>{post.trackingId ?? '발급 준비 중'}</code>
        <span>{post.reservationCount === null || post.reservationCount === undefined ? '예약 연결 전' : `예약 ${post.reservationCount}건`}</span>
      </div>
      <dl className={styles.postEvidence}>
        <div><dt>예약 시각</dt><dd>{formatDateTime(post.scheduledAt)}</dd></div>
        <div><dt>게시 시각</dt><dd>{post.publishedAt ? formatDateTime(post.publishedAt) : '확인 전'}</dd></div>
        <div><dt>채널 참조</dt><dd>{post.providerPostReference ? `채널 게시물 ${post.providerPostReference}` : '참조 없음'}</dd></div>
        {post.destinationUrl ? <div><dt>공개 게시물</dt><dd><a href={post.destinationUrl} target="_blank" rel="noreferrer">실제 게시물 열기</a></dd></div> : null}
      </dl>
      <div className={styles.socialMetricGrid}>
        {post.metrics.length === 0 ? <span>아직 수집된 채널 지표가 없어요.</span> : post.metrics.map((metric) => (
          <span data-state={metric.state} key={metric.metric}>{formatSocialMetric(metric)}</span>
        ))}
      </div>
      <p className={styles.collectionStamp}>
        수집 기간: {post.collectionPeriodStart && post.collectionPeriodEnd
          ? `${formatDateTime(post.collectionPeriodStart)} – ${formatDateTime(post.collectionPeriodEnd)}`
          : '확인 전'} · 수집 시각: {post.collectedAt ? formatDateTime(post.collectedAt) : '확인 전'}
      </p>
      <p className={styles.collectionCadence}>4시간마다 확인 · 다음 확인 {post.nextCollectionAt ? formatDateTime(post.nextCollectionAt) : '일정 준비 중'}</p>
      {showReactions ? (
        <section className={styles.postReactions}>
          <h4>이 게시물의 고객 반응 {post.reactions.length}건</h4>
          {post.reactions.length === 0 ? <p>이 기간에 연결된 댓글·DM·문의가 없어요.</p> : (
            <ul>{post.reactions.map((reaction) => (
              <li key={reaction.id}>
                <strong>{reactionLabels[reaction.category]}</strong>
                <span>{reaction.text ?? '원문 열람 권한 없음'}</span>
                <time dateTime={reaction.occurredAt}>{formatDateTime(reaction.occurredAt)}</time>
              </li>
            ))}</ul>
          )}
        </section>
      ) : null}
      <footer>
        <Link href={`/app/work/${post.contentItemId}`}>업무·버전 보기</Link>
        <Link href={`/app/reports?view=reactions&work=${post.contentItemId}`}>이 업무의 고객 반응 보기</Link>
        <Link href={`/app?work=${post.contentItemId}`}>관련 대화에서 개선하기</Link>
      </footer>
    </li>
  )
}

function CustomerConversationList({
  conversations,
  state,
}: Readonly<{
  conversations: readonly CustomerConversation[]
  state: ConversationState
}>) {
  if (state === 'unavailable') {
    return (
      <div aria-live="polite" className={styles.conversationEmpty} role="status">
        <AlertCircle aria-hidden="true" />
        <div>
          <strong>고객 대화를 불러오지 못했어요.</strong>
          <span>잠시 후 다시 열어 주세요. 지표 리포트는 그대로 확인할 수 있어요.</span>
        </div>
      </div>
    )
  }

  if (conversations.length === 0) {
    return (
      <div className={styles.conversationEmpty}>
        <MessageSquareText aria-hidden="true" />
        <div>
          <strong>아직 연결된 고객 대화가 없어요.</strong>
          <span>실제 채널 대화가 저장되면 개인정보를 줄인 요약부터 여기에 나타나요.</span>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.conversationSection}>
      <div className={styles.conversationHeading}>
        <div>
          <p>실제 저장 자료</p>
          <h3>고객 대화 {conversations.length}건</h3>
        </div>
        <span>최근 20건까지</span>
      </div>
      <ul className={styles.conversationList}>
        {conversations.map((conversation) => (
          <li key={conversation.id}>
            <Link
              aria-label={`${conversation.displayLabel} 상세 보기`}
              href={`/app/reports?view=reactions&conversation=${conversation.id}`}
            >
              <span className={styles.channelIcon} aria-hidden="true">
                <UserRound />
              </span>
              <span className={styles.conversationCopy}>
                <strong>{conversation.displayLabel}</strong>
                <span>
                  {channelLabels[conversation.channel]}
                  {' · '}
                  {conversation.intent ?? '의도 확인 전'}
                </span>
              </span>
              <span className={styles.conversationStatus} data-status={conversation.status}>
                {conversation.requiresHumanReview
                  ? '검토 필요'
                  : conversationStatusLabels[conversation.status]}
              </span>
              <ArrowRight aria-hidden="true" />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}

function CustomerConversationDialog({
  conversation,
}: Readonly<{ conversation: CustomerConversation }>) {
  return (
    <div className={styles.dialogBackdrop}>
      <section
        aria-labelledby="customer-conversation-title"
        aria-modal="true"
        className={styles.dialog}
        role="dialog"
      >
        <header className={styles.dialogHeader}>
          <Link aria-label="고객 대화 목록으로 돌아가기" href="/app/reports?view=reactions">
            <ArrowRight aria-hidden="true" />
          </Link>
          <div>
            <p>R-05 · 실제 저장 자료</p>
            <h2 id="customer-conversation-title">고객 대화 상세</h2>
          </div>
          <Link aria-label="고객 대화 상세 닫기" href="/app/reports?view=reactions">
            <X aria-hidden="true" />
          </Link>
        </header>

        <div className={styles.customerIdentity}>
          <span className={styles.customerAvatar} aria-hidden="true">
            <UserRound />
          </span>
          <div>
            <strong>{conversation.displayLabel}</strong>
            <span>
              {channelLabels[conversation.channel]}
              {' · '}
              {conversationStatusLabels[conversation.status]}
            </span>
          </div>
          {conversation.requiresHumanReview ? (
            <span className={styles.reviewBadge}>사람 확인 필요</span>
          ) : null}
        </div>

        <p className={styles.privacyNotice}>
          외부 고객 식별값과 원문은 노출하지 않고, 개인정보를 줄인 요약만 보여줘요.
        </p>

        <div className={styles.detailGrid}>
          <section className={styles.detailCard}>
            <p>관찰된 사실</p>
            <h3>{conversation.intent ?? '대화 의도 확인 전'}</h3>
            <dl>
              <div>
                <dt>채널</dt>
                <dd>{channelLabels[conversation.channel]}</dd>
              </div>
              <div>
                <dt>최근 확인</dt>
                <dd>
                  {conversation.latestMessageAt === null
                    ? '확인 시각 없음'
                    : formatDateTime(conversation.latestMessageAt)}
                </dd>
              </div>
            </dl>
          </section>

          <section className={styles.detailCard}>
            <p>저장된 대화 요약</p>
            <h3>확인된 내용</h3>
            <blockquote>{conversation.summary}</blockquote>
          </section>

          <section className={styles.detailCard} data-tone="attention">
            <p>사람의 판단</p>
            <h3>{conversation.requiresHumanReview ? '확인이 필요한 대화예요.' : '추가 확인 요청이 없어요.'}</h3>
            <span>
              {conversation.requiresHumanReview
                ? '답변이나 다음 행동을 확정하기 전에 작업공간 담당자가 확인해야 해요.'
                : '현재 저장된 상태만 보여 주며, 소희가 결과를 임의로 확정하지 않아요.'}
            </span>
          </section>

          <section className={styles.detailCard} data-tone="success">
            <p>문의·예약 전환</p>
            <h3>
              {conversation.bookingId !== null
                ? '예약 기록 연결됨'
                : conversation.inquiryId !== null
                  ? '문의 기록 연결됨'
                  : '연결 기록 확인 전'}
            </h3>
            <span>실제 연결 ID가 있을 때만 전환으로 표시해요.</span>
          </section>
        </div>

        <footer className={styles.dialogActions}>
          {conversation.relatedContentItemId !== null ? (
            <Link href={`/app/work/${conversation.relatedContentItemId}`}>
              <ExternalLink aria-hidden="true" />
              연결 콘텐츠 보기
            </Link>
          ) : (
            <span>연결된 콘텐츠 없음</span>
          )}
          {conversation.bookingId !== null ? (
            <Link href="/app/schedule">
              <CalendarCheck2 aria-hidden="true" />
              예약 일정 보기
            </Link>
          ) : null}
          <span className={styles.sourceStamp}>
            <Clock3 aria-hidden="true" />
            {channelLabels[conversation.channel]} 저장 자료
          </span>
        </footer>
      </section>
    </div>
  )
}

export function ReportDashboard({
  snapshot,
  conversations = [],
  conversationState = 'ready',
  initialView = 'performance',
  selectedConversation = null,
  socialReport,
  previousSocialReport = null,
  experience: providedExperience,
  selectedInsightId = null,
  initialSurface = 'briefing',
  initialAction = null,
  workspaceId,
  decisions = [],
  previews = {},
}: Readonly<{
  snapshot: ReportSnapshot
  conversations?: readonly CustomerConversation[]
  conversationState?: ConversationState
  initialView?: ReportView
  selectedConversation?: CustomerConversation | null
  socialReport?: SocialPerformanceReport
  previousSocialReport?: SocialPerformanceReport | null
  experience?: ReportExperience
  selectedInsightId?: string | null
  initialSurface?: ReportSurface
  initialAction?: 'plan' | 'experiment' | null
  workspaceId?: string
  decisions?: readonly ReportDecisionSummary[]
  previews?: SocialPostPreviewMap
}>) {
  const [activeView, setActiveView] = useState<ReportView>(initialView)
  const actualSocialReport = socialReport ?? Object.freeze({
    periodStart: snapshot.periodStart ? `${snapshot.periodStart}T00:00:00.000Z` : new Date(0).toISOString(),
    periodEnd: snapshot.periodEnd ? `${snapshot.periodEnd}T23:59:59.999Z` : new Date(0).toISOString(),
    posts: Object.freeze([]),
    unlinkedReactions: Object.freeze([]),
  })
  const experience = providedExperience ?? buildReportExperience({
    snapshot,
    current: actualSocialReport,
    previous: previousSocialReport,
    conversations,
  })
  const periodQuery = new URLSearchParams({
    from: experience.briefing.periodStart.slice(0, 10),
    to: experience.briefing.periodEnd.slice(0, 10),
  }).toString()

  if (initialAction === 'plan' && workspaceId) {
    return (
      <section aria-labelledby="report-plan-title" className={styles.page}>
        <ReportPlanBuilder
          insight={experience.primaryInsight}
          periodEnd={experience.briefing.periodEnd}
          periodStart={experience.briefing.periodStart}
          workspaceId={workspaceId}
        />
      </section>
    )
  }

  if (initialAction === 'experiment' && workspaceId) {
    return (
      <section aria-labelledby="report-experiment-title" className={styles.page}>
        <ReportExperimentBuilder
          insight={experience.primaryInsight}
          periodEnd={experience.briefing.periodEnd}
          periodStart={experience.briefing.periodStart}
          workspaceId={workspaceId}
        />
      </section>
    )
  }

  if (selectedInsightId === experience.primaryInsight.id) {
    return (
      <section aria-labelledby="report-title" className={styles.page}>
        <ReportInsightDetail insight={experience.primaryInsight} periodQuery={periodQuery} trend={experience.trend} />
        {selectedConversation !== null ? <CustomerConversationDialog conversation={selectedConversation} /> : null}
      </section>
    )
  }

  if (initialSurface === 'content') {
    return (
      <section aria-labelledby="report-title" className={styles.page}>
        <ReportContentPerformance insight={experience.primaryInsight} periodQuery={periodQuery} rows={experience.contentPerformance} />
      </section>
    )
  }

  if (initialSurface === 'signals') {
    return (
      <section aria-labelledby="report-title" className={styles.page}>
        <ReportSignalRadar periodQuery={periodQuery} signals={experience.customerSignals} />
      </section>
    )
  }

  if (initialSurface === 'data-health') {
    return (
      <section aria-labelledby="report-title" className={styles.page}>
        <ReportDataHealth periodQuery={periodQuery} sources={experience.dataHealth} />
      </section>
    )
  }

  if (initialSurface === 'decisions') {
    return (
      <section aria-labelledby="decision-ledger-title" className={styles.page}>
        <ReportDecisionLedger decisions={decisions} />
      </section>
    )
  }

  return (
    <section aria-labelledby="report-title" className={styles.page}>
      <ReportBriefingView experience={experience} periodQuery={periodQuery} sampleState={snapshot.sampleState} />

      <details className={styles.rawEvidenceDisclosure}>
        <summary>원자료와 게시 결과 살펴보기</summary>
        <div aria-label="원자료 보기" className={styles.reportTabs} role="tablist">
          {reportViews.map(({ id, icon: Icon, label }) => (
            <button
              aria-controls={`report-panel-${id}`}
              aria-selected={activeView === id}
              className={styles.reportTab}
              id={`report-tab-${id}`}
              key={id}
              onClick={() => setActiveView(id)}
              role="tab"
              type="button"
            >
              <Icon aria-hidden="true" strokeWidth={1.8} />
              <span>{label}</span>
            </button>
          ))}
        </div>
        <section
          aria-labelledby={`report-tab-${activeView}`}
          className={styles.flowPanel}
          id={`report-panel-${activeView}`}
          role="tabpanel"
          tabIndex={0}
        >
          <div className={styles.flowHeading}>
            <div>
              <p>정확한 게시 버전 근거</p>
              <h2>{reportViews.find((view) => view.id === activeView)?.label}</h2>
              <span>필요할 때만 게시별 원자료와 수집 상태를 펼쳐 확인합니다.</span>
            </div>
            <span className={styles.flowState}>실제 자료 기준</span>
          </div>
          <SocialPostCards previews={previews} report={actualSocialReport} view={activeView} />
          {activeView === 'reactions'
            && actualSocialReport.posts.length === 0
            && actualSocialReport.unlinkedReactions.length === 0 ? (
              <CustomerConversationList conversations={conversations} state={conversationState} />
            ) : null}
        </section>
      </details>
      {selectedConversation !== null ? (
        <CustomerConversationDialog conversation={selectedConversation} />
      ) : null}
    </section>
  )
}
