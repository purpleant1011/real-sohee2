export type PostingChannelId = 'instagram' | 'threads' | 'naver_blog' | 'daangn_business'
export type PostingPurposeId = 'promotion' | 'daily' | 'branding' | 'event'
export type ModeId = 'posting' | 'teach' | 'inquiry' | 'insight'

export const POSTING_PURPOSES: ReadonlyArray<{ id: PostingPurposeId; label: string }> = [
  { id: 'promotion', label: '프로모션' },
  { id: 'daily', label: '일상' },
  { id: 'branding', label: '홍보' },
  { id: 'event', label: '이벤트' },
]

/** auto: 소희가 API 로 바로 게시·관리할 수 있는 채널. manual: 복사·내보내기로 사장님이 직접 올리는 채널. */
export const POSTING_CHANNELS: ReadonlyArray<{ id: PostingChannelId; label: string; mode: 'auto' | 'manual' }> = [
  { id: 'instagram', label: '인스타그램', mode: 'auto' },
  { id: 'threads', label: '스레드', mode: 'auto' },
  { id: 'naver_blog', label: '네이버 블로그', mode: 'manual' },
  { id: 'daangn_business', label: '당근', mode: 'manual' },
]

export type ModeValues = Readonly<{ purpose?: PostingPurposeId | null; channels?: readonly PostingChannelId[] }>

export type ConversationMode = Readonly<{
  id: ModeId
  label: string
  description: string
  /** 선택 입력이 필요한 모드(허브가 2단계 선택을 그린다). */
  needsSetup: boolean
}>

/** 새 대화 종류는 여기에 한 줄 추가하면 허브에 나타난다. */
export const CONVERSATION_MODES: ReadonlyArray<ConversationMode> = [
  { id: 'posting', label: '포스팅 만들기', description: '글과 이미지를 채널에 맞게 만들어요', needsSetup: true },
  { id: 'teach', label: '소희 가르치기', description: '우리 가게를 알려 주면 소희가 물어봐요', needsSetup: false },
  { id: 'inquiry', label: '고객 문의 답변', description: '받은 DM·댓글 답변을 함께 정리해요', needsSetup: false },
  { id: 'insight', label: '성과 점검', description: '지난 게시와 반응을 돌아봐요', needsSetup: false },
]

export function isModeReady(mode: ModeId, values: ModeValues): boolean {
  if (mode !== 'posting') return true
  const purposeOk = POSTING_PURPOSES.some(p => p.id === values.purpose)
  const channelOk = (values.channels ?? []).some(c => POSTING_CHANNELS.some(x => x.id === c))
  return purposeOk && channelOk
}

/** 선택을 사용자 첫 메시지로 만든다. 사장님이 '시작'을 눌러야 전송되며, 소희는 먼저 질문한다. */
export function buildModePrompt(mode: ModeId, values: ModeValues): string {
  if (mode === 'posting') {
    const purpose = POSTING_PURPOSES.find(p => p.id === values.purpose)?.label
    const channels = POSTING_CHANNELS.filter(c => (values.channels ?? []).includes(c.id)).map(c => c.label)
    const where = channels.length > 0 ? `${channels.join(', ')}에 올릴 ` : ''
    return `${where}${purpose ? `${purpose} ` : ''}포스팅을 만들어줘. 만들기 전에 필요한 것을 먼저 질문해줘.`
  }
  if (mode === 'teach') return '우리 가게에 대해 소희가 알아야 할 것을 가르치고 싶어. 궁금한 것부터 하나씩 질문해줘.'
  if (mode === 'inquiry') return '받은 고객 문의와 댓글을 함께 정리하고 답변을 준비해줘. 먼저 확인할 것을 질문해줘.'
  return '지난 게시와 반응을 돌아보고 다음에 할 일을 제안해줘. 먼저 보고 싶은 기간을 질문해줘.'
}
