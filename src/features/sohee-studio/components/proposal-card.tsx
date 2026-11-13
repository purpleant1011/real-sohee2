'use client'

import React, { useState } from 'react'
import { AlertCircle, Check, Edit2, RotateCcw, Sparkles, X } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import type { KnowledgeProposal, SoheeGoal } from '../types'

const CATEGORY_LABEL_MAP: Record<string, string> = {
  MENU: '메뉴',
  PRICE: '가격',
  HOURS: '영업정보',
  DIFFERENTIATOR: '차별점',
  FAQ: '자주 묻는 질문',
}

function formatCategoryLabel(category?: string): string {
  if (!category) return '일반'
  return CATEGORY_LABEL_MAP[category.toUpperCase()] || category
}

interface ProposalCardProps {
  workspaceId: string
  proposal?: KnowledgeProposal
  suggestedGoal?: SoheeGoal
  onDecided: () => void
}

export function ProposalCard({
  workspaceId,
  proposal,
  suggestedGoal,
  onDecided,
}: ProposalCardProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [editContent, setEditContent] = useState(
    proposal?.proposedContent || suggestedGoal?.title || ''
  )
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [status, setStatus] = useState<'idle' | 'confirmed' | 'rejected'>('idle')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  if (status !== 'idle') {
    return (
      <div className="rounded-xl border border-muted bg-muted/40 p-3 text-xs text-muted-foreground flex items-center gap-2">
        {status === 'confirmed' ? (
          <>
            <Check className="size-4 text-emerald-500" />
            <span>소희의 두뇌에 안전하게 반영되었어요!</span>
          </>
        ) : (
          <>
            <X className="size-4 text-muted-foreground" />
            <span>반영하지 않고 제외했어요.</span>
          </>
        )}
      </div>
    )
  }

  // 1. 지식 팩트 제안 카드
  if (proposal) {
    const handleConfirm = async () => {
      setIsSubmitting(true)
      setErrorMessage(null)
      try {
        const idempotencyKey = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `idemp_${Date.now()}`
        const res = await fetch(
          `/api/workspaces/${workspaceId}/sohee-studio/knowledge-proposals/${proposal.id}/decide`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              decision: 'confirm',
              revisedContent: isEditing ? editContent : undefined,
              idempotencyKey,
            }),
          }
        )
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`)
        }
        const json = await res.json().catch(() => ({}))
        if (json?.success !== true) {
          throw new Error(json?.message || '저장 실패')
        }
        setStatus('confirmed')
        onDecided()
      } catch (err: any) {
        setErrorMessage('저장에 실패했습니다. 잠시 후 다시 시도해 주세요.')
      } finally {
        setIsSubmitting(false)
      }
    }

    const handleReject = async () => {
      setIsSubmitting(true)
      setErrorMessage(null)
      try {
        const idempotencyKey = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `idemp_${Date.now()}`
        const res = await fetch(
          `/api/workspaces/${workspaceId}/sohee-studio/knowledge-proposals/${proposal.id}/decide`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ decision: 'reject', idempotencyKey }),
          }
        )
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`)
        }
        const json = await res.json().catch(() => ({}))
        if (json?.success !== true) {
          throw new Error(json?.message || '제외 처리 실패')
        }
        setStatus('rejected')
        onDecided()
      } catch (err: any) {
        setErrorMessage('제외 처리에 실패했습니다. 다시 시도해 주세요.')
      } finally {
        setIsSubmitting(false)
      }
    }

    return (
      <Card className="rounded-2xl border border-purple-200 bg-purple-50/70 p-4 space-y-3 dark:border-purple-900 dark:bg-purple-950/40">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-xs font-bold text-purple-700 dark:text-purple-300">
            <Sparkles className="size-4" />
            <span>소희가 이해한 내용 검토</span>
          </div>
          <Badge variant="outline" className="text-xs bg-background">
            {formatCategoryLabel(proposal.category)}
          </Badge>
        </div>

        {isEditing ? (
          <Input
            value={editContent}
            onChange={(e) => setEditContent(e.target.value)}
            className="text-xs bg-background"
            autoFocus
          />
        ) : (
          <p className="text-xs font-medium text-foreground bg-background/80 rounded-lg p-2.5 border border-purple-100 dark:border-purple-900/50">
            &ldquo;{proposal.proposedContent}&rdquo;
          </p>
        )}

        {errorMessage && (
          <div className="flex items-center gap-1.5 text-xs text-destructive bg-destructive/10 p-2 rounded-lg">
            <AlertCircle className="size-3.5 shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}

        <div className="flex items-center justify-end gap-2 pt-1">
          {!isEditing ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setIsEditing(true)}
              className="h-7 text-xs px-2 text-muted-foreground"
            >
              <Edit2 className="size-3 mr-1" />
              수정
            </Button>
          ) : (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setIsEditing(false)}
              className="h-7 text-xs px-2 text-muted-foreground"
            >
              취소
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleReject}
            disabled={isSubmitting}
            className="h-7 text-xs px-2 text-muted-foreground hover:text-destructive"
          >
            제외
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={handleConfirm}
            disabled={isSubmitting}
            className="h-7 text-xs px-3 bg-purple-600 hover:bg-purple-700 text-white font-semibold"
          >
            <Check className="size-3.5 mr-1" />
            확정
          </Button>
        </div>
      </Card>
    )
  }

  // 2. 목표(Goal) 제안 카드
  if (suggestedGoal) {
    const proposalId = suggestedGoal.proposalId || suggestedGoal.id

    const handleSaveGoal = async () => {
      setIsSubmitting(true)
      setErrorMessage(null)
      try {
        const res = await fetch(`/api/workspaces/${workspaceId}/sohee-studio/goals`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ proposalId }),
        })
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`)
        }
        const json = await res.json().catch(() => ({}))
        if (json?.success !== true) {
          throw new Error(json?.message || '목표 저장 실패')
        }
        setStatus('confirmed')
        onDecided()
      } catch (err: any) {
        setErrorMessage('목표 저장에 실패했습니다. 다시 시도해 주세요.')
      } finally {
        setIsSubmitting(false)
      }
    }

    const handleRejectGoal = async () => {
      setIsSubmitting(true)
      setErrorMessage(null)
      try {
        const goalProposalId = suggestedGoal.proposalId || suggestedGoal.id
        const idempotencyKey = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `idemp_${Date.now()}`
        const res = await fetch(
          `/api/workspaces/${workspaceId}/sohee-studio/knowledge-proposals/${goalProposalId}/decide`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ decision: 'reject', idempotencyKey }),
          }
        )
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`)
        }
        const json = await res.json().catch(() => ({}))
        if (json?.success !== true) {
          throw new Error(json?.message || '목표 제외 실패')
        }
        setStatus('rejected')
        onDecided()
      } catch (err: any) {
        setErrorMessage('목표 제외에 실패했습니다. 다시 시도해 주세요.')
      } finally {
        setIsSubmitting(false)
      }
    }

    return (
      <Card className="rounded-2xl border border-indigo-200 bg-indigo-50/70 p-4 space-y-3 dark:border-indigo-900 dark:bg-indigo-950/40">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-xs font-bold text-indigo-700 dark:text-indigo-300">
            <Sparkles className="size-4" />
            <span>새로운 달성 목표 제안</span>
          </div>
          <Badge variant="outline" className="text-[10px] bg-background">
            목표
          </Badge>
        </div>

        {isEditing ? (
          <Input
            value={editContent}
            onChange={(e) => setEditContent(e.target.value)}
            className="text-xs bg-background"
            autoFocus
          />
        ) : (
          <div className="bg-background/80 rounded-lg p-2.5 border border-indigo-100 dark:border-indigo-900/50 space-y-1">
            <p className="text-xs font-bold text-foreground">{suggestedGoal.title}</p>
            {suggestedGoal.desiredOutcome && (
              <p className="text-[11px] text-muted-foreground">{suggestedGoal.desiredOutcome}</p>
            )}
          </div>
        )}

        {errorMessage && (
          <div className="flex items-center gap-1.5 text-xs text-destructive bg-destructive/10 p-2 rounded-lg">
            <AlertCircle className="size-3.5 shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}

        <div className="flex items-center justify-end gap-2 pt-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleRejectGoal}
            disabled={isSubmitting}
            className="h-7 text-xs px-2 text-muted-foreground hover:text-destructive"
          >
            제외
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={handleSaveGoal}
            disabled={isSubmitting}
            className="h-7 text-xs px-3 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold"
          >
            <Check className="size-3.5 mr-1" />
            목표로 저장
          </Button>
        </div>
      </Card>
    )
  }

  return null
}
