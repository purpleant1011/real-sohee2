'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  AlertCircle,
  FileText,
  Globe,
  ImageIcon,
  Link2,
  Plus,
  Sparkles,
  X,
} from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { uploadKnowledgeAction } from '@/features/knowledge/actions/upload-knowledge'
import { registerUrlSourceAction } from '@/features/knowledge/actions/register-url-source'
import { reviewKnowledgeAction } from '@/features/knowledge/actions/review-knowledge'
import { MaterialSuggestionDialog } from './material-suggestion-dialog'
import { ChannelLearningPanel } from '@/features/channel-learning/components/channel-learning-panel'
import type { SupportedChannel } from '@/features/channels/channel-capabilities'
import type { ExtractedSuggestion, MaterialItem } from '@/features/sohee-materials/types'

export type { MaterialItem }

interface MaterialsBoxProps {
  workspaceId: string
  onMaterialUpdated: () => void
}

const STATUS_CONFIG: Record<
  MaterialItem['status'],
  { label: string; badgeVariant: 'secondary' | 'warning' | 'success' | 'destructive' }
> = {
  received: { label: '받았어요', badgeVariant: 'secondary' },
  needs_review: { label: '확인해 주세요', badgeVariant: 'warning' },
  learned: { label: '반영됐어요', badgeVariant: 'success' },
  attention: { label: '확인이 필요해요', badgeVariant: 'destructive' },
}

const CHANNEL_OPTIONS: { value: SupportedChannel; label: string }[] = [
  { value: 'instagram', label: '인스타그램' },
  { value: 'naver_blog', label: '네이버 블로그' },
  { value: 'naver_place', label: '네이버 플레이스' },
  { value: 'daangn_business', label: '당근 비즈프로필' },
  { value: 'threads', label: '스레드' },
]

function detectChannel(url: string): SupportedChannel | null {
  try {
    const host = new URL(url).hostname.toLowerCase()
    if (host.includes('instagram.com')) return 'instagram'
    if (host.includes('threads.net')) return 'threads'
    if (host.includes('blog.naver.com')) return 'naver_blog'
    if (host.includes('map.naver.com') || host.includes('naver.me')) return 'naver_place'
    if (host.includes('daangn.com')) return 'daangn_business'
    return null
  } catch {
    return null
  }
}

