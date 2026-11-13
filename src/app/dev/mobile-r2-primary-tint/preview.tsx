'use client'

import { SURFACES, type PrimaryTintSurface } from './surfaces'

/**
 * ANI-1666 primary 15·20% 틴트 위 텍스트 대비 검수용 화면.
 *
 * 실제 화면의 클래스 조합을 그대로 복제한다(색 계약만 검증 대상, 로직은 재현하지 않는다).
 * - mission: src/app/app/missions/[id]/page.tsx:131,191,204,211
 * - inbox:   src/features/engagement/engagement-inbox.tsx:525,557,574
 * - dm:      src/features/engagement/engagement-dm-view.tsx:338,397,411
 *
 * 배경 컨테이너는 표면마다 실제 DOM에서 확인된 것만 렌더한다. 존재하지 않는 컨테이너를 함께
 * 그리면 실제 화면에 없는 값이 증빙에 섞인다(이전 라운드의 mission light 4.39가 그런 값이었다).
 * - mission: 단계 섹션이 불투명 `bg-card`이므로 틴트는 항상 card 위에 놓인다.
 * - inbox/dm: 소통함 루트 `<main>`에 배경 클래스가 없어 V088AppShell의 `--v088-bg`(=--background)가
 *   드러나므로 틴트는 항상 background 위에 놓인다.
 * 예시 데이터만 쓰고 인증·조회·외부 요청은 하지 않는다.
 */

const LABELS: Record<PrimaryTintSurface, string> = {
  mission: '업무 상세 — 단계 카드',
  inbox: '받은 일 — 알림·탭',
  dm: '메시지 — 알림·탭',
}

type Container = 'background' | 'card'

/** 실제 화면에서 그 표면의 틴트가 놓이는 배경. 근거는 위 주석의 파일:줄. */
const CONTAINERS_BY_SURFACE: Record<PrimaryTintSurface, readonly Container[]> = {
  mission: ['card'],
  inbox: ['background'],
  dm: ['background'],
}

export function PrimaryTintPreview({ surface }: { surface: PrimaryTintSurface | 'all' }) {
  const list: readonly PrimaryTintSurface[] = surface === 'all' ? SURFACES : [surface]

  return (
    <div data-mobile-r2-primary-tint className="mx-auto w-full max-w-[390px] space-y-6 p-4">
      <div className="rounded-xl border border-border bg-card px-3 py-2 text-sm text-muted-foreground">
        <p className="font-medium text-foreground">예상 화면</p>
        <p>primary 틴트 표면의 색 대비 확인용이며 실제 업무 데이터가 아니에요.</p>
      </div>

      {list.map((name) => (
        <section key={name} data-preview-surface={name} className="space-y-2">
          <h2 className="text-sm font-bold text-foreground">{LABELS[name]}</h2>
          {CONTAINERS_BY_SURFACE[name].map((container) => (
            <div
              key={container}
              data-preview-container={container}
              className={`space-y-3 rounded-xl border border-border p-3 ${
                container === 'card' ? 'bg-card' : 'bg-background'
              }`}
            >
              {name === 'mission' ? <MissionSurface /> : null}
              {name === 'inbox' ? <InboxSurface variant="inbox" /> : null}
              {name === 'dm' ? <InboxSurface variant="dm" /> : null}
            </div>
          ))}
        </section>
      ))}
    </div>
  )
}

/** src/app/app/missions/[id]/page.tsx 의 단계 카드·배지·취소 버튼 클래스 복제. */
function MissionSurface() {
  return (
    <>
      <span
        data-preview-tint="10"
        className="text-xs font-bold text-primary px-2 py-0.5 rounded-md bg-primary/10 border border-border"
      >
        승인 대기
      </span>

      <div
        data-preview-tint="5"
        className="p-3.5 rounded-2xl border text-left space-y-1.5 transition-all bg-primary/5 border-primary shadow-xs ring-1 ring-primary/20"
      >
        <div className="flex items-center justify-between">
          <span
            data-preview-tint="20"
            className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-black bg-primary/20 text-primary"
          >
            3
          </span>
          <span className="text-xs text-muted-foreground">진행 중</span>
        </div>
        <div className="text-xs font-bold text-foreground">3. 사장님 승인</div>
        <div className="text-xs text-muted-foreground leading-tight">승인을 기다리고 있어요</div>
      </div>

      <div className="p-3.5 rounded-2xl border text-left space-y-1.5 bg-muted/40 border-border">
        <div className="flex items-center justify-between">
          <span className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-black bg-primary text-primary-foreground">
            ✓
          </span>
          <span className="text-xs text-muted-foreground">완료</span>
        </div>
        <div className="text-xs font-bold text-foreground">2. 콘텐츠 작성</div>
      </div>

      <div className="p-3.5 rounded-2xl border text-left space-y-1.5 bg-destructive/5 border-destructive/20">
        <div className="flex items-center justify-between">
          <span className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-black bg-destructive/20 text-destructive">
            ✕
          </span>
          <span className="text-xs text-destructive">취소됨</span>
        </div>
        <div className="text-xs font-bold text-foreground">4. 실제 채널 게시</div>
      </div>

      <button
        type="button"
        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold bg-destructive/10 text-destructive border border-destructive/20 min-h-11"
      >
        작업 취소
      </button>
    </>
  )
}

/** engagement-inbox.tsx / engagement-dm-view.tsx 의 라이브 알림 행·선택 탭 클래스 복제. */
function InboxSurface({ variant }: { variant: 'inbox' | 'dm' }) {
  return (
    <>
      <div
        data-preview-tint="10"
        className="rounded-xl border border-primary/20 bg-primary/10 p-4 text-sm font-semibold text-primary"
      >
        새 알림이 도착했어요
      </div>

      <div className="flex items-center gap-2 border-b border-border">
        <span className="flex items-center justify-between gap-2 px-3.5 py-2.5 text-xs font-bold border-b-2 whitespace-nowrap min-h-[44px] border-primary text-primary">
          <span>전체</span>
          <span
            data-preview-tint="15"
            className={
              variant === 'dm'
                ? 'text-[11px] px-1.5 py-0.5 rounded-full bg-primary/15 text-primary'
                : 'rounded-full px-2 py-0.5 text-xs font-semibold bg-primary/15 text-primary'
            }
          >
            3
          </span>
        </span>
        <span className="flex items-center justify-between gap-2 px-3.5 py-2.5 text-xs font-bold border-b-2 whitespace-nowrap min-h-[44px] border-transparent text-muted-foreground">
          <span>읽음</span>
        </span>
      </div>
    </>
  )
}
