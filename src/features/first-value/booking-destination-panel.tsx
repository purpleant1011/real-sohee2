'use client'

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { validateBookingUrl, type ConversionDestinationView } from '@/features/conversion-destination/destination'

type DestinationData = {
  configuration: { revision: number; bookingUrl: string | null; bookingExpiresAt: string | null } | null
  destination: ConversionDestinationView
}

function localExpiry(value: string | null | undefined): string {
  if (!value) return ''
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return ''
  const pad = (part: number, width = 2) => String(part).padStart(width, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`
}

export function BookingDestinationPanel({ workspaceId, onApply, fetcher = fetch }: {
  workspaceId: string
  onApply: (url: string) => Promise<void>
  fetcher?: typeof fetch
}) {
  const [loaded, setLoaded] = useState<{ workspaceId: string; data: DestinationData } | null>(null)
  const [url, setUrl] = useState('')
  const [expiry, setExpiry] = useState('')
  const [checkedTime, setCheckedTime] = useState(0)
  const [confirmed, setConfirmed] = useState(false)
  const [saving, setSaving] = useState(false)
  const [applying, setApplying] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [requiresReload, setRequiresReload] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const command = useRef<{ id: string; expectedRevision: number } | null>(null)
  const scope = useRef(workspaceId)
  useLayoutEffect(() => { scope.current = workspaceId }, [workspaceId])
  const data = loaded?.workspaceId === workspaceId ? loaded.data : null

  const read = useCallback(async (): Promise<DestinationData> => {
    const response = await fetcher('/api/first-value/destination', { cache: 'no-store', headers: { 'x-workspace-id': workspaceId } })
    const result = await response.json().catch(() => ({}))
    if (!response.ok || !result.destination || result.destination.networkVerified !== false) throw new Error(result.error ?? '예약 주소를 확인하지 못했어요.')
    const config = result.configuration
    if (config !== null && (!config || !Number.isInteger(config.revision) || config.revision < 1 ||
        (config.bookingUrl !== null && typeof config.bookingUrl !== 'string') ||
        (config.bookingExpiresAt !== null && (typeof config.bookingExpiresAt !== 'string' || !Number.isFinite(Date.parse(config.bookingExpiresAt)))))) {
      throw new Error('예약 주소 설정 정보를 확인하지 못했어요.')
    }
    if (!['BOOKING_URL', 'LANDING', 'NOT_CONFIGURED', 'REVIEW_REQUIRED'].includes(result.destination.kind) ||
        (result.destination.kind === 'BOOKING_URL' && (!config?.bookingUrl || typeof result.destination.href !== 'string'))) throw new Error('예약 주소를 확인하지 못했어요.')
    return result
  }, [workspaceId, fetcher])

  const accept = useCallback((result: DestinationData) => {
    setLoaded({ workspaceId, data: result })
    setUrl(result.configuration?.bookingUrl ?? '')
    setExpiry(localExpiry(result.configuration?.bookingExpiresAt))
    setCheckedTime(Date.now())
    setConfirmed(false)
    setSaving(false)
    setApplying(false)
    setNotice(null)
    setRequiresReload(false)
    setError(null)
    command.current = null
  }, [workspaceId])

  useEffect(() => {
    let active = true
    void read().then(result => { if (active) accept(result) }).catch(cause => {
      if (active) setError(cause instanceof Error ? cause.message : '예약 주소를 확인하지 못했어요.')
    })
    return () => { active = false }
  }, [read, accept])

  async function reload() {
    setError(null)
    const currentScope = workspaceId
    try {
      const observed = await read()
      if (scope.current === currentScope) accept(observed)
    } catch (cause) {
      if (scope.current === currentScope) setError(cause instanceof Error ? cause.message : '예약 주소를 확인하지 못했어요.')
    }
  }
  let shareable: string | null = null
  try { if (url.trim()) shareable = validateBookingUrl(url) } catch { /* Invalid input is not linked or submitted. */ }
  const removing = Boolean(data?.configuration?.bookingUrl && !url.trim())
  const originalExpiry = data?.configuration?.bookingExpiresAt ?? null
  const expiryDate = expiry ? new Date(expiry) : null
  const bookingExpiresAt = expiry === localExpiry(originalExpiry) ? originalExpiry : expiryDate && Number.isFinite(expiryDate.getTime()) ? expiryDate.toISOString() : null
  const validExpiry = !expiry || Boolean(bookingExpiresAt && Date.parse(bookingExpiresAt) > checkedTime)
  const canSave = Boolean(data && confirmed && (shareable || removing) && (removing || validExpiry) && !saving && !applying && !requiresReload)
  const savedInput = (url.trim() ? shareable : null) === (data?.configuration?.bookingUrl ?? null) && bookingExpiresAt === originalExpiry && !requiresReload

  async function save() {
    if (!canSave || !data) return
    setSaving(true)
    setError(null)
    setNotice(null)
    const currentScope = workspaceId
    const operation = command.current ??= { id: crypto.randomUUID(), expectedRevision: data.configuration?.revision ?? 0 }
    const requestedUrl = removing ? null : shareable
    const requestedExpiry = removing ? null : bookingExpiresAt
    try {
      const response = await fetcher('/api/first-value/destination', {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-workspace-id': workspaceId },
        body: JSON.stringify({ bookingUrl: requestedUrl, bookingExpiresAt: requestedExpiry, confirmed: true, commandId: operation.id, expectedRevision: operation.expectedRevision }),
      })
      const result = await response.json().catch(() => ({}))
      if (scope.current !== currentScope) return
      if (!response.ok) {
        if (response.status === 409) setRequiresReload(true)
        throw new Error(result.error ?? '예약 주소 저장 결과를 확인하지 못했어요.')
      }
      const receipt = result.configuration
      if (!receipt || receipt.revision !== operation.expectedRevision + 1 || receipt.bookingUrl !== requestedUrl || receipt.bookingExpiresAt !== requestedExpiry) throw new Error('예약 주소 저장 기록을 확인하지 못했어요.')
      const observed = await read()
      if (scope.current !== currentScope) return
      accept(observed)
      const latest = observed.configuration
      if (!latest || latest.revision !== receipt.revision || latest.bookingUrl !== receipt.bookingUrl || latest.bookingExpiresAt !== receipt.bookingExpiresAt) {
        setError('예약 주소가 변경되었어요. 최신 내용을 다시 확인해 주세요.')
        return
      }
      setNotice('예약 주소 설정을 저장하고 다시 확인했어요. 글에 넣기 전 내용을 확인해 주세요.')
    } catch (cause) {
      if (scope.current === currentScope) setError(cause instanceof Error ? cause.message : '예약 주소 저장 결과를 확인하지 못했어요.')
    } finally {
      if (scope.current === currentScope) setSaving(false)
    }
  }
  async function apply() {
    if (data?.destination.kind !== 'BOOKING_URL' || !data.destination.href || applying || saving || !savedInput) return
    setApplying(true)
    setError(null)
    const currentScope = workspaceId
    try {
      const observed = await read()
      if (scope.current !== currentScope) return
      if (observed.configuration?.revision !== data.configuration?.revision || observed.destination.kind !== 'BOOKING_URL' || !observed.destination.href || observed.destination.href !== data.destination.href) {
        accept(observed)
        throw new Error('예약 주소가 변경되었어요. 최신 내용을 다시 확인해 주세요.')
      }
      await onApply(validateBookingUrl(observed.destination.href))
    } catch (cause) {
      if (scope.current === currentScope) setError(cause instanceof Error ? cause.message : '예약 주소를 글에 넣지 못했어요.')
    } finally { if (scope.current === currentScope) setApplying(false) }
  }

  return <section aria-label="예약 링크 설정" className="space-y-3 rounded-xl border bg-card p-4">
    <h2 className="text-base font-semibold">고객이 예약할 주소</h2>
    <p className="text-sm text-muted-foreground">기존 예약 페이지가 있다면 그 주소를 먼저 써요. 저장만으로 글이 바뀌거나 게시되지는 않아요.</p>
    {error && <div role="alert" className="space-y-2 text-sm text-destructive">
      <p>{error}</p>
      {(!data || requiresReload) && <Button variant="outline" className="min-h-11" onClick={() => void reload()}>최신 주소 다시 확인</Button>}
    </div>}
    {!data && !error && <p role="status" className="text-sm text-muted-foreground">예약 주소를 확인하고 있어요.</p>}
    {data && <>
      {!data.configuration?.bookingUrl && <p className="text-sm text-muted-foreground">설정된 예약 주소가 없어요.</p>}
      <form className="space-y-3" onSubmit={event => { event.preventDefault(); void save() }}>
        <label className="block space-y-2 text-sm font-medium">
          <span>예약 주소</span>
          <Input type="url" value={url} className="min-h-11" autoCapitalize="none" spellCheck={false} disabled={saving || applying}
            aria-invalid={Boolean(url && !shareable)}
            onChange={event => { setUrl(event.target.value); setConfirmed(false); setNotice(null); command.current = null }} />
        </label>
        {url && !shareable && <p className="text-sm text-destructive">공개 가능한 https 예약 주소를 입력해 주세요.</p>}
        <details className="text-sm">
          <summary className="min-h-11 cursor-pointer py-3 font-medium">주소 사용 기한(선택)</summary>
          <label className="block space-y-2">
            <span>주소 사용 기한 · 기기 시간대 기준</span>
            <Input type="datetime-local" step="0.001" value={expiry} className="min-h-11" disabled={saving || applying} aria-invalid={Boolean(expiry && !validExpiry)}
              onChange={event => { setExpiry(event.target.value); setCheckedTime(Date.now()); setConfirmed(false); setNotice(null); command.current = null }} />
          </label>
          {!validExpiry && <p className="mt-2 text-destructive">주소 사용 기한이 지났거나 올바르지 않아요. 다시 확인해 주세요.</p>}
        </details>
        {shareable && <a href={shareable} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex min-h-11 items-center text-sm font-medium text-primary underline underline-offset-4">예약 페이지를 열어 확인</a>}
        <label className="flex min-h-11 items-center gap-3 text-sm">
          <input type="checkbox" checked={confirmed} disabled={saving || applying} className="size-5 shrink-0 accent-primary" onChange={event => { setCheckedTime(Date.now()); setConfirmed(event.target.checked) }} />
          <span>{removing ? '예약 주소 사용을 중지하는 내용을 확인했어요' : '우리 가게 예약 페이지와 공개 가능한 주소를 직접 확인했어요'}</span>
        </label>
        <Button type="submit" className="min-h-11 w-full" disabled={!canSave} aria-busy={saving}>
          {saving ? '저장 결과를 확인하는 중…' : removing ? '예약 주소 사용 중지' : '예약 주소 저장'}
        </Button>
      </form>
      {data.destination.kind === 'REVIEW_REQUIRED' && <p className="text-sm text-muted-foreground">{data.destination.label}</p>}
      {data.destination.kind === 'BOOKING_URL' && data.destination.href && <>
        <p className="text-sm font-medium">사장님이 확인한 예약 링크</p>
        <p className="text-sm text-muted-foreground">접속 상태를 자동으로 확인한 것은 아니에요. 공유 전 실제 예약 페이지를 다시 확인해 주세요.</p>
        <p className="text-sm text-muted-foreground">기존 원고에 다른 주소가 있다면 직접 수정에서 함께 확인해 주세요.</p>
        {!savedInput && <p className="text-sm text-muted-foreground">변경한 주소를 먼저 저장한 뒤 글에 넣어 주세요.</p>}
        <Button type="button" variant="outline" className="min-h-11 w-full" disabled={applying || saving || !savedInput} aria-busy={applying} onClick={() => void apply()}>
          {applying ? '원고에 넣는 중…' : '이 주소를 글에 추가'}
        </Button>
      </>}
    </>}
    {notice && data && <p role="status" className="text-sm text-muted-foreground">{notice}</p>}
  </section>
}
