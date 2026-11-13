import type { LedgerViewSnapshot } from '@/features/mobile-inbox/ledger-view'
import type { ScheduleBoard as BoardData } from '@/features/schedule/repository'

/** 예시 워크스페이스. 실제 테넌트가 아니다. */
export const PREVIEW_WORKSPACE_ID = 'preview-workspace'
export const PREVIEW_TIMEZONE = 'Asia/Seoul'

/** 오늘(KST) 날짜 키. 예시 예약이 기간 필터에 걸리지 않게 같은 날로 맞춘다. */
function kstToday(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: PREVIEW_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now)
}

/**
 * /app/schedule R2 장부 육안 검수용 예시 스냅샷 (ANI-1691).
 * 실제 예약 데이터가 아니다 — 화면이 원장 값을 어떻게 그리는지만 본다.
 * 두 번째 예약은 종료 시각 근거가 없어 '시각 확인 못함'으로 그려져야 한다(빈 값 금지).
 */
export function buildLedgerPreviewSnapshot(now: Date): LedgerViewSnapshot {
  const day = kstToday(now)
  const at = (hourKst: number) => new Date(`${day}T${String(hourKst - 9).padStart(2, '0')}:00:00.000Z`).toISOString()
  const checkedAt = now.toISOString()
  return {
    loadState: 'ready',
    workspaceId: PREVIEW_WORKSPACE_ID,
    timeZone: PREVIEW_TIMEZONE,
    now: checkedAt,
    complete: true,
    checkedAt,
    entries: [
      {
        id: 'preview-res-1',
        workspaceId: PREVIEW_WORKSPACE_ID,
        customerName: '김민지',
        serviceLabel: '속눈썹 연장',
        startsAt: at(10),
        endsAt: at(11),
        status: 'confirmed',
        source: 'customer_accepted',
        ledgerVerifiedAt: checkedAt,
        otherSurfaceStatus: null,
      },
      {
        id: 'preview-res-2',
        workspaceId: PREVIEW_WORKSPACE_ID,
        customerName: '이서연',
        serviceLabel: '네일 케어',
        startsAt: at(14),
        endsAt: '',
        status: 'pending_confirmation',
        source: 'unverified',
        ledgerVerifiedAt: null,
        otherSurfaceStatus: null,
      },
    ],
  }
}

/** 기존 일정 화면을 그릴 때 쓰는 빈 보드. 예시 데이터이며 서버 조회 결과가 아니다. */
export const EMPTY_BOARD: BoardData = {
  source: 'actual',
  partialData: false,
  unavailableSources: [],
  ready: [],
  plans: [],
  schedules: [],
  attempts: {},
  customerReservations: [],
  localPublishes: [],
  internalTasks: [],
}
