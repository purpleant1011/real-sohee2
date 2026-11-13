'use client'

import { useEffect, useRef, useState } from 'react'
import { AppLink } from '@/components/navigation/app-link'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog } from '@/components/ui/dialog'
import { useWorkspaceId } from '@/hooks/use-workspace-context'
import { useExternalWriteGuard } from '@/features/pwa/use-external-write-guard'
import { interactionDraftReviewSchema, type InteractionDraftCardData, type InteractionDraftReview } from '@/features/engagement/interaction-draft-contract'

type Phase = 'idle' | 'loading' | 'ready' | 'sending' | 'processed' | 'blocked' | 'unknown'
const reviewReasons = {
  SOURCE_CHANGED: '고객 원문이 바뀌었어요. 최신 문의에 맞춰 답안을 다시 준비해 주세요.',
  DRAFT_CHANGED: '다른 곳에서 답안이 바뀌었어요. 현재 소통함에서 최신 문안을 검토해 주세요.',
  TARGET_CLOSED: '이미 처리했거나 결과 확인이 필요한 문의예요. 소통함에서 현재 상태를 확인해 주세요.',
  DM_WINDOW_EXPIRED: 'DM 답장 가능 시간이 지났어요. 이 답안을 다시 발송하지 않습니다.',
} as const

