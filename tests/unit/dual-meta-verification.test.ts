import { describe, it, expect } from 'vitest'
import {
  verifyInstagramEvidence,
  verifyThreadsEvidence,
  evaluateDualChannelReadiness,
  type InstagramVerificationEvidence,
  type ThreadsVerificationEvidence,
} from '@/features/channels/dual-channel-verification'

describe('M1: Dual Meta Verification (HF-08, HF-09, HF-10)', () => {
  const validFutureDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
  const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

  describe('HF-08: Instagram Provider Verification Evidence (Connected ≠ VERIFIED)', () => {
    it('rejects verification when capability test evidence is missing (Connected but Unverified)', () => {
      const incompleteEvidence: InstagramVerificationEvidence = {
        accountId: 'ig-acc-001',
        username: 'sohee_store',
        accountType: 'BUSINESS',
        tokenExpiresAt: validFutureDate,
        scopes: ['instagram_basic', 'instagram_content_publish', 'pages_show_list'],
        capabilityReceipt: null, // Missing capability proof
      }

      const result = verifyInstagramEvidence(incompleteEvidence)
      expect(result.status).toBe('CONNECTED_UNVERIFIED')
      expect(result.verified).toBe(false)
      expect(result.blockerMessage).toContain('게시 권한 및 프로필 실측 검증 영수증이 없습니다')
    })

    it('rejects verification when required scopes are incomplete', () => {
      const missingScopeEvidence: InstagramVerificationEvidence = {
        accountId: 'ig-acc-001',
        username: 'sohee_store',
        accountType: 'BUSINESS',
        tokenExpiresAt: validFutureDate,
        scopes: ['instagram_basic'], // Missing instagram_content_publish
        capabilityReceipt: {
          profileReadSuccess: true,
          publishQuotaVerified: true,
          probedAt: new Date().toISOString(),
        },
      }

      const result = verifyInstagramEvidence(missingScopeEvidence)
      expect(result.status).toBe('SCOPE_INSUFFICIENT')
      expect(result.verified).toBe(false)
      expect(result.blockerMessage).toContain('instagram_content_publish')
      expect(result.blockerMessage).toContain('누락되었습니다')
    })

    it('detects degraded state when token has expired', () => {
      const expiredEvidence: InstagramVerificationEvidence = {
        accountId: 'ig-acc-001',
        username: 'sohee_store',
        accountType: 'BUSINESS',
        tokenExpiresAt: pastDate, // Expired
        scopes: ['instagram_basic', 'instagram_content_publish', 'pages_show_list'],
        capabilityReceipt: {
          profileReadSuccess: true,
          publishQuotaVerified: true,
          probedAt: pastDate,
        },
      }

      const result = verifyInstagramEvidence(expiredEvidence)
      expect(result.status).toBe('READY_DEGRADED')
      expect(result.verified).toBe(false)
      expect(result.blockerMessage).toContain('토큰 유효기간이 만료되었습니다')
    })

    it('marks as VERIFIED when all valid evidence, scopes, and capability receipt exist', () => {
      const validEvidence: InstagramVerificationEvidence = {
        accountId: 'ig-acc-001',
        username: 'sohee_store',
        accountType: 'BUSINESS',
        tokenExpiresAt: validFutureDate,
        scopes: ['instagram_basic', 'instagram_content_publish', 'pages_show_list'],
        capabilityReceipt: {
          profileReadSuccess: true,
          publishQuotaVerified: true,
          probedAt: new Date().toISOString(),
        },
      }

      const result = verifyInstagramEvidence(validEvidence)
      expect(result.status).toBe('VERIFIED')
      expect(result.verified).toBe(true)
      expect(result.blockerMessage).toBeUndefined()
    })
  })

  describe('HF-09: Threads Provider Verification Evidence', () => {
    it('rejects verification when capability test evidence is missing', () => {
      const incompleteThreads: ThreadsVerificationEvidence = {
        threadsUserId: 'th-user-001',
        threadsUsername: 'sohee_threads',
        tokenExpiresAt: validFutureDate,
        scopes: ['threads_basic', 'threads_content_publish'],
        capabilityReceipt: null,
      }

      const result = verifyThreadsEvidence(incompleteThreads)
      expect(result.status).toBe('CONNECTED_UNVERIFIED')
      expect(result.verified).toBe(false)
    })

    it('marks as VERIFIED when scopes and capability receipt exist', () => {
      const validThreads: ThreadsVerificationEvidence = {
        threadsUserId: 'th-user-001',
        threadsUsername: 'sohee_threads',
        tokenExpiresAt: validFutureDate,
        scopes: ['threads_basic', 'threads_content_publish'],
        capabilityReceipt: {
          profileReadSuccess: true,
          publishQuotaVerified: true,
          probedAt: new Date().toISOString(),
        },
      }

      const result = verifyThreadsEvidence(validThreads)
      expect(result.status).toBe('VERIFIED')
      expect(result.verified).toBe(true)
    })
  })

  describe('HF-10: Dual-Channel Onboarding Gate (Both Required)', () => {
    it('returns overallChannelReady=false when only Instagram is verified', () => {
      const result = evaluateDualChannelReadiness({
        instagram: {
          status: 'VERIFIED',
          verified: true,
        },
        threads: {
          status: 'NOT_CONNECTED',
          verified: false,
          blockerMessage: '스레드 계정이 연동되지 않았습니다.',
        },
      })

      expect(result.dualVerified).toBe(false)
      expect(result.instagramVerified).toBe(true)
      expect(result.threadsVerified).toBe(false)
      expect(result.blockers.length).toBe(1)
      expect(result.blockers[0]).toContain('스레드')
    })

    it('returns overallChannelReady=false when only Threads is verified', () => {
      const result = evaluateDualChannelReadiness({
        instagram: {
          status: 'NOT_CONNECTED',
          verified: false,
          blockerMessage: '인스타그램 계정이 연동되지 않았습니다.',
        },
        threads: {
          status: 'VERIFIED',
          verified: true,
        },
      })

      expect(result.dualVerified).toBe(false)
      expect(result.instagramVerified).toBe(false)
      expect(result.threadsVerified).toBe(true)
      expect(result.blockers.length).toBe(1)
      expect(result.blockers[0]).toContain('인스타그램')
    })

    it('returns overallChannelReady=true ONLY when BOTH Instagram and Threads are verified', () => {
      const result = evaluateDualChannelReadiness({
        instagram: {
          status: 'VERIFIED',
          verified: true,
        },
        threads: {
          status: 'VERIFIED',
          verified: true,
        },
      })

      expect(result.dualVerified).toBe(true)
      expect(result.instagramVerified).toBe(true)
      expect(result.threadsVerified).toBe(true)
      expect(result.blockers.length).toBe(0)
    })
  })
})
