/**
 * Tests for Sohee V0.9 Wave 3 Content Studio Pipeline & Channel QC
 * Traceability: ANI-927
 */

import { describe, it, expect } from 'vitest';
import { ContentStudioService } from '@/lib/content-studio/content-studio-service';
import { ContentBrief, ContentAsset } from '@/types/content-studio';

describe('V0.9 Wave 3 · Content Studio Figma Parity & QC Pipeline (ANI-927)', () => {
  const dummyAsset: ContentAsset = {
    assetId: 'ast-001',
    briefId: 'brief-001',
    assetType: 'IMAGE',
    mediaUrl: 'https://images.unsplash.com/photo-1522337360788-8b13dee7a37e',
    sha256: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
    isApprovedByOwner: true,
    createdAt: new Date().toISOString(),
  };

  it('1. 인스타그램 채널 네이티브 규격을 검증해야 한다 (이미지 필수, 글자수, 해시태그)', () => {
    // 정상 케이스
    const validQc = ContentStudioService.validateChannelVariant(
      'INSTAGRAM',
      undefined,
      '봄맞이 자연스러운 눈썹 결 디자인입니다.',
      ['#청라눈썹', '#자연눈썹'],
      [dummyAsset]
    );
    expect(validQc.passed).toBe(true);
    expect(validQc.score).toBeGreaterThanOrEqual(70);

    // 에셋 누락 시 불합격
    const noAssetQc = ContentStudioService.validateChannelVariant(
      'INSTAGRAM',
      undefined,
      '봄맞이 자연스러운 눈썹 결 디자인입니다.',
      ['#청라눈썹'],
      []
    );
    expect(noAssetQc.passed).toBe(false);
    expect(noAssetQc.recommendations.some(r => r.includes('이미지'))).toBe(true);

    // 해시태그 30개 초과 시 불합격
    const overHashtags = Array.from({ length: 35 }, (_, i) => `#tag${i}`);
    const overHashQc = ContentStudioService.validateChannelVariant(
      'INSTAGRAM',
      undefined,
      '봄맞이 뷰티',
      overHashtags,
      [dummyAsset]
    );
    expect(overHashQc.passed).toBe(false);
    expect(overHashQc.recommendations.some(r => r.includes('30개'))).toBe(true);
  });

  it('2. 네이버 블로그 채널 규격을 검증해야 한다 (제목 필수, 본문 길이)', () => {
    // 제목 누락 시 불합격
    const noTitleQc = ContentStudioService.validateChannelVariant(
      'NAVER_BLOG',
      '',
      '본문 내용입니다.',
      [],
      [dummyAsset]
    );
    expect(noTitleQc.passed).toBe(false);
    expect(noTitleQc.recommendations.some(r => r.includes('제목'))).toBe(true);

    // 정상 제목 및 적정 본문 시 합격
    const validBlogQc = ContentStudioService.validateChannelVariant(
      'NAVER_BLOG',
      '[청라 뷰티] 자연 결 눈썹 시술 가이드',
      '안녕하세요. 청라 1:1 맞춤 자연 결 눈썹 전문 원장입니다. 고객님의 골격과 모류를 정밀하게 분석하여 시술 직후에도 자연스러운 디자인을 선사합니다.'.repeat(2),
      ['#청라눈썹문신'],
      [dummyAsset]
    );
    expect(validBlogQc.passed).toBe(true);
  });

  it('3. 의료법 및 표시광고법 금칙어 검출 시 즉각 Fail-Closed 처리해야 한다', () => {
    const forbiddenQc = ContentStudioService.validateChannelVariant(
      'INSTAGRAM',
      undefined,
      '저희 매장에서는 100% 보장하는 기적의 눈썹 시술로 부작용 전혀 없음!',
      ['#눈썹'],
      [dummyAsset]
    );

    expect(forbiddenQc.passed).toBe(false);
    expect(forbiddenQc.forbiddenWordsFound).toContain('100% 보장');
    expect(forbiddenQc.forbiddenWordsFound).toContain('기적의');
    expect(forbiddenQc.forbiddenWordsFound).toContain('부작용 전혀 없음');
  });

  it('4. 브리프와 에셋으로 Content Studio 파이프라인 아이템을 생성해야 한다', () => {
    const brief: ContentBrief = {
      briefId: 'brief-spring-01',
      workspaceId: 'ws-gangnam-01',
      topic: '봄맞이 자연결 브로우',
      targetChannels: ['INSTAGRAM', 'NAVER_BLOG'],
      targetAudience: '2030 여성',
      creativeAngle: '1:1 골격 맞춤',
      createdAt: new Date().toISOString(),
      status: 'READY_FOR_GENERATION',
    };

    const pipelineItem = ContentStudioService.createPipelineItem({
      brief,
      assets: [dummyAsset],
      variants: [
        {
          channel: 'INSTAGRAM',
          caption: '인스타 맞춤 캡션입니다.',
          hashtags: ['#뷰티'],
        },
        {
          channel: 'NAVER_BLOG',
          title: '네이버 블로그 제목',
          caption: '네이버 블로그 본문 내용이 충분히 작성되어 있습니다. '.repeat(5),
          hashtags: ['#블로그'],
        },
      ],
    });

    expect(pipelineItem.id).toBe('studio_item_brief-spring-01');
    expect(pipelineItem.variants).toHaveLength(2);
    expect(pipelineItem.currentStage).toBe('APPROVAL');
  });

  it('5. 승인된 원고에 대해 스케줄 등록 및 독립 재조회 증거 연동을 수행해야 한다', () => {
    const brief: ContentBrief = {
      briefId: 'brief-002',
      workspaceId: 'ws-gangnam-01',
      topic: '봄맞이 뷰티',
      targetChannels: ['INSTAGRAM'],
      targetAudience: '2030',
      creativeAngle: '자연스러움',
      createdAt: new Date().toISOString(),
      status: 'READY_FOR_GENERATION',
    };

    const item = ContentStudioService.createPipelineItem({
      brief,
      assets: [dummyAsset],
      variants: [
        {
          channel: 'INSTAGRAM',
          caption: '자연스러운 눈썹 결 디자인입니다.',
          hashtags: ['#눈썹'],
        },
      ],
    });

    const scheduledItem = ContentStudioService.approveAndSchedule(
      item,
      item.variants[0].variantId,
      '2026-09-08T10:00:00.000Z'
    );

    expect(scheduledItem.currentStage).toBe('SCHEDULE_OR_PUBLISH');
    expect(scheduledItem.publishingJob).toBeDefined();
    expect(scheduledItem.publishingJob?.status).toBe('SCHEDULED');
    expect(scheduledItem.publishingJob?.scheduledAt).toBe('2026-09-08T10:00:00.000Z');

    // 발행 성공 및 증거 기록
    const publishedItem = ContentStudioService.recordPublishingResult(scheduledItem, {
      success: true,
      providerPostId: 'ig_post_999888',
      providerPostUrl: 'https://instagram.com/p/abcdef123',
      evidenceId: 'ev_pub_proof_777',
    });

    expect(publishedItem.currentStage).toBe('READBACK_VERIFIED');
    expect(publishedItem.publishingJob?.status).toBe('PUBLISHED');
    expect(publishedItem.publishingJob?.providerPostId).toBe('ig_post_999888');
    expect(publishedItem.publishingJob?.evidenceId).toBe('ev_pub_proof_777');
  });
});
