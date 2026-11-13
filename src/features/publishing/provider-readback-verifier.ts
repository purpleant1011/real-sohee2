/**
 * Provider Media Readback & Perceptual Visual Equivalence Verifier (Wave 5: ANI-1084, ANI-1096)
 * Verifies that the published post on Meta (Instagram/Threads) matches the approved CreativeBundle
 * both textually (digest exact) and visually (perceptual similarity, accommodating JPEG recompression).
 */

import { createHash } from 'node:crypto'
import type { CreativeBundle } from '../creative/creative-bundle-types'
import { safeId, safeToken, type MetaFetch } from '@/lib/providers/meta-api'
import { CALIBRATION_CORPUS_VERSION } from './calibration/calibration-corpus'
import { PERCEPTUAL_SIMILARITY_THRESHOLDS } from './perceptual-image-comparator'

import type { VerificationOutcome } from './provider-readback-types'
export type { VerificationOutcome }

export interface ProviderObservedMediaItem {
  id: string
  mediaType: 'IMAGE' | 'CAROUSEL_ALBUM' | 'VIDEO' | string
  mediaUrl?: string
  width?: number
  height?: number
  position: number
}

export interface ProviderObservedPost {
  providerPostId: string
  channel: 'instagram' | 'threads'
  caption: string
  permalink: string | null
  mediaItems: ProviderObservedMediaItem[]
  timestamp: string
}

export interface ReadbackVerificationResult {
  outcome: VerificationOutcome
  captionMatch: boolean
  visualScore: number
  reasonCode: string
  message: string
  observedPost: ProviderObservedPost | null
  evaluatedAt: string
  calibrationCorpusVersion?: string
  thresholdVersion?: string
}

export interface ReadbackVerificationDependencies {
  fetchPublishedPost(
    channel: 'instagram' | 'threads',
    providerPostId: string,
    accessToken: string
  ): Promise<ProviderObservedPost | null>
  computePerceptualSimilarity(
    sourceDigest: string,
    observedMediaUrl: string
  ): Promise<{ similarity: number; error?: string }>
}

/**
 * Normalizes captions for robust hash comparison (whitespace trimming, unicode normalization)
 */
export function normalizeCaptionForDigest(caption: string): string {
  return (caption ?? '').normalize('NFC').trim().replace(/\r\n/g, '\n')
}

export function computeCaptionDigest(caption: string): string {
  return createHash('sha256').update(normalizeCaptionForDigest(caption)).digest('hex')
}

/**
 * Composes canonical caption and hashtags for Meta posts (ANI-1136).
 * Handles hashtag formatting and avoids duplication.
 */
export function composeBundleCaption(caption: string, hashtags: string[] = []): string {
  const normCaption = (caption || '').trim()
  const validTags = (hashtags || [])
    .map(t => t.trim())
    .filter(Boolean)
    .map(t => (t.startsWith('#') ? t : `#${t}`))

  if (validTags.length === 0) {
    return normCaption
  }

  const missingTags = validTags.filter(tag => !normCaption.includes(tag))
  if (missingTags.length === 0) {
    return normCaption
  }

  return `${normCaption}\n\n${missingTags.join(' ')}`
}

/**
 * Evaluates whether observed media matches the approved CreativeBundle.
 * Handles single image and multi-image carousel order.
 */
