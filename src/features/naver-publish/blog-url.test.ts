import { describe, expect, it } from 'vitest'
import { parseNaverBlogPostUrl, postViewUrl } from './blog-url'

describe('parseNaverBlogPostUrl', () => {
  it('parses the canonical blogId/logNo URL', () => {
    expect(parseNaverBlogPostUrl('https://blog.naver.com/findk3/224396212806')).toEqual({ blogId: 'findk3', logNo: '224396212806' })
  })

  it('ignores tracking query parameters', () => {
    expect(parseNaverBlogPostUrl('https://blog.naver.com/findk3/224396212806?fromRss=true&trackingCode=rss')).toEqual({ blogId: 'findk3', logNo: '224396212806' })
  })

  it('parses the mobile host and the PostView form', () => {
    expect(parseNaverBlogPostUrl('https://m.blog.naver.com/findk3/224396212806')).toEqual({ blogId: 'findk3', logNo: '224396212806' })
    expect(parseNaverBlogPostUrl('https://blog.naver.com/PostView.naver?blogId=findk3&logNo=224396212806')).toEqual({ blogId: 'findk3', logNo: '224396212806' })
  })

  it('rejects other hosts, lookalikes and non-https schemes', () => {
    expect(parseNaverBlogPostUrl('http://blog.naver.com/findk3/224396212806')).toBeNull()
    expect(parseNaverBlogPostUrl('https://blog.naver.com.evil.example/findk3/224396212806')).toBeNull()
    expect(parseNaverBlogPostUrl('https://evil.example/blog.naver.com/findk3/224396212806')).toBeNull()
    expect(parseNaverBlogPostUrl('javascript:alert(1)')).toBeNull()
    expect(parseNaverBlogPostUrl('not a url')).toBeNull()
  })

  it('rejects non-post pages and malformed ids', () => {
    expect(parseNaverBlogPostUrl('https://blog.naver.com/findk3')).toBeNull()
    expect(parseNaverBlogPostUrl('https://blog.naver.com/findk3/abc')).toBeNull()
    expect(parseNaverBlogPostUrl('https://blog.naver.com/PostList.naver?blogId=findk3')).toBeNull()
    expect(parseNaverBlogPostUrl('https://blog.naver.com/a b/224396212806')).toBeNull()
  })
})

describe('postViewUrl', () => {
  it('builds the server-rendered PostView URL', () => {
    expect(postViewUrl({ blogId: 'findk3', logNo: '224396212806' })).toBe(
      'https://blog.naver.com/PostView.naver?blogId=findk3&logNo=224396212806&redirect=Dlog&widgetTypeCall=true&directAccess=true',
    )
  })
})
