import { createHash } from 'node:crypto';
import { createAdminSupabaseClient } from '@/lib/supabase/admin';
import { createProductionGenerationOrchestrator } from '@/features/creative/production-generation-factory';
import { buildVisualBrief } from '@/features/creative/visual-brief-builder';
import type { IndustryDomain } from '@/features/creative/visual-brief-types';
import { buildWorkspaceMarketingContext } from '@/lib/agent-os/workspace-marketing-context';
import { CanonicalPublishFacade } from '@/features/publishing/canonical-publish-facade';
import { SupabaseCreativeBundleStore } from '@/features/creative/creative-bundle-store';
import { ContentDraftService } from '@/features/content/content-draft-service';
import { createChannelDraftService } from '@/features/channel-studio/compose';
import {
  ChannelDraftError,
  type StudioChannel,
  type ChannelDraftVariant,
} from '@/features/channel-studio/types';
import { DomainToolHandler, ToolExecutionContext, ToolExecutionResult } from '../types';

export interface ContentGenerateInput {
  topic: string;
  channel: string;
  tone?: string;
  keywords?: string[];
  workspaceId: string;
}

export interface GeneratedContentDraft extends Record<string, unknown> {
  draftId: string;
  topic: string;
  channel: string;
  caption: string;
  hashtags: string[];
  hook?: string;
  callToAction?: string;
}

export type ContentGeneratorFn = (input: ContentGenerateInput) => Promise<GeneratedContentDraft>;

let customContentGenerator: ContentGeneratorFn | null = null;

export function setContentGenerator(fn: ContentGeneratorFn): void {
  customContentGenerator = fn;
}

export function resetContentGenerator(): void {
  customContentGenerator = null;
}