export async function verifyPublishedCreativeBundle(
  approvedBundle: CreativeBundle,
  providerPostId: string,
  accessToken: string,
  deps: ReadbackVerificationDependencies
): Promise<ReadbackVerificationResult> {
  const evaluatedAt = new Date().toISOString()

  const buildResult = (params: {
    outcome: VerificationOutcome
    captionMatch: boolean
    visualScore: number
    reasonCode: string
    message: string
    observedPost: ProviderObservedPost | null
  }): ReadbackVerificationResult => ({
    ...params,
    evaluatedAt,
    calibrationCorpusVersion: CALIBRATION_CORPUS_VERSION,
    thresholdVersion: PERCEPTUAL_SIMILARITY_THRESHOLDS.VERSION,
  })

  if (approvedBundle.channel !== 'instagram' && approvedBundle.channel !== 'threads') {
    return buildResult({
      outcome: 'RESULT_UNKNOWN',
      captionMatch: false,
      visualScore: 0,
      reasonCode: 'UNSUPPORTED_READBACK_CHANNEL',
      message: `Readback verifier only supports instagram and threads, got ${approvedBundle.channel}`,
      observedPost: null,
    })
  }
  const channel: 'instagram' | 'threads' = approvedBundle.channel

  // 1. Fetch observed post from provider API
  let observedPost: ProviderObservedPost | null = null
  try {
    observedPost = await deps.fetchPublishedPost(
      channel,
      providerPostId,
      accessToken
    )
  } catch (err) {
    return buildResult({
      outcome: 'RESULT_UNKNOWN',
      captionMatch: false,
      visualScore: 0,
      reasonCode: 'PROVIDER_READBACK_NETWORK_ERROR',
      message: `Failed to query provider API: ${(err as Error).message}`,
      observedPost: null,
    })
  }

  if (!observedPost) {
    return buildResult({
      outcome: 'VERIFICATION_PENDING',
      captionMatch: false,
      visualScore: 0,
      reasonCode: 'PROVIDER_POST_NOT_YET_INDEXED',
      message: 'Post not yet available on provider graph API. Marked for background retry.',
      observedPost: null,
    })
  }

  // 2. Caption exact digest verification (ANI-1136: exact match against raw caption or canonical composed caption)
  const approvedRawDigest = computeCaptionDigest(approvedBundle.caption)
  const approvedFullDigest = computeCaptionDigest(
    composeBundleCaption(approvedBundle.caption, approvedBundle.hashtags)
  )
  const observedCaptionDigest = computeCaptionDigest(observedPost.caption)
  const captionMatch =
    approvedRawDigest === observedCaptionDigest ||
    approvedFullDigest === observedCaptionDigest

  if (!captionMatch) {
    return buildResult({
      outcome: 'VISUAL_MISMATCH',
      captionMatch: false,
      visualScore: 0,
      reasonCode: 'CAPTION_DIGEST_MISMATCH',
      message: 'Observed provider caption does not match approved bundle caption',
      observedPost,
    })
  }

  // 3. Media presence and count verification
  const expectedMediaCount = approvedBundle.orderedMedia.length
  const observedMediaCount = observedPost.mediaItems.length

  if (observedMediaCount === 0 && expectedMediaCount > 0) {
    return buildResult({
      outcome: 'VERIFICATION_PENDING',
      captionMatch: true,
      visualScore: 0,
      reasonCode: 'OBSERVED_MEDIA_EMPTY',
      message: 'Provider post has no media items yet (transcoding or async processing)',
      observedPost,
    })
  }

  if (observedMediaCount !== expectedMediaCount) {
    return buildResult({
      outcome: 'VISUAL_MISMATCH',
      captionMatch: true,
      visualScore: 0,
      reasonCode: 'MEDIA_COUNT_MISMATCH',
      message: `Expected ${expectedMediaCount} media items, but provider has ${observedMediaCount}`,
      observedPost,
    })
  }

  // 4. Perceptual equivalence evaluation per ordered media item
  let totalScore = 0
  for (let i = 0; i < expectedMediaCount; i++) {
    const expectedItem = approvedBundle.orderedMedia[i]
    const observedItem = observedPost.mediaItems[i]

    if (!observedItem || !observedItem.mediaUrl) {
      return buildResult({
        outcome: 'VERIFICATION_PENDING',
        captionMatch: true,
        visualScore: 0,
        reasonCode: 'OBSERVED_MEDIA_URL_UNAVAILABLE',
        message: `Media item at position ${i} has no reachable URL yet`,
        observedPost,
      })
    }

    const { similarity, error } = await deps.computePerceptualSimilarity(
      expectedItem.sha256Digest,
      observedItem.mediaUrl
    )

    if (error) {
      return buildResult({
        outcome: 'RESULT_UNKNOWN',
        captionMatch: true,
        visualScore: 0,
        reasonCode: 'PERCEPTUAL_CALCULATION_ERROR',
        message: `Perceptual calculation failed for position ${i}: ${error}`,
        observedPost,
      })
    }

    totalScore += similarity
  }

  const averageScore = totalScore / expectedMediaCount

  // 5. Outcome classification based on thresholds (ANI-1096 specification)
  // High confidence >= 0.85 -> VERIFIED (handles standard JPEG compression / resizing)
  // Gray band 0.65 .. 0.84 -> MANUAL_REVIEW_REQUIRED
  // Below 0.65 -> VISUAL_MISMATCH (e.g. bakery tart copy paired with salon image)
  if (averageScore >= 0.85) {
    return buildResult({
      outcome: 'VERIFIED',
      captionMatch: true,
      visualScore: averageScore,
      reasonCode: 'HIGH_CONFIDENCE_VISUAL_MATCH',
      message: `Provider media visually equivalent to approved bundle (similarity: ${averageScore.toFixed(3)})`,
      observedPost,
    })
  }

  if (averageScore >= 0.65) {
    return buildResult({
      outcome: 'MANUAL_REVIEW_REQUIRED',
      captionMatch: true,
      visualScore: averageScore,
      reasonCode: 'GRAY_BAND_SIMILARITY',
      message: `Visual similarity in gray band (${averageScore.toFixed(3)}). Requires manual review.`,
      observedPost,
    })
  }

  return buildResult({
    outcome: 'VISUAL_MISMATCH',
    captionMatch: true,
    visualScore: averageScore,
    reasonCode: 'PERCEPTUAL_VISUAL_MISMATCH',
    message: `Provider media does not match approved creative bundle (similarity: ${averageScore.toFixed(3)})`,
    observedPost,
  })
}

