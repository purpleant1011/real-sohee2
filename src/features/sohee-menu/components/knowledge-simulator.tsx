'use client'

import React, { useState } from 'react'
import Image from 'next/image'
import { Lightbulb, Loader2, Send, Sparkles } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'

export interface KnowledgeSimulatorProps {
  workspaceId: string
}

export interface MatchedFact {
  id: string
  category: string
  content: string
}

export interface SimulationResult {
  answer: string
  usedFacts: MatchedFact[]
  hasLearnedKnowledge: boolean
}

interface QuickChip {
  icon: string
  label: string
  query: string
  type: 'faq' | 'marketing'
}

const QUICK_CHIPS: QuickChip[] = [
  {
    icon: '🚗',
    label: '손님이 주차 문의하면?',
    query: '손님이 주차 문의하면?',
    type: 'faq',
  },
  {
    icon: '🥩',
    label: '대표 메뉴 가격이랑 특징 알려줘',
    query: '대표 메뉴 가격이랑 특징 알려줘',
    type: 'marketing',
  },
  {
    icon: '📸',
    label: '우리 가게로 인스타 첫 문장 써봐',
    query: '우리 가게로 인스타 첫 문장 써봐',
    type: 'marketing',
  },
  {
    icon: '📅',
    label: '예약 가능한지 물어보면?',
    query: '예약 가능한지 물어보면?',
    type: 'faq',
  },
]

export function KnowledgeSimulator({ workspaceId }: KnowledgeSimulatorProps) {
  const [query, setQuery] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [result, setResult] = useState<SimulationResult | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const runSimulation = async (question: string, type?: 'faq' | 'marketing') => {
    const trimmed = question.trim()
    if (!trimmed || isLoading) return

    setIsLoading(true)
    setErrorMessage(null)

    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/knowledge/simulate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: trimmed,
          ...(type ? { type } : {}),
        }),
      })

      const data = await res.json()

      if (!res.ok || !data.success) {
        setErrorMessage(
          data?.message || '지식 시뮬레이션 응답을 생성하지 못했습니다. 잠시 후 다시 시도해 주세요.',
        )
        return
      }

      setResult(data.data)
    } catch {
      setErrorMessage('지식 시뮬레이션 응답을 생성하지 못했습니다. 잠시 후 다시 시도해 주세요.')
    } finally {
      setIsLoading(false)
    }
  }

  const handleChipClick = (chip: QuickChip) => {
    setQuery(chip.query)
    runSimulation(chip.query, chip.type)
  }

  const handleSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault()
    runSimulation(query)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      runSimulation(query)
    }
  }

  return (
    <Card className="p-5 bg-card/70 border-border/80 shadow-xs space-y-4">
      {/* 1. 헤더 */}
      <div className="flex items-start gap-3">
        <div className="relative shrink-0">
          <Image
            src="/brand/sohee-character-v1.png"
            alt="소희"
            width={48}
            height={48}
            className="rounded-full bg-primary/10 object-cover border border-border"
          />
          <div className="absolute -bottom-1 -right-1 bg-state-warn text-state-warn-soft rounded-full p-0.5 shadow-xs">
            <Sparkles className="w-3 h-3" />
          </div>
        </div>
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-base text-foreground tracking-tight">
              소희 지식 테스트 벤치
            </h3>
            <Badge variant="outline" className="text-[11px] font-normal border-primary/30 text-primary">
              실시간 모의 응대
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground leading-normal">
            가르친 지식을 바탕으로 손님 응대와 홍보 글 작성을 어떻게 하는지 미리 테스트해 보세요
          </p>
        </div>
      </div>

      {/* 2. 빠른 테스트 칩 */}
      <div className="space-y-1.5">
        <span className="text-[11px] font-medium text-muted-foreground">빠른 질문 예시</span>
        <div className="flex flex-wrap gap-1.5">
          {QUICK_CHIPS.map((chip) => (
            <button
              key={chip.label}
              type="button"
              disabled={isLoading}
              onClick={() => handleChipClick(chip)}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-full border border-border/70 bg-background hover:bg-accent hover:text-accent-foreground text-foreground transition-colors disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
            >
              <span>{chip.icon}</span>
              <span>{chip.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* 3. 직접 질문 입력창 */}
      <form onSubmit={handleSubmit} className="flex gap-2">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="소희에게 매장에 대해 궁금한 점을 물어보세요 (예: 주차 돼?)"
          disabled={isLoading}
          className="text-xs h-9 bg-background focus-visible:ring-state-wait"
        />
        <Button
          type="submit"
          size="sm"
          disabled={isLoading || !query.trim()}
          className="h-9 px-3 shrink-0 gap-1.5 bg-state-wait hover:bg-state-wait/90 text-state-wait-soft"
        >
          {isLoading ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Send className="w-3.5 h-3.5" />
          )}
          <span>물어보기</span>
        </Button>
      </form>

      {/* 4. 로딩 중 표시 */}
      {isLoading && (
        <div className="flex items-center gap-2 p-3 rounded-lg border border-state-wait/20 bg-state-wait-soft text-xs text-state-wait">
          <Loader2 className="w-4 h-4 animate-spin shrink-0 text-state-wait" />
          <span>소희가 배운 지식을 찾는 중이에요...</span>
        </div>
      )}

      {/* 5. 에러 메시지 */}
      {errorMessage && (
        <div className="p-3 rounded-lg border border-state-danger/30 bg-state-danger-soft text-xs text-state-danger">
          {errorMessage}
        </div>
      )}

      {/* 6. 답변 결과 카드 (말풍선) */}
      {result && !isLoading && (
        <div className="rounded-xl border border-state-wait/30 bg-gradient-to-br from-state-wait-soft via-background to-primary/10 p-4 space-y-3 shadow-xs">
          <div className="flex items-center justify-between">
            <Badge className="bg-state-wait hover:bg-state-wait/90 text-state-wait-soft text-[11px] px-2 py-0.5">
              소희의 답변
            </Badge>
            <span className="text-[11px] text-muted-foreground">
              {result.hasLearnedKnowledge ? '배운 지식 기반' : '기본 지식 기반'}
            </span>
          </div>

          <div className="whitespace-pre-line leading-relaxed text-sm text-foreground">
            {result.answer}
          </div>

          {/* 근거 팩트 표시 */}
          {result.usedFacts && result.usedFacts.length > 0 && (
            <div className="mt-3 pt-3 border-t border-state-wait/20 space-y-1.5">
              <div className="flex items-center gap-1 text-xs font-medium text-foreground">
                <Lightbulb className="w-3.5 h-3.5 text-state-warn" />
                <span>소희가 참고한 지식:</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {result.usedFacts.map((fact) => (
                  <Badge
                    key={fact.id}
                    variant="outline"
                    className="text-xs font-normal bg-background/80 border-state-wait/30 text-foreground"
                  >
                    {fact.content}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {/* 배운 지식이 없을 때 가르치기 추천 안내 */}
          {!result.hasLearnedKnowledge && (
            <div className="mt-3 rounded-lg border border-state-warn/30 bg-state-warn-soft p-3 text-xs text-state-warn">
              아직 소희에게 가르친 지식이 없어요. 인터뷰를 통해 매장 지식을 알려주시면 더 정확하게 답변할 수 있어요.
            </div>
          )}
        </div>
      )}
    </Card>
  )
}
