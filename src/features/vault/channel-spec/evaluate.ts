import { countLength } from './character-counter';
import { currentSpec, SPEC_RULES_METADATA } from './spec-table';
import type {
  ChannelType,
  ChannelVariantPayload,
  CheckStatus,
  EvidenceType,
  MediaItem,
  SpecCheckResult,
  SpecConfig,
  SpecEvaluationResult,
} from './types';

/**
 * 미디어 필수 규격 검사 ID의 공통 접미사
 */
export const IMAGE_REQUIRED_RULE_SUFFIX = '-image-required';

/**
 * 주어진 검사 ID가 미디어 존재 여부 검사(예: *-image-required)인지 판별
 */
export function isMediaRequirementCheck(checkId: string): boolean {
  return checkId.endsWith(IMAGE_REQUIRED_RULE_SUFFIX);
}

/**
 * 텍스트에서 해시태그 파싱 (#으로 시작하고 공백/특수문자 전까지)
 */
function extractHashtags(text: string): string[] {
  if (!text) return [];
  const matches = text.match(/#[^\s#]+/g);
  return matches ? matches.map((tag) => tag.replace(/^#/, '')) : [];
}

/**
 * 이미지 포맷 표준화 (jpg -> jpeg, image/jpeg -> jpeg)
 */
function normalizeFormat(formatOrMime?: string): string {
  if (!formatOrMime) return '';
  const lower = formatOrMime.toLowerCase().trim();
  if (lower.startsWith('image/')) {
    const sub = lower.replace('image/', '');
    return sub === 'jpg' ? 'jpeg' : sub;
  }
  return lower === 'jpg' ? 'jpeg' : lower;
}

function buildCheckResult(
  ruleId: string,
  status: CheckStatus,
  detail: string,
  userMessage: string,
  spec: SpecConfig,
  overrideEvidence?: EvidenceType
): SpecCheckResult {
  const meta = spec.rulesMetadata[ruleId] ?? SPEC_RULES_METADATA[ruleId];
  return {
    id: ruleId,
    label: meta?.label ?? ruleId,
    status,
    evidence: overrideEvidence ?? meta?.evidence ?? 'UNVERIFIED',
    detail,
    userMessage,
  };
}

function evaluateInstagram(variant: ChannelVariantPayload, spec: SpecConfig): SpecCheckResult[] {
  const checks: SpecCheckResult[] = [];
  const config = spec.instagram;

  const captionText = variant.caption ?? variant.text ?? '';
  const mediaItems = variant.media ?? [];
  const imageItems = mediaItems.filter((m) => m.type === 'image');

  // 1. 피드 게시물 필수 이미지 최소 1장 (OFFICIAL_DOC)
  if (config.requireImage && imageItems.length === 0) {
    checks.push(
      buildCheckResult(
        'instagram-image-required',
        'FAIL',
        '첨부된 이미지가 0개임',
        '인스타그램 게시를 위해 이미지가 최소 1장 이상 필요해요.',
        spec,
        'OFFICIAL_DOC'
      )
    );
  } else {
    checks.push(
      buildCheckResult(
        'instagram-image-required',
        'PASS',
        `첨부된 이미지 ${imageItems.length}장`,
        '인스타그램 필수 이미지가 준비되었어요.',
        spec,
        'OFFICIAL_DOC'
      )
    );
  }

  // 2. 캐러셀 최대 장수 (OFFICIAL_DOC)
  const totalMediaCount = mediaItems.length;
  if (totalMediaCount > config.maxCarouselItems) {
    checks.push(
      buildCheckResult(
        'instagram-carousel-max',
        'FAIL',
        `미디어 항목 수: ${totalMediaCount}개 (최대 허용: ${config.maxCarouselItems}개)`,
        `인스타그램 캐러셀은 최대 ${config.maxCarouselItems}장까지 등록할 수 있어요. 현재 ${totalMediaCount}장이 등록되어 수정이 필요해요.`,
        spec
      )
    );
  } else {
    checks.push(
      buildCheckResult(
        'instagram-carousel-max',
        'PASS',
        `미디어 항목 수: ${totalMediaCount}개 (최대 허용: ${config.maxCarouselItems}개)`,
        `캐러셀 이미지 수가 인스타그램 규격(${config.maxCarouselItems}장 이하)을 만족해요.`,
        spec
      )
    );
  }

  // 2. 이미지 포맷 (OFFICIAL_DOC)
  if (imageItems.length === 0) {
    // 이미지가 없으면 포맷 체크 통과 (단일 텍스트 또는 비디오)
    checks.push(
      buildCheckResult(
        'instagram-image-format',
        'PASS',
        '검사할 이미지 항목 없음',
        '이미지 파일 형식이 올바릅니다.',
        spec
      )
    );
  } else {
    const allowed = config.allowedImageFormats.map(normalizeFormat);
    const unverifiedItems: MediaItem[] = [];
    const invalidItems: MediaItem[] = [];

    for (const img of imageItems) {
      const norm = normalizeFormat(img.format || img.mimeType);
      if (!norm) {
        unverifiedItems.push(img);
      } else if (!allowed.includes(norm)) {
        invalidItems.push(img);
      }
    }

    if (invalidItems.length > 0) {
      checks.push(
        buildCheckResult(
          'instagram-image-format',
          'FAIL',
          `지원하지 않는 이미지 형식 포함: ${invalidItems.map((i) => i.format || i.mimeType).join(', ')}`,
          '인스타그램 API는 JPEG(JPG) 형식의 이미지만 지원해요. 다른 형식의 이미지가 포함되어 있어 변경이 필요해요.',
          spec
        )
      );
    } else if (unverifiedItems.length > 0) {
      checks.push(
        buildCheckResult(
          'instagram-image-format',
          'UNKNOWN',
          `포맷 미확인 이미지 ${unverifiedItems.length}개`,
          '일부 이미지의 파일 형식을 확인할 수 없어 게시 전 확인이 필요해요.',
          spec
        )
      );
    } else {
      checks.push(
        buildCheckResult(
          'instagram-image-format',
          'PASS',
          '모든 이미지가 JPEG 규격 충족',
          '모든 이미지가 인스타그램에서 지원하는 JPEG 형식이에요.',
          spec
        )
      );
    }
  }

  // 3. 캡션 최대 글자 수 (OFFICIAL_DOC)
  const captionLength = countLength(captionText, config.lengthMeasurement);
  if (captionLength > config.maxCaptionLength) {
    checks.push(
      buildCheckResult(
        'instagram-caption-length',
        'FAIL',
        `캡션 길이: ${captionLength}자 (최대 허용: ${config.maxCaptionLength}자)`,
        `인스타그램 캡션은 최대 ${config.maxCaptionLength.toLocaleString()}자까지 입력할 수 있어요. 현재 ${captionLength.toLocaleString()}자로 초과했어요.`,
        spec
      )
    );
  } else {
    checks.push(
      buildCheckResult(
        'instagram-caption-length',
        'PASS',
        `캡션 길이: ${captionLength}자 (최대 허용: ${config.maxCaptionLength}자)`,
        `캡션 글자 수가 제한(${config.maxCaptionLength.toLocaleString()}자) 이내예요.`,
        spec
      )
    );
  }

  // 4. 해시태그 수 (OFFICIAL_DOC)
  const hashtags =
    variant.hashtags && variant.hashtags.length > 0
      ? variant.hashtags
      : extractHashtags(captionText);
  if (hashtags.length > config.maxHashtags) {
    checks.push(
      buildCheckResult(
        'instagram-hashtag-count',
        'FAIL',
        `해시태그 수: ${hashtags.length}개 (최대 허용: ${config.maxHashtags}개)`,
        `인스타그램 해시태그는 최대 ${config.maxHashtags}개까지 등록할 수 있어요. 현재 ${hashtags.length}개로 초과했어요.`,
        spec
      )
    );
  } else {
    checks.push(
      buildCheckResult(
        'instagram-hashtag-count',
        'PASS',
        `해시태그 수: ${hashtags.length}개 (최대 허용: ${config.maxHashtags}개)`,
        `해시태그 개수가 규격(${config.maxHashtags}개 이하)에 맞아요.`,
        spec
      )
    );
  }

  // 5. 캡션 접힘 임계값 (UNVERIFIED)
  if (captionLength > config.captionFoldThreshold) {
    checks.push(
      buildCheckResult(
        'instagram-caption-fold',
        'WARN',
        `캡션 길이: ${captionLength}자 (접힘 임계값: ${config.captionFoldThreshold}자)`,
        `캡션이 ${captionLength}자로 피드에서 '더 보기'로 접힐 수 있어 중요 문구는 앞부분에 배치되었는지 확인이 필요해요.`,
        spec
      )
    );
  } else {
    checks.push(
      buildCheckResult(
        'instagram-caption-fold',
        'PASS',
        `캡션 길이: ${captionLength}자 (접힘 임계값: ${config.captionFoldThreshold}자)`,
        `캡션이 한눈에 보이는 최적의 길이에요.`,
        spec
      )
    );
  }

  return checks;
}

function evaluateThreads(variant: ChannelVariantPayload, spec: SpecConfig): SpecCheckResult[] {
  const checks: SpecCheckResult[] = [];
  const config = spec.threads;

  const bodyText = variant.text ?? variant.caption ?? '';
  const mediaItems = variant.media ?? [];
  const imageItems = mediaItems.filter((m) => m.type === 'image');

  // 1. 포스트 본문 글자 수 (OFFICIAL_DOC)
  const textLength = countLength(bodyText, config.lengthMeasurement);
  if (textLength > config.maxTextLength) {
    checks.push(
      buildCheckResult(
        'threads-text-length',
        'FAIL',
        `본문 길이: ${textLength}자 (최대 허용: ${config.maxTextLength}자, 이모지 UTF-8 바이트 단위 포함)`,
        `스레드 본문은 최대 ${config.maxTextLength}자까지 작성할 수 있어요. 현재 ${textLength}자로 초과했어요.`,
        spec
      )
    );
  } else {
    checks.push(
      buildCheckResult(
        'threads-text-length',
        'PASS',
        `본문 길이: ${textLength}자 (최대 허용: ${config.maxTextLength}자)`,
        `스레드 본문 글자 수가 규격(${config.maxTextLength}자 이하)을 만족해요.`,
        spec
      )
    );
  }

  // 2. 캐러셀 항목 수 (2~20개, 단 0개 또는 1개는 단일 포스트) (OFFICIAL_DOC)
  const mediaCount = mediaItems.length;
  if (mediaCount > config.maxCarouselItems) {
    checks.push(
      buildCheckResult(
        'threads-carousel-items',
        'FAIL',
        `미디어 항목 수: ${mediaCount}개 (최대 허용: ${config.maxCarouselItems}개)`,
        `스레드 캐러셀은 최대 ${config.maxCarouselItems}개까지 첨부할 수 있어요. 현재 ${mediaCount}개로 초과했어요.`,
        spec
      )
    );
  } else {
    checks.push(
      buildCheckResult(
        'threads-carousel-items',
        'PASS',
        `미디어 항목 수: ${mediaCount}개 (허용: 0~${config.maxCarouselItems}개)`,
        `미디어 첨부 수량이 규격에 맞아요.`,
        spec
      )
    );
  }

  // 3. 이미지 파일 형식 (JPEG, PNG) (OFFICIAL_DOC)
  if (imageItems.length === 0) {
    checks.push(
      buildCheckResult(
        'threads-image-format',
        'PASS',
        '검사할 이미지 항목 없음',
        '이미지 파일 형식이 올바릅니다.',
        spec
      )
    );
  } else {
    const allowed = config.allowedImageFormats.map(normalizeFormat);
    const unverifiedItems: MediaItem[] = [];
    const invalidItems: MediaItem[] = [];

    for (const img of imageItems) {
      const norm = normalizeFormat(img.format || img.mimeType);
      if (!norm) {
        unverifiedItems.push(img);
      } else if (!allowed.includes(norm)) {
        invalidItems.push(img);
      }
    }

    if (invalidItems.length > 0) {
      checks.push(
        buildCheckResult(
          'threads-image-format',
          'FAIL',
          `지원하지 않는 이미지 포맷: ${invalidItems.map((i) => i.format || i.mimeType).join(', ')}`,
          '스레드는 JPEG 및 PNG 형식의 이미지만 지원해요. 다른 형식의 이미지가 포함되어 있어 변경이 필요해요.',
          spec
        )
      );
    } else if (unverifiedItems.length > 0) {
      checks.push(
        buildCheckResult(
          'threads-image-format',
          'UNKNOWN',
          `형식 미확인 이미지 ${unverifiedItems.length}개`,
          '일부 이미지의 파일 형식을 확인할 수 없어 업로드 전 확인이 필요해요.',
          spec
        )
      );
    } else {
      checks.push(
        buildCheckResult(
          'threads-image-format',
          'PASS',
          '모든 이미지가 JPEG 또는 PNG 포맷 충족',
          '모든 이미지가 스레드 지원 형식(JPEG/PNG)이에요.',
          spec
        )
      );
    }
  }

  // 4. 이미지 파일 크기 (최대 8MB) (OFFICIAL_DOC)
  if (imageItems.length === 0) {
    checks.push(
      buildCheckResult(
        'threads-image-size',
        'PASS',
        '검사할 이미지 항목 없음',
        '이미지 용량 규격을 만족해요.',
        spec
      )
    );
  } else {
    const unverifiedSizes: MediaItem[] = [];
    const oversizedItems: MediaItem[] = [];

    for (const img of imageItems) {
      if (typeof img.fileSizeBytes !== 'number') {
        unverifiedSizes.push(img);
      } else if (img.fileSizeBytes > config.maxImageFileSizeBytes) {
        oversizedItems.push(img);
      }
    }

    if (oversizedItems.length > 0) {
      const maxMb = (config.maxImageFileSizeBytes / (1024 * 1024)).toFixed(0);
      checks.push(
        buildCheckResult(
          'threads-image-size',
          'FAIL',
          `초과된 이미지 크기: ${oversizedItems.map((i) => `${((i.fileSizeBytes ?? 0) / (1024 * 1024)).toFixed(1)}MB`).join(', ')}`,
          `스레드 이미지는 파일당 최대 ${maxMb}MB까지 업로드할 수 있어요. 용량을 초과한 이미지가 있어 압축이 필요해요.`,
          spec
        )
      );
    } else if (unverifiedSizes.length > 0) {
      checks.push(
        buildCheckResult(
          'threads-image-size',
          'UNKNOWN',
          `파일 크기 미확인 이미지 ${unverifiedSizes.length}개`,
          '일부 이미지의 용량을 확인할 수 없어 업로드 전 확인이 필요해요.',
          spec
        )
      );
    } else {
      checks.push(
        buildCheckResult(
          'threads-image-size',
          'PASS',
          '모든 이미지가 8MB 이하',
          '모든 이미지가 스레드 파일 크기 제한(8MB 이하)을 만족해요.',
          spec
        )
      );
    }
  }

  return checks;
}

function evaluateNaverBlog(variant: ChannelVariantPayload, spec: SpecConfig): SpecCheckResult[] {
  const checks: SpecCheckResult[] = [];
  const config = spec.naver_blog;

  const title = (variant.title ?? '').trim();
  const bodyText = variant.text ?? variant.caption ?? '';
  const mediaItems = variant.media ?? [];
  const imageItems = mediaItems.filter((m) => m.type === 'image');

  // 1. 블로그 제목 필수 (CONFIG)
  if (config.requireTitle && title.length === 0) {
    checks.push(
      buildCheckResult(
        'naver-blog-title-required',
        'FAIL',
        '블로그 제목이 비어 있음',
        '네이버 블로그는 제목 입력이 필수예요. 제목을 작성해 주세요.',
        spec,
        'CONFIG'
      )
    );
  } else {
    checks.push(
      buildCheckResult(
        'naver-blog-title-required',
        'PASS',
        `블로그 제목 입력됨 (${title.length}자)`,
        '블로그 제목이 정상적으로 입력되었어요.',
        spec,
        'CONFIG'
      )
    );
  }

  // 2. 대표/본문 이미지 최소 1장 필수 (CONFIG)
  if (config.requireImage && imageItems.length === 0) {
    checks.push(
      buildCheckResult(
        'naver-blog-image-required',
        'FAIL',
        '첨부된 이미지가 0개임',
        '네이버 블로그 발행을 위해 대표 이미지가 최소 1장 이상 필요해요.',
        spec,
        'CONFIG'
      )
    );
  } else {
    checks.push(
      buildCheckResult(
        'naver-blog-image-required',
        'PASS',
        `첨부된 이미지 ${imageItems.length}장`,
        '블로그 필수 이미지가 준비되었어요.',
        spec,
        'CONFIG'
      )
    );
  }

  // 3. 권장 제목 길이 (100자) (UNVERIFIED - 2차 출처)
  const titleLength = countLength(title, config.lengthMeasurement);
  if (titleLength > config.recommendedTitleMaxLength) {
    checks.push(
      buildCheckResult(
        'naver-blog-title-length',
        'WARN',
        `제목 길이: ${titleLength}자 (권장: ${config.recommendedTitleMaxLength}자)`,
        `제목이 ${titleLength}자로 권장 글자 수(${config.recommendedTitleMaxLength}자)를 초과해 에디터에서 잘릴 수 있으니 확인이 필요해요.`,
        spec,
        'UNVERIFIED'
      )
    );
  } else {
    checks.push(
      buildCheckResult(
        'naver-blog-title-length',
        'PASS',
        `제목 길이: ${titleLength}자 (권장: ${config.recommendedTitleMaxLength}자)`,
        '블로그 제목 길이가 권장 범위 이내예요.',
        spec,
        'UNVERIFIED'
      )
    );
  }

  // 4. 권장 본문 길이 (20,000자) (UNVERIFIED - 2차 출처)
  const contentLength = countLength(bodyText, config.lengthMeasurement);
  if (contentLength > config.recommendedContentMaxLength) {
    checks.push(
      buildCheckResult(
        'naver-blog-content-length',
        'WARN',
        `본문 길이: ${contentLength}자 (권장: ${config.recommendedContentMaxLength}자)`,
        `본문이 ${contentLength.toLocaleString()}자로 권장 길이(${config.recommendedContentMaxLength.toLocaleString()}자)를 초과해 에디터 입력 시 확인이 필요해요.`,
        spec,
        'UNVERIFIED'
      )
    );
  } else {
    checks.push(
      buildCheckResult(
        'naver-blog-content-length',
        'PASS',
        `본문 길이: ${contentLength}자 (권장: ${config.recommendedContentMaxLength}자)`,
        '블로그 본문 길이가 적절해요.',
        spec,
        'UNVERIFIED'
      )
    );
  }

  // 5. 권장 이미지 장수 (50장) (UNVERIFIED - 2차 출처)
  if (imageItems.length > config.recommendedMaxImages) {
    checks.push(
      buildCheckResult(
        'naver-blog-image-count',
        'WARN',
        `이미지 장수: ${imageItems.length}장 (권장: ${config.recommendedMaxImages}장)`,
        `첨부된 이미지가 ${imageItems.length}장으로 1회 권장 업로드 장수(${config.recommendedMaxImages}장)를 초과해 확인이 필요해요.`,
        spec,
        'UNVERIFIED'
      )
    );
  } else {
    checks.push(
      buildCheckResult(
        'naver-blog-image-count',
        'PASS',
        `이미지 장수: ${imageItems.length}장 (권장: ${config.recommendedMaxImages}장)`,
        '이미지 첨부 수량이 권장 범위 이내예요.',
        spec,
        'UNVERIFIED'
      )
    );
  }

  return checks;
}

function evaluateDaangn(variant: ChannelVariantPayload, spec: SpecConfig): SpecCheckResult[] {
  const checks: SpecCheckResult[] = [];
  const config = spec.daangn;

  const mediaItems = variant.media ?? [];
  const imageItems = mediaItems.filter((m) => m.type === 'image');
  const videoItems = mediaItems.filter((m) => m.type === 'video');
  const videoCount = variant.videoCount ?? videoItems.length;

  // 1. 사진 최대 20장 (UNVERIFIED - 2차 출처)
  if (imageItems.length > config.maxImages) {
    checks.push(
      buildCheckResult(
        'daangn-images-count',
        'WARN',
        `사진 장수: ${imageItems.length}장 (권장 최대: ${config.maxImages}장)`,
        `사진이 ${imageItems.length}장으로 당근 비즈프로필 권장 장수(최대 ${config.maxImages}장)를 초과해 실제 게시 시 확인이 필요해요.`,
        spec,
        'UNVERIFIED'
      )
    );
  } else {
    checks.push(
      buildCheckResult(
        'daangn-images-count',
        'PASS',
        `사진 장수: ${imageItems.length}장 (권장 최대: ${config.maxImages}장)`,
        '사진 첨부 장수가 권장 범위 이내예요.',
        spec,
        'UNVERIFIED'
      )
    );
  }

  // 2. 갤러리 피드 노출 10장 안내 (UNVERIFIED)
  if (imageItems.length > config.galleryDisplayImages) {
    checks.push(
      buildCheckResult(
        'daangn-gallery-display',
        'WARN',
        `사진 장수: ${imageItems.length}장 (갤러리 노출: 앞 10장)`,
        `사진이 ${imageItems.length}장으로 피드 갤러리에서는 앞의 ${config.galleryDisplayImages}장만 우선 노출되므로 사진 순서 확인이 필요해요.`,
        spec,
        'UNVERIFIED'
      )
    );
  } else {
    checks.push(
      buildCheckResult(
        'daangn-gallery-display',
        'PASS',
        `사진 장수: ${imageItems.length}장 (갤러리 노출 이내)`,
        '등록한 모든 사진이 갤러리에 온전히 노출돼요.',
        spec,
        'UNVERIFIED'
      )
    );
  }

  // 3. 동영상 최대 1개 (UNVERIFIED - 2차 출처)
  if (videoCount > config.maxVideos) {
    checks.push(
      buildCheckResult(
        'daangn-video-count',
        'WARN',
        `동영상 개수: ${videoCount}개 (권장 최대: ${config.maxVideos}개)`,
        `동영상이 ${videoCount}개로 당근 비즈프로필 소식 권장 수량(최대 ${config.maxVideos}개)을 초과해 게시 전 확인이 필요해요.`,
        spec,
        'UNVERIFIED'
      )
    );
  } else {
    checks.push(
      buildCheckResult(
        'daangn-video-count',
        'PASS',
        `동영상 개수: ${videoCount}개 (권장 최대: ${config.maxVideos}개)`,
        '동영상 첨부 수량이 권장 범위 이내예요.',
        spec,
        'UNVERIFIED'
      )
    );
  }

  // 4. 본문 권장 길이 (UNVERIFIED)
  const bodyText = variant.text ?? variant.caption ?? '';
  const textLength = countLength(bodyText, config.lengthMeasurement);
  if (textLength > config.recommendedMaxTextLength) {
    checks.push(
      buildCheckResult(
        'daangn-text-length',
        'WARN',
        `본문 길이: ${textLength}자 (권장: ${config.recommendedMaxTextLength}자)`,
        `본문이 ${textLength}자로 당근 비즈프로필 권장 글자 수(${config.recommendedMaxTextLength}자)를 초과해 에디터 입력 시 확인이 필요해요.`,
        spec,
        'UNVERIFIED'
      )
    );
  } else {
    checks.push(
      buildCheckResult(
        'daangn-text-length',
        'PASS',
        `본문 길이: ${textLength}자 (권장: ${config.recommendedMaxTextLength}자)`,
        '본문 글자 수가 적절해요.',
        spec,
        'UNVERIFIED'
      )
    );
  }

  return checks;
}

/**
 * 4채널(Instagram, Threads, Naver Blog, Daangn) 규격 검사를 수행하는 순수 함수
 *
 * 불변식:
 * 1. 외부 호출/네트워크/외부 provider import 0 (완전 순수 함수)
 * 2. blocksVault = checks.some(c => c.status === 'FAIL') (FAIL만 보관을 차단)
 * 3. UNKNOWN / UNVERIFIED / WARN은 보관을 차단하지 않음
 * 4. userMessage에는 영문 상태 코드/내부 식별자가 노출되지 않는 친절한 한국어 안내문 제공
 */
export function evaluateChannelSpec(
  channel: ChannelType,
  variant: ChannelVariantPayload,
  spec: SpecConfig = currentSpec
): SpecEvaluationResult {
  let checks: SpecCheckResult[] = [];

  switch (channel) {
    case 'instagram':
      checks = evaluateInstagram(variant, spec);
      break;
    case 'threads':
      checks = evaluateThreads(variant, spec);
      break;
    case 'naver_blog':
      checks = evaluateNaverBlog(variant, spec);
      break;
    case 'daangn_business':
      checks = evaluateDaangn(variant, spec);
      break;
    default: {
      const exhaustiveCheck: never = channel;
      throw new Error(`지원하지 않는 채널입니다: ${exhaustiveCheck}`);
    }
  }

  // FAIL 상태가 하나라도 있으면 보관함 저장을 차단(blocksVault = true)
  const blocksVault = checks.some((c) => c.status === 'FAIL');

  return {
    specVersion: spec.specVersion,
    checks,
    blocksVault,
  };
}
