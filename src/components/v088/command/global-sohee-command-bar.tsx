'use client'

import React, { useState } from 'react'
import { Sparkles, ArrowUp, MessageSquareText } from 'lucide-react'

interface GlobalSoheeCommandBarProps {
  onOpenChat?: () => void
  onSendMessage?: (text: string) => void
  placeholder?: string
}

export function GlobalSoheeCommandBar({
  onOpenChat,
  onSendMessage,
  placeholder = '소희에게 부탁하기... (예: "주말 방문 유치 소식 써줘", "10월 이벤트 글 기획해줘", "글 좀 더 다정하게 다듬어줘")'
}: GlobalSoheeCommandBarProps) {
  const [input, setInput] = useState('')

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim()) return

    if (onSendMessage) {
      onSendMessage(input.trim())
    } else if (onOpenChat) {
      onOpenChat()
    }
    setInput('')
  }

  return (
    <div className="w-full max-w-4xl mx-auto">
      <form
        onSubmit={handleSubmit}
        className="relative flex items-center rounded-2xl bg-card border border-border shadow-md hover:shadow-lg focus-within:ring-2 focus-within:ring-ring focus-within:border-primary transition-all p-1.5"
      >
        <div className="flex items-center justify-center pl-3 pr-2 text-primary shrink-0">
          <Sparkles className="w-5 h-5 animate-pulse" />
        </div>

        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={placeholder}
          className="flex-1 bg-transparent px-2 py-3 text-sm md:text-base text-foreground placeholder:text-muted-foreground focus:outline-none min-h-11"
        />

        <div className="flex items-center gap-1.5 pr-1 shrink-0">
          {onOpenChat && (
            <button
              type="button"
              onClick={onOpenChat}
              className="hidden sm:flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold text-muted-foreground hover:text-foreground hover:bg-muted transition-colors min-h-11"
              title="대화창 열기"
            >
              <MessageSquareText className="w-4 h-4 text-primary" />
              <span>대화창</span>
            </button>
          )}

          <button
            type="submit"
            disabled={!input.trim()}
            className="flex items-center justify-center w-11 h-11 rounded-xl bg-primary hover:opacity-90 disabled:bg-muted text-primary-foreground disabled:text-muted-foreground transition-all cursor-pointer disabled:cursor-not-allowed shadow-xs"
            aria-label="지시사항 보내기"
          >
            <ArrowUp className="w-5 h-5" />
          </button>
        </div>
      </form>
    </div>
  )
}
