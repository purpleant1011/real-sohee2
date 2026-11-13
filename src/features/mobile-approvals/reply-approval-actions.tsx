'use client'

import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { useExternalWriteGuard } from '@/features/pwa/use-external-write-guard'
import { ReplyDraftEditor } from '@/features/mobile-inbox/reply-draft-editor'
import { isConversationDetail } from '@/features/mobile-inbox/conversation-detail-contract'
import type { ConversationDetailDto } from '@/features/mobile-inbox/detail-model'

/** 조회 전용 목록의 임시 NO_SEND_SCOPE 대신 최종 명령 API가 실제 권한을 재검사한다. */
export function ReplyApprovalActions(props: { workspaceId: string; item: string }) {
  return <ReplyApprovalSession key={`${props.workspaceId}:${props.item}`} {...props} />
}

function ReplyApprovalSession({ workspaceId, item }: { workspaceId: string; item: string }) {
  const [detail, setDetail] = useState<ConversationDetailDto | null>(null)
  const [reload, setReload] = useState(0)
  const [dirty, setDirty] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [finished, setFinished] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [instruction, setInstruction] = useState('')
  const [rewrite, setRewrite] = useState<{ text: string; revision: number } | null>(null)
  const rewriteController = useRef<AbortController | null>(null)
  useEffect(() => () => rewriteController.current?.abort(), [])
  const pending = useRef(false)
  const runWrite = useExternalWriteGuard()
  const url = `/api/workspaces/${encodeURIComponent(workspaceId)}/mobile-inbox/${encodeURIComponent(item)}`

  useEffect(() => {
    const controller = new AbortController()
    void fetch(url, { cache: 'no-store', signal: controller.signal }).then(async response => {
      const value: unknown = await response.json()
      if (!response.ok || !isConversationDetail(value, workspaceId, item)) throw new Error('최신 답안을 불러오지 못했어요.')
      if (!controller.signal.aborted) setDetail(value)
    }).catch(() => { if (!controller.signal.aborted) setError('최신 답안을 불러오지 못했어요. 새로 확인해 주세요.') })
    return () => controller.abort()
  }, [url, workspaceId, item, reload])

  const source = detail?.messages.filter(message => message.fromCustomer).at(-1)?.id
  const canSend = Boolean(detail?.fingerprint && detail.thread.draft?.text.trim() && detail.targetLabel && source && detail.complete && detail.delivery === 'none' && !dirty && !finished)

  async function rewriteDraft() {
    if (!detail || !detail.fingerprint || !instruction.trim() || dirty || pending.current || finished || detail.delivery !== 'none' || !detail.complete) return
    pending.current = true; setBusy(true); setConfirming(false); setError(null); setNotice(null)
    const controller = new AbortController(); rewriteController.current = controller
    const timer = setTimeout(() => controller.abort(), 30000)
    try {
      const response = await fetch(`${url}/rewrite`, { method: 'POST', cache: 'no-store', signal: controller.signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ instruction, expectedFingerprint: detail.fingerprint }) })
      const result: unknown = await response.json()
      if (controller.signal.aborted) return
      if (!response.ok || !result || typeof result !== 'object' || !('draftText' in result) || typeof result.draftText !== 'string' || !result.draftText.trim() || !('basedOnFingerprint' in result) || result.basedOnFingerprint !== detail.fingerprint) throw new Error('Rewrite unavailable')
      setRewrite(previous => ({ text: result.draftText as string, revision: (previous?.revision ?? 0) + 1 })); setDirty(true)
      setNotice('수정안을 만들었어요. 내용을 확인하고 저장해 주세요. 아직 전송하지 않았어요.')
    } catch { setError('답안을 다시 쓰지 못했어요. 저장하거나 전송하지 않았어요.') }
    finally { clearTimeout(timer); rewriteController.current = null; pending.current = false; setBusy(false) }
  }

  async function send() {
    if (!canSend || !detail || pending.current) return
    pending.current = true; setBusy(true); setError(null)
    try {
      const outcome = await runWrite('send', item, async () => {
        // 최종 확인 중 다른 탭에서 원문/문안이 바뀌면 발송하지 않는다.
        const read = await fetch(url, { cache: 'no-store' })
        const current: unknown = await read.json()
        if (!read.ok || !isConversationDetail(current, workspaceId, item) || !current.complete || current.fingerprint !== detail.fingerprint || current.targetLabel !== detail.targetLabel || current.delivery !== 'none' || current.messages.filter(message => message.fromCustomer).at(-1)?.id !== source) {
          setConfirming(false); setError('고객 대화나 답안이 바뀌었어요. 최신 내용을 다시 확인해 주세요.'); return
        }
        const [kind, id] = item.split(':')
        const endpoint = kind === 'dm' ? `dm/threads/${encodeURIComponent(id)}` : `comments/${encodeURIComponent(id)}`
        // POST가 나간 뒤에는 결과와 관계없이 자동·연속 재발송을 허용하지 않는다.
        setFinished(true); setConfirming(false)
        try {
          const response = await fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/engagement/${endpoint}/send`, {
            method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ expectedFingerprint: detail.fingerprint, expectedSourceMessageId: source }),
          })
          const result = await response.json()
          if (response.ok && result.ok === true) setNotice(result.deliveryVerified === true ? '전달 확인됨' : '전송 접수됨 · 도착 확인 전')
          else setError(typeof result.error === 'string' ? result.error : '전송 결과 확인이 필요해요. 다시 보내지 말고 소희에게 확인을 요청해 주세요.')
        } catch { setError('전송 여부를 확인하지 못했어요. 중복 전송을 막기 위해 다시 보내지 않을게요. 소희에게 결과 확인을 요청해 주세요.') }
      })
      if (!outcome.ran) setError(outcome.decision.message)
    } catch { setError('최신 내용을 확인하지 못해 전송을 시작하지 않았어요.') }
    finally { pending.current = false; setBusy(false) }
  }

  return <section aria-label="답안 수정과 전송" className="space-y-4 rounded-2xl border border-border bg-card p-4">
    {detail && !finished ? <>
      <ReplyDraftEditor key={`${item}:${detail.version}:${rewrite?.revision ?? 0}`} workspaceId={workspaceId} detail={detail} initialText={rewrite?.text} disabled={busy} onDirty={value => { setDirty(value); setConfirming(false) }} onSaved={() => { setDetail(null); setConfirming(false); setError(null); setDirty(false); setRewrite(null); setNotice(null); setReload(value => value + 1) }} />
      <Label htmlFor="reply-rewrite-instruction">소희에게 수정 요청</Label>
      <Textarea id="reply-rewrite-instruction" value={instruction} disabled={busy} onChange={event => setInstruction(event.target.value)} placeholder="예: 방문 시간이 오후라는 점을 반영해 더 친절하게 써 줘" />
      <Button variant="outline" className="min-h-11 w-full" disabled={!instruction.trim() || busy || dirty || !detail.complete || !detail.fingerprint || detail.delivery !== 'none'} onClick={() => void rewriteDraft()}>{busy ? '소희가 확인 중' : '대화로 다시 쓰기'}</Button>
      <div className="sticky bottom-0 z-10 -mx-4 -mb-4 rounded-b-2xl border-t border-border bg-card/95 p-4 backdrop-blur pb-[max(1rem,env(safe-area-inset-bottom))] shadow-lg">
        {confirming ? <div className="space-y-3 rounded-xl bg-muted p-4" aria-label="최종 전송 확인">
          <p className="font-medium">{detail.targetLabel}에게 이 내용으로 보낼까요?</p>
          <p className="whitespace-pre-wrap break-words">{detail.thread.draft?.text}</p>
          <p className="text-sm text-muted-foreground">소희가 권한과 최신 내용을 다시 확인해요. 승인하면 실제로 전송되며 되돌릴 수 없어요.</p>
          <Button className="min-h-12 w-full" disabled={busy || !canSend} onClick={() => void send()}>승인하고 전송</Button>
          <Button variant="ghost" disabled={busy} onClick={() => setConfirming(false)}>계속 수정하기</Button>
        </div> : <Button className="min-h-12 w-full" disabled={!canSend || busy} onClick={() => setConfirming(true)}>이 답안 보내기</Button>}
      </div>
      {dirty ? <p role="status" className="text-sm text-muted-foreground">수정한 답안을 저장한 뒤 최종 확인할 수 있어요.</p> : null}
      {detail.delivery !== 'none' ? <p role="status">이미 처리 중이거나 전송된 답안이에요. 중복으로 보내지 않아요.</p> : null}
    </> : !error && !notice ? <p role="status">최신 답안을 확인하고 있어요.</p> : null}
    {notice ? <p role="status">{notice}</p> : null}
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
  </section>
}
