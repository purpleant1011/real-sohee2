import type { TonePresetDefinition, TonePresetKey } from './types';

export const TRANSFORM_TONE_PRESETS: readonly TonePresetDefinition[] = [
  {
    key: 'friendly',
    label: '친근하고 다정하게',
    description: '이웃에게 말 걸듯 편안한 말투',
    sample: '오늘도 찾아주셔서 고마워요 :) 따뜻한 한 잔 하고 가세요!',
    brandVoice: '이웃에게 말을 건네듯 친근하고 다정한 존댓말. 이모지는 문장당 최대 1개, 과장 없이 따뜻하게.',
  },
  {
    key: 'calm',
    label: '담백하고 정갈하게',
    description: '꾸밈 없이 믿음이 가는 말투',
    sample: '정성껏 준비한 메뉴를 소개합니다. 편한 시간에 들러 주세요.',
    brandVoice: '꾸밈을 줄이고 담백하며 정갈한 존댓말. 감탄사와 이모지를 최소화하고 핵심 정보 위주로.',
  },
  {
    key: 'trendy',
    label: '트렌디하고 가볍게',
    description: 'SNS 감성의 짧고 경쾌한 말투',
    sample: '이번 주 인생템 발견 ✨ 놓치면 아쉬워요, 저장해두기!',
    brandVoice: 'SNS 감성의 짧고 경쾌한 문장. 이모지와 줄바꿈을 적당히 쓰되 허위·과장 표현은 금지.',
  },
  {
    key: 'professional',
    label: '전문적이고 신뢰감 있게',
    description: '경력과 정확함이 느껴지는 말투',
    sample: '고객님의 상황에 맞춰 꼼꼼하게 안내해 드립니다. 상담을 편하게 문의해 주세요.',
    brandVoice: '전문가다운 차분하고 신뢰감 있는 존댓말. 근거 없는 효과·수치 주장은 금지하고 정확하게.',
  },
] as const;

export function resolveTonePreset(
  keyOrName?: TonePresetKey | string | null
): TonePresetDefinition {
  if (!keyOrName) return TRANSFORM_TONE_PRESETS[0];
  const matched = TRANSFORM_TONE_PRESETS.find(
    (preset) => preset.key === keyOrName || preset.label === keyOrName
  );
  if (matched) return matched;

  // 알 수 없는 문자열인 경우 커스텀 어조로 수용하되 기본 friendly를 기반으로 정의
  return {
    key: 'friendly',
    label: keyOrName,
    description: '맞춤형 지정 말투',
    sample: '',
    brandVoice: keyOrName,
  };
}
