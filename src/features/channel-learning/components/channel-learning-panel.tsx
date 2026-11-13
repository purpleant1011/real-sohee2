'use client'

import React, { useState } from 'react'
import Link from 'next/link'
import {
  AlertCircle,
  ExternalLink,
  Globe,
  Plus,
  RefreshCw,
  ShieldAlert,
} from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { ChannelSourceCard } from './channel-source-card'
import { ChannelReviewDialog } from './channel-review-dialog'
import { useChannelLearning } from '../use-channel-learning'
import type {
  LearningCandidate,
  LearningPlatform,
  LearningSource,
  ReviewDecisionItem,
} from '../contracts'

export interface ChannelLearningPanelProps {
  workspaceId: string
  canManage: boolean
  onKnowledgeUpdated?: () => void
  fetcher?: typeof fetch
}

function detectPlatformFromUrl(url: string): LearningPlatform | null {
  try {
    const host = new URL(url).hostname.toLowerCase()
    if (host.includes('instagram.com')) return 'instagram'
    if (host.includes('threads.net') || host.includes('threads.com')) return 'threads'
    if (host.includes('blog.naver.com')) return 'naver_blog'
    if (host.includes('map.naver.com') || host.includes('naver.me') || host.includes('place.naver.com'))
      return 'naver_place'
    if (host.includes('daangn.com')) return 'daangn_business'
    if (host.length > 0) return 'website'
    return null
  } catch {
    return null
  }
}