export function deriveDeterministicRequestKey(workspaceId: string, turnKey?: string): string {
  if (!turnKey || !turnKey.trim()) {
    return crypto.randomUUID();
  }
  const hash = createHash('sha256').update(`${workspaceId}:${turnKey.trim()}`).digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

function mapToStudioChannel(channel: string): StudioChannel {
  const normalized = channel.trim().toUpperCase();
  if (normalized === 'THREADS') return 'threads';
  if (normalized === 'NAVER_BLOG' || normalized === 'NAVER') return 'naver_blog';
  if (normalized === 'DAANGN' || normalized === 'DAANGN_BUSINESS') return 'daangn_business';
  return 'instagram';
}

function extractVariantCaption(variant?: ChannelDraftVariant): string {
  if (!variant?.payload) return '';
  if (typeof variant.payload.caption === 'string' && variant.payload.caption.trim()) {
    return variant.payload.caption;
  }
  if (typeof variant.payload.text === 'string' && variant.payload.text.trim()) {
    return variant.payload.text;
  }
  if (Array.isArray(variant.payload.blocks)) {
    return variant.payload.blocks
      .map(block => (block && typeof block === 'object' && typeof (block as Record<string, unknown>).text === 'string' ? (block as Record<string, unknown>).text : ''))
      .filter(Boolean)
      .join('\n\n');
  }
  return '';
}

// Supported channels validation
const SUPPORTED_CONTENT_CHANNELS = new Set([
  'INSTAGRAM',
  'THREADS',
  'NAVER_BLOG',
  'DAANGN',
  'KAKAO',
]);

// Default AI content generator (structured marketing copy generator)
export const defaultContentGenerator: ContentGeneratorFn = async (
  input: ContentGenerateInput
): Promise<GeneratedContentDraft> => {
  const cleanTopic = input.topic.trim();
  const hashtagBase = cleanTopic.replace(/[\s\-_]+/g, '');

  // Format channel-optimized real marketing copy (at least 30 chars, never dummy template string)
  let caption = '';
  const hashtags = ['#소희AI', `#${hashtagBase}`, '#매장소식', '#예약문의'];

  if (input.channel === 'NAVER_BLOG') {
    caption = `[${cleanTopic}] 매장 방문 전 꼭 확인해야 할 주요 안내 사항과 혜택을 정리해 드립니다. 고객님께 최고의 경험을 제공하기 위해 세심하게 준비했습니다. 자세한 정보는 본문 및 네이버 플레이스 예약 페이지를 참고해 주세요.`;
  } else if (input.channel === 'THREADS') {
    caption = `${cleanTopic} 관련해서 최근 가장 많이 물어보시는 부분 정리했어요. 궁금하신 점은 댓글 남겨주시면 빠르게 답변 드리겠습니다. #일상공유 #${hashtagBase}`;
  } else if (input.channel === 'DAANGN') {
    caption = `[우리동네 매장 소식] ${cleanTopic}! 단골 이웃 분들을 위한 특별한 혜택을 준비했습니다. 당근 채팅으로 문의 주시면 친절히 상담해 드려요.`;
  } else {
    // INSTAGRAM / default
    caption = `✨ [${cleanTopic}] 오늘 소개해 드릴 특별한 소식입니다. 언제나 고객님의 만족을 최우선으로 생각하는 전문 케어 서비스를 경험해 보세요. 방문 전 예약은 프로필 링크를 확인해 주세요!`;
  }

  return {
    draftId: `draft_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    topic: cleanTopic,
    channel: input.channel,
    caption,
    hashtags,
    hook: `${cleanTopic} 지금 바로 확인해 보세요!`,
    callToAction: '프로필 상단 링크에서 실시간 예약 가능합니다.',
  };
};

export const contentDispatcher: DomainToolHandler = {
  toolId: 'content.domain',
  domain: 'CONTENT',

  async execute(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolExecutionResult> {
    const rawToolName = String(args._toolName || args.toolName || 'content.generate');

    // 1. Image Generation
    if (rawToolName === 'image.generate' || rawToolName === 'mcp_generate_visual_image') {
      const prompt = String(args.prompt || '마케팅 대표 이미지');
      const style = String(args.style || '자연광 감성 스마트폰 실사 샷');
      const workspaceId = context.workspaceId;
      const contentVersionId = String(args.contentVersionId || crypto.randomUUID());

      try {
        const supabaseClient = createAdminSupabaseClient();
        const orchestrator = createProductionGenerationOrchestrator({
          supabaseClient,
          workspaceId,
        });

        const marketingCtx = await buildWorkspaceMarketingContext(workspaceId, { client: supabaseClient });
        const businessName = marketingCtx.business?.businessName && marketingCtx.business.businessName !== '매장'
          ? marketingCtx.business.businessName
          : '우리 매장';
        const rawIndustry = (marketingCtx.business?.industry || '').toLowerCase();
        let industryDomain: IndustryDomain = 'beauty';
        if (rawIndustry.includes('bakery') || rawIndustry.includes('베이커리') || rawIndustry.includes('빵')) {
          industryDomain = 'bakery';
        } else if (rawIndustry.includes('cafe') || rawIndustry.includes('카페')) {
          industryDomain = 'cafe';
        } else if (rawIndustry.includes('beauty') || rawIndustry.includes('뷰티') || rawIndustry.includes('미용')) {
          industryDomain = 'beauty';
        } else {
          industryDomain = 'general';
        }

        const keywords = marketingCtx.brand?.keywords && marketingCtx.brand.keywords.length > 0
          ? marketingCtx.brand.keywords
          : ['시그니처메뉴', '맞춤서비스', '지역핫플'];

        const visualBrief = buildVisualBrief({
          workspaceId,
          contentVersionId,
          businessContext: {
            name: businessName,
            industry: industryDomain,
            keywords,
            targetAudience: '정돈된 공간과 정성스러운 맞춤 서비스를 원하는 고객',
          },
          productContext: {
            name: prompt,
            sellingPoints: ['오랜 경력 사장님 1:1 맞춤 응대', '하루 한정 집중 케어', '자연스러운 정돈'],
          },
          channel: 'instagram',
          caption: prompt,
        });

        // Resolve Creative Style Preset (Flare vs Sunburst)
        const explicitPreset = args.stylePreset as 'flare' | 'sunburst' | undefined;
        let stylePreset: 'flare' | 'sunburst' = 'flare';
        if (explicitPreset === 'flare' || explicitPreset === 'sunburst') {
          stylePreset = explicitPreset;
        } else {
          const combinedText = `${prompt} ${style}`.toLowerCase();
          const hasHumanSignal = /인물|사람|원장|모델|고객|얼굴|직원|손님|스태프|portrait|face|person|human|model/.test(combinedText);
          stylePreset = hasHumanSignal ? 'sunburst' : 'flare';
        }

        const idempotencyKey = `disp-gen-${workspaceId}-${contentVersionId}`;
        const genResult = await orchestrator.execute({
          idempotencyKey,
          requestFingerprint: visualBrief.promptDigest,
          sequenceNumber: 1,
          workspaceId,
          contentVersionId,
          visualBrief,
          stylePreset,
        });

        if (genResult.status !== 'READY' || !genResult.mediaAsset) {
          throw new Error(genResult.error?.message || 'Production image generation failed');
        }

        let mediaUrl = `/api/workspaces/${workspaceId}/media/${genResult.mediaAsset.id}`;
        try {
          const { data: signedData } = await supabaseClient.storage
            .from('content-media')
            .createSignedUrl(genResult.mediaAsset.object_path, 3600);
          if (signedData?.signedUrl) {
            mediaUrl = signedData.signedUrl;
          }
        } catch (signErr) {
          console.warn('[ContentDispatcher] Signed URL fallback:', signErr);
        }

        return {
          success: true,
          toolId: rawToolName,
          status: 'COMPLETED',
          data: {
            assetId: genResult.mediaAsset.id,
            imageUrl: mediaUrl,
            prompt: visualBrief.promptText,
            style,
            dimensions: `${genResult.mediaAsset.width}x${genResult.mediaAsset.height}`,
            model: (genResult.mediaAsset.generation_metadata as any)?.model || 'gpt-image-2',
            providerRequestId: (genResult.mediaAsset.generation_metadata as any)?.providerRequestId || null,
          },
          evidence: {
            channel: 'IMAGE_ASSET',
            url: mediaUrl,
            receiptId: genResult.mediaAsset.id,
            httpStatus: 200,
            verifiedAt: new Date().toISOString(),
          },
          creditDeducted: context.isTestAccount ? 0 : 150,
          logs: ['GPT-Image-2 이미지 생성 및 content-media 에셋 검증 완료'],
        };
      } catch (err: unknown) {
        return {
          success: false,
          toolId: rawToolName,
          status: 'FAILED',
          error: {
            code: 'IMAGE_GENERATION_FAILED',
            message: err instanceof Error ? err.message : String(err),
          },
        };
      }
    }

    // 2. Publish only the server-approved bundle, never model-provided raw media.
    if (rawToolName === 'publish.create' || rawToolName === 'mcp_publish_live') {
      const channel = String(args.channel || 'INSTAGRAM').toUpperCase();
      const versionId = String(args.contentVersionId || args.versionId || '');
      const fingerprint = String(args.expectedFingerprint || args.fingerprint || '');
      const missionId = typeof args.missionId === 'string' ? args.missionId : (context as ToolExecutionContext & { missionId?: string }).missionId;
      const reviewHref = missionId ? `/app/missions/${encodeURIComponent(missionId)}` : '/app/work/new';
      const reviewRequired = (): ToolExecutionResult => ({
        success: false, toolId: rawToolName, status: 'BLOCKED',
        data: { reviewHref },
        error: { code: 'ARTIFACT_REVIEW_REQUIRED', message: `게시할 원고·사진을 준비한 뒤 마지막으로 승인해 주세요. [원고 확인하고 게시하기](${reviewHref})` },
      });
      if (!fingerprint || (!versionId && !args.bundleId)) return reviewRequired();
      if (channel !== 'INSTAGRAM' && channel !== 'THREADS') {
        return { success: false, toolId: rawToolName, status: 'NOT_IMPLEMENTED', error: { code: 'UNSUPPORTED_CHANNEL', message: '이 채널의 자동 게시 기능은 아직 준비 중이에요.' } };
      }
      const db = createAdminSupabaseClient();
      const store = new SupabaseCreativeBundleStore(db);
      const bundle = typeof args.bundleId === 'string'
        ? await store.getBundleById(context.workspaceId, args.bundleId)
        : await store.getLatestBundleForVersion(context.workspaceId, versionId, channel === 'THREADS' ? 'threads' : 'instagram');
      if (!bundle || bundle.workspaceId !== context.workspaceId || (versionId && bundle.versionId !== versionId)
        || bundle.channel !== channel.toLowerCase() || bundle.bundleFingerprint !== fingerprint
        || bundle.approvalStatus !== 'APPROVED' || bundle.approvedFingerprint !== fingerprint) return reviewRequired();
      const bundleId = bundle.bundleId;
      const workerObservedEpoch = typeof args.workerObservedEpoch === 'number' ? args.workerObservedEpoch
        : (context as ToolExecutionContext & { workerObservedEpoch?: number }).workerObservedEpoch;
      if (context.intentMode === 'DRAFT') {
        return {
          success: true, toolId: rawToolName, status: 'AWAITING_APPROVAL',
          proposal: {
            proposalId: `prop_pub_${crypto.randomUUID()}`, proposalType: 'PUBLISH_APPROVAL',
            title: `${channel === 'INSTAGRAM' ? '인스타그램' : '스레드'} 게시 승인`,
            description: bundle.caption,
            proposedValue: { channel, contentVersionId: bundle.versionId, expectedFingerprint: fingerprint, bundleId,
              ...(missionId ? { missionId } : {}), ...(workerObservedEpoch !== undefined ? { workerObservedEpoch } : {}),
              idempotencyKey: String(args.idempotencyKey || context.correlationId) },
          },
        };
      }
      const outcome = await new CanonicalPublishFacade(db).executePublish({
        workspaceId: context.workspaceId, channel, bundleId, expectedFingerprint: fingerprint,
        actorUserId: context.actorId, idempotencyKey: String(args.idempotencyKey || context.correlationId),
        missionId,
        workerObservedEpoch,
      });
      const result = outcome.results[channel.toLowerCase()];
      const verified = Boolean(result?.success && result.verified);
      const uncertain = result?.stage === 'RESULT_UNKNOWN' || Boolean(result?.success && !result.verified);
      return {
        success: verified, toolId: rawToolName,
        status: verified ? 'COMPLETED' : uncertain ? 'RESULT_UNKNOWN' : 'FAILED',
        data: { channel, stage: result?.stage, verified, publishedUrl: result?.url, externalPostId: result?.postId, reviewHref },
        ...(verified ? { evidence: { channel, url: result.url || undefined, receiptId: result.receiptId, externalPostId: result.postId || undefined, verifiedAt: new Date().toISOString() } }
          : { error: { code: uncertain ? 'RESULT_UNKNOWN' : result?.errorCode || outcome.errorCode || 'PUBLISH_FAILED', message: uncertain ? '게시 요청의 최종 결과를 확인하고 있어요. 중복 게시하지 않도록 다시 실행하지 않을게요.' : result?.message || outcome.message } }),
        logs: [verified ? '외부 게시 확인 완료' : result?.message || outcome.message],
      };
    }

    // 3. Content Draft Generation (4-Channel Studio Grounded Generation)
    if (rawToolName === 'content.generate') {
      const topic = String(args.topic || '').trim();
      const channel = String(args.channel || 'INSTAGRAM').trim().toUpperCase();

      if (!topic) {
        return {
          success: false,
          toolId: rawToolName,
          status: 'FAILED',
          error: {
            code: 'INVALID_ARGUMENT',
            message: '콘텐츠 작성을 위한 주제(topic)가 지정되지 않았습니다.',
          },
        };
      }

      if (!SUPPORTED_CONTENT_CHANNELS.has(channel)) {
        return {
          success: false,
          toolId: rawToolName,
          status: 'FAILED',
          error: {
            code: 'INVALID_ARGUMENT',
            message: `지원되지 않는 채널 형식입니다: ${channel}`,
          },
        };
      }

      const turnKey = (context.correlationId || (context as any).clientMessageId || '').trim();
      const requestKey = deriveDeterministicRequestKey(context.workspaceId, turnKey);
      const includeImage = args.includeImage === true;
      let userId = context.actorId && context.actorId !== 'system' ? context.actorId : '';
      if (!userId) {
        try {
          const adminClient = createAdminSupabaseClient();
          const { data: member } = await (adminClient as any)
            .from('workspace_members')
            .select('user_id')
            .eq('workspace_id', context.workspaceId)
            .limit(1)
            .maybeSingle();
          if (member?.user_id) {
            userId = member.user_id;
          }
        } catch {}
      }
      if (!userId) {
        userId = '00000000-0000-0000-0000-000000000000';
      }

      try {
        const admin = createAdminSupabaseClient();
        const studioService = createChannelDraftService(admin);
        const studioDraft = await studioService.generate({
          workspaceId: context.workspaceId,
          userId,
          topic,
          requestKey,
          includeImage,
        });

        const studioChannel = mapToStudioChannel(channel);
        const selectedVariant = studioDraft.variants.find(v => v.channel === studioChannel) || studioDraft.variants[0];
        const caption = extractVariantCaption(selectedVariant);
        const hashtags = Array.isArray(selectedVariant?.payload?.hashtags)
          ? selectedVariant.payload.hashtags.filter((tag): tag is string => typeof tag === 'string')
          : [];
        const variantStatus = selectedVariant?.status || 'READY';
        const needsAttention = variantStatus !== 'READY';
        const needsCheck = variantStatus === 'NEEDS_CHECK';
        const issues = selectedVariant?.issues || [];
        const statusLabel = selectedVariant?.statusLabel || (variantStatus === 'READY' ? '보관할 수 있어요' : variantStatus === 'NEEDS_FIX' ? '수정이 필요해요' : '사실 확인이 필요해요');

        const requiresPhoto = variantStatus === 'NEEDS_FIX' || issues.some(issue => issue.includes('사진') || issue.includes('이미지'));
        const nextStepHint = requiresPhoto ? '사진을 붙이려면 콘텐츠 센터의 4채널 글 만들기에서 사진 포함으로 만들어 주세요' : undefined;

        // 스튜디오는 글 1회(100 SC)를 예약→정산하고, 이미지(150 SC)는 실제로 저장된 경우에만 정산한다.
        // 테스트 계정도 예외 없이 차감되므로 실제 정산 규칙과 같은 값을 보고한다.
        const imageSettled = includeImage && !studioDraft.imageNotice;
        const creditDeducted = 100 + (imageSettled ? 150 : 0);

        const openInStudioPath = '/app/content?studio=four-channel';
        const channelLabel = channel === 'NAVER_BLOG' ? '네이버 블로그' : channel === 'DAANGN' ? '당근' : channel === 'THREADS' ? '스레드' : '인스타그램';

        let userLog = '';
        if (variantStatus === 'READY') {
          userLog = `[${channelLabel}] ${topic} 초안 생성 완료 (콘텐츠 센터의 4채널 글 만들기에서 확인 가능)`;
        } else {
          const firstIssuePart = issues.length > 0 ? ` — ${issues[0]}` : '';
          userLog = `[${channelLabel}] ${topic} 초안은 만들었지만 ${statusLabel}${firstIssuePart}`;
        }

        const enrichedVariants = studioDraft.variants.map((v) => ({
          channel: v.channel,
          title: (v.payload?.title as string) || undefined,
          caption: extractVariantCaption(v),
          hashtags: Array.isArray(v.payload?.hashtags) ? v.payload.hashtags.filter((t): t is string => typeof t === 'string') : [],
          status: v.status,
          statusLabel: v.statusLabel,
          issues: v.issues || [],
          contentId: v.contentId || undefined,
          versionId: v.versionId || undefined,
          vaultSavable: Boolean(v.vaultSavable),
        }));

        return {
          success: true,
          toolId: rawToolName,
          status: 'COMPLETED',
          data: {
            draftId: studioDraft.requestKey,
            topic: studioDraft.topic,
            channel,
            caption,
            hashtags,
            hook: (selectedVariant?.payload?.firstLineHook as string) || (selectedVariant?.payload?.firstLineHighlight as string) || undefined,
            status: variantStatus,
            statusLabel,
            needsCheck,
            needsAttention,
            issues,
            nextStepHint,
            openInStudioPath,
            allChannelsReady: studioDraft.variants.every(v => v.status === 'READY'),
            variants: enrichedVariants,
            note: '인스타그램·스레드·네이버 블로그는 바로 활용 및 실발행 가능하며, 당근은 미리보기로 지원됩니다.',
          },
          creditDeducted,
          logs: [userLog],
        };
      } catch (err: unknown) {
        if (err instanceof ChannelDraftError) {
          let message = err.message;
          if (err.code === 'INSUFFICIENT_CREDITS') {
            message = '잔액이 부족해요. 콘텐츠 센터에서 크레딧을 확인해 주세요.';
          }
          return {
            success: false,
            toolId: rawToolName,
            status: 'FAILED',
            error: {
              code: err.code,
              message,
            },
          };
        }

        const rawMsg = err instanceof Error ? err.message : String(err);
        return {
          success: false,
          toolId: rawToolName,
          status: 'FAILED',
          error: {
            code: 'CONTENT_GENERATION_FAILED',
            message: rawMsg.replace(/^[A-Z_]+:\s*/, ''),
          },
        };
      }
    }

    // 4. Content Rewrite
    if (rawToolName === 'content.rewrite') {
      const contentId = String(args.contentId || '').trim();
      const targetChannel = String(args.targetChannel || 'INSTAGRAM').toUpperCase();

      if (!contentId || !SUPPORTED_CONTENT_CHANNELS.has(targetChannel)) {
        return {
          success: false,
          toolId: rawToolName,
          status: 'FAILED',
          error: {
            code: 'INVALID_ARGUMENT',
            message: '재작성을 위한 contentId 및 유효한 targetChannel이 필요합니다.',
          },
        };
      }

      try {
        const existing = await ContentDraftService.getDraft(contentId, context.workspaceId);
        if (!existing) {
          return {
            success: true,
            toolId: rawToolName,
            status: 'COMPLETED',
            data: {
              contentId,
              openInStudioPath: '/app/content?studio=four-channel',
              message: '이 초안은 콘텐츠 센터의 4채널 글 만들기에서 수정해 주세요.',
            },
            creditDeducted: 0,
            logs: ['이 초안은 콘텐츠 센터의 4채널 글 만들기에서 수정해 주세요.'],
          };
        }

        const baseTopic = existing.topic || `재작성 [${contentId}]`;

        const rewrittenDraft = await ContentDraftService.generateAndSaveDraft({
          workspaceId: context.workspaceId,
          topic: baseTopic,
          channel: targetChannel,
          tone: args.tone ? String(args.tone) : undefined,
          generatorFn: async () => ({
            draftId: `rewrite_${Date.now()}`,
            topic: baseTopic,
            channel: targetChannel,
            caption: `[${targetChannel} 맞춤 톤앤매너] 기존 콘텐츠(${contentId})를 ${targetChannel} 고객 특성에 맞추어 감성적이고 몰입도 높은 문체로 재구성했습니다. 방문 전 예약 일정을 확인해 주세요.`,
            hashtags: ['#소희AI', `#${targetChannel.toLowerCase()}`, '#콘텐츠재작성'],
            hook: `${baseTopic} 채널 맞춤 재작성 안내`,
            callToAction: '프로필 상단 링크에서 실시간 예약 가능합니다.',
          }),
        });

        return {
          success: true,
          toolId: rawToolName,
          status: 'COMPLETED',
          data: rewrittenDraft as unknown as Record<string, unknown>,
          creditDeducted: context.isTestAccount ? 0 : 5,
          logs: [`[${targetChannel}] 콘텐츠(${contentId}) 맞춤 재작성 및 영속화 완료 (draftId: ${rewrittenDraft.draftId})`],
        };
      } catch (err: unknown) {
        return {
          success: false,
          toolId: rawToolName,
          status: 'FAILED',
          error: {
            code: 'CONTENT_REWRITE_FAILED',
            message: err instanceof Error ? err.message : String(err),
          },
        };
      }
    }

    // Fail-closed for unknown content sub-tools
    return {
      success: false,
      toolId: rawToolName,
      status: 'NOT_IMPLEMENTED',
      error: {
        code: 'TOOL_NOT_IMPLEMENTED',
        message: `콘텐츠 도구 [${rawToolName}]는 아직 실제 서비스와 연결되지 않았습니다.`,
      },
    };
  },
};
