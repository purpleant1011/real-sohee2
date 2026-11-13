'use client'

import { useState } from 'react'
import { PhoneCall, Sparkles, Check, BellOff } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'

export interface BusyModeSwitchProps {
  onToggle?: (isBusy: boolean) => void
}

export function BusyModeSwitch({ onToggle }: BusyModeSwitchProps) {
  const [isBusy, setIsBusy] = useState(false)

  const handleToggle = () => {
    const next = !isBusy
    setIsBusy(next)
    onToggle?.(next)
    if (next) {
      toast.success('시술 집중 모드가 켜졌어요! 💆 전화가 오면 소희가 대신 상담하고 예약 장부에 넣어둘게요.')
    } else {
      toast.info('시술 집중 모드가 해제되었습니다.')
    }
  }

  return (
    <button
      type="button"
      onClick={handleToggle}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-semibold transition-all ${
        isBusy
          ? 'bg-state-warn-soft text-state-warn border-state-warn/30 shadow-xs ring-2 ring-state-warn/20'
          : 'bg-muted/60 text-muted-foreground border-border hover:text-foreground'
      }`}
    >
      {isBusy ? (
        <>
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-state-warn/60 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-state-warn" />
          </span>
          <PhoneCall className="w-3.5 h-3.5 text-state-warn animate-pulse" />
          <span>시술 집중 모드 가동 중 (AI 전화 응대)</span>
        </>
      ) : (
        <>
          <BellOff className="w-3.5 h-3.5" />
          <span>💆 시술 집중 모드</span>
        </>
      )}
    </button>
  )
}
