'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { StateView } from '@/components/mobile-ui'
import { MobileAppShell } from '@/features/mobile-shell'
import { useMobileR2Active } from '@/features/mobile-shell/r2-gate'
import { ResultScreenView } from '@/features/mobile-firstpost/result-screen-view'
import type { ResultActionItem, ResultEvidence, ResultScreenInput } from '@/features/mobile-firstpost/result-screen'
import {
  deriveFirstPostOutcome,
  type OutcomeChannel,
  type OutcomeInput,
} from '@/features/mobile-firstpost/publish-outcome'
import { parseExecutionResult } from '@/features/mobile-firstpost/publish-client'
import { useExternalWriteGuard } from '@/features/pwa/use-external-write-guard'

/**
 * M08 첫 게시 결과 상세 — `/app/outcome/:id` (ANI-1681, proposed → existing).
 *
 * 결과 화면을 다시 열었을 때 **서버에 저장된 마지막 실행 결과**를 읽어 보여준다
 * (`GET /api/missions/first-post/:id/outcome`, 읽기 전용).
 *
 * 이 화면이 하지 않는 일:
 * - 결과를 새로 만들거나 올리지 않는다. 서버 `executionResult` 를 strict 하게 읽기만 한다.
 * - 게시를 자동 실행하지 않는다. 재시도는 서버가 허용한 실패 채널에 한해 사용자가 누를 때만
 *   기존 재시도 명령(`POST /api/missions/first-post/publish/retry`)을 그대로 부른다.
 * - 응답을 읽지 못하면 '결과 없음'이 아니라 오류다(빈 화면·성공으로 위장하지 않는다).
 */

type Snapshot =
  | { kind: 'loading' }
  | { kind: 'ready'; input: ResultScreenInput; checkedAt: string }
  /** 서버에 저장된 실행 결과가 아직 없다. 실패가 아니라 '아직 요청 전'. */
  | { kind: 'empty'; checkedAt: string }
  | { kind: 'missing' }
  | { kind: 'error'; checkedAt: string }

const CHANNELS: readonly OutcomeChannel[] = ['instagram', 'threads']

/** 플래그 OFF·넓은 화면이 되돌아갈 곳. 결과 상세의 IA 는 작업함 아래에 있다. */
export function legacyOutcomePath(): string {
  return '/app/content'
}

export function OutcomeDetailEntry({
  missionId,
  workspaceId,
}: Readonly<{ missionId: string; workspaceId: string }>) {
  const active = useMobileR2Active()
  const router = useRouter()
  const queryKey = `${missionId}\u0000${workspaceId}`
  /**
   * 결과는 조회 대상(미션·매장)에 묶어 보관한다. 대상이 바뀐 렌더에서는
   * 이전 ready 스냅샷을 보여 주지 않고 즉시 로딩으로 되돌린다.
   */
  const [stated, setStated] = useState<{ key: string; snapshot: Snapshot }>(() => ({
    key: queryKey,
    snapshot: { kind: 'loading' },
  }))
  const snapshot: Snapshot = stated.key === queryKey ? stated.snapshot : { kind: 'loading' }
  const [reloadToken, setReloadToken] = useState(0)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const runExternalWrite = useExternalWriteGuard()

  useEffect(() => {
    if (!active) return
    let cancelled = false
    void readOutcome(missionId, workspaceId).then(next => {
      // 대상이 바뀐 뒤 도착한 이전 조회 응답은 버린다(늦은 응답이 새 결과를 덮지 않게).
      if (!cancelled) setStated({ key: queryKey, snapshot: next })
    })
    return () => {
      cancelled = true
    }
  }, [active, missionId, workspaceId, queryKey, reloadToken])

  // 넓은 화면은 이 상세를 그리지 않는다 — 같은 결과를 두 UI 로 동시에 그리지 않는다.
  useEffect(() => {
    if (!active) router.replace(legacyOutcomePath())
  }, [active, router])

  if (!active) {
    return <p role="status" className="p-6 text-sm text-muted-foreground">작업함으로 이동하고 있어요.</p>
  }

  // 다시 확인은 사용자 행동에서 시작한다. 효과 안에서 setState 하지 않는다(연쇄 렌더 방지).
  const reload = () => {
    setStated({ key: queryKey, snapshot: { kind: 'loading' } })
    setReloadToken(value => value + 1)
  }

  async function retry(item: ResultActionItem) {
    if (busy || !item.channel) return
    setMessage(null)
    // 재시도는 실제 게시 요청이다. 오프라인이거나 같은 건이 이미 진행 중이면 요청을 내보내지 않는다(ANI-1778).
    const outcome = await runExternalWrite('publish', `first-post:${missionId}`, async () => {
      setBusy(true)
      try {
        const response = await fetch('/api/missions/first-post/publish/retry', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-workspace-id': workspaceId },
          body: JSON.stringify({ missionId, targetChannel: item.channel }),
        })
        const payload = await response.json().catch(() => null)
        if (!response.ok) {
          // 응답을 읽지 못한 재시도는 성공도 실패도 아니다 — 결과를 다시 확인한다.
          setMessage(errorMessage(payload, '다시 시도하지 못했어요. 결과를 새로 확인해 주세요.'))
        }
      } catch {
        setMessage('다시 시도하지 못했어요. 연결을 확인한 뒤 결과를 새로 확인해 주세요.')
      } finally {
        setBusy(false)
        reload()
      }
    })
    if (!outcome.ran) setMessage(outcome.decision.message)
  }

  function onAction(item: ResultActionItem) {
    switch (item.action) {
      case 'REFRESH':
        reload()
        return
      case 'RETRY':
        void retry(item)
        return
      case 'NEXT_POST':
        router.push('/app/command')
        return
      default:
        return
    }
  }

  if (snapshot.kind === 'loading') {
    return (
      <MobileAppShell>
        <StateView kind="loading" skeleton="detail" />
      </MobileAppShell>
    )
  }

  if (snapshot.kind === 'error') {
    return (
      <MobileAppShell>
        <StateView
          kind="error"
          title="게시 결과를 확인하지 못했어요"
          description="잠시 뒤 다시 확인해 주세요. 확인 전에는 같은 내용을 다시 올리지 마세요."
          checkedAt={snapshot.checkedAt}
          action={<Button variant="outline" className="min-h-11" onClick={reload}>다시 확인</Button>}
        />
      </MobileAppShell>
    )
  }

  if (snapshot.kind === 'missing') {
    return (
      <MobileAppShell>
        <StateView
          kind="error"
          title="게시 결과를 찾지 못했어요"
          description="이 매장에서 확인할 수 있는 결과가 아니거나, 아직 만들어진 결과가 없어요."
          action={
            <Button variant="outline" className="min-h-11" onClick={() => router.push('/app/content')}>
              작업함으로 이동
            </Button>
          }
        />
      </MobileAppShell>
    )
  }

  if (snapshot.kind === 'empty') {
    return (
      <MobileAppShell>
        <StateView
          kind="confirmed_empty"
          title="아직 게시 결과가 없어요"
          description="게시를 요청하면 이 화면에서 채널별 결과와 근거를 확인할 수 있어요."
          checkedAt={snapshot.checkedAt}
          action={<Button variant="outline" className="min-h-11" onClick={reload}>다시 확인</Button>}
        />
      </MobileAppShell>
    )
  }

  return (
    <MobileAppShell>
      <div className="py-6">
        {message ? <p role="alert" className="mb-3 text-sm text-state-warn">{message}</p> : null}
        <ResultScreenView
          input={snapshot.input}
          checkedAt={snapshot.checkedAt}
          onAction={onAction}
          onRetryLoad={reload}
        />
      </div>
    </MobileAppShell>
  )
}

