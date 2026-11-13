'use client'

import React from 'react'
import { cn } from '@/lib/utils'

export type HomeDisplayDensity = 'compact' | 'detailed'

interface HomeDisplayDensityProps {
  density: HomeDisplayDensity
  onChange: (density: HomeDisplayDensity) => void
  className?: string
}

export function HomeDisplayDensityToggle({
  density,
  onChange,
  className,
}: HomeDisplayDensityProps) {
  return (
    <div
      role="radiogroup"
      aria-label="표시 밀도 선택"
      className={cn(
        'inline-flex items-center rounded-xl bg-muted/60 p-1 border border-border/60 shadow-2xs',
        className
      )}
    >
      <button
        type="button"
        role="radio"
        aria-checked={density === 'compact'}
        onClick={() => onChange('compact')}
        className={cn(
          'min-h-[44px] min-w-[56px] px-3.5 py-2 text-xs font-medium rounded-lg transition-all duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
          density === 'compact'
            ? 'bg-background text-foreground shadow-xs font-semibold'
            : 'text-muted-foreground hover:text-foreground'
        )}
      >
        간략
      </button>
      <button
        type="button"
        role="radio"
        aria-checked={density === 'detailed'}
        onClick={() => onChange('detailed')}
        className={cn(
          'min-h-[44px] min-w-[56px] px-3.5 py-2 text-xs font-medium rounded-lg transition-all duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
          density === 'detailed'
            ? 'bg-background text-foreground shadow-xs font-semibold'
            : 'text-muted-foreground hover:text-foreground'
        )}
      >
        상세
      </button>
    </div>
  )
}
