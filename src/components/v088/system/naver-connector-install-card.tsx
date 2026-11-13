'use client'

import { FileText, ShieldCheck } from 'lucide-react'

export type NaverConnectorStatus = Readonly<{
  hasConnection: boolean
  isOnline: boolean
  accountLabel: string | null
  canAutoPublish: boolean
  lastSeenAgoSeconds?: number | null
}>

export function NaverConnectorInstallCard(props: { workspaceId: string }) {
  return (
    <div data-workspace-id={props.workspaceId} className="rounded-3xl border border-zinc-200/80 dark:border-zinc-800/80 bg-white dark:bg-[#121215] p-6 sm:p-7 shadow-xs space-y-4">
      <div className="flex items-start gap-3">
        <div className="flex size-10 items-center justify-center rounded-2xl bg-primary/10 text-primary shrink-0">
          <FileText className="size-5" aria-hidden="true" />
        </div>
        <div className="space-y-1">
          <h3 className="text-base sm:text-lg font-bold text-zinc-950 dark:text-zinc-50 flex items-center gap-2">
            <span>네이버 블로그 수동 작성 도우미</span>
            <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
              <ShieldCheck className="size-3.5" aria-hidden="true" />
              안전 게시
            </span>
          </h3>
          <p className="text-sm font-medium text-foreground leading-relaxed">
            소희는 네이버 자동 게시를 하지 않아요. 글·사진을 준비해 드리고 직접 올리실 수 있게 도와요
          </p>
          <p className="text-xs text-muted-foreground leading-relaxed">
            소희에서 원고 제목, 본문, 태그를 개별 복사하고 사진을 내려받은 뒤 네이버 스마트에디터에서 직접 확인하고 등록해 주세요.
          </p>
        </div>
      </div>
    </div>
  )
}
