import type { VaultChannel, VaultJson } from '../types'

/**
 * Single source for the text a vault item shows and exports.
 *
 * The preview (what the owner approves) and the copy bundle (what the owner pastes) both read the saved
 * variant payload through this module, so the exported title, body and tags cannot drift from the preview.
 * Pure and client-safe: no repository, storage or provider imports.
 */
export interface VaultCopyFields {
  title: string | null
  body: string
  /** Tags without the leading "#"; blank entries are dropped. */
  tags: string[]
}

export interface VaultCopyContent extends VaultCopyFields {
  formattedTags: string
  fullText: string
}

type PayloadRecord = Record<string, VaultJson> | null | undefined

function normalizeTags(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((tag): tag is string => typeof tag === 'string')
    .map((tag) => tag.trim().replace(/^#+/, '').trim())
    .filter((tag) => tag.length > 0)
}

export function readVaultCopyFields(payload: PayloadRecord): VaultCopyFields {
  const raw = payload ?? {}
  const title = typeof raw.title === 'string' && raw.title.trim().length > 0 ? raw.title.trim() : null
  const body = typeof raw.text === 'string' ? raw.text : typeof raw.caption === 'string' ? raw.caption : ''
  return { title, body, tags: normalizeTags(raw.hashtags) }
}

export function formatCopyTags(tags: readonly string[]): string {
  return tags.map((tag) => `#${tag}`).join(' ')
}

/** The paste-ready text. Naver separates titled sections; Daangn leads with the title; Meta channels have no title. */
export function composeCopyText(channel: VaultChannel, { title, body, tags }: VaultCopyFields): string {
  const formattedTags = formatCopyTags(tags)
  const parts: string[] = []
  if (channel === 'naver_blog') {
    if (title) parts.push(`[제목]\n${title}`)
    if (body) parts.push(`[본문]\n${body}`)
    if (formattedTags) parts.push(`[태그]\n${formattedTags}`)
    return parts.join('\n\n')
  }
  if (title && channel === 'daangn_business') parts.push(title)
  if (body) parts.push(body)
  if (formattedTags) parts.push(formattedTags)
  return parts.join('\n\n')
}

export function readVaultCopyContent(channel: VaultChannel, payload: PayloadRecord): VaultCopyContent {
  const fields = readVaultCopyFields(payload)
  return { ...fields, formattedTags: formatCopyTags(fields.tags), fullText: composeCopyText(channel, fields) }
}
