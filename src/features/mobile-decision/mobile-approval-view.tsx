'use client'

import { useEffect, useRef } from 'react'
import { ArrowLeft, RefreshCw, ShieldCheck } from 'lucide-react'
import { ReplyApprovalActions } from '@/features/mobile-approvals/reply-approval-actions'
import { PostApprovalContinuation } from '@/features/mobile-approvals/post-approval-continuation'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import type { MobileApprovalView } from './contracts'

export function MobileApprovalScreen({ view, onBack, onRefresh }: {
  view: MobileApprovalView; onBack: () => void; onRefresh: () => void
}) {
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => { heading.current?.focus({ preventScroll: true }) }, [view.id])
  return <div className="mx-auto w-full max-w-2xl space-y-6 pb-40 text-foreground">
    <header className="space-y-4">
      <Button variant="ghost" onClick={onBack} className="min-h-11 gap-2 px-2"><ArrowLeft className="size-4" aria-hidden="true" />목록으로 돌아가기</Button>
      <div className="flex flex-wrap items-center gap-2"><Badge variant="secondary">내용 검토</Badge>{view.datasetMode === 'TEST' || view.datasetMode === 'DEMO' ? <Badge variant="outline">테스트 예시 · 실제 실행 없음</Badge> : <Badge variant="outline">{view.datasetMode === 'ACTUAL' ? '내용 확인·최종 승인' : '업무 데이터 확인 필요'}</Badge>}</div>
      <h1 ref={heading} tabIndex={-1} className="break-words text-2xl font-semibold leading-snug tracking-tight outline-none">{view.title}</h1>
      <p className="text-base text-muted-foreground">{view.targetLabel || '대상 계정 확인 필요'}</p>
    </header>
    <section aria-label="고객 원문" className="space-y-3">
      <h2 className="text-lg font-semibold">어떤 요청인가요?</h2>
      <Card className="gap-0 rounded-2xl py-0 shadow-none"><CardContent className="whitespace-pre-wrap break-words p-5 text-base leading-7">{view.sourceText || '원본 내용을 아직 확인하지 못했어요.'}</CardContent></Card>
    </section>
    {view.datasetMode === 'ACTUAL' && (view.kind === 'dm_reply' || view.kind === 'comment_reply') ? <ReplyApprovalActions key={`${view.workspaceId}:${view.id}`} workspaceId={view.workspaceId} item={view.id} /> : <>
    <section aria-label="전체 초안" className="space-y-3">
      <h2 className="text-lg font-semibold">소희가 준비한 내용</h2>
      <Card className="gap-0 rounded-2xl border-primary/20 py-0 shadow-none"><CardContent className="whitespace-pre-wrap break-words p-5 text-base leading-7">{view.fullContent || '전체 초안이 아직 준비되지 않았어요'}</CardContent></Card>
      <p className="text-sm leading-relaxed text-muted-foreground">내용 확인용 예상 화면이에요. 실제 게시·발송 화면과 다를 수 있어요.</p>
    </section>
    {view.datasetMode === 'ACTUAL' && view.kind === 'post_publish' ? <PostApprovalContinuation item={view.id} workspaceId={view.workspaceId} /> : <>
    <section aria-label="실행 전 확인" className="space-y-3 rounded-2xl bg-muted/50 p-5">
      <h2 className="flex items-center gap-2 text-lg font-semibold"><ShieldCheck className="size-5 text-primary" aria-hidden="true" />실행 전에 확인해요</h2>
      <ul className="space-y-3 text-sm leading-relaxed text-muted-foreground">
        <li>대상 계정·권한과 이 내용의 최종 버전을 다시 확인해야 해요.</li>
        <li>비용·사진 권리·예약 시간은 아직 실행 근거로 확인되지 않았어요.</li>
        <li>검토 화면을 닫아도 게시·답장·예약은 실행되지 않아요.</li>
      </ul>
      <Button variant="outline" onClick={onRefresh} className="min-h-11 gap-2"><RefreshCw className="size-4" aria-hidden="true" />최신 내용 확인</Button>
    </section>
    <div className="fixed inset-x-0 bottom-0 z-50 border-t border-border bg-background/95 px-4 pb-[calc(env(safe-area-inset-bottom)+16px)] pt-4 backdrop-blur-sm">
      <div className="mx-auto max-w-2xl space-y-3">
        <p role="status" className="text-sm leading-relaxed text-muted-foreground">{view.reason}</p>
        <p className="text-sm text-muted-foreground">{view.datasetMode === 'ACTUAL' ? '소희와 대화로 내용을 준비하고 최종 승인해 주세요.' : view.datasetMode === 'UNKNOWN' ? '업무 데이터를 확인하지 못해 실행할 수 없어요. 최신 내용을 다시 확인해 주세요.' : '테스트 예시는 전송하지 않아요.'}</p>
      </div>
    </div>
    </>}
    </>}
  </div>
}
