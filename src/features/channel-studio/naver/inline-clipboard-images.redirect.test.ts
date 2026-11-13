// @vitest-environment node
import { createServer } from 'node:http'
import { once } from 'node:events'
import { expect, it } from 'vitest'
import { inlineClipboardImages } from './inline-clipboard-images'
import { buildNaverHtmlContent } from './copy-naver-post'

it('실제 미디어 API의 307을 따라 사진을 인라인화하고 서명 주소는 복사하지 않는다', async () => {
  const mediaId = '20000000-0000-4000-8000-000000000001'
  const src = `/api/workspaces/10000000-0000-4000-8000-000000000001/media/${mediaId}`
  const server = createServer((request, response) => {
    if (request.url === src) {
      response.writeHead(307, { location: '/storage/object/sign/photo.png?token=fixture-only' })
      response.end()
    } else {
      response.writeHead(200, { 'content-type': 'image/png' })
      response.end(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    }
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  try {
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('test server unavailable')
    const fetcher: typeof fetch = (input, init) => fetch(`http://127.0.0.1:${address.port}${input}`, init)
    const post = await inlineClipboardImages({ title: '사진 복사', introduction: '도입', sections: [],
      editorBlocks: [{ kind: 'image', mediaId, altText: '검증 사진' }], media: [{ id: mediaId, src }],
    }, fetcher)
    const html = buildNaverHtmlContent(post, 'body')
    expect(html).toContain('data:image/png;base64,iVBORw0KGgo=')
    expect(html).not.toContain('/api/workspaces/')
    expect(html).not.toContain('token=')
    expect(html).not.toContain('/storage/')
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  }
})
