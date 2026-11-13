import { describe, expect, it } from 'vitest';
import { generateChannelVariants } from '../generator';
import type { TextGenerator } from '../ports/text-generator';

describe('ANI-1538: User-facing Copy Tests (No English Error/Status Codes)', () => {
  const englishCodePatterns = [
    /\bFAIL\b/,
    /\bPASS\b/,
    /\bWARN\b/,
    /\bUNKNOWN\b/,
    /\bNOT_VERIFIED\b/,
    /\bERR_\w+/,
    /\bHTTP\s*\d{3}\b/i,
    /\bNULL\b/i,
    /\bUNDEFINED\b/i,
  ];

  it('ensures userStatusLabel and summaryLabel contain no raw English status codes', async () => {
    // 1. 성공 케이스
    const passGen: TextGenerator = {
      async generateText() {
        return JSON.stringify({
          instagram: {
            caption: '인스타그램 캡션 본문입니다.',
            hashtags: ['#카페'],
          },
        });
      },
    };

    const passResult = await generateChannelVariants({
      topic: '정상 게시물',
      baseDraft: '정상 초안',
      channels: ['instagram'],
      generator: passGen,
      media: [{ type: 'image', format: 'jpeg' }],
    });

    const igPass = passResult.variants.instagram!;
    expect(igPass.userStatusLabel).toBe('규격 적합');
    expect(passResult.summary.summaryLabel).toContain('적합');

    for (const pattern of englishCodePatterns) {
      expect(igPass.userStatusLabel).not.toMatch(pattern);
      expect(passResult.summary.summaryLabel).not.toMatch(pattern);
    }

    // 2. 실패 케이스
    const failGen: TextGenerator = {
      async generateText() {
        return JSON.stringify({
          instagram: {
            caption: '가'.repeat(2500), // 2,200자 초과
            hashtags: ['#카페'],
          },
        });
      },
    };

    const failResult = await generateChannelVariants({
      topic: '초과 게시물',
      baseDraft: '초과 초안',
      channels: ['instagram'],
      generator: failGen,
      media: [{ type: 'image', format: 'jpeg' }],
      maxRetries: 0,
    });

    const igFail = failResult.variants.instagram!;
    expect(igFail.userStatusLabel).toBe('수정 필요');
    expect(failResult.summary.summaryLabel).toContain('확인 필요');

    for (const pattern of englishCodePatterns) {
      expect(igFail.userStatusLabel).not.toMatch(pattern);
      expect(failResult.summary.summaryLabel).not.toMatch(pattern);
    }
  });

  it('ensures all check userMessages in evaluation are clear Korean sentences', async () => {
    const fakeGen: TextGenerator = {
      async generateText() {
        return JSON.stringify({
          instagram: {
            caption: '정상 캡션입니다.',
            hashtags: ['#소희'],
          },
        });
      },
    };

    const result = await generateChannelVariants({
      topic: '검증',
      baseDraft: '초안',
      channels: ['instagram'],
      generator: fakeGen,
    });

    const checks = result.variants.instagram!.evaluation.checks;
    expect(checks.length).toBeGreaterThan(0);

    for (const check of checks) {
      expect(check.userMessage).toBeTruthy();
      // userMessage에 원시 영문 에러 코드가 없어야 함
      for (const pattern of englishCodePatterns) {
        expect(check.userMessage).not.toMatch(pattern);
      }
    }
  });
});
