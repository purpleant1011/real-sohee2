import { revisionInputSchema } from '@/features/content/version-schema'
import type {
  RevisionInput,
  RevisionProvider,
  RevisionResult,
} from './revision-provider'

const fingerprintOpeners = [
  '핵심이 바로 보이도록 정리했어요.',
  '첫 문장에 자연스럽게 시선이 머물게 했어요.',
  '읽는 흐름이 부드럽게 이어지도록 다듬었어요.',
  '가장 중요한 메시지에 힘을 실었어요.',
  '짧게 읽어도 의미가 남도록 정리했어요.',
  '친근하지만 신뢰감 있는 흐름으로 다듬었어요.',
  '전하고 싶은 장면이 떠오르도록 구성했어요.',
] as const

const instructionStyles = [
  '부드러운 어조로 마무리했어요.',
  '간결한 리듬을 살려 정리했어요.',
  '신뢰감 있는 표현을 중심으로 다듬었어요.',
  '따뜻한 호흡이 느껴지도록 정리했어요.',
  '다음 행동이 명확하게 보이도록 다듬었어요.',
] as const

const channelContent = {
  instagram: {
    name: '인스타그램',
    hashtag: '#인스타그램',
    closing: '이미지와 함께 차분히 확인해 보세요.',
  },
  threads: {
    name: '스레드',
    hashtag: '#스레드',
    closing: '이야기를 이어갈 생각을 댓글로 나눠 보세요.',
  },
} as const

const inputTypeContent = {
  caption: {
    caption: '문구를 중심으로 핵심을 선명하게 다듬었어요.',
    hashtags: ['#문구다듬기'],
    disclosure: '문구 수정을 위한 모의 실행 예시입니다.',
    reason: '문구 수정 지시를 반영했어요.',
  },
  hashtags: {
    caption: '주제와 핵심 단어가 자연스럽게 연결되도록 정리했어요.',
    hashtags: ['#해시태그정리', '#주제모음'],
    disclosure: '해시태그 수정을 위한 모의 실행 예시입니다.',
    reason: '해시태그 수정 지시를 반영했어요.',
  },
  disclosure: {
    caption: '필수 안내가 본문의 흐름과 어우러지도록 정리했어요.',
    hashtags: ['#필수고지'],
    disclosure: '고지 문구를 명확하게 다듬은 모의 실행 예시입니다.',
    reason: '고지 문구 수정 지시를 반영했어요.',
  },
  full: {
    caption: '전체 문구의 흐름과 핵심 메시지를 함께 다듬었어요.',
    hashtags: ['#전체수정', '#콘텐츠점검'],
    disclosure: '전체 내용과 고지를 함께 정리한 모의 실행 예시입니다.',
    reason: '전체 수정 지시를 반영했어요.',
  },
} as const

function stableIndex(value: string, length: number): number {
  let hash = 2_166_136_261

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16_777_619)
  }

  return (hash >>> 0) % length
}

export const mockRevisionProvider: RevisionProvider = {
  mode: 'mock',
  async revise(rawInput: RevisionInput): Promise<RevisionResult> {
    const input = revisionInputSchema.parse(rawInput)
    const channel = channelContent[input.channel]
    const change = inputTypeContent[input.inputType]
    const opener = fingerprintOpeners[
      stableIndex(
        `${input.inputType}\u0000${input.currentVersionFingerprint}`,
        fingerprintOpeners.length,
      )
    ]
    const instructionStyle = instructionStyles[
      stableIndex(`${input.channel}\u0000${input.instruction}`, instructionStyles.length)
    ]

    return {
      caption: `[모의 소희 예시] ${channel.name}용 콘텐츠입니다. ${opener} ${instructionStyle} ${change.caption} ${channel.closing}`,
      hashtags: [channel.hashtag, '#모의소희', '#예시콘텐츠', ...change.hashtags],
      disclosure: `${change.disclosure} 실제 게시 전에 반드시 검토해 주세요.`,
      revisionReason: `모의 수정: ${change.reason} ${instructionStyle}`,
    }
  },
}
