'use client'

import React from 'react'
import Link from 'next/link'
import { Archive, ChevronRight, AlertCircle } from 'lucide-react'
import type { VaultSummaryLineData } from './types'

export interface VaultSummaryLineProps {
  data: VaultSummaryLineData
  className?: string
}

export function VaultSummaryLine({ data, className }: VaultSummaryLineProps) {
  return (
    <div
      role="region"
      aria-label="보관함 요약"
      className={`rounded-xl border border-border bg-card/60 backdrop-blur-xs p-3.5 transition-colors hover:bg-muted/40 ${className ?? ''}`}
    >
      <Link
        href="/app/vault"
        className="flex items-center justify-between gap-3 text-sm group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-lg"
      >
        <div className="flex items-center gap-2.5 min-w-0">
          {data.hasError ? (
            <AlertCircle className="w-4 h-4 text-destructive shrink-0" aria-hidden="true" />
          ) : (
            <Archive className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors shrink-0" aria-hidden="true" />
          )}
          <span className="text-xs font-semibold text-muted-foreground shrink-0">
            보관함 요약
          </span>
          <span className="text-muted-foreground/60 shrink-0">·</span>
          <span
            className={`truncate text-xs sm:text-sm font-medium ${
              data.hasError ? 'text-destructive font-semibold' : 'text-foreground'
            }`}
          >
            {data.lineText}
          </span>
        </div>

        <div className="flex items-center gap-1 text-xs text-muted-foreground group-hover:text-foreground shrink-0">
          <span className="hidden sm:inline">보관함 가기</span>
          <ChevronRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
        </div>
      </Link>
    </div>
  )
}
