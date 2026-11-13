import { describe, expect, it } from 'vitest'
import { createOutboxAllowlist } from './allowlist'

describe('createOutboxAllowlist', () => {
  describe('미설정 (하위호환: 모든 번호 허용)', () => {
    it.each([
      { desc: 'undefined', input: undefined },
      { desc: 'null', input: null as unknown as string },
      { desc: '빈 문자열', input: '' },
      { desc: '공백만 있는 문자열', input: '   ' },
    ])('$desc 인 경우 enabled=false 이며 모든 번호를 허용한다', ({ input }) => {
      const allowlist = createOutboxAllowlist(input)

      expect(allowlist.enabled).toBe(false)
      expect(allowlist.isAllowed('01012345678')).toBe(true)
      expect(allowlist.isAllowed('01099998888')).toBe(true)
      expect(allowlist.isAllowed('010-1234-5678')).toBe(true)
    })
  })

  describe('정상 설정 (허용된 010 번호 매칭)', () => {
    it('쉼표 구분 정규화 010 번호 목록에 대해 허용 및 비허용을 정확히 판정한다', () => {
      const allowlist = createOutboxAllowlist('01012345678, 01098765432')

      expect(allowlist.enabled).toBe(true)
      expect(allowlist.isAllowed('01012345678')).toBe(true)
      expect(allowlist.isAllowed('01098765432')).toBe(true)
      // 하이픈 포맷도 정규화되어 매칭
      expect(allowlist.isAllowed('010-1234-5678')).toBe(true)
      expect(allowlist.isAllowed('010-9876-5432')).toBe(true)
      // 목록에 없는 번호는 차단
      expect(allowlist.isAllowed('01011112222')).toBe(false)
      expect(allowlist.isAllowed('010-0000-0000')).toBe(false)
    })

    it('입력값의 하이픈, 공백, +82 10 포맷을 올바르게 정규화하여 등록한다', () => {
      const allowlist = createOutboxAllowlist('010-1234-5678, +82 10 9876 5432')

      expect(allowlist.enabled).toBe(true)
      expect(allowlist.isAllowed('01012345678')).toBe(true)
      expect(allowlist.isAllowed('01098765432')).toBe(true)
      expect(allowlist.isAllowed('01055556666')).toBe(false)
    })
  })

  describe('잘못된 형식 무시 & fail-closed (전원 차단)', () => {
    it('잘못된 형식 항목은 무시하고 유효한 010 항목만 등록한다', () => {
      const allowlist = createOutboxAllowlist('01012345678, invalid, 02-123-4567, , 010-9999-8888')

      expect(allowlist.enabled).toBe(true)
      expect(allowlist.isAllowed('01012345678')).toBe(true)
      expect(allowlist.isAllowed('01099998888')).toBe(true)
      expect(allowlist.isAllowed('021234567')).toBe(false)
      expect(allowlist.isAllowed('invalid')).toBe(false)
      expect(allowlist.isAllowed('01011112222')).toBe(false)
    })

    it('변수가 설정되었으나 유효한 010 번호가 하나도 없으면 전원 차단(fail-closed)한다', () => {
      const allowlist = createOutboxAllowlist('invalid, not-a-number, 0212345678, 0111234567')

      expect(allowlist.enabled).toBe(true)
      // 아무도 통과 불가
      expect(allowlist.isAllowed('01012345678')).toBe(false)
      expect(allowlist.isAllowed('01099998888')).toBe(false)
      expect(allowlist.isAllowed('')).toBe(false)
    })
  })

  describe('보안: 전화번호 값(PII) 절대 노출 금지', () => {
    it('JSON 직렬화 시 전화번호 목록이 노출되지 않는다', () => {
      const secretPhone = '01012345678'
      const allowlist = createOutboxAllowlist(secretPhone)

      const serialized = JSON.stringify(allowlist)
      expect(serialized).not.toContain(secretPhone)
      expect(serialized).not.toContain('12345678')
    })

    it('toString 호출 시 전화번호 목록이 노출되지 않는다', () => {
      const secretPhone = '01012345678'
      const allowlist = createOutboxAllowlist(secretPhone)

      const stringified = allowlist.toString()
      expect(stringified).not.toContain(secretPhone)
      expect(stringified).not.toContain('12345678')
    })

    it('Object.keys 및 속성 순회 시 전화번호가 노출되지 않는다', () => {
      const secretPhone = '01012345678'
      const allowlist = createOutboxAllowlist(secretPhone)

      const keys = Object.keys(allowlist)
      expect(keys).not.toContain(secretPhone)
      for (const key of keys) {
        expect(String((allowlist as unknown as Record<string, unknown>)[key])).not.toContain(secretPhone)
      }
    })
  })
})
