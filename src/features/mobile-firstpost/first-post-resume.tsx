'use client'

import { useEffect, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { useMobileR2Active } from '@/features/mobile-shell/r2-gate'
import { isFirstPostR2Enabled } from './first-post-flow'
import { StoredFirstPostFlow as FirstPostFlow } from './stored-first-post-flow'
import type { DraftDto } from './draft-mapper'
import { loadStoredFirstPostDraft } from './stored-draft-loader'
import { safeFirstPostReturnPath } from './first-post-return-path'

const DRAFTING_STATUSES = new Set([
  'draft',
  'awaiting_approval',
  'producing',
  'planning',
  'received',
])

const OUTCOME_STATUSES = new Set([
  'approved',
  'approved_for_publish',
  'executing',
  'running',
  'published_verified',
  'published',
  'completed',
])

type ResumeState =
  | { kind: 'idle'; scopeKey: string }
  | { kind: 'loading'; scopeKey: string }
  | { kind: 'flow'; scopeKey: string; draft: DraftDto }
  | { kind: 'outcome_link'; scopeKey: string; missionId: string; status: string }
  | { kind: 'unsupported_status'; scopeKey: string; status: string }
  | { kind: 'missing'; scopeKey: string; title: string; message: string }
  | { kind: 'forbidden'; scopeKey: string; title: string; message: string }
  | { kind: 'session_expired'; scopeKey: string; title: string; message: string }
  | { kind: 'offline'; scopeKey: string; title: string; message: string }
  | { kind: 'invalid'; scopeKey: string; title: string; message: string }
  | { kind: 'error'; scopeKey: string; title: string; message: string }

/**
 * 저장된 첫 포스팅 초안이 있는 미션에서만 R2 흐름으로 이어준다(새로고침 복원).
 *
 * 서버 GET(`/api/missions/first-post/[missionId]`)을 그대로 재사용한다.
 * 플래그 OFF·넓은 화면·SSR 첫 페인트 및 첫 포스팅 초안 부재(404, 일반 마케팅 임무)는
 * 기존 화면(`children`)을 보여주고 canonical 상세 조회를 차단하지 않는다.
 * 미션 상태가 승인/실행/완료인 경우 편집 플로우 대신 결과 조회 링크를 제공한다.
 * 세션 만료/권한/오프라인 상태는 적절한 안내 및 복귀 링크를 제공한다.
 */
export function FirstPostResume({
  missionId,
  workspaceId,
  fetchImpl,
  children,
}: Readonly<{
  missionId: string
  workspaceId?: string
  fetchImpl?: typeof fetch
  children: ReactNode
}>) {
  const active = useMobileR2Active() && isFirstPostR2Enabled()
  const scopeKey = `${missionId}:${workspaceId ?? ''}`
  const [state, setState] = useState<ResumeState>(() => ({ kind: 'idle', scopeKey }))

  // scopeKey가 변경되었을 때 즉시 이전 draft/결과를 숨기고 로딩 상태로 다룬다.
  const effectiveState: ResumeState =
    state.scopeKey === scopeKey ? state : { kind: 'loading', scopeKey }

  useEffect(() => {
    if (!active || !missionId) return

    const controller = new AbortController()
    let unmounted = false

    void loadStoredFirstPostDraft({
      missionId,
      workspaceId,
      fetchImpl,
      signal: controller.signal,
    }).then((result) => {
      if (unmounted || controller.signal.aborted) return

      if (result.kind === 'cancelled') return

      if (result.kind === 'ready') {
        const normalized = (result.missionStatus ?? '').trim().toLowerCase()
        if (DRAFTING_STATUSES.has(normalized)) {
          setState({ kind: 'flow', scopeKey, draft: result.draft })
        } else if (OUTCOME_STATUSES.has(normalized)) {
          setState({ kind: 'outcome_link', scopeKey, missionId, status: normalized })
        } else {
          setState({ kind: 'unsupported_status', scopeKey, status: result.missionStatus ?? '' })
        }
        return
      }

      if (result.kind === 'missing') {
        setState({
          kind: 'missing',
          scopeKey,
          title: result.error.title,
          message: result.error.description ?? '',
        })
        return
      }
      if (result.kind === 'forbidden') {
        setState({
          kind: 'forbidden',
          scopeKey,
          title: result.error.title,
          message: result.error.description ?? '',
        })
        return
      }
      if (result.kind === 'session_expired') {
        setState({
          kind: 'session_expired',
          scopeKey,
          title: result.error.title,
          message: result.error.description ?? '',
        })
        return
      }
      if (result.kind === 'offline') {
        setState({
          kind: 'offline',
          scopeKey,
          title: result.error.title,
          message: result.error.description ?? '',
        })
        return
      }
      if (result.kind === 'invalid_id' || result.kind === 'invalid') {
        setState({
          kind: 'invalid',
          scopeKey,
          title: result.error.title,
          message: result.error.description ?? '',
        })
        return
      }
      setState({
        kind: 'error',
        scopeKey,
        title: result.error.title,
        message: result.error.description ?? '',
      })
    })

    return () => {
      unmounted = true
      controller.abort()
    }
  }, [active, missionId, workspaceId, fetchImpl, scopeKey])

  if (!active || !missionId) return <>{children}</>

  if (effectiveState.kind === 'idle' || effectiveState.kind === 'loading') {
    return (
      <div role="status" className="p-4 text-center text-sm text-muted-foreground">
        초안을 불러오는 중...
      </div>
    )
  }

  if (effectiveState.kind === 'flow') {
    return <FirstPostFlow draft={effectiveState.draft} workspaceId={workspaceId} fetchImpl={fetchImpl} />
  }

  // 첫 포스팅 초안이 없는 일반 마케팅 임무는 기존 화면(children)을 정상 렌더링
  if (effectiveState.kind === 'missing') {
    return <>{children}</>
  }

  if (effectiveState.kind === 'outcome_link') {
    return (
      <div role="status" className="space-y-3 p-4 text-center">
        <p className="text-sm text-muted-foreground">
          이미 승인되었거나 발행이 진행·완료된 미션입니다. 게시 결과를 확인해 주세요.
        </p>
        <div>
          <Link
            href={`/app/outcome/${encodeURIComponent(missionId)}`}
            className="inline-flex min-h-11 items-center text-sm font-medium underline-offset-4 hover:underline"
          >
            게시 결과 상세 열기
          </Link>
        </div>
      </div>
    )
  }

  if (effectiveState.kind === 'unsupported_status') {
    return (
      <div role="alert" className="p-4 text-center text-sm text-muted-foreground">
        미션 상태를 확인할 수 없어요. 접근 권한이나 상태를 확인해 주세요.
      </div>
    )
  }

  if (effectiveState.kind === 'session_expired') {
    const returnPath = safeFirstPostReturnPath({ missionId })
    const loginHref = `/login?next=${encodeURIComponent(returnPath)}`
    return (
      <div role="alert" className="space-y-3 p-4 text-center">
        <div className="space-y-1">
          <p className="text-sm font-medium text-destructive">{effectiveState.title}</p>
          {effectiveState.message ? <p className="text-xs text-muted-foreground">{effectiveState.message}</p> : null}
        </div>
        <div>
          <Link
            href={loginHref}
            className="inline-flex min-h-11 items-center justify-center rounded-xl bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            다시 로그인하고 이어서 보기
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div role="alert" className="space-y-1 p-4 text-center">
      <p className="text-sm font-medium text-destructive">{effectiveState.title}</p>
      {effectiveState.message ? <p className="text-xs text-muted-foreground">{effectiveState.message}</p> : null}
    </div>
  )
}

/** 저장된 초안 조회 하위 호환 wrapper. 실패·초안 없음은 모두 null. */
export async function loadStoredDraft(
  missionId: string,
  workspaceId?: string,
  fetchImpl?: typeof fetch,
): Promise<DraftDto | null> {
  try {
    const result = await loadStoredFirstPostDraft({
      missionId,
      workspaceId,
      fetchImpl,
    })
    if (result.kind === 'ready') {
      return result.draft
    }
    return null
  } catch {
    return null
  }
}
