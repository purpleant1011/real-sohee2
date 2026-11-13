'use client'

import React, { useState, useEffect, useTransition, useCallback } from 'react'
import {
  CheckCircle2,
  Clock,
  ShieldCheck,
  FileText,
  Sliders,
  Plus,
  ExternalLink,
  Loader2,
  Check,
  AlertCircle,
  Inbox,
  ArrowRight,
  Edit3,
  Sparkles,
  Save,
  X
} from 'lucide-react'
import Link from 'next/link'
import { useExternalWriteGuard } from '@/features/pwa/use-external-write-guard'
import {
  reviseContentWithNaturalLanguage,
  type ContentItem,
  type ContentApprovalRecord,
} from '@/features/content/content-revision'

interface HarnessStripProps {
  knowledgeVersion?: string
  textHarnessVersion?: string
  imageHarnessVersion?: string
  operatingPolicy?: string
}

function ActiveHarnessStrip({
  knowledgeVersion = '매장 기본 지식 반영',
  textHarnessVersion = '담백하고 따뜻한 일상체',
  imageHarnessVersion = '자연광 실사 스타일',
  operatingPolicy = '사장님 사전 승인 필수',
}: HarnessStripProps) {
  return (
    <div className="bg-card border border-border rounded-2xl p-4 flex flex-col md:flex-row items-start md:items-center justify-between gap-4 shadow-xs">
      <div className="flex items-center gap-2.5">
        <div className="w-8 h-8 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
          <ShieldCheck className="w-4 h-4" />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-foreground">소희 제작 기준 (안전 가이드)</span>
            <span className="px-1.5 py-0.5 text-xs font-bold bg-accent text-accent-foreground border border-border rounded-md">
              적용 중
            </span>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">사장님이 가르쳐주신 매장 정보와 스타일에 맞춰 글과 이미지를 만듭니다.</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <div className="px-2.5 py-1 rounded-lg bg-muted border border-border text-foreground flex items-center gap-1.5">
          <span className="text-muted-foreground font-medium">지식:</span>
          <span className="font-semibold">{knowledgeVersion}</span>
        </div>
        <div className="px-2.5 py-1 rounded-lg bg-muted border border-border text-foreground flex items-center gap-1.5">
          <span className="text-muted-foreground font-medium">문체:</span>
          <span className="font-semibold">{textHarnessVersion}</span>
        </div>
        <div className="px-2.5 py-1 rounded-lg bg-muted border border-border text-foreground flex items-center gap-1.5">
          <span className="text-muted-foreground font-medium">사진:</span>
          <span className="font-semibold">{imageHarnessVersion}</span>
        </div>
        <div className="px-2.5 py-1 rounded-lg bg-muted border border-border text-primary flex items-center gap-1.5">
          <Sliders className="w-3 h-3 text-primary" />
          <span className="font-semibold">{operatingPolicy}</span>
        </div>
      </div>
    </div>
  )
}

export interface ContentStudioProps {
  workspaceId?: string
}

interface PublishedStudioItem {
  content: ContentItem
  publishedAt: string
  igUrl?: string
  thUrl?: string
}

