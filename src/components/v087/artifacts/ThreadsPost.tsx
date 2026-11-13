"use client";

import React from "react";
import { Heart, MessageCircle, Repeat2, Send } from "lucide-react";

export interface ThreadsPostProps {
  accountHandle?: string;
  contentText: string;
  imageUrl?: string;
  timeAgo?: string;
  likesCount?: number;
  repliesCount?: number;
  className?: string;
}

export function ThreadsPost({
  accountHandle = "byreum_official",
  contentText,
  imageUrl,
  timeAgo = "방금 전",
  likesCount = 0,
  repliesCount = 0,
  className = "",
}: ThreadsPostProps) {
  return (
    <div className={`max-w-md mx-auto rounded-3xl bg-white dark:bg-[#101010] border border-[#EAE7E3] dark:border-zinc-800 p-4 shadow-xl font-sans ${className}`}>
      <div className="flex gap-3">
        {/* Left Avatar & Thread line */}
        <div className="flex flex-col items-center">
          <div className="w-9 h-9 rounded-full bg-zinc-900 dark:bg-zinc-100 flex items-center justify-center text-white dark:text-black font-black text-xs">
            BR
          </div>
          <div className="w-0.5 grow my-2 bg-zinc-200 dark:bg-zinc-800 rounded-full" />
        </div>

        {/* Right Content */}
        <div className="flex-1 space-y-2.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <strong className="text-xs font-black text-zinc-900 dark:text-zinc-100">{accountHandle}</strong>
              <span className="text-[10px] text-zinc-400">· {timeAgo}</span>
            </div>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200">
              Threads
            </span>
          </div>

          <p className="text-xs text-zinc-800 dark:text-zinc-200 whitespace-pre-wrap leading-relaxed">
            {contentText}
          </p>

          {imageUrl && (
            <div className="rounded-2xl overflow-hidden border border-zinc-200 dark:border-zinc-800">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={imageUrl} alt="스레드 이미지" className="w-full object-cover max-h-64" />
            </div>
          )}

          {/* Action Row */}
          <div className="flex items-center gap-4 text-zinc-600 dark:text-zinc-400 pt-1 text-xs">
            <button className="flex items-center gap-1 hover:text-primary">
              <Heart className="w-4 h-4" />
              {likesCount > 0 && <span>{likesCount}</span>}
            </button>
            <button className="flex items-center gap-1 hover:text-state-wait">
              <MessageCircle className="w-4 h-4" />
              {repliesCount > 0 && <span>{repliesCount}</span>}
            </button>
            <button className="hover:text-state-ok">
              <Repeat2 className="w-4 h-4" />
            </button>
            <button className="hover:text-primary">
              <Send className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
