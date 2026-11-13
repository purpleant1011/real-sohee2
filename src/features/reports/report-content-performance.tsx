import { AppLink as Link } from '@/components/navigation/app-link'
import { ArrowLeft, ArrowRight, CalendarPlus2, MessageSquareText, Trophy } from 'lucide-react'
import { DataTable } from '@/components/data/data-table'
import { PostEmbed } from '@/features/social-embed/post-embed'
import type { ContentPerformanceRow, ReportInsight } from './types'
import styles from './report-dashboard.module.css'

const channelLabels = { instagram: '인스타그램', threads: '스레드' } as const

function savedRate(row: ContentPerformanceRow): string {
  if (row.saved === null || row.visits === null || row.visits === 0) return '비교 대기'
  return `${((row.saved / row.visits) * 100).toFixed(1)}%`
}

export function ReportContentPerformance({
  rows,
  insight,
  periodQuery = '',
}: Readonly<{
  rows: readonly ContentPerformanceRow[]
  insight: ReportInsight
  periodQuery?: string
}>) {
  const base = periodQuery ? `${periodQuery}&` : ''
  const planHref = `/app/reports?${base}insight=${encodeURIComponent(insight.id)}&action=plan`
  const experimentHref = `/app/reports?${base}insight=${encodeURIComponent(insight.id)}&action=experiment`

  return (
    <div className={styles.analysisPage}>
      <Link className={styles.backLink} href={`/app/reports${periodQuery ? `?${periodQuery}` : ''}`}><ArrowLeft aria-hidden="true" />브리핑으로 돌아가기</Link>
      <header className={styles.analysisHeader}>
        <div><p>리포트</p><h1 id="report-title">콘텐츠 실험실</h1><span>잘된 이유를 찾고, 다음 게시물로 이어가요.</span></div>
        <nav aria-label="콘텐츠 성과 필터" className={styles.filterChips}>
          <button type="button">최근 30일</button><button aria-pressed="true" type="button">전체</button><button type="button">인스타그램</button><button type="button">스레드</button>
        </nav>
      </header>

      <div className={styles.analysisGrid}>
        <section aria-labelledby="performance-ranking-title" className={styles.rankingPanel}>
          <header><h2 id="performance-ranking-title">이번 달 반응을 만든 콘텐츠</h2><span>저장 반응 기준</span></header>
          {rows.length === 0 ? <p className={styles.analysisEmpty}>비교할 수집 완료 게시물이 아직 없어요.</p> : (
            <ol aria-label="콘텐츠 성과 순위">
              {rows.map((row, index) => (
                <li key={row.publishAttemptId}>
                  <span className={styles.rankNumber}>{index + 1}</span>
                  <div className={styles.rankingCopy}>
                    <strong>{row.title}</strong>
                    <span>{channelLabels[row.channel]} · 게시 버전 v{row.versionNumber}</span>
                    {index === 0 ? <em><Trophy aria-hidden="true" />저장 반응 1위</em> : null}
                  </div>
                  <dl>
                    <div><dt>저장</dt><dd>{row.saved ?? '수집 전'}</dd></div>
                    <div><dt>문의</dt><dd>{row.inquiries ?? '수집 전'}</dd></div>
                    <div><dt>저장률</dt><dd>{savedRate(row)}</dd></div>
                  </dl>
                  <PostEmbed permalink={row.permalink} title={`${row.title} 게시물`} />
                  <Link aria-label={`${row.title} 근거 보기`} href={`/app/reports?${base}work=${row.contentItemId}`}><ArrowRight aria-hidden="true" /></Link>
                </li>
              ))}
            </ol>
          )}
        </section>

        <aside className={styles.patternPanel}>
          <p>공통 근거에서 발견</p>
          <h2>이 패턴이 통했어요</h2>
          <ul>
            <li><strong>고민을 바로 말한 첫 문장</strong><span>첫 문장에서 고객의 문제를 분명히 보여줬어요.</span></li>
            <li><strong>3단계 설명</strong><span>복잡한 정보를 짧은 순서로 정리했어요.</span></li>
            <li><strong>상담 질문으로 끝내기</strong><span>반응 다음에 무엇을 하면 되는지 알려줬어요.</span></li>
          </ul>
          <Link className={styles.primaryAction} href={planHref}><MessageSquareText aria-hidden="true" />이 패턴으로 새 글 만들기</Link>
          <Link className={styles.secondaryAction} href={experimentHref}><CalendarPlus2 aria-hidden="true" />실험 일정 잡기</Link>
        </aside>
      </div>
      <section aria-labelledby="reaction-matrix-title" className={styles.reactionMatrix}>
        <header><div><h2 id="reaction-matrix-title">게시물별 핵심 반응 매트릭스</h2><p>실제 저장률을 같은 기준으로 비교해요.</p></div><span>낮음 → 높음</span></header>
        <DataTable
          caption="게시물별 핵심 반응"
          columns={[
            { key: 'title', header: '콘텐츠' },
            { key: 'channel', header: '채널' },
            { key: 'saved', header: '저장' },
            { key: 'inquiries', header: '문의' },
            { key: 'rate', header: '저장률' },
          ]}
          rows={rows.slice(0, 4).map((row) => ({
            id: row.contentVersionId,
            title: row.title,
            channel: channelLabels[row.channel],
            saved: row.saved ?? '수집 전',
            inquiries: row.inquiries ?? '수집 전',
            rate: savedRate(row),
          }))}
        />
      </section>
    </div>
  )
}
