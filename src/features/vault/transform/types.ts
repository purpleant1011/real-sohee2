import type {
  ChannelVariantPayload,
  MediaItem,
  SpecConfig,
  SpecEvaluationResult,
} from '../channel-spec/types';
import type { VaultChannel } from '../types';
import type { TextGenerator } from './ports/text-generator';

export type TonePresetKey = 'friendly' | 'calm' | 'trendy' | 'professional';

export interface TonePresetDefinition {
  key: TonePresetKey;
  label: string;
  description: string;
  sample: string;
  brandVoice: string;
}

export interface ToneTrace {
  tonePreset: string;
  brandVoice: string;
  rationale: string;
}

export interface NaverBlogBlock {
  type: 'heading' | 'paragraph' | 'quote' | 'callout';
  text: string;
}

export interface InstagramVariantExtension {
  firstLineHook?: string;
}

export interface NaverBlogVariantExtension {
  blocks?: NaverBlogBlock[];
  category?: string;
}

export interface DaangnVariantExtension {
  firstLineHighlight?: string;
  coupon?: string;
}

export interface TransformedPayloadFields {
  firstLineHook?: string;
  blocks?: NaverBlogBlock[];
  category?: string;
  firstLineHighlight?: string;
  coupon?: string;
}

export type VariantPayloadExtension = TransformedPayloadFields & Record<string, any>;

export interface TransformedVariantResult {
  channel: VaultChannel;
  payload: ChannelVariantPayload & VariantPayloadExtension;
  evaluation: SpecEvaluationResult;
  status: 'PASS' | 'FAIL';
  retried: boolean;
  retryCount: number;
  /** 내부용 말투 유지 근거 추적 정보 (사용자 DTO에는 노출하지 않음) */
  tone_trace: ToneTrace;
  /** 사용자 친화적 한국어 상태 라벨 (영문 코드 노출 방지) */
  userStatusLabel: string;
}

export interface GenerateChannelVariantsInput {
  /** 게시물의 핵심 주제 */
  topic: string;
  /** 원본 기본 초안 */
  baseDraft: string;
  /** 말투 프리셋 (기본값: 'friendly') */
  tonePreset?: TonePresetKey | string;
  /** 생성할 채널 목록 (기본값: 4개 채널 전체) */
  channels?: VaultChannel[];
  /** 주입 가능한 텍스트 생성 포트 */
  generator?: TextGenerator;
  /** 첨부 미디어 (선택 사항) */
  media?: MediaItem[] | Promise<MediaItem[]>;
  /** 채널 규격 설정 (기본값: currentSpec) */
  specConfig?: SpecConfig;
  /** 규격 위반 시 재생성 최대 시도 횟수 (기본값: 1) */
  maxRetries?: number;
}

export interface GenerateChannelVariantsResult {
  variants: Partial<Record<VaultChannel, TransformedVariantResult>>;
  summary: {
    totalChannels: number;
    passCount: number;
    failCount: number;
    retriedChannels: VaultChannel[];
    summaryLabel: string;
  };
}
