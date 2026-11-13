'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { MessageSquarePlus, Send, X } from 'lucide-react'
import { StickyActionBar } from '@/components/mobile-ui'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useOptionalWorkspaceContext } from '@/hooks/use-workspace-context'
import type { ContentDetail } from '@/features/content/types'
import { ChannelLivePanel } from './channel-live-panel'
import { LivePostEmbed } from './live-post-embed'
import { ExportActions } from './export-actions'
import { CHANNEL_LABEL, ChannelStylePreview, MANUAL_CHANNELS } from './channel-style-preview'
import { buildVersionTimeline, type WorkStudioContext } from './work-studio-model'
import { NaverReviewStep } from '@/features/channel-studio/naver/ui/naver-review-step'
import {
  findPlaceholdersInVersion,
  hasInformationRequestPlaceholder,
} from '@/features/content/placeholder-detect'
import { PlaceholderNotice } from '@/features/chat/placeholder-notice'

const STATUS_LABEL: Record<string, string> = { draft: '초안', review: '검토 중', approved: '승인됨', scheduled: '예약됨', published: '게시됨', archived: '보관됨' }

function fmt(iso: string): string {
  const t = Date.parse(iso)
  return Number.isFinite(t) ? new Date(t).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''
}

/**
 * 모바일 '작업' 상세. 소희가 만든 글·이미지를 채널 모양으로 보고(미리보기), 어떤 수정 흐름이 있었는지(이력)와
 * 그때의 대화(대화)를 확인한 뒤 같은 원고에 추가 지시를 이어갈 수 있다. 읽기 전용이며 게시·저장·전송을 하지 않는다.
 */
