'use client'

import React, { useEffect, useState } from 'react'
import {
  BookOpen,
  CheckCircle2,
  Edit3,
  ExternalLink,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
} from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import type { KnowledgeView } from '../types'
import { containsFactPlaceholder } from '@/features/knowledge/fact-placeholder'
import type { SoheeTab } from '@/features/sohee-menu/legacy-tab-map'

const CATEGORY_TABS = [
  { key: 'ALL', label: '전체' },
  { key: 'MENU', label: '메뉴' },
  { key: 'PRICE', label: '가격' },
  { key: 'HOURS', label: '영업정보' },
  { key: 'DIFFERENTIATOR', label: '차별점' },
  { key: 'FAQ', label: '자주 묻는 질문' },
]

const CATEGORY_LABEL_MAP: Record<string, string> = {
  MENU: '메뉴',
  PRICE: '가격',
  HOURS: '영업정보',
  DIFFERENTIATOR: '차별점',
  FAQ: '자주 묻는 질문',
}

export function formatCategoryLabel(category?: string): string {
  if (!category) return '일반'
  return CATEGORY_LABEL_MAP[category.toUpperCase()] || category
}

function formatSourceLabel(kind?: string): string {
  if (kind === 'owner_statement') return '사장님 말씀'
  if (kind === 'approved_document') return '승인된 자료'
  if (kind === 'external_verified') return '외부 검증'
  if (kind === 'imported_source') return '외부 수집 자료'
  if (kind === 'unknown') return '출처 미확인'
  return '출처 미확인'
}

interface BrainKnowledgeTabProps {
  workspaceId: string
  onSelectKnowledgeForCorrection?: (fact: KnowledgeView) => void
  onRefreshTrigger?: number
  onGoToLegacyTab?: (tab: SoheeTab) => void
}

export function BrainKnowledgeTab({
  workspaceId,
  onSelectKnowledgeForCorrection,
  onRefreshTrigger = 0,
  onGoToLegacyTab,
}: BrainKnowledgeTabProps) {
  const [knowledgeList, setKnowledgeList] = useState<KnowledgeView[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedCategory, setSelectedCategory] = useState('ALL')
  const [searchQuery, setSearchQuery] = useState('')

  const fetchKnowledge = async () => {
    setIsLoading(true)
    setError(null)
    try {
      const url =
        selectedCategory === 'ALL'
          ? `/api/workspaces/${workspaceId}/sohee-studio/knowledge`
          : `/api/workspaces/${workspaceId}/sohee-studio/knowledge?category=${selectedCategory}`
      const res = await fetch(url)
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`)
      }
      const json = await res.json().catch(() => ({}))
      if (json.success && Array.isArray(json.data)) {
        setKnowledgeList(json.data)
      } else {
        throw new Error(json.message || '지식 조회 실패')
      }
    } catch (err: any) {
      console.error('Failed to fetch knowledge:', err)
      setError('지식 목록을 불러오지 못했습니다.')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    void fetchKnowledge()
  }, [workspaceId, selectedCategory, onRefreshTrigger])

  const filteredList = knowledgeList.filter((item) => {
    if (!searchQuery) return true
    return item.content.toLowerCase().includes(searchQuery.toLowerCase())
  })

  return (
    <div className="space-y-4">
      {/* 자료함 안내 배너 (기존 자료함 upload gate 재사용) */}
      <div className="rounded-xl border border-purple-200 bg-purple-50/70 p-3 text-xs text-purple-800 dark:border-purple-900/60 dark:bg-purple-950/40 dark:text-purple-300 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <BookOpen className="size-4 shrink-0 text-purple-600 dark:text-purple-400" />
          <p className="text-[11px] text-purple-700/90 dark:text-purple-300/90 leading-tight">
            매장 소개서나 메뉴판 PDF 등 문서 학습은 기존 자료함에서 안전하게 검토 후 반영돼요.
          </p>
        </div>
        {onGoToLegacyTab && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => onGoToLegacyTab('teach')}
            className="h-7 text-xs px-2.5 border-purple-300 dark:border-purple-800 text-purple-700 dark:text-purple-300 shrink-0 hover:bg-purple-100 dark:hover:bg-purple-900"
          >
            <span>자료함 가기</span>
            <ExternalLink className="size-3 ml-1" />
          </Button>
        )}
      </div>

      {/* 검색 & 카테고리 필터 바 */}
      <div className="space-y-2">
        <div className="relative">
          <Search className="absolute left-3 top-2.5 size-3.5 text-muted-foreground" />
          <Input
            placeholder="소희가 알고 있는 지식 검색..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-8 text-xs h-9 bg-background"
          />
        </div>
        <div className="flex gap-1 overflow-x-auto pb-1 no-scrollbar">
          {CATEGORY_TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setSelectedCategory(tab.key)}
              className={`rounded-lg px-2.5 py-1 text-xs font-semibold whitespace-nowrap transition-colors ${
                selectedCategory === tab.key
                  ? 'bg-purple-600 text-white shadow-xs'
                  : 'bg-muted/60 text-muted-foreground hover:bg-muted'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* 지식 리스트 */}
      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-20 w-full rounded-xl" />
          <Skeleton className="h-20 w-full rounded-xl" />
          <Skeleton className="h-20 w-full rounded-xl" />
        </div>
      ) : error ? (
        <Card className="rounded-xl border border-destructive/30 bg-destructive/5 p-6 text-center space-y-3">
          <p className="text-xs font-semibold text-destructive">{error}</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void fetchKnowledge()}
            className="text-xs"
          >
            <RefreshCw className="size-3 mr-1" />
            다시 시도
          </Button>
        </Card>
      ) : filteredList.length === 0 ? (
        <Card className="rounded-xl border border-dashed p-6 text-center space-y-2">
          <BookOpen className="size-8 mx-auto text-muted-foreground/60" />
          <p className="text-xs font-medium text-muted-foreground">
            {searchQuery
              ? '검색 결과와 일치하는 지식이 없어요.'
              : '아직 등록된 지식이 없어요. 왼쪽 대화창에서 소희에게 매장 정보를 알려주세요!'}
          </p>
        </Card>
      ) : (
        <div className="space-y-2.5 max-h-[500px] overflow-y-auto pr-1">
          {filteredList.map((item) => (
            <Card
              key={item.id}
              className="rounded-xl border border-border p-3.5 space-y-2.5 hover:border-purple-300 dark:hover:border-purple-800 transition-all bg-card/60"
            >
              <div className="flex items-start justify-between gap-2">
                <span className="text-[13px] font-medium text-foreground leading-relaxed">
                  {item.content}
                </span>
                <Badge variant="outline" className="text-xs shrink-0 font-normal">
                  {formatCategoryLabel(item.category)}
                </Badge>
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-border/50 text-xs text-muted-foreground gap-2">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="inline-flex items-center gap-1 font-semibold">
                    <CheckCircle2 className="size-3.5" aria-hidden="true" />
                    {containsFactPlaceholder(item.content) || !item.source || item.source.kind === 'unknown' || !item.approvedAt ? '확인 필요' : '확정됨'}
                  </span>
                  <span>·</span>
                  <span>출처: {formatSourceLabel(item.source?.kind)}</span>
                </div>

                <div className="flex items-center shrink-0">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => onSelectKnowledgeForCorrection?.(item)}
                    className="min-h-[44px] text-[13px] px-3 text-purple-600 dark:text-purple-400 hover:bg-purple-50 dark:hover:bg-purple-950 font-medium"
                  >
                    <Edit3 className="size-3.5 mr-1" />
                    대화로 수정
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
