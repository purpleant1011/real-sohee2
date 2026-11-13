'use client'

import React from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { getMobileActiveSection, getMobileSubTabs } from './mobile-navigation'
import { cn } from '@/lib/utils'

export function MobileSubNavigationHeader() {
  const pathname = usePathname()
  const activeSection = getMobileActiveSection(pathname)
  const subTabs = getMobileSubTabs(activeSection)

  if (subTabs.length === 0) return null

  return (
    <div
      data-testid="mobile-sub-navigation-header"
      className="md:hidden sticky top-18 z-30 bg-background/95 backdrop-blur-md border-b border-border px-3 py-2"
    >
      <div className="flex items-center gap-1.5 p-1 bg-muted/70 rounded-xl border border-border/60">
        {subTabs.map((tab) => {
          const isActive = pathname === tab.href || pathname?.startsWith(tab.href + '/')
          const Icon = tab.icon

          return (
            <Link
              key={tab.name}
              href={tab.href}
              className={cn(
                'flex-1 flex items-center justify-center gap-1.5 min-h-[38px] px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer whitespace-nowrap',
                isActive
                  ? 'bg-background text-foreground shadow-xs font-bold text-primary'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <Icon className="w-3.5 h-3.5 shrink-0" />
              <span>{tab.name}</span>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
