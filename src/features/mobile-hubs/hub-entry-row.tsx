'use client'

import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import { countLabel, type HubEntry } from './hub-model'

/** 허브 진입 한 줄. 개수를 확인하지 못한 항목은 0건이 아니라 사유를 보여준다. */
export function HubEntryRow({ entry }: { entry: HubEntry }) {
  return (
    <li>
      <Link
        href={entry.href}
        prefetch={false}
        className="flex min-h-14 w-full items-center justify-between gap-3 rounded-2xl border border-border bg-card px-4 py-3 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <span className="min-w-0">
          <span className="block break-words text-base font-medium">{entry.label}</span>
          <span className="block break-words text-sm leading-5 text-muted-foreground">{entry.description}</span>
        </span>
        <span className="flex shrink-0 items-center gap-1.5">
          {entry.needsAttention ? (
            <span className="rounded-full bg-secondary px-2.5 py-0.5 text-xs font-medium text-secondary-foreground">확인 필요</span>
          ) : null}
          {entry.count ? (
            <span className={entry.count.value === null ? 'max-w-24 text-right text-xs text-muted-foreground' : 'text-sm font-medium'}>
              {countLabel(entry.count)}
            </span>
          ) : null}
          <ChevronRight className="size-4 text-muted-foreground" aria-hidden="true" />
        </span>
      </Link>
    </li>
  )
}
