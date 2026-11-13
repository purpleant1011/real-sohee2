'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { approvalKey } from '@/features/mobile-decision/selectors'
import { loadStoredFirstPostDraft } from '@/features/mobile-firstpost/stored-draft-loader'
import { StoredFirstPostFlow } from '@/features/mobile-firstpost/stored-first-post-flow'
import type { DraftDto } from '@/features/mobile-firstpost/draft-mapper'

const drafting = new Set(['DRAFT', 'AWAITING_APPROVAL'])
const outcomes = new Set(['APPROVED', 'APPROVED_FOR_PUBLISH', 'EXECUTING', 'RUNNING', 'PUBLISHED_VERIFIED', 'PUBLISHED', 'COMPLETED'])
type State = { kind: 'idle' | 'loading' | 'error' | 'missing' | 'outcome' } | { kind: 'ready'; draft: DraftDto }

/** 별도 게시 명령 없이 저장·readback·최종 승인이 있는 정본 흐름을 재사용한다. */
export function PostApprovalContinuation({ item, workspaceId }: { item: string; workspaceId: string }) {
  const parsed = approvalKey(item)
  if (parsed?.kind !== 'post') return null
  return <PostApprovalSession key={`${workspaceId}:${item}`} missionId={parsed.id} workspaceId={workspaceId} />
}

function PostApprovalSession({ missionId, workspaceId }: { missionId: string; workspaceId: string }) {
  const [state, setState] = useState<State>({ kind: 'idle' })
  const pending = useRef<AbortController | null>(null)
  useEffect(() => () => pending.current?.abort(), [])

  async function open() {
    if (pending.current || !workspaceId) return
    const controller = new AbortController()
    pending.current = controller
    setState({ kind: 'loading' })
    try {
      const result = await loadStoredFirstPostDraft({ missionId, workspaceId, signal: controller.signal })
      if (controller.signal.aborted) return
      if (result.kind === 'ready') {
        const status = (result.missionStatus ?? '').trim().toUpperCase()
        if (result.draft.workspaceId !== workspaceId || result.draft.datasetMode !== 'ACTUAL') {
          setState({ kind: 'error' })
        } else if (drafting.has(status)) {
          setState({ kind: 'ready', draft: result.draft })
        } else {
          setState({ kind: outcomes.has(status) ? 'outcome' : 'error' })
        }
      } else if (result.kind !== 'cancelled') {
        setState({ kind: result.kind === 'missing' ? 'missing' : 'error' })
      }
    } catch {
      if (!controller.signal.aborted) setState({ kind: 'error' })
    } finally {
      if (pending.current === controller) pending.current = null
    }
  }

  if (state.kind === 'ready') return <StoredFirstPostFlow draft={state.draft} workspaceId={workspaceId} />
  if (state.kind === 'outcome') return <section className="space-y-3">
    <p role="status" className="text-sm text-muted-foreground">이미 승인되었거나 게시가 진행·완료된 작업이에요. 다시 게시하지 않고 결과를 확인해 주세요.</p>
    <Button asChild className="min-h-12 w-full"><Link prefetch={false} href={`/app/outcome/${missionId}`}>게시 결과 확인</Link></Button>
  </section>
  return <section aria-label="게시물 검토 계속하기" className="space-y-3">
    <p className="text-sm leading-relaxed text-muted-foreground">저장한 사진과 채널별 문구를 불러와 확인하고 수정해요. 최종 승인 전에는 게시하지 않아요.</p>
    {state.kind === 'error' ? <p role="alert" className="text-sm text-destructive">게시 초안을 확인하지 못했어요. 게시 요청은 보내지 않았어요.</p> : null}
    {state.kind === 'missing' ? <>
      <p role="status" className="text-sm text-muted-foreground">이 작업은 저장된 첫 게시 초안으로 열 수 없어요. 작업 상세에서 내용을 이어서 확인해 주세요.</p>
      <Button asChild className="min-h-12 w-full"><Link prefetch={false} href={`/app/missions/${missionId}?step=preview`}>작업 상세 확인</Link></Button>
    </> : <Button onClick={() => void open()} disabled={state.kind === 'loading' || !workspaceId} className="min-h-12 w-full">
      {state.kind === 'loading' ? '게시 초안 불러오는 중…' : state.kind === 'error' ? '다시 불러오기' : '게시물 수정·최종 승인'}
    </Button>}
  </section>
}
