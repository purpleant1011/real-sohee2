import type { BaseRuleSpec, SpecConfig } from './types';

export const CURRENT_SPEC_VERSION = '2026.10.1';

export const SPEC_RULES_METADATA: Record<string, BaseRuleSpec> = {
  // Instagram
  'instagram-image-required': {
    id: 'instagram-image-required',
    label: '피드 게시물 이미지 최소 1장 필수',
    evidence: 'OFFICIAL_DOC',
    sourceUrl: 'https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/content-publishing',
    verifiedAt: '2026-10',
    description: '인스타그램 Content Publishing API 피드 게시물은 최소 1장의 이미지가 필수입니다.',
  },
  'instagram-caption-length': {
    id: 'instagram-caption-length',
    label: '캡션 최대 글자 수',
    evidence: 'OFFICIAL_DOC',
    sourceUrl: 'https://developers.facebook.com/docs/instagram-api/reference/ig-user/media',
    verifiedAt: '2026-10',
    description: '인스타그램 Graph API 단일/캐러셀 컨테이너 캡션 제한 (최대 2,200자)',
  },
  'instagram-carousel-max': {
    id: 'instagram-carousel-max',
    label: '캐러셀 최대 이미지 장수',
    evidence: 'OFFICIAL_DOC',
    sourceUrl: 'https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/content-publishing',
    verifiedAt: '2026-10',
    description: '인스타그램 Content Publishing API 캐러셀 제한 (최대 10개 항목)',
  },
  'instagram-image-format': {
    id: 'instagram-image-format',
    label: '이미지 업로드 파일 형식',
    evidence: 'OFFICIAL_DOC',
    sourceUrl: 'https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/content-publishing',
    verifiedAt: '2026-10',
    description: '인스타그램 Content Publishing API 지원 이미지 형식 (JPEG 전용)',
  },
  'instagram-hashtag-count': {
    id: 'instagram-hashtag-count',
    label: '최대 해시태그 수',
    evidence: 'OFFICIAL_DOC',
    sourceUrl: 'https://developers.facebook.com/docs/instagram-api/reference/ig-user/media',
    verifiedAt: '2026-10',
    description: '인스타그램 미디어 컨테이너 해시태그 제한 (최대 30개)',
  },
  'instagram-caption-fold': {
    id: 'instagram-caption-fold',
    label: '캡션 더 보기 접힘 안내',
    evidence: 'UNVERIFIED',
    sourceUrl: 'https://help.instagram.com',
    verifiedAt: '2026-10',
    description: '인스타그램 피드 미리보기 시 약 125자 이후 텍스트가 접히는 경험적 기준',
  },

  // Threads
  'threads-text-length': {
    id: 'threads-text-length',
    label: '포스트 본문 최대 글자 수',
    evidence: 'OFFICIAL_DOC',
    sourceUrl: 'https://developers.facebook.com/docs/threads/posts',
    verifiedAt: '2026-10',
    description: '스레드 API 텍스트 포스트 제한 (최대 500자, 이모지는 UTF-8 바이트 단위 환산)',
  },
  'threads-carousel-items': {
    id: 'threads-carousel-items',
    label: '캐러셀 항목 수',
    evidence: 'OFFICIAL_DOC',
    sourceUrl: 'https://developers.facebook.com/docs/threads/posts',
    verifiedAt: '2026-10',
    description: '스레드 API 캐러셀 포스트 제한 (최소 2개, 최대 20개 항목)',
  },
  'threads-image-format': {
    id: 'threads-image-format',
    label: '이미지 파일 형식',
    evidence: 'OFFICIAL_DOC',
    sourceUrl: 'https://developers.facebook.com/docs/threads/posts',
    verifiedAt: '2026-10',
    description: '스레드 API 지원 이미지 포맷 (JPEG, PNG)',
  },
  'threads-image-size': {
    id: 'threads-image-size',
    label: '이미지 최대 파일 용량',
    evidence: 'OFFICIAL_DOC',
    sourceUrl: 'https://developers.facebook.com/docs/threads/posts',
    verifiedAt: '2026-10',
    description: '스레드 API 지원 이미지 파일 크기 (최대 8MB)',
  },

  // Naver Blog
  'naver-blog-title-required': {
    id: 'naver-blog-title-required',
    label: '블로그 포스트 제목 필수',
    evidence: 'CONFIG',
    sourceUrl: 'https://sohee.ai/policy/naver-blog-standard',
    verifiedAt: '2026-10',
    description: '소희 자체 발행 규칙: 네이버 블로그는 제목 입력이 필수입니다.',
  },
  'naver-blog-image-required': {
    id: 'naver-blog-image-required',
    label: '블로그 포스트 이미지 최소 1장 필수',
    evidence: 'CONFIG',
    sourceUrl: 'https://sohee.ai/policy/naver-blog-standard',
    verifiedAt: '2026-10',
    description: '소희 자체 발행 규칙: 네이버 블로그는 대표/본문 이미지 1장 이상이 필수입니다.',
  },
  'naver-blog-title-length': {
    id: 'naver-blog-title-length',
    label: '블로그 권장 제목 글자 수',
    evidence: 'UNVERIFIED',
    sourceUrl: 'https://section.blog.naver.com',
    verifiedAt: '2026-10',
    description: '네이버 블로그 에디터 권장 제목 길이 (최대 100자 - 2차 출처, 공식 API 2020 종료)',
  },
  'naver-blog-content-length': {
    id: 'naver-blog-content-length',
    label: '블로그 권장 본문 글자 수',
    evidence: 'UNVERIFIED',
    sourceUrl: 'https://section.blog.naver.com',
    verifiedAt: '2026-10',
    description: '네이버 블로그 에디터 권장 본문 길이 (최대 20,000자 - 2차 출처)',
  },
  'naver-blog-image-count': {
    id: 'naver-blog-image-count',
    label: '블로그 권장 최대 이미지 장수',
    evidence: 'UNVERIFIED',
    sourceUrl: 'https://section.blog.naver.com',
    verifiedAt: '2026-10',
    description: '네이버 블로그 에디터 1회 권장 첨부 장수 (최대 50장 - 2차 출처)',
  },

  // Daangn
  'daangn-images-count': {
    id: 'daangn-images-count',
    label: '비즈프로필 소식 사진 최대 장수',
    evidence: 'UNVERIFIED',
    sourceUrl: 'https://business.daangn.com',
    verifiedAt: '2026-10',
    description: '당근 비즈프로필 소식 사진 등록 권장 장수 (최대 20장 - 2차 출처 가이드)',
  },
  'daangn-gallery-display': {
    id: 'daangn-gallery-display',
    label: '비즈프로필 소식 갤러리 노출 장수 안내',
    evidence: 'UNVERIFIED',
    sourceUrl: 'https://business.daangn.com',
    verifiedAt: '2026-10',
    description: '당근 비즈프로필 소식 목록 피드에서 갤러리로 최대 10장까지 우선 노출되는 경험적 안내',
  },
  'daangn-video-count': {
    id: 'daangn-video-count',
    label: '비즈프로필 소식 동영상 최대 개수',
    evidence: 'UNVERIFIED',
    sourceUrl: 'https://business.daangn.com',
    verifiedAt: '2026-10',
    description: '당근 비즈프로필 소식 동영상 첨부 권장 개수 (최대 1개 - 2차 출처 가이드)',
  },
  'daangn-text-length': {
    id: 'daangn-text-length',
    label: '비즈프로필 소식 권장 본문 길이',
    evidence: 'UNVERIFIED',
    sourceUrl: 'https://business.daangn.com',
    verifiedAt: '2026-10',
    description: '당근 비즈프로필 소식 권장 본문 글자 수 (최대 2,000자 - 2차 출처)',
  },
};

