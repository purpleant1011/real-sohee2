import {
  evaluateChannelSpec,
  isMediaRequirementCheck,
} from '../channel-spec/evaluate';
import { currentSpec } from '../channel-spec/spec-table';
import type { ChannelVariantPayload, MediaItem } from '../channel-spec/types';
import type { VaultChannel } from '../types';
import {
  buildChannelRetryPrompt,
  buildMultiChannelTransformPrompt,
} from './prompt';
import { resolveTonePreset } from './tone-presets';
import type {
  GenerateChannelVariantsInput,
  GenerateChannelVariantsResult,
  NaverBlogBlock,
  ToneTrace,
  TransformedVariantResult,
} from './types';

const DEFAULT_CHANNELS: VaultChannel[] = [
  'instagram',
  'threads',
  'naver_blog',
  'daangn_business',
];

function sanitizeJsonString(raw: string): string {
  return raw
    .trim()
    .replace(/^```(?:json)?/iu, '')
    .replace(/```$/u, '')
    .trim();
}

function parseJsonSafely<T = unknown>(raw: string): T | null {
  try {
    const cleaned = sanitizeJsonString(raw);
    return JSON.parse(cleaned) as T;
  } catch {
    return null;
  }
}

function resolveUserStatusLabel(status: 'PASS' | 'FAIL', blocksVault: boolean): string {
  if (status === 'PASS' && !blocksVault) {
    return '규격 적합';
  }
  return '수정 필요';
}

function assemblePayload(
  channel: VaultChannel,
  parsedData: any,
  media: MediaItem[]
): ChannelVariantPayload & Record<string, unknown> {

  switch (channel) {
    case 'instagram': {
      const ig = parsedData?.instagram ?? {};
      const caption = typeof ig.caption === 'string' ? ig.caption : '';
      const hashtags = Array.isArray(ig.hashtags)
        ? ig.hashtags.map((h: unknown) => String(h).trim()).filter(Boolean)
        : [];
      const firstLineHook = typeof ig.firstLineHook === 'string' ? ig.firstLineHook : '';
      return {
        caption,
        hashtags,
        media,
        firstLineHook,
      };
    }
    case 'threads': {
      const th = parsedData?.threads ?? {};
      const text = typeof th.text === 'string' ? th.text : '';
      return {
        text,
        media,
      };
    }
    case 'naver_blog': {
      const nb = parsedData?.naver_blog ?? {};
      const title = typeof nb.title === 'string' ? nb.title : '';
      const blocks: NaverBlogBlock[] = Array.isArray(nb.blocks)
        ? nb.blocks.map((b: any) => ({
            type: ['heading', 'paragraph', 'quote', 'callout'].includes(b?.type)
              ? b.type
              : 'paragraph',
            text: typeof b?.text === 'string' ? b.text : '',
          }))
        : [];
      const text =
        typeof nb.text === 'string' && nb.text
          ? nb.text
          : blocks.map((b) => b.text).join('\n\n');
      const hashtags = Array.isArray(nb.hashtags)
        ? nb.hashtags.map((h: unknown) => String(h).trim()).filter(Boolean)
        : [];
      const category = typeof nb.category === 'string' ? nb.category : '일상/생각';
      return {
        title,
        text,
        blocks,
        hashtags,
        category,
        media,
      };
    }
    case 'daangn_business': {
      const dg = parsedData?.daangn_business ?? {};
      const text = typeof dg.text === 'string' ? dg.text : '';
      const firstLineHighlight =
        typeof dg.firstLineHighlight === 'string' ? dg.firstLineHighlight : '';
      const coupon = typeof dg.coupon === 'string' && dg.coupon.trim() ? dg.coupon.trim() : null;
      return {
        text,
        firstLineHighlight,
        coupon,
        media,
      };
    }
    default:
      return { media };
  }
}

