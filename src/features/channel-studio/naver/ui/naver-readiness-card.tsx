'use client'

import React from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { AlertCircle, AlertTriangle, CheckCircle2, HelpCircle } from 'lucide-react'
import type {
  ReadinessDimensionKey,
  ReadinessEvaluation,
} from '../editorial-readiness'

const DIMENSION_LABELS: Record<ReadinessDimensionKey, string> = {
  FACTUAL_SUPPORT: '사실 근거 지원',
  READER_QUESTION_COVERAGE: '독자 질문 반영',
  UNIQUENESS_AND_NOVELTY: '독창성 및 차별성',
  READABILITY: '가독성 및 문단 구조',
  IMAGE_RIGHTS_AND_CTA: '이미지 권리 및 안내(CTA)',
}

export interface NaverReadinessCardProps {
  evaluation: ReadinessEvaluation | null
  className?: string
}

export function NaverReadinessCard({ evaluation, className }: NaverReadinessCardProps) {
  if (!evaluation) {
    return null
  }

  const hasHardStops = evaluation.hardStops.length > 0
  const isComplete = evaluation.totalIfComplete !== null && !hasHardStops
  const actionableFixes = evaluation.actionableFixes.slice(0, 3)

  return (
    <Card className={className} aria-label="소희 콘텐츠 준비도(자체 진단)">
      <CardHeader className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <Badge variant="outline" className="text-xs">
            실험적 진단
          </Badge>
          <span className="text-xs text-muted-foreground">
            루브릭 v{evaluation.rubricVersion}
          </span>
        </div>
        <CardTitle role="heading" aria-level={2} className="text-base font-semibold leading-snug">
          소희 콘텐츠 준비도(자체 진단)
        </CardTitle>
        <CardDescription className="text-xs text-muted-foreground">
          {evaluation.disclaimer}
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* 하드스톱 알림: 점수보다 먼저 표시 */}
        {hasHardStops && (
          <div
            className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 space-y-2"
            role="alert"
          >
            <div className="flex items-center gap-2 text-destructive font-medium text-sm">
              <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>게시 준비 불가/확인 필요</span>
            </div>
            <ul className="list-disc pl-5 text-xs text-destructive/90 space-y-1">
              {evaluation.hardStops.map((stop, index) => (
                <li key={index}>{stop.message}</li>
              ))}
            </ul>
          </div>
        )}

        {/* 종합 점수 또는 미완료 안내 */}
        <div className="rounded-lg border bg-muted/30 p-3 min-h-11 flex items-center justify-between">
          <div className="space-y-0.5">
            <span className="text-xs font-medium text-muted-foreground">종합 진단</span>
            <div className="text-sm font-semibold">
              {hasHardStops ? (
                <span className="text-destructive">확인 필요 (게시 보류 권장)</span>
              ) : isComplete ? (
                <span className="text-primary">{evaluation.totalIfComplete}점</span>
              ) : (
                <span className="text-muted-foreground">아직 확인이 필요한 항목이 있어요</span>
              )}
            </div>
          </div>
          <div>
            {hasHardStops ? (
              <Badge variant="destructive">보류 필요</Badge>
            ) : isComplete ? (
              <Badge variant="secondary" className="gap-1">
                <CheckCircle2 className="h-3 w-3 text-primary" aria-hidden="true" />
                진단 완료
              </Badge>
            ) : (
              <Badge variant="outline" className="gap-1">
                <HelpCircle className="h-3 w-3 text-muted-foreground" aria-hidden="true" />
                추가 확인
              </Badge>
            )}
          </div>
        </div>

        {/* 5개 축별 상태 및 점수 */}
        <div className="space-y-2">
          <span className="text-xs font-medium text-muted-foreground">항목별 평가 현황</span>
          <div className="space-y-1.5">
            {evaluation.dimensions.map((dim) => {
              const label = DIMENSION_LABELS[dim.key] ?? dim.key
              return (
                <div
                  key={dim.key}
                  className="flex items-center justify-between text-xs py-1.5 border-b last:border-b-0 min-h-9"
                >
                  <span className="font-medium text-foreground">{label}</span>
                  <div className="flex items-center gap-1.5">
                    {dim.status === 'NOT_ASSESSED' ? (
                      <Badge variant="outline" className="text-[11px] font-normal py-0 text-muted-foreground">
                        미평가
                      </Badge>
                    ) : dim.status === 'BLOCKED' ? (
                      <Badge variant="destructive" className="text-[11px] font-normal py-0">
                        확인 필요
                      </Badge>
                    ) : (
                      <span className="font-semibold tabular-nums text-foreground">
                        {dim.rawScore} / {dim.maxScore}점
                      </span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* 고치면 좋은 점 최대 3개 */}
        {actionableFixes.length > 0 && (
          <div className="rounded-lg border border-border/60 bg-background/50 p-3 space-y-1.5">
            <div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
              <AlertTriangle className="h-3.5 w-3.5 text-muted-foreground shrink-0" aria-hidden="true" />
              <span>개선 권장 사항 (최대 3개)</span>
            </div>
            <ul className="list-disc pl-4 text-xs text-muted-foreground space-y-1">
              {actionableFixes.map((fix, idx) => (
                <li key={idx} className="leading-relaxed">
                  {fix}
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
