'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { MediaUploadCard } from '@/features/media/media-upload-card'
import { StoredFirstPostFlow as FirstPostFlow } from './stored-first-post-flow'
import { safeFirstPostReturnPath } from './first-post-return-path'
import { loadStoredFirstPostDraft, type StoredDraftLoadResult } from './stored-draft-loader'
import type { DraftDto } from './draft-mapper'

/**
 * 복원 조회가 이 시간 안에 끝나지 않으면 '확인 불가'로 닫는다.
 * W7 로더에는 AbortSignal 인자가 없어 요청 자체는 취소할 수 없다 — 결과만 버린다(정직 표기).
 */
const RESTORE_TIMEOUT_MS = 8000

/** 복원 결과는 어느 scope(매장+미션)에 대한 것인지 함께 보관한다. */
type ScopedDraft = { scopeKey: string; draft: DraftDto; missionStatus?: string | null; restored?: boolean }
type RestorePhase = 'done' | 'unavailable' | 'offline' | 'error' | 'session_expired' | 'forbidden'
type RestoreOutcome = { scopeKey: string; phase: RestorePhase }

/** 로더 결과 → 화면이 알릴 상태. `cancelled` 는 화면을 바꾸지 않는다(중단은 실패가 아니다). */
function phaseOf(result: StoredDraftLoadResult): RestorePhase | null {
  switch (result.kind) {
    case 'ready':
      return 'done'
    case 'session_expired':
      return 'session_expired'
    case 'forbidden':
      return 'forbidden'
    case 'offline':
      return 'offline'
    case 'error':
      return 'error'
    case 'cancelled':
      return null
    default:
      // missing / invalid_id / invalid / conflict — '초안 없음'으로 중립 처리한다.
      return 'unavailable'
  }
}

/**
 * 첫 포스팅 R2 진입 (플래그 뒤 `/start/preview-r2`).
 * - 사용자가 버튼을 눌렀을 때만 초안을 만든다(자동 생성·자동 게시 없음).
 * - `initialDraft` 는 서버에 저장된 초안 복원용이다(있으면 원형 그대로 FirstPostFlow 로 직행).
 * - `restoreMissionId` 는 새로고침·깊은 링크 복원용 식별자다. 조회는 읽기 전용이며 실패해도
 *   초안을 지어내지 않는다.
 * - 발화 입력 앞에 `MediaUploadCard` 를 마운트하여 폰 사진 업로드·권리 확인 경로를 제공한다.
 * - `workspaceId` 가 없으면 가짜 값을 넣지 않고 명시적 확인 불가 안내를 표시하며 생성 CTA 를 차단한다.
 * - `propose` POST 요청 시 일관된 scope 를 보장하기 위해 `x-workspace-id` 헤더를 전달한다.
 */
export function FirstPostEntry(props: Parameters<typeof FirstPostEntrySession>[0]) {
  return <FirstPostEntrySession key={`${props.workspaceId ?? ''}:${props.restoreMissionId ?? ''}`} {...props} />
}

