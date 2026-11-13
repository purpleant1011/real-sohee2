import type { NaverPostRef } from './blog-url'
import { assertNaverAutomationAllowed } from './automation-policy'

export interface NaverPostSnapshot {
  title: string
  categoryName: string | null
  imageCount: number
  text: string
}

export interface NaverReadbackExpectation {
  title: string
  categoryName: string | null
  imageCount: number
}

export type NaverReadbackVerdict =
  | { status: 'VERIFIED' }
  | { status: 'MISMATCH'; reasons: string[] }
  | { status: 'UNKNOWN'; reasons: string[] }

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (entity[0] === '#') {
      const code = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10)
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match
    }
    return ENTITIES[entity.toLowerCase()] ?? match
  })
}

function textOf(html: string): string {
  return decodeEntities(html.replace(/<!--[\s\S]*?-->/g, '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')).replace(/[ \t]+/g, ' ').trim()
}

function normalize(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

/**
 * Reads the SmartEditor ONE output of a public post. Regex based so it also runs on the edge runtime,
 * which has no DOMParser. Returns null when the page does not look like a rendered post.
 */
export function parsePostViewHtml(html: string): NaverPostSnapshot | null {
  const mainStart = html.indexOf('se-main-container')
  const titleMatch = /class="[^"]*\bse-title-text\b[^"]*"[^>]*>([\s\S]*?)<\/div>/.exec(html)
  if (mainStart === -1 || !titleMatch) return null

  const title = textOf(titleMatch[1])
  if (!title) return null

  const categoryMatch = /<div class="blog2_series">\s*<a\b[^>]*>([\s\S]*?)<\/a>/.exec(html)
  const categoryName = categoryMatch ? textOf(categoryMatch[1]) || null : null

  const main = html.slice(mainStart)
  const imageCount = (main.match(/<img\b[^>]*\bclass="[^"]*\bse-image-resource\b[^"]*"[^>]*>/g) ?? []).length
  const paragraphs = [...main.matchAll(/<p\b[^>]*\bclass="[^"]*\bse-text-paragraph\b[^"]*"[^>]*>([\s\S]*?)<\/p>/g)].map((match) => textOf(match[1]))
  return { title, categoryName, imageCount, text: paragraphs.join('\n') }
}

export function compareReadback(expected: NaverReadbackExpectation, actual: NaverPostSnapshot): NaverReadbackVerdict {
  const reasons: string[] = []
  if (normalize(expected.title) !== normalize(actual.title)) reasons.push('게시된 제목이 승인한 제목과 달라요.')
  if (expected.categoryName !== null && normalize(expected.categoryName) !== normalize(actual.categoryName ?? '')) {
    reasons.push('게시된 카테고리가 선택한 카테고리와 달라요.')
  }
  if (expected.imageCount !== actual.imageCount) {
    reasons.push(`이미지 수가 달라요. 승인 ${expected.imageCount}장, 게시 ${actual.imageCount}장.`)
  }
  return reasons.length === 0 ? { status: 'VERIFIED' } : { status: 'MISMATCH', reasons }
}

export type FetchLike = (url: string, init?: { signal?: AbortSignal; headers?: Record<string, string>; redirect?: 'manual' | 'follow' | 'error' }) => Promise<{ ok: boolean; status: number; type?: string; text(): Promise<string> }>

/**
 * V1.2 ADR-01/02: 외부 HTML 크롤링(readback)은 자동화 금지 정책에 따라 영구 차단.
 * 항상 NaverAutomationPolicyError('html_readback')를 throw한다 (외부 fetch 0회).
 */
export async function verifyPublishedPost(
  _ref: NaverPostRef,
  _expected: NaverReadbackExpectation,
  _fetchImpl: FetchLike,
): Promise<NaverReadbackVerdict> {
  assertNaverAutomationAllowed('html_readback')
}
