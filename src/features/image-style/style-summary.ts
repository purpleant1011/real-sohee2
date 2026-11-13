import {
  normalizeOverlayTexts,
  OVERLAY_PRESETS,
  type OverlayPresetId,
} from './overlay/overlay-template'
import type { WorkspaceImageStyle } from './workspace-image-style'

export type StyleSummaryReference = { id: string; url: string; note: string }

export type WorkspaceStyleSummary = {
  image: {
    configured: boolean
    headline: string
    referenceCount: number
    references: StyleSummaryReference[]
    hasGuide: boolean
    custom: boolean
  }
  text: {
    configured: boolean
    voiceSummary: string
  }
  overlay: {
    preset: OverlayPresetId
    brandLine: string
    designLine: string
    quote: string
    insetLabel: string
  } | null
}

export const EMPTY_STYLE_SUMMARY: WorkspaceStyleSummary = {
  image: {
    configured: false,
    headline: '',
    referenceCount: 0,
    references: [],
    hasGuide: false,
    custom: false,
  },
  text: {
    configured: false,
    voiceSummary: '',
  },
  overlay: null,
}

function truncateHeadline(raw: string): string {
  return raw.length > 60 ? `${raw.slice(0, 60)}…` : raw
}

function parseOverlay(raw: unknown): WorkspaceStyleSummary['overlay'] {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const rec = raw as Record<string, unknown>
  const preset = rec.preset
  if (typeof preset !== 'string' || !OVERLAY_PRESETS.some((p) => p.id === preset)) return null
  const texts = rec.texts
  if (typeof texts !== 'object' || texts === null || Array.isArray(texts)) return null
  const t = texts as Record<string, unknown>
  if (
    typeof t.brandLine !== 'string' ||
    typeof t.designLine !== 'string' ||
    typeof t.quote !== 'string' ||
    typeof t.insetLabel !== 'string'
  ) {
    return null
  }
  const normalized = normalizeOverlayTexts({
    brandLine: t.brandLine,
    designLine: t.designLine,
    quote: t.quote,
    insetLabel: t.insetLabel,
  })
  return {
    preset: preset as OverlayPresetId,
    ...normalized,
  }
}

export function summarizeStyle(input: {
  workspaceId: string
  style: WorkspaceImageStyle | null
  customStyle: boolean
  textRule: { brandVoice?: unknown } | null
  overlayRule?: { overlay?: unknown } | null
}): WorkspaceStyleSummary {
  const { workspaceId, style, customStyle, textRule, overlayRule } = input

  let imageSummary: WorkspaceStyleSummary['image']

  if (!style) {
    imageSummary = {
      configured: false,
      headline: '',
      referenceCount: 0,
      references: [],
      hasGuide: false,
      custom: false,
    }
  } else {
    const rawHeadline =
      style.subject?.trim() ||
      style.mood?.trim() ||
      style.setting?.trim() ||
      (style.guide?.trim() ? style.guide.trim().slice(0, 40) : '') ||
      '등록된 이미지 스타일'

    const references: StyleSummaryReference[] = (style.referenceAssetIds ?? [])
      .slice(0, 8)
      .map((id) => ({
        id,
        url: `/api/workspaces/${workspaceId}/media/${id}`,
        note: style.referenceNotes?.[id] ?? '',
      }))

    imageSummary = {
      configured: true,
      headline: truncateHeadline(rawHeadline),
      referenceCount: references.length,
      references,
      hasGuide: (style.guide?.trim().length ?? 0) > 0,
      custom: Boolean(customStyle),
    }
  }

  const brandVoiceStr = typeof textRule?.brandVoice === 'string' ? textRule.brandVoice.trim() : ''
  const textConfigured = brandVoiceStr.length > 0
  const voiceSummary = textConfigured ? brandVoiceStr.slice(0, 200) : ''

  return {
    image: imageSummary,
    text: {
      configured: textConfigured,
      voiceSummary,
    },
    overlay: parseOverlay(overlayRule?.overlay),
  }
}