export const currentSpec: SpecConfig = {
  specVersion: CURRENT_SPEC_VERSION,
  rulesMetadata: SPEC_RULES_METADATA,
  instagram: {
    requireImage: true,
    maxCarouselItems: 10,
    allowedImageFormats: ['jpeg', 'jpg', 'image/jpeg'],
    maxCaptionLength: 2200,
    maxHashtags: 30,
    captionFoldThreshold: 125,
    lengthMeasurement: 'codepoint',
  },
  threads: {
    maxTextLength: 500,
    minCarouselItems: 2,
    maxCarouselItems: 20,
    allowedImageFormats: ['jpeg', 'jpg', 'png', 'image/jpeg', 'image/png'],
    maxImageFileSizeBytes: 8 * 1024 * 1024, // 8MB
    lengthMeasurement: 'threads_hybrid',
  },
  naver_blog: {
    requireTitle: true,
    requireImage: true,
    recommendedTitleMaxLength: 100,
    recommendedContentMaxLength: 20000,
    recommendedMaxImages: 50,
    recommendedMaxImageFileSizeBytes: 20 * 1024 * 1024, // 20MB
    lengthMeasurement: 'grapheme',
  },
  daangn: {
    maxImages: 20,
    galleryDisplayImages: 10,
    maxVideos: 1,
    recommendedMaxTextLength: 2000,
    lengthMeasurement: 'grapheme',
  },
};
