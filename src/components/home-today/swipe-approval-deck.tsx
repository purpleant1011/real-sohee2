'use client'

import { useState, useRef, useCallback } from 'react'
import {
  Check,
  X,
  Send,
  Calendar,
  Eye,
  Clock,
  Sparkles,
  ArrowRight,
  RotateCcw,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { playApprovalChime, playDismissSound } from './sound-effects'
import type { HomeApprovalItem } from '@/features/home/home-approval-types'

export interface SwipeApprovalDeckProps {
  items: HomeApprovalItem[]
  onApprove: (item: HomeApprovalItem) => Promise<boolean | void>
  onDismiss: (item: HomeApprovalItem) => Promise<boolean | void>
  onComplete?: () => void
}

export function SwipeApprovalDeck({
  items,
  onApprove,
  onDismiss,
  onComplete,
}: SwipeApprovalDeckProps) {
  const [currentIndex, setCurrentIndex] = useState(0)
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState(false)
  const [isAnimatingOut, setIsAnimatingOut] = useState<'left' | 'right' | null>(null)
  const [showPreview, setShowPreview] = useState(false)
  const startPos = useRef({ x: 0, y: 0 })

  const currentItem = items[currentIndex]
  const total = items.length

  const handleDragStart = (clientX: number, clientY: number) => {
    setIsDragging(true)
    startPos.current = { x: clientX, y: clientY }
  }

  const handleDragMove = (clientX: number, clientY: number) => {
    if (!isDragging) return
    const dx = clientX - startPos.current.x
    const dy = (clientY - startPos.current.y) * 0.3 // damped Y
    setDragOffset({ x: dx, y: dy })
  }

  const handleDragEnd = async () => {
    if (!isDragging) return
    setIsDragging(false)
    const threshold = 90

    if (dragOffset.x > threshold && currentItem) {
      // Swiped Right -> Approve
      playApprovalChime()
      setIsAnimatingOut('right')
      setTimeout(async () => {
        try {
          const success = await onApprove(currentItem)
          if (success !== false) {
            advance()
          } else {
            setIsAnimatingOut(null)
            setDragOffset({ x: 0, y: 0 })
          }
        } catch {
          setIsAnimatingOut(null)
          setDragOffset({ x: 0, y: 0 })
        }
      }, 200)
    } else if (dragOffset.x < -threshold && currentItem) {
      // Swiped Left -> Dismiss
      playDismissSound()
      setIsAnimatingOut('left')
      setTimeout(async () => {
        try {
          const success = await onDismiss(currentItem)
          if (success !== false) {
            advance()
          } else {
            setIsAnimatingOut(null)
            setDragOffset({ x: 0, y: 0 })
          }
        } catch {
          setIsAnimatingOut(null)
          setDragOffset({ x: 0, y: 0 })
        }
      }, 200)
    } else {
      // Reset
      setDragOffset({ x: 0, y: 0 })
    }
  }

  const advance = () => {
    setIsAnimatingOut(null)
    setDragOffset({ x: 0, y: 0 })
    setShowPreview(false)
    if (currentIndex + 1 >= total) {
      onComplete?.()
    } else {
      setCurrentIndex((prev) => prev + 1)
    }
  }

  const manualApprove = async () => {
    if (!currentItem) return
    playApprovalChime()
    setIsAnimatingOut('right')
    setTimeout(async () => {
      try {
        const success = await onApprove(currentItem)
        if (success !== false) {
          advance()
        } else {
          setIsAnimatingOut(null)
          setDragOffset({ x: 0, y: 0 })
        }
      } catch {
        setIsAnimatingOut(null)
        setDragOffset({ x: 0, y: 0 })
      }
    }, 200)
  }

  const manualDismiss = async () => {
    if (!currentItem) return
    playDismissSound()
    setIsAnimatingOut('left')
    setTimeout(async () => {
      try {
        const success = await onDismiss(currentItem)
        if (success !== false) {
          advance()
        } else {
          setIsAnimatingOut(null)
          setDragOffset({ x: 0, y: 0 })
        }
      } catch {
        setIsAnimatingOut(null)
        setDragOffset({ x: 0, y: 0 })
      }
    }, 200)
  }

  if (!currentItem || currentIndex >= total) {
    return (
      <div className="py-10 text-center space-y-2">
        <div className="w-12 h-12 rounded-full bg-state-ok-soft text-state-ok flex items-center justify-center mx-auto mb-2">
          <Check className="w-6 h-6" />
        </div>
        <p className="text-sm font-bold text-foreground">모든 카드를 확인했습니다! 🎉</p>
        <p className="text-xs text-muted-foreground">대기 중인 승인 항목이 모두 완료되었어요.</p>
      </div>
    )
  }

  const rotation = dragOffset.x * 0.08
  const rightOpacity = Math.min(1, Math.max(0, dragOffset.x / 70))
  const leftOpacity = Math.min(1, Math.max(0, -dragOffset.x / 70))

  let transformStyle = `translate3d(${dragOffset.x}px, ${dragOffset.y}px, 0) rotate(${rotation}deg)`
  if (isAnimatingOut === 'right') {
    transformStyle = 'translate3d(400px, 0, 0) rotate(25deg)'
  } else if (isAnimatingOut === 'left') {
    transformStyle = 'translate3d(-400px, 0, 0) rotate(-25deg)'
  }

  return (
    <div className="space-y-3 select-none">
      {/* Top Counter & Hint */}
      <div className="flex items-center justify-between text-xs text-muted-foreground px-1">
        <span className="font-semibold text-foreground">
          카드 {currentIndex + 1} / {total}
        </span>
        <span className="flex items-center gap-1.5 text-[11px]">
          <span>👈 보류</span> · <span>우측 스와이프 승인 👉</span>
        </span>
      </div>

      {/* Card Deck Viewport */}
      <div className="relative min-h-[300px] flex items-center justify-center overflow-hidden py-2">
        {/* Next Card Preview in Background */}
        {currentIndex + 1 < total && (
          <div className="absolute inset-x-2 top-4 bottom-0 rounded-2xl border border-border/40 bg-muted/30 scale-95 opacity-60 pointer-events-none" />
        )}

        {/* Active Draggable Card */}
        <div
          data-testid="swipe-active-card"
          style={{
            transform: transformStyle,
            transition: isDragging ? 'none' : 'transform 0.25s cubic-bezier(0.2, 0.9, 0.3, 1)',
          }}
          onMouseDown={(e) => handleDragStart(e.clientX, e.clientY)}
          onMouseMove={(e) => isDragging && handleDragMove(e.clientX, e.clientY)}
          onMouseUp={handleDragEnd}
          onMouseLeave={() => isDragging && handleDragEnd()}
          onTouchStart={(e) => {
            const touch = e.touches[0]
            if (touch) handleDragStart(touch.clientX, touch.clientY)
          }}
          onTouchMove={(e) => {
            const touch = e.touches[0]
            if (touch) handleDragMove(touch.clientX, touch.clientY)
          }}
          onTouchEnd={handleDragEnd}
          className="relative w-full rounded-2xl border border-border bg-card p-5 shadow-md cursor-grab active:cursor-grabbing space-y-3 z-10"
        >
          {/* Swipe Stamped Overlays */}
          {rightOpacity > 0.1 && (
            <div
              style={{ opacity: rightOpacity }}
              className="absolute top-4 right-4 z-20 px-3 py-1 rounded-lg border-2 border-state-ok text-state-ok bg-state-ok-soft/90 font-black text-sm tracking-wider uppercase rotate-12 shadow-sm"
            >
              승인 🚀
            </div>
          )}
          {leftOpacity > 0.1 && (
            <div
              style={{ opacity: leftOpacity }}
              className="absolute top-4 left-4 z-20 px-3 py-1 rounded-lg border-2 border-state-quiet text-state-quiet bg-state-quiet-soft/90 font-black text-sm tracking-wider uppercase -rotate-12 shadow-sm"
            >
              보류 ⏸️
            </div>
          )}

          {/* Header */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant="outline" className="text-xs font-bold">
                {currentItem.category === 'post_publish'
                  ? '포스팅 발행'
                  : currentItem.category === 'dm_reply'
                  ? 'DM 문의 답변'
                  : '댓글 답글'}
              </Badge>
              <span className="text-xs font-bold text-foreground">
                {currentItem.targetLabel}
              </span>
            </div>

            {currentItem.goldenTimeLabel ? (
              <span className="text-[11px] font-semibold text-primary bg-primary/10 px-2 py-0.5 rounded-md">
                {currentItem.goldenTimeLabel}
              </span>
            ) : currentItem.urgency ? (
              <span className="text-[11px] font-medium text-state-warn flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {currentItem.urgency}
              </span>
            ) : null}
          </div>

          {/* ROI Impact Badge */}
          {currentItem.roiImpact && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-primary/10 border border-primary/20 text-xs text-primary">
              <Sparkles className="w-3.5 h-3.5 text-primary shrink-0" />
              <span className="font-semibold">{currentItem.roiImpact.label}:</span>
              <span>{currentItem.roiImpact.value}</span>
            </div>
          )}

          {/* Content Body */}
          <div className="space-y-2 text-xs">
            {currentItem.sourceSnippet && (
              <p className="text-muted-foreground line-clamp-3">
                <span className="font-semibold text-foreground/85">원문:</span> {currentItem.sourceSnippet}
              </p>
            )}

            <div className="p-3 rounded-xl bg-muted/40 border border-border/40 text-foreground text-xs leading-relaxed">
              <span className="font-bold text-primary mr-1.5">
                소희 제안:
              </span>
              {showPreview && currentItem.fullCaption ? currentItem.fullCaption : currentItem.draftSnippet}
            </div>

            {currentItem.fullCaption && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  setShowPreview(!showPreview)
                }}
                className="text-[11px] font-medium text-primary hover:underline"
              >
                {showPreview ? '요약 보기' : '전문 및 해시태그 보기'}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Bottom Manual Action Buttons */}
      <div className="flex items-center justify-center gap-3 pt-1">
        <Button
          type="button"
          variant="outline"
          size="lg"
          onClick={manualDismiss}
          className="h-11 px-5 rounded-xl text-xs font-semibold text-muted-foreground border-border hover:bg-muted"
        >
          <X className="w-4 h-4 mr-1.5 text-muted-foreground" />
          보류 (좌측)
        </Button>

        {currentItem.category === 'dm_reply' ? (
          <Button
            type="button"
            variant="default"
            size="lg"
            onClick={manualApprove}
            className="h-11 px-6 rounded-xl text-xs font-bold bg-primary hover:bg-primary/90 text-primary-foreground shadow-sm"
          >
            <Send className="w-4 h-4 mr-1.5" />
            답장 보내기 (우측)
          </Button>
        ) : (
          <Button
            type="button"
            variant="default"
            size="lg"
            onClick={manualApprove}
            className="h-11 px-6 rounded-xl text-xs font-bold bg-primary hover:bg-primary/90 text-primary-foreground shadow-sm"
          >
            <Check className="w-4 h-4 mr-1.5" />
            승인 (우측)
          </Button>
        )}
      </div>
    </div>
  )
}
