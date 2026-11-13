import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RESOLUTION_ACTION,
  getResolutionAction,
  RESOLUTION_ACTIONS,
} from './resolution-actions';

describe('resolution-actions', () => {
  it('인스타그램 주요 규칙에 대한 해결 행동을 반환한다', () => {
    expect(getResolutionAction('instagram-carousel-max')).toBe('사진을 10장 이하로 줄여 주세요');
    expect(getResolutionAction('instagram-caption-length')).toBe('캡션을 2,200자 이하로 줄여 주세요');
    expect(getResolutionAction('instagram-image-format')).toBe('이미지를 JPG(JPEG) 형식으로 다시 올려 주세요');
    expect(getResolutionAction('instagram-hashtag-count')).toBe('해시태그를 30개 이하로 줄여 주세요');
  });

  it('스레드 주요 규칙에 대한 해결 행동을 반환한다', () => {
    expect(getResolutionAction('threads-text-length')).toBe('본문을 500자 이하로 줄여 주세요');
    expect(getResolutionAction('threads-carousel-items')).toBe('캐러셀 사진을 2장 이상 20장 이하로 맞춰 주세요');
    expect(getResolutionAction('threads-image-format')).toBe('이미지를 JPG 또는 PNG 형식으로 올려 주세요');
    expect(getResolutionAction('threads-image-size')).toBe('이미지 파일 용량을 8MB 이하로 줄여 주세요');
  });

  it('네이버 블로그 주요 규칙에 대한 해결 행동을 반환한다', () => {
    expect(getResolutionAction('naver-blog-title-required')).toBe('제목을 입력해 주세요');
    expect(getResolutionAction('naver-blog-image-required')).toBe('사진을 1장 이상 추가해 주세요');
    expect(getResolutionAction('naver-blog-title-length')).toBe('제목을 100자 이하로 줄여 주세요');
    expect(getResolutionAction('naver-blog-content-length')).toBe('본문 글자 수를 권장 기준에 맞게 줄여 주세요');
    expect(getResolutionAction('naver-blog-image-count')).toBe('사진을 50장 이하로 줄여 주세요');
  });

  it('당근 비즈프로필 주요 규칙에 대한 해결 행동을 반환한다', () => {
    expect(getResolutionAction('daangn-images-count')).toBe('사진을 20장 이하로 줄여 주세요');
    expect(getResolutionAction('daangn-video-count')).toBe('동영상을 1개 이하로 줄여 주세요');
    expect(getResolutionAction('daangn-text-length')).toBe('본문을 2,000자 이하로 줄여 주세요');
  });

  it('매핑 테이블에 없는 ruleId에 대해서는 친절한 일반 문구를 반환한다', () => {
    const unknownAction = getResolutionAction('unknown-custom-rule');
    expect(unknownAction).toBe(DEFAULT_RESOLUTION_ACTION);
    expect(unknownAction).toContain('수정');
    expect(unknownAction).not.toContain('unknown-custom-rule');
  });

  it('모든 해결 행동 문구는 사장님/서비스 중립 및 금칙어를 준수한다', () => {
    const forbiddenPatterns = [
      /harness/i,
      /하네스/,
      /fingerprint/i,
      /지문/,
      /예약됨/,
      /uuid/i,
      /sha/i,
    ];

    const allActions = [DEFAULT_RESOLUTION_ACTION, ...Object.values(RESOLUTION_ACTIONS)];
    for (const action of allActions) {
      for (const pattern of forbiddenPatterns) {
        expect(action).not.toMatch(pattern);
      }
    }
  });
});
