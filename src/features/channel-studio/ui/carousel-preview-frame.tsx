'use client'

import React, { useState } from 'react'
import Image from 'next/image'
import { ChevronLeft, ChevronRight, Layers, Smartphone, Square, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'

export interface CarouselPreviewFrameProps {
  images: string[]
  title?: string
  topic?: string
  className?: string
  defaultAspectRatio?: '1:1' | '9:16'
}

export function CarouselPreviewFrame({
  images = [],
  title = '',
  topic = '',
  className = '',
  defaultAspectRatio = '1:1',
}: Readonly<CarouselPreviewFrameProps>) {
  const [currentIndex, setCurrentIndex] = useState(0)
  const [aspectRatio, setAspectRatio] = useState<'1:1' | '9:16'>(defaultAspectRatio)

  const safeImages = images.length > 0 ? images : ['/images/placeholder.jpg']
  const totalSlides = safeImages.length

  const handlePrev = (e: React.MouseEvent) => {
    e.stopPropagation()
    setCurrentIndex((prev) => (prev > 0 ? prev - 1 : totalSlides - 1))
  }

  const handleNext = (e: React.MouseEvent) => {
    e.stopPropagation()
    setCurrentIndex((prev) => (prev < totalSlides - 1 ? prev + 1 : 0))
  }

  const getSlideLabel = (idx: number) => {
    if (idx === 0) return '1. 메인 표지'
    if (idx === 1) return '2. 매장 공간 및 대표 메뉴'
    if (idx === 2) return '3. 방문 안내 및 예약'
    return `${idx + 1}번째 슬라이드`
  }

  return (
    <div
      data-testid="carousel-preview-frame"
      className={`rounded-2xl border border-border bg-card overflow-hidden shadow-xs space-y-2 p-3 ${className}`}
    >
      {/* Top Controls: Aspect Ratio Toggle & Slide Info */}
      <div className="flex items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-1.5">
          <Layers className="size-3.5 text-purple-600" aria-hidden="true" />
          <span className="font-bold text-foreground">
            {totalSlides > 1 ? `카드뉴스 캐러셀 (${currentIndex + 1}/${totalSlides})` : '단일 피드 이미지'}
          </span>
        </div>

        {/* 1:1 vs 9:16 Ratio Toggle */}
        <div className="flex items-center gap-1 bg-muted/60 p-0.5 rounded-lg border border-border/40 text-[11px] font-semibold">
          <button
            type="button"
            onClick={() => setAspectRatio('1:1')}
            className={`flex items-center gap-1 px-2 py-0.5 rounded-md transition-all cursor-pointer ${
              aspectRatio === '1:1' ? 'bg-card text-foreground shadow-2xs font-bold' : 'text-muted-foreground'
            }`}
          >
            <Square className="size-3" />
            <span>피드 1:1</span>
          </button>
          <button
            type="button"
            onClick={() => setAspectRatio('9:16')}
            className={`flex items-center gap-1 px-2 py-0.5 rounded-md transition-all cursor-pointer ${
              aspectRatio === '9:16' ? 'bg-card text-foreground shadow-2xs font-bold' : 'text-muted-foreground'
            }`}
          >
            <Smartphone className="size-3" />
            <span>스토리 9:16</span>
          </button>
        </div>
      </div>

      {/* Frame Container */}
      <div
        className={`relative w-full overflow-hidden rounded-xl bg-zinc-950 flex items-center justify-center transition-all duration-300 ${
          aspectRatio === '1:1' ? 'aspect-square max-h-[420px]' : 'aspect-[9/16] max-h-[480px]'
        }`}
      >
        {/* Current Image */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={safeImages[currentIndex]}
          alt={title || topic || '게시물 이미지'}
          className={`size-full transition-all duration-300 ${
            aspectRatio === '1:1' ? 'object-cover' : 'object-contain'
          }`}
        />

        {/* Slide Step Badge */}
        {totalSlides > 1 && (
          <div className="absolute top-2.5 left-2.5 z-10">
            <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-black/60 backdrop-blur-xs text-white border border-white/20">
              {getSlideLabel(currentIndex)}
            </span>
          </div>
        )}

        {/* Counter Badge */}
        {totalSlides > 1 && (
          <div className="absolute top-2.5 right-2.5 z-10">
            <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-black/60 backdrop-blur-xs text-white border border-white/20">
              {currentIndex + 1} / {totalSlides}
            </span>
          </div>
        )}

        {/* Left / Right Navigation Arrows */}
        {totalSlides > 1 && (
          <>
            <button
              type="button"
              onClick={handlePrev}
              aria-label="이전 슬라이드"
              className="absolute left-2 top-1/2 -translate-y-1/2 z-10 size-8 rounded-full bg-black/50 hover:bg-black/75 text-white flex items-center justify-center backdrop-blur-xs transition-colors cursor-pointer border border-white/20"
            >
              <ChevronLeft className="size-5" />
            </button>
            <button
              type="button"
              onClick={handleNext}
              aria-label="다음 슬라이드"
              className="absolute right-2 top-1/2 -translate-y-1/2 z-10 size-8 rounded-full bg-black/50 hover:bg-black/75 text-white flex items-center justify-center backdrop-blur-xs transition-colors cursor-pointer border border-white/20"
            >
              <ChevronRight className="size-5" />
            </button>
          </>
        )}

        {/* Bottom Dots Indicator */}
        {totalSlides > 1 && (
          <div className="absolute bottom-2.5 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1.5 p-1 rounded-full bg-black/40 backdrop-blur-xs">
            {safeImages.map((_, i) => (
              <button
                key={i}
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  setCurrentIndex(i)
                }}
                className={`size-1.5 rounded-full transition-all cursor-pointer ${
                  i === currentIndex ? 'w-4 bg-white' : 'bg-white/50 hover:bg-white/80'
                }`}
                aria-label={`슬라이드 ${i + 1} 이동`}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
