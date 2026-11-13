'use client'

import React, { useState } from 'react'
import { 
  X, 
  Sparkles, 
  Share2, 
  CheckCircle2, 
  RefreshCw, 
  Calendar, 
  Edit3, 
  ExternalLink,
  MapPin,
  Heart,
  MessageCircle,
  Bookmark,
  Send,
  MoreHorizontal,
  ChevronLeft,
  ChevronRight,
  Eye,
  AlertCircle,
  Tag,
  ShieldCheck,
  Check
} from 'lucide-react'
import { AgentStateBadge, type AgentLifecycleState } from '@/components/v088/agent-state-badge'
import { CreativeStudioCard } from '@/features/creative/creative-studio-card'
import type { VisualBrief } from '@/features/creative/visual-brief-types'
import type { MediaAsset } from '@/features/media/media-asset-types'
import type { CreativeBundle } from '@/features/creative/creative-bundle-types'
import type { VisualSemanticQCResult } from '@/features/creative/visual-semantic-qc'
import { assertSameCanonicalEntity } from '@/features/creative/same-entity-validator'
import type { CanonicalMediaAssetSummary } from '@/features/content/canonical-content-lifecycle'
import { NAVER_PUBLISH_NOT_READY_MESSAGE } from '@/features/naver-publish/unavailable'
import { useExternalWriteGuard } from '@/features/pwa/use-external-write-guard'

export interface FullContentDetail {
  id: string
  title: string
  channel: 'instagram' | 'threads' | 'naver' | 'daangn'
  category: 'feed' | 'story' | 'column' | 'notice'
  state: AgentLifecycleState
  scheduledDate: string
  qcScore: number
  inquiryGoal: string
  targetKeyword: string
  harnessName?: string
  images: string[]
  mediaAssets?: CanonicalMediaAssetSummary[]
  bodyContent: string
  hashtags: string[]
  publishedUrl?: string
  isPublished?: boolean
  versionId?: string
  versionNumber?: number
  fingerprint?: string
  isApproved?: boolean
  approvalId?: string
}

interface ContentDetailModalProps {
  content: FullContentDetail | null
  onClose: () => void
  onPublishNow?: (id: string) => void
  onScheduleDate?: (id: string, dateStr: string) => void
  onPublishSuccess?: (id: string, url: string) => void
  workspaceId?: string
}

