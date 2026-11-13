'use client'

import React, { useState } from 'react'
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Edit2,
  FileText,
  ImageOff,
  Sparkles,
  X,
} from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/modal'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import type {
  CandidateCategory,
  EvidenceState,
  LearningCandidate,
  LearningSource,
  ReviewDecisionItem,
} from '../contracts'

export interface ChannelReviewDialogProps {
  isOpen: boolean
  onClose: () => void
  source: LearningSource
  candidates: readonly LearningCandidate[]
  canManage: boolean
  isMediaExpired?: boolean
  isSubmitting?: boolean
  onSaveDecisions: (decisions: ReviewDecisionItem[]) => void
}

const CATEGORY_LABELS: Record<CandidateCategory, string> = {
  business: '매장 정보',
  offering: '상품/서비스',
  price: '가격/메뉴',
  location: '매장 위치',
  hours: '영업시간',
  policy: '운영 정책',
  faq: '자주 묻는 질문',
  tone: '대화 말투',
  content: '추천 문구',
  visual: '시각 스타일',
}

const EVIDENCE_STATE_LABELS: Record<
  EvidenceState,
  { label: string; variant: 'secondary' | 'warning' | 'success' }
> = {
  observed: { label: '실제 관찰됨', variant: 'success' },
  inferred: { label: '문맥 추론됨', variant: 'warning' },
  recommended: { label: '추천 항목', variant: 'secondary' },
}

