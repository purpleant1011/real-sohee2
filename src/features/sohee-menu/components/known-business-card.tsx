import { Lightbulb } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { cn } from '@/lib/utils'
import type { CategoryScore, NextStep } from '@/features/sohee-growth/types'

export function KnownBusinessCard({ categories, nextStep }: { categories: CategoryScore[]; nextStep: NextStep | null }) {
  return (
    <Card className="space-y-4 rounded-[20px] p-6">
      <h2 className="text-lg font-bold">소희가 아는 우리 가게</h2>
      <ul className="space-y-3">
        {categories.map((c) => (
          <li key={c.key} className="space-y-1.5">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium">{c.label}</span>
              <span className={cn('tabular-nums', c.percent === 100 ? 'font-bold text-state-ok' : 'text-muted-foreground')}>{`${c.percent}%`}</span>
            </div>
            <Progress value={c.percent} aria-label={`${c.label} 이해도`} />
          </li>
        ))}
      </ul>
      {nextStep && (
        <div className="flex items-start gap-2 rounded-xl bg-accent p-3">
          <Lightbulb className="mt-0.5 size-4 shrink-0 text-accent-foreground" aria-hidden />
          <div>
            <p className="text-xs font-semibold text-accent-foreground">다음으로 가르칠 것</p>
            <p className="text-sm font-bold">{nextStep.title}</p>
          </div>
        </div>
      )}
    </Card>
  )
}
