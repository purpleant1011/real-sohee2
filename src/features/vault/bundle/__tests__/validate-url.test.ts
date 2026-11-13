import { describe, it, expect, vi } from 'vitest'
import { validatePublishUrl } from '../validate-url'

describe('validatePublishUrl (ANI-1541)', () => {
  it('rejects URLs not starting with https', () => {
    const httpResult = validatePublishUrl('naver_blog', 'http://blog.naver.com/my_id/12345678')
    expect(httpResult.valid).toBe(false)
    expect(httpResult.error).toContain('https://')

    const ftpResult = validatePublishUrl('daangn_business', 'ftp://daangn.com/posts/1')
    expect(ftpResult.valid).toBe(false)

    const emptyResult = validatePublishUrl('naver_blog', '   ')
    expect(emptyResult.valid).toBe(false)
    expect(emptyResult.error).toBeDefined()
  })

  it.each([
    'https://blog.naver.com/',
    'https://blog.naver.com/my_shop',
    'https://in.naver.com/my_shop',
    'https://evil.blog.naver.com/my_shop/223456789012',
    'https://name:secret@blog.naver.com/my_shop/223456789012',
    'https://blog.naver.com:444/my_shop/223456789012',
  ])('rejects a profile, credentials, or non-post naver address: %s', url => {
    expect(validatePublishUrl('naver_blog', url).valid).toBe(false)
  })

  it('normalizes equivalent mobile/query post URLs to one unverified address', () => {
    const expected = 'https://blog.naver.com/my_shop/223456789012'
    for (const url of [
      'https://m.blog.naver.com/my_shop/223456789012?tracking=test',
      'https://blog.naver.com/PostView.naver?blogId=my_shop&logNo=223456789012',
    ]) expect(validatePublishUrl('naver_blog', url)).toMatchObject({ valid: true, normalizedUrl: expected })
  })

  it('validates naver_blog post addresses', () => {
    const validBlog = validatePublishUrl('naver_blog', 'https://blog.naver.com/sohee_cafe/223456789012')
    expect(validBlog.valid).toBe(true)
    expect(validBlog.normalizedUrl).toBe('https://blog.naver.com/sohee_cafe/223456789012')

    const validMobile = validatePublishUrl('naver_blog', 'https://m.blog.naver.com/sohee_cafe/223456789012')
    expect(validMobile.valid).toBe(true)

    const invalidDomain = validatePublishUrl('naver_blog', 'https://other-site.com/blog/1234')
    expect(invalidDomain.valid).toBe(false)
    expect(invalidDomain.error).toContain('네이버 블로그')
  })

  it('validates daangn_business URL with relaxed domain matching', () => {
    const validDaangn1 = validatePublishUrl('daangn_business', 'https://www.daangn.com/kr/business-posts/12345')
    expect(validDaangn1.valid).toBe(true)

    const validDaangn2 = validatePublishUrl('daangn_business', 'https://daangn.com/articles/98765')
    expect(validDaangn2.valid).toBe(true)

    const validDaangn3 = validatePublishUrl('daangn_business', 'https://business.daangn.com/story/54321')
    expect(validDaangn3.valid).toBe(true)

    const invalidDaangn = validatePublishUrl('daangn_business', 'https://blog.naver.com/article/1')
    expect(invalidDaangn.valid).toBe(false)
    expect(invalidDaangn.error).toContain('당근')
  })

  it('validates instagram and threads URLs', () => {
    const validIg = validatePublishUrl('instagram', 'https://www.instagram.com/p/DA123456789/')
    expect(validIg.valid).toBe(true)

    const validThreads = validatePublishUrl('threads', 'https://www.threads.net/@my_shop/post/DA12345')
    expect(validThreads.valid).toBe(true)

    const invalidIg = validatePublishUrl('instagram', 'https://facebook.com/post/1')
    expect(invalidIg.valid).toBe(false)
  })

  it('does not perform any external network request', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    validatePublishUrl('naver_blog', 'https://blog.naver.com/sohee/123')
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })
})