export function ChannelReviewDialog({
  isOpen,
  onClose,
  source,
  candidates,
  canManage,
  isMediaExpired = false,
  isSubmitting = false,
  onSaveDecisions,
}: ChannelReviewDialogProps) {
  // Candidate state management
  const [decisions, setDecisions] = useState<Record<string, 'approved' | 'rejected'>>(() => {
    const init: Record<string, 'approved' | 'rejected'> = {}
    for (const c of candidates) {
      init[c.id] = c.status === 'rejected' ? 'rejected' : 'approved'
    }
    return init
  })

  const [editingContent, setEditingContent] = useState<Record<string, string>>({})
  const [editingId, setEditingId] = useState<string | null>(null)

  const handleToggleDecision = (candidateId: string, decision: 'approved' | 'rejected') => {
    setDecisions((prev) => ({
      ...prev,
      [candidateId]: decision,
    }))
  }

  const handleStartEdit = (candidateId: string, currentContent: string) => {
    setEditingId(candidateId)
    setEditingContent((prev) => ({
      ...prev,
      [candidateId]: prev[candidateId] ?? currentContent,
    }))
  }

  const handleSaveEdit = () => {
    setEditingId(null)
  }

  const handleSubmit = () => {
    const decisionList: ReviewDecisionItem[] = candidates.map((c) => ({
      candidateId: c.id,
      version: c.version,
      decision: decisions[c.id] ?? 'approved',
      editedContent: editingContent[c.id]?.trim() || undefined,
    }))
    onSaveDecisions(decisionList)
  }

  const approvedCount = Object.values(decisions).filter((d) => d === 'approved').length

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        aria-describedby="review-dialog-description"
        showCloseButton={false}
        className="max-w-2xl max-h-[90dvh] flex flex-col p-0 gap-0 overflow-hidden rounded-2xl sm:rounded-3xl relative"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="지식 검토 창 닫기"
          className="absolute top-4 right-4 rounded-lg p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring z-10"
        >
          <X className="size-4" aria-hidden="true" />
          <span className="sr-only">지식 검토 창 닫기</span>
        </button>

        {/* Header */}
        <DialogHeader className="p-5 sm:p-6 pb-4 border-b border-border/80">
          <div className="flex items-center gap-2">
            <Badge variant="purple" className="text-xs font-bold gap-1">
              <Sparkles className="size-3" />
              <span>지식 발견</span>
            </Badge>
            <span className="text-xs text-muted-foreground truncate">
              @{source.canonicalIdentity}
            </span>
          </div>
          <DialogTitle className="text-lg sm:text-xl font-bold mt-1 text-foreground">
            지식 검토 및 승인
          </DialogTitle>
          <DialogDescription id="review-dialog-description" className="text-xs text-muted-foreground leading-relaxed">
            채널에서 추출한 정보를 검토해 주세요. 승인된 지식만 소희가 손님 응대와 글 작성 시 정확한 근거로 활용합니다.
          </DialogDescription>
        </DialogHeader>

        {/* Candidate List (Scrollable Area) */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4">
          {candidates.length === 0 ? (
            <div className="text-center py-12 text-sm text-muted-foreground">
              검토할 새 지식 후보가 없습니다.
            </div>
          ) : (
            candidates.map((c) => {
              const currentDecision = decisions[c.id] ?? 'approved'
              const isApproved = currentDecision === 'approved'
              const isEditing = editingId === c.id
              const displayContent = editingContent[c.id] ?? c.content
              const isConflict = c.status === 'conflict' || Boolean(c.conflictsWithFactId)
              const evidenceState = EVIDENCE_STATE_LABELS[c.evidenceState]

              return (
                <div
                  key={c.id}
                  className={`p-4 rounded-2xl border transition-all space-y-3 ${
                    isApproved
                      ? 'border-primary/30 bg-primary/5'
                      : 'border-border/70 bg-muted/20 opacity-75'
                  }`}
                >
                  {/* Top: Category + Evidence State + Conflict */}
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <Badge variant="outline" className="text-[11px] font-bold bg-background">
                        {CATEGORY_LABELS[c.category] ?? c.category}
                      </Badge>
                      <Badge
                        variant={evidenceState.variant}
                        className={`text-[10px] ${
                          evidenceState.variant === 'warning'
                            ? 'text-amber-900 dark:text-amber-200'
                            : evidenceState.variant === 'success'
                              ? 'text-emerald-900 dark:text-emerald-200'
                              : ''
                        }`}
                      >
                        {evidenceState.label}
                      </Badge>
                      {isConflict && (
                        <span className="inline-flex items-center gap-1 text-[11px] font-bold text-destructive bg-destructive/10 px-2 py-0.5 rounded-md">
                          <AlertTriangle className="size-3" />
                          기존 정보와 충돌
                        </span>
                      )}
                    </div>

                    {/* 승인 / 반려 선택 토글 */}
                    <div className="flex items-center gap-1">
                      <Button
                        type="button"
                        size="sm"
                        variant={isApproved ? 'default' : 'outline'}
                        onClick={() => handleToggleDecision(c.id, 'approved')}
                        disabled={!canManage}
                        className={`h-7 px-2.5 text-xs font-bold gap-1 rounded-lg ${
                          isApproved ? 'bg-primary text-primary-foreground' : ''
                        }`}
                      >
                        <Check className="size-3" />
                        <span>승인</span>
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant={!isApproved ? 'destructive' : 'outline'}
                        onClick={() => handleToggleDecision(c.id, 'rejected')}
                        disabled={!canManage}
                        className="h-7 px-2.5 text-xs font-bold gap-1 rounded-lg"
                      >
                        <X className="size-3" />
                        <span>제외</span>
                      </Button>
                    </div>
                  </div>

                  {/* Content (or Edit Mode) */}
                  {isEditing ? (
                    <div className="space-y-2">
                      <Textarea
                        value={displayContent}
                        onChange={(e) =>
                          setEditingContent((prev) => ({ ...prev, [c.id]: e.target.value }))
                        }
                        className="text-xs min-h-[70px] bg-background"
                      />
                      <div className="flex justify-end gap-1.5">
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => setEditingId(null)}
                          className="h-7 text-xs"
                        >
                          취소
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          onClick={handleSaveEdit}
                          className="h-7 text-xs font-bold"
                        >
                          수정 완료
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-xs sm:text-sm font-semibold text-foreground leading-relaxed whitespace-pre-wrap">
                        {displayContent}
                      </p>
                      {canManage && (
                        <button
                          type="button"
                          onClick={() => handleStartEdit(c.id, displayContent)}
                          className="text-muted-foreground hover:text-foreground shrink-0 p-1 rounded-md"
                          title="내용 수정"
                          aria-label="내용 수정"
                        >
                          <Edit2 className="size-3.5" />
                        </button>
                      )}
                    </div>
                  )}

                  {/* Evidence Excerpt or Expired Media Notice */}
                  {c.evidence.excerpt && (
                    <div className="p-2.5 rounded-xl bg-background/80 border border-border/60 text-xs text-muted-foreground flex items-start gap-1.5">
                      <FileText className="size-3.5 text-primary shrink-0 mt-0.5" />
                      <span className="leading-relaxed truncate sm:whitespace-normal">
                        근거: {c.evidence.excerpt}
                      </span>
                    </div>
                  )}

                  {/* 7일 만료 이미지 처리: 깨진 이미지 방지 및 보관 종료 안내 */}
                  {(isMediaExpired || c.evidence.visionReceiptId) && (
                    <div className="p-2.5 rounded-xl bg-muted/40 border border-border/60 text-xs text-muted-foreground flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5">
                        <ImageOff className="size-3.5 text-muted-foreground shrink-0" />
                        <span>
                          {isMediaExpired
                            ? '원본 사본 보관기간 종료'
                            : '이미지 근거 (개인정보 보호를 위해 7일 후 자동 삭제됩니다)'}
                        </span>
                      </div>
                      {/* viewer disabled when expired */}
                      {!isMediaExpired && (
                        <span className="text-[11px] text-primary font-medium">분석 완료</span>
                      )}
                    </div>
                  )}
                </div>
              )
            })
          )}
        </div>

        {/* Footer: Mobile R2 Single Fixed CTA Bar */}
        <div className="p-4 sm:p-5 border-t border-border/80 bg-background/95 backdrop-blur-sm flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="text-xs text-muted-foreground w-full sm:w-auto text-center sm:text-left">
            {!canManage ? (
              <span className="text-destructive font-medium">
                소유자와 관리자만 승인 결정을 저장할 수 있습니다.
              </span>
            ) : (
              <span>
                총 {candidates.length}개 중{' '}
                <strong className="text-primary font-bold">{approvedCount}개</strong>를 지식으로
                반영합니다.
              </span>
            )}
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onClose}
              disabled={isSubmitting}
              className="h-10 sm:h-9 text-xs flex-1 sm:flex-none font-medium"
            >
              닫기
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={!canManage || isSubmitting || candidates.length === 0}
              onClick={handleSubmit}
              className="h-10 sm:h-9 text-xs font-bold flex-1 sm:flex-none px-5 bg-primary text-primary-foreground shadow-sm gap-1.5"
            >
              <CheckCircle2 className="size-4" />
              <span>
                {isSubmitting ? '저장하는 중…' : `${approvedCount}개 지식 승인 및 반영`}
              </span>
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
