import { describe, it, expect } from 'vitest'
import {
  normalizeChannelInput,
  detectPasswordLikeInput,
  getOAuthExplainabilityDetails,
} from '@/features/channels/channel-handle-normalizer'

describe('ANI-1428: SNS Handle / Profile URL Entry & Normalization Truth', () => {
  describe('1. Instagram Handle and URL Normalization', () => {
    it('normalizes @handle with leading @ to canonical handle and URL', () => {
      const result = normalizeChannelInput('instagram', '@sohee.ai')
      expect(result.isValid).toBe(true)
      if (result.isValid) {
        expect(result.channel).toBe('instagram')
        expect(result.handle).toBe('sohee.ai')
        expect(result.displayHandle).toBe('@sohee.ai')
        expect(result.canonicalUrl).toBe('https://www.instagram.com/sohee.ai/')
      }
    })

    it('normalizes bare handle without @ to canonical handle and URL', () => {
      const result = normalizeChannelInput('instagram', 'sohee.ai')
      expect(result.isValid).toBe(true)
      if (result.isValid) {
        expect(result.handle).toBe('sohee.ai')
        expect(result.displayHandle).toBe('@sohee.ai')
        expect(result.canonicalUrl).toBe('https://www.instagram.com/sohee.ai/')
      }
    })

    it('normalizes instagram.com domain URL without protocol', () => {
      const result = normalizeChannelInput('instagram', 'instagram.com/sohee.ai')
      expect(result.isValid).toBe(true)
      if (result.isValid) {
        expect(result.handle).toBe('sohee.ai')
        expect(result.canonicalUrl).toBe('https://www.instagram.com/sohee.ai/')
      }
    })

    it('normalizes full HTTPS URL with trailing slash, whitespace, and uppercase', () => {
      const result = normalizeChannelInput('instagram', '  https://www.instagram.com/SoHee.Ai/  ')
      expect(result.isValid).toBe(true)
      if (result.isValid) {
        expect(result.handle).toBe('sohee.ai')
        expect(result.canonicalUrl).toBe('https://www.instagram.com/sohee.ai/')
      }
    })

    it('strips query parameters and hashes from instagram profile URL', () => {
      const result = normalizeChannelInput(
        'instagram',
        'https://www.instagram.com/sohee.ai?igsh=MXFjM3h2Z2V5&utm_source=qr#top'
      )
      expect(result.isValid).toBe(true)
      if (result.isValid) {
        expect(result.handle).toBe('sohee.ai')
        expect(result.canonicalUrl).toBe('https://www.instagram.com/sohee.ai/')
      }
    })
  })

  describe('2. Threads Handle and URL Normalization', () => {
    it('normalizes @handle with leading @ to canonical Threads handle and URL', () => {
      const result = normalizeChannelInput('threads', '@sohee.ai')
      expect(result.isValid).toBe(true)
      if (result.isValid) {
        expect(result.channel).toBe('threads')
        expect(result.handle).toBe('sohee.ai')
        expect(result.displayHandle).toBe('@sohee.ai')
        expect(result.canonicalUrl).toBe('https://www.threads.com/@sohee.ai')
      }
    })

    it('normalizes bare handle without @ to canonical Threads handle and URL', () => {
      const result = normalizeChannelInput('threads', 'sohee.ai')
      expect(result.isValid).toBe(true)
      if (result.isValid) {
        expect(result.handle).toBe('sohee.ai')
        expect(result.canonicalUrl).toBe('https://www.threads.com/@sohee.ai')
      }
    })

    it('normalizes threads.com/@handle and threads.net/@handle formats', () => {
      const r1 = normalizeChannelInput('threads', 'threads.com/@sohee.ai')
      expect(r1.isValid).toBe(true)
      if (r1.isValid) {
        expect(r1.handle).toBe('sohee.ai')
        expect(r1.canonicalUrl).toBe('https://www.threads.com/@sohee.ai')
      }

      const r2 = normalizeChannelInput('threads', 'https://www.threads.net/@sohee.ai?hl=ko')
      expect(r2.isValid).toBe(true)
      if (r2.isValid) {
        expect(r2.handle).toBe('sohee.ai')
        expect(r2.canonicalUrl).toBe('https://www.threads.com/@sohee.ai')
      }
    })

    it('normalizes threads.com/handle without @ in URL path', () => {
      const result = normalizeChannelInput('threads', 'https://threads.com/sohee.ai/')
      expect(result.isValid).toBe(true)
      if (result.isValid) {
        expect(result.handle).toBe('sohee.ai')
        expect(result.canonicalUrl).toBe('https://www.threads.com/@sohee.ai')
      }
    })
  })

  describe('3. Wrong Provider and Unsupported Domain Detection (Fail-Closed)', () => {
    it('rejects Threads URL entered in Instagram field with specific recovery hint', () => {
      const result = normalizeChannelInput('instagram', 'https://www.threads.com/@sohee.ai')
      expect(result.isValid).toBe(false)
      if (!result.isValid) {
        expect(result.errorCode).toBe('WRONG_PROVIDER')
        expect(result.errorMessage).toContain('스레드')
        expect(result.recoveryHint).toContain('인스타그램')
      }
    })

    it('rejects Instagram URL entered in Threads field with specific recovery hint', () => {
      const result = normalizeChannelInput('threads', 'https://www.instagram.com/sohee.ai')
      expect(result.isValid).toBe(false)
      if (!result.isValid) {
        expect(result.errorCode).toBe('WRONG_PROVIDER')
        expect(result.errorMessage).toContain('인스타그램')
        expect(result.recoveryHint).toContain('스레드')
      }
    })

    it('rejects third-party SNS and arbitrary domains (X, YouTube, TikTok, Naver)', () => {
      const targets = [
        'https://x.com/sohee_ai',
        'https://twitter.com/sohee_ai',
        'https://youtube.com/@sohee',
        'https://tiktok.com/@sohee.ai',
        'https://blog.naver.com/sohee_ai',
      ]
      for (const target of targets) {
        const result = normalizeChannelInput('instagram', target)
        expect(result.isValid).toBe(false)
        if (!result.isValid) {
          expect(result.errorCode).toBe('UNSUPPORTED_DOMAIN')
          expect(result.recoveryHint).toBeDefined()
        }
      }
    })
  })

  describe('4. Invalid Characters and Boundary Input Validation', () => {
    it('rejects empty or whitespace-only inputs', () => {
      const result = normalizeChannelInput('instagram', '   ')
      expect(result.isValid).toBe(false)
      if (!result.isValid) {
        expect(result.errorCode).toBe('EMPTY_INPUT')
      }
    })

    it('rejects Korean characters in handle', () => {
      const result = normalizeChannelInput('instagram', '@소희.ai')
      expect(result.isValid).toBe(false)
      if (!result.isValid) {
        expect(result.errorCode).toBe('INVALID_HANDLE_FORMAT')
        expect(result.errorMessage).toContain('영문')
      }
    })

    it('rejects forbidden special characters or spaces within handle', () => {
      const invalidHandles = ['sohee ai', 'sohee!ai', 'sohee#ai', 'sohee$ai', 'sohee/ai']
      for (const invalid of invalidHandles) {
        const result = normalizeChannelInput('threads', invalid)
        expect(result.isValid).toBe(false)
        if (!result.isValid) {
          expect(result.errorCode).toBe('INVALID_HANDLE_FORMAT')
        }
      }
    })

    it('rejects mobile app schemes (instagram://, threads://) with explicit recovery guidance', () => {
      const appSchemes = ['instagram://user?username=sohee.ai', 'threads://user/sohee.ai']
      for (const scheme of appSchemes) {
        const result = normalizeChannelInput('instagram', scheme)
        expect(result.isValid).toBe(false)
        if (!result.isValid) {
          expect(result.errorCode).toBe('INVALID_HANDLE_FORMAT')
          expect(result.errorMessage).toContain('앱 전용 링크')
          expect(result.recoveryHint).toContain('웹 프로필 주소')
        }
      }
    })
  })

  describe('5. Zero-Password Invariant (Password-like Input Detection)', () => {
    it('detects and blocks password-like inputs to ensure zero password entry', () => {
      const passwordInputs = [
        'password123!',
        'P@ssw0rd2026',
        'mySecretKey#99',
        'sohee!2026pass$',
      ]
      for (const pwd of passwordInputs) {
        const detection = detectPasswordLikeInput(pwd)
        expect(detection.isPasswordLike).toBe(true)
        expect(detection.warningMessage).toContain('비밀번호')
      }
    })

    it('does not flag normal handles as password-like', () => {
      const normalHandles = ['sohee.ai', 'byreum_official', 'gangnam_beauty', 'sohee_101']
      for (const h of normalHandles) {
        const detection = detectPasswordLikeInput(h)
        expect(detection.isPasswordLike).toBe(false)
      }
    })
  })

  describe('6. Human-Language OAuth Explainability Contract', () => {
    it('provides clear Korean explainability and security promises for Instagram', () => {
      const details = getOAuthExplainabilityDetails('instagram')
      expect(details.channel).toBe('instagram')
      expect(details.channelDisplayName).toBe('인스타그램 비즈니스')
      expect(details.reasons.length).toBeGreaterThanOrEqual(3)
      expect(details.securityGuarantees.length).toBeGreaterThanOrEqual(3)
      expect(details.securityGuarantees.some((g: string) => g.includes('비밀번호'))).toBe(true)
      expect(details.securityGuarantees.some((g: string) => g.includes('OAuth') || g.includes('인증'))).toBe(true)
    })

    it('provides clear Korean explainability and security promises for Threads', () => {
      const details = getOAuthExplainabilityDetails('threads')
      expect(details.channel).toBe('threads')
      expect(details.channelDisplayName).toBe('스레드 (Threads)')
      expect(details.reasons.length).toBeGreaterThanOrEqual(3)
      expect(details.securityGuarantees.length).toBeGreaterThanOrEqual(3)
      expect(details.securityGuarantees.some((g: string) => g.includes('비밀번호'))).toBe(true)
    })
  })
})
