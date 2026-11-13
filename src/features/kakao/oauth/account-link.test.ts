import { describe, expect, it } from 'vitest'
import { verifyKakaoAccountLinking } from './account-link'

describe('Kakao Account Linking Protection', () => {
  it('기존 사용자가 다른 프로바이더(예: google)로 등록되어 있으면 자동 병합을 금지하고 거부한다', () => {
    const result = verifyKakaoAccountLinking({
      email: 'owner@example.com',
      existingUser: {
        id: 'user-google-1',
        email: 'owner@example.com',
        primaryProvider: 'google',
        memberships: [{ workspaceId: 'ws-google-1', role: 'owner' }],
        ledgers: [{ kind: 'TRIAL_GRANT' }],
      },
    })

    expect(result.canProceed).toBe(false)
    expect(result.reason).toBe('account_linking_prohibited')
    expect(result.isExistingUser).toBe(true)
  })

  it('기존 사용자가 카카오 프로바이더로 이미 등록되어 있으면 기존 워크스페이스로 정상 재사용한다', () => {
    const result = verifyKakaoAccountLinking({
      email: 'owner@kakao.com',
      existingUser: {
        id: 'user-kakao-1',
        email: 'owner@kakao.com',
        primaryProvider: 'kakao',
        memberships: [{ workspaceId: 'ws-kakao-1', role: 'owner' }],
        ledgers: [{ kind: 'TRIAL_GRANT' }],
      },
    })

    expect(result.canProceed).toBe(true)
    expect(result.isExistingUser).toBe(true)
    expect(result.workspaceId).toBe('ws-kakao-1')
    expect(result.grantTrial).toBe(false)
  })

  it('기존 계정이 없는 신규 카카오 가입자는 14일 체험 혜택과 함께 진행을 허용한다', () => {
    const result = verifyKakaoAccountLinking({
      email: 'newbie@kakao.com',
      existingUser: null,
    })

    expect(result.canProceed).toBe(true)
    expect(result.isExistingUser).toBe(false)
    expect(result.grantTrial).toBe(true)
  })

  it('이메일 정보가 없는 카카오 프로필도 신규 사용자로 안전하게 처리한다', () => {
    const result = verifyKakaoAccountLinking({
      email: undefined,
      existingUser: null,
    })

    expect(result.canProceed).toBe(true)
    expect(result.isExistingUser).toBe(false)
    expect(result.grantTrial).toBe(true)
  })
})
