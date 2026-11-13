import { describe, expect, it } from 'vitest'
import {
  TEACH_TOPICS,
  buildTeachTopicPrompt,
  getNextTeachTopic,
  nextTeachPrompt,
  topicProgress,
} from './teach-model'

describe('teach-model', () => {
  describe('TEACH_TOPICS', () => {
    it('정확히 7개의 주제를 올바른 순서와 라벨로 정의한다', () => {
      expect(TEACH_TOPICS).toHaveLength(7)
      expect(TEACH_TOPICS.map((t) => t.label)).toEqual([
        '가게 소개',
        '대표 메뉴/서비스',
        '가격',
        '영업시간·위치',
        '차별점',
        '자주 받는 질문',
        '말투·금지어',
      ])
    })

    it('기존 질문 ID가 있는 항목은 해당 ID를 재사용하고 모든 항목이 친근한 질문을 갖는다', () => {
      const idMap = Object.fromEntries(TEACH_TOPICS.map((t) => [t.label, t.id]))
      expect(idMap['대표 메뉴/서비스']).toBe('q_menu')
      expect(idMap['가격']).toBe('q_price')
      expect(idMap['영업시간·위치']).toBe('q_hours')
      expect(idMap['차별점']).toBe('q_differentiator')
      expect(idMap['자주 받는 질문']).toMatch(/^q_faq/)
      expect(idMap['말투·금지어']).toBe('q_prohibited')
      expect(idMap['가게 소개']).toBeTruthy()

      for (const topic of TEACH_TOPICS) {
        expect(topic.id.length).toBeGreaterThan(0)
        expect(topic.question.length).toBeGreaterThan(5)
      }
    })
  })

  describe('topicProgress', () => {
    it('가르친 주제가 없을 때 0/7을 반환한다', () => {
      expect(topicProgress()).toEqual({ done: 0, total: 7 })
      expect(topicProgress([])).toEqual({ done: 0, total: 7 })
      expect(topicProgress(new Set())).toEqual({ done: 0, total: 7 })
    })

    it('가르친 주제 개수를 올바르게 계산한다 (3/7)', () => {
      const covered = ['q_intro', 'q_menu', 'q_price']
      expect(topicProgress(covered)).toEqual({ done: 3, total: 7 })
    })

    it('중복 ID 및 알 수 없는 ID는 안전하게 처리한다', () => {
      const covered = ['q_menu', 'q_menu', 'unknown_id']
      expect(topicProgress(covered)).toEqual({ done: 1, total: 7 })
    })

    it('모든 주제를 완료하면 7/7을 반환한다', () => {
      const allIds = TEACH_TOPICS.map((t) => t.id)
      expect(topicProgress(allIds)).toEqual({ done: 7, total: 7 })
    })
  })

  describe('nextTeachPrompt & getNextTeachTopic', () => {
    it('아무것도 가르치지 않았을 때 첫 번째 주제(가게 소개)에 대한 프롬프트를 생성한다', () => {
      const topic = getNextTeachTopic([])
      expect(topic?.label).toBe('가게 소개')

      const prompt = nextTeachPrompt([])
      expect(prompt).toBeTruthy()
      expect(prompt).toContain('가게 소개')
      // 한 번에 하나씩 질문
      expect(prompt).toContain('한 번에 하나씩')
      // 사장님 승인 전까지 저장 안 됨
      expect(prompt).toMatch(/승인.*저장|저장.*승인/)
      // 저장 전 사실 확인
      expect(prompt).toContain('확인')
    })

    it('첫 번째 주제를 완료했을 때 두 번째 주제(대표 메뉴/서비스)에 대한 프롬프트를 반환한다', () => {
      const firstId = TEACH_TOPICS[0].id
      const topic = getNextTeachTopic([firstId])
      expect(topic?.label).toBe('대표 메뉴/서비스')

      const prompt = nextTeachPrompt([firstId])
      expect(prompt).toContain('대표 메뉴/서비스')
      expect(prompt).toContain('한 번에 하나씩')
    })

    it('모든 주제가 완료되면 null을 반환한다', () => {
      const allIds = TEACH_TOPICS.map((t) => t.id)
      expect(getNextTeachTopic(allIds)).toBeNull()
      expect(nextTeachPrompt(allIds)).toBeNull()
    })

    it('buildTeachTopicPrompt로 개별 주제 프롬프트를 생성할 수 있다', () => {
      const prompt = buildTeachTopicPrompt(TEACH_TOPICS[1])
      expect(prompt).toContain('대표 메뉴/서비스')
      expect(prompt).toContain('한 번에 하나씩')
      expect(prompt).toContain('승인')
    })
  })
})
