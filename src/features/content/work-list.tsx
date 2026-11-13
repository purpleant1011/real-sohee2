'use client'

import { useSearchParams } from 'next/navigation'
import { AppLink as Link } from '@/components/navigation/app-link'
import { toKoreanStatus } from '@/lib/status-labels'
import { MasterDetail } from '@/components/layout/master-detail'
import { StateView } from '@/components/mobile-ui'
import { Button } from '@/components/ui/button'
import type { ContentChannel, ContentListResult, WorkFilter } from './types'
import { isWorkSummaryAvailable, type WorkSummary } from './work-summary'
import styles from './content.module.css'

const filterLabels: ReadonlyArray<readonly [WorkFilter, string]> = [
  ['all', '전체'],
  ['in_progress', '진행 중'],
  ['recovery', '복구 필요'],
  ['approved', '승인·게시'],
]

const channelLabels: Record<ContentChannel, string> = {
  instagram: '인스타그램',
  threads: '스레드',
  naver_blog: '네이버 블로그',
  naver_place: '네이버 플레이스',
  daangn_business: '당근 비즈프로필',
}

function filterHref(filter: WorkFilter, search: string) {
  const query = new URLSearchParams()
  if (filter !== 'all') query.set('filter', filter)
  if (search) query.set('q', search)
  const serialized = query.toString()
  return serialized ? `/app/work?${serialized}` : '/app/work'
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('ko-KR', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Seoul',
  }).format(new Date(value))
}

function compactCaption(value: string | null) {
  if (value === null) return '아직 게시 문구가 없어요.'
  const clean = value.replace(/\s+/gu, ' ').trim()
  return clean.length > 76 ? `${clean.slice(0, 76)}…` : clean
}

