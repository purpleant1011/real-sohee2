'use client'

import { useActionState } from 'react'
import { preflightQueueAction } from './actions'
import type { OperatorActionResult } from './service'

type Props = { workspaceId: string; vaultItemId: string; noteId: string }

/** 운영자 조치 폼. 기록에 실패하면 한국어 오류를 화면에 보여준다. */
export function PreflightActionForm({ workspaceId, vaultItemId, noteId }: Props) {
  const [state, formAction, pending] = useActionState<OperatorActionResult, FormData>(preflightQueueAction, { ok: true })
  return (
    <form action={formAction} className="mt-3 flex flex-col gap-2 rounded-lg bg-muted/40 p-3 sm:flex-row sm:items-center">
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <input type="hidden" name="vaultItemId" value={vaultItemId} />
      <label className="sr-only" htmlFor={noteId}>조치 사유 메모</label>
      <input
        id={noteId}
        name="note"
        maxLength={500}
        placeholder="조치 사유 메모 (필수 입력)"
        className="min-h-11 flex-1 rounded-lg border bg-background px-3 text-base md:text-sm focus-visible:outline-2 focus-visible:outline-purple-600"
      />
      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          name="kind"
          value="request_reconfirm"
          disabled={pending}
          className="min-h-11 rounded-lg border border-purple-600/30 bg-purple-500/10 px-3.5 text-xs font-semibold text-purple-800 hover:bg-purple-500/20 disabled:opacity-50 dark:text-purple-200"
        >
          재확인 요청 기록
        </button>
        <button
          type="submit"
          name="kind"
          value="add_memo"
          disabled={pending}
          className="min-h-11 rounded-lg border bg-background px-3.5 text-xs font-semibold hover:bg-muted disabled:opacity-50"
        >
          메모 남기기
        </button>
        <button
          type="submit"
          name="kind"
          value="keep_hold"
          disabled={pending}
          className="min-h-11 rounded-lg border bg-background px-3.5 text-xs font-semibold text-muted-foreground hover:bg-muted disabled:opacity-50"
        >
          그대로 보관 유지
        </button>
      </div>
      {state.ok ? null : (
        <p role="alert" className="mt-1 text-xs font-medium text-destructive sm:mt-0">
          {state.message}
        </p>
      )}
    </form>
  )
}
