'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { MobileR2Provider } from '@/features/mobile-shell/r2-gate'
import { FactsQuestionView } from '@/features/mobile-firstpost/facts-question-view'
import type { FactField } from '@/features/mobile-firstpost/facts'

const SAMPLE_PRESETS: Record<string, Partial<Record<FactField, string>>> = {
  empty: {},
  with_memory: {
    price: '아메리카노 4,500원 (예시)',
  },
  full_sample: {
    price: '아메리카노 4,500원 (예시)',
    menu: '시그니처 라떼 (예시)',
    hours: '매일 10:00 - 20:00 (예시)',
    eventPeriod: '10월 한 달간 (예시)',
    contact: '02-000-0000 (예시)',
  },
}

export function FactsQuestionHarness({
  r2Enabled,
  preset = 'empty',
}: Readonly<{
  r2Enabled: boolean
  preset?: string
}>) {
  const [completedSummary, setCompletedSummary] = useState<Partial<Record<FactField, string>> | null>(null)
  const [resetKey, setResetKey] = useState(0)

  const initialMemory = SAMPLE_PRESETS[preset] ?? SAMPLE_PRESETS.empty

  const handleReset = () => {
    setCompletedSummary(null)
    setResetKey((k) => k + 1)
  }

  return (
    <MobileR2Provider enabled={r2Enabled}>
      <main className="min-h-dvh bg-muted/40 py-4">
        {/* 개발 전용 정직한 배너 */}
        <div className="mx-auto max-w-md px-4 pb-3">
          <div className="rounded-md border border-border bg-card p-3 text-xs text-muted-foreground space-y-1">
            <div className="flex items-center justify-between font-semibold text-foreground">
              <span>[개발 전용] M05 사실 확인 검수 하네스</span>
              <span className="rounded bg-muted px-1.5 py-0.5 text-[10px]">운영 404</span>
            </div>
            <p>예시 화면이에요 · 로컬 선택만 동작하며 서버 저장이나 외부 API 호출은 없어요</p>
          </div>
        </div>

        {/* 사실 확인 화면 또는 완료 요약 화면 */}
        {completedSummary ? (
          <div className="mx-auto max-w-md px-4 space-y-4">
            <section
              aria-label="로컬 확인 요약"
              className="rounded-lg border-2 border-primary/30 bg-card p-5 space-y-4"
            >
              <div className="space-y-1">
                <h2 className="text-base font-semibold text-primary">
                  로컬 확인 요약 (서버 실행 기능 없음)
                </h2>
                <p className="text-xs text-muted-foreground">
                  초안 생성·서버 API 요청·외부 게시 없이, 사용자가 확인한 로컬 값만 안전하게 수집되었습니다.
                </p>
              </div>

              <dl className="divide-y divide-border/50 text-sm">
                {Object.entries(completedSummary).map(([field, value]) => (
                  <div key={field} className="py-2 flex justify-between gap-3 text-xs">
                    <dt className="font-medium text-foreground">{field}</dt>
                    <dd className="text-muted-foreground text-right">{value}</dd>
                  </div>
                ))}
              </dl>

              <Button type="button" variant="outline" className="min-h-11 w-full" onClick={handleReset}>
                다시 테스트하기
              </Button>
            </section>
          </div>
        ) : (
          <FactsQuestionView
            key={resetKey}
            initialMemory={initialMemory}
            onComplete={(usableFacts) => setCompletedSummary(usableFacts)}
          />
        )}
      </main>
    </MobileR2Provider>
  )
}
