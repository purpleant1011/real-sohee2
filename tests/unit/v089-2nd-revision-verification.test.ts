import { describe, it, expect, vi } from 'vitest';
import {
  validateBusinessNumberChecksum,
  normalizeBusinessNumber,
  queryNtsBusinessValidation
} from '@/lib/auth/business-verification';

describe('V0.8.9 2차 수정 검증 테스트 (ANI-553 ~ ANI-571)', () => {
  describe('ANI-555: 사업자 진위확인 및 Mismatch 검증', () => {
    it('사업자번호 체크섬이 올바르게 계산되어야 한다', () => {
      // 120-81-47521는 유효한 사업자번호
      expect(validateBusinessNumberChecksum('1208147521')).toBe(true);
      expect(validateBusinessNumberChecksum('120-81-47521')).toBe(true);
      
      // 잘못된 번호는 거부되어야 한다
      expect(validateBusinessNumberChecksum('1234567890')).toBe(false);
      expect(validateBusinessNumberChecksum('0000000000')).toBe(false);
    });

    it('API 키 미설정 시에도 임의 승인하지 않고 PENDING_REVIEW로 안전하게 degrade해야 한다', async () => {
      const originalKey = process.env.NTS_API_KEY;
      delete process.env.NTS_API_KEY;
      delete process.env.DATA_GO_KR_API_KEY;

      const res = await queryNtsBusinessValidation({
        b_no: '1208147521',
        p_nm: '홍길동',
        b_nm: '소희테스트'
      });

      expect(res.success).toBe(true);
      expect(res.status).toBe('PENDING_REVIEW');

      if (originalKey) process.env.NTS_API_KEY = originalKey;
    });
  });

  describe('ANI-554 & ANI-557: Formal Signup State Machine & Versioned Agreements', () => {
    it('개별 약관이 모두 동의되지 않으면 에러를 발생시켜야 한다', async () => {
      const { submitSignupAgreements } = await import('@/features/auth/signup-state-machine');
      const mockSupabase = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: { id: 'app-1', user_id: 'user-1', state: 'BUSINESS_PENDING' }
          }),
          insert: vi.fn().mockReturnThis(),
          upsert: vi.fn().mockResolvedValue({ error: null }),
          update: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({
            data: { id: 'app-1', user_id: 'user-1', state: 'TRIAL_READY' },
            error: null
          })
        })
      };

      await expect(
        submitSignupAgreements(mockSupabase as any, 'user-1', {
          termsOfService: true,
          privacyPolicy: true,
          aiDataProcessing: true,
          channelDelegation: false // 미동의
        })
      ).rejects.toThrow('모든 필수 약관');
    });
  });

  describe('ANI-568 & ANI-569: Agent Golden Eval & Privacy Lifecycle', () => {
    it('7대 골든 픽스처의 Deterministic Blocker 룰이 정확히 작동해야 한다', async () => {
      const { QUALITY_SEVEN_FIXTURES } = await import('@/features/harness/quality-test-harness');
      expect(QUALITY_SEVEN_FIXTURES.length).toBe(7);

      const leakageFixture = QUALITY_SEVEN_FIXTURES.find(f => f.fixtureType === 'source-leakage');
      expect(leakageFixture).toBeDefined();
      expect(leakageFixture?.expectedVerdict).toBe('BLOCK');

      const goodFixture = QUALITY_SEVEN_FIXTURES.find(f => f.fixtureType === 'known-good');
      expect(goodFixture).toBeDefined();
      expect(goodFixture?.expectedVerdict).toBe('PASS');
    });

    it('개인정보 삭제 요청 확인 코드가 올바르게 생성되고 해시되어야 한다', async () => {
      const { hashDataDeletionConfirmationCode } = await import('@/features/data-deletion/repository');
      const testCode = 'del-req-abc123xyz456_testcode';
      const hash = hashDataDeletionConfirmationCode(testCode);
      expect(hash).toBeDefined();
      expect(hash.length).toBe(64); // SHA-256
    });
  });
});
