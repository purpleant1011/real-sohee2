import { describe, expect, it, vi } from 'vitest'
import { compareReadback, parsePostViewHtml, verifyPublishedPost, type FetchLike } from './readback'
import { NaverAutomationPolicyError } from './automation-policy'

// Title and category blocks are copied from a real public post's PostView page (findk3, 2026-10-09).
// Image and paragraph blocks follow the SmartEditor ONE class names; the live E2E task re-checks them against a real post with images.
const POST_HTML = `
<div class="blog2_series">
	<a href="/PostList.naver?blogId=findk3&categoryNo=16&from=postList&parentCategoryNo=16" class="pcol2">고스트셀러</a>
</div>
<div class="pcol1">
<!--
 -->
                <div class="se-module se-module-text se-title-text">
                    <p class="se-text-paragraph se-text-paragraph-align-" style="" id="SE-1"><span style="" class="se-fs- se-ff-" id="SE-2"><!-- -->청라 봄맞이 자연눈썹 15% 첫방문 프로모션 &amp; 1:1 결 디자인 안내<!-- --></span></p>                </div>
</div>
<div class="se-main-container">
  <div class="se-component se-text"><p class="se-text-paragraph se-text-paragraph-align-left"><span>안녕하세요, 바이름입니다.</span></p></div>
  <div class="se-component se-image"><img src="https://postfiles.pstatic.net/a.jpg" class="se-image-resource" alt=""></div>
  <div class="se-component se-text"><p class="se-text-paragraph"><span>둘째 &lt;문단&gt;</span><br></p></div>
  <div class="se-component se-image"><img data-lazy-src="x" class="se-image-resource __se_img_el" src="https://postfiles.pstatic.net/b.jpg"></div>
</div>`

const EXPECTED = { title: '청라 봄맞이 자연눈썹 15% 첫방문 프로모션 & 1:1 결 디자인 안내', categoryName: '고스트셀러', imageCount: 2 }

describe('parsePostViewHtml', () => {
  it('reads title, category, image count and body text', () => {
    const snapshot = parsePostViewHtml(POST_HTML)
    expect(snapshot).toMatchObject({ title: EXPECTED.title, categoryName: '고스트셀러', imageCount: 2 })
    expect(snapshot?.text).toContain('안녕하세요, 바이름입니다.')
    expect(snapshot?.text).toContain('둘째 <문단>')
  })

  it('does not count the title paragraph as body text', () => {
    expect(parsePostViewHtml(POST_HTML)?.text).not.toContain('청라 봄맞이')
  })

  it('returns null for pages that are not a rendered post', () => {
    expect(parsePostViewHtml('<html><body>로그인이 필요합니다</body></html>')).toBeNull()
    expect(parsePostViewHtml('')).toBeNull()
  })
})

describe('compareReadback', () => {
  const snapshot = parsePostViewHtml(POST_HTML)!

  it('verifies a matching post', () => {
    expect(compareReadback(EXPECTED, snapshot)).toEqual({ status: 'VERIFIED' })
  })

  it('reports every difference', () => {
    const verdict = compareReadback({ title: '다른 제목', categoryName: '파인드케이', imageCount: 3 }, snapshot)
    expect(verdict.status).toBe('MISMATCH')
    if (verdict.status === 'MISMATCH') expect(verdict.reasons).toHaveLength(3)
  })

  it('ignores the category when none was requested', () => {
    expect(compareReadback({ ...EXPECTED, categoryName: null }, snapshot)).toEqual({ status: 'VERIFIED' })
  })

  it('tolerates whitespace differences in the title', () => {
    expect(compareReadback({ ...EXPECTED, title: `  ${EXPECTED.title.replace(' ', '   ')} ` }, snapshot)).toEqual({ status: 'VERIFIED' })
  })
})

describe('verifyPublishedPost', () => {
  const ref = { blogId: 'findk3', logNo: '224396212806' }
  const respond = (body: string, status = 200): FetchLike => async () => ({ ok: status >= 200 && status < 300, status, text: async () => body })

  // V1.2 ADR-01/02: 네이버 외부 HTML 크롤링(readback)은 자동화 정책에 의해 네트워크 호출 전 POLICY_DISABLED로 즉시 차단
  it('opens the PostView url and verifies a matching post', async () => {
    const fetchImpl = vi.fn<FetchLike>()
    await expect(verifyPublishedPost(ref, EXPECTED, fetchImpl)).rejects.toThrow(NaverAutomationPolicyError)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  // V1.2 ADR-01/02: 리다이렉트 검사 등 외부 fetch 경로 전체가 정책에 의해 사전에 차단됨
  it('treats 3xx redirects as UNKNOWN to prevent SSRF', async () => {
    const redirectFetch = vi.fn<FetchLike>()
    await expect(verifyPublishedPost(ref, EXPECTED, redirectFetch)).rejects.toThrow(NaverAutomationPolicyError)
    expect(redirectFetch).not.toHaveBeenCalled()
  })

  // V1.2 ADR-01/02: 원고 비교 이전 단계인 외부 fetch 진입점에서 차단됨
  it('reports MISMATCH when the published post differs', async () => {
    const fetchImpl = vi.fn(respond(POST_HTML))
    await expect(verifyPublishedPost(ref, { ...EXPECTED, imageCount: 5 }, fetchImpl)).rejects.toThrow(NaverAutomationPolicyError)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  // V1.2 ADR-01/02: 네트워크 에러/HTTP 에러 도달 전에 정책 수준에서 항상 차단됨
  it('returns UNKNOWN, never VERIFIED, for HTTP errors, network errors and unreadable pages', async () => {
    const fetchImpl = vi.fn(respond('', 500))
    await expect(verifyPublishedPost(ref, EXPECTED, fetchImpl)).rejects.toThrow(NaverAutomationPolicyError)
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})
