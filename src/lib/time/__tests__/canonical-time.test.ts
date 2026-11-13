import { describe, it, expect } from 'vitest'
import {
  formatCanonicalDateTime,
  formatRelativeTimeKorean,
  evaluateFreshness,
  sanitizeRealtimeLabel,
} from '../canonical-time'

describe('Canonical Time & Freshness SSOT (ANI-848)', () => {
  it('formats timestamp in Asia/Seoul timezone', () => {
    // 2026-09-06T06:30:00.000Z is 15:30:00 KST (UTC+9)
    const iso = '2026-09-06T06:30:00.000Z'
    const formatted = formatCanonicalDateTime(iso)

    expect(formatted).toContain('2026')
    expect(formatted).toContain('09')
    expect(formatted).toContain('06')
    expect(formatted).toContain('15:30')
  })

  it('formats relative time in Korean correctly', () => {
    const base = new Date('2026-09-06T12:00:00.000Z')

    // 20 seconds ago -> 방금 전
    const t1 = new Date('2026-09-06T11:59:40.000Z')
    expect(formatRelativeTimeKorean(t1, base)).toBe('방금 전')

    // 5 minutes ago -> 5분 전
    const t2 = new Date('2026-09-06T11:55:00.000Z')
    expect(formatRelativeTimeKorean(t2, base)).toBe('5분 전')

    // 3 hours ago -> 3시간 전
    const t3 = new Date('2026-09-06T09:00:00.000Z')
    expect(formatRelativeTimeKorean(t3, base)).toBe('3시간 전')

    // 24 hours ago -> 어제
    const t4 = new Date('2026-09-05T12:00:00.000Z')
    expect(formatRelativeTimeKorean(t4, base)).toBe('어제')
  })

  it('evaluates freshness and detects stale operational data (>15m)', () => {
    const base = new Date('2026-09-06T12:00:00.000Z')

    // 3 minutes old -> FRESH
    const freshIso = new Date('2026-09-06T11:57:00.000Z').toISOString()
    const freshEval = evaluateFreshness(freshIso, 15, base)
    expect(freshEval.freshnessGrade).toBe('FRESH')
    expect(freshEval.isStale).toBe(false)
    expect(freshEval.displayLabel).toBe('실시간 정상')

    // 10 minutes old -> WARM
    const warmIso = new Date('2026-09-06T11:50:00.000Z').toISOString()
    const warmEval = evaluateFreshness(warmIso, 15, base)
    expect(warmEval.freshnessGrade).toBe('WARM')
    expect(warmEval.isStale).toBe(false)
    expect(warmEval.displayLabel).toContain('10분 전 동기화')

    // 25 minutes old -> STALE
    const staleIso = new Date('2026-09-06T11:35:00.000Z').toISOString()
    const staleEval = evaluateFreshness(staleIso, 15, base)
    expect(staleEval.freshnessGrade).toBe('STALE')
    expect(staleEval.isStale).toBe(true)
    expect(staleEval.displayLabel).toContain('25분 전 데이터 (동기화 대기)')
  })

  it('prevents false claims of "실시간" when data is stale', () => {
    const base = new Date('2026-09-06T12:00:00.000Z')
    const staleIso = new Date('2026-09-06T11:20:00.000Z').toISOString() // 40m old

    const result = sanitizeRealtimeLabel('실시간 클라우드 동기화 정상', staleIso, 15, base)
    expect(result).not.toContain('실시간 클라우드 동기화 정상')
    expect(result).toContain('40분 전 기준 (동기화 지연 감지)')

    const freshIso = new Date('2026-09-06T11:58:00.000Z').toISOString() // 2m old
    const freshResult = sanitizeRealtimeLabel('실시간 클라우드 동기화 정상', freshIso, 15, base)
    expect(freshResult).toBe('실시간 클라우드 동기화 정상')
  })
})
