import { cn } from '@/lib/utils'
import type { LadderStep } from '@/features/sohee-growth/types'

export function LevelLadder({ ladder }: { ladder: LadderStep[] }) {
  return (
    <ol aria-label="소희 성장 단계" className="flex items-start justify-between gap-2">
      {ladder.map((step, index) => (
        <li
          key={step.level}
          aria-current={step.state === 'current' ? 'step' : undefined}
          className="relative flex flex-1 flex-col items-center gap-1.5 text-center"
        >
          {index > 0 && (
            <span
              aria-hidden
              className={cn('absolute left-[-50%] top-[7px] h-0.5 w-full', step.state === 'upcoming' ? 'bg-border' : 'bg-primary')}
            />
          )}
          <span
            aria-hidden
            className={cn(
              'relative z-10 grid place-items-center rounded-full border-2',
              step.state === 'current' ? 'size-4 border-primary bg-primary ring-4 ring-primary/20' : '',
              step.state === 'done' ? 'size-3.5 border-primary bg-primary' : '',
              step.state === 'upcoming' ? 'size-3.5 border-border bg-card' : '',
            )}
          />
          <span className={cn('text-xs', step.state === 'current' ? 'font-bold text-foreground' : 'text-muted-foreground')}>
            {step.name}
            {step.soon ? '(준비 중)' : ''}
          </span>
        </li>
      ))}
    </ol>
  )
}
