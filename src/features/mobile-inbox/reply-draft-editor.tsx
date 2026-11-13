'use client'

import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import type { ConversationDetailDto } from './detail-model'
import { isConversationDetail } from './conversation-detail-contract'

/** 저장은 전송이 아니다. 정확 원문·서버 지문·필수 GET readback이 일치하기 전에는 검토를 열지 않는다. */
export function ReplyDraftEditor({ workspaceId, detail, onDirty, onSaved, initialText, disabled = false }: { workspaceId: string; detail: ConversationDetailDto; onDirty: (dirty: boolean) => void; onSaved: () => void; initialText?: string; disabled?: boolean }) {
  const [text, setText] = useState(initialText ?? detail.thread.draft?.text ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [uncertain, setUncertain] = useState(false)
  const pending = useRef<AbortController | null>(null)
  useEffect(() => () => pending.current?.abort(), [])
  const key = detail.thread.id
  async function save() {
    if (pending.current || uncertain || !text.trim()) return
    const controller = new AbortController(); pending.current = controller; setSaving(true); setError(null)
    const timer = setTimeout(() => controller.abort(), 8000)
    const url = `/api/workspaces/${encodeURIComponent(workspaceId)}/mobile-inbox/${encodeURIComponent(key)}`
    try {
      const response = await fetch(`${url}/draft`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, cache: 'no-store', signal: controller.signal, body: JSON.stringify({ draftText: text, expectedFingerprint: detail.fingerprint, expectedUpdatedAt: detail.draftUpdatedAt ?? null }) })
      if (!response.ok) { if (response.status === 409) throw new Error('다른 곳에서 답안이 바뀌었어요. 최신 저장본을 다시 열어 주세요.'); throw new Error('답안 저장을 확인하지 못했어요. 다시 전송하지 말고 최신 내용을 확인해 주세요.') }
      const saved: unknown = await response.json()
      const read = await fetch(url, { cache: 'no-store', signal: controller.signal })
      const canonical: unknown = await read.json()
      if (!read.ok || !isConversationDetail(canonical, workspaceId, key) || canonical.thread.draft?.text !== text || typeof canonical.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(canonical.fingerprint) || !saved || typeof saved !== 'object' || (saved as { saved?: unknown }).saved !== true || canonical.fingerprint !== (saved as { fingerprint?: unknown }).fingerprint || controller.signal.aborted) throw new Error('서버 저장본이 입력한 답안과 일치하지 않아요.')
      onDirty(false); onSaved()
    } catch (reason) { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '답안 저장 상태 확인 필요'); else setError('연결을 확인하지 못했어요. 저장본을 다시 열어 확인해 주세요.'); setUncertain(true) }
    finally { clearTimeout(timer); pending.current = null; setSaving(false) }
  }
  if (detail.delivery !== 'none') return null
  return <section className="space-y-3 rounded-xl border border-border bg-card p-4" aria-label="답안 편집">
    <Label htmlFor="mobile-reply-text">답안 내용</Label>
    <Textarea id="mobile-reply-text" className="min-h-32 text-base" disabled={disabled || saving || uncertain} value={text} onChange={event => { setText(event.target.value); onDirty(true) }} />
    <Button className="min-h-11 w-full" disabled={disabled || saving || uncertain || !text.trim() || text === detail.thread.draft?.text} onClick={() => void save()}>{saving ? '저장 확인 중' : '답안 저장'}</Button>
    <p className="text-xs text-muted-foreground">저장만 하며 고객에게 전송하거나 예약을 확정하지 않아요.</p>
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    {uncertain ? <Button variant="outline" className="min-h-11 w-full" onClick={onSaved}>내 수정 대신 최신 저장본 다시 열기</Button> : null}
  </section>
}
