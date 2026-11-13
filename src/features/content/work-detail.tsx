'use client'

import Image from 'next/image'
import { AppLink as Link } from '@/components/navigation/app-link'
import { toKoreanStatus } from '@/lib/status-labels'
import type { ApprovalPreviewSnapshot, ContentChannel, ContentDetail } from './types'
import type { WorkspaceRole } from '@/features/auth/workspace-context'
import { ApprovalPanel } from '@/features/approvals/approval-panel'
import { NaverReviewStep } from '@/features/channel-studio/naver/ui/naver-review-step'
import type { SocialPerformanceReport, SocialPostReport, SocialReportMetric } from '@/features/reports/types'
import { useSocialPerformanceRefresh } from '@/features/mobile-work/use-social-performance-refresh'
import { PostEmbed } from '@/features/social-embed/post-embed'
import styles from './content.module.css'

const channelLabels: Record<ContentChannel, string> = {
  instagram: '인스타그램',
  threads: '스레드',
  naver_blog: '네이버 블로그',
  naver_place: '네이버 플레이스',
  daangn_business: '당근 비즈프로필',
}

const roleLabels = {
  cover: '표지',
  detail: '상세',
  proof: '확인 내용',
  action: '행동 유도',
} as const

function countMediaChanges(
  current: ContentDetail['versions'][number],
  previous: ContentDetail['versions'][number],
) {
  const positions = new Set([
    ...current.media.map((media) => media.position),
    ...previous.media.map((media) => media.position),
  ])
  return [...positions].filter((position) => {
    const currentId = current.media.find((media) => media.position === position)?.id
    const previousId = previous.media.find((media) => media.position === position)?.id
    return currentId !== previousId
  }).length
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('ko-KR', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Seoul',
  }).format(new Date(value))
}

const socialMetricLabels = {
  views: '조회', likes: '좋아요', comments: '댓글', saved: '저장', shares: '공유',
  replies: '답글', reposts: '재게시', quotes: '인용', visits: '방문', inquiries: '문의',
} as const

function formatSocialMetric(metric: SocialReportMetric) {
  const label = socialMetricLabels[metric.metric]
  if (metric.state === 'available') return `${label} ${metric.value}`
  if (metric.state === 'no_data') return `${label} 확인하지 못했어요`
  if (metric.state === 'not_supported') return `${label} 미지원`
  if (metric.state === 'permission_denied') return `${label} 권한 없음`
  return `${label} 수집 실패`
}

function SocialPostItem({
  post,
  workspaceId,
  fallbackPermalink,
}: {
  post: SocialPostReport
  workspaceId?: string
  fallbackPermalink?: string | null
}) {
  const permalink = post.destinationUrl || fallbackPermalink

  const isEligibleForRefresh =
    Boolean(workspaceId) &&
    post.deliveryStatus === 'succeeded' &&
    Boolean(post.providerPostReference)

  const performance = useSocialPerformanceRefresh({
    workspaceId: workspaceId ?? '',
    publishAttemptId: post.publishAttemptId,
    publishedAt: post.publishedAt,
    initialMetrics: post.metrics,
    initialCollectedAt: post.collectedAt,
  })

  const currentMetrics = performance.metrics ?? post.metrics
  const currentCollectedAt = performance.collectedAt ?? post.collectedAt

  return (
    <li className={styles.versionCard} key={post.publishAttemptId}>
      <div className={styles.versionHeading}>
        <strong>{channelLabels[post.channel]} · 게시 버전 v{post.versionNumber}</strong>
        <span className={styles.status}>
          {post.deliveryStatus === 'succeeded' ? '게시 성공' : post.deliveryStatus === 'failed' ? '게시 실패' : '전송 중'}
        </span>
      </div>
      <p className={styles.muted}>
        게시 시각 {post.publishedAt ? formatDate(post.publishedAt) : '확인 전'} · {post.providerPostReference ? `채널 게시물 ${post.providerPostReference}` : '채널 참조 없음'}
      </p>
      {permalink ? (
        <div style={{ marginTop: '0.25rem', marginBottom: '0.5rem' }}>
          <PostEmbed permalink={permalink} />
        </div>
      ) : null}
      <p className={styles.muted}>
        {currentMetrics.length > 0 ? currentMetrics.map(formatSocialMetric).join(' · ') : '아직 수집된 채널 지표가 없습니다.'}
      </p>
      <p className={styles.muted}>
        수집 시각 {currentCollectedAt ? formatDate(currentCollectedAt) : '확인 전'}
      </p>

      {isEligibleForRefresh ? (
        <div style={{ marginTop: '0.25rem', marginBottom: '0.5rem' }}>
          <button
            type="button"
            className={styles.secondaryLink}
            disabled={performance.isPending || performance.cooldownRemaining > 0}
            onClick={() => void performance.refresh()}
          >
            {performance.isPending ? '불러오는 중…' : '성과 새로고침'}
          </button>
          {performance.error ? (
            <p role="alert" className={styles.muted} style={{ color: 'var(--color-destructive, #dc2626)', marginTop: '0.25rem' }}>
              <span>{performance.error}</span>
              {performance.isMissingScope ? (
                <Link href="/app/channels" style={{ marginLeft: '0.5rem', textDecoration: 'underline' }}>
                  채널 연결
                </Link>
              ) : null}
            </p>
          ) : null}
        </div>
      ) : null}

      <div>
        <strong>고객 반응 {post.reactions.length}건</strong>
        {post.reactions.length > 0 ? (
          <ul className={styles.checkboxList}>
            {post.reactions.map((reaction) => (
              <li key={reaction.id}>{reaction.text ?? '원문 열람 권한 없음'} · {formatDate(reaction.occurredAt)}</li>
            ))}
          </ul>
        ) : <p className={styles.muted}>이 게시물에 연결된 댓글·DM·문의가 없습니다.</p>}
      </div>
    </li>
  )
}

