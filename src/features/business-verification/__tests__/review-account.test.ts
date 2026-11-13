import { describe, expect, it } from 'vitest'
import { isReviewAccountUser } from '../review-account'

describe('isReviewAccountUser', () => {
  const fakeUserId1 = '11111111-2222-3333-4444-555555555555'
  const fakeUserId2 = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'

  it('REVIEW_ACCOUNT_USER_IDS에 포함된 userId면 true 반환', () => {
    const env = { REVIEW_ACCOUNT_USER_IDS: fakeUserId1 }
    expect(isReviewAccountUser(fakeUserId1, env)).toBe(true)
  })

  it('대소문자를 무시하고 비교', () => {
    const env = { REVIEW_ACCOUNT_USER_IDS: fakeUserId1.toUpperCase() }
    expect(isReviewAccountUser(fakeUserId1.toLowerCase(), env)).toBe(true)

    const envLower = { REVIEW_ACCOUNT_USER_IDS: fakeUserId2.toLowerCase() }
    expect(isReviewAccountUser(fakeUserId2.toUpperCase(), envLower)).toBe(true)
  })

  it('공백이 포함된 쉼표 구분 목록을 정상 trim하여 비교', () => {
    const env = {
      REVIEW_ACCOUNT_USER_IDS: `  ${fakeUserId1}  ,  ${fakeUserId2}  `,
    }
    expect(isReviewAccountUser(fakeUserId1, env)).toBe(true)
    expect(isReviewAccountUser(fakeUserId2, env)).toBe(true)
  })

  it('환경 변수가 미설정이거나 빈 문자열이면 false (fail-closed)', () => {
    expect(isReviewAccountUser(fakeUserId1, {})).toBe(false)
    expect(isReviewAccountUser(fakeUserId1, { REVIEW_ACCOUNT_USER_IDS: '' })).toBe(false)
    expect(isReviewAccountUser(fakeUserId1, { REVIEW_ACCOUNT_USER_IDS: '   ' })).toBe(false)
    expect(isReviewAccountUser(fakeUserId1, { REVIEW_ACCOUNT_USER_IDS: undefined })).toBe(false)
  })

  it('userId가 빈 문자열이거나 공백이면 false', () => {
    const env = { REVIEW_ACCOUNT_USER_IDS: fakeUserId1 }
    expect(isReviewAccountUser('', env)).toBe(false)
    expect(isReviewAccountUser('   ', env)).toBe(false)
    expect(isReviewAccountUser(null as unknown as string, env)).toBe(false)
    expect(isReviewAccountUser(undefined as unknown as string, env)).toBe(false)
  })

  it('목록에 없는 userId는 false', () => {
    const env = { REVIEW_ACCOUNT_USER_IDS: fakeUserId1 }
    expect(isReviewAccountUser(fakeUserId2, env)).toBe(false)
  })

  it('부분 일치는 false (정확한 전체 일치만 허용)', () => {
    const env = { REVIEW_ACCOUNT_USER_IDS: fakeUserId1 }
    expect(isReviewAccountUser(fakeUserId1.slice(0, 10), env)).toBe(false)
    expect(isReviewAccountUser(`${fakeUserId1}-extra`, env)).toBe(false)
  })
})
