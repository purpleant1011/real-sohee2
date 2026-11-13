'use client'

import { useState } from 'react'
import { ContentHubWorkspace } from '@/components/quick-post/content-hub'
import { useTheme } from '@/components/theme-provider'
import { Button } from '@/components/ui/button'
import type { QuickPostItem } from '@/components/quick-post/types'

const idOf = (n: number) => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`
function samples(): QuickPostItem[] {
  return Array.from({ length: 85 }, (_, index) => {
    const n = 85 - index
    return {
      missionId: idOf(n), status: n % 3 === 0 ? 'PUBLISHED_VERIFIED' : 'AWAITING_APPROVAL',
      topic: `${n % 2 === 0 ? '가을' : '매장'} 소식 ${n}`, createdAt: '2026-10-19T12:00:00.123456Z',
      copies: { instagram: { caption: `예시 매장 소식 ${n}`, hashtags: ['예시'] }, threads: { content: `예시 본문 ${n}` } },
      imageIds: [], imageUrl: null, channels: [{ provider: n % 2 === 0 ? 'instagram' : 'threads', handle: '@sample' }],
      approvalFingerprint: 'fixture-only', businessName: '예시 매장', revision: 1, receipts: {},
    }
  })
}

function createSampleFetch(): typeof fetch {
    const posts = samples()
    const respond = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
    // Only this component's explicit request dependency is replaced; never intercept global fetch.
    const fetchFn: typeof fetch = async (input, init) => {
      const url = new URL(String(input), 'http://localhost')
      if (init?.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
      const path = url.pathname
      if (path.endsWith('/profile')) return respond({ profile: { business: { business_name: '예시 매장' } } })
      if (path.endsWith('/funnel')) return respond({ fixture: true })
      if (path.endsWith('/approval-options')) return respond({ missionId: path.split('/').at(-2), revision: 1, targets: [] })
      if (!path.includes('/quick-post')) return respond({ error: '샘플 화면에서는 외부 작업을 실행하지 않아요.' }, 403)
      if (init?.method === 'PATCH') {
        const body = JSON.parse(String(init.body))
        const item = posts.find(post => post.missionId === body.missionId)
        if (!item) return respond({ error: '게시물을 찾을 수 없어요.' }, 404)
        item.copies = body.copies ?? item.copies
        item.revision += 1
        return respond({ item })
      }
      if (init?.method === 'POST') {
        const body = JSON.parse(String(init.body))
        const item = { ...posts[0], missionId: idOf(86), topic: body.topic, status: 'AWAITING_APPROVAL', revision: 1 }
        posts.unshift(item)
        return respond({ item })
      }
      const detailId = path.split('/quick-post/')[1]
      if (detailId) {
        if (detailId === 'error') return respond({ error: '상세 조회 실패 예시예요.' }, 500)
        const item = posts.find(post => post.missionId === detailId)
        return item ? respond({ item }) : respond({ error: '게시물을 찾을 수 없어요.' }, 404)
      }
      const q = url.searchParams.get('q') || ''
      if (q === '오류') return respond({ error: '검색 조회 실패 예시예요.' }, 500)
      const status = url.searchParams.get('status') || 'waiting'
      const channel = url.searchParams.get('channel') || 'all'
      const filtered = posts.filter(post => (!q || post.topic.includes(q)) && (status === 'all' || (status === 'published') === (post.status === 'PUBLISHED_VERIFIED')) && (channel === 'all' || post.channels.some(c => c.provider === channel)))
      const start = Number(url.searchParams.get('cursor') || '0')
      return respond({ items: filtered.slice(start, start + 20), nextCursor: filtered.length > start + 20 ? String(start + 20) : null, prevCursor: start > 0 ? String(Math.max(0, start - 20)) : null, hasNextPage: filtered.length > start + 20, hasAnySupportedContent: true, credits: { available: 100, draftCost: 250 } })
    }
    return fetchFn
}

export function ContentHubFixture() {
  const [version, setVersion] = useState(0)
  const [request, setRequest] = useState(createSampleFetch)
  const { resolvedTheme, setTheme } = useTheme()
  return <main className="min-h-screen bg-background text-foreground">
    <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 border-b p-4 text-sm">
      <strong>TEST 샘플 · 운영 데이터 및 외부 채널 연결 없음</strong>
      <Button variant="outline" onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}>테마 전환</Button>
      <Button variant="ghost" onClick={() => { setRequest(() => createSampleFetch()); setVersion(value => value + 1) }}>샘플 초기화</Button>
    </div>
    <ContentHubWorkspace key={version} workspaceId="10000000-0000-4000-8000-000000000001" fetchFn={request} />
  </main>
}