export function MaterialsBox({ workspaceId, onMaterialUpdated }: MaterialsBoxProps) {
  const [items, setItems] = useState<MaterialItem[]>([])
  const [learnedCount, setLearnedCount] = useState(0)
  const [isLoading, setIsLoading] = useState(true)
  const [isUploading, setIsUploading] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [showUrlForm, setShowUrlForm] = useState(false)
  const [urlInput, setUrlInput] = useState('')
  const [channelInput, setChannelInput] = useState<SupportedChannel>('instagram')
  const [isOwned, setIsOwned] = useState(true)
  const [showChannelLearning, setShowChannelLearning] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [reviewingId, setReviewingId] = useState<string | null>(null)

  // 추천 지식 모달 상태
  const [activeSuggestionModal, setActiveSuggestionModal] = useState<{
    item: MaterialItem
    suggestions: ExtractedSuggestion[]
  } | null>(null)
  const [loadingSuggestionsId, setLoadingSuggestionsId] = useState<string | null>(null)

  const fileInputRef = useRef<HTMLInputElement>(null)

  const loadMaterials = useCallback(async () => {
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/knowledge/materials`)
      if (!res.ok) {
        setIsLoading(false)
        return
      }
      const json = await res.json()
      if (json.success && json.data) {
        setItems(json.data.items ?? [])
        setLearnedCount(json.data.learnedCount ?? 0)
      }
    } catch {
      // ignore
    } finally {
      setIsLoading(false)
    }
  }, [workspaceId])

  useEffect(() => {
    void loadMaterials()
  }, [loadMaterials])

  const handleFileUpload = async (file: File) => {
    setIsUploading(true)
    setActionError(null)

    const formData = new FormData()
    formData.set('workspaceId', workspaceId)
    formData.set('file', file)

    try {
      const result = await uploadKnowledgeAction(formData)
      if (result.error) {
        setActionError('자료를 올리지 못했어요. 파일 형식과 크기를 확인해 주세요.')
        return
      }
      await loadMaterials()
      onMaterialUpdated()
    } catch {
      setActionError('자료를 올리지 못했어요. 다시 시도해 주세요.')
    } finally {
      setIsUploading(false)
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    }
  }

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      void handleFileUpload(file)
    }
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    const file = e.dataTransfer.files?.[0]
    if (file) {
      void handleFileUpload(file)
    }
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }

  const handleDragLeave = () => {
    setIsDragging(false)
  }

  const handleUrlInputChange = (val: string) => {
    setUrlInput(val)
    const detected = detectChannel(val)
    if (detected) {
      setChannelInput(detected)
    }
  }

  const handleRegisterUrl = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!urlInput.trim()) return

    try {
      new URL(urlInput.trim())
    } catch {
      setActionError('올바른 URL 형식(https://...)을 입력해 주세요.')
      return
    }

    setIsUploading(true)
    setActionError(null)

    try {
      const result = await registerUrlSourceAction({
        workspaceId,
        url: urlInput.trim(),
        channel: channelInput,
        ownership: isOwned ? 'owned' : 'reference',
      })

      if (result.error) {
        setActionError('주소 출처를 등록하지 못했어요. 올바른 주소인지 확인해 주세요.')
        return
      }

      setUrlInput('')
      setShowUrlForm(false)
      await loadMaterials()
      onMaterialUpdated()
    } catch {
      setActionError('주소 출처를 등록하지 못했어요. 다시 시도해 주세요.')
    } finally {
      setIsUploading(false)
    }
  }

  const handleReviewConfirm = async (item: MaterialItem) => {
    setReviewingId(item.id)
    setActionError(null)

    try {
      const result = await reviewKnowledgeAction({
        workspaceId,
        knowledgeId: item.id,
        decision: 'approved',
      })

      if (result.error) {
        setActionError('자료를 승인하지 못했어요. 다시 시도해 주세요.')
        return
      }

      await loadMaterials()
      onMaterialUpdated()
    } catch {
      setActionError('자료를 승인하지 못했어요. 다시 시도해 주세요.')
    } finally {
      setReviewingId(null)
    }
  }

  // 지식 발견 확인 클릭 시 API 호출하여 모달 열기
  const handleOpenSuggestions = async (item: MaterialItem) => {
    setLoadingSuggestionsId(item.id)
    setActionError(null)

    try {
      const res = await fetch(
        `/api/workspaces/${workspaceId}/knowledge/materials/${item.id}/suggestions`,
      )
      const json = await res.json().catch(() => ({}))

      if (!res.ok || !json.success || !Array.isArray(json.data?.suggestions)) {
        setActionError('추천 지식을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.')
        return
      }

      setActiveSuggestionModal({
        item,
        suggestions: json.data.suggestions,
      })
    } catch {
      setActionError('추천 지식을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.')
    } finally {
      setLoadingSuggestionsId(null)
    }
  }

  return (
    <Card className="rounded-[20px] p-6 space-y-5">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <h3 className="text-lg font-bold">자료함</h3>
          <Badge variant="purple" className="text-xs font-bold">
            {`${learnedCount}개 배웠어요`}
          </Badge>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            setShowUrlForm((prev) => !prev)
            setActionError(null)
          }}
          className="h-8 gap-1 text-xs font-bold"
        >
          {showUrlForm ? (
            <>
              <X className="size-3.5" aria-hidden /> 닫기
            </>
          ) : (
            <>
              <Plus className="size-3.5" aria-hidden /> 주소 추가
            </>
          )}
        </Button>
      </div>

      {/* 에러 메시지 알림 */}
      {actionError && (
        <div
          role="alert"
          className="flex items-center gap-2 text-xs font-semibold text-destructive bg-destructive/10 p-3 rounded-xl"
        >
          <AlertCircle className="size-4 shrink-0" aria-hidden />
          <span>{actionError}</span>
        </div>
      )}

      {/* 주소 등록 폼 */}
      {showUrlForm && (
        <form
          onSubmit={handleRegisterUrl}
          className="bg-accent/70 rounded-2xl p-4 border border-primary/15 space-y-3"
        >
          <div className="flex items-center gap-1.5 text-xs font-bold text-primary">
            <Globe className="size-4" aria-hidden />
            <span>온라인 채널 주소 등록</span>
          </div>

          <div className="space-y-2">
            <div className="grid grid-cols-1 sm:grid-cols-[140px_1fr] gap-2">
              <select
                value={channelInput}
                onChange={(e) => setChannelInput(e.target.value as SupportedChannel)}
                disabled={isUploading}
                aria-label="채널 종류"
                className="h-9 rounded-xl border border-input bg-background px-3 text-xs font-medium focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                {CHANNEL_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
              <Input
                type="url"
                value={urlInput}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => handleUrlInputChange(e.target.value)}
                placeholder="https://instagram.com/가게계정"
                disabled={isUploading}
                className="h-9 text-xs"
                required
              />
            </div>

            <label className="flex items-center gap-2 cursor-pointer pt-1 text-xs text-zinc-700">
              <input
                type="checkbox"
                checked={isOwned}
                onChange={(e) => setIsOwned(e.target.checked)}
                disabled={isUploading}
                className="size-4 rounded border-input text-primary focus:ring-primary"
              />
              <span className="font-medium">우리 가게 공식 채널이에요 (가게 사실 정보로 반영 대기 · 단순 등록)</span>
            </label>
            <p className="text-[11px] text-muted-foreground pt-0.5">
              * 단순 주소 등록은 확인 완료 상태가 아닙니다. 공식 연결을 통한 본인 확인 및 자동 수집·승인은 아래 공식 채널 학습을 이용해 주세요.
            </p>
          </div>

          <div className="flex items-center justify-between pt-1">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setShowChannelLearning((prev) => !prev)}
              className="h-8 text-xs font-semibold text-primary border-primary/20 hover:bg-primary/5"
            >
              {showChannelLearning ? '채널 학습 닫기' : '공식 채널 학습 패널 열기'}
            </Button>
            <Button
              type="submit"
              disabled={isUploading || !urlInput.trim()}
              size="sm"
              className="h-8 px-4 text-xs font-bold"
            >
              {isUploading ? '등록하는 중...' : '주소 등록하기'}
            </Button>
          </div>
        </form>
      )}

      {/* 공식 채널 지식 학습 및 본인 확인 패널 */}
      {showChannelLearning && (
        <div className="pt-2 pb-2">
          <ChannelLearningPanel
            workspaceId={workspaceId}
            canManage={true}
            onKnowledgeUpdated={async () => {
              await loadMaterials()
              onMaterialUpdated()
            }}
          />
        </div>
      )}

      {/* 파일 드롭존 */}
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        className={`border-2 border-dashed rounded-2xl p-6 flex flex-col items-center justify-center text-center cursor-pointer transition-colors ${
          isDragging
            ? 'border-primary bg-primary/5'
            : 'border-border bg-muted/30 hover:bg-muted/50'
        }`}
      >
        <input
          ref={fileInputRef}
          type="file"
          data-testid="materials-file-input"
          onChange={handleFileInputChange}
          accept=".pdf,.txt,.doc,.docx,.jpg,.jpeg,.png,application/pdf,image/*"
          className="hidden"
          disabled={isUploading}
        />

        <div className="flex items-center gap-2 text-muted-foreground mb-2.5">
          <FileText className="size-5" aria-hidden />
          <ImageIcon className="size-5" aria-hidden />
          <Link2 className="size-5" aria-hidden />
        </div>

        <p className="text-xs font-bold text-zinc-800 mb-1">
          {isUploading ? '자료를 올리는 중이에요...' : 'PDF·문서·이미지·링크, 최대 8MB'}
        </p>
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          회사소개서, 운영 매뉴얼, 메뉴판, 사진 등을 마우스로 끌어놓거나 클릭해서 올려주세요
        </p>
      </div>

      {/* 자료 리스트 */}
      <div className="space-y-2">
        {items.length === 0 && !isLoading ? (
          <div className="text-center py-6 text-xs text-muted-foreground">
            아직 등록된 자료가 없어요. 첫 번째 자료를 올려주세요!
          </div>
        ) : (
          items.map((item) => {
            const statusCfg = STATUS_CONFIG[item.status]
            const isReviewable = item.status === 'needs_review' && item.source === 'item'

            return (
              <div
                key={item.id}
                className="flex flex-col sm:flex-row sm:items-center justify-between p-3.5 rounded-2xl border border-border bg-card shadow-xs gap-3"
              >
                <div className="flex items-center gap-3 min-w-0 pr-2">
                  <div className="size-8.5 rounded-xl bg-accent text-accent-foreground flex items-center justify-center shrink-0">
                    {item.kind === 'file' ? (
                      <FileText className="size-4 text-primary" aria-hidden />
                    ) : (
                      <Link2 className="size-4 text-primary" aria-hidden />
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-zinc-800 truncate">{item.name}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {new Date(item.createdAt).toLocaleDateString('ko-KR')}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0 self-end sm:self-auto">
                  {/* ✨ 지식 발견 & 확인 버튼 */}
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={loadingSuggestionsId === item.id}
                    onClick={() => handleOpenSuggestions(item)}
                    className="h-7 px-2.5 text-xs font-bold text-primary bg-primary/10 hover:bg-primary/15 border border-primary/30 rounded-lg gap-1"
                  >
                    <Sparkles className="size-3 text-primary" />
                    <span>
                      {loadingSuggestionsId === item.id ? '분석 중...' : '지식 확인'}
                    </span>
                  </Button>

                  <Badge variant={statusCfg.badgeVariant} className="text-[11px]">
                    {statusCfg.label}
                  </Badge>

                  {isReviewable && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={reviewingId === item.id}
                      onClick={() => handleReviewConfirm(item)}
                      className="h-7 px-2.5 text-xs font-bold text-primary border-primary/30 hover:bg-primary/10"
                    >
                      {reviewingId === item.id ? '확인 중...' : '이해 확인'}
                    </Button>
                  )}
                </div>
              </div>
            )
          })
        )}
      </div>

      {/* 추천 지식 확인 & 승격 모달 */}
      {activeSuggestionModal && (
        <MaterialSuggestionDialog
          isOpen={true}
          onClose={() => setActiveSuggestionModal(null)}
          workspaceId={workspaceId}
          materialId={activeSuggestionModal.item.id}
          materialName={activeSuggestionModal.item.name}
          suggestions={activeSuggestionModal.suggestions}
          onPromoted={async () => {
            await loadMaterials()
            onMaterialUpdated()
          }}
        />
      )}
    </Card>
  )
}
