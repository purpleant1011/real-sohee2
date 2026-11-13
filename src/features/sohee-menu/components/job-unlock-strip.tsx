'use client'

import React, { useState } from 'react'
import { CalendarCheck, Lock, MessageCircle, MessageSquareText, PenLine, Send, ShoppingBag, Sparkles } from 'lucide-react'
import type { ComponentType } from 'react'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type { JobKey, JobResult, JobStatus, TeachDestination } from '@/features/sohee-growth/types'
import { JOB_STATUS_CHIP } from './job-status-chip'
import { JobDetailSheet } from './job-detail-sheet'

const ICONS: Record<JobKey, ComponentType<{ className?: string }>> = {
  post_social: Send,
  reply_comments: MessageCircle,
  write_blog: PenLine,
  write_daangn: ShoppingBag,
  booking_guide: CalendarCheck,
  kakao_1on1: MessageSquareText,
}

/** 누르면 가르칠 곳으로 갈 수 있는 상태 */
const ACTIONABLE: ReadonlySet<JobStatus> = new Set<JobStatus>(['learning', 'locked'])

interface Props {
  jobs: JobResult[]
  onGoToTab: (tab: TeachDestination) => void
}

export function JobUnlockStrip({ jobs, onGoToTab }: Props) {
  const [selectedJob, setSelectedJob] = useState<JobResult | null>(null)

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-lg font-bold">소희가 할 수 있는 일</h2>
        <p className="text-sm text-muted-foreground">가르칠수록 더 많은 일을 맡을 수 있어요</p>
      </div>
      <ul aria-label="소희가 할 수 있는 일" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        {jobs.map((job) => {
          const Icon = ICONS[job.key]
          const chip = JOB_STATUS_CHIP[job.status]
          const muted = job.status === 'locked' || job.status === 'membership' || job.status === 'coming_soon'
          const destination = job.missing[0]?.destination
          const actionable = ACTIONABLE.has(job.status) && destination
          return (
            <li
              key={job.key}
              className={cn(
                'flex flex-col gap-2 rounded-2xl border bg-card p-4',
                muted && 'border-dashed bg-muted/40 text-muted-foreground',
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <Icon className="size-5" aria-hidden />
                <Badge variant={chip.variant}>{chip.label}</Badge>
              </div>
              <p className={cn('text-sm font-bold', !muted && 'text-foreground')}>{job.label}</p>
              <p className="flex items-center gap-1 text-xs text-muted-foreground">
                {job.status === 'locked' && <Lock className="size-3" aria-hidden />}
                {job.status === 'coming_soon' && <Sparkles className="size-3" aria-hidden />}
                <span>{job.note}</span>
              </p>
              <div className="mt-auto flex flex-col gap-1.5 pt-2">
                {actionable && (
                  <button
                    type="button"
                    className="min-h-[44px] rounded-lg border bg-background px-3 text-xs font-semibold hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={() => onGoToTab(destination!)}
                  >
                    이것만 가르치면 열려요
                  </button>
                )}
                <button
                  type="button"
                  className="min-h-[36px] rounded-lg px-2 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => setSelectedJob(job)}
                >
                  자세히 보기
                </button>
              </div>
            </li>
          )
        })}
      </ul>

      <JobDetailSheet
        job={selectedJob}
        onClose={() => setSelectedJob(null)}
        onGoToTab={(tab) => {
          setSelectedJob(null)
          onGoToTab(tab)
        }}
      />
    </section>
  )
}
