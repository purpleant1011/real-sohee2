'use client'

import React from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { CheckCircle2, Clock, AlertCircle, Info, ChevronDown } from 'lucide-react'
import type { BlogSearchObservation, SearchObservationStatus } from '../official-search-observation'

export interface NaverSearchObservationCardProps {
  observation: BlogSearchObservation | null
  className?: string
}

const STATUS_MESSAGES: Record<SearchObservationStatus, string> = {
  OBSERVED_IN_SAMPLE: '이 표본에서 내 글을 발견했어요',
  NOT_FOUND_IN_SAMPLE:
    '확인한 표본에서는 아직 발견하지 못했어요. 전체 검색에서 제외됐다는 뜻은 아니며, 게시 후 24시간 미만이면 반영을 기다릴 수 있어요',
  NOT_CONFIGURED: '검색 데이터를 아직 연결하지 않았어요. 글은 지금도 만들 수 있어요',
  RATE_LIMITED: '검색 조회 한도가 잠시 찼어요',
  UNAUTHORIZED: '네이버 검색 연동 인증 정보를 확인해 주세요',
  API_ERROR: '검색 데이터를 일시적으로 가져오지 못했어요',
  STALE: '이전 관측 결과예요',
}

const STATUS_BADGES: Record<
  SearchObservationStatus,
  { label: string; variant: 'secondary' | 'outline' | 'destructive' }
> = {
  OBSERVED_IN_SAMPLE: { label: '표본 내 발견', variant: 'secondary' },
  NOT_FOUND_IN_SAMPLE: { label: '표본 내 미발견', variant: 'outline' },
  NOT_CONFIGURED: { label: '미연결', variant: 'outline' },
  RATE_LIMITED: { label: '한도 도달', variant: 'outline' },
  UNAUTHORIZED: { label: '인증 필요', variant: 'destructive' },
  API_ERROR: { label: '조회 오류', variant: 'destructive' },
  STALE: { label: '이전 자료', variant: 'outline' },
}

export function NaverSearchObservationCard({
  observation,
  className,
}: NaverSearchObservationCardProps) {
  if (!observation) {
    return null
  }

  const status = observation.status
  const statusMessage = STATUS_MESSAGES[status] ?? '검색 현황을 확인 중이에요'
  const statusBadge = STATUS_BADGES[status] ?? { label: '확인 중', variant: 'outline' as const }
  const sortLabel = observation.sort === 'date' ? '최신순' : '관련도순'
  const timeString = observation.respondedAt || observation.requestedAt
  const formattedTime = timeString ? timeString.replace('T', ' ').slice(0, 19) : null

  return (
    <Card className={className} aria-label="내 글의 검색 발견 현황">
      <CardHeader className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <Badge variant={statusBadge.variant} className="text-xs">
            {statusBadge.label}
          </Badge>
          <span className="text-xs text-muted-foreground">공식 검색 결과 표본</span>
        </div>
        <CardTitle role="heading" aria-level={2} className="text-base font-semibold leading-snug">
          내 글의 검색 발견 현황
        </CardTitle>
        <CardDescription className="text-xs text-muted-foreground">
          네이버 공식 검색의 표본 검색 결과를 바탕으로 확인한 결과예요.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* 상태 메시지 배너 */}
        <div className="rounded-lg border bg-muted/30 p-3 min-h-11 flex items-start gap-2.5">
          {status === 'OBSERVED_IN_SAMPLE' ? (
            <CheckCircle2 className="h-5 w-5 text-primary shrink-0 mt-0.5" aria-hidden="true" />
          ) : status === 'NOT_FOUND_IN_SAMPLE' ? (
            <Clock className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" aria-hidden="true" />
          ) : (
            <AlertCircle className="h-5 w-5 text-destructive shrink-0 mt-0.5" aria-hidden="true" />
          )}
          <div className="space-y-1">
            <p className="text-xs font-medium text-foreground leading-relaxed">{statusMessage}</p>
            {observation.matchedSamplePosition !== null && (
              <p className="text-xs font-semibold text-primary">
                표본 내 {observation.matchedSamplePosition}번째 항목
              </p>
            )}
          </div>
        </div>

        {/* 관측 메타 정보 (검색어, 정렬, 표본 크기, 시각) */}
        <div className="grid grid-cols-2 gap-2 text-xs border rounded-lg p-3 bg-background/50">
          <div className="space-y-0.5">
            <span className="text-muted-foreground">검색어</span>
            <p className="font-medium text-foreground truncate">{observation.query || '지정 없음'}</p>
          </div>
          <div className="space-y-0.5">
            <span className="text-muted-foreground">정렬 기준</span>
            <p className="font-medium text-foreground">{sortLabel}</p>
          </div>
          <div className="space-y-0.5">
            <span className="text-muted-foreground">확인 표본 크기</span>
            <p className="font-medium text-foreground">
              {observation.sampleCount || observation.display}개
            </p>
          </div>
          <div className="space-y-0.5">
            <span className="text-muted-foreground">확인 시각</span>
            <p className="font-medium text-foreground truncate">{formattedTime ?? '미확인'}</p>
          </div>
        </div>

        {/* 표본 위치 접힘 상세 */}
        {observation.matchedSamplePosition !== null && observation.matchedCanonicalUrl && (
          <details className="group border rounded-lg p-2.5 text-xs text-muted-foreground">
            <summary className="cursor-pointer list-none flex items-center justify-between font-medium text-foreground min-h-8">
              <span>표본 내 발견 상세 정보</span>
              <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" aria-hidden="true" />
            </summary>
            <div className="pt-2 space-y-1 border-t mt-2 text-[11px]">
              <p>
                <span className="font-medium">확인 위치:</span> 표본 내{' '}
                {observation.matchedSamplePosition}번째 항목
              </p>
              <p className="truncate">
                <span className="font-medium">확인 주소:</span> {observation.matchedCanonicalUrl}
              </p>
            </div>
          </details>
        )}

        {/* 면책조항 (limitations) */}
        {observation.limitations.length > 0 && (
          <div className="rounded-md bg-muted/20 p-2.5 text-[11px] text-muted-foreground space-y-1">
            <div className="flex items-center gap-1 font-medium text-muted-foreground/90">
              <Info className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>관측 유의사항</span>
            </div>
            <ul className="list-disc pl-4 space-y-0.5">
              {observation.limitations.map((lim, index) => (
                <li key={index}>{lim}</li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