export function WorkDetail({
  detail,
  role,
  workspaceId,
  socialReport,
  preview,
  conversationWorkbenchEnabled = false,
  fallbackPermalink,
}: Readonly<{
  detail: ContentDetail
  role?: WorkspaceRole
  workspaceId?: string
  socialReport?: SocialPerformanceReport
  preview?: ApprovalPreviewSnapshot
  conversationWorkbenchEnabled?: boolean
  fallbackPermalink?: string | null
}>) {
  const currentVersion = detail.versions.find((version) => version.id === detail.currentVersionId)
  const currentVersionPosts = currentVersion && socialReport
    ? socialReport.posts.filter((post) => post.contentVersionId === currentVersion.id)
    : []
  const currentVersionDeliveryFailed = currentVersionPosts.length > 0
    && currentVersionPosts.every((post) => post.deliveryStatus === 'failed')
  const canReviewOrRecover = (
    currentVersionPosts.length === 0
    && (detail.status === 'review' || detail.status === 'approved')
  )
    || (
      detail.status === 'scheduled'
      && preview?.approval.status === 'approved'
      && currentVersionDeliveryFailed
    )
  return (
    <article className={styles.page}>
      <Link className={styles.backLink} href="/app/work">← 대화 결과 목록으로</Link>
      {conversationWorkbenchEnabled && currentVersion && detail.status !== 'archived' ? <Link className={styles.secondaryLink} href={`/app/conversations?workRef=${currentVersion.id}`}>이 원고를 소희와 검토</Link> : null}

      <header className={styles.detailHeader}>
        <div>
          <p className={styles.eyebrow}>{channelLabels[detail.channel]}</p>
          <h1>{detail.title}</h1>
          <p className={styles.pageIntro}>수정할 때마다 이전 내용을 덮지 않고 새 버전으로 안전하게 남깁니다.</p>
        </div>
        <span className={styles.actualBadge}>실제 데이터</span>
      </header>

      <dl className={styles.summaryGrid}>
        <div className={styles.summaryCard}>
          <dt>현재 상태</dt>
          <dd>{toKoreanStatus(detail.status)}</dd>
        </div>
        <div className={styles.summaryCard}>
          <dt>현재 버전</dt>
          <dd>{detail.currentVersionNumber ? `v${detail.currentVersionNumber}` : '아직 없음'}</dd>
        </div>
        <div className={styles.summaryCard}>
          <dt>최근 변경</dt>
          <dd>{formatDate(detail.updatedAt)}</dd>
        </div>
      </dl>

      <section className={styles.historySection} aria-labelledby="version-history-title">
        <div>
          <p className={styles.eyebrow}>수정 이력</p>
          <h2 id="version-history-title">버전 기록</h2>
        </div>

        {detail.versions.length === 0 ? (
          <div className={styles.emptyState}>
            <h3>아직 만든 버전이 없어요</h3>
            <p className={styles.muted}>새 버전을 만들면 내용과 변경 이유가 시간순으로 여기에 남습니다.</p>
          </div>
        ) : (
          <ol className={styles.versionList}>
            {detail.versions.map((version, index) => {
              const isCurrent = version.id === detail.currentVersionId
              const previousVersion = detail.versions[index + 1]
              const mediaChanges = previousVersion
                ? countMediaChanges(version, previousVersion)
                : null
              return (
                <li key={version.id} className={styles.versionCard} data-current={isCurrent}>
                  <div className={styles.versionHeading}>
                    <h3>{isCurrent ? `현재 v${version.versionNumber}` : `이전 v${version.versionNumber}`}</h3>
                    <time className={styles.timestamp} dateTime={version.createdAt}>{formatDate(version.createdAt)}</time>
                  </div>
                  <p className={styles.versionCaption}>{version.caption}</p>
                  {version.hashtags.length > 0 ? <p className={styles.muted}>{version.hashtags.join(' ')}</p> : null}
                  {version.disclosure ? <p className={styles.muted}>고지: {version.disclosure}</p> : null}
                  {version.revisionReason ? <p className={styles.muted}>변경 이유: {version.revisionReason}</p> : null}
                  {mediaChanges !== null ? (
                    <p className={styles.mediaChange}>이전 버전과 이미지 변경 {mediaChanges}건</p>
                  ) : null}
                  {version.media.length === 0 ? (
                    <p className={styles.muted}>이미지 없음</p>
                  ) : (
                    <div className={styles.versionMediaGrid}>
                      {version.media.map((media) => (
                        <figure key={`${version.id}:${media.id}`} className={styles.versionMediaCard}>
                          {workspaceId ? (
                            <Image
                              className={styles.versionMediaImage}
                              src={`/api/workspaces/${workspaceId}/media/${media.id}`}
                              alt={media.altText || `${media.position}번 이미지, 대체 텍스트 없음`}
                              width={640}
                              height={640}
                              unoptimized
                            />
                          ) : null}
                          <figcaption className={styles.versionMediaCaption}>
                            <strong>
                              {media.position}번 · {media.role ? roleLabels[media.role] : '역할 미기록'}
                            </strong>
                            <span>{media.altText || '대체 텍스트 없음'}</span>
                            <span>
                              {media.rightsStatus === 'confirmed' ? '사용권 확인됨' : '사용권 확인 필요'}
                            </span>
                            <span>
                              {version.generationEvidenceConfirmed
                                ? '내용 확인됨'
                                : '내용 확인 필요'}
                            </span>
                          </figcaption>
                        </figure>
                      ))}
                    </div>
                  )}
                </li>
              )
            })}
          </ol>
        )}
      </section>

      {socialReport ? (
        <section className={styles.historySection} aria-labelledby="work-social-report-title">
          <div>
            <p className={styles.eyebrow}>REPORT CONNECTION</p>
            <h2 id="work-social-report-title">게시 결과와 고객 반응</h2>
            <p className={styles.muted}>
              이 업무에서 승인·게시된 정확한 버전과 실제 채널 수집값입니다.
            </p>
          </div>
          {socialReport.posts.length === 0 ? (
            <div className={styles.emptyState}>
              <p>선택한 기간에 이 업무와 연결된 실제 게시 결과가 없습니다.</p>
              {fallbackPermalink ? (
                <div style={{ marginTop: '0.75rem' }}>
                  <PostEmbed permalink={fallbackPermalink} />
                </div>
              ) : null}
            </div>
          ) : (
            <ol className={styles.versionList}>
              {socialReport.posts.map((post) => (
                <SocialPostItem
                  key={post.publishAttemptId}
                  post={post}
                  workspaceId={workspaceId}
                  fallbackPermalink={fallbackPermalink}
                />
              ))}
            </ol>
          )}
          <Link className={styles.secondaryLink} href={`/app/reports?view=reactions&work=${detail.id}`}>
            리포트에서 전체 흐름 보기
          </Link>
        </section>
      ) : fallbackPermalink ? (
        <section className={styles.historySection} aria-labelledby="work-social-report-title">
          <div>
            <p className={styles.eyebrow}>REPORT CONNECTION</p>
            <h2 id="work-social-report-title">게시 결과</h2>
          </div>
          <div style={{ marginTop: '0.75rem' }}>
            <PostEmbed permalink={fallbackPermalink} />
          </div>
        </section>
      ) : null}

      {detail.channel === 'naver_blog' && workspaceId && detail.currentVersionId ? (
        <NaverReviewStep
          workspaceId={workspaceId}
          contentId={detail.id}
          settings={{
            visibility: 'public',
            categoryName: null,
            imageCount: currentVersion?.media.length ?? 0,
          }}
        />
      ) : canReviewOrRecover && currentVersion && role && workspaceId && preview ? (
        <ApprovalPanel role={role} preview={preview} />
      ) : null}

      <section className={styles.decisionArea} aria-label="콘텐츠 결정 영역">
        <div className={styles.decisionCopy}>
          <strong>다음 행동</strong>
          <span>새 버전을 만들거나 승인 이후 일정을 이어가세요.</span>
        </div>
        <div className={styles.decisionLinks}>
          <Link className={styles.primaryLink} href={`/app/work/${detail.id}/edit`}>새 버전 만들기</Link>
          <Link className={styles.secondaryLink} href="/app/schedule">일정 보기</Link>
        </div>
      </section>
    </article>
  )
}
