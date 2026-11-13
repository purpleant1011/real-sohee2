import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { SafeChatMarkdown } from './safe-markdown'

describe('채팅 안전 마크다운', () => {
  it('굵게·목록·안전 링크를 표시하며 마크다운 원문과 코드 블록은 노출하지 않는다', () => {
    const html = renderToStaticMarkup(<SafeChatMarkdown content={'**중요**\n- 첫째\n- 둘째\n[도움말](https://example.com/help)\n```js\nsecret()\n```'} />)
    expect(html).toContain('<strong>중요</strong>')
    expect(html).toContain('<li>첫째</li>')
    expect(html).toContain('href="https://example.com/help"')
    expect(html).not.toContain('**')
    expect(html).not.toContain('- 첫째')
    expect(html).not.toContain('secret()')
  })

  it('HTML 및 javascript 링크는 실행하거나 삽입하지 않는다', () => {
    const html = renderToStaticMarkup(<SafeChatMarkdown content={'<img src=x onerror=alert(1)> [눌러](javascript:alert(1))'} />)
    expect(html).not.toContain('<img')
    expect(html).not.toContain('href="javascript:')
    expect(html).toContain('&lt;img')
  })

  it('구분선(---), 인용구(>), 제목(#~###)을 안전하게 렌더링한다', () => {
    const content = [
      '# 메인 제목',
      '## 서브 제목',
      '### 상세 제목',
      '---',
      '> 인용구 내용입니다',
      '> 둘째 줄 인용구',
      '일반 단락 내용',
    ].join('\n')

    const html = renderToStaticMarkup(<SafeChatMarkdown content={content} />)

    // 제목은 굵은 단락(p 태그 + font-bold)으로 렌더링
    expect(html).toContain('<p class="font-bold">메인 제목</p>')
    expect(html).toContain('<p class="font-bold">서브 제목</p>')
    expect(html).toContain('<p class="font-bold">상세 제목</p>')
    expect(html).not.toContain('# 메인 제목')

    // 구분선은 hr 태그로 렌더링
    expect(html).toContain('<hr')

    // 인용구는 blockquote 태그로 렌더링
    expect(html).toContain('<blockquote')
    expect(html).toContain('인용구 내용입니다')
    expect(html).not.toContain('&gt; 인용구 내용입니다')
  })

  it('구분선, 인용구, 제목에 악의적인 스크립트/HTML 주입 시 안전하게 이스케이프한다', () => {
    const malicious = [
      '# <script>alert("h1")</script>',
      '> <b onmouseover=alert(1)>인용 XSS</b>',
      '---',
      '<iframe src="evil.com"></iframe>',
    ].join('\n')

    const html = renderToStaticMarkup(<SafeChatMarkdown content={malicious} />)

    expect(html).not.toContain('<script>')
    expect(html).not.toContain('<b ')
    expect(html).not.toContain('<iframe')
    expect(html).toContain('&lt;script&gt;alert(&quot;h1&quot;)&lt;/script&gt;')
    expect(html).toContain('&lt;b onmouseover=alert(1)&gt;인용 XSS&lt;/b&gt;')
  })
})
