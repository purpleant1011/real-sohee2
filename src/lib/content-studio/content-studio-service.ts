/**
 * Sohee V0.9 5th Update · Wave 3 Content Studio Service
 * Complete Queue → Brief → Asset → Channel Preview → QC → Approval → Schedule/Publish → Readback Pipeline
 * 
 * Traceability: ANI-927
 */

import {
  ChannelType,
  ContentBrief,
  ContentAsset,
  ChannelVariant,
  ChannelQcCheck,
  PublishingJob,
  ContentStudioItem,
  ContentStudioStage,
} from '@/types/content-studio';

export class ContentStudioService {
  /**
   * 금지어 및 비속어, 과장 광고 금지 단어 목록 (의료법 및 표시광고법 준수)
   */
  public static readonly MEDICAL_LAW_FORBIDDEN_WORDS = [
    '완치',
    '부작용 전혀 없음',
    '100% 보장',
    '최고의',
    '국내 유일',
    '기적의',
  ];

  /**
   * 채널별 네이티브 프리뷰 규격 및 유효성 검사 (Channel Native QC)
   */
  public static validateChannelVariant(
    channel: ChannelType,
    title: string | undefined,
    caption: string,
    hashtags: string[],
    assets: ContentAsset[]
  ): ChannelQcCheck {
    const forbiddenFound: string[] = [];
    const recommendations: string[] = [];

    // 1. 금지어 검사
    const fullText = `${title || ''} ${caption} ${hashtags.join(' ')}`;
    for (const forbidden of this.MEDICAL_LAW_FORBIDDEN_WORDS) {
      if (fullText.includes(forbidden)) {
        forbiddenFound.push(forbidden);
      }
    }

    let channelComplied = true;
    let score = 100;

    // 2. 채널별 규격 검사
    if (channel === 'INSTAGRAM') {
      if (caption.length > 2200) {
        channelComplied = false;
        recommendations.push('인스타그램 본문은 2,200자 이하여야 합니다.');
        score -= 30;
      }
      if (hashtags.length > 30) {
        channelComplied = false;
        recommendations.push('해시태그는 최대 30개까지 허용됩니다.');
        score -= 20;
      }
      if (assets.length === 0) {
        channelComplied = false;
        recommendations.push('인스타그램은 최소 1개 이상의 승인된 이미지가 필요합니다.');
        score -= 40;
      }
    } else if (channel === 'NAVER_BLOG') {
      if (!title || title.trim().length === 0) {
        channelComplied = false;
        recommendations.push('네이버 블로그는 제목이 필수입니다.');
        score -= 40;
      } else if (title.length > 100) {
        channelComplied = false;
        recommendations.push('네이버 블로그 제목은 100자 이내여야 합니다.');
        score -= 15;
      }
      if (caption.length < 100) {
        recommendations.push('블로그 검색 노출을 위해 본문 길이를 100자 이상 작성하는 것을 권장합니다.');
        score -= 10;
      }
    } else if (channel === 'DAANGN') {
      if (caption.length < 20) {
        channelComplied = false;
        recommendations.push('당근마켓 소식 본문은 20자 이상이어야 합니다.');
        score -= 30;
      }
      if (!caption.includes('청라') && !caption.includes('동네') && !caption.includes('이웃')) {
        recommendations.push('당근 지역 소식 반응도를 높이기 위해 동네/이웃 키워드 포함을 권장합니다.');
        score -= 10;
      }
    }

    if (forbiddenFound.length > 0) {
      channelComplied = false;
      score -= (forbiddenFound.length * 25);
    }

    score = Math.max(0, Math.min(100, score));
    const passed = channelComplied && forbiddenFound.length === 0 && score >= 70;

    return {
      qcId: `qc_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      channel,
      passed,
      score,
      forbiddenWordsFound: forbiddenFound,
      channelRulesComplied: channelComplied,
      recommendations,
    };
  }

  /**
   * 브리프 및 채널별 파이프라인 생성
   */
  public static createPipelineItem(params: {
    brief: ContentBrief;
    assets: ContentAsset[];
    variants: Array<{
      channel: ChannelType;
      title?: string;
      caption: string;
      hashtags: string[];
    }>;
  }): ContentStudioItem {
    const builtVariants: ChannelVariant[] = params.variants.map((v, idx) => {
      const qc = this.validateChannelVariant(
        v.channel,
        v.title,
        v.caption,
        v.hashtags,
        params.assets
      );
      return {
        variantId: `var_${params.brief.briefId}_${idx + 1}`,
        briefId: params.brief.briefId,
        channel: v.channel,
        title: v.title,
        caption: v.caption,
        hashtags: v.hashtags,
        assets: params.assets,
        qc,
        isApproved: false,
      };
    });

    const allPassed = builtVariants.every(v => v.qc.passed);
    const initialStage: ContentStudioStage = allPassed ? 'APPROVAL' : 'QC';

    return {
      id: `studio_item_${params.brief.briefId}`,
      brief: params.brief,
      variants: builtVariants,
      currentStage: initialStage,
      updatedAt: new Date().toISOString(),
    };
  }

  /**
   * 원장님 승인 완료 및 발행 스케줄/즉시 발행 작업 등록
   */
  public static approveAndSchedule(
    item: ContentStudioItem,
    variantId: string,
    scheduledAt: string | null
  ): ContentStudioItem {
    const targetVariant = item.variants.find(v => v.variantId === variantId);
    if (!targetVariant) {
      throw new Error(`Variant not found: ${variantId}`);
    }

    if (!targetVariant.qc.passed) {
      throw new Error(`Cannot approve variant failing QC: score ${targetVariant.qc.score}`);
    }

    targetVariant.isApproved = true;

    const publishingJob: PublishingJob = {
      jobId: `pub_job_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      workspaceId: item.brief.workspaceId,
      briefId: item.brief.briefId,
      variantId,
      channel: targetVariant.channel,
      scheduledAt,
      publishedAt: null,
      status: scheduledAt ? 'SCHEDULED' : 'PUBLISHING',
      reconcileAttemptCount: 0,
    };

    return {
      ...item,
      currentStage: scheduledAt ? 'SCHEDULE_OR_PUBLISH' : 'PUBLISHING' as any,
      publishingJob,
      updatedAt: new Date().toISOString(),
    };
  }

  /**
   * 발행 결과 및 독립 재조회(Evidence) 기록
   */
  public static recordPublishingResult(
    item: ContentStudioItem,
    result: {
      success: boolean;
      providerPostId?: string;
      providerPostUrl?: string;
      evidenceId?: string;
      failureReason?: string;
    }
  ): ContentStudioItem {
    if (!item.publishingJob) {
      throw new Error('No active publishing job found in studio item');
    }

    const updatedJob: PublishingJob = {
      ...item.publishingJob,
      publishedAt: result.success ? new Date().toISOString() : null,
      status: result.success ? 'PUBLISHED' : 'FAILED',
      providerPostId: result.providerPostId,
      providerPostUrl: result.providerPostUrl,
      evidenceId: result.evidenceId,
      failureReason: result.failureReason,
    };

    const newStage: ContentStudioStage = result.success ? 'READBACK_VERIFIED' : 'QC';

    return {
      ...item,
      currentStage: newStage,
      publishingJob: updatedJob,
      updatedAt: new Date().toISOString(),
    };
  }
}
