'use client'

import { StateView } from '@/components/mobile-ui'
import { hubStateKind, type MoreHubSnapshot } from './hub-model'
import { HubEntryRow } from './hub-entry-row'

/**
 * M25 더보기 탭 허브. 채널·크레딧·가게 기억·설정으로 들어가는 진입만 모은다.
 * 실제 값은 각 화면이 서버 정본으로 확인한다 — 이 화면은 개수도 넘겨받은 값만 표시한다.
 */
export function MobileMoreHub({ snapshot }: { snapshot: MoreHubSnapshot }) {
  const kind = hubStateKind(snapshot.loadState, snapshot.entries.length)

  return (
    <div className="mx-auto w-full max-w-2xl space-y-5 pb-6 text-foreground">
      <header className="space-y-1 pt-1">
        <h1 className="text-2xl font-semibold tracking-tight">더보기</h1>
        <p className="break-words text-base leading-relaxed text-muted-foreground">
          가게 연결과 설정을 여기서 확인해요.
        </p>
      </header>

      <StateView kind={kind} checkedAt={snapshot.checkedAt} skeleton="list" skeletonRows={4}>
        <section aria-label="설정 바로 가기" className="space-y-2">
          <h2 className="text-sm font-semibold text-muted-foreground">바로 가기</h2>
          <ul className="space-y-2">
            {snapshot.entries.map(entry => <HubEntryRow key={entry.id} entry={entry} />)}
          </ul>
        </section>
      </StateView>
    </div>
  )
}
