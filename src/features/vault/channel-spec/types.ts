export type ChannelType = 'instagram' | 'threads' | 'naver_blog' | 'daangn_business';

export type CheckStatus = 'PASS' | 'WARN' | 'FAIL' | 'UNKNOWN';

export type EvidenceType = 'OFFICIAL_DOC' | 'CONFIG' | 'UNVERIFIED';

export type LengthMeasurementType =
  | 'grapheme' // 사용자 인지 기준 시각적 1글자 (Intl.Segmenter 기준, 복합 이모지/ZWJ/결합문자 1자)
  | 'codepoint' // 유니코드 코드포인트 기준 (Array.from / [...str].length)
  | 'utf16_code_units' // JS 기본 string.length (서로게이트 페어 2)
  | 'utf8_bytes' // UTF-8 바이트 크기 (TextEncoder)
  | 'threads_hybrid'; // 스레드 공식 API: 일반 문자 1자(코드포인트) + 이모지는 UTF-8 바이트 수

export interface MediaItem {
  id?: string;
  type: 'image' | 'video';
  format?: string; // 예: 'jpeg', 'png', 'webp', 'mp4'
  mimeType?: string; // 예: 'image/jpeg', 'image/png'
  fileSizeBytes?: number;
  width?: number;
  height?: number;
  durationSeconds?: number;
}

export interface ChannelVariantPayload {
  title?: string;
  text?: string;
  caption?: string; // Instagram 호환 (text 또는 caption 사용)
  media?: MediaItem[];
  hashtags?: string[];
  videoCount?: number;
}

export interface SpecCheckResult {
  id: string;
  label: string;
  status: CheckStatus;
  evidence: EvidenceType;
  detail: string;
  userMessage: string;
}

export type ChannelSpecCheck = SpecCheckResult;

export interface SpecEvaluationResult {
  specVersion: string;
  checks: SpecCheckResult[];
  blocksVault: boolean;
}

export interface BaseRuleSpec {
  id: string;
  label: string;
  evidence: EvidenceType;
  sourceUrl?: string;
  verifiedAt: string; // YYYY-MM
  description: string;
}

export interface InstagramSpecConfig {
  requireImage: boolean; // true (OFFICIAL_DOC)
  maxCarouselItems: number; // 10 (OFFICIAL_DOC)
  allowedImageFormats: string[]; // ['jpeg', 'jpg', 'image/jpeg'] (OFFICIAL_DOC)
  maxCaptionLength: number; // 2200 (OFFICIAL_DOC)
  maxHashtags: number; // 30 (OFFICIAL_DOC)
  captionFoldThreshold: number; // 125 (UNVERIFIED)
  lengthMeasurement: LengthMeasurementType;
}

export interface ThreadsSpecConfig {
  maxTextLength: number; // 500 (OFFICIAL_DOC)
  minCarouselItems: number; // 2 (OFFICIAL_DOC)
  maxCarouselItems: number; // 20 (OFFICIAL_DOC)
  allowedImageFormats: string[]; // ['jpeg', 'jpg', 'png', 'image/jpeg', 'image/png'] (OFFICIAL_DOC)
  maxImageFileSizeBytes: number; // 8 * 1024 * 1024 (8MB) (OFFICIAL_DOC)
  lengthMeasurement: LengthMeasurementType;
}

export interface NaverBlogSpecConfig {
  requireTitle: boolean; // true (CONFIG)
  requireImage: boolean; // true (CONFIG)
  recommendedTitleMaxLength: number; // 100 (UNVERIFIED)
  recommendedContentMaxLength: number; // 20000 (UNVERIFIED)
  recommendedMaxImages: number; // 50 (UNVERIFIED)
  recommendedMaxImageFileSizeBytes: number; // 20 * 1024 * 1024 (20MB) (UNVERIFIED)
  lengthMeasurement: LengthMeasurementType;
}

export interface DaangnSpecConfig {
  maxImages: number; // 20 (UNVERIFIED)
  galleryDisplayImages: number; // 10 (UNVERIFIED)
  maxVideos: number; // 1 (UNVERIFIED)
  recommendedMaxTextLength: number; // 2000 (UNVERIFIED)
  lengthMeasurement: LengthMeasurementType;
}

export interface SpecConfig {
  specVersion: string;
  rulesMetadata: Record<string, BaseRuleSpec>;
  instagram: InstagramSpecConfig;
  threads: ThreadsSpecConfig;
  naver_blog: NaverBlogSpecConfig;
  daangn: DaangnSpecConfig;
}
