export interface SseEvent<T = any> {
  event: string
  data: T
  id?: string
}

/** Parse JSON SSE across chunk/UTF-8/CRLF boundaries without exposing malformed frames. */
export async function* parseSseStream(
  stream: ReadableStream<Uint8Array>
): AsyncGenerator<SseEvent> {
  const reader = stream.getReader()
  const decoder = new TextDecoder('utf-8', { fatal: false })
  let buffer = ''
  let event = 'message'
  let id: string | undefined
  let data: string[] = []

  const line = (text: string): SseEvent | undefined => {
    if (text.endsWith('\r')) text = text.slice(0, -1)
    if (text === '') {
      const frame = { event, ...(id !== undefined ? { id } : {}) }
      const raw = data.join('\n')
      event = 'message'
      id = undefined
      data = []
      if (!raw) return
      try { return { ...frame, data: JSON.parse(raw) } } catch { return }
    }
    if (text.startsWith(':')) return
    const colon = text.indexOf(':')
    if (colon === -1) return
    const field = text.slice(0, colon).trim()
    let value = text.slice(colon + 1)
    if (value.startsWith(' ')) value = value.slice(1)
    if (field === 'event') event = value
    else if (field === 'data') data.push(value)
    else if (field === 'id' && !value.includes('\0')) id = value
  }

  try {
    while (true) {
      const { done, value } = await reader.read()
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true })
      let newline: number
      while ((newline = buffer.indexOf('\n')) !== -1) {
        const frame = line(buffer.slice(0, newline))
        buffer = buffer.slice(newline + 1)
        if (frame) yield frame
      }
      if (done) break
    }
    if (buffer) line(buffer)
    const trailing = line('')
    if (trailing) yield trailing
  } finally {
    reader.releaseLock()
  }
}