function FirstPostEntrySession({
  fetchImpl,
  initialDraft,
  workspaceId,
  restoreMissionId,
  restoreTimeoutMs = RESTORE_TIMEOUT_MS,
}: Readonly<{
  fetchImpl?: typeof fetch
  initialDraft?: DraftDto | null
  workspaceId?: string
  /** 새로고침·깊은 링크 복원용. 저장된 초안을 읽기 전용으로 다시 조회한다(W7 로더 재사용). */
  restoreMissionId?: string
  /** 복원 상한 시간(테스트에서 짧게 주입). 기본 8초. */
  restoreTimeoutMs?: number
}>) {
  /** 매장·미션이 바뀌면 이 값이 바뀐다. 다른 scope 의 초안은 절대 그리지 않는다. */
  const scopeKey = `${workspaceId ?? ''}\u0000${restoreMissionId ?? ''}`

  const [utterance, setUtterance] = useState('')
  // 초안은 '어느 scope 에서 받은 값인지'와 함께 보관한다. scope 가 바뀌면 즉시 숨는다.
  const [scoped, setScoped] = useState<ScopedDraft | null>(
    initialDraft ? { scopeKey, draft: initialDraft } : null,
  )
  const [restoreOutcome, setRestoreOutcome] = useState<RestoreOutcome | null>(null)
  const [state, setState] = useState<'IDLE' | 'LOADING' | 'FAILED'>('IDLE')
  const [message, setMessage] = useState<string | null>(null)
  /**
   * 복원 세대. 새 초안을 직접 만들면 세대를 올려, 그 전에 시작된 복원 결과가
   * 새 draft 를 덮어쓰지 못하게 한다(timeout → 새로 만들기 → 늦은 옛 결과 반례).
   */
  const restoreGeneration = useRef(0)
  const creating = useRef<AbortController | null>(null)
  useEffect(() => () => creating.current?.abort(), [])

  const restoring = Boolean(restoreMissionId) && !initialDraft
  // 다른 scope 의 복원 결과는 '확인 중'으로 본다(이전 값 재사용 금지).
  const restorePhase: 'idle' | 'checking' | RestorePhase = !restoring
    ? 'idle'
    : restoreOutcome?.scopeKey === scopeKey
      ? restoreOutcome.phase
      : 'checking'

  // 1-1. 저장된 초안 복원. 결과가 늦게 와도 scope 가 다르면 버린다(out-of-order 무시).
  useEffect(() => {
    if (!restoring || !restoreMissionId) return
    let cancelled = false
    const generation = restoreGeneration.current
    // 이제 로더가 signal 을 받으므로, scope/구현이 바뀌면 실제 요청도 중단된다.
    const controller = new AbortController()
    const timer = setTimeout(() => {
      if (!cancelled) { controller.abort(); setRestoreOutcome({ scopeKey, phase: 'error' }) }
    }, restoreTimeoutMs)
    void loadStoredFirstPostDraft({ missionId: restoreMissionId, workspaceId, fetchImpl, signal: controller.signal }).then((result) => {
      // 취소됐거나, 그 사이 사용자가 새 초안을 만들었으면(세대 변경) 늦은 결과는 버린다.
      if (cancelled || controller.signal.aborted || generation !== restoreGeneration.current) return
      clearTimeout(timer)
      if (result.kind === 'ready') setScoped({ scopeKey, draft: result.draft, missionStatus: result.missionStatus, restored: true })
      const phase = phaseOf(result)
      if (phase) setRestoreOutcome({ scopeKey, phase })
    })
    return () => {
      cancelled = true
      clearTimeout(timer)
      controller.abort()
    }
  }, [restoring, scopeKey, restoreMissionId, workspaceId, fetchImpl, restoreTimeoutMs])

  // 1-2. 이 scope 에서 받은 초안만 그린다. 다른 scope 값은 첫 페인트부터 숨는다.
  const draft = scoped && scoped.scopeKey === scopeKey ? scoped.draft : null
  if (draft) {
    if (scoped?.restored && restoreMissionId && !['DRAFT', 'AWAITING_APPROVAL'].includes(scoped?.missionStatus ?? '')) {
      return <div className="space-y-3 p-4"><p>저장된 미션 상태를 확인한 뒤 결과에서 이어갈 수 있어요. 자동으로 다시 게시하지 않아요.</p><Link className="inline-flex min-h-11 items-center underline" href={`/app/outcome/${encodeURIComponent(restoreMissionId)}`}>게시 결과 상세 열기</Link></div>
    }
    return <FirstPostFlow draft={draft} workspaceId={workspaceId} fetchImpl={fetchImpl} />
  }

  const validWorkspace = typeof workspaceId === 'string' && workspaceId.trim().length > 0
  const normalizedWorkspaceId = validWorkspace ? workspaceId.trim() : ''
  /**
   * 확인 중에는 새로 만들지 않는다(같은 미션 중복 생성 방지). 시간이 지나면 확인 불가로 열린다.
   * 인증 만료·권한 없음은 어차피 생성 요청도 실패하므로 fail-closed 로 계속 막는다.
   */
  const restoreBlocking =
    restorePhase === 'checking' ||
    restorePhase === 'session_expired' ||
    restorePhase === 'forbidden' ||
    restorePhase === 'offline'

  const create = async () => {
    if (!validWorkspace || restoreBlocking || creating.current) return
    const controller = new AbortController()
    creating.current = controller
    // 생성을 시작하는 순간 복원은 더 이상 화면을 결정하지 않는다.
    // (pending 중 늦게 도착한 옛 결과가 화면을 되돌리는 반례 차단)
    restoreGeneration.current += 1
    setRestoreOutcome({ scopeKey, phase: 'done' })
    setState('LOADING')
    setMessage(null)
    try {
      const response = await (fetchImpl ?? fetch)('/api/missions/first-post/propose', {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'content-type': 'application/json',
          'x-workspace-id': normalizedWorkspaceId,
        },
        body: JSON.stringify({ utterance }),
      })
      const body: { draft?: DraftDto; error?: unknown } = await response.json().catch(() => ({}))
      if (controller.signal.aborted) return
      if (!response.ok || !body.draft) {
        setState('FAILED')
        setMessage(typeof body.error === 'string' ? body.error : '초안을 만들지 못했어요. 게시된 것은 없어요.')
        return
      }
      // 새 초안을 직접 만들었으니, 남아 있는 복원 결과가 덮어쓰지 못하게 세대를 올린다.
      restoreGeneration.current += 1
      setScoped({ scopeKey, draft: body.draft })
      if (['/app/work/new', '/start/preview-r2'].includes(window.location.pathname) && typeof body.draft.missionId === 'string' && /^[0-9a-f-]{36}$/i.test(body.draft.missionId)) {
        window.history.replaceState(window.history.state, '', `${window.location.pathname}?post=${encodeURIComponent(body.draft.missionId)}&step=preview`)
      }
    } catch {
      setState('FAILED')
      if (!controller.signal.aborted) setMessage('연결을 확인하지 못했어요. 게시된 것은 없어요.')
    } finally {
      creating.current = null
    }
  }

  return (
    <main className="mx-auto max-w-md space-y-4 px-4 py-6">
      <h1 className="text-2xl font-semibold tracking-tight">이번에 무엇을 알릴까요?</h1>

      {/* 2. 복원 상태를 숨기지 않고 그대로 알린다. */}
      {restorePhase === 'checking' ? (
        <p role="status" className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          저장된 초안을 확인하는 중이에요.
        </p>
      ) : null}
      {restorePhase === 'unavailable' ? (
        <p role="status" className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          저장된 초안을 찾지 못했어요. 새로 입력해서 시작할 수 있어요.
        </p>
      ) : null}
      {restorePhase === 'error' ? (
        <p role="alert" className="rounded-lg border border-state-warn/30 bg-state-warn/10 px-3 py-2 text-sm text-state-warn">
          초안을 확인하지 못했어요. 잠시 후 다시 열어 주세요.
        </p>
      ) : null}
      {restorePhase === 'offline' ? (
        <p role="alert" className="rounded-lg border border-state-warn/30 bg-state-warn/10 px-3 py-2 text-sm text-state-warn">
          네트워크에 연결되지 않았어요. 연결을 확인한 뒤 다시 열어 주세요.
        </p>
      ) : null}
      {restorePhase === 'session_expired' ? (
        <div role="alert" className="space-y-2 rounded-lg border border-state-warn/30 bg-state-warn/10 px-3 py-2 text-sm text-state-warn">
          <p>로그인이 만료됐어요. 다시 로그인한 뒤 이어서 진행해 주세요.</p>
          {/* 복귀 주소는 same-origin allowlist 로 정규화된 경로만 쓴다(open redirect 차단). */}
          <Link
            className="inline-flex min-h-11 items-center font-medium underline underline-offset-4"
            href={`/login?next=${encodeURIComponent(safeFirstPostReturnPath({ missionId: restoreMissionId ?? '', step: 'preview' }))}`}
          >
            다시 로그인하기
          </Link>
        </div>
      ) : null}
      {restorePhase === 'forbidden' ? (
        <p role="alert" className="rounded-lg border border-state-warn/30 bg-state-warn/10 px-3 py-2 text-sm text-state-warn">
          이 내용을 볼 권한이 없어요. 매장 관리자에게 확인해 주세요.
        </p>
      ) : null}

      {/* 3. 가게 사진 업로드/권리 확인 영역 (올바른 workspaceId 가 있을 때만 마운트) */}
      {validWorkspace ? (
        <MediaUploadCard workspaceId={normalizedWorkspaceId} requirePhoto />
      ) : (
        <div role="alert" className="rounded-lg border border-state-warn/30 bg-state-warn/10 p-4 text-sm text-state-warn">
          매장 정보를 확인하지 못했어요. 올바른 매장으로 다시 로그인해 주세요.
        </div>
      )}

      {/* 4. 알릴 내용 발화 입력 */}
      <div className="space-y-1.5">
        <Label htmlFor="fp-utterance">알릴 내용</Label>
        <Textarea
          id="fp-utterance"
          className="min-h-28 text-base"
          placeholder="예: 이번 주말 신메뉴 출시 이벤트 / 오픈 기념 10% 할인"
          value={utterance}
          disabled={!validWorkspace || state === 'LOADING' || restoreBlocking}
          onChange={(e) => setUtterance(e.target.value)}
        />
      </div>

      {message ? <p role="alert" className="text-sm text-state-warn">{message}</p> : null}

      {/* 5. 소희에게 맡기기 생성 CTA (workspaceId 없거나 복원 확인 중이면 차단) */}
      <Button
        className="min-h-11 w-full"
        disabled={!validWorkspace || !utterance.trim() || state === 'LOADING' || restoreBlocking}
        onClick={create}
      >
        {state === 'LOADING' ? '만드는 중' : '소희에게 맡기기'}
      </Button>
    </main>
  )
}