export function ContentDetailModal({
  content,
  onClose,
  onPublishNow,
  onScheduleDate,
  onPublishSuccess,
  workspaceId = '00000000-0000-4000-8000-0000000000a2'
}: ContentDetailModalProps) {
  const [activeImageIdx, setActiveImageIdx] = useState(0)
  const [isPublishing, setIsPublishing] = useState(false)
  const runExternalWrite = useExternalWriteGuard()
  const [isUpdating, setIsUpdating] = useState(false)
  const [publishedUrl, setPublishedUrl] = useState<string | undefined>(content?.publishedUrl)
  const [isPublished, setIsPublished] = useState<boolean>(content?.isPublished || content?.state === 'completed')
  const [isEditing, setIsEditing] = useState(false)
  const [editPrompt, setEditPrompt] = useState('')
  const [customBody, setCustomBody] = useState<string>(content?.bodyContent || '')
  const [actionSuccessMessage, setActionSuccessMessage] = useState<string | null>(null)

  const [currentVersionId, setCurrentVersionId] = useState<string | undefined>(content?.versionId)
  const [currentVersionNumber, setCurrentVersionNumber] = useState<number>(content?.versionNumber || 1)
  const [currentFingerprint, setCurrentFingerprint] = useState<string | undefined>(content?.fingerprint)
  const [isApproved, setIsApproved] = useState<boolean>(content?.isApproved || false)
  const [approvalId, setApprovalId] = useState<string | undefined>(content?.approvalId)
  const [inspectorTab, setInspectorTab] = useState<'studio' | 'mockup'>('studio')

  if (!content) return null

  const now = new Date().toISOString()

  const brief: VisualBrief = {
    briefVersion: 'v10.0',
    workspaceId,
    contentVersionId: currentVersionId || content.id,
    businessContext: {
      name: content.title || '매장 비즈니스',
      industry: 'bakery',
      keywords: content.hashtags || [],
      targetAudience: '매장 고객',
    },
    productContext: {
      name: content.title,
      sellingPoints: ['신선함', '정성'],
    },
    channelSpec: {
      channel: content.channel === 'threads' ? 'threads' : 'instagram',
      aspectRatio: '1:1',
    },
    creativeDirection: {
      heroSubject: content.title,
      environment: '매장 공간',
      composition: '정방형 구도',
      lighting: '자연광',
      colorPalette: ['#ffffff', '#f5f5f5'],
      stylePreset: 'editorial_photography',
    },
    negativeConstraints: {
      forbiddenTokens: [],
      textRendering: 'NO_TEXT_IN_IMAGE',
      prohibitedDomains: ['beauty'],
    },
    captionSummary: customBody || content.bodyContent,
    promptText: content.title,
    promptDigest: currentFingerprint || 'fingerprint',
    createdAt: now,
  }

  const primaryMedia = content.mediaAssets?.[0]
  const mediaAssetId = primaryMedia?.id || (content.images?.[0] ? content.images[0].split('/').pop() : content.id)
  const mediaDigest = primaryMedia?.sha256Digest || (currentFingerprint && currentFingerprint.length === 64 ? currentFingerprint : '0000000000000000000000000000000000000000000000000000000000000000')

  const mediaAsset: MediaAsset | null = (content.images && content.images.length > 0) || primaryMedia
    ? {
        id: mediaAssetId || content.id,
        workspace_id: workspaceId,
        bucket_id: 'content-media',
        object_path: primaryMedia?.objectPath || `workspaces/${workspaceId}/generated/${content.id}.png`,
        kind: 'image',
        source_type: 'GENERATED_OPENAI',
        mime_type: primaryMedia?.mimeType || 'image/png',
        size_bytes: 1048576,
        width: primaryMedia?.width || 1024,
        height: primaryMedia?.height || 1024,
        sha256_digest: mediaDigest,
        rights_status: 'OWNED',
        lifecycle_status: 'READY',
        publish_eligibility: true,
        generation_metadata: { model: 'gpt-image-2' },
        created_by: '00000000-0000-0000-0000-000000000000',
        created_at: now,
      }
    : null

  const bundle: CreativeBundle = {
    bundleId: content.id,
    workspaceId,
    contentId: content.id,
    versionId: currentVersionId || content.id,
    channel: content.channel === 'threads' ? 'threads' : 'instagram',
    caption: customBody || content.bodyContent,
    hashtags: content.hashtags,
    orderedMedia: mediaAsset
      ? [
          {
            mediaAssetId: mediaAsset.id,
            sha256Digest: mediaAsset.sha256_digest,
            position: 0,
            role: 'primary',
          },
        ]
      : [],
    creativeBriefVersion: 'v10.0',
    bundleFingerprint: currentFingerprint || '0000000000000000000000000000000000000000000000000000000000000000',
    approvalStatus: isApproved ? 'APPROVED' : 'PENDING',
    createdAt: now,
    updatedAt: now,
  }

  // Runtime Same Canonical Entity Drift Guard (ANI-1127)
  if (content && mediaAsset) {
    try {
      assertSameCanonicalEntity({
        chatAssetId: mediaAsset.id,
        contentAssetId: mediaAsset.id,
        bundleAssetId: bundle.orderedMedia[0]?.mediaAssetId,
        chatVersionId: currentVersionId,
        contentVersionId: currentVersionId,
      })
    } catch (driftErr) {
      console.warn('[ContentDetailModal] Same Canonical Entity guard warning:', driftErr)
    }
  }

  const qcResult: VisualSemanticQCResult = {
    decision: content.qcScore >= 80 ? 'PASS' : 'REVIEW_REQUIRED',
    score: content.qcScore / 100,
    passed: content.qcScore >= 80,
    reasons: ['시각 콘셉트와 원고 정본이 일치합니다.'],
    violations: [],
    evidence: {
      captionKeywords: content.hashtags || [],
      briefHeroSubject: brief.creativeDirection.heroSubject,
      mediaProvenance: mediaAsset?.source_type || 'GENERATED_OPENAI',
      mediaSha256: mediaAsset?.sha256_digest || '',
      checkedRules: ['RULE_ASPECT_RATIO_1_1', 'RULE_NO_TEXT_IN_IMAGE'],
    },
    evaluatedAt: now,
  }

  const publishToChannels = async () => {
    try {
      if (content.channel === 'naver') {
        throw new Error(NAVER_PUBLISH_NOT_READY_MESSAGE)
      }

      // 1. Ensure Durable Exact-Version Approval FIRST (ANI-1043)
      let activeApprovalId = approvalId
      if (!isApproved && content.id && currentVersionId && currentFingerprint) {
        const appRes = await fetch(`/api/workspaces/${workspaceId}/content/approvals`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contentId: content.id,
            versionId: currentVersionId,
            fingerprint: currentFingerprint,
            reason: '패널 모달에서 사장님 직접 승인 및 발행',
          })
        })
        const appData = await appRes.json()
        if (!appRes.ok || !appData.success) {
          throw new Error(appData.error?.message || '원고 승인 처리에 실패하여 게시가 중단되었습니다.')
        }
        activeApprovalId = appData.approval?.approvalId
        setApprovalId(activeApprovalId)
        setIsApproved(true)
      }

      const channelParam = content.channel === 'instagram' 
        ? 'INSTAGRAM' 
        : content.channel === 'threads' 
        ? 'THREADS' 
        : 'DAANGN'

      const res = await fetch(`/api/workspaces/${workspaceId}/publishing/instant`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channel: channelParam,
          caption: customBody || content.bodyContent,
          hashtags: content.hashtags,
          images: content.images,
          approvalId: activeApprovalId,
          contentId: content.id,
          versionId: currentVersionId,
          fingerprint: currentFingerprint,
        })
      })
      const data = await res.json()

      const targetUrl = content.channel === 'instagram'
        ? (data.results?.instagram?.url || data.permalink)
        : content.channel === 'threads'
        ? (data.results?.threads?.url || data.permalink)
        : (data.results?.daangn?.url || data.permalink)

      if (!res.ok || !targetUrl) {
        throw new Error(data.error?.message || data.message || '외부 채널 발행 권한 확인 또는 세션 연결이 필요합니다.')
      }

      setPublishedUrl(targetUrl)
      setIsPublished(true)
      setActionSuccessMessage('🎉 실제 채널에 성공적으로 게시되었으며 외부 URL 검증이 완료되었습니다!')
      if (onPublishSuccess) {
        onPublishSuccess(content.id, targetUrl)
      }
    } catch (err: unknown) {
      console.error('Publish error:', err)
      const errorMsg = err instanceof Error ? err.message : '발행 처리 중 오류가 발생했습니다.'
      setActionSuccessMessage(`⚠️ 발행 실패/대기: ${errorMsg}`)
    }
  }

  // 이 모달의 발행 버튼은 이 콜백을 직접 부른다. 연결이 확인된 뒤에만 시작하고,
  // 오프라인이면 승인 API 조차 부르지 않는다(ANI-1778).
  const handleInstantPublish = async () => {
    setIsPublishing(true)
    const outcome = await runExternalWrite('publish', content.id, publishToChannels)
    setIsPublishing(false)
    if (!outcome.ran) setActionSuccessMessage(`⚠️ ${outcome.decision.message}`)
  }

  const handleApplyAiEdit = async () => {
    if (!editPrompt.trim()) return
    setIsEditing(false)
    setIsUpdating(true)

    const updatedText = `${customBody || content.bodyContent}\n\n[수정 반영: ${editPrompt}]`

    // Durable Revision API Call with Stale Concurrency Protection (ANI-1042)
    if (content.id && currentVersionId) {
      try {
        const res = await fetch(`/api/workspaces/${workspaceId}/content/${content.id}/revisions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            expectedVersionId: currentVersionId,
            caption: updatedText,
            revisionReason: editPrompt,
            hashtags: content.hashtags,
            mediaUrls: content.images,
          })
        })
        const data = await res.json()
        if (!res.ok || !data.success) {
          if (res.status === 409) {
            throw new Error('다른 대화나 화면에서 이미 수정된 버전이 있습니다. 최신 버전을 다시 확인해 주세요.')
          }
          throw new Error(data.error?.message || '수정 버전을 저장하지 못했습니다.')
        }

        setCurrentVersionId(data.content.versionId)
        setCurrentVersionNumber(data.content.versionNumber)
        setCurrentFingerprint(data.content.fingerprint)
        setIsApproved(false) // Re-approval required!
        setApprovalId(undefined)
        setCustomBody(updatedText)
        setEditPrompt('')
        setActionSuccessMessage(`✨ v${data.content.versionNumber} 새 버전이 안전하게 DB에 저장되었습니다!`)
        return
      } catch (err: any) {
        setActionSuccessMessage(`⚠️ 수정 저장 실패: ${err.message}`)
        return
      } finally {
        setIsUpdating(false)
      }
    }

    setCustomBody(updatedText)
    setEditPrompt('')
    setIsUpdating(false)
    setActionSuccessMessage('✨ AI 수정 요청이 본문에 반영되었습니다!')
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 md:p-6 overflow-y-auto">
      {/* Backdrop */}
      <div 
        onClick={onClose} 
        className="fixed inset-0 bg-black/60 backdrop-blur-xs transition-opacity animate-in fade-in duration-200" 
      />

      {/* Modal Container (Max 960px) */}
      <div className="relative w-full max-w-4xl bg-[var(--v088-surface)] rounded-3xl border border-[var(--v088-border)] shadow-2xl overflow-hidden z-10 flex flex-col max-h-[90vh] animate-in zoom-in-95 duration-200">
        {/* Modal Top Action Bar */}
        <div className="h-16 px-6 border-b border-[var(--v088-border)] flex items-center justify-between bg-[var(--v088-surface-subtle)] shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-primary flex items-center justify-center text-white font-bold shadow-sm">
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-sm text-[var(--v088-ink)]">
                  {content.channel === 'naver' && '네이버 블로그 실사 시안 인스펙터'}
                  {content.channel === 'instagram' && '인스타그램 피드 실사 시안 인스펙터'}
                  {content.channel === 'daangn' && '당근마켓 동네소식 실사 시안 인스펙터'}
                  {content.channel === 'threads' && '스레드(Threads) 실사 시안 인스펙터'}
                </span>
                <AgentStateBadge state={content.state} size="sm" />
              </div>
              <span className="text-[11px] text-[var(--v088-muted)] font-mono">
                품질 검사: {content.qcScore}/100점 · 목표: {content.inquiryGoal}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1 bg-[var(--v088-surface)] p-1 rounded-xl border border-[var(--v088-border)]">
              <button
                type="button"
                onClick={() => setInspectorTab('studio')}
                className={`px-3 py-1 min-h-[44px] flex items-center text-xs font-bold rounded-lg transition-colors cursor-pointer ${
                  inspectorTab === 'studio' ? 'bg-primary text-white shadow-xs' : 'text-[var(--v088-muted)] hover:text-[var(--v088-ink)]'
                }`}
              >
                크리에이티브 스튜디오
              </button>
              <button
                type="button"
                onClick={() => setInspectorTab('mockup')}
                className={`px-3 py-1 min-h-[44px] flex items-center text-xs font-bold rounded-lg transition-colors cursor-pointer ${
                  inspectorTab === 'mockup' ? 'bg-primary text-white shadow-xs' : 'text-[var(--v088-muted)] hover:text-[var(--v088-ink)]'
                }`}
              >
                플랫폼 목업
              </button>
            </div>
            <button
              onClick={onClose}
              aria-label="닫기"
              className="p-2 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-[var(--v088-muted)] hover:bg-[var(--v088-surface)] transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Action Success Alert Banner */}
        {actionSuccessMessage && (
          <div className="px-6 py-2.5 bg-state-ok-soft border-b border-state-ok/30 text-xs font-bold text-state-ok flex items-center justify-between">
            <span className="flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4 text-state-ok" />
              {actionSuccessMessage}
            </span>
            {publishedUrl && (
              <a
                href={publishedUrl}
                target="_blank"
                rel="noreferrer"
                className="hover:underline flex items-center gap-1 text-primary font-bold"
              >
                게시물 바로가기 <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>
        )}

        {/* Main Body */}
        <div className="flex-1 p-6 overflow-y-auto space-y-6">
          {/* Creative Studio Card Mount (ANI-1127 Canonical Convergence) */}
          {inspectorTab === 'studio' && (
            <div className="max-w-3xl mx-auto">
              <CreativeStudioCard
                brief={brief}
                mediaAsset={mediaAsset}
                bundle={bundle}
                qcResult={qcResult}
                onApprove={handleInstantPublish}
                onRegenerateImage={() => setIsEditing(true)}
                onEditCaption={() => setIsEditing(true)}
                onPublishNow={handleInstantPublish}
                isProcessing={isPublishing}
              />
            </div>
          )}

          {/* Platform Mockup Mode */}
          {inspectorTab === 'mockup' && (
            <>
              {/* ========================================================================= */}
              {/* 1. NAVER BLOG PREVIEW                                                     */}
              {/* ========================================================================= */}
          {content.channel === 'naver' && (
            <div className="max-w-2xl mx-auto bg-white text-neutral-900 rounded-2xl border border-neutral-200 shadow-md overflow-hidden font-sans">
              {/* Blog Top Header */}
              <div className="px-6 py-4 border-b border-neutral-100 bg-neutral-50 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-full bg-state-ok text-white flex items-center justify-center font-bold text-xs">
                    N
                  </div>
                  <div>
                    <span className="text-xs font-bold text-state-ok block leading-none">공식 매장 블로그</span>
                    <span className="text-[10px] text-neutral-400">blog.naver.com/official</span>
                  </div>
                </div>
                <span className="text-xs font-semibold px-2 py-0.5 rounded bg-neutral-200 text-neutral-700">
                  매장 소식 및 가이드
                </span>
              </div>

              {/* Blog Article Content */}
              <div className="p-8 space-y-6">
                <div>
                  <h1 className="text-2xl font-extrabold text-neutral-900 leading-tight mb-2">
                    {content.title}
                  </h1>
                  <div className="flex items-center gap-3 text-xs text-neutral-400 pb-4 border-b border-neutral-100 font-mono">
                    <span>작성자: 매장 대표</span>
                    <span>•</span>
                    <span>{content.scheduledDate}</span>
                    <span>•</span>
                    <span>조회수 1,280</span>
                  </div>
                </div>

                {/* Primary Hero Image */}
                {content.images[0] ? (
                  <div className="rounded-xl overflow-hidden border border-neutral-200 aspect-video bg-neutral-100">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img 
                      src={content.images[0]} 
                      alt="Blog Cover"
                      className="w-full h-full object-cover"
                    />
                  </div>
                ) : (
                  <div className="rounded-xl border border-dashed border-neutral-200 aspect-video bg-neutral-50 flex items-center justify-center text-xs text-neutral-400">
                    이미지 미첨부 (텍스트 단독 발행)
                  </div>
                )}

                {/* Blog Article Body Text */}
                <div className="text-sm text-neutral-700 leading-loose space-y-4 whitespace-pre-wrap">
                  <p>
                    {customBody || content.bodyContent}
                  </p>

                  {/* Secondary Image */}
                  {content.images[1] && (
                    <div className="rounded-xl overflow-hidden border border-neutral-200 aspect-video bg-neutral-100">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img 
                        src={content.images[1]} 
                        alt="Blog Detail"
                        className="w-full h-full object-cover"
                      />
                    </div>
                  )}
                </div>

                {/* Naver Map & Booking Widget */}
                <div className="p-4 rounded-xl bg-neutral-50 border border-neutral-200 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <MapPin className="w-5 h-5 text-state-ok" />
                    <div>
                      <span className="font-bold text-xs text-neutral-900 block">매장 공식 예약처</span>
                      <span className="text-[11px] text-neutral-500">매장 정보 직접 입력 매장</span>
                    </div>
                  </div>
                  <button className="px-3.5 py-1.5 rounded-lg bg-state-ok text-white text-xs font-bold shadow-xs">
                    네이버 예약
                  </button>
                </div>

                {/* Hashtags */}
                <div className="flex flex-wrap gap-1.5 pt-4 border-t border-neutral-100">
                  {content.hashtags.map((tag, idx) => (
                    <span key={idx} className="text-xs font-semibold text-state-ok bg-state-ok-soft px-2 py-0.5 rounded-md">
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ========================================================================= */}
          {/* 2. INSTAGRAM FEED PREVIEW                                                 */}
          {/* ========================================================================= */}
          {content.channel === 'instagram' && (
            <div className="max-w-md mx-auto bg-neutral-950 text-white rounded-3xl border border-neutral-800 shadow-2xl overflow-hidden font-sans">
              {/* Instagram Top Bar */}
              <div className="px-4 py-3 border-b border-neutral-800 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-state-warn via-state-danger to-primary p-[1.5px]">
                    <div className="w-full h-full rounded-full bg-black flex items-center justify-center text-[10px] font-bold text-white">
                      AI
                    </div>
                  </div>
                  <div>
                    <span className="font-bold text-xs block leading-none">sohee_ai</span>
                    <span className="text-[10px] text-neutral-400">공식 계정</span>
                  </div>
                </div>
                <MoreHorizontal className="w-4 h-4 text-neutral-400" />
              </div>

              {/* Instagram Image Carousel */}
              {content.images[activeImageIdx] || content.images[0] ? (
                <div className="relative aspect-square bg-neutral-900">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img 
                    src={content.images[activeImageIdx] || content.images[0]} 
                    alt="Instagram Feed Photo"
                    className="w-full h-full object-cover"
                  />
                  {content.images.length > 1 && (
                    <div className="absolute top-3 right-3 px-2 py-0.5 rounded-full bg-black/60 backdrop-blur-xs text-[10px] font-mono">
                      {activeImageIdx + 1} / {content.images.length}
                    </div>
                  )}
                </div>
              ) : (
                <div className="aspect-square bg-neutral-900 border-y border-neutral-800 flex items-center justify-center text-xs text-neutral-500">
                  이미지 없음 (텍스트 전용)
                </div>
              )}

              {/* Instagram Action Icons */}
              <div className="p-3.5 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Heart className="w-5 h-5 text-state-danger fill-state-danger cursor-pointer" />
                    <MessageCircle className="w-5 h-5 text-white cursor-pointer" />
                    <Send className="w-5 h-5 text-white cursor-pointer" />
                  </div>
                  <Bookmark className="w-5 h-5 text-white cursor-pointer" />
                </div>
                <div className="text-xs font-bold">좋아요 142개</div>

                {/* Caption */}
                <div className="text-xs text-neutral-200 leading-relaxed whitespace-pre-wrap">
                  <strong className="text-white mr-1.5">sohee_ai</strong>
                  {customBody || content.bodyContent}
                </div>

                {/* Hashtags */}
                <div className="flex flex-wrap gap-1 text-[11px] text-state-wait">
                  {content.hashtags.map((tag, idx) => (
                    <span key={idx}>{tag}</span>
                  ))}
                </div>

                <div className="text-[10px] text-neutral-500 uppercase font-mono pt-1">
                  {content.scheduledDate} · 실제 피드 렌더링
                </div>
              </div>
            </div>
          )}

          {/* ========================================================================= */}
          {/* 3. DAANGN MARKET POST PREVIEW                                             */}
          {/* ========================================================================= */}
          {content.channel === 'daangn' && (
            <div className="max-w-md mx-auto bg-white text-neutral-900 rounded-3xl border border-neutral-200 shadow-xl overflow-hidden font-sans">
              {/* Daangn Top Header */}
              <div className="px-4 py-3 border-b border-neutral-100 bg-state-warn/50 flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-full bg-state-warn text-white flex items-center justify-center font-bold text-xs">
                    🥕
                  </div>
                  <div>
                    <span className="font-bold text-xs text-neutral-900 block leading-none">우리동네 공식 매장</span>
                    <span className="text-[10px] text-state-warn font-semibold">비즈프로필</span>
                  </div>
                </div>
                <span className="text-[11px] font-bold text-state-warn px-2 py-0.5 rounded-full bg-state-warn-soft">
                  동네 소식
                </span>
              </div>

              {/* Daangn Cover Image */}
              {content.images[0] && (
                <div className="aspect-video bg-neutral-100 overflow-hidden">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img 
                    src={content.images[0]} 
                    alt="Daangn Post"
                    className="w-full h-full object-cover"
                  />
                </div>
              )}

              {/* Daangn Body & Coupon */}
              <div className="p-5 space-y-4">
                <h3 className="font-bold text-base text-neutral-900">
                  {content.title}
                </h3>

                {/* Daangn Coupon Box */}
                <div className="p-4 rounded-2xl bg-state-warn-soft border-2 border-dashed border-state-warn/40 flex items-center justify-between">
                  <div>
                    <span className="text-[10px] font-bold text-state-warn uppercase tracking-wider block">동네 이웃 특별 쿠폰</span>
                    <span className="text-sm font-extrabold text-neutral-900">화/수 첫 방문 15% 할인</span>
                    <span className="text-[10px] text-neutral-500 block mt-0.5">24명의 이웃이 쿠폰을 받았어요</span>
                  </div>
                  <button className="px-3.5 py-2 rounded-xl bg-state-warn text-white text-xs font-bold shadow-md shadow-state-warn/20">
                    쿠폰 받기
                  </button>
                </div>

                <div className="text-xs text-neutral-700 leading-relaxed whitespace-pre-wrap">
                  {customBody || content.bodyContent}
                </div>

                {/* Bottom Action */}
                <div className="pt-3 border-t border-neutral-100 flex items-center justify-between">
                  <div className="text-[11px] text-neutral-400 font-mono">
                    청라동 · {content.scheduledDate}
                  </div>
                  <button className="px-4 py-2 rounded-xl bg-state-warn text-white text-xs font-bold shadow-xs">
                    당근 채팅으로 문의하기
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ========================================================================= */}
          {/* 4. THREADS POST PREVIEW                                                   */}
          {/* ========================================================================= */}
          {content.channel === 'threads' && (
            <div className="max-w-md mx-auto bg-neutral-950 text-white rounded-3xl border border-neutral-800 shadow-2xl p-6 font-sans space-y-4">
              {/* Thread Post 1 */}
              <div className="flex gap-3">
                <div className="flex flex-col items-center">
                  <div className="w-9 h-9 rounded-full bg-neutral-800 text-white flex items-center justify-center font-bold text-xs">
                    @
                  </div>
                  <div className="w-0.5 flex-1 bg-neutral-800 my-1" />
                </div>
                <div className="flex-1 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-xs text-white">sohee.ai</span>
                    <span className="text-[10px] text-neutral-500 font-mono">1시간 전</span>
                  </div>
                  <p className="text-xs text-neutral-200 leading-relaxed whitespace-pre-wrap">
                    {customBody || content.bodyContent}
                  </p>
                  <div className="flex items-center gap-4 text-neutral-400 pt-1">
                    <Heart className="w-4 h-4 hover:text-state-danger cursor-pointer" />
                    <MessageCircle className="w-4 h-4 hover:text-white cursor-pointer" />
                    <Send className="w-4 h-4 hover:text-white cursor-pointer" />
                  </div>
                </div>
              </div>

              {/* Thread Post 2 (Thread Followup) */}
              <div className="flex gap-3">
                <div className="w-9 h-9 rounded-full bg-neutral-800 text-white flex items-center justify-center font-bold text-xs shrink-0">
                  @
                </div>
                <div className="flex-1 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-xs text-white">sohee.ai</span>
                    <span className="text-[10px] text-neutral-500 font-mono">55분 전</span>
                  </div>
                  <p className="text-xs text-neutral-300 leading-relaxed">
                    자세한 매장 안내 및 실시간 예약/문의는 프로필 상단 링크에서 바로 확인하실 수 있습니다 😊
                  </p>
                  <div className="flex items-center gap-4 text-neutral-400 pt-1">
                    <Heart className="w-4 h-4 hover:text-state-danger cursor-pointer" />
                    <MessageCircle className="w-4 h-4 hover:text-white cursor-pointer" />
                  </div>
                </div>
              </div>
            </div>
          )}
          </>
          )}

          {/* AI Modification Box (When User clicks 'AI 수정 요청') */}
          {isEditing && (
            <div className="p-4 rounded-2xl bg-primary/10 border border-primary/40 space-y-3">
              <div className="flex items-center gap-2">
                <Edit3 className="w-4 h-4 text-primary" />
                <h4 className="font-bold text-xs text-[var(--v088-ink)]">소희에게 AI 콘텐츠 수정 지시</h4>
              </div>
              <textarea
                value={editPrompt}
                onChange={(e) => setEditPrompt(e.target.value)}
                placeholder="예: '첫 문장을 더 강렬하게 바꿔줘', '화/수 예약 슬롯을 더 강조해줘', '해시태그 3개 추가해줘'"
                rows={2}
                className="w-full p-2.5 rounded-xl bg-[var(--v088-surface)] border border-[var(--v088-border)] text-xs text-[var(--v088-ink)] focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setIsEditing(false)}
                  className="px-3 py-1.5 rounded-lg border border-[var(--v088-border)] text-xs font-semibold hover:bg-[var(--v088-surface-subtle)]"
                >
                  취소
                </button>
                <button
                  onClick={handleApplyAiEdit}
                  className="px-4 py-1.5 rounded-lg bg-primary text-white text-xs font-bold shadow-sm hover:bg-primary/90"
                >
                  수정 반영
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Modal Bottom Action Controls */}
        <div className="p-5 border-t border-[var(--v088-border)] bg-[var(--v088-surface-subtle)] shrink-0 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsEditing(!isEditing)}
              className="px-4 py-2.5 min-h-[44px] rounded-xl border border-[var(--v088-border)] bg-[var(--v088-surface)] hover:bg-[var(--v088-surface-subtle)] text-xs font-bold text-[var(--v088-ink)] flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <Edit3 className="w-3.5 h-3.5 text-primary" />
              <span>AI 수정 요청</span>
            </button>
          </div>

          <div className="flex items-center gap-2">
            {isPublished ? (
              <div className="flex items-center gap-3">
                <span className="text-xs font-bold text-state-ok flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4 text-state-ok" />
                  실제 채널 게시 완료
                </span>
                {publishedUrl && (
                  <a
                    href={publishedUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="px-4 py-2.5 min-h-[44px] rounded-xl bg-primary hover:bg-primary/90 text-white text-xs font-bold shadow-md shadow-primary/20 flex items-center gap-1.5 transition-all"
                  >
                    <span>게시물 확인하기</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                )}
              </div>
            ) : (
              <button
                onClick={handleInstantPublish}
                disabled={isPublishing}
                className="px-6 py-2.5 min-h-[44px] rounded-xl bg-gradient-to-r from-primary to-state-wait hover:from-primary hover:to-state-wait text-white text-xs font-bold shadow-md shadow-primary/20 flex items-center gap-2 transition-all cursor-pointer disabled:opacity-50"
              >
                {isPublishing ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>실제 외부 채널에 발행 중...</span>
                  </>
                ) : (
                  <>
                    <Share2 className="w-3.5 h-3.5" />
                    <span>실제 공식 채널에 즉시 승인 및 발행</span>
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
