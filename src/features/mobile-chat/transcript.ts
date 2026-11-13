/**
 * 대화 transcript → 화면 버블 변환과 증거 링크 검증.
 *
 * 서버가 확정하지 않은 버블은 pending 으로 남겨 '전송 중'과 '확정'을 구분한다.
 * 승인 카드는 서버가 승인 id 를 준 경우에만 만들고, 증거 링크는 검증을 통과한 것만 남긴다.
 */

export const CHAT_ROLES = ['owner', 'sohee', 'system'] as const

export type ChatRole = (typeof CHAT_ROLES)[number]

export interface ChatEvidenceLink {
  label: string
  href: string
}

export interface ChatApprovalCard {
  id: string
  title: string
}

export interface ChatBubble {
  id: string
  role: ChatRole
  text: string
  pending: boolean
  evidence: ChatEvidenceLink[]
  approval: ChatApprovalCard | null
}

const DEFAULT_ROLE: ChatRole = 'sohee'
const DEFAULT_APPROVAL_TITLE = '승인 제안'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readRole(value: unknown): ChatRole {
  return typeof value === 'string' &&
    (CHAT_ROLES as readonly string[]).includes(value)
    ? (value as ChatRole)
    : DEFAULT_ROLE
}

/** 앱 내부 절대 경로 또는 http(s) 절대 URL 만 허용한다. */
export function isSafeEvidenceHref(href: unknown): boolean {
  if (typeof href !== 'string') return false

  const value = href.trim()
  if (value === '') return false

  if (value.startsWith('/')) return !value.startsWith('//')

  let url: URL
  try {
    url = new URL(value)
  } catch {
    return false
  }

  return url.protocol === 'http:' || url.protocol === 'https:'
}

function readEvidence(value: unknown): ChatEvidenceLink[] {
  if (!Array.isArray(value)) return []

  const links: ChatEvidenceLink[] = []
  for (const entry of value) {
    if (!isRecord(entry)) continue

    const label = typeof entry.label === 'string' ? entry.label.trim() : ''
    const href = typeof entry.href === 'string' ? entry.href.trim() : ''
    if (label === '' || !isSafeEvidenceHref(href)) continue

    links.push({ label, href })
  }

  return links
}

function readApproval(value: unknown): ChatApprovalCard | null {
  if (!isRecord(value)) return null

  const id = typeof value.id === 'string' ? value.id.trim() : ''
  if (id === '') return null

  const title = typeof value.title === 'string' ? value.title.trim() : ''
  return { id, title: title === '' ? DEFAULT_APPROVAL_TITLE : title }
}

function readMessages(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload
  if (!isRecord(payload) || !Array.isArray(payload.messages)) return []

  return payload.messages
}

/** 서버 payload 를 버블로 만든다. id/본문이 없는 항목은 버리고, 중복 id 는 첫 항목만 남긴다. */
export function toChatBubbles(payload: unknown): ChatBubble[] {
  const bubbles: ChatBubble[] = []
  const seen = new Set<string>()

  for (const entry of readMessages(payload)) {
    if (!isRecord(entry)) continue

    const id = typeof entry.id === 'string' ? entry.id : ''
    const text = typeof entry.text === 'string' ? entry.text : ''
    if (id === '' || text.trim() === '' || seen.has(id)) continue

    seen.add(id)
    bubbles.push({
      id,
      role: readRole(entry.role),
      text,
      pending: entry.pending === true,
      evidence: readEvidence(entry.evidence),
      approval: readApproval(entry.approval),
    })
  }

  return bubbles
}

/** 사장님이 방금 보낸 메시지를 낙관적으로 붙일 때 쓰는 버블. */
export function outgoingBubble(id: string, text: string): ChatBubble {
  return {
    id,
    role: 'owner',
    text,
    pending: true,
    evidence: [],
    approval: null,
  }
}
