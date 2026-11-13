'use client'

import { useState } from 'react'
import Link from 'next/link'
import {
  AlertCircle,
  CheckCircle2,
  ExternalLink,
  Laptop,
  Loader2,
  LogIn,
  PenTool,
  RefreshCw,
  Search,
  Send,
  Sparkles,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'
import {
  PublishStatusCard,
  type LocalPublishStatusEntry,
} from '@/features/local-publishing/publish-status-card'
import { parseNaverBlogPostUrl } from '@/features/naver-publish/blog-url'
import { NaverPostUrlForm } from '@/features/publishing/naver-post-url-form'
import { getNaverFailureCopy } from './naver-failure-copy'
import { cn } from '@/lib/utils'

export type NaverPublishResultProps = Readonly<{
  workspaceId: string
  entry: LocalPublishStatusEntry
  contentId?: string
  versionId?: string
  expected: Readonly<{
    title: string
    categoryName: string | null
    imageCount: number
  }>
  canManage?: boolean
  timeoutNotice?: string | null
  onDone?: () => void
  onRetry?: () => void
}>

const STAGES = [
  { key: 'device', label: '기기 확인', icon: Laptop },
  { key: 'auth', label: '네이버 접속', icon: LogIn },
  { key: 'content', label: '글 입력', icon: PenTool },
  { key: 'publish', label: '게시', icon: Send },
  { key: 'verify', label: '확인', icon: Search },
] as const

function getStageIndex(phase?: string | null, status?: string): number {
  if (phase === 'succeeded' || phase === 'result_observed' || status === 'succeeded' || status === 'unknown_after_submit') return 4
  if (phase === 'submitted' || status === 'submitted') return 3
  if (phase === 'editor_ready' || phase === 'content_filled' || phase === 'preflight_verified' || status === 'running') return 2
  if (phase === 'account_verified') return 1
  return 0 // device_waiting / claimed
}

export function NaverPublishResult({
  workspaceId,
  entry,
  expected,
  contentId,
  versionId,
  canManage = true,
  timeoutNotice,
  onDone,
  onRetry,
}: NaverPublishResultProps) {
  const [isCrossPosting, setIsCrossPosting] = useState(false)
  const [crossPostSuccess, setCrossPostSuccess] = useState(false)

  const handleCrossPost = async () => {
    if (!canManage || isCrossPosting) return
    if (!contentId || !versionId) {
      toast.info('게시물 식별 정보를 확인 중입니다. 잠시 후 다시 시도해 주세요.')
      return
    }
    setIsCrossPosting(true)
    try {
      const res = await fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/naver-posts/${encodeURIComponent(contentId)}/cross-post`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ versionId }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data.error || '소셜 변환에 실패했습니다.')
      }
      setCrossPostSuccess(true)
      toast.success('🎉 인스타그램 카드뉴스와 스레드 소식이 보관함에 준비되었어요!')
    } catch (err: any) {
      toast.error(err.message || '인스타/스레드 변환 중 오류가 발생했습니다.')
    } finally {
      setIsCrossPosting(false)
    }
  }

  const currentStageIndex = getStageIndex(entry.phase, entry.status)
  const isSucceeded = entry.status === 'succeeded'
  const isFailed = entry.status === 'failed_before_submit' || entry.status === 'unknown_after_submit'

  const failure = entry.failureCode ? getNaverFailureCopy(entry.failureCode) : null

  return (
    <div data-expected-title={expected.title} className="space-y-6">
      {/* 5-step progress header */}
      <div className="rounded-xl border bg-card p-4 space-y-3">
        <h3 className="text-xs font-semibold text-muted-foreground">진행 현황</h3>
        <ol className="grid grid-cols-5 gap-2 text-center text-xs" aria-label="게시 진행 단계">
          {STAGES.map((stage, idx) => {
            const isCompleted = isSucceeded || currentStageIndex > idx
            const isCurrent = !isSucceeded && currentStageIndex === idx
            const IconComponent = stage.icon

            return (
              <li
                key={stage.key}
                className={cn(
                  'flex flex-col items-center gap-1.5 p-2 rounded-lg transition-colors',
                  isCurrent && 'bg-primary/10 font-bold text-primary',
                  isCompleted && 'text-foreground font-medium',
                  !isCurrent && !isCompleted && 'text-muted-foreground opacity-60',
                )}
                aria-current={isCurrent ? 'step' : undefined}
              >
                <div className="flex items-center justify-center size-8 rounded-full border bg-background">
                  {isCompleted ? (
                    <CheckCircle2 className="size-4 text-primary" aria-hidden />
                  ) : isCurrent ? (
                    <Loader2 className="size-4 text-primary animate-spin" aria-hidden />
                  ) : (
                    <IconComponent className="size-4 text-muted-foreground" aria-hidden />
                  )}
                </div>
                <span>{stage.label}</span>
              </li>
            )
          })}
        </ol>
      </div>

      {/* Success banner with URL & Verification */}
      {isSucceeded && (
        <div className="rounded-xl border border-primary/20 bg-primary/5 p-5 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="size-5 text-primary" aria-hidden />
                <h3 className="text-base font-bold text-foreground">게시 결과를 직접 확인해 주세요</h3>
              </div>
              <p className="text-xs text-muted-foreground">
                네이버 블로그에 글을 게시하셨다면 실제 올라간 글 주소를 기록해 주세요.
              </p>
            </div>
            {(() => {
              const parsed = entry.resultUrl ? parseNaverBlogPostUrl(entry.resultUrl) : null
              if (!parsed) return null
              const safeUrl = `https://blog.naver.com/${parsed.blogId}/${parsed.logNo}`
              return (
                <Button asChild size="sm" className="shrink-0 font-medium">
                  <a
                    href={safeUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5"
                  >
                    글 보기
                    <ExternalLink className="size-3.5" aria-hidden />
                  </a>
                </Button>
              )
            })()}
          </div>

          {/* 게시 URL 등록 Section */}
          <div className="border-t border-primary/15 pt-3 space-y-2">
            <h4 className="text-xs font-semibold text-foreground">게시 URL 등록</h4>
            <p className="text-xs text-muted-foreground">
              게시하셨다면 글 주소를 알려 주세요.
            </p>
            {contentId ? (
              <NaverPostUrlForm workspaceId={workspaceId} itemId={contentId} />
            ) : null}
          </div>

          {/* Post-publish Owner Guidance Tip */}
          <div className="rounded-lg border border-primary/10 bg-background/60 p-3 text-xs text-muted-foreground flex items-start gap-2">
            <span className="text-base shrink-0">💡</span>
            <div>
              <span className="font-semibold text-foreground">사장님을 위한 안심 팁: </span>
              <span>
                비공개로 등록된 글은 사장님 본인에게만 보여요. [글 보기]를 눌러 전체 레이아웃과 사진을 확인하신 뒤, 네이버 블로그 상단 <strong>[수정 ➡️ 전체공개]</strong>로 변경하시면 이웃들에게 바로 노출됩니다.
              </span>
            </div>
          </div>

          {/* 📸 3채널 크로스 퍼블리싱 (OSMU) 배너 */}
          <div className="rounded-xl border border-purple-500/30 bg-gradient-to-r from-purple-500/10 via-background to-indigo-500/10 p-4 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="size-6 rounded-md bg-gradient-to-tr from-purple-600 to-indigo-600 text-white font-black text-xs flex items-center justify-center shadow-xs">
                    📸
                  </span>
                  <h4 className="text-sm font-bold text-foreground">
                    이 글로 인스타그램·스레드 초안 만들기
                  </h4>
                  <Badge variant="outline" className="border-purple-500/40 text-purple-700 dark:text-purple-300 text-[10px] font-bold">
                    원소스 멀티유즈
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  네이버 원고를 바탕으로 채널별 초안을 보관함에 준비해요. 외부 게시는 각 초안을 확인하고 별도로 승인해야 해요.
                </p>
              </div>

              <Button
                type="button"
                size="sm"
                disabled={!canManage || !contentId || !versionId || isCrossPosting}
                onClick={handleCrossPost}
                className="shrink-0 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white font-bold text-xs h-9 px-4 shadow-xs cursor-pointer"
              >
                {isCrossPosting ? (
                  <>
                    <Loader2 className="size-3.5 mr-1.5 animate-spin" />
                    변환 생성 중...
                  </>
                ) : (
                  <>
                    <Sparkles className="size-3.5 mr-1.5" />
                    인스타·스레드 초안으로 변환
                  </>
                )}
              </Button>
            </div>
            {crossPostSuccess && (
              <div className="pt-2 border-t border-purple-500/20 flex items-center justify-between text-xs text-purple-900 dark:text-purple-200">
                <span>🎉 인스타그램 카드뉴스와 스레드 소식이 보관함에 준비되었어요!</span>
                <Link href="/app/vault" className="font-bold underline text-purple-700 dark:text-purple-300">
                  보관함 확인하기 &rarr;
                </Link>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Failure banner */}
      {isFailed && failure && (
        <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-4 space-y-3">
          <div className="flex items-center gap-2 text-destructive">
            <AlertCircle className="size-5 shrink-0" aria-hidden />
            <h4 className="text-sm font-semibold">게시 실패</h4>
          </div>
          <p className="text-xs text-muted-foreground whitespace-pre-wrap">{failure.message}</p>
          {failure.action === 'retry' && entry.failureCode !== 'UNKNOWN_RESULT' && onRetry && (
            <Button type="button" size="sm" onClick={onRetry} className="min-h-[36px]">
              <RefreshCw className="size-3.5" aria-hidden />
              다시 시도
            </Button>
          )}
        </div>
      )}

      {/* Timeout notice */}
      {timeoutNotice && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-xs text-foreground" role="status">
          <p>{timeoutNotice}</p>
        </div>
      )}

      {/* Embedded PublishStatusCard */}
      <PublishStatusCard
        entry={entry}
        workspaceId={workspaceId}
        canManage={canManage}
      />

      {/* Done button */}
      {onDone && (
        <div className="flex justify-end pt-2">
          <Button type="button" variant="outline" onClick={onDone}>
            완료
          </Button>
        </div>
      )}
    </div>
  )
}
