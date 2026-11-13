'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import type { VaultCopyBundle } from '@/features/vault/bundle/types'
// Import the view file directly: the bundle index also re-exports server-only repositories.
import { BundleView } from '@/features/vault/bundle/ui/BundleView'
import { defaultVaultFetch, getBare, VaultReadError, vaultBase, type VaultFetch } from './vault-api'

type Load = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; bundle: VaultCopyBundle }

export type VaultBundleDialogProps = {
  workspaceId: string
  itemRef: string
  channelLabel: string
  open: boolean
  onOpenChange: (open: boolean) => void
  fetchFn?: VaultFetch
}

const LOAD_ERROR = '복사용 글을 불러오지 못했어요. 연결을 확인하고 다시 시도해 주세요.'

function isBundle(value: unknown): value is VaultCopyBundle {
  const bundle = value as Partial<VaultCopyBundle> | null
  return !!bundle && typeof bundle.fullText === 'string' && typeof bundle.body === 'string' && Array.isArray(bundle.tags) && Array.isArray(bundle.images) && Array.isArray(bundle.guideSteps) && !!bundle.publicationStatus
}

/** Opens the manual-publishing copy bundle (Naver / Daangn) from a card. Nothing here posts anywhere. */
export function VaultBundleDialog({ workspaceId, itemRef, channelLabel, open, onOpenChange, fetchFn = defaultVaultFetch }: VaultBundleDialogProps) {
  const url = `${vaultBase(workspaceId)}/${encodeURIComponent(itemRef)}/bundle`
  const [attempt, setAttempt] = useState(0)
  const requestKey = `${url}:${attempt}`
  const [result, setResult] = useState<{ key: string; load: Load }>({ key: '', load: { status: 'loading' } })
  const load: Load = result.key === requestKey ? result.load : { status: 'loading' }

  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    getBare<unknown>(fetchFn, url, controller.signal, LOAD_ERROR)
      .then((body) => {
        if (controller.signal.aborted) return
        setResult({ key: requestKey, load: isBundle(body) ? { status: 'ready', bundle: body } : { status: 'error', message: LOAD_ERROR } })
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setResult({ key: requestKey, load: { status: 'error', message: error instanceof VaultReadError ? error.message : LOAD_ERROR } })
      })
    return () => controller.abort()
  }, [open, url, fetchFn, requestKey])

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={`${channelLabel} 복사해서 올리기`}>
      <div className="min-w-0">
        {load.status === 'loading' && (
          <div role="status" aria-label="복사용 글 불러오는 중" className="space-y-3">
            <span className="sr-only">복사용 글 불러오는 중</span>
            <Skeleton className="h-8" /><Skeleton className="h-40" /><Skeleton className="h-24" />
          </div>
        )}
        {load.status === 'error' && (
          <div role="alert" className="rounded-xl border border-destructive p-4">
            <p className="font-semibold">복사용 글을 열지 못했어요</p>
            <p className="my-2 text-sm text-muted-foreground">{load.message}</p>
            <Button type="button" className="min-h-11" onClick={() => setAttempt((value) => value + 1)}>다시 시도</Button>
          </div>
        )}
        {load.status === 'ready' && <BundleView bundle={load.bundle} workspaceId={workspaceId} fetchFn={fetchFn} />}
      </div>
    </Dialog>
  )
}
