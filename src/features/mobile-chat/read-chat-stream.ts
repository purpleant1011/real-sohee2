import { CHAT_SEND_FAILED_NOTICE, type ChatSendResult } from './chat-send'
import { sendOutcomeFromStream } from './r2-chat-snapshot'

/** 서버가 시작한 응답의 텍스트만 미확정 상태로 전달한다. 업무 실행 상태는 추측하지 않는다. */
export async function readChatStream(
  response: Response,
  onText: (messageId: string, text: string) => void,
): Promise<ChatSendResult> {
  if (!response.ok || !response.body) return { ok: false, message: CHAT_SEND_FAILED_NOTICE }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffered = ''
  let body = ''
  let messageId: string | null = null
  let text = ''
  let terminal = false

  function consume(line: string) {
    let event: unknown
    try {
      event = JSON.parse(line)
    } catch {
      return
    }
    if (typeof event !== 'object' || event === null || !('type' in event)) return
    if (event.type === 'message.started' && 'messageId' in event
      && typeof event.messageId === 'string' && event.messageId.trim() !== '') {
      messageId = event.messageId
      text = ''
    } else if (!terminal && event.type === 'message.delta' && 'messageId' in event
      && event.messageId === messageId && messageId !== null
      && 'delta' in event && typeof event.delta === 'string') {
      text += event.delta
      onText(messageId, text)
    } else if (event.type === 'message.failed' || event.type === 'message.completed') {
      terminal = true
    }
  }

  try {
    while (true) {
      const chunk = await reader.read()
      const decoded = decoder.decode(chunk.value, { stream: !chunk.done })
      body += decoded
      buffered += decoded
      const lines = buffered.split('\n')
      buffered = lines.pop() ?? ''
      for (const line of lines) consume(line)
      if (chunk.done) {
        if (buffered.trim()) consume(buffered)
        break
      }
    }
    return sendOutcomeFromStream({ status: response.status, body })
  } finally {
    reader.releaseLock()
  }
}
