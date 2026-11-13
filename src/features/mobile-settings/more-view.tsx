'use client'

import type { ComponentType } from 'react'
import {
  Bell,
  ChevronRight,
  CreditCard,
  FileText,
  HelpCircle,
  MessageSquare,
  Palette,
  Share2,
  ShieldCheck,
  Sparkles,
  Store,
  User,
} from 'lucide-react'
import { MenuRow, StateView, StatusPill, type StateKind } from '@/components/mobile-ui'
import type { ShellScreenConfig } from '@/features/mobile-shell'
import { authFailureStateKind } from '@/features/mobile-shell/auth-failure'
import { LogoutButton } from '@/components/app-shell/logout-button'
import {
  MORE_GROUP_LABEL,
  MORE_GROUP_ORDER,
  MORE_MENU_ITEMS,
  type MoreMenuItem,
  type MoreSectionId,
  type MoreViewSnapshot,
  type SectionStatus,
} from './more-model'

export interface MoreViewProps {
  snapshot: MoreViewSnapshot
  onOpenSection?: (id: MoreSectionId) => void
  onRetry?: () => void
  /** 가게 전환 요청. 실제 전환·캐시 비우기는 호스트가 서버 확인 뒤 한다. */
  onSwitchWorkspace?: (workspaceId: string) => void
}

export function moreScreenConfig(): ShellScreenConfig {
  return { mode: 'BROWSE', title: '더보기' }
}

const MENU_ICONS: Record<string, ComponentType<{ className?: string; 'aria-hidden'?: boolean | 'true' }>> = {
  store: Store,
  palette: Palette,
  sparkles: Sparkles,
  share: Share2,
  'credit-card': CreditCard,
  bell: Bell,
  'message-square': MessageSquare,
  user: User,
  'help-circle': HelpCircle,
  'file-text': FileText,
  'shield-check': ShieldCheck,
}

const BTN = 'inline-flex min-h-11 items-center justify-center rounded-xl px-4 text-sm font-medium'

function renderStatusPill(status?: SectionStatus) {
  if (!status) return null
  switch (status) {
    case 'ok':
    case 'checked':
      return <StatusPill kind="verified" />
    case 'attention':
      return <StatusPill kind="action_needed" />
    case 'unknown':
      return <StatusPill kind="checking_external" />
    case 'inactive':
      return <StatusPill kind="stopped" />
    default:
      return null
  }
}

/**
 * M25 더보기 (S2-W4):
 * 메뉴 그룹 재편: [우리 가게], [연결], [요금·결제], [알림·계정], [도움]
 * 그룹 제목 1줄, 항목은 아이콘+한 줄 이름(+선택적 상태 StatusPill). 항목 설명 문장 제거.
 * 존재하는 라우트만 연결하고 없는 것은 항목을 만들지 않는다(도움말만 신설).
 */
