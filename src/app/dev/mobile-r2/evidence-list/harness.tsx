'use client'

import { MobileAppShell, ShellScreen } from '@/features/mobile-shell'
import { EvidenceRecordListView } from '@/features/mobile-results/evidence-record-list-view'
import type { EvidenceRecordListSnapshot } from '@/features/mobile-results/evidence-record-list-state'

/**
 * 개발 검수용 고정 스냅샷. 서버 응답을 흉내 내지 않고, 화면이 그릴 수 있는 최대치(목록 + 잘림 안내)를
 * 그대로 보여 준다. 기록 id·UUID 는 스냅샷에 없다(설계 §3.1 2안).
 */
function readySnapshot(nowIso: string): EvidenceRecordListSnapshot {
  return {
    kind: 'ready',
    metricLabel: '게시',
    notice: null,
    records: [
      {
        recordRef: 'ref_1',
        kind: 'PUBLISH_VERIFIED',
        kindLabel: '게시 확인',
        summary: '인스타그램 게시물',
        occurredAt: '2026-10-22T05:30:00.000Z',
        detailHref: null,
      },
      {
        recordRef: 'ref_2',
        kind: 'PUBLISH_PENDING',
        kindLabel: '게시 확인 대기',
        summary: '스레드 게시물',
        occurredAt: '2026-10-23T01:10:00.000Z',
        detailHref: null,
      },
      {
        recordRef: 'ref_3',
        kind: 'PUBLISH_VERIFIED',
        kindLabel: '게시 확인',
        summary: '네이버 블로그 게시물',
        occurredAt: '2026-10-23T09:45:00.000Z',
        detailHref: null,
      },
    ],
    totalCount: 3,
    hasMore: false,
    omittedUnknownCount: 1,
    countText: '3건',
    omittedText: '확인하지 못한 종류 1건은 표시하지 않았어요.',
    checkedAtNotice: null,
    checkedAt: nowIso,
    periodLabel: '10월 20일 ~ 10월 26일 (UTC)',
    stale: false,
    showRecords: true,
    unauthorizedReason: null,
    chip: null,
  }
}

export function EvidenceListHarness({ nowIso }: Readonly<{ nowIso: string }>) {
  return (
    <MobileAppShell>
      <ShellScreen mode="DETAIL" title="근거 기록" backHref="/dev/mobile-r2/app">
        <EvidenceRecordListView snapshot={readySnapshot(nowIso)} />
      </ShellScreen>
    </MobileAppShell>
  )
}
