'use client'

import { MessageSquare, Sparkles } from 'lucide-react'

export function MissionConversationContinuation({ onContinue }: { onContinue: () => void }) {
  return <section aria-label="소희와 대화하기" className="flex flex-col gap-4 rounded-3xl border border-border bg-card p-6 shadow-xs">
    <div className="flex items-center gap-2">
      <Sparkles className="size-4 text-primary" aria-hidden="true" />
      <h2 className="text-sm font-bold text-foreground">이 업무의 대화 이어가기</h2>
    </div>
    <p className="text-sm leading-relaxed text-muted-foreground">
      원래 대화에서 지시와 작업 기록을 이어서 확인해요.
    </p>
    <div>
      <button type="button" onClick={onContinue} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-bold text-primary-foreground shadow-xs hover:bg-primary/90 cursor-pointer">
        <MessageSquare className="size-4" aria-hidden="true" />
        대화 이어가기
      </button>
    </div>
  </section>
}