export function ConversationInteractionDraftCard({ snapshot, threadId, readOnly = false }: Readonly<{
  snapshot: InteractionDraftCardData; threadId: string; readOnly?: boolean
}>) {
  const workspaceId = useWorkspaceId()
  const matchesScope = workspaceId === snapshot.workspaceId
  const runExternalWrite = useExternalWriteGuard()
  const [open, setOpen] = useState(false)
  const [review, setReview] = useState<InteractionDraftReview | null>(null)
  const [phase, setPhase] = useState<Phase>('idle')
  const [notice, setNotice] = useState('')
  const generation = useRef(0)
  const reader = useRef<AbortController | null>(null)
  const sending = useRef(false)
  const submissionOutcome = useRef<'processed' | 'unknown' | null>(null)
  useEffect(() => {
    generation.current += 1
    reader.current?.abort()
    setOpen(false); setReview(null); setNotice(''); setPhase('idle')
    return () => { generation.current += 1; reader.current?.abort() }
  }, [workspaceId, threadId, snapshot.id, readOnly])

  async function openReview() {
    if (!matchesScope || readOnly || sending.current) return
    reader.current?.abort()
    const controller = new AbortController()
    reader.current = controller
    const current = ++generation.current
    setOpen(true); setReview(null); setNotice(''); setPhase('loading')
    try {
      const response = await fetch(`/api/workspaces/${encodeURIComponent(snapshot.workspaceId)}/conversations/${encodeURIComponent(threadId)}/interaction-drafts/${encodeURIComponent(snapshot.id)}`, {
        method: 'GET', cache: 'no-store', signal: controller.signal,
      })
      if (!response.ok) throw new Error('REVIEW_UNAVAILABLE')
      const payload = await response.json() as { data?: unknown }
      const parsed = interactionDraftReviewSchema.parse(payload.data)
      const actual = parsed.snapshot
      if (actual.workspaceId !== snapshot.workspaceId || actual.targetKind !== snapshot.targetKind
        || actual.targetId !== snapshot.targetId || actual.draftId !== snapshot.draftId
        || actual.fingerprint !== snapshot.fingerprint || actual.sourceRef !== snapshot.sourceRef) throw new Error('REVIEW_SCOPE_MISMATCH')
      if (controller.signal.aborted || current !== generation.current) return
      setReview(parsed); setPhase(submissionOutcome.current ?? 'ready')
      if (submissionOutcome.current === 'unknown') setNotice('발송 결과를 확인하지 못했어요. 다시 보내지 말고 소통함에서 결과를 확인해 주세요.')
    } catch {
      if (controller.signal.aborted || current !== generation.current) return
      setNotice('최신 원문과 답안을 확인하지 못했어요. 현재 소통함에서 확인해 주세요.'); setPhase('blocked')
    }
  }

  async function confirmSend() {
    if (!matchesScope || readOnly || !review?.canSend || phase !== 'ready' || sending.current) return
    const current = generation.current
    let postStarted = false
    sending.current = true; setPhase('sending'); setNotice('')
    try {
      const outcome = await runExternalWrite('send', snapshot.targetKind === 'comment' ? `comment:${snapshot.targetId}` : snapshot.targetId, async () => {
        if (current !== generation.current) throw new Error('REVIEW_SCOPE_CHANGED')
        const path = snapshot.targetKind === 'comment' ? `comments/${snapshot.targetId}` : `dm/threads/${snapshot.targetId}`
        const body = snapshot.targetKind === 'comment'
          ? { expectedFingerprint: snapshot.fingerprint, expectedSourceFingerprint: snapshot.sourceRef }
          : { expectedFingerprint: snapshot.fingerprint, expectedSourceMessageId: snapshot.sourceRef }
        postStarted = true
        const response = await fetch(`/api/workspaces/${encodeURIComponent(snapshot.workspaceId)}/engagement/${path}/send`, {
          method: 'POST', cache: 'no-store', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
        })
        const result = await response.json() as { ok?: boolean; status?: string; reconciliationRequired?: boolean }
        return { ok: response.ok && result.ok === true && result.status === 'SENT', status: response.status,
          unknown: result.reconciliationRequired === true || result.status === 'NEEDS_CHECK'
            || response.status >= 500 || (response.ok && !(result.ok === true && result.status === 'SENT')) }
      })
      if (current !== generation.current) return
      if (!outcome.ran) { setNotice(outcome.decision.message); setPhase('blocked'); return }
      if (outcome.value.unknown) {
        submissionOutcome.current = 'unknown'
        setNotice('발송 결과를 확인하지 못했어요. 다시 보내지 말고 소통함에서 결과를 확인해 주세요.'); setPhase('unknown')
      } else if (outcome.value.ok) {
        submissionOutcome.current = 'processed'
        setNotice('발송 요청이 처리됐어요. 최종 결과는 소통함에서 확인할 수 있어요.'); setPhase('processed')
        window.dispatchEvent(new Event('sohee:work-status-refresh'))
      } else {
        setNotice(outcome.value.status === 409 ? '원문이나 답안이 바뀌었어요. 현재 소통함에서 다시 검토해 주세요.'
          : '발송 조건이나 권한을 확인하지 못해 완료 처리하지 않았어요. 현재 소통함에서 확인해 주세요.')
        setPhase('blocked')
      }
    } catch {
      if (current !== generation.current) return
      if (postStarted) submissionOutcome.current = 'unknown'
      setNotice(postStarted ? '발송 결과를 확인하지 못했어요. 다시 보내지 말고 소통함에서 결과를 확인해 주세요.'
        : '연결을 확인하지 못해 발송을 시작하지 않았어요. 현재 상태를 다시 확인해 주세요.')
      setPhase(postStarted ? 'unknown' : 'blocked')
    } finally { sending.current = false }
  }

  return <Card>
    <CardHeader>
      <CardTitle className="truncate">{matchesScope ? `${snapshot.targetKind === 'dm' ? 'Instagram DM' : '댓글'} · ${snapshot.customerLabel}` : '작업공간 변경됨'}</CardTitle>
      <CardDescription>저장 당시의 검토용 초안이에요. 실제 발송 전 최신 원문과 문안을 다시 확인합니다.</CardDescription>
    </CardHeader>
    <CardContent>
      <Badge variant="secondary">{phase === 'processed' ? '발송 요청 처리됨' : '저장된 답안'}</Badge>
      <p className="mt-3 whitespace-pre-wrap break-words">{matchesScope ? snapshot.draftText : '현재 가게의 대화에서 답안을 다시 확인해 주세요.'}</p>
    </CardContent>
    <CardFooter className="flex flex-col sm:flex-row flex-wrap gap-2">
      <Button type="button" variant="outline" className="w-full sm:w-auto" disabled={!matchesScope || readOnly || phase === 'sending'} onClick={() => { void openReview() }}>최신 원문과 답안 확인</Button>
      {matchesScope ? <Button variant="ghost" className="w-full sm:w-auto" asChild><AppLink href={snapshot.targetKind === 'dm' ? '/app/engagement?tab=dm' : '/app/engagement'}>소통함에서 수정</AppLink></Button> : null}
    </CardFooter>
    <Dialog open={open && matchesScope} onOpenChange={value => { if (!sending.current) setOpen(value) }} title="최신 문의와 발송할 답안 확인">
      <div className="flex max-h-[65dvh] flex-col gap-4 overflow-y-auto">
        <p className="truncate">{snapshot.targetKind === 'dm' ? 'Instagram DM' : snapshot.channel === 'threads' ? 'Threads 댓글' : 'Instagram 댓글'} · {snapshot.customerLabel}</p>
        {phase === 'loading' ? <p role="status">최신 원문과 답안을 확인하고 있어요.</p> : null}
        {review ? <>
          <div><strong>현재 고객 원문</strong><p className="mt-2 whitespace-pre-wrap break-words">{review.sourceText ?? '확인할 수 없는 원문입니다.'}</p></div>
          <div><strong>검토한 발송 문안</strong><p className="mt-2 whitespace-pre-wrap break-words">{snapshot.draftText}</p></div>
          {review.currentDraftText !== snapshot.draftText ? <div><strong>소통함의 최신 문안</strong><p className="mt-2 whitespace-pre-wrap break-words">{review.currentDraftText ?? '현재 저장된 답안이 없습니다.'}</p></div> : null}
          {review.reason ? <Alert><AlertDescription>{reviewReasons[review.reason]}</AlertDescription></Alert> : null}
          <p>실제로 고객에게 전송되는 작업이에요. 보낸 뒤에는 소희에서 되돌릴 수 없어요.</p>
        </> : null}
        {notice ? <Alert><AlertDescription><span role="status">{notice}</span></AlertDescription></Alert> : null}
        <div className="flex flex-col sm:flex-row flex-wrap justify-end gap-2">
          <Button type="button" variant="outline" className="w-full sm:w-auto" disabled={phase === 'sending'} onClick={() => setOpen(false)}>닫기</Button>
          <Button type="button" className="w-full sm:w-auto" disabled={!review?.canSend || phase !== 'ready' || readOnly || !matchesScope} onClick={() => { void confirmSend() }}>이 문안으로 발송</Button>
        </div>
      </div>
    </Dialog>
  </Card>
}
