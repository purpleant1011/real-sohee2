'use client'

import { useRef, useState } from 'react'
import { Button } from '@/components/ui/button'

type Kind = 'WORKSPACE' | 'CHANNEL' | 'GLOBAL' | 'CREDIT'
const names: Record<Kind, string> = { WORKSPACE: '매장 일시정지', CHANNEL: '채널 차단', GLOBAL: '전체 긴급정지', CREDIT: '크레딧 지급' }
export function InterventionForm() {
  const [kind, setKind] = useState<Kind>('WORKSPACE')
  const [workspaceId, setWorkspaceId] = useState('')
  const [channel, setChannel] = useState('instagram')
  const [amount, setAmount] = useState(1)
  const [active, setActive] = useState(true)
  const [reason, setReason] = useState('')
  const [preview, setPreview] = useState<{ affectedCount: number; detail: string; active: boolean } | null>(null)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const requestKey = useRef<string | null>(null)
  const target = { kind, workspaceId, ...(kind === 'CHANNEL' ? { channel } : {}), ...(kind === 'CREDIT' ? { amount } : {}) }
  const reset = () => { requestKey.current = null; setPreview(null); setMessage('') }
  async function send(execute: boolean) {
    setBusy(true); setMessage('')
    if (execute) requestKey.current ??= crypto.randomUUID()
    try {
      const response = await fetch('/api/admin/interventions', { method: execute ? 'POST' : 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(execute ? { ...target, ...(kind === 'CREDIT' ? {} : { active }), reason, confirmed: true, idempotencyKey: requestKey.current } : target) })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error ?? '상태를 확인하지 못했어요')
      if (execute) { requestKey.current = null; setPreview(null); setMessage(payload.data.is_replay ? '이미 처리한 요청이에요' : '실행하고 감사 기록을 남겼어요'); setReason('') }
      else setPreview(payload.data)
    } catch (error) { if (!execute) setPreview(null); setMessage(error instanceof Error ? error.message : '다시 시도해 주세요') }
    finally { setBusy(false) }
  }
  return <section aria-label="안전 개입 실행" className="space-y-4 rounded-xl border border-border bg-card p-4 sm:p-6">
    <label className="block text-sm font-medium">개입 유형<select className="mt-1 w-full rounded-md border border-border bg-background p-2" value={kind} onChange={e => { setKind(e.target.value as Kind); reset() }}>{(Object.keys(names) as Kind[]).map(k => <option value={k} key={k}>{names[k]}</option>)}</select></label>
    <label className="block text-sm font-medium">매장 식별 번호<input className="mt-1 w-full rounded-md border border-border bg-background p-2" type="text" value={workspaceId} onChange={e => { setWorkspaceId(e.target.value); reset() }} required /></label>
    {kind === 'CHANNEL' && <label className="block text-sm font-medium">채널<select className="mt-1 w-full rounded-md border border-border bg-background p-2" value={channel} onChange={e => { setChannel(e.target.value); reset() }}><option value="instagram">인스타그램</option><option value="threads">스레드</option><option value="naver_blog">네이버 블로그</option><option value="daangn_business">당근 비즈니스</option></select></label>}
    {kind === 'CREDIT' ? <label className="block text-sm font-medium">지급할 크레딧<input className="mt-1 w-full rounded-md border border-border bg-background p-2" type="number" min="1" max="50000" value={amount} onChange={e => { setAmount(Number(e.target.value)); reset() }} /></label> : <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!active} onChange={e => { setActive(!e.target.checked); reset() }} />차단 해제 (원래 작업을 다시 시작할 수 있어요)</label>}
    <Button type="button" variant="outline" disabled={busy || !workspaceId} onClick={() => send(false)}>영향 미리보기</Button>
    {preview && <div role="status" className="space-y-3 rounded-lg border border-amber-700 bg-amber-50 p-4 text-amber-950 dark:bg-amber-950 dark:text-amber-100"><p className="font-semibold">영향받는 보관 글 {preview.affectedCount}건</p><p>{preview.detail}</p><p>현재 상태: {preview.active ? '차단 중' : '차단하지 않음'}</p><label className="block text-sm font-medium">실행 사유 (필수)<textarea className="mt-1 w-full rounded-md border border-border bg-background p-2 text-foreground" value={reason} onChange={e => setReason(e.target.value)} maxLength={2000} required /></label><Button type="button" disabled={busy || !reason.trim()} onClick={() => send(true)}>{kind === 'CREDIT' ? '지급 확인 후 실행' : active ? '차단 확인 후 실행' : '해제 확인 후 실행'}</Button></div>}
    {message && <p role="status" className="text-sm text-foreground">{message}</p>}
  </section>
}
