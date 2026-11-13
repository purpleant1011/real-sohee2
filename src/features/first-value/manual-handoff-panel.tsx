'use client'

import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import type { VaultChannel } from '@/features/vault/types'
import type { ManualHandoffView } from '@/features/publishing/manual-handoff'
import { NaverPostUrlForm } from '@/features/publishing/naver-post-url-form'

export function ManualHandoffPanel({ workspaceId, contentId, versionId, channel, allowVaultSave = false, fetcher = fetch }: {
  workspaceId: string
  contentId: string
  versionId: string
  channel: VaultChannel
  /** 승인된 보관 항목이 없을 때 이 화면에서 보관(승인)을 먼저 하도록 안내한다. */
  allowVaultSave?: boolean
  fetcher?: typeof fetch
}) {
  const [view, setView] = useState<ManualHandoffView | null>(null)
  const [confirmed, setConfirmed] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [needsSave, setNeedsSave] = useState(false)
  const [saveConfirmed, setSaveConfirmed] = useState(false)
  const [vaultSaving, setVaultSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const load = useCallback(async () => {
    setView(null)
    setError(null)
    setNeedsSave(false)
    try {
      const query = new URLSearchParams({ contentId, versionId, channel })
      const response = await fetcher(`/api/first-value/handoff?${query}`, { cache: 'no-store', headers: { 'x-workspace-id': workspaceId } })
      const result = await response.json()
      if (!response.ok && result.code === 'VAULT_ITEM_REQUIRED') setNeedsSave(true)
      if (!response.ok || result.providerVerified !== false) throw new Error(result.error ?? '수동 전달 기록을 확인하지 못했어요.')
      setView(result)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '수동 전달 기록을 확인하지 못했어요.')
    }
  }, [workspaceId, contentId, versionId, channel, fetcher])
  useEffect(() => { void load() }, [load])

  async function saveToVault() {
    if (!saveConfirmed || vaultSaving) return
    setVaultSaving(true)
    setSaveError(null)
    try {
      const response = await fetcher(`/api/workspaces/${encodeURIComponent(workspaceId)}/vault`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ contentId, versionId, channels: [channel], idempotencyKey: `blog-manual:${versionId}` }),
      })
      const result = await response.json().catch(() => null) as { saved?: unknown[]; rejected?: { reason_label?: string }[]; error?: string } | null
      if (!response.ok) throw new Error(result?.error ?? '보관하지 못했어요. 잠시 후 다시 시도해 주세요.')
      if (!result?.saved?.length) throw new Error(result?.rejected?.[0]?.reason_label ?? '보관하지 못했어요. 원고를 확인해 주세요.')
      setSaveConfirmed(false)
      await load()
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : '보관하지 못했어요. 잠시 후 다시 시도해 주세요.')
    } finally {
      setVaultSaving(false)
    }
  }

  async function record() {
    if (!confirmed || saving) return
    setSaving(true)
    setError(null)
    try {
      const response = await fetcher('/api/first-value/handoff', {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-workspace-id': workspaceId },
        body: JSON.stringify({ contentId, versionId, channel, confirmed: true }),
      })
      const result = await response.json()
      if (!response.ok || result.state !== 'MANUAL_DELIVERED' || result.providerVerified !== false) throw new Error(result.error ?? '수동 전달 기록을 확인하지 못했어요.')
      setView(result)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '수동 전달 기록을 확인하지 못했어요.')
    } finally {
      setSaving(false)
    }
  }
  return <section aria-label="수동 전달 기록" className="space-y-3 rounded-xl border bg-card p-4">
    <h2 className="text-base font-semibold">직접 전달한 내용을 기록해요</h2>
    <p className="text-sm text-muted-foreground">보관한 원고·사진·연락처를 확인한 뒤 직접 전달해 주세요. 이 버튼은 글을 게시하거나 전송하지 않아요.</p>
    {error && !(needsSave && allowVaultSave) && <div role="alert" className="space-y-2 text-sm text-destructive">
      <p>{error}</p>
      {!view && !needsSave && <Button variant="outline" className="min-h-11" onClick={() => void load()}>기록 다시 확인</Button>}
    </div>}
    {needsSave && allowVaultSave ? <div className="space-y-2 text-sm">
      <p>직접 올린 기록을 남기려면 먼저 이 버전을 보관(승인)해야 해요. 보관해도 네이버에 게시되지 않아요. 보관하려면 사진이 1장 이상 필요해요.</p>
      <label className="flex min-h-11 items-center gap-3">
        <input type="checkbox" checked={saveConfirmed} disabled={vaultSaving} onChange={(event) => setSaveConfirmed(event.target.checked)} className="size-5 shrink-0 accent-primary" />
        <span>이 버전을 승인해 보관해요</span>
      </label>
      <Button className="min-h-11 w-full" disabled={!saveConfirmed || vaultSaving} aria-busy={vaultSaving} onClick={() => void saveToVault()}>
        {vaultSaving ? '보관하는 중…' : '이 버전을 보관하고 기록 시작'}
      </Button>
      {saveError ? <p role="alert" className="text-destructive">{saveError}</p> : null}
    </div> : null}
    {!view && !error && <p role="status" className="text-sm text-muted-foreground">수동 전달 기록을 확인하고 있어요.</p>}
    {view && <p role="status" className="text-sm font-medium">{view.label}</p>}
    {view?.state === 'MANUAL_DELIVERED' && <p className="text-sm text-muted-foreground">사장님이 알려주신 기록이며, 실제 게시 여부를 확인한 것은 아니에요.</p>}
    {view?.state === 'MANUAL_DELIVERED' && channel === 'naver_blog' && view.itemId ? <NaverPostUrlForm workspaceId={workspaceId} itemId={view.itemId} fetcher={fetcher} /> : null}
    {view?.state === 'NOT_RECORDED' && <>
      <label className="flex min-h-11 items-center gap-3 text-sm">
        <input type="checkbox" checked={confirmed} disabled={saving} onChange={(event) => setConfirmed(event.target.checked)} className="size-5 shrink-0 accent-primary" />
        <span>원고와 사진을 확인하고 직접 전달했어요</span>
      </label>
      <Button className="min-h-11 w-full" disabled={!confirmed || saving} aria-busy={saving} onClick={() => void record()}>
        {saving ? '기록하는 중…' : '수동 전달로 기록'}
      </Button>
    </>}
  </section>
}