export async function generateChannelVariants(
  input: GenerateChannelVariantsInput
): Promise<GenerateChannelVariantsResult> {
  const {
    topic,
    baseDraft,
    channels = DEFAULT_CHANNELS,
    specConfig = currentSpec,
    maxRetries = 1,
  } = input;

  const tone = resolveTonePreset(input.tonePreset);

  let generator = input.generator;
  if (!generator) {
    const { createGeminiTextGenerator } = await import('./adapters/gemini');
    generator = createGeminiTextGenerator();
  }

  // 1차 전체 채널 동시 변환 생성
  const initialPrompt = buildMultiChannelTransformPrompt({
    topic,
    baseDraft,
    tone,
    channels,
  });

  const rawInitialResponse = await generator.generateText(initialPrompt, {
    responseMimeType: 'application/json',
    temperature: 0.7,
  });

  const media = await input.media ?? [];
  const parsedInitial = parseJsonSafely<Record<string, any>>(rawInitialResponse) ?? {};
  const globalToneRationale =
    typeof parsedInitial.toneRationale === 'string'
      ? parsedInitial.toneRationale
      : `${tone.label} 말투를 반영하여 각 채널 특성에 맞게 재구성함.`;

  const variantsResult: Partial<Record<VaultChannel, TransformedVariantResult>> = {};
  const retriedChannels: VaultChannel[] = [];
  let passCount = 0;
  let failCount = 0;

  for (const channel of channels) {
    let payload = assemblePayload(channel, parsedInitial, media);
    let evaluation = evaluateChannelSpec(channel, payload, specConfig);
    let retried = false;
    let retryCount = 0;

    const failedChecks = evaluation.checks.filter((c) => c.status === 'FAIL');
    const hasRetryableFailure = failedChecks.some(
      (c) => !isMediaRequirementCheck(c.id)
    );

    // 자체 검증 결과 FAIL인 경우 1회 재생성 시도 (글로 고칠 수 있는 FAIL이 하나라도 있을 때만)
    if (evaluation.blocksVault && maxRetries > 0 && hasRetryableFailure) {
      retried = true;
      retryCount = 1;
      retriedChannels.push(channel);

      const failureReasons = failedChecks.map(
        (c) => `${c.label}: ${c.userMessage} (${c.detail})`
      );

      const previousText =
        payload.caption ?? payload.text ?? payload.title ?? '';

      const retryPrompt = buildChannelRetryPrompt({
        channel,
        topic,
        baseDraft,
        tone,
        failureReasons,
        previousText,
      });

      try {
        const rawRetryResponse = await generator.generateText(retryPrompt, {
          responseMimeType: 'application/json',
          temperature: 0.5,
        });

        const parsedRetry = parseJsonSafely<Record<string, any>>(rawRetryResponse);
        if (parsedRetry) {
          // 단일 채널 파싱 형식 대응
          const retryPayloadObj =
            parsedRetry[channel] ? parsedRetry : { [channel]: parsedRetry };
          const newPayload = assemblePayload(channel, retryPayloadObj, media);
          const newEvaluation = evaluateChannelSpec(channel, newPayload, specConfig);

          // 2차 시도 결과 반영 (재검증 후에도 FAIL이면 FAIL 그대로 유지)
          payload = newPayload;
          evaluation = newEvaluation;
        }
      } catch {
        // 재시도 중 예외 발생 시 기존 실패 평가 유지
      }
    }

    const status: 'PASS' | 'FAIL' = evaluation.blocksVault ? 'FAIL' : 'PASS';
    if (status === 'PASS') {
      passCount += 1;
    } else {
      failCount += 1;
    }

    const toneTrace: ToneTrace = {
      tonePreset: tone.key,
      brandVoice: tone.brandVoice,
      rationale: globalToneRationale,
    };

    variantsResult[channel] = {
      channel,
      payload,
      evaluation,
      status,
      retried,
      retryCount,
      tone_trace: toneTrace,
      userStatusLabel: resolveUserStatusLabel(status, evaluation.blocksVault),
    };
  }

  const summaryLabel =
    failCount === 0
      ? `전체 ${channels.length}개 채널 변환 완료 (모두 적합)`
      : `${channels.length}개 중 ${passCount}개 적합, ${failCount}개 확인 필요`;

  return {
    variants: variantsResult,
    summary: {
      totalChannels: channels.length,
      passCount,
      failCount,
      retriedChannels,
      summaryLabel,
    },
  };
}
