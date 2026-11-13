'use client'

import { useEffect, useState } from 'react'
import { BarChart3, Check, GraduationCap, MessagesSquare, PenSquare } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { TeachQuestionChips } from './teach-question-chips'
import {
  CONVERSATION_MODES, POSTING_CHANNELS, POSTING_PURPOSES, buildModePrompt, isModeReady,
  type ModeId, type PostingChannelId, type PostingPurposeId,
} from './conversation-modes'

const MODE_ICON = { posting: PenSquare, teach: GraduationCap, inquiry: MessagesSquare, insight: BarChart3 } as const

export interface SelectedBadge {
  id: string
  label: string
  onRemove: () => void
}

export interface ConversationSelectionState {
  mode: ModeId | null
  ready: boolean
  prompt: string
  badges: SelectedBadge[]
}

/**
 * 새 대화의 큼직한 시작 화면. 사장님이 무엇을 시킬지 먼저 고르고(필요하면 목적·채널을 체크),
 * 선택된 내용은 입력창 상단 배지로 요약되어 입력창 전송 버튼으로 실행된다.
 * onSelectionChange가 없을 때는 자체 시작하기 버튼을 유지한다(하위 호환).
 */
export function ConversationStartHub({
  onStart,
  onSelectionChange,
  disabled = false,
}: Readonly<{
  onStart: (message: string) => void
  onSelectionChange?: (state: ConversationSelectionState) => void
  disabled?: boolean
}>) {
  const [mode, setMode] = useState<ModeId | null>(null)
  const [purpose, setPurpose] = useState<PostingPurposeId | null>(null)
  const [channels, setChannels] = useState<readonly PostingChannelId[]>([])
  const [teachPrompt, setTeachPrompt] = useState<string | null>(null)
  const ready = mode !== null && isModeReady(mode, { purpose, channels })

  function toggle(id: PostingChannelId) {
    setChannels(current => current.includes(id) ? current.filter(c => c !== id) : [...current, id])
  }

  const currentPrompt = mode === 'teach' && teachPrompt
    ? teachPrompt
    : mode
      ? buildModePrompt(mode, { purpose, channels })
      : ''

  useEffect(() => {
    if (!onSelectionChange) return

    const badges: SelectedBadge[] = []
    if (mode) {
      const modeConfig = CONVERSATION_MODES.find(m => m.id === mode)
      if (modeConfig) {
        badges.push({
          id: `mode-${mode}`,
          label: modeConfig.label,
          onRemove: () => {
            setMode(null)
            setPurpose(null)
            setChannels([])
            setTeachPrompt(null)
          },
        })
      }
    }
    if (purpose) {
      const pConfig = POSTING_PURPOSES.find(p => p.id === purpose)
      if (pConfig) {
        badges.push({
          id: `purpose-${purpose}`,
          label: pConfig.label,
          onRemove: () => setPurpose(null),
        })
      }
    }
    for (const cId of channels) {
      const cConfig = POSTING_CHANNELS.find(c => c.id === cId)
      if (cConfig) {
        badges.push({
          id: `channel-${cId}`,
          label: cConfig.label,
          onRemove: () => setChannels(cur => cur.filter(c => c !== cId)),
        })
      }
    }
    if (teachPrompt) {
      badges.push({
        id: 'teach-topic',
        label: '주제 선택됨',
        onRemove: () => setTeachPrompt(null),
      })
    }

    onSelectionChange({
      mode,
      ready,
      prompt: currentPrompt,
      badges,
    })
  }, [mode, purpose, channels, teachPrompt, ready, currentPrompt, onSelectionChange])

  return (
    <section aria-label="대화 시작" className="mx-auto w-full max-w-xl space-y-4 px-1 py-2 [&_input]:text-base [&_textarea]:text-base [&_select]:text-base">
      <header className="space-y-1">
        <p className="text-xs font-semibold uppercase tracking-wider text-primary">소희와 함께</p>
        <h2 className="break-keep text-xl sm:text-2xl font-bold leading-tight tracking-tight text-foreground">무엇을 하고 싶으세요?</h2>
        <p className="break-keep text-sm text-muted-foreground">하나를 고르면 소희가 필요한 것부터 물어봐요.</p>
      </header>

      {mode === null ? (
        <div className="grid grid-cols-2 gap-2.5">
          {CONVERSATION_MODES.map(m => {
            const Icon = MODE_ICON[m.id]
            return (
              <button key={m.id} type="button" disabled={disabled} aria-pressed={false} onClick={() => setMode(m.id)}
                className="m-press flex min-h-28 flex-col items-start gap-2 rounded-2xl border border-border bg-card p-3.5 text-left transition-all active:scale-[0.98] hover:border-primary/40 disabled:opacity-50">
                <span className="flex size-9 items-center justify-center rounded-xl bg-primary/10 text-primary"><Icon className="size-4.5" aria-hidden="true" /></span>
                <span className="break-keep text-sm font-semibold leading-tight text-card-foreground">{m.label}</span>
                <span className="break-keep text-xs leading-snug text-muted-foreground line-clamp-2">{m.description}</span>
              </button>
            )
          })}
        </div>
      ) : (
        <div className="flex flex-wrap gap-2 pb-1" role="group" aria-label="대화 종류">
          {CONVERSATION_MODES.map(m => {
            const Icon = MODE_ICON[m.id]
            const selected = mode === m.id
            return (
              <button key={m.id} type="button" disabled={disabled} aria-pressed={selected} onClick={() => setMode(m.id)}
                className={`m-press flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-sm font-medium whitespace-nowrap select-none transition-all active:scale-[0.98] ${selected ? 'border-primary bg-primary text-primary-foreground shadow-xs' : 'border-border bg-card text-foreground hover:bg-muted/50'}`}>
                <Icon className="size-4" aria-hidden="true" />{m.label}
              </button>
            )
          })}
        </div>
      )}

      {mode === 'posting' ? (
        <div className="space-y-4 rounded-2xl border border-border bg-card p-4">
          <fieldset className="space-y-2">
            <legend className="text-sm font-semibold text-foreground">어떤 포스팅인가요?</legend>
            <div role="radiogroup" aria-label="포스팅 목적" className="flex flex-wrap gap-2">
              {POSTING_PURPOSES.map(p => (
                <button key={p.id} type="button" role="radio" aria-checked={purpose === p.id} aria-label={p.label} onClick={() => setPurpose(p.id)}
                  className={`m-press min-h-11 rounded-full border px-4 text-sm font-medium whitespace-nowrap transition-all active:scale-[0.98] ${purpose === p.id ? 'border-primary bg-primary text-primary-foreground shadow-xs' : 'border-border bg-background text-foreground hover:bg-muted/50'}`}>{p.label}</button>
              ))}
            </div>
          </fieldset>
          <fieldset className="space-y-2">
            <legend className="text-sm font-semibold text-foreground">어디에 올릴까요? <span className="font-normal text-muted-foreground">(여러 개 선택)</span></legend>
            <div className="grid grid-cols-2 gap-2">
              {POSTING_CHANNELS.map(c => {
                const on = channels.includes(c.id)
                return (
                  <button key={c.id} type="button" role="checkbox" aria-checked={on} aria-label={c.label} onClick={() => toggle(c.id)}
                    className={`m-press flex min-h-14 items-center justify-between gap-2 rounded-xl border px-3 text-left transition-all active:scale-[0.98] ${on ? 'border-primary bg-primary/5 text-foreground' : 'border-border bg-background text-foreground hover:bg-muted/40'}`}>
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold truncate">{c.label}</span>
                      <span className="block text-xs text-muted-foreground">{c.mode === 'auto' ? '소희가 게시' : '직접 올리기'}</span>
                    </span>
                    <span aria-hidden="true" className={`flex size-5 shrink-0 items-center justify-center rounded-md border ${on ? 'border-primary bg-primary text-primary-foreground' : 'border-border'}`}>{on ? <Check className="size-3.5" /> : null}</span>
                  </button>
                )
              })}
            </div>
          </fieldset>
        </div>
      ) : null}

      {mode === 'teach' ? (
        <div className="space-y-2 rounded-2xl border border-border bg-card p-4">
          <p className="text-sm font-semibold text-foreground">무엇부터 가르쳐 볼까요?</p>
          <TeachQuestionChips onPick={setTeachPrompt} disabled={disabled} />
          {teachPrompt ? <p className="text-xs text-muted-foreground">고른 주제로 소희가 먼저 물어볼게요.</p> : <p className="text-xs text-muted-foreground">고르지 않으면 소희가 처음부터 하나씩 물어봐요.</p>}
        </div>
      ) : null}

      {!onSelectionChange && mode ? (
        <div className="sticky bottom-0 -mx-1 bg-gradient-to-t from-background via-background to-transparent px-1 pb-2 pt-3"
          style={{ bottom: 'var(--conversation-scroll-clearance, 0px)' }}>
          <Button type="button" size="lg" disabled={disabled || !ready} className="min-h-12 w-full text-base font-semibold"
            onClick={() => onStart(currentPrompt)}>시작하기</Button>
        </div>
      ) : null}
    </section>
  )
}
