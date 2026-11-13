'use client'

import { useEffect, useState } from 'react'
import type { QuickPostApprovalOptions } from '@/features/quick-start/quick-post-vault-contract'
import { ExternalLink, Loader2, Pencil, RefreshCw, Rocket, TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { INSTAGRAM_LIMITS, THREADS_LIMITS } from '@/components/social/social-preview'
import { ChannelPreview } from '@/features/preview/channel-preview'
import { ApprovalCard, type ApprovalCardTarget } from '@/features/vault/ui/approval-card/approval-card'
import { evaluateChannelSpec } from '@/features/vault/channel-spec'
import { CarouselPreviewFrame } from '@/features/channel-studio/ui/carousel-preview-frame'
import { cn } from '@/lib/utils'
import { STAGE_LABEL, stageOf, type QuickPostItem } from './types'

type Channel = 'instagram' | 'threads'

export function PostDetail(props: {
  item: QuickPostItem
  busy: boolean
  onRevise: () => void
  onPublish: () => void
  workspaceId: string
  approvalOptions?: QuickPostApprovalOptions | null
  approvalError?: string | null
  onSaveCopies: (copies: QuickPostItem['copies']) => Promise<void>
  onRetry: (channel: Channel) => void
}) {
  const { item } = props
  const available = item.channels.map((c) => c.provider).filter((p): p is Channel => p === 'instagram' || p === 'threads')
  const [channel, setChannel] = useState<Channel>(available[0] ?? 'instagram')
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(item.copies)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setDraft(item.copies)
    setEditing(false)
    if (!available.includes(channel)) setChannel(available[0] ?? 'instagram')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.missionId, item.revision])

  const stage = stageOf(item.status)
  const isLegacy = item.supportsApprovalActions === false
  const handleOf = (c: Channel) => item.channels.find((x) => x.provider === c)?.handle ?? item.businessName
  const canAct = stage === 'waiting' && !props.busy && !isLegacy
  const hashtags = (draft.instagram.hashtags ?? []).join(' ')

  const igOver = draft.instagram.caption.length > INSTAGRAM_LIMITS.caption
  const thOver = draft.threads.content.length > THREADS_LIMITS.text
  // Fallback previews never manufacture approval rights while the server contract loads.
  const approvalTargets: ApprovalCardTarget[] = (!props.approvalError && props.approvalOptions?.revision === item.revision && props.approvalOptions.missionId === item.missionId ? props.approvalOptions.targets : []).map(option => {
    const c = option.channel
    return c === 'instagram'
      ? { ...option, variant: { handle: option.handle ?? '', caption: draft.instagram.caption, hashtags: draft.instagram.hashtags, imageUrl: item.imageUrl } }
      : { ...option, variant: { handle: option.handle ?? '', caption: draft.threads.content, imageUrl: item.imageUrl } }
  })
  const fallbackTargets: ApprovalCardTarget[] = (available.length ? available : ['threads' as const]).map(c => {
    // Quick-post does not expose image MIME or size: an unknown check must never look like a pass.
    const spec = evaluateChannelSpec(c, { text: c === 'instagram' ? draft.instagram.caption : draft.threads.content, hashtags: c === 'instagram' ? draft.instagram.hashtags : [], media: item.imageIds.map(() => ({ type: 'image' as const })) })
    const issue = spec.checks.find(check => check.status === 'FAIL' || check.status === 'UNKNOWN' || check.status === 'WARN')
    const specLabel = issue ? `규격 확인 필요 · ${issue.userMessage}` : '규격 확인 완료'
    return c === 'instagram'
      ? { channel: 'instagram', handle: item.channels.find(x => x.provider === c)?.handle, variant: { handle: handleOf(c), caption: draft.instagram.caption, hashtags: draft.instagram.hashtags, imageUrl: item.imageUrl }, specLabel, specResult: spec }
      : { channel: 'threads', handle: item.channels.find(x => x.provider === c)?.handle, variant: { handle: handleOf(c), caption: draft.threads.content, imageUrl: item.imageUrl }, specLabel, specResult: spec }
  })

  async function save() {
    setSaving(true)
    try {
      await props.onSaveCopies(draft)
      setEditing(false)
    } finally {
      setSaving(false)
    }
  }

  return (
    <section aria-label="게시물 미리보기" className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">{item.topic || '게시물 미리보기'}</h2>
          <p className="text-xs text-muted-foreground">
            {item.revision > 1 ? `수정 ${item.revision - 1}회 반영 · ` : ''}
            {new Date(item.createdAt).toLocaleString('ko-KR')}
          </p>
        </div>
        <Badge variant={stage === 'published' ? 'success' : stage === 'failed' ? 'destructive' : stage === 'publishing' ? 'info' : 'purple'}>
          {STAGE_LABEL[stage]}
        </Badge>
      </div>

      {stage === 'waiting' && !editing && !isLegacy && (
        <>
          {props.approvalError && <p role="alert" className="text-sm text-destructive">{props.approvalError}</p>}
          <ApprovalCard key={`${item.missionId}:${item.revision}`} workspaceId={props.workspaceId} targets={approvalTargets.length ? approvalTargets : fallbackTargets} busy={props.busy} onRevise={props.onRevise} onPublish={props.onPublish} onSchedule={() => undefined} />
        </>
      )}

      {isLegacy && (
        <div className="flex items-center gap-2 rounded-xl border bg-muted/40 p-3.5 text-sm text-muted-foreground">
          <Badge variant="outline" className="border-muted-foreground/30 text-muted-foreground shrink-0">
            이전 원고 · 미리보기만 제공
          </Badge>
          <span>이전 형식으로 작성된 원고로, 미리보기만 확인할 수 있어요.</span>
        </div>
      )}

      {(stage !== 'waiting' || editing || isLegacy) && available.length > 1 && (
        <div role="tablist" aria-label="채널 선택" className="inline-flex rounded-lg border bg-muted p-1">
          {available.map((c) => (
            <button
              key={c}
              role="tab"
              type="button"
              aria-selected={channel === c}
              onClick={() => setChannel(c)}
              className={cn(
                'rounded-md px-4 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                channel === c ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {c === 'instagram' ? '인스타그램' : '스레드'}
            </button>
          ))}
        </div>
      )}

      <div className={cn('grid min-w-0 gap-6', (stage !== 'waiting' || editing || isLegacy) && 'lg:grid-cols-[minmax(0,420px)_1fr]')}>
        <div className="flex flex-col min-w-0 justify-center lg:justify-start gap-4">
          {(stage !== 'waiting' || editing || isLegacy) && item.imageUrl && (
            <CarouselPreviewFrame
              images={[item.imageUrl]}
              title={item.topic}
              topic={item.topic}
            />
          )}
          {(stage !== 'waiting' || editing || isLegacy) && (channel === 'instagram' ? (
            <ChannelPreview channel="instagram" variant={{ handle: handleOf('instagram'), caption: draft.instagram.caption, hashtags: draft.instagram.hashtags, imageUrl: item.imageUrl }} />
          ) : (
            <ChannelPreview channel="threads" variant={{ handle: handleOf('threads'), caption: draft.threads.content, imageUrl: item.imageUrl }} />
          ))}
        </div>

        <div className="space-y-4">
          {editing ? (
            <div className="space-y-3 rounded-xl border bg-card p-4">
              <div className="space-y-1.5">
                <Label htmlFor="ig-caption">인스타그램 글</Label>
                <Textarea
                  id="ig-caption"
                  rows={6}
                  value={draft.instagram.caption}
                  onChange={(e) => setDraft({ ...draft, instagram: { ...draft.instagram, caption: e.target.value } })}
                />
                <p className={cn('text-right text-xs', igOver ? 'text-destructive' : 'text-muted-foreground')}>
                  {draft.instagram.caption.length}/{INSTAGRAM_LIMITS.caption}
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ig-tags">해시태그 (띄어쓰기로 구분)</Label>
                <Textarea
                  id="ig-tags"
                  rows={2}
                  value={hashtags}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      instagram: { ...draft.instagram, hashtags: e.target.value.split(/\s+/).filter(Boolean).slice(0, INSTAGRAM_LIMITS.hashtags) },
                    })
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="th-content">스레드 글</Label>
                <Textarea id="th-content" rows={4} value={draft.threads.content} onChange={(e) => setDraft({ ...draft, threads: { content: e.target.value } })} />
                <p className={cn('text-right text-xs', thOver ? 'text-destructive' : 'text-muted-foreground')}>
                  {draft.threads.content.length}/{THREADS_LIMITS.text}
                </p>
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={() => { setDraft(item.copies); setEditing(false) }}>
                  취소
                </Button>
                <Button onClick={save} disabled={saving || igOver || thOver}>
                  {saving && <Loader2 className="animate-spin" aria-hidden />} 수정 저장
                </Button>
              </div>
            </div>
          ) : (
            <>
              {stage === 'waiting' && !isLegacy && (
                <div className="space-y-3 rounded-xl border bg-card p-4">
                  <p className="text-sm text-muted-foreground">
                    위 예상 화면은 실제 게시 화면과 다를 수 있어요. 마음에 들면 <strong className="text-foreground">발행하기</strong>를, 아쉬운 부분은 소희에게 알려 주세요. 알려 주신 내용은 다음 게시물에도 참고해요.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button className="h-11 px-6" onClick={props.onPublish} disabled={!canAct || approvalTargets.length === 0 || !available.every(channel => approvalTargets.some(target => target.channel === channel && target.actions?.PUBLISH.allowed === true))}>
                      <Rocket aria-hidden /> 발행하기
                    </Button>
                    <Button variant="outline" className="h-11" onClick={props.onRevise} disabled={!canAct}>
                      <RefreshCw aria-hidden /> 소희에게 수정 요청
                    </Button>
                    <Button variant="ghost" className="h-11" onClick={() => setEditing(true)} disabled={!canAct}>
                      <Pencil aria-hidden /> 직접 고치기
                    </Button>
                  </div>
                </div>
              )}

              {isLegacy && (
                <div className="rounded-xl border bg-card p-4 space-y-2 text-sm">
                  <p className="font-medium text-foreground">작성된 원고 본문</p>
                  <div className="rounded-lg bg-muted/50 p-3 text-muted-foreground whitespace-pre-wrap">
                    {channel === 'instagram' ? draft.instagram.caption : draft.threads.content}
                  </div>
                  {channel === 'instagram' && hashtags && (
                    <p className="text-xs text-primary/80">{hashtags}</p>
                  )}
                </div>
              )}

              {stage === 'publishing' && (
                <div className="flex items-center gap-2 rounded-xl border bg-card p-4 text-sm" role="status">
                  <Loader2 className="size-4 animate-spin text-primary" aria-hidden /> 발행하고 실제로 올라갔는지 확인하는 중이에요…
                </div>
              )}

              {(stage === 'published' || stage === 'failed' || Object.keys(item.receipts).length > 0) && (
                <ul className="space-y-2">
                  {Object.entries(item.receipts).map(([ch, r]) => (
                    <li key={ch} className="flex items-center justify-between gap-3 rounded-xl border bg-card p-3 text-sm">
                      <span className="font-medium">{ch === 'instagram' ? '인스타그램' : '스레드'}</span>
                      {r.stage === 'EXTERNALLY_VERIFIED' ? (
                        r.permalink ? (
                          <Button asChild size="sm" variant="outline">
                            <a href={r.permalink} target="_blank" rel="noreferrer">
                              게시물 보기 <ExternalLink aria-hidden />
                            </a>
                          </Button>
                        ) : (
                          <Badge variant="success">발행 확인됨</Badge>
                        )
                      ) : (
                        <span className="flex flex-wrap items-center justify-end gap-2 text-destructive">
                          <span className="flex items-center gap-1">
                            <TriangleAlert className="size-4" aria-hidden /> {friendlyError(r.errorMessage)}
                          </span>
                          {(stage === 'failed' || stage === 'publishing') && (ch === 'instagram' || ch === 'threads') && (
                            <Button size="sm" variant="outline" disabled={props.busy} onClick={() => props.onRetry(ch)}>
                              <RefreshCw aria-hidden /> 다시 시도
                            </Button>
                          )}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      </div>
    </section>
  )
}

function friendlyError(msg?: string) {
  if (!msg) return '올라가지 않았어요. 채널 연결을 확인하고 다시 만들어 주세요.'
  if (/token|credential|auth|permission/i.test(msg)) return '채널 연결이 만료됐어요. 채널을 다시 연결해 주세요.'
  return '올라가지 않았어요. 잠시 후 다시 시도해 주세요.'
}