export function WorkStudio({ workspaceId, detail, context, conversationEnabled }: Readonly<{
  workspaceId: string
  detail: ContentDetail
  context: WorkStudioContext
  conversationEnabled: boolean
}>) {
  const [tab, setTab] = useState('preview')
  const [isSheetOpen, setIsSheetOpen] = useState(false)
  const [shouldPrefetchNaver, setShouldPrefetchNaver] = useState(false)
  const workspace = useOptionalWorkspaceContext()
  const accountName = workspace?.workspaceName?.trim() || '우리 가게'

  const shown = detail.versions.find(v => v.id === detail.currentVersionId)
    ?? [...detail.versions].sort((a, b) => b.versionNumber - a.versionNumber)[0] ?? null
  const placeholders = findPlaceholdersInVersion(shown)
  const hasInfoRequest = hasInformationRequestPlaceholder(placeholders)
  const timeline = buildVersionTimeline(detail.versions, detail.currentVersionId)
  const manual = MANUAL_CHANNELS.has(detail.channel)
  const isNaverReview = detail.channel === 'naver_blog' && Boolean(detail.currentVersionId)
  const media = (shown?.media ?? []).map(m => ({ id: m.id, src: `/api/workspaces/${workspaceId}/media/${m.id}`, alt: m.altText || '원고 사진' }))
  const editorBlocks = shown?.structuredPayload && 'editorBlocks' in shown.structuredPayload
    ? shown.structuredPayload.editorBlocks
    : undefined
  const followUpHref = conversationEnabled && detail.currentVersionId
    ? `/app/conversations?workRef=${detail.currentVersionId}`
    : context.thread ? `/app/conversations/${context.thread.id}` : '/app/command?from=' + encodeURIComponent(`/app/work/${detail.id}`)

  useEffect(() => {
    if (!isNaverReview) return
    const schedule =
      typeof window !== 'undefined' && 'requestIdleCallback' in window
        ? (cb: () => void) => {
            const id = (window as any).requestIdleCallback(cb)
            return () => (window as any).cancelIdleCallback?.(id)
          }
        : (cb: () => void) => {
            const id = setTimeout(cb, 0)
            return () => clearTimeout(id)
          }

    const cancel = schedule(() => {
      setShouldPrefetchNaver(true)
    })
    return cancel
  }, [isNaverReview])

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 pb-24 pt-2 text-foreground">
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">{CHANNEL_LABEL[detail.channel] ?? detail.channel}</Badge>
          <Badge variant="outline">{STATUS_LABEL[detail.status] ?? detail.status}</Badge>
        </div>
        <h1 className="line-clamp-3 text-xl font-bold leading-snug tracking-tight break-keep">{detail.title}</h1>
        <p className="text-sm text-muted-foreground">
          {shown?.versionNumber ?? 1}번째 다듬은 글 · 수정 {Math.max(0, detail.versions.length - 1)}회 · {fmt(detail.updatedAt)} 업데이트
        </p>
      </header>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList aria-label="작업 보기" className="grid min-h-12 w-full grid-cols-3 rounded-xl p-1">
          <TabsTrigger value="preview" className="min-h-11 text-sm">미리보기</TabsTrigger>
          <TabsTrigger value="history" className="min-h-11 text-sm">수정 이력</TabsTrigger>
          <TabsTrigger value="chat" className="min-h-11 text-sm">대화</TabsTrigger>
        </TabsList>

        <TabsContent value="preview" className="space-y-3">
          <PlaceholderNotice placeholders={placeholders} />
          {context.livePost ? (
            <LivePostEmbed
              url={context.livePost.url}
              verifiedAt={context.livePost.verifiedAt}
            />
          ) : null}
          {isNaverReview ? (
            <Card className="gap-3 border-primary/20 bg-primary/5 p-4 sm:p-5">
              <div className="flex items-center justify-between">
                <Badge variant="secondary" className="border border-primary/20 bg-primary/10 text-xs font-semibold text-primary">
                  네이버 블로그
                </Badge>
              </div>
              <CardHeader className="gap-1 p-0">
                <CardTitle className="text-base font-bold tracking-tight text-foreground sm:text-lg">
                  네이버에 올릴 준비가 됐어요
                </CardTitle>
                <CardDescription className="text-xs text-muted-foreground">
                  사진 {media.length}장 · 글과 사진을 한 번에 가져가서 붙여넣기만 하면 돼요
                </CardDescription>
              </CardHeader>
              <CardContent className="p-0 pt-1">
                <Button
                  type="button"
                  onClick={() => setIsSheetOpen(true)}
                  className="min-h-12 w-full gap-2 text-sm font-semibold"
                >
                  <Send className="size-4" aria-hidden="true" />
                  네이버에 한 번에 올리기
                </Button>
              </CardContent>
            </Card>
          ) : null}
          {shown ? (
            <ChannelStylePreview
              channel={detail.channel}
              accountName={accountName}
              title={detail.title}
              caption={shown.caption}
              hashtags={shown.hashtags}
              media={media}
              editorBlocks={editorBlocks}
            />
          ) : <p className="rounded-2xl border border-dashed border-border p-4 text-sm text-muted-foreground">아직 저장된 원고 내용이 없어요.</p>}
          {(detail.channel === 'instagram' || detail.channel === 'threads') ? (
            <ChannelLivePanel
              workspaceId={workspaceId}
              contentId={detail.id}
              channel={detail.channel}
              contentStatus={detail.status}
              connectionStatus={context.connectionStatus ?? 'unknown'}
              publishedUrl={context.livePost?.url ?? null}
              publishAttemptId={context.publishAttemptId ?? null}
              providerPostId={context.providerPostId ?? null}
              publishedAt={context.publishedAt ?? null}
            />
          ) : null}
          {manual && !isNaverReview && shown ? (
            <ExportActions channel={detail.channel} title={detail.title} caption={shown.caption} hashtags={shown.hashtags} images={media} />
          ) : null}
          {(detail.status === 'draft' || detail.status === 'review') && detail.currentVersionId && detail.channel !== 'instagram' && detail.channel !== 'threads' && !hasInfoRequest ? (
            <Link prefetch={false} href={`/app/work/${detail.id}/approve`} className="inline-flex min-h-12 w-full items-center justify-center rounded-xl border border-border bg-card text-sm font-semibold">검토·승인하러 가기</Link>
          ) : null}
        </TabsContent>

        <TabsContent value="history" className="space-y-3">
          <ol className="space-y-3" aria-label="수정 이력">
            {timeline.map(item => (
              <li key={item.id} className="relative rounded-2xl border border-border bg-card p-4">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold">v{item.versionNumber}{item.current ? <Badge className="ml-2">현재</Badge> : null}</span>
                  <time dateTime={item.createdAt} className="text-xs text-muted-foreground">{fmt(item.createdAt)}</time>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">{item.reason}</p>
                <p className="mt-2 line-clamp-3 text-sm leading-6">{item.caption}</p>
              </li>
            ))}
          </ol>
        </TabsContent>

        <TabsContent value="chat" className="space-y-3">
          {context.historyError ? (
            <p role="status" className="rounded-2xl border border-border p-4 text-sm text-muted-foreground">대화 내역을 불러오지 못했어요. 내용이 없다는 뜻은 아니에요. 잠시 뒤 다시 열어 주세요.</p>
          ) : context.messages.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-border p-4 text-sm text-muted-foreground">이 작업과 연결된 대화가 아직 없어요.</p>
          ) : (
            <ul aria-label="대화 내역" className="space-y-2.5">
              {context.messages.map(m => (
                <li key={m.id} className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
                  <div className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-6 ${m.role === 'user' ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground'}`}>
                    <p className="whitespace-pre-wrap">{m.text}</p>
                    <time dateTime={m.at} className="mt-1 block text-[11px] opacity-70">{fmt(m.at)}</time>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {context.thread ? <Link prefetch={false} href={`/app/conversations/${context.thread.id}`} className="inline-flex min-h-11 items-center text-sm text-primary">대화 전체 열기</Link> : null}
        </TabsContent>
      </Tabs>

      <StickyActionBar>
        {isNaverReview ? (
          <div className="grid grid-cols-2 gap-2">
            <Button
              asChild
              variant="outline"
              className="min-h-12 w-full text-sm font-semibold"
            >
              <Link prefetch={false} href={followUpHref}>
                <MessageSquarePlus className="size-4" aria-hidden="true" />
                소희에게 추가 지시
              </Link>
            </Button>
            <Button
              type="button"
              onClick={() => setIsSheetOpen(true)}
              className="min-h-12 w-full gap-1.5 text-sm font-semibold"
            >
              <Send className="size-4" aria-hidden="true" />
              네이버에 한 번에 올리기
            </Button>
          </div>
        ) : (
          <Button asChild className="min-h-12 w-full gap-2 text-base font-semibold">
            <Link prefetch={false} href={followUpHref}>
              <MessageSquarePlus className="size-5" aria-hidden="true" />
              소희에게 추가 지시
            </Link>
          </Button>
        )}
      </StickyActionBar>

      {isNaverReview ? (
        <Sheet open={isSheetOpen} onOpenChange={setIsSheetOpen}>
          <SheetContent side="bottom" className="max-h-[90dvh] overflow-y-auto rounded-t-2xl p-4 sm:p-6">
            <SheetHeader className="flex flex-row items-center justify-between border-b pb-3 text-left">
              <div>
                <SheetTitle className="text-base font-bold sm:text-lg">네이버에 한 번에 올리기</SheetTitle>
                <SheetDescription className="sr-only">
                  네이버 블로그 원고와 사진을 한 번에 복사하고 스마트에디터에 등록합니다.
                </SheetDescription>
              </div>
              <SheetClose asChild>
                <Button variant="ghost" size="icon" className="size-8" aria-label="닫기">
                  <X className="size-4" aria-hidden="true" />
                </Button>
              </SheetClose>
            </SheetHeader>
            <div className="pt-2">
              <NaverReviewStep
                workspaceId={workspaceId}
                contentId={detail.id}
                versionId={detail.currentVersionId ?? undefined}
                settings={{ visibility: 'public', categoryName: null, imageCount: media.length }}
                compact
              />
            </div>
          </SheetContent>
        </Sheet>
      ) : null}

      {isNaverReview && shouldPrefetchNaver && !isSheetOpen ? (
        <div hidden className="hidden" aria-hidden="true">
          <NaverReviewStep
            workspaceId={workspaceId}
            contentId={detail.id}
            versionId={detail.currentVersionId ?? undefined}
            settings={{ visibility: 'public', categoryName: null, imageCount: media.length }}
            compact
          />
        </div>
      ) : null}
    </div>
  )
}
