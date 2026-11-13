'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { parseNaverBlogPostUrl } from '@/features/naver-publish/blog-url'

/** 사장님이 직접 올린 네이버 글 주소를 기록한다. 외부 접속·게시 확인은 하지 않는다. */
export function NaverPostUrlForm({ workspaceId, itemId, fetcher = fetch, onRecorded }: {
  workspaceId: string
  itemId: string
  fetcher?: typeof fetch
  onRecorded?: (url: string) => void
}) {
  const [value, setValue] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<{ label: string; url: string } | null>(null)

  async function save() {
    if (saving) return
    const url = value.trim()
    if (!parseNaverBlogPostUrl(url)) {
      setSaved(null)
      setError('네이버 블로그 글 주소(https://blog.naver.com/블로그아이디/글번호)를 입력해 주세요.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const response = await fetcher(`/api/workspaces/${encodeURIComponent(workspaceId)}/vault/${encodeURIComponent(itemId)}/bundle`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url }),
      })
      const result = await response.json().catch(() => null) as { success?: boolean; publishedUrl?: string; statusLabel?: string; error?: string } | null
      if (!response.ok || !result?.success || !result.publishedUrl) throw new Error(result?.error ?? '게시 주소를 기록하지 못했어요. 잠시 후 다시 시도해 주세요.')
      setSaved({ label: result.statusLabel ?? '사장님이 직접 올린 글로 기록됐어요(확인 전)', url: result.publishedUrl })
      onRecorded?.(result.publishedUrl)
    } catch (cause) {
      setSaved(null)
      setError(cause instanceof Error ? cause.message : '게시 주소를 기록하지 못했어요. 잠시 후 다시 시도해 주세요.')
    } finally {
      setSaving(false)
    }
  }

  return <div className="space-y-2">
    <label htmlFor={`naver-post-url-${itemId}`} className="text-sm font-medium">올린 글 주소</label>
    <input id={`naver-post-url-${itemId}`} type="url" inputMode="url" value={value} disabled={saving} placeholder="https://blog.naver.com/…"
      onChange={(event) => setValue(event.target.value)} className="min-h-11 w-full rounded-md border bg-background px-3 text-sm" />
    <Button type="button" variant="outline" className="min-h-11" disabled={saving || !value.trim()} aria-busy={saving} onClick={() => void save()}>
      {saving ? '기록하는 중…' : '올린 글 주소 기록'}
    </Button>
    {saved ? <p role="status" className="text-sm">{saved.label} · 실제 게시를 확인한 것은 아니에요. 같은 원고에는 주소가 하나만 기록되고, 다시 기록하면 바뀌어요.</p> : null}
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
  </div>
}
