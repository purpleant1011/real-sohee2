import { PublishingChannel, ChannelNativeConstraints } from './types';

export const CHANNEL_CONSTRAINTS_TABLE: Record<PublishingChannel, ChannelNativeConstraints> = {
  INSTAGRAM_FEED: {
    channel: 'INSTAGRAM_FEED',
    maxBodyLength: 2200,
    minBodyLength: 1,
    allowedAspectRatios: ['1:1', '4:5'],
    maxMediaCount: 10,
    minMediaCount: 1,
    requiresTitle: false,
    maxHashtags: 30,
  },
  INSTAGRAM_STORY: {
    channel: 'INSTAGRAM_STORY',
    maxBodyLength: 200,
    minBodyLength: 0,
    allowedAspectRatios: ['9:16'],
    maxMediaCount: 1,
    minMediaCount: 1,
    requiresTitle: false,
    maxHashtags: 5,
  },
  NAVER_BLOG: {
    channel: 'NAVER_BLOG',
    maxBodyLength: 50000,
    minBodyLength: 50,
    allowedAspectRatios: ['1:1', '4:5', '16:9'],
    maxMediaCount: 30,
    minMediaCount: 1,
    requiresTitle: true,
    maxHashtags: 20,
  },
  CARROT_FEED: {
    channel: 'CARROT_FEED',
    maxBodyLength: 2000,
    minBodyLength: 10,
    allowedAspectRatios: ['1:1', '4:5'],
    maxMediaCount: 10,
    minMediaCount: 1,
    requiresTitle: false,
    maxHashtags: 10,
  },
  THREADS: {
    channel: 'THREADS',
    maxBodyLength: 500,
    minBodyLength: 1,
    allowedAspectRatios: ['1:1', '4:5', '9:16', '16:9'],
    maxMediaCount: 10,
    minMediaCount: 0,
    requiresTitle: false,
    maxHashtags: 5,
  },
};

export interface ContentPayloadToValidate {
  title?: string;
  body: string;
  mediaUrls: string[];
  aspectRatio?: string;
  hashtags?: string[];
}

export interface ValidationReport {
  isValid: boolean;
  channel: PublishingChannel;
  errors: string[];
  warnings: string[];
  preview: {
    formattedTitle?: string;
    formattedBody: string;
    mediaCount: number;
    aspectRatio: string;
    tagCount: number;
  };
}

export class ChannelNativeContentValidator {
  /**
   * 채널별 네이티브 제약조건 검증 및 프리뷰 생성 (ANI-834)
   */
  validate(
    channel: PublishingChannel,
    content: ContentPayloadToValidate
  ): ValidationReport {
    const constraints = CHANNEL_CONSTRAINTS_TABLE[channel];
    const errors: string[] = [];
    const warnings: string[] = [];

    const title = content.title ? content.title.trim() : '';
    const body = content.body ? content.body.trim() : '';
    const mediaUrls = content.mediaUrls || [];
    const hashtags = content.hashtags || [];
    const aspectRatio = content.aspectRatio || '1:1';

    // 1. 제목 필수 여부 검사
    if (constraints.requiresTitle && (!title || title.length < 2)) {
      errors.push(`[${channel}] 제목은 필수 입력 사항입니다 (최소 2자).`);
    }

    // 2. 본문 길이 검사
    if (body.length < constraints.minBodyLength) {
      errors.push(
        `[${channel}] 본문 길이가 너무 짧습니다. (최소 ${constraints.minBodyLength}자, 현재 ${body.length}자)`
      );
    }
    if (body.length > constraints.maxBodyLength) {
      errors.push(
        `[${channel}] 본문 길이가 제한을 초과했습니다. (최대 ${constraints.maxBodyLength}자, 현재 ${body.length}자)`
      );
    }

    // 3. 미디어 개수 검사
    if (mediaUrls.length < constraints.minMediaCount) {
      errors.push(
        `[${channel}] 미디어가 최소 ${constraints.minMediaCount}개 이상 첨부되어야 합니다.`
      );
    }
    if (mediaUrls.length > constraints.maxMediaCount) {
      errors.push(
        `[${channel}] 미디어 첨부 허용 수(${constraints.maxMediaCount}개)를 초과했습니다. (현재 ${mediaUrls.length}개)`
      );
    }

    // 4. 종횡비(Aspect Ratio) 검사
    if (mediaUrls.length > 0 && !constraints.allowedAspectRatios.includes(aspectRatio)) {
      errors.push(
        `[${channel}] 지원하지 않는 이미지 비율입니다: ${aspectRatio} (허용: ${constraints.allowedAspectRatios.join(', ')})`
      );
    }

    // 5. 해시태그 수 검사
    if (hashtags.length > constraints.maxHashtags) {
      errors.push(
        `[${channel}] 해시태그 개수가 최대 허용치(${constraints.maxHashtags}개)를 초과했습니다.`
      );
    }

    // 6. 당근 피드 특수 정책: 외부 링크 금지
    if (channel === 'CARROT_FEED') {
      const urlRegex = /(https?:\/\/[^\s]+)/g;
      if (urlRegex.test(body)) {
        errors.push('[CARROT_FEED] 당근마켓 피드 본문에는 외부 웹 링크를 포함할 수 없습니다.');
      }
    }

    // 프리뷰 포맷팅
    let formattedBody = body;
    if (hashtags.length > 0 && channel !== 'NAVER_BLOG') {
      formattedBody += '\n\n' + hashtags.map((t) => (t.startsWith('#') ? t : `#${t}`)).join(' ');
    }

    return {
      isValid: errors.length === 0,
      channel,
      errors,
      warnings,
      preview: {
        formattedTitle: title || undefined,
        formattedBody,
        mediaCount: mediaUrls.length,
        aspectRatio,
        tagCount: hashtags.length,
      },
    };
  }
}
