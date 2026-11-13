'use client'

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  BookOpen,
  Loader2,
  MessageSquare,
  Pencil,
  Plus,
  Send,
  Sparkles,
  Trash2,
} from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { Skeleton } from '@/components/ui/skeleton'
import { Dialog } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { KnowledgeRadarCard } from './knowledge-radar-card'
import { FactToPostModal } from './fact-to-post-modal'
import type { FactItem } from '@/features/sohee-knowledge/types'

export interface KnowledgeLibraryProps {
  workspaceId: string
  onKnowledgeChanged?: () => void
}

type FilterCategoryKey =
  | 'ALL'
  | 'MENU_PRICE'
  | 'HOURS'
  | 'DIFFERENTIATOR'
  | 'FAQ'
  | 'PROHIBITED'

const FILTER_TABS: { key: FilterCategoryKey; label: string }[] = [
  { key: 'ALL', label: '전체' },
  { key: 'MENU_PRICE', label: '메뉴 & 가격' },
  { key: 'HOURS', label: '영업 & 위치' },
  { key: 'DIFFERENTIATOR', label: '매장 특징' },
  { key: 'FAQ', label: '자주 묻는 질문' },
  { key: 'PROHIBITED', label: '주의할 점' },
]

const CATEGORY_LABEL_MAP: Record<string, string> = {
  MENU: '메뉴',
  PRICE: '가격',
  HOURS: '영업시간',
  DIFFERENTIATOR: '특징',
  FAQ: 'FAQ',
  PROHIBITED: '주의',
  MANUAL: '기타',
}

const SOURCE_LABEL_MAP: Record<string, string> = {
  interview: '소희 인터뷰',
  file: '첨부 자료',
  manual: '직접 등록',
}

const CATEGORY_OPTIONS = [
  { value: 'MENU', label: '대표 메뉴' },
  { value: 'PRICE', label: '가격 및 구성' },
  { value: 'HOURS', label: '영업시간 및 휴무' },
  { value: 'DIFFERENTIATOR', label: '매장 비법 및 차별점' },
  { value: 'FAQ', label: '자주 묻는 질문(FAQ)' },
  { value: 'PROHIBITED', label: '주의사항 및 금지어' },
]

