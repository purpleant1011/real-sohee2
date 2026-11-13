import type { ReactNode } from 'react'
import { Inbox, Lock, LogIn, TriangleAlert, WifiOff, Clock3, CircleAlert, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { FreshnessLabel } from './freshness-label'
import { SkeletonBlocks } from './skeletons'

/**
 * 정보 상태 9종(03 문서 D절). error 를 0건/빈 목록으로 바꿔 보여주면 버그 — 이 컴포넌트는 error 에서 children 을 절대 렌더하지 않는다.
 * 인증 만료(`session_expired`, 401)와 권한 없음(`unauthorized`, 403)은 다른 사건이라 따로 둔다(ANI-1714).
 */
export type StateKind = 'loading' | 'ready' | 'confirmed_empty' | 'partial' | 'stale' | 'error' | 'offline' | 'session_expired' | 'unauthorized'

export type StateViewProps = Readonly<{
  kind: StateKind
  children?: ReactNode
  /** 제목/설명은 기본 한국어 문구가 있다. 도메인 문맥이 있으면 덮어쓴다. */
  title?: string
  description?: string
  /** 마지막으로 서버에서 확인한 실제 시각(ISO). stale/partial/ready 에서 표시. */
  checkedAt?: string | null
  /** 사람이 할 다음 행동 버튼(예: 다시 확인, 채널 다시 연결). */
  action?: ReactNode
  /** loading 스켈레톤 형태. 실제 화면과 같은 모양을 쓴다. */
  skeleton?: 'list' | 'detail' | 'text'
  skeletonRows?: number
  className?: string
}>

const COPY: Record<Exclude<StateKind, 'loading' | 'ready'>, { title: string; description: string; Icon: LucideIcon }> = {
  confirmed_empty: { title: '아직 아무것도 없어요', description: '확인해 보니 해당하는 내용이 없습니다.', Icon: Inbox },
  partial: { title: '일부만 불러왔어요', description: '나머지는 다시 확인하고 있어요. 보이는 내용은 확인된 것만입니다.', Icon: CircleAlert },
  stale: { title: '이전에 확인한 내용이에요', description: '최신 상태는 다시 확인해야 해요.', Icon: Clock3 },
  error: { title: '불러오지 못했어요', description: '내용이 없는 것이 아니라, 확인에 실패한 상태예요. 다시 확인해 주세요.', Icon: TriangleAlert },
  offline: { title: '네트워크에 연결할 수 없습니다', description: '마지막 확인 내용은 서버에서 다시 확인해야 합니다.', Icon: WifiOff },
  session_expired: { title: '로그인이 만료됐어요', description: '다시 로그인하면 이어서 볼 수 있어요.', Icon: LogIn },
  unauthorized: { title: '이 내용을 볼 권한이 없어요', description: '가게 관리자에게 권한을 요청해 주세요.', Icon: Lock },
}

const TONE: Record<string, string> = {
  partial: 'bg-state-warn-soft text-state-warn',
  stale: 'bg-state-quiet-soft text-state-quiet',
  error: 'bg-state-danger-soft text-state-danger',
  offline: 'bg-state-quiet-soft text-state-quiet',
  session_expired: 'bg-state-warn-soft text-state-warn',
  unauthorized: 'bg-state-quiet-soft text-state-quiet',
  confirmed_empty: 'bg-muted text-muted-foreground',
}

export function StateView({ kind, children, title, description, checkedAt, action, skeleton = 'list', skeletonRows = 4, className }: StateViewProps) {
  if (kind === 'ready') return <>{children}</>

  if (kind === 'loading') {
    return (
      <div role="status" aria-busy="true" aria-live="polite" className={className}>
        <span className="sr-only">{title ?? '확인하는 중이에요'}</span>
        <SkeletonBlocks variant={skeleton} rows={skeletonRows} />
      </div>
    )
  }

  const copy = COPY[kind]
  const Icon = copy.Icon
  const heading = title ?? copy.title
  const body = description ?? copy.description

  // 부분/이전 확인: 내용은 그대로 두고 위에 정직한 한 줄 배너. 모든 숫자·목록은 호출 측이 "확인된 것만" 넘긴다.
  if (kind === 'partial' || kind === 'stale') {
    return (
      <div className={className}>
        <div role="status" className={cn('m-state-enter mb-3 flex items-start gap-2.5 rounded-xl px-3.5 py-3', TONE[kind])}>
          <Icon aria-hidden className="mt-0.5 size-4 shrink-0" />
          <div className="min-w-0 flex-1 text-[14px] leading-5">
            <p className="font-semibold">{heading}</p>
            <p>{body}</p>
            {/* opacity로 흐리게 하면 토큰이 보장한 4.5:1이 깨진다(4.12:1). 위계는 글자 크기로만 준다. */}
            <FreshnessLabel checkedAt={checkedAt} className="mt-0.5 block text-inherit" />
          </div>
          {action ? <div className="shrink-0">{action}</div> : null}
        </div>
        {children}
      </div>
    )
  }

  // 전체 상태 화면: error / offline / unauthorized / confirmed_empty. children 은 렌더하지 않는다.
  return (
    <div
      role={kind === 'error' ? 'alert' : 'status'}
      className={cn('m-state-enter mx-auto flex max-w-[22rem] flex-col items-center px-[var(--m-inset)] py-12 text-center', className)}
    >
      <span className={cn('mb-4 grid size-16 place-items-center rounded-2xl shadow-2xs', TONE[kind])}>
        <Icon aria-hidden className="size-7" />
      </span>
      <h2 className="text-[19px] font-bold leading-snug tracking-tight text-foreground">{heading}</h2>
      <p className="mt-1.5 text-[14px] leading-relaxed text-muted-foreground">{body}</p>
      <FreshnessLabel checkedAt={checkedAt} prefix="마지막 확인" className="mt-2" />
      {action ? <div className="mt-6 w-full">{action}</div> : null}
    </div>
  )
}
