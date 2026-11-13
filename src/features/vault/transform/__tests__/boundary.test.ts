import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { countThreadsLength } from '../../channel-spec/character-counter';
import { generateChannelVariants } from '../generator';
import type { TextGenerator } from '../ports/text-generator';

describe('ANI-1538: Boundary and Invariant Tests', () => {
  // 1. 네트워크 호출 완전 차단(Air-gapped) 상태에서 테스트 통과 검증
  describe('Air-gapped network prohibition invariant', () => {
    beforeEach(() => {
      vi.stubGlobal('fetch', () => {
        throw new Error('AIR_GAP_VIOLATION: generateChannelVariants must not make network calls when fake generator is injected');
      });
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('runs purely offline with injected generator without triggering fetch', async () => {
      const fakeGen: TextGenerator = {
        async generateText() {
          return JSON.stringify({
            threads: { text: '오프라인 환경에서도 안전하게 변환됩니다.' },
          });
        },
      };

      const result = await generateChannelVariants({
        topic: '오프라인 검증',
        baseDraft: '네트워크 차단 테스트',
        channels: ['threads'],
        generator: fakeGen,
      });

      expect(result.variants.threads?.status).toBe('PASS');
    });
  });

  // 2. Import 경계 정적 분석 검증
  describe('Import boundary static analysis', () => {
    const rootSrc = path.resolve(__dirname, '../../../..');

    it('ensures src/features/vault/service/** does not import src/features/vault/transform/**', () => {
      const serviceDir = path.join(rootSrc, 'src/features/vault/service');
      if (fs.existsSync(serviceDir)) {
        const checkDir = (dir: string) => {
          const files = fs.readdirSync(dir);
          for (const file of files) {
            const fullPath = path.join(dir, file);
            if (fs.statSync(fullPath).isDirectory()) {
              checkDir(fullPath);
            } else if (file.endsWith('.ts') && !file.endsWith('.test.ts')) {
              const content = fs.readFileSync(fullPath, 'utf-8');
              expect(content).not.toMatch(/from\s+['"].*\/transform(\/.*)?['"]/);
            }
          }
        };
        checkDir(serviceDir);
      }
    });

    it('ensures transform core modules (excluding adapters) do not import provider clients or @/lib/ai/**', () => {
      const transformDir = path.resolve(__dirname, '..');
      const files = fs
        .readdirSync(transformDir)
        .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));

      const forbiddenInCore = [
        /from\s+['"].*@\/lib\/ai.*['"]/,
        /from\s+['"].*google\/generative-ai.*['"]/,
        /from\s+['"].*openai.*['"]/,
        /from\s+['"]axios['"]/,
        /from\s+['"]node-fetch['"]/,
      ];

      for (const file of files) {
        const content = fs.readFileSync(path.join(transformDir, file), 'utf-8');
        for (const pattern of forbiddenInCore) {
          expect(content).not.toMatch(pattern);
        }
      }
    });
  });

  // 3. 한글 및 이모지 경계값 정밀 테스트 (Threads 500자, Instagram 2,200자)
  describe('Korean and Emoji boundary precision', () => {
    it('enforces Threads 500 character limit using countThreadsLength (emoji = UTF-8 bytes)', async () => {
      // 일반 문자 496자 + 이모지 1개(😀 = 4 바이트) = 500자 (PASS)
      const exact500Text = '가'.repeat(496) + '😀';
      expect(countThreadsLength(exact500Text)).toBe(500);

      const fakeGenPass: TextGenerator = {
        async generateText() {
          return JSON.stringify({
            threads: { text: exact500Text },
          });
        },
      };

      const passResult = await generateChannelVariants({
        topic: '스레드 글자 수 한도',
        baseDraft: '이모지 포함 글자 수',
        channels: ['threads'],
        generator: fakeGenPass,
      });

      expect(passResult.variants.threads?.status).toBe('PASS');
      expect(passResult.variants.threads?.evaluation.blocksVault).toBe(false);

      // 일반 문자 497자 + 이모지 1개(😀 = 4 바이트) = 501자 (FAIL)
      const over501Text = '가'.repeat(497) + '😀';
      expect(countThreadsLength(over501Text)).toBe(501);

      const fakeGenFail: TextGenerator = {
        async generateText() {
          return JSON.stringify({
            threads: { text: over501Text },
          });
        },
      };

      const failResult = await generateChannelVariants({
        topic: '스레드 글자 수 한도 초과',
        baseDraft: '이모지 포함 글자 수 초과',
        channels: ['threads'],
        generator: fakeGenFail,
        maxRetries: 0,
      });

      expect(failResult.variants.threads?.status).toBe('FAIL');
      expect(failResult.variants.threads?.evaluation.blocksVault).toBe(true);
    });

    it('enforces Instagram 2,200 codepoints with Korean and composite ZWJ emojis', async () => {
      // 2,193 한글 + ZWJ 복합 이모지(👨‍👩‍👧‍👦 = 7 codepoints) = 2,200 codepoints (PASS)
      const exact2200Text = '한'.repeat(2193) + '👨‍👩‍👧‍👦';
      expect(Array.from(exact2200Text).length).toBe(2200);

      const fakeGenPass: TextGenerator = {
        async generateText() {
          return JSON.stringify({
            instagram: {
              caption: exact2200Text,
              hashtags: ['#소희'],
            },
          });
        },
      };

      const passResult = await generateChannelVariants({
        topic: '인스타그램 글자 수',
        baseDraft: '인스타그램 2200자',
        channels: ['instagram'],
        generator: fakeGenPass,
        media: [{ type: 'image', format: 'jpeg' }],
      });

      expect(passResult.variants.instagram?.status).toBe('PASS');

      // 2,194 한글 + ZWJ 복합 이모지(7 codepoints) = 2,201 codepoints (FAIL)
      const over2201Text = '한'.repeat(2194) + '👨‍👩‍👧‍👦';
      expect(Array.from(over2201Text).length).toBe(2201);

      const fakeGenFail: TextGenerator = {
        async generateText() {
          return JSON.stringify({
            instagram: {
              caption: over2201Text,
              hashtags: ['#소희'],
            },
          });
        },
      };

      const failResult = await generateChannelVariants({
        topic: '인스타그램 글자 수 초과',
        baseDraft: '인스타그램 2201자',
        channels: ['instagram'],
        generator: fakeGenFail,
        media: [{ type: 'image', format: 'jpeg' }],
        maxRetries: 0,
      });

      expect(failResult.variants.instagram?.status).toBe('FAIL');
    });
  });
});
