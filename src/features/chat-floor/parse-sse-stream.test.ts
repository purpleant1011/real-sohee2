import { describe, it, expect } from 'vitest'
import { parseSseStream } from './parse-sse-stream'

function createStreamFromChunks(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(chunk)
      }
      controller.close()
    }
  })
}

function stringToChunks(text: string, chunkSize = 10): Uint8Array[] {
  const encoder = new TextEncoder()
  const bytes = encoder.encode(text)
  const chunks: Uint8Array[] = []
  for (let i = 0; i < bytes.length; i += chunkSize) {
    chunks.push(bytes.subarray(i, i + chunkSize))
  }
  return chunks
}

describe('parseSseStream', () => {
  it('기본 단일 이벤트를 올바르게 파싱한다', async () => {
    const raw = 'event: run\ndata: {"runId":"run-123"}\n\n'
    const stream = createStreamFromChunks([new TextEncoder().encode(raw)])

    const events: Array<{ event: string; data: any }> = []
    for await (const evt of parseSseStream(stream)) {
      events.push(evt)
    }

    expect(events).toEqual([
      { event: 'run', data: { runId: 'run-123' } }
    ])
  })

  it('다중 이벤트가 한 청크에 와도 각각 분리하여 파싱한다', async () => {
    const raw = [
      'event: run\ndata: {"runId":"run-1"}\n\n',
      'event: progress\ndata: {"kind":"planning","stepIndex":0,"title":"계획 수립"}\n\n',
      'event: result\ndata: {"role":"assistant","content":"완료"}\n\n'
    ].join('')

    const stream = createStreamFromChunks([new TextEncoder().encode(raw)])
    const events: Array<{ event: string; data: any }> = []
    for await (const evt of parseSseStream(stream)) {
      events.push(evt)
    }

    expect(events).toHaveLength(3)
    expect(events[0]).toEqual({ event: 'run', data: { runId: 'run-1' } })
    expect(events[1]).toEqual({ event: 'progress', data: { kind: 'planning', stepIndex: 0, title: '계획 수립' } })
    expect(events[2]).toEqual({ event: 'result', data: { role: 'assistant', content: '완료' } })
  })

  it('청크 경계가 이벤트 중간에 걸려도 정상 파싱한다', async () => {
    const raw = 'event: progress\ndata: {"kind":"step_started","stepIndex":1,"title":"도구 실행"}\n\n'
    // 매우 작은 크기(5바이트)로 쪼개어 청크 경계 분할 테스트
    const chunks = stringToChunks(raw, 5)
    const stream = createStreamFromChunks(chunks)

    const events: Array<{ event: string; data: any }> = []
    for await (const evt of parseSseStream(stream)) {
      events.push(evt)
    }

    expect(events).toEqual([
      {
        event: 'progress',
        data: { kind: 'step_started', stepIndex: 1, title: '도구 실행' }
      }
    ])
  })

  it(': keepalive 등 콜론으로 시작하는 주석 줄은 무시한다', async () => {
    const raw = ': keepalive\n\n: ping\n\nevent: run\ndata: {"runId":"run-99"}\n\n: keepalive\n\n'
    const stream = createStreamFromChunks([new TextEncoder().encode(raw)])

    const events: Array<{ event: string; data: any }> = []
    for await (const evt of parseSseStream(stream)) {
      events.push(evt)
    }

    expect(events).toEqual([
      { event: 'run', data: { runId: 'run-99' } }
    ])
  })

  it('잘못된 JSON 데이터는 무시하고 다음 이벤트를 계속 처리한다', async () => {
    const raw = [
      'event: corrupt\ndata: {this is broken json}\n\n',
      'event: valid\ndata: {"status":"ok"}\n\n'
    ].join('')

    const stream = createStreamFromChunks([new TextEncoder().encode(raw)])
    const events: Array<{ event: string; data: any }> = []
    for await (const evt of parseSseStream(stream)) {
      events.push(evt)
    }

    expect(events).toEqual([
      { event: 'valid', data: { status: 'ok' } }
    ])
  })

  it('UTF-8 멀티바이트(한글)가 청크 경계에 걸쳐 쪼개져도 깨지지 않고 정상 파싱한다', async () => {
    const raw = 'event: progress\ndata: {"title":"마케팅 계획 수립 중입니다"}\n\n'
    const fullBytes = new TextEncoder().encode(raw)

    // 한글 바이트 중간을 임의로 쪼갬 (예: 31번째 바이트)
    const chunk1 = fullBytes.subarray(0, 31)
    const chunk2 = fullBytes.subarray(31)

    const stream = createStreamFromChunks([chunk1, chunk2])
    const events: Array<{ event: string; data: any }> = []
    for await (const evt of parseSseStream(stream)) {
      events.push(evt)
    }

    expect(events).toEqual([
      { event: 'progress', data: { title: '마케팅 계획 수립 중입니다' } }
    ])
  })
})
