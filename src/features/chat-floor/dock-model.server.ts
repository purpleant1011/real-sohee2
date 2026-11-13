import { getGeminiApiBaseUrl, getModelProfile, getTextApiKey } from '@/lib/ai/model-profiles'

/** Read-only conversational adapter. No execution tools or external writes. */
export async function answerDockQuestion(message: string, signal: AbortSignal): Promise<string> {
  const key = getTextApiKey()
  if (!key) throw new Error('MODEL_UNAVAILABLE')
  const response = await fetch(
    `${getGeminiApiBaseUrl()}/v1beta/models/${encodeURIComponent(getModelProfile('conversation').modelId)}:generateContent`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: '당신은 소상공인 마케팅 도우미 소희입니다. 사장님께 자연스러운 한국어로 간결히 답하세요. 도구 실행, 발행, 계정 연결을 했다고 주장하지 마세요. 위험한 작업은 반드시 콘텐츠 미리보기와 사장님의 별도 승인이 필요합니다.' }] },
        contents: [{ role: 'user', parts: [{ text: message.slice(0, 500) }] }],
        generationConfig: { temperature: 0.4, maxOutputTokens: 512 },
      }),
      signal,
    },
  )
  if (!response.ok) throw new Error('MODEL_UNAVAILABLE')
  const data = await response.json()
  return data?.candidates?.[0]?.content?.parts?.find((part: { text?: string }) => typeof part.text === 'string')?.text?.trim() || ''
}
