import type { PublishedLink } from './summary-model'

const HOST_LABELS: Array<[RegExp, string]> = [
  [/(^|\.)instagram\.com$/u, '인스타그램'],
  [/(^|\.)threads\.(net|com)$/u, '스레드'],
  [/(^|\.)blog\.naver\.com$/u, '네이버 블로그'],
  [/(^|\.)daangn\.com$/u, '당근 비즈니스'],
]

/** 실게시 기록 한 줄. 열의 이름이 기록 시기에 따라 달라 둘 다 받는다. */
export interface ReceiptRow {
  status?: string | null
  receipt_kind?: string | null
  external_url?: string | null
  result_url?: string | null
  observed_payload?: { status?: string | null } | null
}

const LIVE_KINDS = new Set(['LIVE_PUBLISH', 'INSTAGRAM_FEED_PUBLISH'])

/**
 * 게시가 확인된 기록에서만 링크를 뽑는다. 대기/수락만 된 기록과 https가 아닌 주소는 버린다.
 */
export function extractPublishedLinks(rows: ReceiptRow[]): PublishedLink[] {
  const seen = new Set<string>()
  const links: PublishedLink[] = []
  for (const row of rows) {
    const verified = row.status === 'VERIFIED'
      || row.observed_payload?.status === 'VERIFIED'
      || (row.receipt_kind ? LIVE_KINDS.has(row.receipt_kind) : false)
    if (!verified) continue
    const raw = row.external_url ?? row.result_url
    if (!raw) continue
    let parsed: URL
    try { parsed = new URL(raw) } catch { continue }
    if (parsed.protocol !== 'https:' || seen.has(parsed.href)) continue
    seen.add(parsed.href)
    const label = HOST_LABELS.find(([re]) => re.test(parsed.hostname))?.[1] ?? '게시한 글'
    links.push({ url: parsed.href, channelLabel: label })
  }
  return links
}
