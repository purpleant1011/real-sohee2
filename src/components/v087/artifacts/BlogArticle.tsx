"use client";

import React from "react";
import { Calendar, MapPin, Tag } from "lucide-react";

export interface BlogArticleProps {
  title: string;
  category?: string;
  publishedDate?: string;
  authorName?: string;
  location?: string;
  intro: string;
  sections: {
    heading: string;
    body: string;
    imageUrl?: string;
    imageCaption?: string;
  }[];
  conclusion: string;
  tags?: string[];
  className?: string;
}

export function BlogArticle({
  title,
  category = "매장 스토리 및 전문 정보",
  publishedDate = "오늘",
  authorName = "매장 대표 사장님",
  location = "인천 서구 청라",
  intro,
  sections = [],
  conclusion,
  tags = [],
  className = "",
}: BlogArticleProps) {
  return (
    <div className={`max-w-2xl mx-auto rounded-3xl bg-white dark:bg-[#121316] border border-[#EAE7E3] dark:border-zinc-800 p-6 shadow-xl font-sans ${className}`}>
      {/* Blog Post Header */}
      <div className="space-y-3 pb-5 border-b border-zinc-100 dark:border-zinc-800">
        <div className="flex items-center justify-between">
          <span className="px-2.5 py-0.5 rounded-full text-xs font-black bg-state-ok-soft text-state-ok border border-state-ok/30 dark:bg-state-ok/60 dark:text-state-ok">
            {category}
          </span>
          <span className="text-[11px] font-bold text-zinc-400">Naver Blog SmartEditor</span>
        </div>

        <h1 className="text-xl sm:text-2xl font-black text-zinc-900 dark:text-white leading-snug">
          {title}
        </h1>

        <div className="flex flex-wrap items-center gap-3 text-xs text-zinc-500 font-medium">
          <span>{authorName}</span>
          <span>·</span>
          <span className="flex items-center gap-1">
            <Calendar className="w-3.5 h-3.5" />
            {publishedDate}
          </span>
          {location && (
            <>
              <span>·</span>
              <span className="flex items-center gap-1">
                <MapPin className="w-3.5 h-3.5" />
                {location}
              </span>
            </>
          )}
        </div>
      </div>

      {/* Body Content */}
      <div className="py-6 space-y-6 text-sm text-zinc-800 dark:text-zinc-200 leading-relaxed">
        {/* Intro */}
        <p className="text-base font-medium text-zinc-700 dark:text-zinc-300 whitespace-pre-wrap bg-zinc-50 dark:bg-zinc-900/60 p-4 rounded-2xl border border-zinc-100 dark:border-zinc-800/80">
          {intro}
        </p>

        {/* Structured Sections */}
        {sections.map((sec, idx) => (
          <div key={idx} className="space-y-3 pt-2">
            <h3 className="text-base sm:text-lg font-black text-zinc-900 dark:text-white flex items-center gap-2">
              <span className="w-6 h-6 rounded-full bg-state-ok text-white flex items-center justify-center text-xs font-black">
                {idx + 1}
              </span>
              {sec.heading}
            </h3>

            <p className="whitespace-pre-wrap">{sec.body}</p>

            {sec.imageUrl && (
              <div className="space-y-1.5 pt-2">
                <div className="rounded-2xl overflow-hidden border border-zinc-200 dark:border-zinc-800 max-h-80">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={sec.imageUrl} alt={sec.imageCaption || sec.heading} className="w-full h-full object-cover" />
                </div>
                {sec.imageCaption && (
                  <span className="block text-center text-xs text-zinc-400 font-medium">
                    {sec.imageCaption}
                  </span>
                )}
              </div>
            )}
          </div>
        ))}

        {/* Conclusion */}
        <div className="p-4 rounded-2xl bg-state-ok/40 border border-state-ok/15 space-y-2">
          <strong className="block text-sm font-black text-state-ok">
            대표원장 총평 & 예약 안내
          </strong>
          <p className="text-xs sm:text-sm text-state-ok whitespace-pre-wrap">
            {conclusion}
          </p>
        </div>
      </div>

      {/* Tags */}
      {tags.length > 0 && (
        <div className="pt-4 border-t border-zinc-100 dark:border-zinc-800 flex flex-wrap items-center gap-1.5">
          <Tag className="w-3.5 h-3.5 text-zinc-400" />
          {tags.map((tag, idx) => (
            <span
              key={idx}
              className="px-2 py-0.5 rounded-lg bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 text-xs font-bold"
            >
              #{tag}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
