import { describe, expect, it } from 'vitest'
import { failureCodeSchema } from '@/features/local-publishing/contracts'
import {
  DEFAULT_FAILURE_MESSAGE,
  getNaverFailureCopy,
  type NaverFailureAction,
} from './naver-failure-copy'

describe('getNaverFailureCopy', () => {
  const cases: Array<{
    code: string
    expectedMessage: string
    expectedAction: NaverFailureAction
  }> = [
    {
      code: 'IMAGES_INCOMPLETE',
      expectedMessage: '이미지를 모두 생성하지 못했습니다. 잠시 후 다시 시도해 주세요.',
      expectedAction: 'retry',
    },
    {
      code: 'CREDIT_INSUFFICIENT',
      expectedMessage: '크레딧이 부족해서 글을 만들 수 없어요. 크레딧을 충전한 뒤 다시 시도해 주세요.',
      expectedAction: 'charge',
    },
    {
      code: 'VALIDATION_FAILED',
      expectedMessage: '주제와 요청 정보를 확인해 주세요.',
      expectedAction: 'none',
    },
    {
      code: 'AUTH_REQUIRED',
      expectedMessage: '로그인이 필요해요.',
      expectedAction: 'reauth',
    },
    {
      code: 'WORKSPACE_FORBIDDEN',
      expectedMessage: '이 매장에 접근할 수 없어요.',
      expectedAction: 'none',
    },
    {
      code: 'SERVICE_UNAVAILABLE',
      expectedMessage: '네이버 블로그 글을 생성하지 못했어요. 잠시 후 다시 시도해 주세요.',
      expectedAction: 'retry',
    },
    {
      code: 'REAUTH_REQUIRED',
      expectedMessage: '네이버 로그인이 필요해요. 크롬에서 네이버에 로그인한 뒤 다시 시도해 주세요.',
      expectedAction: 'reauth',
    },
    {
      code: 'CATEGORY_NOT_FOUND',
      expectedMessage: '선택한 카테고리를 네이버에서 찾지 못했어요. 카테고리 목록을 새로 가져와 주세요.',
      expectedAction: 'retry',
    },
    {
      code: 'CATEGORY_INVALID',
      expectedMessage: '선택한 카테고리를 찾을 수 없어요. 카테고리 목록을 새로 불러와 주세요.',
      expectedAction: 'none',
    },
    {
      code: 'DEVICE_OFFLINE',
      expectedMessage: '소희 연결 브라우저가 꺼져 있어요. 브라우저를 켠 뒤 다시 시도해 주세요.',
      expectedAction: 'none',
    },
    {
      code: 'UNKNOWN_RESULT',
      expectedMessage: '게시 결과를 확인하지 못했어요. 중복 게시를 막기 위해 자동으로 다시 올리지 않아요. 네이버에서 직접 확인해 주세요.',
      expectedAction: 'none',
    },
    {
      code: 'UI_DRIFT',
      expectedMessage: '올리지 못했어요. 잠시 후 다시 시도해 주세요.',
      expectedAction: 'retry',
    },
    {
      code: 'CONTENT_MISMATCH',
      expectedMessage: '올리지 못했어요. 잠시 후 다시 시도해 주세요.',
      expectedAction: 'retry',
    },
    {
      code: 'TARGET_MISMATCH',
      expectedMessage: '올리지 못했어요. 잠시 후 다시 시도해 주세요.',
      expectedAction: 'retry',
    },
    {
      code: 'MEDIA_UPLOAD_FAILED',
      expectedMessage: '올리지 못했어요. 잠시 후 다시 시도해 주세요.',
      expectedAction: 'retry',
    },
    {
      code: 'MEDIA_DOWNLOAD_FAILED',
      expectedMessage: '올리지 못했어요. 잠시 후 다시 시도해 주세요.',
      expectedAction: 'retry',
    },
    {
      code: 'DEADLINE_EXPIRED',
      expectedMessage: '올리지 못했어요. 잠시 후 다시 시도해 주세요.',
      expectedAction: 'retry',
    },
    {
      code: 'IN_PROGRESS',
      expectedMessage: '이미 글을 만들고 있어요. 잠시만 기다려 주세요.',
      expectedAction: 'none',
    },
    {
      code: 'CLAIMS_NEED_REVIEW',
      expectedMessage: '확인이 필요한 표현이 남아 한 번 더 다듬어야 해요. 같은 주제로 다시 만들어 볼까요?',
      expectedAction: 'retry_new',
    },
    {
      code: 'DRAFT_FAILED',
      expectedMessage: '초안 글을 작성하지 못했습니다. 잠시 후 다시 시도해 주세요.',
      expectedAction: 'retry_new',
    },
    {
      code: 'DRAFT_RECOVERY_PENDING',
      expectedMessage: '네이버 글쓰기 화면에 작성 중인 글이 있어요. 그 글을 저장하거나 지운 뒤 다시 시도해 주세요.',
      expectedAction: 'none',
    },
    {
      code: 'POLICY_RESTRICTION',
      expectedMessage: '올리지 못했어요. 잠시 후 다시 시도해 주세요.',
      expectedAction: 'none',
    },
  ]

  it.each(cases)('maps $code to expected message and action', ({ code, expectedMessage, expectedAction }) => {
    const result = getNaverFailureCopy(code)
    expect(result.message).toBe(expectedMessage)
    expect(result.action).toBe(expectedAction)
  })

  it('maps lowercase codes consistently', () => {
    const result = getNaverFailureCopy('reauth_required')
    expect(result.message).toBe('네이버 로그인이 필요해요. 크롬에서 네이버에 로그인한 뒤 다시 시도해 주세요.')
    expect(result.action).toBe('reauth')
  })

  it('never offers automatic retry for UNKNOWN_RESULT or any readback-unknown state', () => {
    expect(getNaverFailureCopy('UNKNOWN_RESULT').action).toBe('none')
    expect(getNaverFailureCopy('unknown_result').action).toBe('none')
    expect(getNaverFailureCopy('READBACK_UNKNOWN').action).toBe('none')
    expect(getNaverFailureCopy('UNKNOWN').action).toBe('none')
    expect(getNaverFailureCopy('unknown_after_submit').action).toBe('none')
  })

  it('uses default copy for unrecognized code without custom message', () => {
    const result = getNaverFailureCopy('SOME_RANDOM_ERROR')
    expect(result.message).toBe('올리지 못했어요. 잠시 후 다시 시도해 주세요.')
    expect(result.action).toBe('retry')
  })

  it('preserves valid Korean custom message when provided', () => {
    const withCustom = getNaverFailureCopy('CREDIT_INSUFFICIENT', '서버에서 전달된 충전 안내 문구')
    expect(withCustom.message).toBe('서버에서 전달된 충전 안내 문구')
    expect(withCustom.action).toBe('charge')
  })

  it('rejects English-only or code-token custom message and falls back to canonical copy', () => {
    const englishOnly = getNaverFailureCopy('CREDIT_INSUFFICIENT', 'Insufficient credits to continue')
    expect(englishOnly.message).toBe('크레딧이 부족해서 글을 만들 수 없어요. 크레딧을 충전한 뒤 다시 시도해 주세요.')

    const codeToken = getNaverFailureCopy('SERVICE_UNAVAILABLE', '오류 발생: SERVER_INTERNAL_ERROR')
    expect(codeToken.message).toBe('네이버 블로그 글을 생성하지 못했어요. 잠시 후 다시 시도해 주세요.')
  })

  it('returns a non-default message for every Naver-relevant code in failureCodeSchema', () => {
    const naverRelevantCodes = [
      'REAUTH_REQUIRED',
      'CATEGORY_NOT_FOUND',
      'DRAFT_RECOVERY_PENDING',
      'DEVICE_OFFLINE',
      'UNKNOWN_RESULT',
    ] as const

    for (const code of naverRelevantCodes) {
      expect(failureCodeSchema.options).toContain(code)
      const copy = getNaverFailureCopy(code)
      expect(copy.message).not.toBe(DEFAULT_FAILURE_MESSAGE)
      expect(copy.message.length).toBeGreaterThan(0)
    }
  })
})
