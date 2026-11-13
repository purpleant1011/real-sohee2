'use client'

import React, { useEffect, useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { Check, Copy, ExternalLink, Sparkles } from 'lucide-react'
import { Dialog } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import type { FactItem } from '@/features/sohee-knowledge/types'

export interface FactToPostModalProps {
  isOpen: boolean
  onClose: () => void
  fact: FactItem | null
  businessName?: string
}

export type ToneType = 'friendly' | 'trendy' | 'expert'

interface ToneOption {
  key: ToneType
  label: string
}

const TONE_OPTIONS: ToneOption[] = [
  { key: 'friendly', label: '친근하고 다정하게' },
  { key: 'trendy', label: '트렌디하고 감성 있게' },
  { key: 'expert', label: '전문적이고 신뢰감 있게' },
]

export function generatePostCopy(tone: ToneType, factContent: string, _businessName?: string): string {
  switch (tone) {
    case 'friendly':
      return `안녕하세요 이웃님들! 오늘은 저희 매장의 자랑 ${factContent} 소식을 전해드려요... 오늘도 행복한 하루 보내세요 💖 #맛집 #일상`
    case 'trendy':
      return `햇살 가득한 오후, 놓치면 아쉬운 ${factContent} ✨ 피드 저장해두고 이번 주말에 꼭 들러보세요! #핫플 #감성`
    case 'expert':
      return `정성과 기본에 충실한 ${factContent}을 소개합니다. 언제나 최상의 만족을 드리기 위해 꼼꼼하게 준비하고 있습니다. #전문점 #예약문의`
  }
}

export function FactToPostModal({
  isOpen,
  onClose,
  fact,
  businessName,
}: FactToPostModalProps) {
  const [activeTone, setActiveTone] = useState<ToneType>('friendly')
  const [copyText, setCopyText] = useState('')
  const [isCopied, setIsCopied] = useState(false)

  useEffect(() => {
    if (fact) {
      setCopyText(generatePostCopy(activeTone, fact.content, businessName))
    }
  }, [activeTone, fact, businessName])

  if (!isOpen || !fact) {
    return null
  }

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(copyText)
      setIsCopied(true)
      setTimeout(() => {
        setIsCopied(false)
      }, 2000)
    } catch {
      // 클립보드 실패 시 폴백
      setIsCopied(false)
    }
  }

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => !open && onClose()}
      title="소희가 쓴 마케팅 글 초안"
    >
      <div className="space-y-4 pt-1">
        {/* 소희 캐릭터 헤더 안내 */}
        <div className="flex items-center gap-3 p-3 bg-primary/10 rounded-2xl border border-primary/15">
          <div className="relative shrink-0">
            <Image
              src="/brand/sohee-character-v1.png"
              alt="소희"
              width={40}
              height={40}
              className="rounded-full bg-primary/10 object-cover border border-primary/30"
            />
            <div className="absolute -bottom-1 -right-1 bg-state-warn text-state-warn-soft rounded-full p-0.5 shadow-xs">
              <Sparkles className="size-2.5 text-state-warn-soft" />
            </div>
          </div>
          <div className="min-w-0">
            <h4 className="text-xs font-bold text-foreground">AI 카피라이터 소희</h4>
            <p className="text-xs text-muted-foreground leading-relaxed">
              선택하신 지식을 바탕으로 인스타·블로그 글을 미리 지어봤어요
            </p>
          </div>
        </div>

        {/* 상단: 선택한 원본 지식 팩트 카드 */}
        <div className="bg-muted/50 p-3 rounded-xl border text-xs space-y-1">
          <div className="flex items-center gap-1.5 text-muted-foreground font-semibold text-[11px]">
            <span>선택한 지식 팩트</span>
          </div>
          <p className="text-foreground leading-relaxed whitespace-pre-line font-medium">
            {fact.content}
          </p>
        </div>

        {/* 3가지 톤앤매너 탭 */}
        <div className="space-y-2">
          <div
            role="tablist"
            aria-label="홍보 카피 톤앤매너 선택"
            className="flex items-center gap-1.5 p-1 bg-muted/60 rounded-xl"
          >
            {TONE_OPTIONS.map((tone) => {
              const isSelected = activeTone === tone.key
              return (
                <button
                  key={tone.key}
                  type="button"
                  role="tab"
                  aria-selected={isSelected}
                  onClick={() => setActiveTone(tone.key)}
                  className={cn(
                    'flex-1 py-1.5 px-2 rounded-lg text-xs font-medium transition-all text-center cursor-pointer',
                    isSelected
                      ? 'bg-background text-foreground font-bold shadow-xs'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {tone.label}
                </button>
              )
            })}
          </div>

          {/* 소희 생성 카피 본문 영역 */}
          <div className="relative">
            <Textarea
              aria-label="소희가 제안한 홍보 카피 본문"
              value={copyText}
              onChange={(e) => setCopyText(e.target.value)}
              rows={5}
              className="resize-none text-xs leading-relaxed rounded-xl p-3 bg-card border-border font-normal"
            />
          </div>
        </div>

        {/* 하단 액션 버튼 */}
        <div className="pt-2 flex flex-col sm:flex-row items-center justify-between gap-2 border-t border-border/60">
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <Button
              type="button"
              variant={isCopied ? 'secondary' : 'default'}
              size="sm"
              onClick={handleCopy}
              className="rounded-xl h-9 px-3.5 text-xs font-semibold gap-1.5 cursor-pointer w-full sm:w-auto"
            >
              {isCopied ? (
                <>
                  <Check className="size-3.5 text-state-ok" />
                  <span>복사 완료!</span>
                </>
              ) : (
                <>
                  <Copy className="size-3.5" />
                  <span>📋 본문 복사하기</span>
                </>
              )}
            </Button>

            <Link
              href="/app/content"
              className={cn(
                'inline-flex items-center justify-center rounded-xl h-9 px-3.5 text-xs font-semibold gap-1.5 transition-colors',
                'bg-primary text-primary-foreground hover:bg-primary/90 shadow-xs cursor-pointer w-full sm:w-auto text-center',
              )}
            >
              <span>🚀 4채널 콘텐츠 센터로 이동</span>
              <ExternalLink className="size-3" />
            </Link>
          </div>

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onClose}
            className="rounded-xl h-9 px-4 text-xs font-medium cursor-pointer w-full sm:w-auto"
          >
            닫기
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
