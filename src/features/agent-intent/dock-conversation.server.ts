import { getGeminiApiBaseUrl, getModelProfile, getTextApiKey } from '@/lib/ai/model-profiles'

/** Read-only conversational fallback: no tools or execution instructions are supplied. */
export async function replyToAmbiguousDockTurn(message: string): Promise<string> {
  const apiKey = getTextApiKey()
  if (!apiKey) return '지금은 대화 응답을 준비하지 못했어요. 잠시 후 다시 말씀해 주세요.'

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15_000)
  try {
    const response = await fetch(
      `${getGeminiApiBaseUrl()}/v1beta/models/${encodeURIComponent(getModelProfile('conversation').modelId)}:generateContent`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: '당신은 소상공인 마케팅 도우미 소희입니다. 사장님께 자연스러운 한국어로 간결히 답하세요. 도구 실행, 발행, 계정 연결을 했다고 주장하지 마세요. 위험한 작업은 반드시 콘텐츠 미리보기와 사장님의 별도 승인이 필요합니다.' }] },
          contents: [{ role: 'user', parts: [{ text: message.slice(0, 500) }] }],
          generationConfig: { temperature: 0.4, maxOutputTokens: 512 },
        }),
        signal: controller.signal,
      },
    )
    if (!response.ok) throw new Error('Gemini conversational fallback failed')
    const data = await response.json()
    const reply = data?.candidates?.[0]?.content?.parts?.find((part: { text?: string }) => typeof part.text === 'string')?.text?.trim()
    return reply || '요청을 이해하지 못했어요. 하고 싶은 일을 조금 더 구체적으로 말씀해 주세요.'
  } catch {
    return '지금은 대화 응답을 준비하지 못했어요. 잠시 후 다시 말씀해 주세요.'
  } finally {
    clearTimeout(timeout)
  }
}
