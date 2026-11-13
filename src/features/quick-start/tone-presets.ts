export const TONE_PRESET_KEYS = [
  'friendly',
  'trendy',
  'calm',
  'professional',
  'witty',
  'warm_heart',
] as const
export type TonePresetKey = (typeof TONE_PRESET_KEYS)[number]

export interface TonePreset {
  key: TonePresetKey
  label: string
  description: string
  /** Shown to the owner so they can feel the tone before choosing it. */
  sample: string
  /** Instruction handed to the text model as the brand voice. */
  brandVoice: string
}

export const TONE_PRESETS: readonly TonePreset[] = [
  {
    key: 'friendly',
    label: '친근하고 다정하게',
    description: '이웃에게 말 걸듯 편안하고 따뜻한 말투 (인기 추천)',
    sample: '오늘도 찾아주셔서 고마워요 :) 날씨가 쌀쌀한데 따뜻한 차 한 잔 하고 가세요!',
    brandVoice: '이웃에게 말을 건네듯 친근하고 다정한 존댓말. 이모지는 문장당 최대 1~2개, 과장 없이 따뜻하게.',
  },
  {
    key: 'trendy',
    label: '트렌디하고 감성 있게',
    description: '2030 감성의 감각적이고 통통 튀는 말투',
    sample: '햇살 맛집 오픈 ✨ 이번 주 신상 디저트 놓치면 아쉬워요, 지금 피드 저장 필수!',
    brandVoice: 'SNS 감성의 짧고 세련된 문장. 이모지와 줄바꿈을 감각적으로 쓰되 허위·과장 표현은 금지.',
  },
  {
    key: 'calm',
    label: '담백하고 정갈하게',
    description: '꾸밈 없이 단정하고 깊은 여운을 주는 말투',
    sample: '좋은 재료를 골라 정성껏 준비했습니다. 편안한 시간에 머물다 가세요.',
    brandVoice: '꾸밈을 줄이고 담백하며 정갈한 존댓말. 감탄사와 이모지를 최소화하고 핵심 정보 위주로.',
  },
  {
    key: 'professional',
    label: '전문적이고 신뢰감 있게',
    description: '1:1 맞춤 케어와 풍부한 경험이 느껴지는 말투',
    sample: '고객님의 니즈와 컨디션에 맞춰 꼼꼼하게 시술합니다. 편하게 예약 문의 남겨주세요.',
    brandVoice: '전문가다운 차분하고 신뢰감 있는 존댓말. 근거 없는 효과·수치 주장은 금지하고 정확하게.',
  },
  {
    key: 'witty',
    label: '위트 있고 유쾌하게',
    description: '지친 일상에 미소를 주는 밝은 에너지의 말투',
    sample: '오늘 하루도 수고 많으셨어요! 맛있는 음식과 시원한 한 잔으로 스트레스 확 날려버려요 🍻',
    brandVoice: '유쾌하고 재치 있는 존댓말. 에너지 넘치는 감탄사와 유머러스한 비유를 적절히 활용.',
  },
  {
    key: 'warm_heart',
    label: '진심을 담은 장인처럼',
    description: '사장님의 뚝심과 철학이 느껴지는 진솔한 말투',
    sample: '매일 새벽 반죽을 빚을 때마다 설렙니다. 내 가족에게 먹인다는 마음으로 굽습니다.',
    brandVoice: '진심과 자부심이 느껴지는 따뜻한 존댓말. 매장의 고유한 철학과 정성을 솔직하게 전달.',
  },
] as const

export function getTonePreset(key: string | undefined | null): TonePreset {
  return TONE_PRESETS.find((t) => t.key === key) ?? TONE_PRESETS[0]
}