const EVIDENCE_CHANNELS: readonly OutcomeChannel[] = CHANNELS

async function readOutcome(missionId: string, workspaceId: string): Promise<Snapshot> {
  const checkedAt = new Date().toISOString()
  let response: Response
  try {
    response = await fetch(`/api/missions/first-post/${encodeURIComponent(missionId)}/outcome`, {
      cache: 'no-store',
      headers: { 'x-workspace-id': workspaceId },
    })
  } catch {
    return { kind: 'error', checkedAt }
  }

  const payload: unknown = await response.json().catch(() => null)
  if (response.status === 404) return { kind: 'missing' }
  if (!response.ok) return { kind: 'error', checkedAt }
  if (typeof payload !== 'object' || payload === null) return { kind: 'error', checkedAt }
  const body = payload as Record<string, unknown>
  if (body.success !== true) return { kind: 'error', checkedAt }

  // 저장된 실행 결과가 없으면 실패가 아니라 '아직 없음'이다.
  if (body.executionResult === null || body.executionResult === undefined) {
    return { kind: 'empty', checkedAt }
  }

  // 모양이 어긋난 결과는 '없음'으로 낮추지 않는다. 확인 실패로 남긴다.
  const parsed = parseExecutionResult(body.executionResult)
  if (!parsed) return { kind: 'error', checkedAt }

  return {
    kind: 'ready',
    checkedAt,
    input: {
      outcome: deriveFirstPostOutcome(parsed satisfies OutcomeInput),
      evidence: evidenceFrom(body.approvedChannels),
    },
  }
}

/** 승인 시점 대상 계정. 서버가 확인해 준 값만 쓴다(없으면 null — 대조 불가로 남긴다). */
function evidenceFrom(raw: unknown): Partial<Record<OutcomeChannel, ResultEvidence>> {
  if (typeof raw !== 'object' || raw === null) return {}
  const source = raw as Record<string, unknown>
  const evidence: Partial<Record<OutcomeChannel, ResultEvidence>> = {}
  for (const channel of EVIDENCE_CHANNELS) {
    const handle = source[channel]
    evidence[channel] = { approvedHandle: typeof handle === 'string' && handle.trim() !== '' ? handle.trim() : null }
  }
  return evidence
}

function errorMessage(payload: unknown, fallback: string): string {
  const error = typeof payload === 'object' && payload !== null ? (payload as { error?: unknown }).error : null
  return typeof error === 'string' && error.trim() !== '' ? error : fallback
}
