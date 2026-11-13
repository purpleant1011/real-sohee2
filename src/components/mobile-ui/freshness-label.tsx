import { cn } from '@/lib/utils'
import { formatCheckedMoment } from './freshness'

/**
 * "16:40 확인" / prefix 가 있으면 "서버 확인 · 16:40" — 모든 데이터 영역 아래에 붙이는 소희의 서명 같은 한 줄.
 * prefix 가 이미 "확인"을 말하므로 시점만 붙인다(같은 단어를 두 번 쓰지 않는다). 시각이 없으면 렌더하지 않는다.
 */
export function FreshnessLabel({ checkedAt, className, prefix }: Readonly<{ checkedAt?: string | null; className?: string; prefix?: string }>) {
  const moment = formatCheckedMoment(checkedAt)
  if (!moment || !checkedAt) return null
  return (
    <time dateTime={checkedAt} className={cn('text-[13px] leading-5 text-muted-foreground', className)}>
      {prefix ? `${prefix} · ${moment}` : `${moment} 확인`}
    </time>
  )
}
