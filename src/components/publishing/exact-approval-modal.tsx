'use client'

import React, { useState } from 'react'
import {
  ShieldCheck,
  CheckCircle2,
  FileText,
  Sliders,
  Check,
  X,
  Clock,
  ExternalLink,
  AtSign,
  AlertCircle,
  Sparkles,
  Camera,
} from 'lucide-react'
import {
  computeExactApprovalFingerprint,
  type ExactApprovalPayload,
} from '@/features/publishing/dual-publish-coordinator'

function InstagramIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <rect width="20" height="20" x="2" y="2" rx="5" ry="5" />
      <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
      <line x1="17.5" x2="17.51" y1="6.5" y2="6.5" />
    </svg>
  )
}

export interface ExactApprovalModalProps {
  isOpen: boolean
  payload: ExactApprovalPayload
  onClose: () => void
  onApprove: (fingerprint: string) => Promise<void>
  onRevise?: (prompt: string) => void
  isPublishing?: boolean
}

export function ExactApprovalModal({
  isOpen,
  payload,
  onClose,
  onApprove,
  onRevise,
  isPublishing = false,
}: ExactApprovalModalProps) {
  const [revisionNote, setRevisionNote] = useState('')
  const [showRevisionInput, setShowRevisionInput] = useState(false)

  if (!isOpen) return null

  const fingerprint = computeExactApprovalFingerprint(payload)

  const handleConfirm = async () => {
    await onApprove(fingerprint)
  }

  const handleSendRevision = () => {
    if (onRevise && revisionNote.trim()) {
      onRevise(revisionNote)
      setShowRevisionInput(false)
      setRevisionNote('')
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
      <div className="w-full max-w-2xl rounded-3xl bg-card border border-border p-6 md:p-8 space-y-6 shadow-2xl animate-in zoom-in-95 my-8">
        {/* Modal Header Strip */}
        <div className="flex items-center justify-between border-b border-border/80 pb-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 text-[10px] font-bold bg-state-warn-soft text-state-warn border border-[var(--state-warn-line)] rounded-full">
                TARGET PROTOTYPE · SAMPLE DATA
              </span>
              <span className="text-xs text-muted-foreground">정밀 검수 승인</span>
            </div>
            <h2 className="text-xl font-bold text-foreground flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-primary" />
              <span>정식 발행 사전 승인 (Exact Approval)</span>
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-xl bg-muted text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Preview & Image */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Visual Asset Preview */}
          <div className="space-y-2">
            <div className="text-xs font-bold text-foreground/90 flex items-center gap-1.5">
              <Camera className="w-3.5 h-3.5 text-state-warn" />
              <span>발행 대표 이미지 (이미지 스타일 기준 V1 적용)</span>
            </div>
            {payload.imageUrl ? (
              <div className="relative aspect-square rounded-2xl overflow-hidden bg-muted/40 border border-border">
                <img src={payload.imageUrl} alt="발행 이미지" className="w-full h-full object-cover" />
                {/* 항상 어두운 사진 위 배지 — 테마 잉크(text-state-ok)를 얹으면 라이트에서 읽히지 않으므로,
                    채움 표면(bg-state-ok) + 대응 전경(text-state-ok-soft)으로 고정한다. */}
                <div className="absolute bottom-2 left-2 flex items-center gap-1 text-[10px] font-semibold bg-state-ok text-state-ok-soft px-2 py-0.5 rounded-md">
                  <ShieldCheck className="w-3 h-3" />
                  <span>{payload.rightsAndConsent.rightsStatus}</span>
                </div>
              </div>
            ) : (
              <div className="aspect-square rounded-2xl bg-muted/40 border border-dashed border-border flex items-center justify-center text-xs text-muted-foreground">
                이미지 없음 (텍스트 전용)
              </div>
            )}
          </div>

          {/* Copy Text Preview */}
          <div className="space-y-2 flex flex-col justify-between">
            <div className="space-y-2">
              <div className="text-xs font-bold text-foreground/90 flex items-center gap-1.5">
                <FileText className="w-3.5 h-3.5 text-primary" />
                <span>승인 대상 본문 문구</span>
              </div>
              <div className="p-3.5 rounded-2xl bg-muted/40 border border-border text-xs text-foreground leading-relaxed max-h-56 overflow-y-auto whitespace-pre-wrap break-words">
                {payload.copyText}
              </div>
            </div>

            {/* Target Channels */}
            <div className="p-3 rounded-xl bg-muted/40 border border-border space-y-1.5">
              <span className="text-[11px] font-bold text-muted-foreground block">발행 대상 채널 (동시 게시)</span>
              <div className="flex items-center gap-2 text-xs font-semibold">
                {payload.channelTargets.includes('instagram') && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-muted text-foreground border border-border">
                    <InstagramIcon className="w-3.5 h-3.5" />
                    <span>Instagram (@sohee_bakery)</span>
                  </span>
                )}
                {payload.channelTargets.includes('threads') && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-muted text-foreground border border-border">
                    <AtSign className="w-3.5 h-3.5" />
                    <span>Threads (@sohee_bakery)</span>
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Human-Readable Harness Lineage Card */}
        <div className="p-4 rounded-2xl bg-muted/40 border border-border space-y-3 text-xs">
          <div className="flex items-center justify-between text-muted-foreground font-semibold border-b border-border/80 pb-2">
            <span>적용된 소희 업무 기준 (원칙 이력)</span>
            <span className="font-mono text-[10px] text-primary">{fingerprint}</span>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[11px]">
            <div className="p-2 rounded-xl bg-background border border-border">
              <span className="text-muted-foreground block text-[10px]">매장 지식 (Knowledge)</span>
              <span className="font-bold text-foreground">
                {payload.harnessVersions.knowledgeVersionId || 'v1.0 (정본)'}
              </span>
            </div>
            <div className="p-2 rounded-xl bg-background border border-border">
              <span className="text-muted-foreground block text-[10px]">문체 스타일 기준 (Text)</span>
              <span className="font-bold text-foreground">
                {payload.harnessVersions.textHarnessVersionId || 'v1 (친근/따뜻)'}
              </span>
            </div>
            <div className="p-2 rounded-xl bg-background border border-border">
              <span className="text-muted-foreground block text-[10px]">이미지 스타일 기준 (Image)</span>
              <span className="font-bold text-foreground">
                {payload.harnessVersions.imageHarnessVersionId || 'v1 (자연광/골든3장)'}
              </span>
            </div>
            <div className="p-2 rounded-xl bg-background border border-border">
              <span className="text-muted-foreground block text-[10px]">권리 및 초상권 (Rights)</span>
              {['OWNED', 'LICENSED', 'USER_CONFIRMED', 'confirmed'].includes(payload.rightsAndConsent?.rightsStatus) ? (
                <span className="font-bold text-state-ok flex items-center gap-1">
                  <Check className="w-3 h-3" />
                  <span>검증 완료</span>
                </span>
              ) : (
                <span className="font-bold text-muted-foreground flex items-center gap-1">
                  <span>확인 필요</span>
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Natural Language Revision Section */}
        {showRevisionInput ? (
          <div className="p-3.5 rounded-2xl bg-muted/40 border border-border space-y-2">
            <span className="text-xs font-bold text-foreground/90 block">수정 요청 내용 입력 (새 버전 생성 및 기존 승인 무효화)</span>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={revisionNote}
                onChange={(e) => setRevisionNote(e.target.value)}
                placeholder="예: '문구를 조금 더 짧고 간결하게 줄여줘'..."
                className="flex-1 bg-background border border-border rounded-xl px-3 py-2 text-xs text-foreground focus:outline-none focus:border-primary"
              />
              <button
                type="button"
                onClick={handleSendRevision}
                disabled={!revisionNote.trim()}
                className="px-3.5 py-2 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-bold disabled:opacity-40"
              >
                수정 요청
              </button>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>마음에 들지 않는 부분이 있으신가요?</span>
            <button
              type="button"
              onClick={() => setShowRevisionInput(true)}
              className="text-primary hover:underline font-semibold"
            >
              자연어로 수정 요청하기
            </button>
          </div>
        )}

        {/* Bottom Actions */}
        <div className="flex items-center justify-end gap-3 pt-2 border-t border-border/80">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2.5 rounded-xl bg-muted hover:bg-muted/70 text-foreground text-xs font-bold transition-colors cursor-pointer"
          >
            취소 / 닫기
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={isPublishing}
            className="px-6 py-2.5 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-bold flex items-center gap-2 shadow-lg shadow-primary/20 cursor-pointer disabled:opacity-50"
          >
            <Check className="w-4 h-4 stroke-[3]" />
            <span>{isPublishing ? '발행 진행 중...' : '최종 승인 및 동시 발행'}</span>
          </button>
        </div>
      </div>
    </div>
  )
}
