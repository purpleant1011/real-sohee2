'use client'

import React from 'react'
import { Sparkles } from 'lucide-react'

export interface AgentQuickActionChipsProps {
  chips: readonly string[]
  onSelectChip: (text: string) => void
  disabled?: boolean
}

export function AgentQuickActionChips({
  chips,
  onSelectChip,
  disabled = false,
}: Readonly<AgentQuickActionChipsProps>) {
  if (!chips || chips.length === 0) return null

  return (
    <div
      aria-label="추천 질문 및 후속 액션"
      className="pt-2 flex flex-wrap items-center gap-1.5"
    >
      <span className="text-[10px] font-bold text-purple-700 dark:text-purple-300 flex items-center gap-1 mr-0.5">
        <Sparkles aria-hidden="true" className="size-3" />
        <span>추천 액션:</span>
      </span>
      {chips.map((chip) => (
        <button
          key={chip}
          type="button"
          disabled={disabled}
          onClick={() => onSelectChip(chip)}
          className="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-bold bg-purple-100/80 dark:bg-purple-900/40 text-purple-900 dark:text-purple-200 hover:bg-purple-200 dark:hover:bg-purple-800/60 border border-purple-200/60 dark:border-purple-800/40 transition-all cursor-pointer shadow-2xs active:scale-95 disabled:opacity-50 disabled:pointer-events-none"
        >
          {chip}
        </button>
      ))}
    </div>
  )
}