export function WorkList({
  activeFilter,
  data,
  search,
  summary,
  selectedId,
}: Readonly<{
  activeFilter: WorkFilter
  data: ContentListResult
  search: string
  summary: WorkSummary
  selectedId?: string | null
}>) {
  const searchParams = useSearchParams()
  const selectedItemId = selectedId ?? searchParams?.get('item') ?? null
  const selectedItem = data.items.find((item) => item.id === selectedItemId) ?? null

  const summaryCounts = isWorkSummaryAvailable(summary)
    ? {
        all: summary.all,
        in_progress: summary.inProgress,
        recovery: summary.recovery,
        approved: summary.approved,
      }
    : null

  const listContent = (
    <div className="space-y-4">
      <section className={styles.filters} aria-label="대화 결과 필터">
        <nav className={styles.tabList} aria-label="콘텐츠 상태">
          {filterLabels.map(([filter, label]) => (
            <Link
              key={filter}
              className={styles.tabLink}
              href={filterHref(filter, search)}
              aria-current={activeFilter === filter ? 'page' : undefined}
            >
              {label} {summaryCounts ? summaryCounts[filter] : '수를 확인할 수 없음'}
            </Link>
          ))}
        </nav>
        <form action="/app/work" className={styles.searchForm} role="search">
          {activeFilter !== 'all' ? <input type="hidden" name="filter" value={activeFilter} /> : null}
          <input
            className={styles.searchInput}
            defaultValue={search}
            name="q"
            placeholder="제목으로 작업 찾기"
            aria-label="작업 제목 검색"
            maxLength={100}
          />
          <button className={styles.searchButton} type="submit">찾기</button>
        </form>
      </section>

      {data.items.length === 0 ? (
        <StateView
          kind="confirmed_empty"
          title="조건에 맞는 작업이 아직 없어요"
          description="검색어나 상태 필터를 바꾸면 다른 작업을 확인할 수 있습니다."
          action={
            <Button asChild variant="outline" className="min-h-11">
              <Link href="/app">소희에게 글 맡기기</Link>
            </Button>
          }
        />
      ) : (
        <ul className={styles.cardList}>
          {data.items.map((item) => {
            const isSelected = item.id === selectedItemId
            return (
              <li key={item.id}>
                <Link
                  className={styles.cardLink}
                  href={`/app/work/${item.id}`}
                  aria-current={isSelected ? 'true' : undefined}
                >
                  <div className={styles.cardTop}>
                    <span className={styles.status}>
                      {item.needsRecovery ? '게시 복구 필요' : toKoreanStatus(item.status)}
                    </span>
                    <span className={styles.versionBadge}>
                      {item.currentVersionNumber ? `v${item.currentVersionNumber}` : '버전 없음'}
                    </span>
                  </div>
                  <div>
                    <h2 className={styles.cardTitle}>{item.title}</h2>
                    <p className={styles.caption}>{compactCaption(item.currentCaption)}</p>
                  </div>
                  <div className={styles.cardMeta}>
                    <span>{channelLabels[item.channel]}</span>
                    <time className={styles.timestamp} dateTime={item.updatedAt}>{formatDate(item.updatedAt)}</time>
                  </div>
                </Link>
              </li>
            )
          })}
        </ul>
      )}

      {data.nextCursor ? (
        <Link
          className={styles.secondaryLink}
          href={`${filterHref(activeFilter, search)}${filterHref(activeFilter, search).includes('?') ? '&' : '?'}cursor=${encodeURIComponent(data.nextCursor)}`}
        >
          다음 작업 보기
        </Link>
      ) : null}
    </div>
  )

  const detailContent = selectedItem ? (
    <div className="space-y-5 rounded-2xl border border-border bg-card p-5 sm:p-6 shadow-2xs">
      <header className="space-y-2 border-b border-border pb-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-semibold text-muted-foreground">
            {channelLabels[selectedItem.channel]}
          </span>
          <span className="rounded-full border border-border px-2.5 py-0.5 text-xs font-semibold text-foreground">
            {selectedItem.needsRecovery ? '게시 복구 필요' : toKoreanStatus(selectedItem.status)}
          </span>
          <span className="text-xs font-mono text-muted-foreground">
            {selectedItem.currentVersionNumber ? `v${selectedItem.currentVersionNumber}` : '버전 없음'}
          </span>
        </div>
        <h2 className="text-xl font-bold tracking-tight text-foreground">{selectedItem.title}</h2>
        <p className="text-xs text-muted-foreground">최종 수정: {formatDate(selectedItem.updatedAt)}</p>
      </header>

      <section aria-label="작업 미리보기" className="space-y-2">
        <h3 className="text-sm font-semibold text-foreground">게시 문구 미리보기</h3>
        <div className="whitespace-pre-wrap rounded-xl border border-border bg-muted/30 p-4 text-sm leading-relaxed text-foreground">
          {selectedItem.currentCaption || '아직 게시 문구가 준비되지 않았어요.'}
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-border">
        <Button asChild size="sm" className="min-h-11">
          <Link href={`/app/work/${selectedItem.id}/approve`}>승인 및 게시 확인</Link>
        </Button>
        <Button asChild size="sm" variant="outline" className="min-h-11">
          <Link href={`/app/work/${selectedItem.id}/edit`}>새 버전 만들기</Link>
        </Button>
        <Button asChild size="sm" variant="ghost" className="min-h-11">
          <Link href={`/app/work/${selectedItem.id}`}>작업 상세 열기</Link>
        </Button>
      </div>
    </div>
  ) : null

  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}>
        <div>
          <p className={styles.eyebrow}>작업 공간</p>
          <h1>대화에서 만든 결과</h1>
          <p className={styles.pageIntro}>
            준비된 작업 상태를 확인하세요.
          </p>
        </div>
        <div className={styles.formActions}>
          <span className={styles.actualBadge}>실제 데이터</span>
          <Link className={styles.primaryLink} href="/app">소희와 콘텐츠 만들기</Link>
        </div>
      </header>

      <MasterDetail
        listLabel="작업 목록"
        detailLabel="작업 상세 미리보기"
        list={listContent}
        detail={detailContent}
        emptyDetail={<p className="text-sm text-muted-foreground">왼쪽에서 하나를 골라 보세요.</p>}
        hasSelection={Boolean(selectedItem)}
      />
    </div>
  )
}
