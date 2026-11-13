import { currentSpec, type ChannelType } from '../channel-spec'

export interface SourceImage {
  id: string
  workspaceId: string
  bucket: string
  objectPath: string
  width: number
  height: number
  mimeType: string
  sizeBytes: number
  rightsExpiresAt: string | null
  qcExpiresAt: string | null
}

export type RenditionPlan =
  | { status: 'UNKNOWN'; reason: string; channel: ChannelType; specVersion: string }
  | {
      status: 'READY'; source: SourceImage; channel: ChannelType; specVersion: string
      crop: { left: number; top: number; width: number; height: number }
      output: { format: 'jpeg' | 'png'; mimeType: 'image/jpeg' | 'image/png'; width: number; height: number; maxBytes: number | null }
      requiresTransformation: boolean
    }

/** Pure planner: no storage, provider, URL signing, or conversion side effects. */
export function planRenditions(asset: SourceImage, channel: ChannelType): RenditionPlan {
  const unknown = (reason: string): RenditionPlan => ({ status: 'UNKNOWN', reason, channel, specVersion: currentSpec.specVersion })
  if (!Number.isSafeInteger(asset.width) || asset.width <= 0 || !Number.isSafeInteger(asset.height) || asset.height <= 0 || !Number.isSafeInteger(asset.sizeBytes) || asset.sizeBytes < 0 || !asset.objectPath || !asset.bucket) return unknown('Missing or invalid source image metadata')
  const mime = asset.mimeType.toLowerCase()
  if (!['image/png', 'image/jpeg'].includes(mime)) return unknown('Unsupported source format')

  if (channel === 'instagram') {
    if (!currentSpec.instagram.allowedImageFormats.includes('image/jpeg')) return unknown('Instagram JPEG rule unavailable')
    // Integer cross-multiplication avoids floating point ratio boundary errors.
    const cropWidth = asset.width * 5 > asset.height * 4 ? Math.floor(asset.height * 4 / 5) : asset.width
    const cropHeight = asset.width * 5 > asset.height * 4 ? asset.height : Math.floor(asset.width * 5 / 4)
    if (cropWidth <= 0 || cropHeight <= 0) return unknown('Source too small to crop')
    return {
      status: 'READY', source: asset, channel, specVersion: currentSpec.specVersion,
      crop: { left: Math.floor((asset.width - cropWidth) / 2), top: Math.floor((asset.height - cropHeight) / 2), width: cropWidth, height: cropHeight },
      output: { format: 'jpeg', mimeType: 'image/jpeg', width: 1080, height: 1350, maxBytes: null },
      requiresTransformation: true,
    }
  }
  if (channel === 'threads') {
    const formats = currentSpec.threads.allowedImageFormats
    if (!formats.includes(mime)) return unknown('Threads image format not supported')
    const output = mime === 'image/png' && asset.sizeBytes <= currentSpec.threads.maxImageFileSizeBytes
      ? { format: 'png' as const, mimeType: 'image/png' as const }
      : { format: 'jpeg' as const, mimeType: 'image/jpeg' as const }
    if (!formats.includes(output.mimeType)) return unknown('Threads output format not supported')
    return {
      status: 'READY', source: asset, channel, specVersion: currentSpec.specVersion,
      crop: { left: 0, top: 0, width: asset.width, height: asset.height },
      output: { ...output, width: asset.width, height: asset.height, maxBytes: currentSpec.threads.maxImageFileSizeBytes },
      requiresTransformation: output.mimeType !== mime || asset.sizeBytes > currentSpec.threads.maxImageFileSizeBytes,
    }
  }
  // These shared specs define image counts (and a Naver recommended size), not MIME/ratio.
  // Never fabricate a provider format or aspect ratio for an unverified channel.
  if (channel === 'naver_blog') return unknown(`Image rendition format not specified (recommended size: ${currentSpec.naver_blog.recommendedMaxImageFileSizeBytes})`)
  return unknown(`Image rendition format not specified (image count: ${currentSpec.daangn.maxImages})`)
}
