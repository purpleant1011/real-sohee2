import Image from 'next/image'
import type { ReactNode } from 'react'
import { Sparkles } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import type { GrowthSnapshot, MembershipTierKey, TeachDestination } from '@/features/sohee-growth/types'

const TIER_BADGE: Record<MembershipTierKey, { label: string; variant: 'success' | 'warning' | 'secondary' | 'destructive' }> = {
  FORMAL: { label: '정식회원', variant: 'success' },
  PENDING_REVIEW: { label: '승인 대기 · 체험회원', variant: 'warning' },
  TRIAL: { label: '체험회원', variant: 'secondary' },
  REJECTED: { label: '인증 다시 신청 필요', variant: 'destructive' },
}

interface Props {
  snapshot: GrowthSnapshot
  onGoToTab: (tab: TeachDestination) => void
  children?: ReactNode
}

export function GrowthCard({ snapshot, onGoToTab, children }: Props) {
  const { level, completenessPercent, counts, tier, nextStep } = snapshot
  const badge = TIER_BADGE[tier]

  return (
    <Card className="rounded-[20px] p-6">
      <div className="grid gap-6 lg:grid-cols-[1fr_340px] lg:items-center">
        <div className="flex items-center gap-5">
          <div className="relative size-24 shrink-0 overflow-hidden rounded-3xl bg-accent ring-4 ring-primary/20">
            <Image src="/brand/sohee-character-v1.png" alt="소희" width={96} height={96} className="size-full object-cover" priority />
            <span aria-hidden className="absolute bottom-1.5 right-1.5 size-3.5 rounded-full bg-state-ok ring-2 ring-card" />
          </div>
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xl font-extrabold tracking-tight">소희</span>
              <Badge variant="purple">{`Lv.${level.level} ${level.name}`}</Badge>
              <Badge variant={badge.variant}>{badge.label}</Badge>
            </div>
            <p className="text-lg font-bold">{`소희가 우리 가게를 ${completenessPercent}% 이해했어요`}</p>
            <Progress value={completenessPercent} aria-label="소희의 이해도" />
            <p className="text-sm text-muted-foreground">{`가르친 지식 ${counts.facts}개 · 자료 ${counts.sources}개`}</p>
          </div>
        </div>

        <div className="rounded-2xl bg-accent p-4">
          {nextStep ? (
            <div className="space-y-3">
              <p className="flex items-center gap-1.5 text-xs font-semibold text-accent-foreground">
                <Sparkles className="size-3.5" aria-hidden /> 다음으로 가르칠 것
              </p>
              <p className="text-base font-bold">{nextStep.title}</p>
              <Button type="button" className="h-11 w-full" onClick={() => onGoToTab(nextStep.destination)}>
                가르치러 가기
              </Button>
            </div>
          ) : (
            <div className="space-y-1">
              <p className="text-base font-bold">기본 교육을 모두 마쳤어요</p>
              <p className="text-sm text-muted-foreground">자료와 질문을 더 알려줄수록 소희가 더 잘 일해요.</p>
            </div>
          )}
        </div>
      </div>
      {children && <div className="mt-4">{children}</div>}
    </Card>
  )
}
