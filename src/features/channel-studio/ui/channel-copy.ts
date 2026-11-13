import type { StudioChannel } from '../types'

function safeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeHashtags(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((tag): tag is string => typeof tag === 'string')
    .map((tag) => tag.trim().replace(/^#+/, '').trim())
    .filter((tag) => tag.length > 0)
}

function formatHashtags(tags: readonly string[]): string {
  if (tags.length === 0) return ''
  return tags.map((tag) => `#${tag}`).join(' ')
}

function extractNaverBody(raw: Record<string, unknown>): string {
  if (Array.isArray(raw.blocks) && raw.blocks.length > 0) {
    const blockTexts = raw.blocks
      .filter((block): block is { text: string } =>
        !!block && typeof block === 'object' && typeof (block as any).text === 'string',
      )
      .map((block) => block.text.trim())
      .filter((text) => text.length > 0)

    if (blockTexts.length > 0) {
      return blockTexts.join('\n\n')
    }
  }

  return safeString(raw.text) || safeString(raw.caption)
}

/**
 * Builds paste-ready text tailored for each SNS channel.
 * - instagram: caption + blank line + hashtags
 * - threads: text only
 * - naver_blog: title + blank line + body (blocks order preserved) + hashtags
 * - daangn_business: firstLineHighlight + blank line + body
 */
export function buildChannelCopyText(
  channel: StudioChannel,
  payload?: Record<string, unknown> | null,
): string {
  const raw = payload ?? {}

  switch (channel) {
    case 'instagram': {
      const caption = safeString(raw.caption) || safeString(raw.text)
      const hashtags = formatHashtags(normalizeHashtags(raw.hashtags))
      return [caption, hashtags].filter(Boolean).join('\n\n')
    }

    case 'threads': {
      return safeString(raw.text) || safeString(raw.caption)
    }

    case 'naver_blog': {
      const title = safeString(raw.title)
      const body = extractNaverBody(raw)
      const hashtags = formatHashtags(normalizeHashtags(raw.hashtags))
      return [title, body, hashtags].filter(Boolean).join('\n\n')
    }

    case 'daangn_business': {
      const firstLine =
        safeString(raw.firstLineHighlight) ||
        safeString(raw.title) ||
        safeString(raw.firstLineHook)
      const body = safeString(raw.text) || safeString(raw.caption)
      return [firstLine, body].filter(Boolean).join('\n\n')
    }
  }
}
