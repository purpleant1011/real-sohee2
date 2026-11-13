import { expect, it } from 'vitest'
import { parseSseStream } from '@/features/chat-floor/parse-sse-stream'
it('청크 경계를 넘어 SSE id를 보존하고 id가 없는 result에 복사하지 않는다', async () => {
  const stream = new ReadableStream<Uint8Array>({ start(controller) {
    for (const text of ['id: 1', '2\r\nevent: activity\r\ndata: {"sequence":12}\r\n\r\n', 'event: result\ndata: {}\n\n']) controller.enqueue(new TextEncoder().encode(text))
    controller.close()
  } })
  const events = []
  for await (const event of parseSseStream(stream)) events.push(event)
  expect(events).toEqual([{ id: '12', event: 'activity', data: { sequence: 12 } }, { event: 'result', data: {} }])
})
