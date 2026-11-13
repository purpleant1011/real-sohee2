import type { ReactNode } from 'react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import type { ChannelType, SpecEvaluationResult } from '@/features/vault/channel-spec'
import { SpecCheckPanel } from '@/features/vault/ui/spec-check'
import { cn } from '@/lib/utils'

const channelNames: Record<ChannelType, string> = {
  instagram: '인스타그램',
  threads: '스레드',
  naver_blog: '네이버 블로그',
  daangn_business: '당근 비즈니스',
}

/** The frame receives only presentation-ready children; internal identifiers never become attributes or copy. */
export function PreviewFrame({ channel, children, specResult, status = 'ready', className, contextLabel }: Readonly<{
  channel: ChannelType
  children?: ReactNode
  specResult?: SpecEvaluationResult
  status?: 'ready' | 'coming_soon'
  className?: string
  /** 한 화면에 같은 채널 미리보기가 여러 번 나올 때만 넘긴다. 이름이 겹치지 않게 앞에 붙는다. */
  contextLabel?: string
}>) {
  return (
    <Card
      role="region"
      aria-label={`${contextLabel ? `${contextLabel} · ` : ''}${channelNames[channel]} 예상 화면`}
      className={cn('w-full min-w-0 max-w-[720px] gap-0 overflow-hidden py-0 text-card-foreground', className)}
    >
      <CardHeader className="min-w-0 gap-2 border-b px-4 py-4 sm:px-6">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <CardTitle className="min-w-0 break-words text-base">{channelNames[channel]}</CardTitle>
          <Badge variant="outline" className="border-border bg-card text-card-foreground">예상 화면</Badge>
        </div>
        <CardDescription className="break-words text-foreground">실제 게시 화면과 다를 수 있어요.</CardDescription>
      </CardHeader>
      <CardContent className="min-w-0 px-0">
        {status === 'coming_soon' ? (
          <p role="status" className="px-4 py-8 text-center text-foreground sm:px-6">준비 중</p>
        ) : children}
      </CardContent>
      {specResult && specResult.checks.some((check) => check.status !== 'PASS') ? (
        <div className="min-w-0 border-t px-4 py-3 sm:px-6">
          <SpecCheckPanel result={specResult} channel={channel} />
        </div>
      ) : null}
    </Card>
  )
}
