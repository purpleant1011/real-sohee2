import { describe, expect, it } from 'vitest';
import {
  POST_FORMAT_IDS,
  POST_FORMAT_MODULES,
  POST_REACTION_IDS,
  POST_REACTION_MODULES,
  POST_IMAGE_STYLE_IDS,
  POST_IMAGE_STYLE_MODULES,
  getPostFormat,
  getPostReaction,
  getPostImageStyle,
  clampImageCount,
  defaultPostPlan,
  resolvePostPlan,
  buildPlanPromptGuidance,
  isPhotoHeavy,
  type PostPlan,
} from './post-modules';

describe('post-modules', () => {
  describe('모듈 목록 및 유효성 검증', () => {
    it('7개의 포스트 형식이 정의되어 있고 id가 중복되지 않아야 한다', () => {
      expect(POST_FORMAT_IDS).toHaveLength(7);
      expect(POST_FORMAT_MODULES).toHaveLength(7);

      const ids = POST_FORMAT_MODULES.map((m) => m.id);
      expect(new Set(ids).size).toBe(7);
      expect(ids).toEqual([...POST_FORMAT_IDS]);
    });

    it('포스트 형식의 이미지 범위 일관성(imageMin <= imageDefault <= imageMax)을 만족해야 한다', () => {
      for (const format of POST_FORMAT_MODULES) {
        expect(format.imageMin).toBeLessThanOrEqual(format.imageDefault);
        expect(format.imageDefault).toBeLessThanOrEqual(format.imageMax);
        expect(format.imageMin).toBeGreaterThan(0);
        expect(format.structureGuidance.length).toBeGreaterThanOrEqual(2);
        expect(format.structureGuidance.length).toBeLessThanOrEqual(4);
      }
    });

    it('5개의 반응 모듈이 정의되어 있고 id가 중복되지 않아야 한다', () => {
      expect(POST_REACTION_IDS).toHaveLength(5);
      expect(POST_REACTION_MODULES).toHaveLength(5);

      const ids = POST_REACTION_MODULES.map((m) => m.id);
      expect(new Set(ids).size).toBe(5);
      expect(ids).toEqual([...POST_REACTION_IDS]);
    });

    it('5개의 이미지 스타일 모듈이 정의되어 있고 id가 중복되지 않으며 store_photo만 source가 place여야 한다', () => {
      expect(POST_IMAGE_STYLE_IDS).toHaveLength(5);
      expect(POST_IMAGE_STYLE_MODULES).toHaveLength(5);

      const ids = POST_IMAGE_STYLE_MODULES.map((m) => m.id);
      expect(new Set(ids).size).toBe(5);
      expect(ids).toEqual([...POST_IMAGE_STYLE_IDS]);

      for (const style of POST_IMAGE_STYLE_MODULES) {
        if (style.id === 'store_photo') {
          expect(style.source).toBe('place');
        } else {
          expect(style.source).toBe('ai');
        }
        expect(style.promptHint.trim().length).toBeGreaterThan(0);
      }
    });

    it('모든 모듈 및 안내 문구에 금지 표현(할인|쿠폰|무료|최고|보장|완치) 및 크레딧/비용 표현이 포함되지 않아야 한다', () => {
      const forbiddenPattern = /할인|쿠폰|무료|최고|보장|완치|크레딧|가격|원화|\b\d+원\b/;

      const allStrings: string[] = [
        ...POST_FORMAT_MODULES.flatMap((m) => [m.label, m.summary, ...m.structureGuidance]),
        ...POST_REACTION_MODULES.flatMap((m) => [m.label, m.summary, m.ctaGuidance, ...m.closingGuidance]),
        ...POST_IMAGE_STYLE_MODULES.flatMap((m) => [m.label, m.summary, m.promptHint]),
      ];

      for (const text of allStrings) {
        expect(text).not.toMatch(forbiddenPattern);
      }
    });
  });

  describe('조회 및 보정 함수', () => {
    it('getPostFormat: 유효한 id로 조회 시 해당 모듈 반환, 잘못된 id는 undefined 반환', () => {
      expect(getPostFormat('photo_story')?.label).toBe('포토스토리');
      expect(getPostFormat('non_existent')).toBeUndefined();
    });

    it('getPostReaction: 유효한 id로 조회 시 해당 모듈 반환, 잘못된 id는 undefined 반환', () => {
      expect(getPostReaction('inquiry')?.label).toContain('문의');
      expect(getPostReaction('unknown_reaction')).toBeUndefined();
    });

    it('getPostImageStyle: 유효한 id로 조회 시 해당 모듈 반환, 잘못된 id는 undefined 반환', () => {
      expect(getPostImageStyle('bright_space')?.label).toBe('밝은 공간');
      expect(getPostImageStyle('invalid_style')).toBeUndefined();
    });

    it('clampImageCount: 포스트 형식별 min/max 범위(1~20)로 이미지 수를 보정해야 한다', () => {
      // 1·20 허용, 0·21 보정 (photo_story)
      expect(clampImageCount('photo_story', 0)).toBe(1);
      expect(clampImageCount('photo_story', 1)).toBe(1);
      expect(clampImageCount('photo_story', 12)).toBe(12);
      expect(clampImageCount('photo_story', 20)).toBe(20);
      expect(clampImageCount('photo_story', 21)).toBe(20);

      // 1·20 허용, 0·21 보정 (information)
      expect(clampImageCount('information', 0)).toBe(1);
      expect(clampImageCount('information', 1)).toBe(1);
      expect(clampImageCount('information', 4)).toBe(4);
      expect(clampImageCount('information', 20)).toBe(20);
      expect(clampImageCount('information', 21)).toBe(20);

      // 모르는 formatId일 경우 기본 범위(1~20)로 보정
      expect(clampImageCount('unknown', -1)).toBe(1);
      expect(clampImageCount('unknown', 25)).toBe(20);
    });

    it('isPhotoHeavy: photo_story, place_tour만 true를 반환해야 한다', () => {
      expect(isPhotoHeavy('photo_story')).toBe(true);
      expect(isPhotoHeavy('place_tour')).toBe(true);
      expect(isPhotoHeavy('information')).toBe(false);
      expect(isPhotoHeavy('faq')).toBe(false);
      expect(isPhotoHeavy('comparison')).toBe(false);
      expect(isPhotoHeavy('consultation')).toBe(false);
      expect(isPhotoHeavy('process')).toBe(false);
      expect(isPhotoHeavy('unknown')).toBe(false);
    });
  });

  describe('PostPlan 생성 및 해석', () => {
    it('defaultPostPlan: 기본 플랜 값을 반환해야 한다', () => {
      const def = defaultPostPlan();
      expect(def).toEqual({
        format: 'information',
        reaction: 'inquiry',
        imageStyle: 'bright_space',
        imageCount: 4,
      });
    });

    it('resolvePostPlan: 부분 객체나 빈 객체를 넘기면 기본값 및 clamp가 적용되어야 한다', () => {
      expect(resolvePostPlan({})).toEqual(defaultPostPlan());

      const partial: Partial<PostPlan> = {
        format: 'photo_story',
        reaction: 'comment',
      };
      const resolved = resolvePostPlan(partial);
      expect(resolved.format).toBe('photo_story');
      expect(resolved.reaction).toBe('comment');
      expect(resolved.imageStyle).toBe('bright_space');
      expect(resolved.imageCount).toBe(12); // photo_story default: 12

      const clamped = resolvePostPlan({
        format: 'photo_story',
        imageCount: 30,
      });
      expect(clamped.imageCount).toBe(20);

      // 경계 테스트: 0 -> 1, 21 -> 20, 1 -> 1, 20 -> 20
      expect(resolvePostPlan({ format: 'information', imageCount: 0 }).imageCount).toBe(1);
      expect(resolvePostPlan({ format: 'information', imageCount: 1 }).imageCount).toBe(1);
      expect(resolvePostPlan({ format: 'information', imageCount: 20 }).imageCount).toBe(20);
      expect(resolvePostPlan({ format: 'information', imageCount: 21 }).imageCount).toBe(20);
    });

    it('buildPlanPromptGuidance: 형식 지시문, 반응 지시문, 이미지 스타일 프롬프트 힌트를 결합하여 반환해야 한다', () => {
      const plan = resolvePostPlan({
        format: 'process',
        reaction: 'save_share',
        imageStyle: 'process_shot',
      });
      const guidance = buildPlanPromptGuidance(plan);

      expect(guidance.length).toBeGreaterThanOrEqual(4);
      // 포맷 지시문 포함 확인
      expect(guidance.some((g) => g.includes('단계별') || g.includes('과정'))).toBe(true);
      // 반응 지시문 포함 확인
      expect(guidance.some((g) => g.includes('저장') || g.includes('공유'))).toBe(true);
      // 이미지 스타일 힌트 포함 확인
      const style = getPostImageStyle('process_shot');
      expect(guidance.some((g) => g.includes(style!.promptHint))).toBe(true);

      // 금지 표현 검사
      for (const line of guidance) {
        expect(line).not.toMatch(/할인|쿠폰|무료|최고|보장|완치|크레딧|가격|원화/);
      }
    });
  });
});
