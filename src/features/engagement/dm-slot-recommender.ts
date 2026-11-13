export interface SlotRecommendationParams {
  messageText: string
  existingBookingTimes?: string[] // e.g. ["2026-10-18 14:00", "2026-10-18 16:00"]
  baseDate?: Date
  openHour?: number // default 10
  closeHour?: number // default 20
  slotIntervalHours?: number // default 2
}

export interface RecommendedSlot {
  timeStr: string // e.g. "10:00", "14:00"
  fullDateTimeStr: string // e.g. "2026-10-18 14:00"
  label: string // e.g. "오후 2시"
}

export interface SlotRecommendationResult {
  hasBookingIntent: boolean
  targetDateStr: string
  dayLabel: string
  availableSlots: RecommendedSlot[]
  suggestedReplyText: string
}

const DEFAULT_SLOT_HOURS = [10, 12, 14, 16, 18]

export function extractTargetDateFromMessage(text: string, now: Date = new Date()): { date: Date; dayLabel: string } {
  const lower = text.toLowerCase()

  if (lower.includes('오늘')) {
    return { date: new Date(now), dayLabel: '오늘' }
  }
  if (lower.includes('내일')) {
    const d = new Date(now)
    d.setDate(d.getDate() + 1)
    return { date: d, dayLabel: '내일' }
  }
  if (lower.includes('모레')) {
    const d = new Date(now)
    d.setDate(d.getDate() + 2)
    return { date: d, dayLabel: '모레' }
  }

  // Day of week detection (e.g. "토요일", "일요일", "화요일")
  const dayNames = ['일', '월', '화', '수', '목', '금', '토']
  for (let i = 0; i < 7; i++) {
    const dayName = dayNames[i]
    if (text.includes(`${dayName}요일`) || text.includes(`${dayName}욜`)) {
      const currentDay = now.getDay()
      let diff = i - currentDay
      if (diff <= 0) diff += 7 // next upcoming day of week
      const d = new Date(now)
      d.setDate(d.getDate() + diff)
      return { date: d, dayLabel: `${dayName}요일` }
    }
  }

  // Default: tomorrow
  const d = new Date(now)
  d.setDate(d.getDate() + 1)
  return { date: d, dayLabel: '내일' }
}

export function formatHourToKorean(hour: number): string {
  if (hour === 12) return '오후 12시'
  if (hour > 12) return `오후 ${hour - 12}시`
  return `오전 ${hour}시`
}

export function recommendBookingSlots(params: SlotRecommendationParams): SlotRecommendationResult {
  const { messageText, existingBookingTimes = [], baseDate = new Date() } = params

  const bookingKeywords = ['예약', '시간', '언제', '비어', '가능', '되나요', '방문', '상담', '비나요']
  const hasBookingIntent = bookingKeywords.some((kw) => messageText.includes(kw))

  const { date: targetDate, dayLabel } = extractTargetDateFromMessage(messageText, baseDate)
  const yyyy = targetDate.getFullYear()
  const mm = String(targetDate.getMonth() + 1).padStart(2, '0')
  const dd = String(targetDate.getDate()).padStart(2, '0')
  const targetDateStr = `${yyyy}-${mm}-${dd}`

  // Find booked hours on that date
  const bookedHours = new Set<number>()
  for (const timeStr of existingBookingTimes) {
    if (timeStr.includes(targetDateStr)) {
      const match = timeStr.match(/(\d{2}):\d{2}/)
      if (match) {
        bookedHours.add(parseInt(match[1], 10))
      }
    }
  }

  // Available slots
  const availableSlots: RecommendedSlot[] = []
  for (const hour of DEFAULT_SLOT_HOURS) {
    if (!bookedHours.has(hour)) {
      const hourStr = String(hour).padStart(2, '0')
      availableSlots.push({
        timeStr: `${hourStr}:00`,
        fullDateTimeStr: `${targetDateStr} ${hourStr}:00`,
        label: formatHourToKorean(hour),
      })
    }
  }

  const slotLabels = availableSlots.slice(0, 3).map((s) => s.label).join(', ')

  let suggestedReplyText = ''
  if (availableSlots.length > 0) {
    suggestedReplyText = `안녕하세요! 문의주신 ${dayLabel}에는 ${slotLabels} 슬롯 예약이 가능하세요 😊 어떤 시간으로 안내해 드릴까요?`
  } else {
    suggestedReplyText = `안녕하세요! 문의주신 ${dayLabel}은 모든 예약이 마감되었습니다. 다음 날짜로 예약을 도와드릴까요?`
  }

  return {
    hasBookingIntent,
    targetDateStr,
    dayLabel,
    availableSlots,
    suggestedReplyText,
  }
}
