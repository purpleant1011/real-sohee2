import React from 'react'
import type { MissionStage } from '@/features/agent-os/workboard-types'
import { cn } from '@/lib/utils'
import { Check, ChevronRight } from 'lucide-react'

interface MissionStageRailProps {
  currentStage: MissionStage
  stageProgress: number
  className?: string
}

const STAGES: Array<{ id: MissionStage; label: string }> = [
  { id: 'DETECT', label: '1. 감지' },
  { id: 'PLAN', label: '2. 계획' },
  { id: 'CREATE_OR_EXECUTE', label: '3. 제작/실행' },
  { id: 'VERIFY', label: '4. 외부검증' },
  { id: 'ATTRIBUTE', label: '5. 성과반영' },
]

export function MissionStageRail({ currentStage, stageProgress, className }: MissionStageRailProps) {
  const currentIndex = STAGES.findIndex((s) => s.id === currentStage)

  return (
    <div className={cn('space-y-2', className)}>
      <div className="flex items-center justify-between gap-1 overflow-x-auto py-1">
        {STAGES.map((stage, idx) => {
          const isCompleted = idx < currentIndex
          const isCurrent = idx === currentIndex
          const isUpcoming = idx > currentIndex

          return (
            <React.Fragment key={stage.id}>
              <div
                className={cn(
                  'flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors',
                  isCompleted && 'bg-state-ok-soft text-state-ok font-bold',
                  isCurrent && 'bg-primary/10 text-primary font-extrabold ring-1 ring-primary/50',
                  isUpcoming && 'text-zinc-400 dark:text-zinc-500 font-medium'
                )}
              >
                {isCompleted ? (
                  <Check className="w-3.5 h-3.5 text-state-ok stroke-[2.5]" />
                ) : (
                  <span
                    className={cn(
                      'w-1.5 h-1.5 rounded-full',
                      isCurrent ? 'bg-primary animate-pulse' : 'bg-zinc-300 dark:bg-zinc-600'
                    )}
                  />
                )}
                <span>{stage.label}</span>
              </div>
              {idx < STAGES.length - 1 && (
                <ChevronRight className="w-3.5 h-3.5 text-zinc-300 dark:text-zinc-700 shrink-0" />
              )}
            </React.Fragment>
          )
        })}
      </div>

      {/* Stage Progress Bar */}
      <div className="w-full bg-zinc-100 dark:bg-zinc-800 h-1.5 rounded-full overflow-hidden">
        <div
          className="bg-gradient-to-r from-primary to-state-wait h-full rounded-full transition-all duration-500"
          style={{ width: `${Math.min(100, Math.max(0, stageProgress))}%` }}
        />
      </div>
    </div>
  )
}