export function ChannelLearningPanel({
  workspaceId,
  canManage,
  onKnowledgeUpdated,
  fetcher,
}: ChannelLearningPanelProps) {
  const {
    sources,
    capabilities,
    isLoading,
    error: hookError,
    errorCode,
    addSource,
    verifySource,
    startCollection,
    cancelSource,
    deleteSource,
    reviewCandidates,
    fetchSourceDetail,
  } = useChannelLearning({
    workspaceId,
    canManage,
    onKnowledgeUpdated,
    fetcher,
  })

  // URL input form state
  const [urlInput, setUrlInput] = useState('')
  const [detectedPlatform, setDetectedPlatform] = useState<LearningPlatform>('instagram')
  const [consentText, setConsentText] = useState(false)
  const [consentImages, setConsentImages] = useState(false)
  const [isRegistering, setIsRegistering] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  // Mobile IA Step state (mobile viewports)
  const [mobileStep, setMobileStep] = useState<'register' | 'channels'>('register')

  // Review modal state
  const [activeReviewSource, setActiveReviewSource] = useState<LearningSource | null>(null)
  const [reviewCandidatesList, setReviewCandidatesList] = useState<LearningCandidate[]>([])
  const [isSubmittingReview, setIsSubmittingReview] = useState(false)

  // 워크스페이스 변경 시 열려 있던 리뷰 모달 닫기 (stale source 오염 방지: React prop 동기화 정석 패턴)
  const [prevWorkspaceId, setPrevWorkspaceId] = useState(workspaceId)
  if (prevWorkspaceId !== workspaceId) {
    setPrevWorkspaceId(workspaceId)
    setActiveReviewSource(null)
    setReviewCandidatesList([])
  }

  const activeCapability = capabilities.find((c) => c.platform === detectedPlatform)
  const isPlatformBlocked = activeCapability?.collectionMode === 'blocked'
  const isPlatformManualOnly = activeCapability?.collectionMode === 'manual_only'

  const handleUrlChange = (value: string) => {
    setUrlInput(value)
    setFormError(null)
    const detected = detectPlatformFromUrl(value.trim())
    if (detected) {
      setDetectedPlatform(detected)
    }
  }

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!urlInput.trim()) return

    if (!consentText && !consentImages) {
      setFormError('게시물 텍스트나 이미지 중 최소 하나 이상의 활용 동의가 필요합니다.')
      return
    }

    if (isPlatformBlocked) {
      setFormError('이 채널은 현재 공식 연동이 지원되지 않아 자동 수집이 차단되어 있습니다.')
      return
    }

    setIsRegistering(true)
    setFormError(null)

    const res = await addSource({
      platform: detectedPlatform,
      url: urlInput.trim(),
      consent: {
        text: consentText,
        images: consentImages,
      },
    })

    setIsRegistering(false)
    if (res.success) {
      setUrlInput('')
      setConsentText(false)
      setConsentImages(false)
      setMobileStep('channels')
    } else if (res.error) {
      setFormError(res.error)
    }
  }

  const handleStartReview = async (source: LearningSource) => {
    const detail = await fetchSourceDetail(source.sourceId)
    if (detail) {
      setActiveReviewSource(detail.source)
      setReviewCandidatesList(detail.candidates)
    }
  }

  const handleSaveReviewDecisions = async (decisions: ReviewDecisionItem[]) => {
    if (!activeReviewSource) return

    setIsSubmittingReview(true)
    const res = await reviewCandidates({
      sourceId: activeReviewSource.sourceId,
      revision: activeReviewSource.revision,
      evidenceRevision: activeReviewSource.lease?.evidenceRevision ?? 1,
      decisions,
    })
    setIsSubmittingReview(false)

    if (res.success) {
      setActiveReviewSource(null)
      setReviewCandidatesList([])
    }
  }

  return (
    <div
      role="region"
      aria-labelledby="channel-learning-title"
      className="space-y-5 w-full max-w-4xl mx-auto"
    >
      {/* Panel Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pb-2 border-b border-border/80">
        <div>
          <div className="flex items-center gap-2">
            <h2 id="channel-learning-title" className="text-lg sm:text-xl font-bold text-foreground">
              공식 채널 지식 학습
            </h2>
            <Badge variant="purple" className="text-[11px] font-bold">
              스마트 학습
            </Badge>
          </div>
          <p className="text-xs sm:text-sm text-muted-foreground mt-1">
            사장님의 공식 계정에서 가게 정보와 말투를 안전하게 배워요.
          </p>
        </div>
      </div>

      {/* Global / Safe Error Banner */}
      {hookError && (
        <div
          role="alert"
          className="p-3.5 rounded-2xl bg-destructive/10 border border-destructive/20 text-xs text-destructive flex items-center justify-between gap-2.5 flex-wrap"
        >
          <div className="flex items-center gap-2 min-w-0">
            <AlertCircle className="size-4 shrink-0" aria-hidden />
            <span className="font-medium leading-relaxed">{hookError}</span>
          </div>
          {errorCode === 'CONNECTION_REQUIRED' && (
            <Link
              href="/app/channels"
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-primary text-primary-foreground text-xs font-bold hover:bg-primary/90 transition-colors shadow-xs shrink-0"
            >
              <span>채널 연결 관리로 이동</span>
              <ExternalLink className="size-3.5" aria-hidden />
            </Link>
          )}
        </div>
      )}

      {/* Mobile Step Segment (320~430px 단일 포커스 및 IA 지원) */}
      <div
        className="flex sm:hidden p-1 bg-muted/60 rounded-xl gap-1"
        role="tablist"
        aria-label="채널 학습 단계"
      >
        <button
          type="button"
          role="tab"
          id="tab-channel-register"
          aria-controls="panel-channel-register"
          aria-selected={mobileStep === 'register'}
          data-state={mobileStep === 'register' ? 'active' : 'inactive'}
          onClick={() => setMobileStep('register')}
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight') {
              setMobileStep('channels')
              document.getElementById('tab-channel-list')?.focus()
            }
          }}
          className={`min-h-11 flex-1 py-2 text-xs rounded-lg transition-all ${
            mobileStep === 'register'
              ? 'bg-background text-foreground shadow-xs font-bold'
              : 'text-muted-foreground font-medium hover:text-foreground'
          }`}
        >
          1. 채널 등록
        </button>
        <button
          type="button"
          role="tab"
          id="tab-channel-list"
          aria-controls="panel-channel-list"
          aria-selected={mobileStep === 'channels'}
          data-state={mobileStep === 'channels' ? 'active' : 'inactive'}
          onClick={() => setMobileStep('channels')}
          onKeyDown={(e) => {
            if (e.key === 'ArrowLeft') {
              setMobileStep('register')
              document.getElementById('tab-channel-register')?.focus()
            }
          }}
          className={`min-h-11 flex-1 py-2 text-xs rounded-lg transition-all ${
            mobileStep === 'channels'
              ? 'bg-background text-foreground shadow-xs font-bold'
              : 'text-muted-foreground font-medium hover:text-foreground'
          }`}
        >
          2. 학습 현황 ({sources.length})
        </button>
      </div>

      {/* Step 1: URL Registration Form (PC 항상 노출, 모바일에서는 탭 선택 시 노출) */}
      <div
        id="panel-channel-register"
        role="tabpanel"
        aria-labelledby="tab-channel-register"
        className={mobileStep === 'register' ? 'block' : 'hidden sm:block'}
      >
        <Card className="p-4 sm:p-5 rounded-2xl border border-border bg-card shadow-xs space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="size-6 rounded-full bg-primary text-primary-foreground text-xs font-bold flex items-center justify-center">
                1
              </div>
              <h3 className="text-sm font-bold text-foreground">채널 등록 및 본인 확인 동의</h3>
            </div>
            {!canManage && (
              <span className="text-xs text-muted-foreground">
                보기 권한은 채널을 등록하거나 수정할 수 없습니다.
              </span>
            )}
          </div>

          <form onSubmit={handleRegister} className="space-y-3.5">
            <div className="space-y-1.5">
              <label htmlFor="channel-url-input" className="text-xs font-semibold text-foreground">
                채널 주소
              </label>
              <div className="flex flex-col sm:flex-row gap-2">
                <Input
                  id="channel-url-input"
                  type="url"
                  value={urlInput}
                  onChange={(e) => handleUrlChange(e.target.value)}
                  placeholder="https://instagram.com/우리매장계정"
                  disabled={!canManage || isRegistering}
                  required
                  className="min-h-11 text-sm flex-1 rounded-xl"
                />
                <Button
                  type="submit"
                  disabled={
                    !canManage ||
                    isRegistering ||
                    !urlInput.trim() ||
                    isPlatformBlocked ||
                    (!consentText && !consentImages)
                  }
                  className="min-h-11 px-5 text-sm font-bold rounded-xl bg-primary text-primary-foreground shadow-xs shrink-0"
                >
                  {isRegistering ? (
                    <>
                      <RefreshCw className="size-3.5 animate-spin mr-1.5" />
                      등록 중…
                    </>
                  ) : (
                    <>
                      <Plus className="size-3.5 mr-1" />
                      채널 등록하기
                    </>
                  )}
                </Button>
              </div>
            </div>

            {/* Platform Capability Guidance */}
            {urlInput.trim() && (
              <div className="space-y-1 text-xs">
                {isPlatformBlocked && (
                  <div className="p-3 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive flex items-start gap-2">
                    <ShieldAlert className="size-4 shrink-0 mt-0.5" />
                    <p className="leading-relaxed">
                      이 채널은 현재 공식 연동이 지원되지 않아 자동 수집이 차단되어 있습니다.
                    </p>
                  </div>
                )}
                {isPlatformManualOnly && (
                  <div className="p-3 rounded-xl bg-muted/60 border border-border text-muted-foreground flex items-start gap-2">
                    <AlertCircle className="size-4 text-primary shrink-0 mt-0.5" />
                    <p className="leading-relaxed">
                      네이버는 정책상 자동 수집을 지원하지 않으며, 직접 입력한 내용이나 공개 정책을 안전하게 검토합니다.
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* Form Action Error */}
            {formError && (
              <p className="text-xs font-semibold text-destructive">{formError}</p>
            )}

            {/* Consents */}
            <div className="pt-2 border-t border-border/60 space-y-2">
              <p className="text-[11px] font-semibold text-muted-foreground">
                * 텍스트 또는 이미지 중 최소 1개 이상의 활용 동의가 필요합니다.
              </p>
              <label className="flex items-center gap-2 cursor-pointer text-xs text-foreground select-none">
                <input
                  type="checkbox"
                  checked={consentText}
                  onChange={(e) => setConsentText(e.target.checked)}
                  disabled={!canManage || isRegistering}
                  className="size-4 rounded border-input text-primary focus:ring-primary"
                />
                <span className="font-medium">
                  [선택] 게시물 텍스트를 매장 지식 학습에 활용하는 데 동의합니다.
                </span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer text-xs text-foreground select-none">
                <input
                  type="checkbox"
                  checked={consentImages}
                  onChange={(e) => setConsentImages(e.target.checked)}
                  disabled={!canManage || isRegistering}
                  className="size-4 rounded border-input text-primary focus:ring-primary"
                />
                <span>
                  [선택] 게시물 이미지를 시각 스타일 분석에 활용하는 데 동의합니다. (학습용 원본 사본은 최대 7일 보관)
                </span>
              </label>

              <p className="text-[11px] text-muted-foreground pt-0.5 leading-relaxed">
                ※ 사장님의 공식 계정에 있는 원본 게시물은 삭제되지 않아요. 소희가 내용을 살펴보기 위해 만든 임시 사본만 안전하게 보관한 뒤 삭제해요.
              </p>
            </div>
          </form>
        </Card>
      </div>

      {/* Step 2 & 3: Registered Channel Sources List (PC 항상 노출, 모바일에서는 탭 선택 시 노출) */}
      <div
        id="panel-channel-list"
        role="tabpanel"
        aria-labelledby="tab-channel-list"
        className={`space-y-3 ${mobileStep === 'channels' ? 'block' : 'hidden sm:block'}`}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="size-6 rounded-full bg-secondary text-secondary-foreground text-xs font-bold flex items-center justify-center">
              2
            </div>
            <h3 className="text-sm font-bold text-foreground">
              등록된 채널 및 학습 진행 상황
            </h3>
          </div>
          <span className="text-xs font-semibold text-muted-foreground">
            {sources.length}개 채널
          </span>
        </div>

        {isLoading ? (
          <Card className="p-8 text-center text-xs text-muted-foreground rounded-2xl">
            채널 목록을 불러오는 중입니다…
          </Card>
        ) : sources.length === 0 ? (
          <Card className="p-8 text-center rounded-2xl border-dashed space-y-2 bg-muted/20">
            <Globe className="size-8 mx-auto text-muted-foreground/50" />
            <p className="text-xs font-bold text-foreground">아직 등록된 공식 채널이 없습니다.</p>
            <p className="text-xs text-muted-foreground">
              인스타그램이나 스레드 주소를 등록하면 소희가 매장 정보를 이해하고 손님 응대에 활용합니다.
            </p>
          </Card>
        ) : (
          <div className="space-y-3">
            {sources.map((source) => {
              const cap = capabilities.find((c) => c.platform === source.platform)
              return (
                <ChannelSourceCard
                  key={source.sourceId}
                  source={source}
                  capability={cap}
                  canManage={canManage}
                  onVerify={(s) => verifySource({ sourceId: s.sourceId, revision: s.revision })}
                  onCollect={(s) => startCollection({ sourceId: s.sourceId, revision: s.revision })}
                  onReview={handleStartReview}
                  onCancel={(s) => cancelSource({ sourceId: s.sourceId, revision: s.revision })}
                  onDelete={(s) => deleteSource({ sourceId: s.sourceId, revision: s.revision })}
                />
              )
            })}
          </div>
        )}
      </div>

      {/* Step 3: Review Candidates Dialog */}
      {activeReviewSource && (
        <ChannelReviewDialog
          isOpen={Boolean(activeReviewSource)}
          onClose={() => {
            setActiveReviewSource(null)
            setReviewCandidatesList([])
          }}
          source={activeReviewSource}
          candidates={reviewCandidatesList}
          canManage={canManage}
          isSubmitting={isSubmittingReview}
          onSaveDecisions={handleSaveReviewDecisions}
        />
      )}
    </div>
  )
}
