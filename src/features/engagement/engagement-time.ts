export function formatRelativeTime(dateString: string, now = new Date()): string {
  const date = new Date(dateString)
  const diffMs = now.getTime() - date.getTime()
  if (Number.isNaN(diffMs)) return '방금 전'

  const diffSec = Math.floor(diffMs / 1000)
  if (diffSec < 60) return '방금 전'

  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `${diffMin}분 전`

  const diffHour = Math.floor(diffMin / 60)
  if (diffHour < 24) return `${diffHour}시간 전`

  const diffDay = Math.floor(diffHour / 24)
  if (diffDay < 30) return `${diffDay}일 전`

  const diffMonth = Math.floor(diffDay / 30)
  if (diffMonth < 12) return `${diffMonth}달 전`

  const diffYear = Math.floor(diffDay / 365)
  return `${diffYear}년 전`
}
