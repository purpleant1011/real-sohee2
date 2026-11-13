'use client'

import React, { useState, useEffect } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { PlanCard } from '@/features/action-graph/event-cards'
import { MissionEvidenceRail } from './mission-evidence-rail'
import type { PlanCardData } from '@/lib/agent-os/agent-orchestrator'
import type { ExactApprovalCopies } from '@/features/missions/conversational-first-post'
import { ApprovalReviewView } from '@/features/mobile-firstpost/approval-review-view'
import { draftApprovalInput, draftAsset, type DraftDto } from '@/features/mobile-firstpost/draft-mapper'
import { createApprovalCommand } from '@/features/mobile-firstpost/approval-client'
import { FileText, ShieldAlert, Check, AlertCircle } from 'lucide-react'

type EditableDraft = {
  missionId: string
  workspaceId: string
  approvalFingerprint: string
  copies: ExactApprovalCopies
}

export interface AgentArtifactPlanCardProps {
  plan: PlanCardData & { diffSummary?: string; simulated?: boolean }
  diffSummary?: string
  workspaceId?: string
  missionId?: string
  runId?: string
  showEvidence?: boolean
  isSimulation?: boolean
  initialCaption?: string
  onSaveCaption?: (caption: string) => Promise<void> | void
  onApprovalInvalidated?: () => void
}

export function AgentArtifactPlanCard(props: AgentArtifactPlanCardProps) {
  return (
    <ScopedArtifactPlanCard
      key={JSON.stringify([props.workspaceId, props.missionId, props.plan.planId])}
      {...props}
    />
  )
}