export function KnowledgeLibrary({
  workspaceId,
  onKnowledgeChanged,
}: KnowledgeLibraryProps) {
  const [facts, setFacts] = useState<FactItem[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<FilterCategoryKey>('ALL')

  // 인라인 수정 상태
  const [editingFactId, setEditingFactId] = useState<string | null>(null)
  const [editingContent, setEditingContent] = useState('')
  const [isUpdating, setIsUpdating] = useState(false)

  // 삭제 확인 모달 상태
  const [deletingFact, setDeletingFact] = useState<FactItem | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)

  // 새 지식 추가 모달 상태
  const [isAddModalOpen, setIsAddModalOpen] = useState(false)
  const [newCategory, setNewCategory] = useState('MENU')
  const [newContent, setNewContent] = useState('')
  const [isCreating, setIsCreating] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  // 원클릭 글쓰기 모달 상태
  const [selectedFactForPost, setSelectedFactForPost] = useState<FactItem | null>(null)

  const loadFacts = useCallback(async () => {
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/knowledge/facts`)
      if (!res.ok) {
        setIsLoading(false)
        return
      }
      const json = await res.json()
      if (json.success && json.data) {
        setFacts(json.data.facts ?? [])
      }
    } catch {
      // ignore
    } finally {
      setIsLoading(false)
    }
  }, [workspaceId])

  useEffect(() => {
    void loadFacts()
  }, [loadFacts])

  // 카테고리 필터링
  const filteredFacts = useMemo(() => {
    if (activeTab === 'ALL') return facts
    if (activeTab === 'MENU_PRICE') {
      return facts.filter((f) => f.category === 'MENU' || f.category === 'PRICE')
    }
    return facts.filter((f) => f.category === activeTab)
  }, [facts, activeTab])

  // 인라인 수정 시작
  const handleStartEdit = (fact: FactItem) => {
    setEditingFactId(fact.id)
    setEditingContent(fact.content)
  }

  // 인라인 수정 취소
  const handleCancelEdit = () => {
    setEditingFactId(null)
    setEditingContent('')
  }

  // 인라인 수정 저장 (PATCH)
  const handleSaveEdit = async (factId: string) => {
    if (!editingContent.trim()) return

    setIsUpdating(true)
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/knowledge/facts/${factId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: editingContent.trim() }),
      })

      if (res.ok) {
        setEditingFactId(null)
        setEditingContent('')
        await loadFacts()
        onKnowledgeChanged?.()
      }
    } catch {
      // ignore
    } finally {
      setIsUpdating(false)
    }
  }

  // 지식 삭제 (DELETE)
  const handleConfirmDelete = async () => {
    if (!deletingFact) return

    setIsDeleting(true)
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/knowledge/facts/${deletingFact.id}`, {
        method: 'DELETE',
      })

      if (res.ok) {
        setDeletingFact(null)
        await loadFacts()
        onKnowledgeChanged?.()
      }
    } catch {
      // ignore
    } finally {
      setIsDeleting(false)
    }
  }

  // 새 지식 추가 (POST)
  const handleCreateFact = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newContent.trim()) {
      setFormError('지식 내용을 입력해 주세요.')
      return
    }

    setIsCreating(true)
    setFormError(null)

    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/knowledge/facts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category: newCategory,
          content: newContent.trim(),
        }),
      })

      if (res.ok) {
        setIsAddModalOpen(false)
        setNewContent('')
        setNewCategory('MENU')
        await loadFacts()
        onKnowledgeChanged?.()
      } else {
        setFormError('지식을 등록하지 못했어요. 잠시 후 다시 시도해 주세요.')
      }
    } catch {
      setFormError('지식을 등록하지 못했어요. 잠시 후 다시 시도해 주세요.')
    } finally {
      setIsCreating(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* 1. 소희의 마케팅 레이더 & 역질문 브리핑 카드 */}
      <KnowledgeRadarCard
        workspaceId={workspaceId}
        onFactCreated={async () => {
          await loadFacts()
          onKnowledgeChanged?.()
        }}
      />

      {/* 2. 지식 도서관 본체 카드 */}
      <Card className="space-y-6 rounded-[20px] p-6 shadow-sm border">
        {/* 헤더 섹션 */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <BookOpen className="size-5 text-primary" aria-hidden="true" />
              <h2 className="text-lg font-bold text-foreground">지식 도서관</h2>
              {!isLoading && (
                <Badge variant="secondary" className="font-semibold text-xs rounded-full px-2.5">
                  {facts.length}개
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              소희가 배운 우리 가게 지식을 확인하고 다듬어 보세요.
            </p>
          </div>

          <Button
            onClick={() => {
              setFormError(null)
              setIsAddModalOpen(true)
            }}
            className="gap-1.5 rounded-xl font-semibold self-start sm:self-auto cursor-pointer"
            size="sm"
          >
            <Plus className="size-4" aria-hidden="true" />
            <span>새 지식 추가</span>
          </Button>
        </div>

        {/* 카테고리 필터 탭 */}
        <div
          role="tablist"
          aria-label="지식 카테고리 필터"
          className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none"
        >
          {FILTER_TABS.map((tab) => {
            const isSelected = activeTab === tab.key
            return (
              <button
                key={tab.key}
                type="button"
                role="tab"
                aria-selected={isSelected}
                onClick={() => setActiveTab(tab.key)}
                className={cn(
                  'px-3.5 py-1.5 rounded-xl text-xs font-medium whitespace-nowrap transition-colors cursor-pointer',
                  isSelected
                    ? 'bg-primary text-primary-foreground font-bold shadow-xs'
                    : 'bg-muted/70 text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                {tab.label}
              </button>
            )
          })}
        </div>

        {/* 카드 리스트 섹션 */}
        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((n) => (
              <div key={n} className="rounded-2xl border p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <Skeleton className="h-5 w-14 rounded-full" />
                  <Skeleton className="h-5 w-24 rounded-full" />
                  <Skeleton className="h-5 w-16 rounded-full" />
                </div>
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/4" />
              </div>
            ))}
          </div>
        ) : filteredFacts.length === 0 ? (
          <div className="rounded-2xl border border-dashed p-8 text-center space-y-2 bg-muted/20">
            <p className="text-sm font-medium text-muted-foreground">
              {activeTab === 'ALL'
                ? '아직 등록된 지식이 없어요. 인터뷰에 답하시거나 새 지식을 추가해 보세요!'
                : '해당 카테고리에 등록된 지식이 없어요.'}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredFacts.map((fact) => {
              const isEditing = editingFactId === fact.id
              const showBlogBadge =
                fact.category === 'MENU' ||
                fact.category === 'PRICE' ||
                fact.category === 'DIFFERENTIATOR'
              const showDmBadge =
                fact.category === 'FAQ' ||
                fact.category === 'HOURS' ||
                fact.category === 'PRICE'

              return (
                <div
                  key={fact.id}
                  className={cn(
                    'rounded-2xl border bg-card p-4 transition-all space-y-3 shadow-2xs',
                    isEditing && 'ring-2 ring-primary/40 bg-accent/20',
                  )}
                >
                  {/* 카드 상단: 카테고리 칩 + 활용처 배지 + 출처 + 액션 버튼 */}
                  <div className="flex items-start justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {/* 카테고리 칩 */}
                      <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-bold bg-secondary text-secondary-foreground">
                        {CATEGORY_LABEL_MAP[fact.category] ?? fact.category}
                      </span>

                      {/* 활용처 인디케이터 배지: 인스타·블로그 글감 */}
                      {showBlogBadge && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-primary/10 text-primary border border-primary/30">
                          <Sparkles className="size-3 text-primary" aria-hidden="true" />
                          인스타·블로그 글감
                        </span>
                      )}

                      {/* 활용처 인디케이터 배지: DM·댓글 답변용 */}
                      {showDmBadge && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-state-ok-soft text-state-ok border border-state-ok/30">
                          <MessageSquare className="size-3 text-state-ok" aria-hidden="true" />
                          DM·댓글 답변용
                        </span>
                      )}

                      {/* 출처 표시 */}
                      <span className="text-[11px] text-muted-foreground/80 ml-1">
                        {SOURCE_LABEL_MAP[fact.source] ?? fact.source}
                      </span>
                    </div>

                    {/* 액션 버튼 */}
                    {!isEditing && (
                      <div className="flex items-center gap-1 shrink-0">
                        {/* ✨ 원클릭 글쓰기 버튼 */}
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => setSelectedFactForPost(fact)}
                          className="h-7 px-2.5 text-xs font-bold text-primary bg-primary/10 hover:bg-primary/20 border border-primary/30 rounded-lg gap-1 cursor-pointer"
                        >
                          <Send className="size-3 text-primary" aria-hidden="true" />
                          이 지식으로 글쓰기
                        </Button>

                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => handleStartEdit(fact)}
                          className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground cursor-pointer"
                        >
                          <Pencil className="size-3 mr-1" aria-hidden="true" />
                          수정
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => setDeletingFact(fact)}
                          className="h-7 px-2 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive cursor-pointer"
                        >
                          <Trash2 className="size-3 mr-1" aria-hidden="true" />
                          삭제
                        </Button>
                      </div>
                    )}
                  </div>

                  {/* 카드 본문: 평소 상태 vs 인라인 편집 상태 */}
                  {isEditing ? (
                    <div className="space-y-3 pt-1">
                      <Textarea
                        aria-label="지식 내용 수정"
                        value={editingContent}
                        onChange={(e) => setEditingContent(e.target.value)}
                        rows={3}
                        className="resize-none text-sm leading-relaxed rounded-xl"
                        disabled={isUpdating}
                      />
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={handleCancelEdit}
                          disabled={isUpdating}
                          className="h-8 rounded-lg text-xs cursor-pointer"
                        >
                          취소
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => handleSaveEdit(fact.id)}
                          disabled={isUpdating || !editingContent.trim()}
                          className="h-8 rounded-lg text-xs font-semibold cursor-pointer"
                        >
                          {isUpdating && <Loader2 className="size-3 animate-spin mr-1.5" aria-hidden="true" />}
                          저장
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">
                      {fact.content}
                    </p>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* [+ 새 지식 추가] 다이얼로그 모달 */}
        <Dialog
          open={isAddModalOpen}
          onOpenChange={(open) => {
            setIsAddModalOpen(open)
            if (!open) {
              setFormError(null)
            }
          }}
          title="새 지식 추가하기"
        >
          <form onSubmit={handleCreateFact} className="space-y-4 pt-2">
            <p className="text-xs text-muted-foreground">
              소희에게 우리 가게에 대한 새로운 정보를 알려주세요.
            </p>

            <div className="space-y-1.5">
              <label htmlFor="new-fact-category" className="text-xs font-semibold text-foreground">
                카테고리 선택
              </label>
              <select
                id="new-fact-category"
                aria-label="카테고리 선택"
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value)}
                disabled={isCreating}
                className="h-10 w-full rounded-xl border border-input bg-background px-3 text-xs font-medium focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                {CATEGORY_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="new-fact-content" className="text-xs font-semibold text-foreground">
                지식 내용 입력
              </label>
              <Textarea
                id="new-fact-content"
                aria-label="지식 내용 입력"
                value={newContent}
                onChange={(e) => setNewContent(e.target.value)}
                placeholder="예: 주말 단체석은 4인 이상부터 네이버 예약으로 가능해요."
                rows={4}
                className="resize-none text-sm leading-relaxed rounded-xl"
                disabled={isCreating}
              />
            </div>

            {formError && (
              <p className="text-xs font-semibold text-destructive">{formError}</p>
            )}

            <div className="flex items-center justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setIsAddModalOpen(false)}
                disabled={isCreating}
                className="h-9 rounded-xl text-xs font-medium cursor-pointer"
              >
                취소
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={isCreating || !newContent.trim()}
                className="h-9 rounded-xl text-xs font-bold gap-1.5 cursor-pointer"
              >
                {isCreating && <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />}
                소희에게 가르치기
              </Button>
            </div>
          </form>
        </Dialog>

        {/* 삭제 확인 다이얼로그 모달 */}
        <Dialog
          open={Boolean(deletingFact)}
          onOpenChange={(open) => !open && setDeletingFact(null)}
          title="지식을 삭제하시겠어요?"
        >
          <div className="space-y-4 pt-2">
            <p className="text-xs text-muted-foreground leading-relaxed">
              삭제된 지식은 소희의 학습 내용에서 제외되며, 향후 글쓰기나 고객 응대 답변에 반영되지 않아요.
            </p>

            {deletingFact && (
              <div className="rounded-xl border bg-muted/30 p-3 text-xs text-foreground/80 line-clamp-2">
                {deletingFact.content}
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setDeletingFact(null)}
                disabled={isDeleting}
                className="h-9 rounded-xl text-xs font-medium cursor-pointer"
              >
                취소
              </Button>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                onClick={handleConfirmDelete}
                disabled={isDeleting}
                className="h-9 rounded-xl text-xs font-bold gap-1.5 cursor-pointer"
              >
                {isDeleting && <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />}
                삭제하기
              </Button>
            </div>
          </div>
        </Dialog>

        {/* ✨ 원클릭 지식 글쓰기 모달 */}
        {selectedFactForPost && (
          <FactToPostModal
            isOpen={true}
            onClose={() => setSelectedFactForPost(null)}
            fact={selectedFactForPost}
          />
        )}
      </Card>
    </div>
  )
}