export function MobileMoreView({ snapshot, onOpenSection, onRetry, onSwitchWorkspace }: MoreViewProps) {
  const current = snapshot.workspaces.find(w => w.id === snapshot.workspaceId)
  // 인증 만료·권한 없음은 '내용이 없음'도 '일시적 조회 실패'도 아니다. 다시 확인해도 풀리지 않는다.
  const kind: StateKind = snapshot.authFailure
    ? authFailureStateKind(snapshot.authFailure)
    : snapshot.loadState === 'ready' ? 'ready' : snapshot.loadState === 'unknown' ? 'error' : snapshot.loadState

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 pb-6 text-foreground">
      <header className="flex flex-col gap-1.5 pt-1">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">더보기</h1>
          {current ? (
            <span className="inline-flex shrink-0 whitespace-nowrap items-center gap-1.5 rounded-full border border-border/70 bg-card px-2.5 py-1 text-xs font-medium text-foreground">
              <span className="size-1.5 rounded-full bg-primary" aria-hidden="true" />
              {current.name}
            </span>
          ) : null}
        </div>
        <p className="text-sm leading-normal text-muted-foreground">
          {current ? `지금 보는 가게: ${current.name}` : '지금 보는 가게를 확인하지 못했어요'}
        </p>
      </header>

      {snapshot.workspaces.length > 1 ? (
        <section aria-label="가게 바꾸기" className="flex flex-col gap-2">
          <h2 className="px-1 text-[13px] font-semibold text-muted-foreground">가게 바꾸기</h2>
          <ul className="flex flex-col gap-2">
            {snapshot.workspaces.map(w => {
              const isSelected = w.id === snapshot.workspaceId
              return (
                <li key={w.id}>
                  <button
                    type="button"
                    aria-current={isSelected ? 'true' : undefined}
                    disabled={isSelected}
                    onClick={() => onSwitchWorkspace?.(w.id)}
                    className={`flex min-h-11 w-full items-center justify-between gap-2 rounded-2xl px-4 text-sm font-medium transition-colors ${
                      isSelected
                        ? 'border border-primary/20 bg-primary/10 text-primary font-semibold'
                        : 'border border-border/70 bg-card text-foreground active:bg-muted/60'
                    }`}
                  >
                    <span>{w.name}</span>
                    {isSelected ? (
                      <span className="shrink-0 whitespace-nowrap rounded-full bg-primary px-2 py-0.5 text-xs font-semibold text-primary-foreground">
                        보는 중
                      </span>
                    ) : null}
                  </button>
                </li>
              )
            })}
          </ul>
          <p className="px-1 text-xs leading-4 text-muted-foreground">가게를 바꾸면 이전 가게의 승인·알림·금액은 보이지 않아요.</p>
        </section>
      ) : null}

      <StateView
        kind={kind}
        checkedAt={snapshot.checkedAt}
        skeleton="list"
        skeletonRows={6}
        action={onRetry && !snapshot.authFailure && (kind === 'error' || kind === 'stale') ? (
          <button type="button" onClick={onRetry} className={`${BTN} bg-secondary text-secondary-foreground`}>다시 확인하기</button>
        ) : undefined}
      >
        {onRetry && !snapshot.authFailure ? (
          <button type="button" onClick={onRetry} className={`${BTN} mb-3 bg-secondary text-secondary-foreground`}>
            상태 다시 확인
          </button>
        ) : null}

        <ul aria-label="설정 목록" className="flex flex-col gap-6">
          {MORE_GROUP_ORDER.map(groupId => {
            const items = MORE_MENU_ITEMS.filter(item => item.groupId === groupId)
            if (items.length === 0) return null

            return (
              <li key={groupId}>
                <section aria-label={MORE_GROUP_LABEL[groupId]} className="flex flex-col gap-2.5">
                  <h2 className="px-1 text-[13px] font-semibold tracking-wide text-muted-foreground">
                    {MORE_GROUP_LABEL[groupId]}
                  </h2>
                  <div className="overflow-hidden rounded-[20px] border border-border/70 bg-card shadow-[0_1px_2px_rgba(20,16,40,0.04)]">
                    <ul className="divide-y divide-border/60">
                      {items.map((item: MoreMenuItem) => {
                        const Icon = MENU_ICONS[item.icon] ?? Store
                        const matchedSection = item.sectionId
                          ? snapshot.sections.find(s => s.id === item.sectionId)
                          : undefined
                        const statusNode = renderStatusPill(matchedSection?.status)
                        const canNavigateWithHandler = Boolean(item.sectionId && onOpenSection)

                        const row = (
                          <MenuRow
                            href={canNavigateWithHandler ? undefined : item.href}
                            label={item.label}
                            Icon={Icon}
                            status={statusNode}
                          />
                        )

                        return (
                          <li key={item.id}>
                            {canNavigateWithHandler ? (
                              <button
                                type="button"
                                onClick={() => onOpenSection?.(item.sectionId!)}
                                className="w-full text-left transition-colors active:bg-muted/60 focus-visible:outline-2 focus-visible:outline-ring"
                              >
                                <div className="flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left">
                                  <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                                    <Icon className="size-[18px]" aria-hidden="true" />
                                  </span>
                                  <span className="min-w-0 flex-1">
                                    <span className="block text-[15px] font-medium leading-tight">{item.label}</span>
                                  </span>
                                  {statusNode ? <span className="shrink-0 text-[13px] text-muted-foreground">{statusNode}</span> : null}
                                  <ChevronRight className="size-4 shrink-0 text-muted-foreground/60" aria-hidden="true" />
                                </div>
                              </button>
                            ) : (
                              row
                            )}
                          </li>
                        )
                      })}
                    </ul>
                  </div>
                </section>
              </li>
            )
          })}
        </ul>
      </StateView>

      <section aria-label="로그아웃" className="border-t border-border/60 pt-4">
        <LogoutButton className="flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl border border-border/70 bg-card px-4 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-60" />
        <p className="mt-2 text-center text-xs leading-relaxed text-muted-foreground">로그아웃해도 가게 정보와 작업은 그대로 보관돼요.</p>
      </section>
    </div>
  )
}
