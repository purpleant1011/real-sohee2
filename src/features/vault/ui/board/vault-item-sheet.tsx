'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { ChannelPreview } from '@/features/preview/channel-preview'
import type { VaultItemDetailDto } from '@/features/vault/query/types'
import { VaultItemEditor } from '@/features/vault/ui/edit'
import { SpecCheckPanel } from '@/features/vault/ui/spec-check'
import { toPreviewInput } from './item-preview-input'
import { defaultVaultFetch, getEnveloped, VaultReadError, vaultBase, type VaultFetch } from './vault-api'

type Load = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; detail: VaultItemDetailDto }

export type VaultItemSheetProps = {
  workspaceId: string
  itemRef: string
  /** Known from the card, so the title is correct before the detail arrives. */
  channelLabel: string
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The freshly read item after the owner changed something, or null when it could not be re-read. */
  onItemChanged: (detail: VaultItemDetailDto | null) => void
  fetchFn?: VaultFetch
}

const LOAD_ERROR = '보관 글을 불러오지 못했어요. 연결을 확인하고 다시 시도해 주세요.'

/**
 * Preview + channel check + edit controls for one saved item, in the shared accessible dialog
 * (focus is trapped, Escape and the close button leave, focus returns to the opener).
 */
export function VaultItemSheet({ workspaceId, itemRef, channelLabel, open, onOpenChange, onItemChanged, fetchFn = defaultVaultFetch }: VaultItemSheetProps) {
  const url = `${vaultBase(workspaceId)}/${encodeURIComponent(itemRef)}`
  const [attempt, setAttempt] = useState(0)
  const requestKey = `${url}:${attempt}`
  const [result, setResult] = useState<{ key: string; load: Load }>({ key: '', load: { status: 'loading' } })
  const [refreshFailed, setRefreshFailed] = useState(false)
  const refreshSeq = useRef(0)
  const load: Load = result.key === requestKey ? result.load : { status: 'loading' }

  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    getEnveloped<VaultItemDetailDto>(fetchFn, url, controller.signal, LOAD_ERROR)
      .then((detail) => { if (!controller.signal.aborted) setResult({ key: requestKey, load: { status: 'ready', detail } }) })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        setResult({ key: requestKey, load: { status: 'error', message: error instanceof VaultReadError ? error.message : LOAD_ERROR } })
      })
    return () => controller.abort()
  }, [open, url, fetchFn, requestKey])

  // Re-read after a save so the preview, the check and the card chip show what the server now says.
  const refresh = useCallback(async () => {
    const seq = ++refreshSeq.current
    try {
      const detail = await getEnveloped<VaultItemDetailDto>(fetchFn, url, new AbortController().signal, LOAD_ERROR)
      if (seq !== refreshSeq.current) return
      setResult({ key: requestKey, load: { status: 'ready', detail } })
      setRefreshFailed(false)
      onItemChanged(detail)
    } catch {
      if (seq !== refreshSeq.current) return
      setRefreshFailed(true)
      onItemChanged(null)
    }
  }, [fetchFn, url, requestKey, onItemChanged])

  const detail = load.status === 'ready' ? load.detail : null
  const input = useMemo(() => (detail ? toPreviewInput(detail) : null), [detail])

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={`${channelLabel} 보관 글`}>
      <div className="min-w-0 space-y-5">
        {load.status === 'loading' && (
          <div role="status" aria-label="보관 글 불러오는 중" className="space-y-3">
            <span className="sr-only">보관 글 불러오는 중</span>
            <Skeleton className="h-8" /><Skeleton className="h-48" /><Skeleton className="h-32" />
          </div>
        )}
        {load.status === 'error' && (
          <div role="alert" className="rounded-xl border border-destructive p-4">
            <p className="font-semibold">보관 글을 열지 못했어요</p>
            <p className="my-2 text-sm text-muted-foreground">{load.message}</p>
            <Button type="button" className="min-h-11" onClick={() => setAttempt((value) => value + 1)}>다시 시도</Button>
          </div>
        )}
        {detail && input && (
          <>
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <span className="rounded-full bg-muted px-3 py-1 text-sm font-semibold">{detail.channel_label}</span>
              <p role="status" className="min-w-0 break-words text-sm font-semibold">{detail.status_label}</p>
              {detail.hold_reason_label && <p className="min-w-0 break-words rounded-lg border border-border bg-muted/50 px-3 py-1 text-sm">{detail.hold_reason_label}</p>}
            </div>
            {refreshFailed && <p role="alert" className="rounded-lg border border-destructive p-3 text-sm">방금 바꾼 내용을 화면에 반영하지 못했어요. 이 창을 닫으면 보관함을 새로 불러와요.</p>}
            <section aria-labelledby="vault-sheet-preview" className="min-w-0 space-y-2">
              <h3 id="vault-sheet-preview" className="text-base font-semibold">미리보기</h3>
              <p className="text-sm text-muted-foreground">저장한 내용을 기준으로 보여줘요. 고친 내용은 저장하면 바로 반영돼요.</p>
              <div className="min-w-0 max-w-full overflow-hidden"><ChannelPreview {...input.preview} /></div>
            </section>
            <section aria-labelledby="vault-sheet-spec" className="min-w-0 space-y-2">
              <h3 id="vault-sheet-spec" className="text-base font-semibold">채널 규격 확인</h3>
              <SpecCheckPanel result={input.spec} channel={detail.channel} />
            </section>
            <section aria-labelledby="vault-sheet-edit" className="min-w-0 space-y-2">
              <h3 id="vault-sheet-edit" className="text-base font-semibold">수정하기</h3>
              <VaultItemEditor
                workspaceId={workspaceId}
                itemRef={itemRef}
                version={detail.updated_at}
                channel={detail.channel}
                channelLabel={detail.channel_label}
                initialTitle={detail.content.title ?? ''}
                initialText={detail.content.body}
                initialHashtags={detail.content.tags}
                initialTargetDate={detail.target_date}
                initialApprovalState={detail.needs_reapproval ? 'INVALIDATED' : 'APPROVED'}
                initialReleaseGate={detail.is_user_held ? 'HELD_USER' : null}
                initialDeletedAt={detail.deleted_at}
                fetchFn={fetchFn}
                onSuccess={() => void refresh()}
              />
            </section>
          </>
        )}
      </div>
    </Dialog>
  )
}
