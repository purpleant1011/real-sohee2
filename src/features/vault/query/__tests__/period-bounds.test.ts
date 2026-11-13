import { describe, expect, it } from 'vitest'
import { periodBounds } from '../period-bounds'

describe('periodBounds 순수 함수 (KST 기준 주·월 경계 테스트)', () => {
  // 2026-10-07(수) 13:00:00 KST = 2026-10-07T04:00:00.000Z
  const wednesdayKst = new Date('2026-10-07T04:00:00.000Z')

  describe('this_week (이번 주)', () => {
    it('수요일 기준 이번 주는 월요일(10-05)부터 일요일(10-11)까지', () => {
      const bounds = periodBounds('this_week', wednesdayKst)
      expect(bounds.start).toBe('2026-10-05')
      expect(bounds.end).toBe('2026-10-11')
      expect(bounds.isUnscheduled).toBe(false)
      expect(bounds.isAll).toBe(false)
    })

    it('KST 일요일 23:59:59 (경계 직전) 시점은 해당 주(10-05 ~ 10-11)에 포함된다', () => {
      // 2026-10-11 23:59:59 KST = 2026-10-11T14:59:59.000Z
      const sundayNight = new Date('2026-10-11T14:59:59.000Z')
      const bounds = periodBounds('this_week', sundayNight)
      expect(bounds.start).toBe('2026-10-05')
      expect(bounds.end).toBe('2026-10-11')
    })

    it('KST 월요일 00:00:00 (경계 직후) 시점은 새로운 주(10-12 ~ 10-18)로 전환된다', () => {
      // 2026-10-12 00:00:00 KST = 2026-10-11T15:00:00.000Z
      const mondayMidnight = new Date('2026-10-11T15:00:00.000Z')
      const bounds = periodBounds('this_week', mondayMidnight)
      expect(bounds.start).toBe('2026-10-12')
      expect(bounds.end).toBe('2026-10-18')
    })
  })

  describe('next_week (다음 주)', () => {
    it('수요일 기준 다음 주는 다음 주 월요일(10-12)부터 일요일(10-18)까지', () => {
      const bounds = periodBounds('next_week', wednesdayKst)
      expect(bounds.start).toBe('2026-10-12')
      expect(bounds.end).toBe('2026-10-18')
    })

    it('일요일 밤 23:59:59 KST 기준 다음 주는 10-12부터 10-18까지', () => {
      const sundayNight = new Date('2026-10-11T14:59:59.000Z')
      const bounds = periodBounds('next_week', sundayNight)
      expect(bounds.start).toBe('2026-10-12')
      expect(bounds.end).toBe('2026-10-18')
    })
  })

  describe('month (월)', () => {
    it('ym 미지정 시 now의 KST 월(2026-10) 전체(10-01 ~ 10-31)를 반환한다', () => {
      const bounds = periodBounds('month', wednesdayKst)
      expect(bounds.start).toBe('2026-10-01')
      expect(bounds.end).toBe('2026-10-31')
    })

    it('ym 지정 시(예: 2026-02) 해당 월의 1일부터 마지막 날(28일)까지 반환한다', () => {
      const bounds = periodBounds('month', wednesdayKst, '2026-02')
      expect(bounds.start).toBe('2026-02-01')
      expect(bounds.end).toBe('2026-02-28')
    })

    it('윤년 2월(예: 2028-02)의 경우 29일까지 올바르게 계산한다', () => {
      const bounds = periodBounds('month', wednesdayKst, '2028-02')
      expect(bounds.start).toBe('2028-02-01')
      expect(bounds.end).toBe('2028-02-29')
    })

    it('월 경계 테스트: 10월 31일 23:59:59 KST = 10월, 11월 1일 00:00:00 KST = 11월', () => {
      // 2026-10-31 23:59:59 KST = 2026-10-31T14:59:59.000Z
      const octEnd = new Date('2026-10-31T14:59:59.000Z')
      expect(periodBounds('month', octEnd).start).toBe('2026-10-01')
      expect(periodBounds('month', octEnd).end).toBe('2026-10-31')

      // 2026-11-01 00:00:00 KST = 2026-10-31T15:00:00.000Z
      const novStart = new Date('2026-10-31T15:00:00.000Z')
      expect(periodBounds('month', novStart).start).toBe('2026-11-01')
      expect(periodBounds('month', novStart).end).toBe('2026-11-30')
    })
  })

  describe('unscheduled (일정 미정)', () => {
    it('start와 end가 null이고 isUnscheduled가 true이다', () => {
      const bounds = periodBounds('unscheduled', wednesdayKst)
      expect(bounds.start).toBeNull()
      expect(bounds.end).toBeNull()
      expect(bounds.isUnscheduled).toBe(true)
      expect(bounds.isAll).toBe(false)
    })
  })

  describe('all (전체)', () => {
    it('start와 end가 null이고 isAll이 true이다', () => {
      const bounds = periodBounds('all', wednesdayKst)
      expect(bounds.start).toBeNull()
      expect(bounds.end).toBeNull()
      expect(bounds.isUnscheduled).toBe(false)
      expect(bounds.isAll).toBe(true)
    })
  })
})
