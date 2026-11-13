export type CommentToneKey = 'witty' | 'polite' | 'friendly'

export interface CommentToneOption {
  key: CommentToneKey
  label: string
  text: string
}

export function generateCommentToneOptions(params: {
  commentText: string
  authorHandle: string
  baseDraftText: string
  businessName?: string
}): CommentToneOption[] {
  const { authorHandle, baseDraftText, businessName = '저희 매장' } = params
  const base = baseDraftText.trim()
  const handleMention = authorHandle && authorHandle !== 'anonymous' ? `@${authorHandle}님 ` : ''

  // 1. Witty / Sensible (센스/위트형)
  let wittyText = ''
  if (base) {
    if (base.includes('AI') || params.commentText.includes('AI')) {
      wittyText = `앗 ${handleMention}AI 소희가 열심히 꾸민 거 어떻게 아셨죠? 😆 실제 매장은 사람 냄새 가득하고 훨씬 따뜻하답니다 ㅎㅎ 예쁘게 봐주셔서 감사해요! ✨`
    } else {
      wittyText = `어머 ${handleMention}센스 만점 댓글에 오늘 하루 피로가 싹 풀리네요! 😆 좋은 에너지 나눠주셔서 감사드려요, 기분 좋은 하루 보내세요! ☕✨`
    }
  } else {
    wittyText = `반가워요 ${handleMention}기분 좋은 말씀 덕분에 미소가 절로 나네요! 😆 행복한 하루 보내세요 ✨`
  }

  // 2. Polite / Professional (정중/전문가형)
  let politeText = ''
  if (base) {
    politeText = `안녕하세요, ${businessName}입니다. ${handleMention}소중한 관심과 따뜻한 말씀 남겨주셔서 진심으로 감사드립니다. 언제나 정성과 신뢰를 다하는 공간이 되겠습니다. 평안한 하루 보내시길 바랍니다.`
  } else {
    politeText = `안녕하세요, ${businessName}입니다. 찾아주셔서 감사드리며 늘 정성을 다하겠습니다. 좋은 하루 되세요.`
  }

  // 3. Friendly / Neighborly (다정/이웃형)
  let friendlyText = ''
  if (base) {
    friendlyText = base // 기본 생성된 초안이 다정/이웃형 톤에 최적화되어 있음
  } else {
    friendlyText = `안녕하세요 ${handleMention}반가워요! 편안하게 머물다 가실 수 있도록 언제나 정성을 다할게요. 종종 소통하며 지내요 😊`
  }

  return [
    {
      key: 'witty',
      label: '🎯 센스/위트형',
      text: wittyText,
    },
    {
      key: 'polite',
      label: '💼 정중/전문가형',
      text: politeText,
    },
    {
      key: 'friendly',
      label: '☕ 다정/이웃형',
      text: friendlyText,
    },
  ]
}
