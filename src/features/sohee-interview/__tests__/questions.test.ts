import { describe, expect, it } from 'vitest'
import {
  INTERVIEW_QUESTIONS,
  getNextInterviewQuestion,
  summarizeAnswer,
} from '../questions'

describe('INTERVIEW_QUESTIONS', () => {
  it('8개의 표준 질문이 순서대로 정의되어 있다', () => {
    expect(INTERVIEW_QUESTIONS).toHaveLength(8)
    expect(INTERVIEW_QUESTIONS.map((q) => q.category)).toEqual([
      'MENU',
      'PRICE',
      'HOURS',
      'DIFFERENTIATOR',
      'FAQ',
      'FAQ',
      'FAQ',
      'PROHIBITED',
    ])
  })

  it('모든 질문에 고유 ID, 프롬프트, 칩 옵션이 존재한다', () => {
    const ids = new Set<string>()
    for (const q of INTERVIEW_QUESTIONS) {
      expect(q.id).toBeDefined()
      expect(ids.has(q.id)).toBe(false)
      ids.add(q.id)
      expect(q.prompt).toContain('?')
      expect(Array.isArray(q.chips)).toBe(true)
      expect(q.chips.length).toBeGreaterThan(0)
    }
  })

  it('8개 질문의 ID가 올바르게 지정되어 있다', () => {
    expect(INTERVIEW_QUESTIONS.map((q) => q.id)).toEqual([
      'q_menu',
      'q_price',
      'q_hours',
      'q_differentiator',
      'q_faq_booking',
      'q_faq_parking',
      'q_faq_tip',
      'q_prohibited',
    ])
  })
})

describe('getNextInterviewQuestion', () => {
  it('답변한 질문 ID 목록을 제외하고 다음 질문을 반환한다', () => {
    const next1 = getNextInterviewQuestion([])
    expect(next1?.id).toBe('q_menu')

    const next2 = getNextInterviewQuestion(['q_menu'])
    expect(next2?.id).toBe('q_price')

    const nextAll = getNextInterviewQuestion(INTERVIEW_QUESTIONS.map((q) => q.id))
    expect(nextAll).toBeNull()
  })
})

describe('summarizeAnswer', () => {
  it('답변을 정중한 요약 문구로 반환한다', () => {
    const qMenu = INTERVIEW_QUESTIONS.find((q) => q.id === 'q_menu')!
    const summaryMenu = summarizeAnswer(qMenu, '수제 크루아상과 아메리카노')
    expect(summaryMenu).toContain('대표 메뉴는 [수제 크루아상과 아메리카노]')

    const qPrice = INTERVIEW_QUESTIONS.find((q) => q.id === 'q_price')!
    const summaryPrice = summarizeAnswer(qPrice, '1~3만원대')
    expect(summaryPrice).toContain('가격대는 [1~3만원대]')

    const qHours = INTERVIEW_QUESTIONS.find((q) => q.id === 'q_hours')!
    const summaryHours = summarizeAnswer(qHours, '매주 월요일 휴무, 10시~21시')
    expect(summaryHours).toContain('영업시간 및 휴무일은 [매주 월요일 휴무, 10시~21시]')
  })
})
