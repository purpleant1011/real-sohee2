import { describe, it, expect } from 'vitest'
import {
  normalizeChannelInput,
  detectPasswordLikeInput,
  type NormalizationSuccess,
  type NormalizationFailure,
} from '@/features/channels/channel-handle-normalizer'

describe('ANI-1453: Conversation-led Meta Connection with Handle Intent & Provider Truth', () => {
  it('rejects password-like input in handle field with security flag', () => {
    const passwordInputs = [
      'MySecretP@ssw0rd!',
      'password123',
      'P@ssw0rd2026',
      'secret_token_123',
    ]

    for (const pw of passwordInputs) {
      const pwCheck = detectPasswordLikeInput(pw)
      expect(pwCheck.isPasswordLike).toBe(true)

      const res = normalizeChannelInput('instagram', pw) as NormalizationFailure
      expect(res.isValid).toBe(false)
      expect(res.errorCode).toBe('PASSWORD_LIKE_INPUT')
      expect(res.errorMessage).toContain('비밀번호')
    }
  })

  it('treats handle input strictly as intent preview, never elevating to VERIFIED status', () => {
    const res = normalizeChannelInput('instagram', '@sohee.ai') as NormalizationSuccess
    expect(res.isValid).toBe(true)
    expect(res.handle).toBe('sohee.ai')
    expect(res.canonicalUrl).toBe('https://www.instagram.com/sohee.ai/')
    // Handle normalization itself MUST NOT provide verification tokens or status
    expect((res as any).verified).toBeUndefined()
    expect((res as any).status).toBeUndefined()
  })

  it('normalizes Threads profile URLs and strips query params/hashes safely', () => {
    const res = normalizeChannelInput('threads', 'https://www.threads.com/@sohee.ai?utm_source=ig_profile#feed') as NormalizationSuccess
    expect(res.isValid).toBe(true)
    expect(res.handle).toBe('sohee.ai')
    expect(res.canonicalUrl).toBe('https://www.threads.com/@sohee.ai')
  })

  it('detects cross-provider mismatch and returns owner-friendly recovery instruction', () => {
    // Attempting to pass an Instagram URL into Threads input
    const res = normalizeChannelInput('threads', 'https://www.instagram.com/sohee.ai') as NormalizationFailure
    expect(res.isValid).toBe(false)
    expect(res.errorCode).toBe('WRONG_PROVIDER')
    expect(res.errorMessage).toContain('인스타그램')
    expect(res.recoveryHint).toBeDefined()
  })

  it('ensures Instagram and Threads maintain independent truth without cross-contamination', () => {
    const igResult = normalizeChannelInput('instagram', '@beauty_byreum') as NormalizationSuccess
    const thResult = normalizeChannelInput('threads', '@threads_byreum') as NormalizationSuccess

    expect(igResult.handle).toBe('beauty_byreum')
    expect(thResult.handle).toBe('threads_byreum')
    expect(igResult.channel).toBe('instagram')
    expect(thResult.channel).toBe('threads')
  })
})
