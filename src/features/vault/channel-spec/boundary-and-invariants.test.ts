import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { countThreadsLength } from './character-counter';
import { evaluateChannelSpec } from './evaluate';
import { SPEC_RULES_METADATA } from './spec-table';
import type { ChannelType, ChannelVariantPayload } from './types';

describe('ANI-1527: Invariants and Boundary Tests', () => {
  // 1. 네트워크 호출 완전 차단(Air-gapped) 검증
  describe('Air-gapped pure function invariant', () => {
    beforeEach(() => {
      // global fetch나 네트워크가 호출되면 즉시 예외 발생
      vi.stubGlobal('fetch', () => {
        throw new Error('NETWORK_CALL_PROHIBITED: Pure function must not make network calls');
      });
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('evaluates all 4 channels without making any network call', () => {
      const channels: ChannelType[] = ['instagram', 'threads', 'naver_blog', 'daangn_business'];
      const payload: ChannelVariantPayload = {
        title: '제목',
        text: '본문 텍스트 #소희',
        media: [{ type: 'image', format: 'jpeg', fileSizeBytes: 1024 }],
      };

      for (const channel of channels) {
        expect(() => evaluateChannelSpec(channel, payload)).not.toThrow();
      }
    });
  });

  // 2. 외부 Provider / Publishing 모듈 import 금지 불변식 정적 검증
  describe('Import boundary static analysis', () => {
    it('does not import publishing, provider, or external network packages', () => {
      const dirPath = __dirname;
      const files = fs.readdirSync(dirPath).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));

      const forbiddenPatterns = [
        /from\s+['"].*publishing.*['"]/,
        /from\s+['"].*provider.*['"]/,
        /from\s+['"].*oauth.*['"]/,
        /from\s+['"]axios['"]/,
        /from\s+['"]node-fetch['"]/,
      ];

      for (const file of files) {
        const content = fs.readFileSync(path.join(dirPath, file), 'utf-8');
        for (const pattern of forbiddenPatterns) {
          expect(content).not.toMatch(pattern);
        }
      }
    });
  });

  // 3. 다국어/이모지 경계값 정밀 테스트
  describe('Korean and Emoji boundary precision', () => {
    it('Instagram: exactly 2,200 codepoints with Korean and composite emojis', () => {
      // 2,198 Korean characters + 1 composite emoji (👨‍👩‍👧‍👦 = 7 codepoints) => 2205 codepoints (FAIL)
      const baseKorean = '한'.repeat(2198);
      const withZwj = baseKorean + '👨‍👩‍👧‍👦'; // 2198 + 7 = 2205 codepoints
      const overRes = evaluateChannelSpec('instagram', { text: withZwj });
      expect(overRes.checks.find((c) => c.id === 'instagram-caption-length')?.status).toBe('FAIL');
      expect(overRes.blocksVault).toBe(true);

      // 2,199 Korean characters + 1 simple emoji (😀 = 1 codepoint) = 2,200 codepoints (PASS)
      const exact2200 = '한'.repeat(2199) + '😀';
      const exactRes = evaluateChannelSpec('instagram', { text: exact2200, media: [{ type: 'image', format: 'jpeg' }] });
      expect(exactRes.checks.find((c) => c.id === 'instagram-caption-length')?.status).toBe('PASS');
      expect(exactRes.blocksVault).toBe(false);
    });

    it('Threads: exactly 500 units with Korean and emojis calculated via Threads spec', () => {
      // Threads spec: 일반 문자 1자, 이모지는 UTF-8 byte 수
      // '가' (1자) * 496 + '😀' (4 bytes) = 500자 (PASS)
      const text500 = '가'.repeat(496) + '😀';
      expect(countThreadsLength(text500)).toBe(500);
      const res500 = evaluateChannelSpec('threads', { text: text500 });
      expect(res500.checks.find((c) => c.id === 'threads-text-length')?.status).toBe('PASS');
      expect(res500.blocksVault).toBe(false);

      // '가' (1자) * 497 + '😀' (4 bytes) = 501자 (FAIL)
      const text501 = '가'.repeat(497) + '😀';
      expect(countThreadsLength(text501)).toBe(501);
      const res501 = evaluateChannelSpec('threads', { text: text501 });
      expect(res501.checks.find((c) => c.id === 'threads-text-length')?.status).toBe('FAIL');
      expect(res501.blocksVault).toBe(true);
    });
  });

  // 4. 모든 규칙 메타데이터 무결성 검증
  describe('Rule metadata completeness', () => {
    it('every rule in currentSpec has evidence, label, verifiedAt, and description', () => {
      for (const [id, meta] of Object.entries(SPEC_RULES_METADATA)) {
        expect(meta.id).toBe(id);
        expect(meta.label).toBeTruthy();
        expect(['OFFICIAL_DOC', 'CONFIG', 'UNVERIFIED']).toContain(meta.evidence);
        expect(meta.verifiedAt).toMatch(/^2026-\d{2}$/);
        expect(meta.description).toBeTruthy();
        if (meta.evidence === 'OFFICIAL_DOC') {
          expect(meta.sourceUrl).toMatch(/^https:\/\//);
        }
      }
    });

    it('blocksVault is true if and only if at least one check is FAIL', () => {
      const allChannels: ChannelType[] = ['instagram', 'threads', 'naver_blog', 'daangn_business'];
      for (const ch of allChannels) {
        // 빈 페이로드 평가
        const res = evaluateChannelSpec(ch, {});
        const hasFail = res.checks.some((c) => c.status === 'FAIL');
        expect(res.blocksVault).toBe(hasFail);
      }
    });

    it('userMessage contains user-friendly Korean and never leaks technical error codes', () => {
      const payloadBad: ChannelVariantPayload = {
        title: '',
        text: 'A'.repeat(3000),
        media: [
          { type: 'image', format: 'unknown_format', fileSizeBytes: 999999999 },
          { type: 'video', format: 'mp4' },
          { type: 'video', format: 'mp4' },
        ],
      };

      const allChannels: ChannelType[] = ['instagram', 'threads', 'naver_blog', 'daangn_business'];
      for (const ch of allChannels) {
        const res = evaluateChannelSpec(ch, payloadBad);
        for (const check of res.checks) {
          expect(check.userMessage).toBeTruthy();
          // 기술 식별자 또는 영문 상태 코드 노출 금지
          expect(check.userMessage).not.toMatch(/FAIL|WARN|PASS|UNKNOWN|ERROR|UNVERIFIED|OFFICIAL_DOC/);
        }
      }
    });
  });
});
