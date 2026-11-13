'use client'

import React, { useId, useState } from 'react'
import { MessageSquarePlus, X } from 'lucide-react'
import { KIND_LABEL, type FeedbackKind } from './types'

/** 주소 속에 섞인 긴 번호는 화면 이름에서 뺀다(개인정보·식별자 보호). */
export function normalizeScreen(pathname: string): string {
  return pathname.split('?')[0].replace(/\/[0-9a-f]{8}-[0-9a-f-]{27}/gi, '/:번호').slice(0, 200) || '/'
}

export function isPreviewScreen(pathname: string): boolean {
  return /\/vault|preview/i.test(pathname)
}

type Phase = 'idle' | 'sending' | 'sent' | 'error'

export function FeedbackLauncher({ workspaceId, pathname, inline = false, variant = 'floating' }: { workspaceId: string; pathname: string; inline?: boolean; variant?: 'floating' | 'floating-mobile' | 'sidebar' }) {
  const baseId = useId()
  const previewScreen = isPreviewScreen(pathname)
  const [open, setOpen] = useState(false)
  const [kind, setKind] = useState<FeedbackKind>('GENERAL')
  const [rating, setRating] = useState<number | null>(null)
  const [message, setMessage] = useState('')
  const [phase, setPhase] = useState<Phase>('idle')
  const [error, setError] = useState('')

  if (!workspaceId) return null

  const kinds: FeedbackKind[] = previewScreen ? ['PREVIEW_MISMATCH', 'PROBLEM', 'GENERAL'] : ['GENERAL', 'PROBLEM', 'IDEA']

  function openPanel() {
    setKind(previewScreen ? 'PREVIEW_MISMATCH' : 'GENERAL')
    setPhase('idle')
    setError('')
    setOpen(true)
  }

  async function send(event: React.FormEvent) {
    event.preventDefault()
    if (!message.trim()) { setError('의견을 한 글자 이상 적어 주세요.'); return }
    setPhase('sending')
    setError('')
    try {
      const response = await fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ screen: normalizeScreen(pathname), kind, rating, message }),
      })
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { error?: string } | null
        setError(body?.error ?? '의견을 보내지 못했어요. 잠시 뒤 다시 시도해 주세요.')
        setPhase('error')
        return
      }
      setMessage('')
      setRating(null)
      setPhase('sent')
    } catch {
      setError('의견을 보내지 못했어요. 인터넷 연결을 확인해 주세요.')
      setPhase('error')
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={openPanel}
        className={variant === 'sidebar' ? 'flex w-full items-center justify-center gap-2 rounded-xl px-2 py-2.5 text-[13px] font-bold text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-950 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary dark:text-zinc-400 dark:hover:bg-zinc-800/60 dark:hover:text-zinc-100 xl:justify-start xl:px-4' : inline || /^\/app\/settings(?:\/|$)/.test(pathname) ? 'inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-border bg-card px-4 text-sm text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary' : 'fixed right-3 bottom-22 md:bottom-[calc(var(--command-bar-height,5.75rem)+1rem)] md:right-6 z-40 inline-flex min-h-11 items-center gap-1.5 rounded-full border border-zinc-300 bg-white px-3 text-xs font-bold text-zinc-800 shadow-md dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-all focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary' + (variant === 'floating-mobile' ? ' md:hidden' : '')}
      >
        <MessageSquarePlus className="h-4 w-4 shrink-0" aria-hidden="true" />
        {variant === 'sidebar' ? <span className="sr-only xl:not-sr-only">의견 보내기</span> : '의견 보내기'}
      </button>
      {open && (
        <div role="dialog" aria-modal="true" aria-labelledby={`${baseId}-title`}
          className="fixed inset-x-3 bottom-24 md:inset-x-auto md:right-6 md:bottom-[calc(var(--command-bar-height,5.75rem)+4rem)] md:w-96 z-50 max-h-[80vh] overflow-y-auto rounded-2xl border border-zinc-200 bg-white p-4 shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
          <div className="flex items-center justify-between">
            <h2 id={`${baseId}-title`} className="text-sm font-bold">소희에게 의견 보내기</h2>
            <button type="button" onClick={() => setOpen(false)} aria-label="닫기" className="min-h-11 min-w-11 inline-flex items-center justify-center">
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
          {phase === 'sent' ? (
            <p role="status" className="py-4 text-sm">보내 주셔서 고마워요. 확인 후 더 나은 모습으로 반영할게요.</p>
          ) : (
            <form onSubmit={send} className="mt-2 space-y-3 text-sm">
              <fieldset>
                <legend className="mb-1 font-medium">어떤 내용인가요?</legend>
                <div className="flex flex-wrap gap-2">
                  {kinds.map((k) => (
                    <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)}
                      className={`min-h-11 rounded-full border px-3 text-xs ${kind === k ? 'border-purple-600 bg-purple-50 font-bold text-purple-800 dark:bg-purple-950 dark:text-purple-200' : 'border-zinc-300'}`}>
                      {KIND_LABEL[k]}
                    </button>
                  ))}
                </div>
              </fieldset>
              <fieldset>
                <legend className="mb-1 font-medium">만족도 (선택)</legend>
                <div className="flex gap-1">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button key={n} type="button" aria-pressed={rating === n} aria-label={`${n}점`}
                      onClick={() => setRating(rating === n ? null : n)}
                      className={`min-h-11 min-w-11 rounded-lg border text-sm ${rating === n ? 'border-purple-600 bg-purple-50 font-bold text-purple-800 dark:bg-purple-950 dark:text-purple-200' : 'border-zinc-300'}`}>
                      {n}
                    </button>
                  ))}
                </div>
              </fieldset>
              <div>
                <label htmlFor={`${baseId}-message`} className="mb-1 block font-medium">자세한 내용</label>
                <textarea id={`${baseId}-message`} value={message} onChange={(e) => setMessage(e.target.value)} maxLength={2000} rows={4}
                  className="w-full rounded-lg border border-zinc-300 bg-transparent p-2" />
                <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
                  연락처, 주민번호, 계좌·카드 번호, 비밀번호 같은 민감한 정보는 적지 말아 주세요. 지금은 화면 사진은 받지 않아요.
                </p>
              </div>
              {error && <p role="alert" className="text-xs text-rose-700 dark:text-rose-300">{error}</p>}
              <button type="submit" disabled={phase === 'sending'}
                className="min-h-11 w-full rounded-lg bg-purple-700 px-3 text-sm font-bold text-white disabled:opacity-60">
                {phase === 'sending' ? '보내는 중…' : '보내기'}
              </button>
            </form>
          )}
        </div>
      )}
    </>
  )
}
