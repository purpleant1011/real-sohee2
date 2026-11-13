import { describe, expect, it } from 'vitest';
import { evaluateChannelSpec } from './evaluate';
import { currentSpec } from './spec-table';
import type { ChannelVariantPayload } from './types';

describe('evaluateChannelSpec', () => {
  describe('Instagram rules', () => {
    it('passes standard compliant instagram payload', () => {
      const payload: ChannelVariantPayload = {
        text: '안녕하세요 오늘의 소식을 전해드립니다. #뉴스 #일상',
        media: [
          { type: 'image', format: 'jpeg', fileSizeBytes: 1024 * 1024 },
          { type: 'image', format: 'jpg', fileSizeBytes: 1024 * 1024 },
        ],
      };

      const result = evaluateChannelSpec('instagram', payload);
      expect(result.blocksVault).toBe(false);
      expect(result.specVersion).toBe(currentSpec.specVersion);
      expect(result.checks.every((c) => c.status === 'PASS')).toBe(true);
    });

    it('enforces carousel max 10 items boundary (OFFICIAL_DOC)', () => {
      const makePayload = (count: number): ChannelVariantPayload => ({
        caption: '테스트 캡션입니다.',
        media: Array.from({ length: count }, (_, i) => ({
          type: 'image' as const,
          format: 'jpeg',
          id: `img-${i}`,
        })),
      });

      const pass10 = evaluateChannelSpec('instagram', makePayload(10));
      const carousel10Check = pass10.checks.find((c) => c.id === 'instagram-carousel-max');
      expect(carousel10Check?.status).toBe('PASS');
      expect(carousel10Check?.evidence).toBe('OFFICIAL_DOC');
      expect(pass10.blocksVault).toBe(false);

      const fail11 = evaluateChannelSpec('instagram', makePayload(11));
      const carousel11Check = fail11.checks.find((c) => c.id === 'instagram-carousel-max');
      expect(carousel11Check?.status).toBe('FAIL');
      expect(carousel11Check?.evidence).toBe('OFFICIAL_DOC');
      expect(fail11.blocksVault).toBe(true);
      expect(carousel11Check?.userMessage).not.toMatch(/FAIL|ERROR|INVALID/);
      expect(carousel11Check?.userMessage).toContain('10');
    });

    it('enforces JPEG format rule for API uploads (OFFICIAL_DOC)', () => {
      const pngPayload: ChannelVariantPayload = {
        caption: 'PNG 이미지 테스트',
        media: [{ type: 'image', format: 'png' }],
      };

      const res = evaluateChannelSpec('instagram', pngPayload);
      const formatCheck = res.checks.find((c) => c.id === 'instagram-image-format');
      expect(formatCheck?.status).toBe('FAIL');
      expect(formatCheck?.evidence).toBe('OFFICIAL_DOC');
      expect(res.blocksVault).toBe(true);
      expect(formatCheck?.userMessage).toContain('JPEG');
    });

    it('enforces at least 1 image requirement for Instagram (OFFICIAL_DOC)', () => {
      const noImageRes = evaluateChannelSpec('instagram', {
        caption: '인스타그램 캡션입니다.',
        media: [],
      });
      const imgCheck = noImageRes.checks.find((c) => c.id === 'instagram-image-required');
      expect(imgCheck?.status).toBe('FAIL');
      expect(imgCheck?.evidence).toBe('OFFICIAL_DOC');
      expect(noImageRes.blocksVault).toBe(true);

      const withImageRes = evaluateChannelSpec('instagram', {
        caption: '인스타그램 캡션입니다.',
        media: [{ type: 'image', format: 'jpeg' }],
      });
      const withImgCheck = withImageRes.checks.find((c) => c.id === 'instagram-image-required');
      expect(withImgCheck?.status).toBe('PASS');
      expect(withImgCheck?.evidence).toBe('OFFICIAL_DOC');
      expect(withImageRes.blocksVault).toBe(false);
    });

    it('enforces caption 2,200 chars boundary (OFFICIAL_DOC)', () => {
      const exact2200 = '가'.repeat(2200);
      const over2201 = '가'.repeat(2201);
      const validMedia = [{ type: 'image' as const, format: 'jpeg' }];

      const passRes = evaluateChannelSpec('instagram', { caption: exact2200, media: validMedia });
      const passCheck = passRes.checks.find((c) => c.id === 'instagram-caption-length');
      expect(passCheck?.status).toBe('PASS');
      expect(passRes.blocksVault).toBe(false);

      const failRes = evaluateChannelSpec('instagram', { caption: over2201, media: validMedia });
      const failCheck = failRes.checks.find((c) => c.id === 'instagram-caption-length');
      expect(failCheck?.status).toBe('FAIL');
      expect(failCheck?.evidence).toBe('OFFICIAL_DOC');
      expect(failRes.blocksVault).toBe(true);
    });

    it('enforces max 30 hashtags boundary (OFFICIAL_DOC)', () => {
      const tags30 = Array.from({ length: 30 }, (_, i) => `태그${i}`);
      const tags31 = Array.from({ length: 31 }, (_, i) => `태그${i}`);

      const passRes = evaluateChannelSpec('instagram', { hashtags: tags30 });
      const passCheck = passRes.checks.find((c) => c.id === 'instagram-hashtag-count');
      expect(passCheck?.status).toBe('PASS');

      const failRes = evaluateChannelSpec('instagram', { hashtags: tags31 });
      const failCheck = failRes.checks.find((c) => c.id === 'instagram-hashtag-count');
      expect(failCheck?.status).toBe('FAIL');
      expect(failCheck?.evidence).toBe('OFFICIAL_DOC');
      expect(failRes.blocksVault).toBe(true);
    });

    it('extracts hashtags from text when hashtags array is not provided', () => {
      const tagsInText = Array.from({ length: 31 }, (_, i) => `#태그${i}`).join(' ');
      const res = evaluateChannelSpec('instagram', { text: tagsInText });
      const tagCheck = res.checks.find((c) => c.id === 'instagram-hashtag-count');
      expect(tagCheck?.status).toBe('FAIL');
      expect(res.blocksVault).toBe(true);
    });

    it('warns on caption fold threshold without blocking vault (UNVERIFIED)', () => {
      const longText = '가'.repeat(150);
      const res = evaluateChannelSpec('instagram', { caption: longText, media: [{ type: 'image', format: 'jpeg' }] });
      const foldCheck = res.checks.find((c) => c.id === 'instagram-caption-fold');
      expect(foldCheck?.status).toBe('WARN');
      expect(foldCheck?.evidence).toBe('UNVERIFIED');
      expect(res.blocksVault).toBe(false);
      expect(foldCheck?.userMessage).toContain('확인이 필요해요');
      expect(foldCheck?.userMessage).not.toMatch(/FAIL|WARN|ERROR/);
    });
  });

  describe('Threads rules', () => {
    it('enforces post text 500 chars boundary (OFFICIAL_DOC)', () => {
      const exact500 = 'A'.repeat(500);
      const over501 = 'A'.repeat(501);

      const passRes = evaluateChannelSpec('threads', { text: exact500 });
      const passCheck = passRes.checks.find((c) => c.id === 'threads-text-length');
      expect(passCheck?.status).toBe('PASS');
      expect(passRes.blocksVault).toBe(false);

      const failRes = evaluateChannelSpec('threads', { text: over501 });
      const failCheck = failRes.checks.find((c) => c.id === 'threads-text-length');
      expect(failCheck?.status).toBe('FAIL');
      expect(failCheck?.evidence).toBe('OFFICIAL_DOC');
      expect(failRes.blocksVault).toBe(true);
    });

    it('counts emojis in threads text by UTF-8 byte length (Meta Threads API spec)', () => {
      // '😀' = 4 bytes. 496 ASCII chars (496) + '😀' (4 bytes) = 500 (PASS)
      const text500WithEmoji = 'A'.repeat(496) + '😀';
      const passRes = evaluateChannelSpec('threads', { text: text500WithEmoji });
      const passCheck = passRes.checks.find((c) => c.id === 'threads-text-length');
      expect(passCheck?.status).toBe('PASS');
      expect(passRes.blocksVault).toBe(false);

      // 497 ASCII chars (497) + '😀' (4 bytes) = 501 (FAIL)
      const text501WithEmoji = 'A'.repeat(497) + '😀';
      const failRes = evaluateChannelSpec('threads', { text: text501WithEmoji });
      const failCheck = failRes.checks.find((c) => c.id === 'threads-text-length');
      expect(failCheck?.status).toBe('FAIL');
      expect(failRes.blocksVault).toBe(true);
    });

    it('enforces carousel items 2~20 boundary (OFFICIAL_DOC)', () => {
      // 1 item is a single post (PASS)
      const singleRes = evaluateChannelSpec('threads', {
        media: [{ type: 'image', format: 'jpeg' }],
      });
      expect(singleRes.checks.find((c) => c.id === 'threads-carousel-items')?.status).toBe('PASS');

      // 20 items (PASS)
      const media20 = Array.from({ length: 20 }, (_, i) => ({
        type: 'image' as const,
        format: 'png',
        id: `img-${i}`,
      }));
      const pass20 = evaluateChannelSpec('threads', { media: media20 });
      expect(pass20.checks.find((c) => c.id === 'threads-carousel-items')?.status).toBe('PASS');
      expect(pass20.blocksVault).toBe(false);

      // 21 items (FAIL)
      const media21 = Array.from({ length: 21 }, (_, i) => ({
        type: 'image' as const,
        format: 'png',
        id: `img-${i}`,
      }));
      const fail21 = evaluateChannelSpec('threads', { media: media21 });
      const failCheck = fail21.checks.find((c) => c.id === 'threads-carousel-items');
      expect(failCheck?.status).toBe('FAIL');
      expect(failCheck?.evidence).toBe('OFFICIAL_DOC');
      expect(fail21.blocksVault).toBe(true);
    });

    it('allows JPEG and PNG but rejects other image formats (OFFICIAL_DOC)', () => {
      const allowedRes = evaluateChannelSpec('threads', {
        media: [
          { type: 'image', format: 'jpeg' },
          { type: 'image', format: 'png' },
        ],
      });
      expect(allowedRes.checks.find((c) => c.id === 'threads-image-format')?.status).toBe('PASS');

      const rejectedRes = evaluateChannelSpec('threads', {
        media: [{ type: 'image', format: 'webp' }],
      });
      const formatCheck = rejectedRes.checks.find((c) => c.id === 'threads-image-format');
      expect(formatCheck?.status).toBe('FAIL');
      expect(formatCheck?.evidence).toBe('OFFICIAL_DOC');
      expect(rejectedRes.blocksVault).toBe(true);
    });

    it('enforces max 8MB image file size (OFFICIAL_DOC)', () => {
      const maxAllowedBytes = 8 * 1024 * 1024; // 8MB
      const passRes = evaluateChannelSpec('threads', {
        media: [{ type: 'image', format: 'jpeg', fileSizeBytes: maxAllowedBytes }],
      });
      expect(passRes.checks.find((c) => c.id === 'threads-image-size')?.status).toBe('PASS');

      const failRes = evaluateChannelSpec('threads', {
        media: [{ type: 'image', format: 'jpeg', fileSizeBytes: maxAllowedBytes + 1 }],
      });
      const sizeCheck = failRes.checks.find((c) => c.id === 'threads-image-size');
      expect(sizeCheck?.status).toBe('FAIL');
      expect(sizeCheck?.evidence).toBe('OFFICIAL_DOC');
      expect(failRes.blocksVault).toBe(true);
    });
  });

  describe('Naver Blog rules', () => {
    it('enforces required title (CONFIG)', () => {
      const missingTitleRes = evaluateChannelSpec('naver_blog', {
        title: '',
        text: '본문 내용입니다.',
        media: [{ type: 'image', format: 'jpeg' }],
      });
      const titleCheck = missingTitleRes.checks.find((c) => c.id === 'naver-blog-title-required');
      expect(titleCheck?.status).toBe('FAIL');
      expect(titleCheck?.evidence).toBe('CONFIG');
      expect(missingTitleRes.blocksVault).toBe(true);
    });

    it('enforces at least 1 image requirement (CONFIG)', () => {
      const noImageRes = evaluateChannelSpec('naver_blog', {
        title: '블로그 포스트 제목',
        text: '본문 내용입니다.',
        media: [],
      });
      const imgCheck = noImageRes.checks.find((c) => c.id === 'naver-blog-image-required');
      expect(imgCheck?.status).toBe('FAIL');
      expect(imgCheck?.evidence).toBe('CONFIG');
      expect(noImageRes.blocksVault).toBe(true);
    });

    it('warns on recommended title length (100) without blocking vault (UNVERIFIED)', () => {
      const longTitle = '가'.repeat(101);
      const res = evaluateChannelSpec('naver_blog', {
        title: longTitle,
        text: '본문 내용',
        media: [{ type: 'image', format: 'jpeg' }],
      });
      const titleLenCheck = res.checks.find((c) => c.id === 'naver-blog-title-length');
      expect(titleLenCheck?.status).toBe('WARN');
      expect(titleLenCheck?.evidence).toBe('UNVERIFIED');
      expect(res.blocksVault).toBe(false);
      expect(titleLenCheck?.userMessage).toContain('확인이 필요해요');
    });

    it('warns on recommended content length (20000) without blocking vault (UNVERIFIED)', () => {
      const longBody = '글'.repeat(20001);
      const res = evaluateChannelSpec('naver_blog', {
        title: '정상 제목',
        text: longBody,
        media: [{ type: 'image', format: 'jpeg' }],
      });
      const bodyCheck = res.checks.find((c) => c.id === 'naver-blog-content-length');
      expect(bodyCheck?.status).toBe('WARN');
      expect(bodyCheck?.evidence).toBe('UNVERIFIED');
      expect(res.blocksVault).toBe(false);
    });
  });

  describe('Daangn Business Profile rules', () => {
    it('warns when images exceed 20 without blocking vault (UNVERIFIED)', () => {
      const media21 = Array.from({ length: 21 }, (_, i) => ({
        type: 'image' as const,
        format: 'jpeg',
        id: `img-${i}`,
      }));
      const res = evaluateChannelSpec('daangn_business', {
        text: '당근 소식 내용입니다.',
        media: media21,
      });
      const imgCheck = res.checks.find((c) => c.id === 'daangn-images-count');
      expect(imgCheck?.status).toBe('WARN');
      expect(imgCheck?.evidence).toBe('UNVERIFIED');
      expect(res.blocksVault).toBe(false);
      expect(imgCheck?.userMessage).toContain('확인이 필요해요');
    });

    it('warns when videos exceed 1 without blocking vault (UNVERIFIED)', () => {
      const res = evaluateChannelSpec('daangn_business', {
        text: '당근 소식 내용입니다.',
        media: [
          { type: 'video', format: 'mp4' },
          { type: 'video', format: 'mp4' },
        ],
      });
      const videoCheck = res.checks.find((c) => c.id === 'daangn-video-count');
      expect(videoCheck?.status).toBe('WARN');
      expect(videoCheck?.evidence).toBe('UNVERIFIED');
      expect(res.blocksVault).toBe(false);
      expect(videoCheck?.userMessage).toContain('확인이 필요해요');
    });

    it('informs gallery display limit (10) when between 11 and 20 images (UNVERIFIED)', () => {
      const media12 = Array.from({ length: 12 }, (_, i) => ({
        type: 'image' as const,
        format: 'jpeg',
        id: `img-${i}`,
      }));
      const res = evaluateChannelSpec('daangn_business', {
        text: '당근 소식',
        media: media12,
      });
      const galleryCheck = res.checks.find((c) => c.id === 'daangn-gallery-display');
      expect(galleryCheck?.status).toBe('WARN');
      expect(galleryCheck?.evidence).toBe('UNVERIFIED');
      expect(res.blocksVault).toBe(false);
      expect(galleryCheck?.userMessage).toContain('확인이 필요해요');
    });
  });

  describe('Fail-closed and User Message Invariants', () => {
    it('blocks vault ONLY when there is at least one FAIL status', () => {
      const warnOnlyRes = evaluateChannelSpec('naver_blog', {
        title: '가'.repeat(105), // WARN (UNVERIFIED)
        text: '본문 내용',
        media: [{ type: 'image', format: 'jpeg' }],
      });
      expect(warnOnlyRes.checks.some((c) => c.status === 'WARN')).toBe(true);
      expect(warnOnlyRes.checks.some((c) => c.status === 'FAIL')).toBe(false);
      expect(warnOnlyRes.blocksVault).toBe(false);
    });

    it('ensures all checks have evidence label and userMessage in friendly Korean without English status codes', () => {
      const res = evaluateChannelSpec('instagram', {
        caption: '가'.repeat(2205),
        media: [{ type: 'image', format: 'png' }],
      });

      expect(res.blocksVault).toBe(true);
      for (const check of res.checks) {
        expect(['OFFICIAL_DOC', 'CONFIG', 'UNVERIFIED']).toContain(check.evidence);
        expect(check.label).toBeTruthy();
        expect(check.userMessage).toBeTruthy();
        // Disallow exposed internal codes in userMessage
        expect(check.userMessage).not.toMatch(/FAIL|WARN|PASS|UNKNOWN|ERROR|UNVERIFIED|OFFICIAL_DOC/);
      }
    });

    it('handles UNKNOWN status gracefully without blocking vault', () => {
      const unknownCheckResult = evaluateChannelSpec('naver_blog', {
        title: '정상 제목',
        text: '본문',
        media: [{ type: 'image' }], // format unknown
      });

      const unknownChecks = unknownCheckResult.checks.filter((c) => c.status === 'UNKNOWN');
      for (const uc of unknownChecks) {
        expect(uc.userMessage).toContain('확인이 필요해요');
      }
    });

    it('supports custom spec version table injection', () => {
      const customSpec = {
        ...currentSpec,
        specVersion: '2026.11.0-custom',
        instagram: {
          ...currentSpec.instagram,
          maxCarouselItems: 5, // custom limit
        },
      };

      const payload: ChannelVariantPayload = {
        caption: '커스텀 스펙 테스트',
        media: Array.from({ length: 6 }, () => ({ type: 'image' as const, format: 'jpeg' })),
      };

      const result = evaluateChannelSpec('instagram', payload, customSpec);
      expect(result.specVersion).toBe('2026.11.0-custom');
      expect(result.blocksVault).toBe(true);
      expect(result.checks.find((c) => c.id === 'instagram-carousel-max')?.status).toBe('FAIL');
    });
  });
});