export function ContentStudioRenewal({ workspaceId }: ContentStudioProps) {
  const [contents, setContents] = useState<{
    inProgress: ContentItem[]
    requiresAttention: { content: ContentItem; approval: ContentApprovalRecord }[]
    published: PublishedStudioItem[]
  }>({
    inProgress: [],
    requiresAttention: [],
    published: [],
  })

  const [isLoading, setIsLoading] = useState(false)
  const [selectedLineage, setSelectedLineage] = useState<ContentItem | null>(null)
  const [isCreating, startCreating] = useTransition()
  const [revisionInput, setRevisionInput] = useState<{ [id: string]: string }>({})
  const [actionSuccess, setActionSuccess] = useState<string | null>(null)
  const [blockerError, setBlockerError] = useState<string | null>(null)
  // 승인 후 즉시 발행은 외부 쓰기다. 연결이 확인된 뒤에만 시작한다(ANI-1778).
  const runExternalWrite = useExternalWriteGuard()

  // Direct Edit Workbench state
  const [editingContentId, setEditingContentId] = useState<string | null>(null)
  const [directEditCaption, setDirectEditCaption] = useState<string>('')

  const loadData = useCallback(async () => {
    if (!workspaceId) return
    setIsLoading(true)

    try {
      // 1. Fetch contents
      const contentRes = await fetch(`/api/workspaces/${workspaceId}/content`, {
        cache: 'no-store',
      })
      const contentJson = await contentRes.json().catch(() => ({}))

      // 2. Fetch missions
      const missionRes = await fetch('/api/missions', {
        cache: 'no-store',
      })
      const missionJson = await missionRes.json().catch(() => ({}))

      const inProg: ContentItem[] = []
      const reqAttn: { content: ContentItem; approval: ContentApprovalRecord }[] = []
      const pub: PublishedStudioItem[] = []

      // Map raw content records
      if (contentJson.success && Array.isArray(contentJson.contents)) {
        for (const item of contentJson.contents) {
          const contentItem: ContentItem & { versionId?: string } = {
            id: item.contentId,
            workspaceId: item.workspaceId,
            version: item.versionNumber || 1,
            versionId: item.currentVersionId || item.contentId,
            caption: item.caption || item.title || '',
            imageUrl: item.mediaUrls?.[0] || undefined,
            channels: [item.channel || 'instagram'],
            fingerprint: item.fingerprint || `fp_${item.contentId}`,
            harnessVersionSnapshot: {
              textVersion: 'v1',
              imageVersion: 'v1',
            },
          }

          if (item.status === 'published') {
            pub.push({
              content: contentItem,
              publishedAt: item.updatedAt ? new Date(item.updatedAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }) : '최근',
              igUrl: item.channel === 'instagram' ? item.externalUrl : undefined,
              thUrl: item.channel === 'threads' ? item.externalUrl : undefined,
            })
          } else if (item.status === 'pending_approval' || (item.status !== 'draft' && !item.isApproved)) {
            reqAttn.push({
              content: contentItem,
              approval: {
                id: item.approvalId || `appr_${item.contentId}`,
                contentId: item.contentId,
                contentVersion: item.versionNumber || 1,
                fingerprint: item.fingerprint || '',
                status: 'PENDING',
              },
            })
          } else {
            inProg.push(contentItem)
          }
        }
      }

      // Map queued/planning missions into inProgress (support canonical DTO and fallback)
      if (missionJson.success) {
        const rawMissions = Array.isArray(missionJson.canonicalMissions)
          ? missionJson.canonicalMissions
          : Array.isArray(missionJson.items)
          ? missionJson.items
          : Array.isArray(missionJson.missions)
          ? missionJson.missions
          : []

        for (const mission of rawMissions) {
          const status = mission.canonicalStatus || mission.status
          const executionState = mission.executionState || mission.execution_state
          const id = mission.missionId || mission.mission_id || mission.id
          const wsId = mission.workspaceId || mission.workspace_id || workspaceId

          if (
            status === 'PLANNING' ||
            status === 'QUEUED' ||
            status === 'RECEIVED' ||
            executionState === 'DRAFT' ||
            executionState === 'READY'
          ) {
            inProg.push({
              id,
              workspaceId: wsId,
              version: 1,
              caption:
                mission.goal ||
                mission.target_outcome?.intent ||
                mission.metadata?.intent ||
                mission.userCopy ||
                '소희가 마케팅 콘텐츠를 구상하고 있습니다...',
              channels: mission.targetChannel
                ? [mission.targetChannel]
                : Array.isArray(mission.channelTargets)
                ? mission.channelTargets
                : ['instagram', 'threads'],
              fingerprint: `msn_${id}`,
              harnessVersionSnapshot: {
                textVersion: mission.metadata?.harnessVersions?.textHarnessVersionId || 'v1',
                imageVersion: mission.metadata?.harnessVersions?.imageHarnessVersionId || 'v1',
              },
            })
          }
        }
      }

      setContents({
        inProgress: inProg,
        requiresAttention: reqAttn,
        published: pub,
      })
    } catch (err) {
      console.warn('[ContentStudioRenewal] Load error:', err)
    } finally {
      setIsLoading(false)
    }
  }, [workspaceId])

  useEffect(() => {
    loadData()
  }, [loadData])

  // 1. Create content
  function handleCreateContent() {
    if (!workspaceId) {
      alert('워크스페이스 정보가 없습니다.')
      return
    }

    setBlockerError(null)
    startCreating(async () => {
      try {
        const res = await fetch('/api/missions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            intent: '주말 특별 신메뉴 및 매장 안내 마케팅',
            channelTargets: ['instagram', 'threads'],
          }),
        })

        const data = await res.json().catch(() => ({}))

        if (!res.ok || !data.success) {
          if (res.status === 403 || data.error?.code === 'SOHEE_NOT_READY') {
            setBlockerError(data.error?.message || '온보딩이 완료되지 않아 콘텐츠를 만들 수 없습니다. 온보딩을 먼저 완료해 주세요.')
            return
          }
          throw new Error(data.error?.message || data.error || '새 콘텐츠 생성에 실패했습니다.')
        }

        setActionSuccess('새 마케팅 작업이 접수되었습니다. 소희가 기준에 맞춰 작성을 시작합니다.')
        setTimeout(() => setActionSuccess(null), 4000)
        await loadData()
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : '콘텐츠 생성에 실패했습니다.'
        alert(msg)
      }
    })
  }

  // 2. Approve Content
  async function handleApprove(item: { content: ContentItem; approval: ContentApprovalRecord }) {
    if (!workspaceId) return
    setBlockerError(null)

    const outcome = await runExternalWrite('publish', item.content.id, () => publishApprovedContent(item))
    if (!outcome.ran) {
      setBlockerError(outcome.decision.message)
      return
    }
  }

  // 승인된 콘텐츠를 실제 채널로 내보낸다. 가드는 handleApprove 가 씌운다.
  async function publishApprovedContent(item: { content: ContentItem; approval: ContentApprovalRecord }) {
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/publishing/instant`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channel: 'BOTH',
          contentId: item.content.id,
          versionId: item.content.id,
          fingerprint: item.content.fingerprint,
          approvalId: item.approval.id,
          caption: item.content.caption,
          idempotencyKey: `publish_${item.content.id}_${Date.now()}`,
        }),
      })

      const data = await res.json().catch(() => ({}))

      if (!res.ok || !data.success) {
        if (res.status === 403 || data.error?.code === 'SOHEE_NOT_READY') {
          setBlockerError(data.error?.message || '발행 준비가 완료되지 않아 실제 게시를 진행할 수 없습니다.')
          return
        }
        throw new Error(data.error?.message || '발행 처리에 실패했습니다.')
      }

      const igResult = data.results?.instagram
      const thResult = data.results?.threads
      const igVerified = Boolean(igResult?.success && (igResult?.verified ?? true))
      const thVerified = Boolean(thResult?.success && (thResult?.verified ?? true))

      if (igVerified && thVerified) {
        setActionSuccess('인스타그램과 스레드에 성공적으로 게시 및 검증되었습니다!')
      } else if (igVerified) {
        setActionSuccess('인스타그램에 게시되었습니다. (스레드는 검증 진행 중)')
      } else if (thVerified) {
        setActionSuccess('스레드에 게시되었습니다. (인스타그램은 검증 진행 중)')
      } else if (data.success) {
        setActionSuccess('게시 요청이 접수되었습니다. 채널 반영 확인 대기 중입니다.')
      } else {
        throw new Error(data.error?.message || '발행 처리에 실패했습니다.')
      }
      setTimeout(() => setActionSuccess(null), 4000)
      await loadData()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '발행 승인 중 오류가 발생했습니다.'
      alert(msg)
    }
  }

  // 3. Natural Language AI Revision
  function handleRevise(item: { content: ContentItem; approval: ContentApprovalRecord }) {
    const prompt = revisionInput[item.content.id]
    if (!prompt || !prompt.trim()) return

    const { newContent, invalidatedApproval } = reviseContentWithNaturalLanguage({
      content: item.content,
      existingApproval: item.approval,
      revisionPrompt: prompt,
    })

    setContents((prev) => ({
      ...prev,
      requiresAttention: prev.requiresAttention.map((x) =>
        x.content.id === item.content.id
          ? {
              content: newContent,
              approval: { ...invalidatedApproval, status: 'PENDING' },
            }
          : x
      ),
    }))
    setRevisionInput({ ...revisionInput, [item.content.id]: '' })
    setActionSuccess(`소희가 피드백을 반영해 V${newContent.version}으로 새로 다듬었습니다.`)
    setTimeout(() => setActionSuccess(null), 3000)
  }

  // 4. Direct Edit Save: Persist through server API (ANI-1041, Comment 4)
  async function handleSaveDirectEdit(item: { content: ContentItem & { versionId?: string }; approval: ContentApprovalRecord }) {
    if (!directEditCaption.trim() || !workspaceId) return
    setIsLoading(true)

    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/content/${item.content.id}/revisions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          expectedVersionId: item.content.versionId || item.content.id,
          caption: directEditCaption.trim(),
          revisionReason: '사장님 직접 문구 수정',
        }),
      })

      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.success) {
        throw new Error(data.error?.message || '문구 수정 저장에 실패했습니다.')
      }

      setEditingContentId(null)
      setDirectEditCaption('')
      setActionSuccess('수정한 문구가 서버에 저장되었으며 새로운 승인 지문이 발행되었습니다.')
      setTimeout(() => setActionSuccess(null), 3000)
      await loadData()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '문구 수정 저장 중 오류가 발생했습니다.'
      alert(msg)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-20">
      {/* Top Header Strip */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-0.5 text-xs font-bold bg-primary/10 text-primary border border-border rounded-full">
              콘텐츠 스튜디오
            </span>
            <span className="text-xs text-muted-foreground">3단계 결과 중심 워크벤치</span>
          </div>
          <h1 className="text-2xl font-black text-foreground mt-1 flex items-center gap-2.5">
            <FileText className="w-6 h-6 text-primary" />
            <span>콘텐츠 제작 및 발행</span>
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            ‘만드는 중 → 확인해 주세요 → 게시 완료’ 흐름으로 소희가 제작하고 사장님이 최종 승인합니다.
          </p>
        </div>

        <button
          type="button"
          onClick={handleCreateContent}
          disabled={isCreating}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold bg-primary hover:opacity-90 text-primary-foreground transition-all shadow-md shrink-0 cursor-pointer disabled:opacity-50 min-h-11"
        >
          {isCreating ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>작성 요청 중...</span>
            </>
          ) : (
            <>
              <Plus className="w-4 h-4" />
              <span>새 콘텐츠 부탁하기</span>
            </>
          )}
        </button>
      </div>

      {/* Active Standards Strip */}
      <ActiveHarnessStrip />

      {/* Blocker Alert */}
      {blockerError && (
        <div className="p-4 rounded-2xl bg-card border border-primary text-foreground text-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 animate-in fade-in">
          <div className="flex items-center gap-2.5">
            <AlertCircle className="w-5 h-5 text-primary shrink-0" />
            <div>
              <p className="font-bold">발행 준비 필요</p>
              <p className="text-xs text-muted-foreground">{blockerError}</p>
            </div>
          </div>
          <Link
            href="/app/sohee"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground font-bold text-xs hover:opacity-90 transition-opacity shrink-0 min-h-11"
          >
            <span>준비 상태 확인하기</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      )}

      {/* Action Success Alert */}
      {actionSuccess && (
        <div className="p-3.5 rounded-xl bg-card border border-border text-foreground text-xs flex items-center gap-2.5 animate-in fade-in shadow-xs">
          <CheckCircle2 className="w-4 h-4 text-primary shrink-0" />
          <span className="font-semibold">{actionSuccess}</span>
        </div>
      )}

      {/* 3-State Column Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Column 1: 만드는 중 */}
        <div className="space-y-4">
          <div className="flex items-center justify-between px-1">
            <div className="flex items-center gap-2">
              <div className="w-2.5 h-2.5 rounded-full bg-primary animate-pulse" />
              <h2 className="text-sm font-bold text-foreground">1. 만드는 중</h2>
              <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                {contents.inProgress.length}
              </span>
            </div>
            <span className="text-xs text-muted-foreground">소희 작업 중</span>
          </div>

          <div className="space-y-3">
            {isLoading ? (
              <div className="p-8 rounded-2xl bg-card border border-border flex flex-col items-center justify-center gap-2 text-muted-foreground text-xs">
                <Loader2 className="w-5 h-5 animate-spin text-primary" />
                <span>목록을 불러오는 중입니다...</span>
              </div>
            ) : contents.inProgress.length === 0 ? (
              <div className="p-8 rounded-2xl bg-card border border-dashed border-border flex flex-col items-center justify-center text-center gap-2 text-muted-foreground text-xs">
                <Inbox className="w-6 h-6 text-muted-foreground" />
                <p className="font-medium text-foreground">현재 제작 중인 콘텐츠가 없습니다.</p>
                <p className="text-xs text-muted-foreground">
                  우측 상단의 &apos;새 콘텐츠 부탁하기&apos;를 눌러 소희에게 글 작성을 요청해 보세요.
                </p>
              </div>
            ) : (
              contents.inProgress.map((item) => (
                <div
                  key={item.id}
                  className="p-4 rounded-2xl bg-card border border-border space-y-3 hover:border-border/80 transition-colors shadow-xs"
                >
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span className="font-semibold text-primary">초안 구상 중 (V{item.version})</span>
                    <button
                      type="button"
                      onClick={() => setSelectedLineage(item)}
                      className="text-muted-foreground hover:text-foreground underline text-xs cursor-pointer"
                    >
                      상세 정보
                    </button>
                  </div>

                  {item.imageUrl && (
                    <div className="relative aspect-[16/9] rounded-xl overflow-hidden bg-muted border border-border">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={item.imageUrl} alt="초안 이미지" className="w-full h-full object-cover" />
                    </div>
                  )}

                  <p className="text-xs text-foreground leading-relaxed break-words whitespace-pre-wrap">
                    {item.caption}
                  </p>

                  <div className="pt-2 border-t border-border flex items-center justify-between text-xs text-muted-foreground">
                    <span>채널: Instagram, Threads</span>
                    <span className="inline-flex items-center gap-1 text-primary">
                      <Clock className="w-3.5 h-3.5" />
                      <span>완료 후 승인 대기</span>
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Column 2: 확인해 주세요 */}
        <div className="space-y-4">
          <div className="flex items-center justify-between px-1">
            <div className="flex items-center gap-2">
              <div className="w-2.5 h-2.5 rounded-full bg-primary" />
              <h2 className="text-sm font-bold text-foreground">2. 확인해 주세요</h2>
              <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-border">
                {contents.requiresAttention.length}
              </span>
            </div>
            <span className="text-xs text-primary font-bold">사장님 승인 대기</span>
          </div>

          <div className="space-y-3">
            {isLoading ? (
              <div className="p-8 rounded-2xl bg-card border border-border flex flex-col items-center justify-center gap-2 text-muted-foreground text-xs">
                <Loader2 className="w-5 h-5 animate-spin text-primary" />
                <span>목록을 불러오는 중입니다...</span>
              </div>
            ) : contents.requiresAttention.length === 0 ? (
              <div className="p-8 rounded-2xl bg-card border border-dashed border-border flex flex-col items-center justify-center text-center gap-2 text-muted-foreground text-xs">
                <Inbox className="w-6 h-6 text-muted-foreground" />
                <p className="font-medium text-foreground">확인 대기 중인 콘텐츠가 없습니다.</p>
                <p className="text-xs text-muted-foreground">
                  소희가 글과 이미지를 다 작성하면 이곳에 나타나 사장님의 검토를 받습니다.
                </p>
              </div>
            ) : (
              contents.requiresAttention.map((item) => {
                const isDirectEditing = editingContentId === item.content.id

                return (
                  <div
                    key={item.content.id}
                    className="p-4 rounded-2xl bg-card border border-primary/40 ring-1 ring-primary/20 space-y-3 shadow-md"
                  >
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-bold text-primary">확인 필요 원고 (V{item.content.version})</span>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            if (isDirectEditing) {
                              setEditingContentId(null)
                            } else {
                              setEditingContentId(item.content.id)
                              setDirectEditCaption(item.content.caption)
                            }
                          }}
                          className="inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-foreground cursor-pointer"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                          <span>{isDirectEditing ? '취소' : '직접 수정'}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setSelectedLineage(item.content)}
                          className="text-muted-foreground hover:text-foreground underline text-xs cursor-pointer"
                        >
                          상세
                        </button>
                      </div>
                    </div>

                    {item.content.imageUrl && (
                      <div className="relative aspect-[16/9] rounded-xl overflow-hidden bg-muted border border-border">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={item.content.imageUrl} alt="확인 이미지" className="w-full h-full object-cover" />
                      </div>
                    )}

                    {/* Direct Edit Mode vs Display Mode */}
                    {isDirectEditing ? (
                      <div className="space-y-2 animate-in fade-in duration-200">
                        <label className="text-xs font-bold text-foreground block">
                          원문 직접 편집:
                        </label>
                        <textarea
                          rows={4}
                          value={directEditCaption}
                          onChange={(e) => setDirectEditCaption(e.target.value)}
                          className="w-full bg-muted border border-border rounded-xl p-3 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring leading-relaxed"
                          placeholder="수정할 문구를 자유롭게 입력하세요..."
                        />
                        <button
                          type="button"
                          onClick={() => handleSaveDirectEdit(item)}
                          className="w-full py-2 rounded-xl bg-primary text-primary-foreground text-xs font-bold flex items-center justify-center gap-1.5 hover:opacity-90 transition-opacity cursor-pointer min-h-11"
                        >
                          <Save className="w-4 h-4" />
                          <span>수정 내용 저장</span>
                        </button>
                      </div>
                    ) : (
                      <p className="text-xs text-foreground leading-relaxed break-words whitespace-pre-wrap">
                        {item.content.caption}
                      </p>
                    )}

                    {/* AI Prompt Revision Form */}
                    {!isDirectEditing && (
                      <div className="pt-2 border-t border-border space-y-2">
                        <div className="flex items-center gap-1.5">
                          <input
                            type="text"
                            placeholder="예: '광고 느낌 줄여줘', '문구 더 다정하게'..."
                            value={revisionInput[item.content.id] || ''}
                            onChange={(e) =>
                              setRevisionInput({ ...revisionInput, [item.content.id]: e.target.value })
                            }
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleRevise(item)
                            }}
                            className="flex-1 bg-muted border border-border rounded-lg px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring min-h-11"
                          />
                          <button
                            type="button"
                            onClick={() => handleRevise(item)}
                            disabled={!revisionInput[item.content.id]?.trim()}
                            className="px-3 py-1.5 rounded-lg bg-muted hover:bg-card border border-border text-foreground text-xs font-semibold disabled:opacity-40 transition-colors cursor-pointer min-h-11"
                          >
                            소희 수정
                          </button>
                        </div>

                        {/* Primary Action Button */}
                        <button
                          type="button"
                          onClick={() => handleApprove(item)}
                          className="w-full py-2.5 rounded-xl bg-primary hover:opacity-90 text-primary-foreground text-xs font-bold flex items-center justify-center gap-1.5 transition-all shadow-md cursor-pointer min-h-12"
                        >
                          <Check className="w-4 h-4 stroke-[2.5]" />
                          <span>승인하고 인스타그램 + 스레드에 동시 게시</span>
                        </button>
                      </div>
                    )}
                  </div>
                )
              })
            )}
          </div>
        </div>

        {/* Column 3: 게시 완료 */}
        <div className="space-y-4">
          <div className="flex items-center justify-between px-1">
            <div className="flex items-center gap-2">
              <div className="w-2.5 h-2.5 rounded-full bg-primary" />
              <h2 className="text-sm font-bold text-foreground">3. 게시 완료</h2>
              <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                {contents.published.length}
              </span>
            </div>
            <span className="text-xs text-muted-foreground">실시간 게시됨</span>
          </div>

          <div className="space-y-3">
            {isLoading ? (
              <div className="p-8 rounded-2xl bg-card border border-border flex flex-col items-center justify-center gap-2 text-muted-foreground text-xs">
                <Loader2 className="w-5 h-5 animate-spin text-primary" />
                <span>목록을 불러오는 중입니다...</span>
              </div>
            ) : contents.published.length === 0 ? (
              <div className="p-8 rounded-2xl bg-card border border-dashed border-border flex flex-col items-center justify-center text-center gap-2 text-muted-foreground text-xs">
                <Inbox className="w-6 h-6 text-muted-foreground" />
                <p className="font-medium text-foreground">아직 게시된 콘텐츠가 없습니다.</p>
                <p className="text-xs text-muted-foreground">
                  승인이 완료된 콘텐츠가 실제 소셜 미디어 채널에 게시되면 여기에 기록됩니다.
                </p>
              </div>
            ) : (
              contents.published.map((item) => (
                <div
                  key={item.content.id}
                  className="p-4 rounded-2xl bg-card border border-border space-y-3 hover:border-border/80 transition-colors shadow-xs"
                >
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-primary flex items-center gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>게시 성공 ({item.publishedAt})</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => setSelectedLineage(item.content)}
                      className="text-muted-foreground hover:text-foreground underline text-xs cursor-pointer"
                    >
                      세부 영수증
                    </button>
                  </div>

                  {item.content.imageUrl && (
                    <div className="relative aspect-[16/9] rounded-xl overflow-hidden bg-muted border border-border">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={item.content.imageUrl} alt="발행 이미지" className="w-full h-full object-cover" />
                    </div>
                  )}

                  <p className="text-xs text-foreground leading-relaxed break-words whitespace-pre-wrap">
                    {item.content.caption}
                  </p>

                  {/* Readback Live Links */}
                  {(item.igUrl || item.thUrl) && (
                    <div className="pt-2 border-t border-border flex items-center gap-2 text-xs">
                      {item.igUrl && (
                        <a
                          href={item.igUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-primary hover:underline"
                        >
                          <span>인스타그램 게시물</span>
                          <ExternalLink className="w-3.5 h-3.5" />
                        </a>
                      )}
                      {item.igUrl && item.thUrl && <span className="text-muted-foreground">·</span>}
                      {item.thUrl && (
                        <a
                          href={item.thUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-muted-foreground hover:underline"
                        >
                          <span>스레드 글</span>
                          <ExternalLink className="w-3.5 h-3.5" />
                        </a>
                      )}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Progressive Disclosure: Technical Detail Modal */}
      {selectedLineage && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-lg rounded-3xl bg-card border border-border p-6 space-y-4 shadow-2xl animate-in zoom-in-95">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <h3 className="text-base font-bold text-foreground flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-primary" />
                <span>상세 기술 영수증 & 라인이지</span>
              </h3>
              <button
                type="button"
                onClick={() => setSelectedLineage(null)}
                className="text-muted-foreground hover:text-foreground text-sm font-bold cursor-pointer"
              >
                닫기
              </button>
            </div>

            <div className="space-y-3 text-xs text-foreground">
              <div>
                <span className="text-muted-foreground block mb-0.5">콘텐츠 식별자:</span>
                <code className="bg-muted px-2 py-1 rounded border border-border">
                  {selectedLineage.id} (V{selectedLineage.version})
                </code>
              </div>
              <div>
                <span className="text-muted-foreground block mb-0.5">승인 상태 확인:</span>
                <span className="text-primary bg-muted px-2 py-1 rounded border border-border text-xs">
                  {selectedLineage.fingerprint ? '승인 기록이 저장돼 있어요' : '아직 승인 기록이 없어요'}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground block mb-0.5">적용된 기준 버전:</span>
                <p className="text-muted-foreground">
                  문체: {selectedLineage.harnessVersionSnapshot.textVersion} / 비주얼: {selectedLineage.harnessVersionSnapshot.imageVersion}
                </p>
              </div>
            </div>

            <div className="pt-2 border-t border-border flex justify-end">
              <button
                type="button"
                onClick={() => setSelectedLineage(null)}
                className="px-4 py-2 rounded-xl bg-primary text-primary-foreground font-bold text-xs hover:opacity-90 transition-opacity cursor-pointer min-h-11"
              >
                확인
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