/**
 * Production implementation of fetchPublishedPost from Meta Graph API
 */
export async function fetchPublishedMetaPostDetails(
  channel: 'instagram' | 'threads',
  providerPostId: string,
  accessToken: string,
  fetcher: MetaFetch = fetch
): Promise<ProviderObservedPost | null> {
  const base = channel === 'instagram'
    ? 'https://graph.instagram.com/v26.0'
    : 'https://graph.threads.net/v1.0'

  const fields = channel === 'instagram'
    ? 'id,caption,media_type,media_url,permalink,timestamp,children{id,media_type,media_url}'
    : 'id,text,media_type,media_url,permalink,timestamp'

  const url = `${base}/${safeId(providerPostId)}?fields=${encodeURIComponent(fields)}`

  let response: Response
  try {
    response = await fetcher(url, {
      headers: { authorization: `Bearer ${safeToken(accessToken)}` },
      cache: 'no-store',
    })
  } catch {
    return null
  }

  if (!response.ok) return null

  const payload: any = await response.json()
  if (!payload || typeof payload !== 'object') return null

  const rawCaption = channel === 'instagram' ? payload.caption : payload.text
  const caption = typeof rawCaption === 'string' ? rawCaption : ''
  const permalink = typeof payload.permalink === 'string' ? payload.permalink : null
  const timestamp = typeof payload.timestamp === 'string' ? payload.timestamp : new Date().toISOString()

  const mediaItems: ProviderObservedMediaItem[] = []

  if (payload.media_type === 'CAROUSEL_ALBUM' && payload.children?.data) {
    const childrenData = Array.isArray(payload.children.data) ? payload.children.data : []
    childrenData.forEach((child: any, idx: number) => {
      mediaItems.push({
        id: child.id ?? `child-${idx}`,
        mediaType: child.media_type ?? 'IMAGE',
        mediaUrl: child.media_url,
        position: idx,
      })
    })
  } else if (payload.media_url) {
    mediaItems.push({
      id: payload.id,
      mediaType: payload.media_type ?? 'IMAGE',
      mediaUrl: payload.media_url,
      position: 0,
    })
  }

  return {
    providerPostId: payload.id,
    channel,
    caption,
    permalink,
    mediaItems,
    timestamp,
  }
}
