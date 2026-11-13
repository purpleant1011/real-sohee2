import { describe, expect, it } from 'vitest'
import { parseConversationImageRequest } from './conversation-image-intent'

describe('parseConversationImageRequest', () => {
  it('recognizes a direct Korean image-generation request and defaults to Instagram', () => {
    expect(parseConversationImageRequest('자연스러운 눈썹 시술 이미지를 만들어줘')).toEqual({
      channel: 'instagram',
      prompt: '자연스러운 눈썹 시술 이미지를 만들어줘',
      count: 1,
    })
  })

  it('recognizes a request to include an image in a proposed post', () => {
    expect(parseConversationImageRequest('포스팅 작성해서 제안해줘. 이미지도 넣어줘')).toEqual({
      channel: 'instagram',
      prompt: '포스팅 작성해서 제안해줘. 이미지도 넣어줘',
      count: 1,
    })
  })

  it('maps explicit Threads and Naver Blog requests to the correct harness channel', () => {
    expect(parseConversationImageRequest('스레드에 쓸 이미지 생성해줘')).toMatchObject({
      channel: 'threads',
    })
    expect(parseConversationImageRequest('네이버 블로그용 사진을 만들어 주세요')).toMatchObject({
      channel: 'naver_blog',
    })
  })

  it('keeps an explicit Threads image request when its topic contains explanation or Instagram comparison text', () => {
    expect(parseConversationImageRequest(
      '바이름 스레드 이미지 1장 만들어줘. 자연스러운 기준을 설명하고 앞선 인스타 문안은 복사하지 말아줘.',
    )).toMatchObject({ channel: 'threads', count: 1 })
  })

  it('does not trigger generation for analysis or negated image requests', () => {
    expect(parseConversationImageRequest('이 이미지가 왜 좋은지 분석해줘')).toBeNull()
    expect(parseConversationImageRequest('이미지는 만들지 말고 문구만 작성해줘')).toBeNull()
  })

  it('parses one to three requested images without silently reducing larger requests', () => {
    expect(parseConversationImageRequest('인스타 이미지 한 장 만들어줘')?.count).toBe(1)
    expect(parseConversationImageRequest('캐러셀 이미지 2장 제작해줘')?.count).toBe(2)
    expect(parseConversationImageRequest('세 컷으로 준비해줘')?.count).toBe(3)
    expect(parseConversationImageRequest('이미지는 만들지 말아줘')).toBeNull()
    expect(parseConversationImageRequest('이미지 네 장 만들어줘')).toBeNull()
    expect(parseConversationImageRequest('이미지 4장 만들어줘')).toBeNull()
  })

  it('accepts up to twenty images only for an explicit Naver Blog request', () => {
    expect(parseConversationImageRequest('네이버 블로그 이미지 12장 생성해줘')).toMatchObject({
      channel: 'naver_blog', count: 12,
    })
    expect(parseConversationImageRequest('네이버 블로그 이미지 20장 생성해줘')?.count).toBe(20)
    expect(parseConversationImageRequest('네이버 블로그 이미지 21장 생성해줘')).toBeNull()
    expect(parseConversationImageRequest('인스타 이미지 12장 생성해줘')).toBeNull()
  })

  it('recognizes an explicit Naver request to reuse existing images without generating new ones', () => {
    expect(parseConversationImageRequest(
      '네이버 블로그에 기존 사용권 확인 이미지 12장을 재사용하고 새 이미지나 사진은 추가 생성하지 마.',
    )).toMatchObject({ channel: 'naver_blog', count: 12 })
  })
})
