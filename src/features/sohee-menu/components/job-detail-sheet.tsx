import React from 'react'
import { Check, ArrowRight, Sparkles, Lock, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetClose,
} from '@/components/ui/sheet'
import { JOB_COPY } from '@/features/sohee-growth/job-copy'
import type { JobResult, TeachDestination } from '@/features/sohee-growth/types'
import { JOB_STATUS_CHIP } from './job-status-chip'

interface Props {
  job: JobResult | null
  onClose(): void
  onGoToTab(tab: TeachDestination): void
}

export function JobDetailSheet({ job, onClose, onGoToTab }: Props) {
  if (!job) {
    return (
      <Sheet open={false} onOpenChange={(open) => { if (!open) onClose() }}>
        {null}
      </Sheet>
    )
  }

  const copy = JOB_COPY[job.key]
  const chip = JOB_STATUS_CHIP[job.status]

  const handleGoToTeach = (destination: TeachDestination) => {
    onClose()
    onGoToTab(destination)
  }

  return (
    <Sheet open={true} onOpenChange={(open) => { if (!open) onClose() }}>
      <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader className="text-left space-y-2 pb-4 border-b">
          <div className="flex items-center justify-between gap-2">
            <Badge variant={chip.variant}>{chip.label}</Badge>
            <SheetClose className="rounded-sm opacity-70 hover:opacity-100 focus:outline-none">
              <X className="h-4 w-4" />
              <span className="sr-only">닫기</span>
            </SheetClose>
          </div>
          <SheetTitle className="text-xl font-bold">{job.label}</SheetTitle>
          <SheetDescription className="text-sm text-muted-foreground">
            {copy?.summary}
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-6 py-4">
          {/* 확인 방식 안내 */}
          <div className="rounded-xl border bg-card p-4 space-y-1">
            <h4 className="text-xs font-semibold text-muted-foreground">확인 방식</h4>
            <p className="text-sm font-medium">{copy?.approval}</p>
          </div>

          {/* 상태별 특별 안내 */}
          {job.status === 'membership' && (
            <div className="rounded-xl border border-secondary/40 bg-muted/40 p-4 flex items-start gap-3">
              <Lock className="size-4 mt-0.5 text-muted-foreground shrink-0" aria-hidden />
              <div className="space-y-1">
                <p className="text-sm font-semibold">정식회원 전용 업무예요</p>
                <p className="text-xs text-muted-foreground">정식회원이 되면 열려요</p>
              </div>
            </div>
          )}

          {job.status === 'coming_soon' && (
            <div className="rounded-xl border border-primary/30 bg-primary/10 p-4 flex items-start gap-3">
              <Sparkles className="size-4 mt-0.5 text-primary shrink-0" aria-hidden />
              <div className="space-y-1">
                <p className="text-sm font-semibold text-foreground">준비 중인 기능이에요</p>
                <p className="text-xs text-primary">곧 열려요</p>
              </div>
            </div>
          )}

          {/* 필요한 요건 체크리스트 */}
          {job.needed.length > 0 && (
            <div className="space-y-3">
              <h4 className="text-sm font-bold">필요한 준비 사항</h4>
              <ul className="space-y-2">
                {job.needed.map((req) => (
                  <li
                    key={req.key}
                    className="flex items-center justify-between gap-3 p-3 rounded-lg border bg-background"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div
                        className={`size-5 rounded-full flex items-center justify-center shrink-0 ${
                          req.done
                            ? 'bg-state-ok-soft text-state-ok'
                            : 'bg-muted text-muted-foreground'
                        }`}
                      >
                        {req.done ? (
                          <Check className="size-3.5" aria-hidden />
                        ) : (
                          <span className="size-1.5 rounded-full bg-muted-foreground" aria-hidden />
                        )}
                      </div>
                      <span className={`text-sm ${req.done ? 'text-muted-foreground line-through' : 'font-medium'}`}>
                        {req.label}
                      </span>
                    </div>

                    {!req.done && (
                      <button
                        type="button"
                        onClick={() => handleGoToTeach(req.destination)}
                        className="inline-flex items-center gap-1 shrink-0 px-2.5 py-1.5 text-xs font-semibold rounded-md border bg-background hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <span>가르치러 가기</span>
                        <ArrowRight className="size-3" aria-hidden />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
