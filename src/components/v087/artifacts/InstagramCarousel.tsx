"use client";

import React, { useState } from "react";
import { ChevronLeft, ChevronRight, Heart, MessageCircle, Send, Bookmark, Sparkles } from "lucide-react";

export interface InstagramSlide {
  index: number;
  imageUrl?: string;
  imageAlt?: string;
  headline?: string;
  bodySnippet?: string;
}

export interface InstagramCarouselProps {
  accountHandle?: string;
  slides: InstagramSlide[];
  caption: string;
  hashtags?: string[];
  aspectRatio?: "1:1" | "4:5";
  className?: string;
}

export function InstagramCarousel({
  accountHandle = "byreum_official",
  slides = [],
  caption,
  hashtags = [],
  aspectRatio = "4:5",
  className = "",
}: InstagramCarouselProps) {
  const [currentSlideIndex, setCurrentSlideIndex] = useState(0);

  const prevSlide = () => {
    setCurrentSlideIndex((prev) => (prev > 0 ? prev - 1 : prev));
  };

  const nextSlide = () => {
    setCurrentSlideIndex((prev) => (prev < slides.length - 1 ? prev + 1 : prev));
  };

  const currentSlide = slides[currentSlideIndex] || {
    index: 0,
    headline: "소희 AI 생성 카드뉴스",
    bodySnippet: "사장님이 전하는 1:1 맞춤 이용 가이드",
  };

  return (
    <div className={`max-w-md mx-auto rounded-3xl bg-white dark:bg-black border border-[#EAE7E3] dark:border-zinc-800 shadow-xl overflow-hidden font-sans ${className}`}>
      {/* Header */}
      <div className="p-3.5 flex items-center justify-between border-b border-zinc-100 dark:border-zinc-800">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-state-warn via-primary to-primary p-[1.5px]">
            <div className="w-full h-full rounded-full bg-white dark:bg-black flex items-center justify-center font-black text-[10px] text-primary">
              BR
            </div>
          </div>
          <div>
            <span className="block text-xs font-black text-zinc-900 dark:text-zinc-100">{accountHandle}</span>
            <span className="block text-[10px] text-zinc-400">우리 동네 · 이용 꿀팁</span>
          </div>
        </div>

        <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-primary/10 text-primary dark:bg-primary/60 dark:text-primary">
          Instagram Feed
        </span>
      </div>

      {/* Image / Card Frame */}
      <div className={`relative bg-gradient-to-br from-zinc-900 via-zinc-800 to-zinc-950 flex flex-col items-center justify-center p-6 text-center select-none ${
        aspectRatio === "4:5" ? "aspect-[4/5]" : "aspect-square"
      }`}>
        {currentSlide.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={currentSlide.imageUrl}
            alt={currentSlide.imageAlt || `슬라이드 ${currentSlideIndex + 1}`}
            className="absolute inset-0 w-full h-full object-cover"
          />
        ) : (
          <div className="space-y-4 max-w-[85%] z-10">
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-white/10 backdrop-blur-md text-white text-[11px] font-black">
              <Sparkles className="w-3 h-3 text-state-warn" />
              SLIDE {currentSlideIndex + 1} / {Math.max(slides.length, 1)}
            </span>
            <h4 className="text-xl sm:text-2xl font-black text-white leading-snug drop-shadow-md">
              {currentSlide.headline || "여름철 모공 케어 가이드"}
            </h4>
            <p className="text-xs text-zinc-300 font-medium leading-relaxed drop-shadow-xs">
              {currentSlide.bodySnippet || "사장님이 직접 알려주는 매장 이용 핵심 원칙"}
            </p>
          </div>
        )}

        {/* Carousel Navigation Arrows */}
        {slides.length > 1 && (
          <>
            {currentSlideIndex > 0 && (
              <button
                onClick={prevSlide}
                className="absolute left-2.5 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-black/60 hover:bg-black/80 text-white flex items-center justify-center backdrop-blur-xs transition-all z-20"
                aria-label="이전 슬라이드"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
            )}
            {currentSlideIndex < slides.length - 1 && (
              <button
                onClick={nextSlide}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-black/60 hover:bg-black/80 text-white flex items-center justify-center backdrop-blur-xs transition-all z-20"
                aria-label="다음 슬라이드"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            )}

            {/* Dots Indicator */}
            <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-1.5 z-20">
              {slides.map((_, idx) => (
                <span
                  key={idx}
                  className={`h-1.5 rounded-full transition-all ${
                    idx === currentSlideIndex ? "w-4 bg-white" : "w-1.5 bg-white/40"
                  }`}
                />
              ))}
            </div>
          </>
        )}
      </div>

      {/* Action Bar */}
      <div className="p-3.5 space-y-3">
        <div className="flex items-center justify-between text-zinc-800 dark:text-zinc-200">
          <div className="flex items-center gap-3">
            <Heart className="w-5 h-5 hover:text-primary cursor-pointer" />
            <MessageCircle className="w-5 h-5 hover:text-state-wait cursor-pointer" />
            <Send className="w-5 h-5 hover:text-primary cursor-pointer" />
          </div>
          <Bookmark className="w-5 h-5 cursor-pointer" />
        </div>

        {/* Caption */}
        <div className="space-y-1.5 text-xs">
          <p className="text-zinc-900 dark:text-zinc-100 leading-relaxed">
            <strong className="font-black mr-1.5">{accountHandle}</strong>
            {caption}
          </p>

          {hashtags.length > 0 && (
            <p className="text-state-wait font-medium">
              {hashtags.map((tag) => (tag.startsWith("#") ? tag : `#${tag}`)).join(" ")}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
