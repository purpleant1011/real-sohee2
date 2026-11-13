export interface NaverPostRef {
  blogId: string
  logNo: string
}

const BLOG_ID_PATTERN = /^[A-Za-z0-9_-]{2,30}$/
const LOG_NO_PATTERN = /^\d{6,20}$/
const POST_VIEW_PATHS = new Set(['PostView.naver', 'PostView.nhn'])

/** Accepts only https blog.naver.com / m.blog.naver.com post URLs. Anything else returns null. */
export function parseNaverBlogPostUrl(input: string): NaverPostRef | null {
  let url: URL
  try {
    url = new URL(input.trim())
  } catch {
    return null
  }
  if (url.protocol !== 'https:') return null
  const host = url.hostname.toLowerCase()
  if (host !== 'blog.naver.com' && host !== 'm.blog.naver.com') return null

  const segments = url.pathname.split('/').filter(Boolean)
  let blogId: string | null = null
  let logNo: string | null = null
  if (segments.length === 2) {
    blogId = segments[0]
    logNo = segments[1]
  } else if (segments.length === 1 && POST_VIEW_PATHS.has(segments[0])) {
    blogId = url.searchParams.get('blogId')
    logNo = url.searchParams.get('logNo')
  }
  if (!blogId || !logNo) return null
  if (!BLOG_ID_PATTERN.test(blogId) || !LOG_NO_PATTERN.test(logNo)) return null
  return { blogId, logNo }
}

/** Server-rendered post body, readable without a login for public posts. */
export function postViewUrl(ref: NaverPostRef): string {
  return `https://blog.naver.com/PostView.naver?blogId=${encodeURIComponent(ref.blogId)}&logNo=${ref.logNo}&redirect=Dlog&widgetTypeCall=true&directAccess=true`
}
