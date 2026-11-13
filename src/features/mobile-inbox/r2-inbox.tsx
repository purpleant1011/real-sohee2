'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { MobileAppShell, ShellScreen } from '@/features/mobile-shell'
import { authFailureFromStatus, type AuthFailure } from '@/features/mobile-shell/auth-failure'
import type { LoadState } from '@/features/mobile-decision/contracts'
import { MobileInboxView, inboxScreenConfig, type InboxViewSnapshot } from './inbox-view'

const LOAD_STATES: LoadState[] = ['loading', 'ready', 'error', 'unknown', 'stale']

/**
 * 서버가 내려준 목록 계약을 그대로 확인한다. 어긋나면 빈 목록이 아니라 실패로 다룬다.
 * 다른 가게(workspaceId 불일치) 스냅샷은 그대로 그리지 않는다.
 */
function isInboxSnapshot(value: unknown, workspaceId: string): value is InboxViewSnapshot {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return (
    typeof v.loadState === 'string' &&
    LOAD_STATES.includes(v.loadState as LoadState) &&
    Array.isArray(v.threads) &&
    v.workspaceId === workspaceId &&
    typeof v.complete === 'boolean' &&
    (v.checkedAt === null || typeof v.checkedAt === 'string')
  )
}

/** 조회 실패는 '새 문의 없음'이 아니다. complete=false 로 남겨 빈 목록을 단정하지 않는다. */
function failedSnapshot(workspaceId: string): InboxViewSnapshot {
  return { loadState: 'error', threads: [], workspaceId, complete: false, checkedAt: null }
}

/** 인증 만료(401)·권한 없음(403)은 '다시 확인'으로 풀리지 않는다. 조회 실패와 구분해 알린다(ANI-1714). */
function deniedSnapshot(workspaceId: string, authFailure: AuthFailure): InboxViewSnapshot {
  return { loadState: 'error', threads: [], workspaceId, complete: false, checkedAt: null, authFailure }
}

/**
 * M13 소통함 — R2 셸 배선(ANI-1770, 플래그 뒤).
 * 기존 GET /api/workspaces/:id/mobile-inbox 읽기만 사용하며 전송·쓰기 경로는 없다.
 * 상세는 셸 라우트 맵이 M13 대화 상세로 선언한 `/app/engagement/:id` 로 넘긴다(ANI-1694).
 */
export function R2Inbox({ workspaceId }: { workspaceId: string }) {
  const router = useRouter()
  const [snapshot, setSnapshot] = useState<InboxViewSnapshot>({
    loadState: 'loading',
    threads: [],
    workspaceId,
    complete: false,
    checkedAt: null,
  })

  useEffect(() => {
    let cancelled = false
    const apply = (next: InboxViewSnapshot) => { if (!cancelled) setSnapshot(next) }
    fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/mobile-inbox`, { cache: 'no-store' })
      .then(async res => {
        // 인증 만료·권한 없음은 '새 문의 없음'도 '일시적 조회 실패'도 아니다. 같은 실패를 재시도로 반복시키지 않는다.
        const authFailure = authFailureFromStatus(res.status)
        if (authFailure) return apply(deniedSnapshot(workspaceId, authFailure))
        // 503 도 본문에 error 스냅샷을 담아 준다. 본문이 계약과 맞으면 그대로 쓰고, 아니면 error.
        const payload: unknown = await res.json().catch(() => null)
        if (isInboxSnapshot(payload, workspaceId)) return apply(payload)
        return apply(failedSnapshot(workspaceId))
      })
      .catch(() => apply(failedSnapshot(workspaceId)))
    return () => { cancelled = true }
  }, [workspaceId])

  const { mode, title } = inboxScreenConfig()
  return (
    <MobileAppShell>
      <ShellScreen mode={mode} title={title}>
        <MobileInboxView
          snapshot={snapshot}
          onCopyDraft={(_threadId, text) => {
            // 복사는 브라우저 안에서만 한다. 전송·외부 호출 없음.
            void navigator.clipboard?.writeText(text).catch(() => {})
          }}
          onOpenThread={(threadId) => {
            // 상세 화면으로 이동만 한다. 이 화면에서 전송하지 않는다.
            router.push(`/app/engagement/${encodeURIComponent(threadId)}`)
          }}
        />
      </ShellScreen>
    </MobileAppShell>
  )
}
