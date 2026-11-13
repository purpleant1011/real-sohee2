'use client'

import { useRef, useState, type KeyboardEvent } from 'react'
import { ChannelPreview, type ChannelPreviewProps } from '@/features/preview/channel-preview'
import type { ApprovalActionVerdicts } from '@/features/vault/approval-policy'
import type { ChannelType } from '@/features/vault/channel-spec'
import { Button } from '@/components/ui/button'

type PreviewTarget = ChannelPreviewProps & { handle?: string | null; specLabel: string; actions?: ApprovalActionVerdicts; contentId?: string; versionId?: string }
export type ApprovalCardTarget = PreviewTarget
export type VaultSaveResponse = {
  saved: { channel: ChannelType; status_label: string; release_gate_label: string }[]
  rejected: { channel: ChannelType; reason_label: string }[]
  external_posts: number
}
const names: Record<ChannelType, string> = { instagram: '인스타그램', threads: '스레드', naver_blog: '네이버 블로그', daangn_business: '당근 비즈니스' }
const actions = [
  ['VAULT', '승인하고 보관'], ['PUBLISH', '승인하고 발행'], ['SCHEDULE', '승인하고 예약'],
] as const

export function ApprovalCard({ workspaceId, contentId, versionId, targets, onRevise, onPublish, onSchedule, fetcher = fetch, busy = false }: {
  workspaceId: string
  contentId?: string | null
  versionId?: string | null
  targets: ApprovalCardTarget[]
  onRevise: () => void
  onPublish: () => void
  onSchedule: () => void
  fetcher?: typeof fetch
  busy?: boolean
}) {
  const [index, setIndex] = useState(0)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<VaultSaveResponse | null>(null)
  const savedChannels = useRef<VaultSaveResponse['saved']>([])
  const key = useRef<string | null>(null)
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([])
  const current = targets[index] ?? targets[0]
  const allHaveVerdicts = targets.length > 0 && targets.every(t => t.actions)
  const saveTargets = targets.filter(t => t.actions?.VAULT.allowed && (t.contentId || contentId) && (t.versionId || versionId))
  const canSave = allHaveVerdicts && saveTargets.length > 0
  const enabled = (action: 'VAULT' | 'PUBLISH' | 'SCHEDULE') => allHaveVerdicts && (action === 'VAULT' ? canSave : targets.every(t => t.actions?.[action]?.allowed === true))
  const reason = (action: 'VAULT' | 'PUBLISH' | 'SCHEDULE') => targets
    .filter(t => t.actions?.[action]?.allowed === false)
    .map(t => `${names[t.channel]}: ${t.actions?.[action]?.message ?? '이 작업을 진행할 수 없어요'}`)

  function move(event: KeyboardEvent<HTMLButtonElement>, at: number) {
    const next = event.key === 'ArrowRight' ? (at + 1) % targets.length : event.key === 'ArrowLeft' ? (at - 1 + targets.length) % targets.length : event.key === 'Home' ? 0 : event.key === 'End' ? targets.length - 1 : null
    if (next === null) return
    event.preventDefault()
    setIndex(next)
    tabRefs.current[next]?.focus()
  }

  async function save() {
    if (!canSave || saving || result) return
    setSaving(true)
    setError(null)
    try {
      key.current ??= crypto.randomUUID()
      const groups = new Map<string, { contentId: string; versionId: string; channels: ChannelType[] }>()
      for (const target of saveTargets.filter(target => !savedChannels.current.some(saved => saved.channel === target.channel))) {
        const id = target.contentId ?? contentId!
        const version = target.versionId ?? versionId!
        const groupKey = JSON.stringify([id, version])
        const group = groups.get(groupKey) ?? { contentId: id, versionId: version, channels: [] }
        group.channels.push(target.channel)
        groups.set(groupKey, group)
      }
      const combined: VaultSaveResponse = { saved: [...savedChannels.current], rejected: [], external_posts: 0 }
      for (const group of groups.values()) {
        const response = await fetcher(`/api/workspaces/${encodeURIComponent(workspaceId)}/vault`, {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ...group, targetDate: null, idempotencyKey: `${key.current}:${group.channels.join('-')}` }),
        })
        const data = await response.json()
        if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : '보관하지 못했어요. 잠시 후 다시 시도해 주세요.')
        if (!Array.isArray(data.saved) || !Array.isArray(data.rejected) || data.external_posts !== 0) throw new Error('보관 결과를 확인할 수 없어요. 잠시 후 다시 확인해 주세요.')
        combined.saved.push(...data.saved)
        combined.rejected.push(...data.rejected)
        savedChannels.current = [...combined.saved]
      }
      if (!combined.saved.length) {
        setError(combined.rejected.map(r => `${names[r.channel] ?? '채널'}: ${r.reason_label}`).join(' · ') || '보관하지 못했어요. 원고를 확인해 주세요.')
        return
      }
      setResult(combined)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '보관하지 못했어요. 잠시 후 다시 시도해 주세요.')
    } finally {
      setSaving(false)
    }
  }

  if (!current) return null
  return (
    <section aria-label="승인 카드" className="min-w-0 max-w-full space-y-4 overflow-hidden rounded-xl border bg-card p-3 sm:p-4">
      <div className="min-w-0 space-y-1">
        <h3 className="font-semibold">승인 전 빠른 확인</h3>
        <p className="break-words text-sm text-foreground">대상 계정 {current.handle?.trim() ? `@${current.handle.trim().replace(/^@+/, '')}` : '연결 전'} · {current.specLabel}</p>
      </div>
      {targets.length > 1 && (
        <div role="tablist" aria-label="승인 채널 선택" className="flex max-w-full gap-1 overflow-x-auto rounded-lg bg-muted p-1">
          {targets.map((t, i) => <button key={t.channel} ref={el => { tabRefs.current[i] = el }} role="tab" type="button" id={`approval-${t.channel}-tab`} aria-controls={`approval-${t.channel}-panel`} aria-selected={current.channel === t.channel} tabIndex={current.channel === t.channel ? 0 : -1} onClick={() => setIndex(i)} onKeyDown={e => move(e, i)} className="shrink-0 rounded-md px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-selected:bg-background">{names[t.channel]}</button>)}
        </div>
      )}
      <div role="tabpanel" id={`approval-${current.channel}-panel`} aria-labelledby={targets.length > 1 ? `approval-${current.channel}-tab` : undefined} className="min-w-0 max-w-full overflow-hidden">
        <ChannelPreview {...current} />
      </div>
      <div className="grid min-w-0 gap-2 sm:grid-cols-3">
        {actions.map(([action, label]) => {
          const isEnabled = enabled(action) && (action !== 'VAULT' || canSave)
          return <div key={action} className="min-w-0 space-y-1">
            <Button type="button" className="h-auto min-h-11 w-full whitespace-normal break-words" variant={action === 'VAULT' ? 'default' : 'outline'} disabled={!isEnabled || saving || busy || Boolean(result)} onClick={() => action === 'VAULT' ? void save() : action === 'PUBLISH' ? onPublish() : onSchedule()}>{label}</Button>
            {!isEnabled && <p className="break-words text-xs text-muted-foreground">{reason(action).join(' · ') || (action === 'VAULT' ? '보관할 원고 연결을 기다리고 있어요' : '채널 연결과 승인 상태를 확인해 주세요')}</p>}
          </div>
        })}
      </div>
      <Button type="button" variant="ghost" className="min-h-11" disabled={saving || busy || Boolean(result)} onClick={onRevise}>말투 고치기</Button>
      {canSave && reason('VAULT').length > 0 && <p className="break-words text-xs text-muted-foreground">{reason('VAULT').join(' · ')}</p>}
      {saving && <p role="status" className="text-sm">보관하는 중이에요…</p>}
      {error && <p role="alert" className="break-words text-sm text-destructive">{error}</p>}
      {result && <div role="status" className="space-y-1 break-words text-sm">
        <p>발행 준비 완료 · 외부 게시 전</p>
        <p>외부 게시 {result.external_posts}건</p>
        <ul>{result.saved.map(r => <li key={r.channel}>{names[r.channel]}: {r.release_gate_label}</li>)}</ul>
        {result.rejected.length > 0 && <p>일부 채널은 보관하지 못했어요.</p>}
        <ul>{result.rejected.map(r => <li key={r.channel}>{names[r.channel]}: {r.reason_label}</li>)}</ul>
      </div>}
    </section>
  )
}
