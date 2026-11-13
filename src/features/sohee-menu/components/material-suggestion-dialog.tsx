import React, { useState } from 'react'
import { Check, Sparkles } from 'lucide-react'
import { Dialog } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type { ExtractedSuggestion } from '@/features/sohee-materials/types'

interface MaterialSuggestionDialogProps {
  isOpen: boolean
  onClose: () => void
  workspaceId: string
  materialId: string
  materialName: string
  suggestions: ExtractedSuggestion[]
  onPromoted: () => void
}

const CATEGORY_LABELS: Record<string, { label: string; variant: 'purple' | 'success' | 'warning' | 'info' | 'secondary' }> = {
  MENU: { label: '메뉴', variant: 'purple' },
  PRICE: { label: '가격', variant: 'purple' },
  HOURS: { label: '영업시간', variant: 'info' },
  DIFFERENTIATOR: { label: '매장 비법', variant: 'success' },
  FAQ: { label: '자주 묻는 질문', variant: 'warning' },
  PROHIBITED: { label: '주의할 점', variant: 'secondary' },
}

export function MaterialSuggestionDialog({
  isOpen,
  onClose,
  workspaceId,
  materialId,
  materialName,
  suggestions,
  onPromoted,
}: MaterialSuggestionDialogProps) {
  const [selectedIds, setSelectedIds] = useState<string[]>(() =>
    suggestions.map((s) => s.id),
  )
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const handleToggle = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id],
    )
  }

  const handleSelectAll = () => {
    if (selectedIds.length === suggestions.length) {
      setSelectedIds([])
    } else {
      setSelectedIds(suggestions.map((s) => s.id))
    }
  }

  const handlePromote = async () => {
    if (selectedIds.length === 0) return

    setIsSubmitting(true)
    setErrorMessage(null)

    const selectedSuggestions = suggestions
      .filter((s) => selectedIds.includes(s.id))
      .map((s) => ({
        category: s.category,
        content: s.content,
      }))

    try {
      const res = await fetch(
        `/api/workspaces/${workspaceId}/knowledge/materials/${materialId}/promote`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            materialName,
            suggestions: selectedSuggestions,
          }),
        },
      )

      const json = await res.json().catch(() => ({}))

      if (!res.ok || !json.success) {
        setErrorMessage(json.message || '지식 반영 중 오류가 발생했습니다.')
        return
      }

      onPromoted()
      onClose()
    } catch {
      setErrorMessage('지식 반영 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()} title="소희가 발견한 매장 지식">
      <div className="space-y-4 pt-2">
        <p className="text-xs text-muted-foreground leading-relaxed">
          <span className="font-semibold text-foreground">{materialName}</span> 자료에서 소희가 찾아낸 정보예요. 확인하시고 지식 도서관에 등록할 항목을 골라주세요!
        </p>

        {errorMessage && (
          <div
            role="alert"
            className="text-xs font-semibold text-destructive bg-destructive/10 p-3 rounded-xl"
          >
            {errorMessage}
          </div>
        )}

        <div className="flex items-center justify-between text-xs py-1 border-b border-border">
          <span className="font-medium text-muted-foreground">
            {`발견된 지식 ${suggestions.length}개 중 ${selectedIds.length}개 선택됨`}
          </span>
          <button
            type="button"
            onClick={handleSelectAll}
            className="text-primary font-bold hover:underline cursor-pointer"
          >
            {selectedIds.length === suggestions.length ? '전체 해제' : '전체 선택'}
          </button>
        </div>

        <div className="space-y-2.5 max-h-[320px] overflow-y-auto pr-1 py-1">
          {suggestions.map((suggestion) => {
            const isSelected = selectedIds.includes(suggestion.id)
            const catCfg = CATEGORY_LABELS[suggestion.category] || {
              label: suggestion.category,
              variant: 'secondary' as const,
            }

            return (
              <div
                key={suggestion.id}
                onClick={() => handleToggle(suggestion.id)}
                className={cn(
                  'p-3.5 rounded-2xl border transition-all cursor-pointer flex items-start gap-3 select-none',
                  isSelected
                    ? 'border-primary/40 bg-primary/10'
                    : 'border-border bg-card hover:bg-muted/40',
                )}
              >
                <div
                  className={cn(
                    'size-5 rounded-lg border mt-0.5 flex items-center justify-center shrink-0 transition-colors',
                    isSelected
                      ? 'bg-primary border-primary text-primary-foreground'
                      : 'border-muted-foreground/30 bg-background',
                  )}
                  aria-hidden
                >
                  {isSelected && <Check className="size-3.5 stroke-[3]" />}
                </div>

                <div className="space-y-1.5 flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <Badge variant={catCfg.variant} className="text-[10px] font-bold py-0 h-4.5">
                      {catCfg.label}
                    </Badge>
                  </div>
                  <p className="text-xs text-foreground font-medium leading-relaxed whitespace-pre-line">
                    {suggestion.content}
                  </p>
                </div>
              </div>
            )
          })}
        </div>

        <div className="pt-2 flex flex-row items-center justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={isSubmitting}
            onClick={onClose}
            className="rounded-xl h-10 px-4 text-xs font-semibold"
          >
            닫기
          </Button>
          <Button
            type="button"
            disabled={isSubmitting || selectedIds.length === 0}
            onClick={handlePromote}
            className="rounded-xl h-10 px-5 text-xs font-bold gap-1.5"
          >
            {isSubmitting ? '반영하는 중...' : `${selectedIds.length}개 지식 도서관에 반영하기`}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
