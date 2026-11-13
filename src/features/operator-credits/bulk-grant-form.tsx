'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { PreviewResult, GrantResult } from './bulk-grant-schemas'

type Audience = 'all_active' | 'recent_signups'
const endpoint = '/api/admin/credits/bulk-grant'

export function BulkGrantForm() {
  const router = useRouter()
  const [audience, setAudience] = useState<Audience>('all_active')
  const [days, setDays] = useState(7)
  const [amount, setAmount] = useState(100)
  const [reason, setReason] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [preview, setPreview] = useState<PreviewResult | null>(null)
  const [result, setResult] = useState<GrantResult | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  // Keep a request key through retries. Changing inputs invalidates the key.
  const [key, setKey] = useState(() => crypto.randomUUID())
  function invalidate() { setPreview(null); setResult(null); setConfirmation(''); setError(''); setKey(crypto.randomUUID()) }
  async function send(path: string, payload: object) {
    const response = await fetch(`${endpoint}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
    const body = await response.json()
    if (!response.ok) throw new Error(typeof body.error === 'string' ? body.error : '요청을 완료하지 못했어요.')
    return body
  }
  const selection = { audience, ...(audience === 'recent_signups' ? { recentDays: days } : {}) }
  const valid = Number.isInteger(amount) && amount >= 1 && amount <= 50000 && reason.trim().length > 0 && (audience === 'all_active' || (Number.isInteger(days) && days >= 1 && days <= 30))
  return (
    <form className="space-y-5 rounded-xl border bg-card p-4 sm:p-6" onSubmit={async (event) => {
      event.preventDefault()
      if (!preview || confirmation !== '지급' || busy || !valid || preview.target_count === 0) return
      setBusy(true); setError('')
      try {
        setResult(await send('', { ...selection, amount, reason: reason.trim(), idempotencyKey: key }))
        router.refresh()
      } catch (cause) { setError(cause instanceof Error ? cause.message : '지급을 완료하지 못했어요.') }
      finally { setBusy(false) }
    }}>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block space-y-2 text-sm font-medium">대상
          <select className="min-h-11 w-full rounded-lg border bg-background px-3" value={audience} onChange={(e) => { setAudience(e.target.value as Audience); invalidate() }}>
            <option value="all_active">전체 고객사</option><option value="recent_signups">최근 신규 가입 고객사</option>
          </select>
        </label>
        {audience === 'recent_signups' ? <label className="block space-y-2 text-sm font-medium">최근 가입 기간(일)
          <input className="min-h-11 w-full rounded-lg border bg-background px-3" type="number" required min={1} max={30} value={days} onChange={(e) => { setDays(e.target.valueAsNumber); invalidate() }} />
        </label> : null}
        <label className="block space-y-2 text-sm font-medium">1인당 크레딧
          <input className="min-h-11 w-full rounded-lg border bg-background px-3" type="number" required min={1} max={50000} value={amount} onChange={(e) => { setAmount(e.target.valueAsNumber); invalidate() }} />
        </label>
        <label className="block space-y-2 text-sm font-medium">지급 사유
          <input className="min-h-11 w-full rounded-lg border bg-background px-3" type="text" required maxLength={2000} value={reason} onChange={(e) => { setReason(e.target.value); invalidate() }} />
        </label>
      </div>
      <button type="button" disabled={busy || !valid} className="min-h-11 rounded-lg border px-5 font-semibold disabled:opacity-50" onClick={async () => {
        setBusy(true); setError(''); setPreview(null); setResult(null)
        try { setPreview(await send('/preview', selection)) } catch (cause) { setError(cause instanceof Error ? cause.message : '대상을 확인하지 못했어요.') }
        finally { setBusy(false) }
      }}>대상 확인</button>
      {busy ? <p role="status" className="text-sm">처리 중이에요. 잠시 기다려 주세요.</p> : null}
      {error ? <p role="alert" className="rounded-lg border border-red-500 p-3 text-sm text-red-700 dark:text-red-300">{error}</p> : null}
      {preview && !result ? <div aria-live="polite" className="space-y-3 rounded-lg bg-muted/40 p-4 text-sm">
        <h2 className="font-semibold">대상 확인 결과</h2>
        <p>대상 {preview.target_count.toLocaleString('ko-KR')}곳 · 총 지급량 {(preview.target_count * amount).toLocaleString('ko-KR')} 크레딧</p>
        {preview.sample_names.length ? <p>예시 고객사: {preview.sample_names.join(', ')}</p> : <p>지급할 고객사가 없어요.</p>}
        {preview.target_count > 0 ? <label className="block space-y-2 font-medium">실행하려면 ‘지급’을 입력해 주세요.
          <input className="min-h-11 w-full rounded-lg border bg-background px-3" autoComplete="off" value={confirmation} onChange={(e) => setConfirmation(e.target.value)} />
        </label> : null}
        <button type="submit" disabled={busy || confirmation !== '지급' || preview.target_count === 0} className="min-h-11 rounded-lg bg-primary px-5 font-semibold text-primary-foreground disabled:opacity-50">지급 실행</button>
      </div> : null}
      {result ? <p role="status" className="rounded-lg border border-emerald-500 p-4 text-sm font-semibold">지급 {result.granted_count.toLocaleString('ko-KR')}곳 / 건너뜀 {result.skipped_count.toLocaleString('ko-KR')}곳</p> : null}
    </form>
  )
}