function ScopedArtifactPlanCard({
  plan,
  diffSummary,
  missionId,
  workspaceId,
  runId,
  onApprovalInvalidated,
  showEvidence = true,
  isSimulation = false,
  initialCaption,
  onSaveCaption,
}: AgentArtifactPlanCardProps) {
  // --- ani-1888-timeline inline caption editing state ---
  const [caption, setCaption] = useState(initialCaption ?? '')
  const [isEditing, setIsEditing] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    setCaption(initialCaption ?? '')
    setIsEditing(false)
    setSaveSuccess(false)
    setSaveError(null)
  }, [initialCaption, plan.planId])

  // --- ani-1889 first-post API draft review state ---
  const [draft, setDraft] = useState<EditableDraft | null>(null)
  const [copies, setCopies] = useState<ExactApprovalCopies | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const [reviewDraft, setReviewDraft] = useState<DraftDto | null>(null)
  const [editable, setEditable] = useState(false)
  const dirty = Boolean(draft && copies && JSON.stringify(draft.copies) !== JSON.stringify(copies))

  function validDraft(value: EditableDraft | undefined): value is EditableDraft {
    return Boolean(
      value &&
        value.missionId === missionId &&
        value.workspaceId === workspaceId &&
        /^[a-f0-9]{64}$/i.test(value.approvalFingerprint) &&
        typeof value.copies?.instagram?.caption === 'string' &&
        typeof value.copies?.threads?.content === 'string'
    )
  }

  async function loadDraft() {
    if (!missionId || !workspaceId || pending) return
    setPending(true)
    setError('')
    try {
      const response = await fetch(`/api/missions/first-post/${encodeURIComponent(missionId)}`, {
        headers: { 'x-workspace-id': workspaceId },
        cache: 'no-store',
      })
      const data = await response.json()
      if (!response.ok || !data.success || !validDraft(data.draft))
        throw new Error('초안 조회 응답을 확인하지 못했습니다.')
      setDraft(data.draft)
      setCopies(data.draft.copies)
      setEditable(data.missionStatus === 'DRAFT' || data.missionStatus === 'AWAITING_APPROVAL')
    } catch {
      setError('초안을 불러오지 못했어요. 기존 원고는 유지돼요.')
    } finally {
      setPending(false)
    }
  }

  async function loadApprovalReview() {
    if (!draft || !saved || dirty || pending) return
    setPending(true)
    setError('')
    setReviewDraft(null)
    try {
      const response = await fetch(`/api/missions/first-post/${encodeURIComponent(missionId!)}`, {
        headers: { 'x-workspace-id': workspaceId! },
        cache: 'no-store',
      })
      const data = await response.json()
      if (
        !response.ok ||
        !data.success ||
        !validDraft(data.draft) ||
        data.missionStatus !== 'AWAITING_APPROVAL' ||
        data.draft.approvalFingerprint !== draft.approvalFingerprint ||
        JSON.stringify(data.draft.copies) !== JSON.stringify(draft.copies) ||
        data.draft.datasetMode !== 'ACTUAL'
      )
        throw new Error('STALE_APPROVAL')
      const ids = data.draft.selectedImageIds
      if (
        !Array.isArray(ids) ||
        ids.length === 0 ||
        ids.some((id) => {
          const asset = draftAsset({ ...data.draft, selectedImageIds: [id] }, window.location.origin)
          return (
            !asset ||
            !Number.isFinite(asset.width) ||
            !Number.isFinite(asset.height) ||
            asset.width <= 0 ||
            asset.height <= 0
          )
        })
      )
        throw new Error('UNCONFIRMED_IMAGES')
      setReviewDraft(data.draft)
    } catch {
      setError('수정 내용은 유지돼요. 초안을 다시 확인해 주세요.')
    } finally {
      setPending(false)
    }
  }

  async function saveCopies() {
    if (!draft || !copies || !dirty || pending || !editable) return
    setPending(true)
    setError('')
    try {
      const response = await fetch('/api/missions/first-post/revise', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-workspace-id': workspaceId! },
        body: JSON.stringify({ missionId, expectedFingerprint: draft.approvalFingerprint, copies }),
      })
      const data = await response.json()
      if (
        !response.ok ||
        !data.success ||
        !validDraft(data.draft) ||
        data.draft.copies.instagram.caption !== copies.instagram.caption ||
        data.draft.copies.instagram.cta !== copies.instagram.cta ||
        JSON.stringify(data.draft.copies.instagram.hashtags) !==
          JSON.stringify(copies.instagram.hashtags) ||
        data.draft.copies.threads.content !== copies.threads.content ||
        data.draft.copies.threads.cta !== copies.threads.cta
      ) {
        setError(
          response.status === 409
            ? '초안이 변경되었어요. 최신 초안을 확인해 주세요.'
            : '저장 결과를 확인하지 못했습니다. 수정 내용은 유지됩니다.'
        )
        return
      }
      setDraft(data.draft)
      setCopies(data.draft.copies)
      setSaved(true)
      onApprovalInvalidated?.()
    } catch {
      setError('저장 결과를 확인하지 못했습니다. 수정 내용은 유지됩니다.')
    } finally {
      setPending(false)
    }
  }

  const handleSaveInline = async () => {
    if (isSaving) return
    if (!onSaveCaption) {
      setSaveError('문구를 저장할 수 있는 기능이 연결되어 있지 않습니다.')
      return
    }

    setIsSaving(true)
    setSaveError(null)
    setSaveSuccess(false)

    try {
      await onSaveCaption(caption)
      setSaveSuccess(true)
      setIsEditing(false)
      onApprovalInvalidated?.()
    } catch {
      setSaveError('초안 저장에 실패했습니다. 기존 원고는 유지됩니다.')
    } finally {
      setIsSaving(false)
    }
  }

  const isCostConfirmed =
    typeof plan.totalSC === 'number' && Number.isFinite(plan.totalSC) && plan.totalSC >= 0
  const costLabel = isCostConfirmed ? `${plan.totalSC.toLocaleString('ko-KR')} 크레딧` : '비용 미확정'
  const effectiveDiffSummary = plan.diffSummary ?? diffSummary
  const showSimulationBadge = isSimulation || Boolean(plan.simulated)

  return (
    <section
      aria-label="결과물과 실행 계획 검토"
      className="min-w-0 space-y-3 rounded-2xl border border-border bg-card p-3.5 text-xs text-foreground shadow-2xs"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/80 pb-2.5">
        <div className="flex items-center gap-2">
          <FileText className="size-4 text-purple-600 dark:text-purple-400 shrink-0" aria-hidden="true" />
          <h3 className="font-semibold text-foreground">계획 검토 필요</h3>
        </div>
        <div className="flex items-center gap-1.5">
          <Badge variant="outline" className="text-[10px] text-purple-600 border-purple-200 dark:border-purple-800">
            미발행 · 초안
          </Badge>
          {showSimulationBadge && (
            <Badge variant="secondary" className="text-[10px] text-purple-700 bg-purple-100 dark:bg-purple-950/60 dark:text-purple-300">
              시안
            </Badge>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between text-muted-foreground text-[11px]">
        <p>예상 비용 · {costLabel}</p>
      </div>

      {effectiveDiffSummary && (
        <div
          role="region"
          aria-label="계획 변경 내용"
          className="rounded-xl border border-amber-200/80 bg-amber-50/50 p-2.5 dark:border-amber-900/40 dark:bg-amber-950/20"
        >
          <h4 className="font-semibold text-amber-900 dark:text-amber-200">계획 변경 내용</h4>
          <p className="mt-1 text-amber-800 dark:text-amber-300">{effectiveDiffSummary}</p>
          <p className="mt-1 text-[11px] text-amber-700/80 dark:text-amber-400/80">
            수정된 초안을 새로 검토해 주세요.
          </p>
        </div>
      )}

      {/* 단계 순서 시각화 */}
      <div className="rounded-xl border border-border/60 p-2 bg-muted/20">
        <PlanCard plan={plan} />
      </div>

      {/* ani-1889 에비던스 레일 */}
      {showEvidence && workspaceId && missionId && runId && (
        <MissionEvidenceRail workspaceId={workspaceId} missionId={missionId} runId={runId} />
      )}

      {/* ani-1889 홍보 초안 불러오기 버튼 */}
      {missionId && workspaceId && !draft && initialCaption === undefined && (
        <Button variant="outline" className="min-h-11" disabled={pending} onClick={loadDraft}>
          홍보 초안 불러오기
        </Button>
      )}

      {/* ani-1888-timeline 인라인 원고 문구 수정 영역 */}
      {initialCaption !== undefined && (
        <div className="space-y-2 border-t border-border/60 pt-2.5">
          <div className="flex items-center justify-between">
            <span className="font-medium">홍보 원고 초안</span>
            {!isEditing && onSaveCaption && (
              <Button
                variant="ghost"
                size="sm"
                className="min-h-11 text-xs"
                onClick={() => {
                  setSaveError(null)
                  setIsEditing(true)
                }}
              >
                문구 수정
              </Button>
            )}
          </div>

          {isEditing ? (
            <div className="space-y-2">
              <Textarea
                value={caption}
                onChange={(e) => {
                  setCaption(e.target.value)
                  setSaveSuccess(false)
                  setSaveError(null)
                }}
                className="min-h-24 text-xs"
                placeholder="홍보 원고 문구를 입력하세요"
              />
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  className="min-h-11"
                  disabled={isSaving || caption === initialCaption}
                  onClick={handleSaveInline}
                >
                  {isSaving ? '저장 중...' : '초안 저장'}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="min-h-11"
                  disabled={isSaving}
                  onClick={() => {
                    setCaption(initialCaption ?? '')
                    setIsEditing(false)
                    setSaveError(null)
                  }}
                >
                  취소
                </Button>
              </div>
            </div>
          ) : (
            <p className="rounded-lg bg-muted/40 p-2 text-foreground whitespace-pre-wrap">{caption}</p>
          )}

          {saveSuccess && (
            <p role="status" className="flex items-center gap-1 text-[11px] text-emerald-600 dark:text-emerald-400">
              <Check className="size-3" /> 초안이 저장되었습니다. 승인 전 다시 확인해 주세요.
            </p>
          )}

          {saveError && (
            <p role="alert" className="flex items-center gap-1 text-[11px] text-destructive">
              <AlertCircle className="size-3 shrink-0" /> {saveError}
            </p>
          )}
        </div>
      )}

      {/* ani-1889 다중 채널 원고 편집 영역 */}
      {copies && (
        <div className="space-y-3" aria-label="홍보 초안 편집">
          <label className="block space-y-1">
            <span>인스타그램 홍보 문구</span>
            <Textarea
              value={copies.instagram.caption}
              disabled={pending || !editable}
              onChange={(event) => {
                setCopies({
                  ...copies,
                  instagram: { ...copies.instagram, caption: event.target.value },
                })
                setSaved(false)
                setReviewDraft(null)
                onApprovalInvalidated?.()
              }}
              className="min-h-28 w-full"
            />
          </label>
          <label className="block space-y-1">
            <span>스레드 홍보 문구</span>
            <Textarea
              value={copies.threads.content}
              disabled={pending || !editable}
              onChange={(event) => {
                setCopies({
                  ...copies,
                  threads: { ...copies.threads, content: event.target.value },
                })
                setSaved(false)
                setReviewDraft(null)
                onApprovalInvalidated?.()
              }}
              className="min-h-28 w-full"
            />
          </label>
          {dirty && <p role="status">저장하지 않은 변경사항이 있습니다.</p>}
          {saved && <p role="status">문구가 저장되었습니다. 새 승인 요청에서 다시 확인해 주세요.</p>}
          {!editable && <p>현재 상태에서는 문구를 수정할 수 없습니다.</p>}
          <Button
            className="min-h-11"
            disabled={
              !dirty ||
              pending ||
              !editable ||
              !copies.instagram.caption.trim() ||
              !copies.threads.content.trim()
            }
            onClick={saveCopies}
          >
            문구 저장
          </Button>
        </div>
      )}

      {saved && !dirty && (
        <Button variant="outline" className="min-h-11" disabled={pending} onClick={loadApprovalReview}>
          새 승인 내용 확인
        </Button>
      )}

      {reviewDraft && !dirty && (
        <section aria-label="수정한 초안의 정확 승인" className="min-w-0 rounded-xl border border-border p-3">
          <ApprovalReviewView
            key={String(reviewDraft.approvalFingerprint)}
            input={draftApprovalInput(reviewDraft, true)}
            imageUrlFor={(id) =>
              draftAsset({ ...reviewDraft, selectedImageIds: [id] }, window.location.origin)?.imageUrl ??
              null
            }
            onSubmit={createApprovalCommand({ missionId: missionId!, workspaceId })}
            successMessage="승인이 기록되었습니다. 외부 게시를 실행한 것은 아닙니다."
          />
        </section>
      )}

      {error && <p role="alert">{error}</p>}

      {/* 승인 전 외부 쓰기 없음 명시 */}
      <div className="flex items-start gap-1.5 rounded-xl border border-border/80 bg-muted/30 p-2.5 text-[11px] text-muted-foreground">
        <ShieldAlert className="size-4 shrink-0 text-primary mt-0.5" aria-hidden="true" />
        <div className="space-y-0.5 leading-relaxed">
          <p className="font-semibold text-foreground">승인 전 외부 쓰기 없음</p>
          <p>계획 검토만으로 외부 작업이 실행되지 않습니다.</p>
          <p>연결 계정은 승인 단계에서 확인하실 수 있어요.</p>
        </div>
      </div>
    </section>
  )
}
