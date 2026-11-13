import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Cpu, FileText, Image as ImageIcon, Sparkles } from 'lucide-react'
import type { CreditUsageDetail } from './types'

const operationLabels: Readonly<Record<CreditUsageDetail['operation'], string>> = {
  text_response: '텍스트 생성',
  image_generation: '이미지 생성',
  image_edit: '이미지 수정',
}

const operationIcons = {
  text_response: FileText,
  image_generation: ImageIcon,
  image_edit: Sparkles,
} as const

function format(value: number) {
  return value.toLocaleString('ko-KR')
}

export function CreditUsageDetailList({ entries }: Readonly<{
  entries: readonly CreditUsageDetail[]
}>) {
  return (
    <section aria-labelledby="credit-usage-detail-title" className="space-y-4">
      <div className="border-b pb-3">
        <h2 id="credit-usage-detail-title" className="text-lg font-bold tracking-tight text-foreground sm:text-xl">
          API 사용량
        </h2>
        <p className="mt-0.5 text-xs text-muted-foreground sm:text-sm">
          AI 모델 호출에 따른 실제 토큰 소비량과 작업 처리 상태를 확인합니다.
        </p>
      </div>

      {entries.length === 0 ? (
        <div className="rounded-xl border border-dashed p-8 text-center">
          <p className="text-sm text-muted-foreground">표시할 API 사용량이 없어요.</p>
        </div>
      ) : (
        <ol className="space-y-3">
          {entries.map((entry, index) => {
            const Icon = operationIcons[entry.operation] ?? Cpu
            const isActual = entry.usageSource === 'actual'

            return (
              <li key={`${entry.occurredAt}:${entry.operation}:${entry.policyVersion}:${index}`}>
                <Card className="p-4 transition-all hover:border-purple-500/40 hover:shadow-xs space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-2.5">
                    <div className="flex items-center gap-2">
                      <div className="rounded-lg bg-purple-500/10 p-2 text-purple-600 dark:text-purple-400">
                        <Icon className="size-4" aria-hidden />
                      </div>
                      <div>
                        <strong className="text-sm font-bold text-foreground">
                          {operationLabels[entry.operation]}
                        </strong>
                      </div>
                      <Badge
                        variant={isActual ? 'success' : 'outline'}
                        className={`text-[10px] font-medium ${
                          !isActual
                            ? 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300'
                            : ''
                        }`}
                      >
                        {isActual ? '실제 측정' : '추정 사용량'}
                      </Badge>
                    </div>

                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Badge variant="outline" className="text-[10px] font-mono">
                        정책 {entry.policyVersion}
                      </Badge>
                      <time dateTime={entry.occurredAt} className="font-mono text-[11px]">
                        {entry.occurredAt}
                      </time>
                    </div>
                  </div>

                  {/* 토큰 세부 정보 그리드 */}
                  <div className="rounded-lg bg-muted/30 p-2.5 space-y-1 text-xs text-muted-foreground">
                    <div className="font-semibold text-foreground text-[11px]">토큰 사용량</div>
                    <p>{`텍스트 입력 ${format(entry.textInputTokens)} · 캐시 입력 ${format(entry.cachedTextInputTokens)} · 텍스트 출력 ${format(entry.textOutputTokens)}`}</p>
                    <p>{`이미지 입력 ${format(entry.imageInputTokens)} · 이미지 출력 ${format(entry.imageOutputTokens)} · 전체 ${format(entry.providerTotalTokens)}`}</p>
                  </div>
                </Card>
              </li>
            )
          })}
        </ol>
      )}
    </section>
  )
}
