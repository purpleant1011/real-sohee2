/**
 * 채널별 규격 검사 실패(FAIL) 시 사용자에게 안내할 구체적인 해결 행동 매핑 테이블
 *
 * 규칙:
 * 1. 영문 rule id나 시스템 내부 용어(Harness, fingerprint 등)를 포함하지 않습니다.
 * 2. 사장님이 즉시 취할 수 있는 구체적인 행동 중심 한국어 문구로 작성합니다.
 * 3. 매핑 테이블에 없는 항목은 기본 해결 행동 문구를 반환합니다.
 */

export const DEFAULT_RESOLUTION_ACTION = '해당 항목의 안내를 확인하고 내용을 수정한 뒤 다시 시도해 주세요';

export const RESOLUTION_ACTIONS: Readonly<Record<string, string>> = {
  // Instagram
  'instagram-image-required': '사진을 1장 이상 추가해 주세요',
  'instagram-carousel-max': '사진을 10장 이하로 줄여 주세요',
  'instagram-caption-length': '캡션을 2,200자 이하로 줄여 주세요',
  'instagram-image-format': '이미지를 JPG(JPEG) 형식으로 다시 올려 주세요',
  'instagram-hashtag-count': '해시태그를 30개 이하로 줄여 주세요',
  'instagram-caption-fold': '캡션 핵심 내용을 앞부분(125자 이내)에 작성해 주세요',

  // Threads
  'threads-text-length': '본문을 500자 이하로 줄여 주세요',
  'threads-carousel-items': '캐러셀 사진을 2장 이상 20장 이하로 맞춰 주세요',
  'threads-image-format': '이미지를 JPG 또는 PNG 형식으로 올려 주세요',
  'threads-image-size': '이미지 파일 용량을 8MB 이하로 줄여 주세요',

  // Naver Blog
  'naver-blog-title-required': '제목을 입력해 주세요',
  'naver-blog-image-required': '사진을 1장 이상 추가해 주세요',
  'naver-blog-title-length': '제목을 100자 이하로 줄여 주세요',
  'naver-blog-content-length': '본문 글자 수를 권장 기준에 맞게 줄여 주세요',
  'naver-blog-image-count': '사진을 50장 이하로 줄여 주세요',

  // Daangn
  'daangn-images-count': '사진을 20장 이하로 줄여 주세요',
  'daangn-gallery-display': '피드에 우선 노출할 대표 사진을 앞쪽 10장으로 배치해 주세요',
  'daangn-video-count': '동영상을 1개 이하로 줄여 주세요',
  'daangn-text-length': '본문을 2,000자 이하로 줄여 주세요',
};

/**
 * 주어진 검사 규칙 식별자(ruleId)에 대응하는 권장 해결 행동을 반환합니다.
 * 매핑 테이블에 없으면 일반 안내 문구를 반환합니다.
 */
export function getResolutionAction(ruleId: string): string {
  return RESOLUTION_ACTIONS[ruleId] ?? DEFAULT_RESOLUTION_ACTION;
}
