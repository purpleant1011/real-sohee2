'use client'

import Link from 'next/link'
import { ArrowRight, MessageCircle } from 'lucide-react'
import { StateView } from '@/components/mobile-ui'
import { hubStateKind, type WorkHubSnapshot } from './hub-model'
import { HubEntryRow } from './hub-entry-row'

/** 최근 작업은 3건까지만 — 허브가 작업 목록 화면을 대신하지 않는다. */
const RECENT_LIMIT = 3

/**
 * M11 작업 탭 허브. 작업 목록·알림함으로 들어가는 진입과 소희와의 대화 시작을 한 화면에 모은다.
 * 서버를 직접 부르지 않는다 — 넘겨받은 스냅샷만 그린다.
 */
export function MobileWorkHub({ snapshot }: { snapshot: WorkHubSnapshot }) {
  const recent = snapshot.recent.slice(0, RECENT_LIMIT)
  const kind = hubStateKind(snapshot.loadState, snapshot.entries.length)

  return (
    <div className="mx-auto w-full max-w-2xl space-y-5 pb-6 text-foreground">
      <header className="space-y-1 pt-1">
        <h1 className="text-2xl font-semibold tracking-tight">작업</h1>
        <p className="break-words text-base leading-relaxed text-muted-foreground">
          소희가 준비한 일과 확인할 알림을 한곳에서 봐요.
        </p>
      </header>

      <StateView kind={kind} checkedAt={snapshot.checkedAt} skeleton="list" skeletonRows={4}>
        <section aria-label="소희와 대화" className="space-y-2 rounded-2xl border border-primary/25 bg-primary/5 p-4">
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <MessageCircle className="size-4" aria-hidden="true" />무엇이든 소희에게 말하기
          </h2>
          <p className="break-words text-sm leading-5 text-muted-foreground">
            새 업무를 맡기거나 진행 상황을 물어볼 수 있어요.
          </p>
          <Link
            href="/app/command"
            prefetch={false}
            className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 text-base font-semibold text-primary-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            대화 열기<ArrowRight className="size-4" aria-hidden="true" />
          </Link>
        </section>

        <section aria-label="작업 바로 가기" className="space-y-2">
          <h2 className="text-sm font-semibold text-muted-foreground">바로 가기</h2>
          <ul className="space-y-2">
            {snapshot.entries.map(entry => <HubEntryRow key={entry.id} entry={entry} />)}
          </ul>
        </section>

        {recent.length > 0 ? (
          <section aria-label="최근 작업" className="space-y-2">
            <h2 className="text-sm font-semibold text-muted-foreground">최근 작업</h2>
            <ul className="space-y-2">
              {recent.map(row => (
                <li key={row.id}>
                  <Link
                    href={row.href}
                    prefetch={false}
                    className="flex min-h-14 w-full items-center justify-between gap-3 rounded-2xl border border-border bg-card px-4 py-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  >
                    <span className="min-w-0">
                      <span className="block break-words text-base font-medium">{row.title}</span>
                      <span className="block break-words text-sm leading-5 text-muted-foreground">{row.channelLabel}</span>
                    </span>
                    <span className="shrink-0 rounded-full bg-secondary px-2.5 py-0.5 text-xs font-medium text-secondary-foreground">
                      {row.statusLabel}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </StateView>
    </div>
  )
}
