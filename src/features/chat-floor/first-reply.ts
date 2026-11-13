export interface FirstReply {
  content: string
  fallback: boolean
  suggestedQuestions: string[]
}

const QUESTIONS = [
  '소희는 어떤 일을 도와줄 수 있어?',
  '우리 매장 소개 글을 어떻게 시작할까?',
  '이번 주 홍보 아이디어를 알려줘',
]

/** Only an actual answer is a success; never represent an unpersisted action as complete. */
export async function answerFirstTurn({ answer, timeoutMs = 15_000 }: {
  answer: (signal: AbortSignal) => Promise<string>
  timeoutMs?: number
}): Promise<FirstReply> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  let onAbort: (() => void) | undefined
  try {
    const timeout = new Promise<never>((_, reject) => {
      onAbort = () => reject(new Error('TIMEOUT'))
      controller.signal.addEventListener('abort', onAbort, { once: true })
    })
    const content = (await Promise.race([answer(controller.signal), timeout])).trim()
    if (!content) throw new Error('EMPTY_REPLY')
    return { content, fallback: false, suggestedQuestions: [] }
  } catch {
    return {
      content: '지금은 답변을 준비하거나 저장하는 과정이 원활하지 않아 일반 안내로 대신할게요. 아직 요청하신 작업을 완료한 것은 아니에요.\n\n소희가 할 수 있는 일\n- 매장 소개와 홍보 문구 초안 제안\n- 게시물 아이디어와 일정 정리\n- 준비한 내용을 함께 검토하기\n\n잠시 후 다시 해볼게요. 문제가 계속되면 문의하기를 이용해 주세요.',
      fallback: true,
      suggestedQuestions: [...QUESTIONS],
    }
  } finally {
    clearTimeout(timer)
    if (onAbort) controller.signal.removeEventListener('abort', onAbort)
  }
}
