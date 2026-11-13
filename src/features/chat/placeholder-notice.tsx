import { AlertCircle } from 'lucide-react'
import {
  hasInformationRequestPlaceholder,
  isInformationRequestPlaceholder,
} from '@/features/content/placeholder-detect'

export interface PlaceholderNoticeProps {
  placeholders: readonly string[]
  className?: string
}

/**
 * 생성된 초안의 채워지지 않은 빈칸(슬롯)이나 어시스턴트의 정보 요청을 안내하는 미니멀 알림 컴포넌트입니다.
 * semantic token(border-border, bg-muted/60)을 사용하여 과도한 경고색 없이 정보 전달에 집중합니다.
 */
export function PlaceholderNotice({ placeholders, className }: PlaceholderNoticeProps) {
  if (!placeholders || placeholders.length === 0) return null

  const hasInfoRequest = hasInformationRequestPlaceholder(placeholders)
  const slotPlaceholders = placeholders.filter((p) => !isInformationRequestPlaceholder(p))

  return (
    <div
      aria-label="빈칸 확인 안내"
      className={`rounded-xl border border-border bg-muted/60 p-3.5 text-foreground ${className ?? ''}`.trim()}
      role="status"
    >
      <div className="flex items-start gap-2.5">
        <AlertCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div className="space-y-2 text-sm leading-relaxed">
          {hasInfoRequest ? (
            <>
              <p className="font-semibold text-foreground">
                고객에게 보여줄 글이 아니라 소희의 정보 요청이에요.
              </p>
              <p className="text-xs text-muted-foreground">
                이벤트 정보를 알려주고 다시 만들어 주세요.
              </p>
            </>
          ) : (
            <p className="font-semibold text-foreground">
              채워야 할 곳이 {placeholders.length}개 있어요
            </p>
          )}

          {slotPlaceholders.length > 0 ? (
            <div aria-label="채워야 할 빈칸 목록" className="flex flex-wrap gap-1.5">
              {slotPlaceholders.map((placeholder) => (
                <span
                  className="inline-flex items-center rounded-md border border-border bg-background/80 px-2 py-0.5 text-xs font-medium text-foreground"
                  key={placeholder}
                >
                  {placeholder}
                </span>
              ))}
            </div>
          ) : null}

          {!hasInfoRequest ? (
            <p className="text-xs text-muted-foreground">
              문구 다듬기로 내용을 알려 주시면 채워 드려요.
            </p>
          ) : null}
        </div>
      </div>
    </div>
  )
}
