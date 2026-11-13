'use client'

import { useEffect, useState } from 'react'
import { Check, Loader2, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

const TOPIC_IDEAS = ['우리 가게 첫 인사', '이번 주 추천 메뉴·상품', '오픈 소식', '영업시간·위치 안내', '고객 감사 인사']
const STEPS = ['가게 정보 확인하기', '글과 사진 만들기', '미리보기 준비하기']

export function ComposerCard(props: { busy: boolean; onCreate: (topic: string) => void; autoFocus?: boolean }) {
  const [topic, setTopic] = useState('')
  const [stepIdx, setStepIdx] = useState(0)

  useEffect(() => {
    if (!props.busy) {
      setStepIdx(0)
      return
    }
    const timer = setInterval(() => setStepIdx((i) => Math.min(i + 1, STEPS.length - 1)), 7000)
    return () => clearInterval(timer)
  }, [props.busy])

  const submit = () => props.onCreate(topic.trim())

  return (
    <Card className="border-primary/20 bg-gradient-to-br from-accent/60 to-card">
      <CardContent className="space-y-4">
        <div className="flex items-center gap-2 font-semibold">
          <Sparkles className="size-4 text-primary" aria-hidden /> 소희에게 맡길 소식을 알려 주세요
        </div>
        {props.busy ? (
          <ol className="space-y-2.5 py-1" aria-live="polite">
            {STEPS.map((label, i) => (
              <li key={label} className={cn('flex items-center gap-2 text-sm', i > stepIdx && 'text-muted-foreground/60')}>
                {i < stepIdx ? (
                  <Check className="size-4 text-emerald-600" aria-hidden />
                ) : i === stepIdx ? (
                  <Loader2 className="size-4 animate-spin text-primary" aria-hidden />
                ) : (
                  <span className="size-4 rounded-full border" aria-hidden />
                )}
                {label}
              </li>
            ))}
            <li className="pt-1 text-xs text-muted-foreground">보통 20~40초 걸려요. 창을 닫지 말아 주세요.</li>
          </ol>
        ) : (
          <>
            <form
              className="flex flex-col gap-2 sm:flex-row"
              onSubmit={(e) => {
                e.preventDefault()
                submit()
              }}
            >
              <Input
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="예: 이번 주말 방문 추천 소식이나 신메뉴/시술을 소개하고 싶어요"
                aria-label="게시물 주제"
                maxLength={300}
                autoFocus={props.autoFocus}
                className="h-11 bg-background"
              />
              <Button type="submit" className="h-11 shrink-0 px-5">
                소희에게 맡기기
              </Button>
            </form>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground">추천 주제</span>
              {TOPIC_IDEAS.map((idea) => (
                <button
                  key={idea}
                  type="button"
                  onClick={() => props.onCreate(idea)}
                  className="rounded-full border bg-background px-3 py-1 text-xs hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {idea}
                </button>
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
